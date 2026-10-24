import { randomUUID } from 'node:crypto';
import { balanceOf, createProduct, createTestApp, login, postReceipt, registerTenant, Session, TestApp } from './helpers';

const api = '/api/v1';

describe('Sales / POS (Module 05) – T-130..T-145', () => {
  let t: TestApp;
  let s: Session;
  let customerId: string;
  beforeAll(async () => {
    t = await createTestApp();
    s = await registerTenant(t);
    const c = await t.http().post(`${api}/customers`).set(s.auth).send({ name: 'Nguyễn Khách', phone: '0912345678' });
    expect(c.status).toBe(201);
    customerId = c.body.id;
  });
  afterAll(async () => { await t.close(); });

  const stocked = async (qty = '10', cost = '50000', price = '100000', extra: Record<string, unknown> = {}) => {
    const p = await createProduct(t, s, { variants: [{ sellPrice: price, costPrice: cost }], ...extra });
    await postReceipt(t, s, [{ variantId: p.variantId, quantity: qty, unitCost: cost }]);
    return p;
  };
  const checkout = (body: Record<string, unknown>, auth = s.auth, headers: Record<string, string> = {}) =>
    t.http().post(`${api}/invoices/checkout`).set(auth).set(headers).send({ branchId: s.branchId, warehouseId: s.warehouseId, ...body });
  const custBalance = async (id = customerId) => (await t.http().get(`${api}/customers/${id}`).set(s.auth)).body.balance as string;

  it('T-131 customer: auto code KH000001, opening balance via ledger, quick search by phone', async () => {
    const c = await t.http().get(`${api}/customers/${customerId}`).set(s.auth);
    expect(c.body.code).toBe('KH000001');
    const withDebt = await t.http().post(`${api}/customers`).set(s.auth).send({ name: 'Nợ cũ', openingBalance: '300000', creditLimit: '1000000' });
    expect(withDebt.status).toBe(201);
    expect(await custBalance(withDebt.body.id)).toBe('300000');
    const hit = await t.http().get(`${api}/customers/search`).set(s.auth).query({ q: '0912' });
    expect(hit.body[0].id).toBe(customerId);
  });

  it('T-132 cash sale: stock out at average cost, COGS separate from price, payment voucher PT allocated, walk-in allowed', async () => {
    const p = await stocked('10', '50000', '100000');
    const res = await checkout({ lines: [{ variantId: p.variantId, quantity: '3' }], payments: [{ method: 'CASH', amount: '300000' }] });
    expect(res.status).toBe(201);
    expect(res.body.status).toBe('COMPLETED');
    expect(res.body.code).toBe('HD000001');
    expect(res.body.totalAmount).toBe('300000');
    expect(res.body.paidAmount).toBe('300000');
    expect(res.body.dueAmount).toBe('0');
    expect(res.body.costTotal).toBe('150000');
    expect(res.body.lines[0].unitCost).toBe('50000');
    expect(res.body.lines[0].listPrice).toBe('100000');
    expect(res.body.payments).toHaveLength(1);
    expect(res.body.payments[0].payment.code).toMatch(/^PT\d{6}$/);
    expect(res.body.payments[0].payment.method).toBe('CASH');
    const bal = await balanceOf(t, s, p.variantId);
    expect(bal.onHand).toBe('7');
    const mv = await t.prisma.raw.stockMovement.findMany({ where: { documentId: res.body.id } });
    expect(mv[0].type).toBe('SALE');
    expect(mv[0].quantity.toString()).toBe('-3');
    // walk-in sale with no customer: no ledger entries at all
    expect(await t.prisma.raw.partyLedgerEntry.count({ where: { documentId: res.body.id } })).toBe(0);
  });

  it('T-133 combined + partial payment on credit: customer ledger +total −paid, unpaid remainder is debt', async () => {
    const p = await stocked('10', '50000', '100000');
    const before = await custBalance();
    const res = await checkout({ customerId, lines: [{ variantId: p.variantId, quantity: '4' }], payments: [{ method: 'CASH', amount: '150000' }, { method: 'BANK_TRANSFER', amount: '100000', reference: 'VCB 123' }] });
    expect(res.status).toBe(201);
    expect(res.body.paidAmount).toBe('250000');
    expect(res.body.dueAmount).toBe('150000');
    expect(res.body.payments).toHaveLength(2);
    expect(Number(await custBalance())).toBe(Number(before) + 150000);
    const ledger = await t.http().get(`${api}/customers/${customerId}/ledger`).set(s.auth);
    expect(ledger.body.data.map((e: any) => e.type).slice(0, 3).sort()).toEqual(['RECEIPT', 'RECEIPT', 'SALE']);
    // collect the remaining debt later through a generic phiếu thu allocated to the invoice
    const pay = await t.http().post(`${api}/payments`).set(s.auth).send({ branchId: s.branchId, direction: 'IN', partyType: 'CUSTOMER', partyId: customerId, amount: '150000', method: 'CASH', allocations: [{ documentType: 'INVOICE', documentId: res.body.id, amount: '150000' }] });
    expect(pay.status).toBe(201);
    expect((await t.http().get(`${api}/invoices/${res.body.id}`).set(s.auth)).body.dueAmount).toBe('0');
    expect(Number(await custBalance())).toBe(Number(before));
    const over = await t.http().post(`${api}/payments`).set(s.auth).send({ branchId: s.branchId, direction: 'IN', partyType: 'CUSTOMER', partyId: customerId, amount: '1', allocations: [{ documentType: 'INVOICE', documentId: res.body.id, amount: '1' }] });
    expect(over.status).toBe(409);
    expect(over.body.code).toBe('OVERPAYMENT');
  });

  it('T-134 credit sale without a customer is rejected; credit limit enforced; setting can disable credit sales', async () => {
    const p = await stocked('10', '10', '100000');
    const noCust = await checkout({ lines: [{ variantId: p.variantId, quantity: '1' }], payments: [{ method: 'CASH', amount: '50000' }] });
    expect(noCust.status).toBe(400);
    const limited = (await t.http().post(`${api}/customers`).set(s.auth).send({ name: 'Hạn mức', creditLimit: '120000' })).body;
    const okCredit = await checkout({ customerId: limited.id, lines: [{ variantId: p.variantId, quantity: '1' }], payments: [] });
    expect(okCredit.status).toBe(201);
    expect(okCredit.body.dueAmount).toBe('100000');
    const overLimit = await checkout({ customerId: limited.id, lines: [{ variantId: p.variantId, quantity: '1' }], payments: [{ method: 'CASH', amount: '70000' }] }); // projected 130,000 > 120,000
    expect(overLimit.status).toBe(409);
    expect(overLimit.body.code).toBe('CREDIT_LIMIT_EXCEEDED');
    expect((await balanceOf(t, s, p.variantId)).onHand).toBe('9'); // rolled back
    const within = await checkout({ customerId: limited.id, lines: [{ variantId: p.variantId, quantity: '1' }], payments: [{ method: 'CASH', amount: '80000' }] }); // projected 120,000
    expect(within.status).toBe(201);
    await t.http().put(`${api}/settings`).set(s.auth).send({ settings: { 'pos.allowCreditSales': false } });
    const disabled = await checkout({ customerId, lines: [{ variantId: p.variantId, quantity: '1' }], payments: [] });
    expect(disabled.status).toBe(409);
    expect(disabled.body.code).toBe('CREDIT_NOT_ALLOWED');
    await t.http().put(`${api}/settings`).set(s.auth).send({ settings: { 'pos.allowCreditSales': true } });
  });

  it('T-135 discounts, tax included in price, price book, selling unit and combo expansion', async () => {
    const p = await stocked('100', '10000', '20000', { taxRate: '10', units: [{ unitName: 'Lốc', conversionFactor: '6', sellPrice: '110000' }] });
    const unit = (await t.http().get(`${api}/products/${p.productId}`).set(s.auth)).body.units[0];
    const pb = await t.http().post(`${api}/price-books`).set(s.auth).send({ code: 'VIP', name: 'VIP' });
    await t.http().put(`${api}/price-books/${pb.body.id}/items`).set(s.auth).send({ items: [{ variantId: p.variantId, price: '18000' }] });
    const res = await checkout({
      customerId, priceBookId: pb.body.id, discountAmount: '5000',
      lines: [{ variantId: p.variantId, quantity: '2', discountAmount: '1000' }, { variantId: p.variantId, quantity: '1', productUnitId: unit.id }],
      payments: [{ method: 'CASH', amount: '138000' }],
    });
    expect(res.status).toBe(201);
    const [l1, l2] = res.body.lines;
    expect(l1.listPrice).toBe('18000');          // price book
    expect(l1.lineTotal).toBe('35000');          // 2 × 18,000 − 1,000
    expect(l2.listPrice).toBe('108000');         // price book 18,000 × 6 (unit factor) beats the unit's own price
    expect(l2.baseQuantity).toBe('6');
    expect(res.body.subtotal).toBe('143000');
    expect(res.body.discountAmount).toBe('5000');
    expect(res.body.totalAmount).toBe('138000'); // tax included in price → total unchanged
    expect(Number(res.body.taxAmount)).toBeCloseTo(138000 * 10 / 110, 2);
    expect(res.body.dueAmount).toBe('0');
    expect((await balanceOf(t, s, p.variantId)).onHand).toBe('92'); // 100 − 2 − 6
    // combo: 1 combo = 2 × component
    const comp = await stocked('10', '5000', '8000');
    const combo = await t.http().post(`${api}/products`).set(s.auth).send({ name: 'Combo 2', type: 'COMBO', variants: [{ sellPrice: '15000' }], comboItems: [{ componentVariantId: comp.variantId, quantity: '2' }] });
    const sale = await checkout({ lines: [{ variantId: combo.body.variants[0].id, quantity: '3' }], payments: [{ method: 'CASH', amount: '45000' }] });
    expect(sale.status).toBe(201);
    expect(sale.body.costTotal).toBe('30000'); // 6 units × 5,000
    expect((await balanceOf(t, s, comp.variantId)).onHand).toBe('4');
    const tooMany = await checkout({ lines: [{ variantId: combo.body.variants[0].id, quantity: '3' }], payments: [{ method: 'CASH', amount: '45000' }] });
    expect(tooMany.status).toBe(409);
    expect(tooMany.body.code).toBe('INSUFFICIENT_STOCK');
  });

  it('T-136 price edit and discount need permissions; cashier can still sell at list price', async () => {
    const roles = await t.http().get(`${api}/roles`).set(s.auth);
    const cashier = roles.body.find((r: any) => r.code === 'CASHIER');
    await t.http().post(`${api}/users`).set(s.auth).send({ username: 'pos1', password: 'Secret123', fullName: 'Thu ngân', roleIds: [cashier.id], branchIds: [s.branchId] });
    const auth = { Authorization: `Bearer ${(await login(t, s.tenantCode, 'pos1', 'Secret123')).body.accessToken}` };
    const p = await stocked('10', '10', '100000');
    const priceEdit = await checkout({ lines: [{ variantId: p.variantId, quantity: '1', unitPrice: '90000' }], payments: [{ method: 'CASH', amount: '90000' }] }, auth);
    expect(priceEdit.status).toBe(403);
    const discounted = await checkout({ lines: [{ variantId: p.variantId, quantity: '1', discountAmount: '10000' }], payments: [{ method: 'CASH', amount: '90000' }] }, auth);
    expect(discounted.status).toBe(201); // CASHIER has invoice.discount
    const list = await checkout({ lines: [{ variantId: p.variantId, quantity: '1' }], payments: [{ method: 'CASH', amount: '100000' }] }, auth);
    expect(list.status).toBe(201);
    expect(list.body.costTotal).toBeUndefined(); // no sales.report.view → cost hidden
    expect((await t.http().post(`${api}/invoices/${list.body.id}/cancel`).set(auth).send({ reason: 'x' })).status).toBe(403);
    expect((await t.http().get(`${api}/sales/reports/summary`).set(auth)).status).toBe(403);
  });

  it('T-137 hold order (DRAFT) does not touch stock; can be edited then completed; idempotent checkout', async () => {
    const p = await stocked('5', '10', '1000');
    const draft = await t.http().post(`${api}/invoices`).set(s.auth).send({ branchId: s.branchId, warehouseId: s.warehouseId, lines: [{ variantId: p.variantId, quantity: '2' }] });
    expect(draft.status).toBe(201);
    expect(draft.body.status).toBe('DRAFT');
    expect((await balanceOf(t, s, p.variantId)).onHand).toBe('5');
    const upd = await t.http().patch(`${api}/invoices/${draft.body.id}`).set(s.auth).send({ version: 1, lines: [{ variantId: p.variantId, quantity: '3' }] });
    expect(upd.status).toBe(200);
    expect(upd.body.totalAmount).toBe('3000');
    const done = await t.http().post(`${api}/invoices/${draft.body.id}/complete`).set(s.auth).send({ payments: [{ method: 'CASH', amount: '3000' }] });
    expect(done.status).toBe(200);
    expect(done.body.status).toBe('COMPLETED');
    expect((await balanceOf(t, s, p.variantId)).onHand).toBe('2');
    expect((await t.http().patch(`${api}/invoices/${draft.body.id}`).set(s.auth).send({ version: 3, note: 'x' })).status).toBe(409);
    const key = randomUUID();
    const results = await Promise.all(Array.from({ length: 3 }, () => checkout({ lines: [{ variantId: p.variantId, quantity: '1' }], payments: [{ method: 'CASH', amount: '1000' }] }, s.auth, { 'Idempotency-Key': key })));
    expect(results.filter((r) => r.status === 201 && r.headers['idempotent-replayed'] !== 'true')).toHaveLength(1);
    expect((await balanceOf(t, s, p.variantId)).onHand).toBe('1');
  });

  it('T-138 two cashiers selling the last unit → exactly one succeeds', async () => {
    const p = await stocked('1', '10', '1000');
    const results = await Promise.all([
      checkout({ lines: [{ variantId: p.variantId, quantity: '1' }], payments: [{ method: 'CASH', amount: '1000' }] }),
      checkout({ lines: [{ variantId: p.variantId, quantity: '1' }], payments: [{ method: 'CASH', amount: '1000' }] }),
    ]);
    expect(results.map((r) => r.status).sort()).toEqual([201, 409]);
    expect((await balanceOf(t, s, p.variantId)).onHand).toBe('0');
    expect(await t.prisma.raw.invoice.count({ where: { tenantId: s.tenantId, status: 'COMPLETED', lines: { some: { variantId: p.variantId } } } })).toBe(1);
  });

  it('T-139 cancelling an invoice restores stock, cancels its payments and reverses the customer ledger', async () => {
    const p = await stocked('5', '20000', '50000');
    const before = await custBalance();
    const inv = await checkout({ customerId, lines: [{ variantId: p.variantId, quantity: '2' }], payments: [{ method: 'CASH', amount: '60000' }] });
    expect(inv.status).toBe(201);
    expect(Number(await custBalance())).toBe(Number(before) + 40000);
    const cancel = await t.http().post(`${api}/invoices/${inv.body.id}/cancel`).set(s.auth).send({ reason: 'Khách đổi ý' });
    expect(cancel.status).toBe(200);
    expect(cancel.body.status).toBe('CANCELLED');
    expect((await balanceOf(t, s, p.variantId)).onHand).toBe('5');
    expect(await custBalance()).toBe(before);
    const pay = await t.prisma.raw.payment.findFirst({ where: { allocations: { some: { documentType: 'INVOICE', documentId: inv.body.id } } } });
    expect(pay?.status).toBe('CANCELLED');
    expect((await t.http().post(`${api}/invoices/${inv.body.id}/cancel`).set(s.auth).send({ reason: 'x' })).status).toBe(409);
    // a payment shared with another invoice blocks the cancel
    const a = await checkout({ customerId, lines: [{ variantId: p.variantId, quantity: '1' }], payments: [] });
    const b = await checkout({ customerId, lines: [{ variantId: p.variantId, quantity: '1' }], payments: [] });
    const shared = await t.http().post(`${api}/payments`).set(s.auth).send({ branchId: s.branchId, direction: 'IN', partyType: 'CUSTOMER', partyId: customerId, amount: '100000', allocations: [{ documentType: 'INVOICE', documentId: a.body.id, amount: '50000' }, { documentType: 'INVOICE', documentId: b.body.id, amount: '50000' }] });
    expect(shared.status).toBe(201);
    const blocked = await t.http().post(`${api}/invoices/${a.body.id}/cancel`).set(s.auth).send({ reason: 'x' });
    expect(blocked.status).toBe(409);
    expect(blocked.body.code).toBe('PAYMENT_SHARED');
    const rec = await t.http().post(`${api}/payments/reconcile`).set(s.auth);
    expect(rec.body.ok).toBe(true);
    expect((await t.http().post(`${api}/inventory/reconcile`).set(s.auth)).body.ok).toBe(true);
  });

  it('T-140 shifts: open → sales attach → close reconciles cash; one open shift per cashier; requireOpenShift setting', async () => {
    const p = await stocked('10', '10', '10000');
    const open = await t.http().post(`${api}/shifts/open`).set(s.auth).send({ branchId: s.branchId, openingCash: '500000' });
    expect(open.status).toBe(201);
    expect(open.body.code).toBe('CA000001');
    expect((await t.http().post(`${api}/shifts/open`).set(s.auth).send({ branchId: s.branchId })).body.code).toBe('SHIFT_ALREADY_OPEN');
    const inv = await checkout({ lines: [{ variantId: p.variantId, quantity: '2' }], payments: [{ method: 'CASH', amount: '15000' }, { method: 'CARD', amount: '5000' }] });
    expect(inv.body.shiftId).toBe(open.body.id);
    const cancelled = await checkout({ lines: [{ variantId: p.variantId, quantity: '1' }], payments: [{ method: 'CASH', amount: '10000' }] });
    await t.http().post(`${api}/invoices/${cancelled.body.id}/cancel`).set(s.auth).send({ reason: 'x' });
    const cur = await t.http().get(`${api}/shifts/current`).set(s.auth).query({ branchId: s.branchId });
    expect(cur.body.id).toBe(open.body.id);
    expect(cur.body.expectedCash).toBe('515000'); // opening 500,000 + 15,000 cash (cancelled sale excluded)
    expect(cur.body.invoices).toBe(1);
    const close = await t.http().post(`${api}/shifts/${open.body.id}/close`).set(s.auth).send({ countedCash: '510000', note: 'thiếu 5k' });
    expect(close.status).toBe(200);
    expect(close.body.status).toBe('CLOSED');
    expect(close.body.difference).toBe('-5000');
    expect(close.body.byMethod.find((m: any) => m.method === 'CARD').in).toBe('5000');
    expect((await t.http().post(`${api}/shifts/${open.body.id}/close`).set(s.auth).send({ countedCash: '1' })).status).toBe(409);
    await t.http().put(`${api}/settings`).set(s.auth).send({ settings: { 'pos.requireOpenShift': true } });
    const noShift = await checkout({ lines: [{ variantId: p.variantId, quantity: '1' }], payments: [{ method: 'CASH', amount: '10000' }] });
    expect(noShift.status).toBe(409);
    expect(noShift.body.code).toBe('SHIFT_REQUIRED');
    await t.http().put(`${api}/settings`).set(s.auth).send({ settings: { 'pos.requireOpenShift': false } });
  });

  it('T-141 sales report: revenue, COGS, gross profit, by seller / product / method; branch scoping; dashboard', async () => {
    const rep = await t.http().get(`${api}/sales/reports/summary`).set(s.auth).query({ from: new Date(Date.now() - 3600_000).toISOString() });
    expect(rep.status).toBe(200);
    if (!(rep.body.totals?.invoices > 0)) {
      // intermittent in full runs: dump what the DB holds so the next failure is explainable
      const dbCount = await t.prisma.raw.invoice.count({ where: { tenantId: s.tenantId, status: 'COMPLETED' } });
      const latest = await t.prisma.raw.invoice.findFirst({ where: { tenantId: s.tenantId }, orderBy: { createdAt: 'desc' }, select: { code: true, status: true, invoiceDate: true, branchId: true } });
      console.log('T-141 DIAG', JSON.stringify({ totals: rep.body.totals, from: rep.body.from, to: rep.body.to, dbCount, latest, now: new Date().toISOString() }));
    }
    expect(rep.body.totals.invoices).toBeGreaterThan(0);
    expect(Number(rep.body.totals.revenue)).toBeGreaterThan(0);
    expect(Number(rep.body.totals.grossProfit)).toBe(Number(rep.body.totals.revenue) - Number(rep.body.totals.cost));
    expect(rep.body.bySeller.length).toBeGreaterThan(0);
    expect(rep.body.byProduct.length).toBeGreaterThan(0);
    expect(rep.body.byMethod.some((m: any) => m.method === 'CASH')).toBe(true);
    const dash = await t.http().get(`${api}/dashboard/overview`).set(s.auth);
    expect(dash.body.salesToday.invoices).toBeGreaterThan(0);
    const roles = await t.http().get(`${api}/roles`).set(s.auth);
    const mgr = roles.body.find((r: any) => r.code === 'MANAGER');
    const br = await t.http().post(`${api}/branches`).set(s.auth).send({ code: 'CN-S', name: 'S' });
    await t.http().post(`${api}/users`).set(s.auth).send({ username: 'mgrS', password: 'Secret123', fullName: 'M', roleIds: [mgr.id], branchIds: [br.body.id] });
    const auth = { Authorization: `Bearer ${(await login(t, s.tenantCode, 'mgrS', 'Secret123')).body.accessToken}` };
    const scoped = await t.http().get(`${api}/sales/reports/summary`).set(auth).query({ from: new Date(Date.now() - 3600_000).toISOString() });
    expect(scoped.body.totals.invoices).toBe(0);
    expect((await t.http().get(`${api}/invoices`).set(auth)).body.meta.total).toBe(0);
    expect((await t.http().get(`${api}/sales/reports/summary`).set(auth).query({ branchId: s.branchId })).body.totals.invoices).toBe(0);
  });

  it('T-142 tenant isolation and validation on POS endpoints', async () => {
    const other = await registerTenant(t);
    const p = await stocked('5', '10', '1000');
    const cross = await t.http().post(`${api}/invoices/checkout`).set(other.auth).send({ branchId: other.branchId, warehouseId: other.warehouseId, customerId, lines: [{ variantId: p.variantId, quantity: '1' }] });
    expect(cross.status).toBe(404);
    expect((await t.http().get(`${api}/customers/${customerId}`).set(other.auth)).status).toBe(404);
    const bad = await checkout({ lines: [{ variantId: p.variantId, quantity: '0' }] });
    expect(bad.status).toBe(400);
    const badMethod = await checkout({ lines: [{ variantId: p.variantId, quantity: '1' }], payments: [{ method: 'GOLD', amount: '1' }] });
    expect(badMethod.status).toBe(400);
    const inactive = await createProduct(t, s, { allowSale: false, variants: [{ sellPrice: '1' }] });
    const notSellable = await checkout({ lines: [{ variantId: inactive.variantId, quantity: '1' }], payments: [{ method: 'CASH', amount: '1' }] });
    expect(notSellable.status).toBe(409);
    expect(notSellable.body.code).toBe('PRODUCT_NOT_SELLABLE');
    const price = await t.http().get(`${api}/invoices/price`).set(s.auth).query({ variantId: p.variantId, quantity: '2' });
    expect(price.body.listPrice).toBe('1000');
    expect(price.body.source).toBe('PRODUCT');
  });
});
