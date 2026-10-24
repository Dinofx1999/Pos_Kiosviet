import { randomUUID } from 'node:crypto';
import { balanceOf, createProduct, createTestApp, login, postReceipt, registerTenant, Session, TestApp } from './helpers';

const api = '/api/v1';

/** Regression tests for the Module 05 review findings (T-150..T-156). */
describe('POS hardening', () => {
  let t: TestApp;
  let s: Session;
  let customerId: string;
  beforeAll(async () => {
    t = await createTestApp();
    s = await registerTenant(t);
    customerId = (await t.http().post(`${api}/customers`).set(s.auth).send({ name: 'KH H' })).body.id;
  });
  afterAll(async () => { await t.close(); });

  const stocked = async (qty = '20', cost = '1000', price = '5000', extra: Record<string, unknown> = {}) => {
    const p = await createProduct(t, s, { variants: [{ sellPrice: price, costPrice: cost }], ...extra });
    await postReceipt(t, s, [{ variantId: p.variantId, quantity: qty, unitCost: cost }]);
    return p;
  };
  const checkout = (body: Record<string, unknown>, auth = s.auth, headers: Record<string, string> = {}) =>
    t.http().post(`${api}/invoices/checkout`).set(auth).set(headers).send({ branchId: s.branchId, warehouseId: s.warehouseId, ...body });
  const custBalance = async (id = customerId) => (await t.http().get(`${api}/customers/${id}`).set(s.auth)).body.balance as string;

  it('T-150 (H1) cancelling an invoice whose voucher carries a prepayment is refused; the prepayment survives', async () => {
    const p = await stocked();
    const inv = await checkout({ customerId, lines: [{ variantId: p.variantId, quantity: '2' }], payments: [] }); // 10,000 on credit
    expect(inv.status).toBe(201);
    const before = await custBalance();
    const pay = await t.http().post(`${api}/payments`).set(s.auth).send({ branchId: s.branchId, direction: 'IN', partyType: 'CUSTOMER', partyId: customerId, amount: '15000', allocations: [{ documentType: 'INVOICE', documentId: inv.body.id, amount: '10000' }] });
    expect(pay.status).toBe(201);
    expect(Number(await custBalance())).toBe(Number(before) - 15000);
    const cancel = await t.http().post(`${api}/invoices/${inv.body.id}/cancel`).set(s.auth).send({ reason: 'x' });
    expect(cancel.status).toBe(409);
    expect(cancel.body.code).toBe('PAYMENT_SHARED');
    expect((await balanceOf(t, s, p.variantId)).onHand).toBe('18'); // nothing reversed
    expect(Number(await custBalance())).toBe(Number(before) - 15000);
    // cancel the voucher manually, then the invoice can be cancelled
    expect((await t.http().post(`${api}/payments/${pay.body.id}/cancel`).set(s.auth).send({ reason: 'x' })).status).toBe(200);
    expect((await t.http().post(`${api}/invoices/${inv.body.id}/cancel`).set(s.auth).send({ reason: 'x' })).status).toBe(200);
    expect(await custBalance()).toBe(String(Number(before) - 10000));
    expect((await t.http().post(`${api}/payments/reconcile`).set(s.auth)).body.ok).toBe(true);
  });

  it('T-151 (H2) cancel vs checkout on the same customer and variants never yields 500', async () => {
    const a = await stocked('200');
    const b = await stocked('200');
    const statuses: number[] = [];
    for (let round = 0; round < 4; round++) {
      const x = await checkout({ customerId, lines: [{ variantId: a.variantId, quantity: '1' }, { variantId: b.variantId, quantity: '1' }], payments: [{ method: 'CASH', amount: '10000' }] });
      expect(x.status).toBe(201);
      const results = await Promise.all([
        t.http().post(`${api}/invoices/${x.body.id}/cancel`).set(s.auth).send({ reason: 'stress' }),
        checkout({ customerId, lines: [{ variantId: b.variantId, quantity: '1' }, { variantId: a.variantId, quantity: '1' }], payments: [{ method: 'CASH', amount: '10000' }] }),
        checkout({ customerId, lines: [{ variantId: a.variantId, quantity: '1' }], payments: [] }),
        t.http().post(`${api}/payments`).set(s.auth).send({ branchId: s.branchId, direction: 'IN', partyType: 'CUSTOMER', partyId: customerId, amount: '1000' }),
      ]);
      for (const r of results) if (r.status >= 500) console.log('T-151 5xx', JSON.stringify(r.body));
      statuses.push(...results.map((r) => r.status));
    }
    expect(statuses.every((st) => st < 500)).toBe(true);
    expect((await t.http().post(`${api}/payments/reconcile`).set(s.auth)).body.ok).toBe(true);
    expect((await t.http().post(`${api}/inventory/reconcile`).set(s.auth)).body.ok).toBe(true);
  });

  it('T-152 (H3) shift cash includes counter vouchers; closing races with checkouts stay consistent', async () => {
    const p = await stocked('100');
    const open = await t.http().post(`${api}/shifts/open`).set(s.auth).send({ branchId: s.branchId, openingCash: '100000' });
    expect(open.status).toBe(201);
    const debtInv = await checkout({ customerId, lines: [{ variantId: p.variantId, quantity: '1' }], payments: [] });
    const collect = await t.http().post(`${api}/payments`).set(s.auth).send({ branchId: s.branchId, direction: 'IN', method: 'CASH', partyType: 'CUSTOMER', partyId: customerId, amount: '5000', allocations: [{ documentType: 'INVOICE', documentId: debtInv.body.id, amount: '5000' }] });
    expect(collect.body.shiftId).toBe(open.body.id);
    const refund = await t.http().post(`${api}/payments`).set(s.auth).send({ branchId: s.branchId, direction: 'OUT', method: 'CASH', partyType: 'CUSTOMER', partyId: customerId, amount: '2000' });
    expect(refund.body.shiftId).toBe(open.body.id);
    const cur = await t.http().get(`${api}/shifts/current`).set(s.auth).query({ branchId: s.branchId });
    expect(cur.body.expectedCash).toBe('103000'); // 100,000 + 5,000 − 2,000
    // close while checkouts are in flight
    const results = await Promise.all([
      t.http().post(`${api}/shifts/${open.body.id}/close`).set(s.auth).send({ countedCash: '103000' }),
      ...Array.from({ length: 5 }, () => checkout({ lines: [{ variantId: p.variantId, quantity: '1' }], payments: [{ method: 'CASH', amount: '5000' }] })),
    ]);
    expect(results.every((r) => r.status < 500)).toBe(true);
    const closed = await t.prisma.raw.shift.findUniqueOrThrow({ where: { id: open.body.id } });
    const cash = await t.prisma.raw.payment.findMany({ where: { shiftId: open.body.id, status: 'POSTED', method: 'CASH' } });
    const sum = cash.reduce((acc, c) => acc + (c.direction === 'IN' ? 1 : -1) * Number(c.amount), 0);
    expect(Number(closed.expectedCash)).toBe(100000 + sum); // stored expectation == what the shift actually holds
    expect(closed.status).toBe('CLOSED');
  });

  it('T-153 (M2) combos with service or batch-tracked components are rejected up front', async () => {
    const svc = await createProduct(t, s, { type: 'SERVICE', variants: [{ sellPrice: '1' }] });
    const badCombo = await t.http().post(`${api}/products`).set(s.auth).send({ name: 'Combo DV', type: 'COMBO', variants: [{ sellPrice: '1' }], comboItems: [{ componentVariantId: svc.variantId, quantity: '1' }] });
    expect(badCombo.status).toBe(400);
    const batched = await createProduct(t, s, { trackBatch: true, variants: [{ sellPrice: '1' }] });
    const badCombo2 = await t.http().post(`${api}/products`).set(s.auth).send({ name: 'Combo lô', type: 'COMBO', variants: [{ sellPrice: '1' }], comboItems: [{ componentVariantId: batched.variantId, quantity: '1' }] });
    expect(badCombo2.status).toBe(400);
    // a component deactivated after the combo was created is caught at the line level
    const comp = await stocked('10');
    const combo = await t.http().post(`${api}/products`).set(s.auth).send({ name: 'Combo OK', type: 'COMBO', variants: [{ sellPrice: '2' }], comboItems: [{ componentVariantId: comp.variantId, quantity: '1' }] });
    expect(combo.status).toBe(201);
    await t.http().post(`${api}/products/${comp.productId}/deactivate`).set(s.auth);
    const sale = await checkout({ lines: [{ variantId: combo.body.variants[0].id, quantity: '1' }], payments: [{ method: 'CASH', amount: '2' }] });
    expect(sale.status).toBe(409);
    expect(sale.body.code).toBe('PRODUCT_NOT_SELLABLE');
    expect(sale.body.message).toContain('Dòng 1');
  });

  it('T-154 (M1/M4/M5/M7) draft lifecycle: version on complete, cashier edits a manager-priced draft, bad ids → 400, shift visibility', async () => {
    const roles = await t.http().get(`${api}/roles`).set(s.auth);
    const cashier = roles.body.find((r: any) => r.code === 'CASHIER');
    await t.http().post(`${api}/users`).set(s.auth).send({ username: 'pos2', password: 'Secret123', fullName: 'C', roleIds: [cashier.id], branchIds: [s.branchId] });
    const cAuth = { Authorization: `Bearer ${(await login(t, s.tenantCode, 'pos2', 'Secret123')).body.accessToken}` };
    const p = await stocked('50', '1000', '5000');
    // manager-priced draft (4,000 instead of 5,000)
    const draft = await t.http().post(`${api}/invoices`).set(s.auth).send({ branchId: s.branchId, warehouseId: s.warehouseId, lines: [{ variantId: p.variantId, quantity: '3', unitPrice: '4000' }] });
    expect(draft.status).toBe(201);
    const noteOnly = await t.http().patch(`${api}/invoices/${draft.body.id}`).set(cAuth).send({ version: 1, note: 'khách quen' });
    expect(noteOnly.status).toBe(200);
    expect(noteOnly.body.lines[0].unitPrice).toBe('4000');
    const resend = await t.http().patch(`${api}/invoices/${draft.body.id}`).set(cAuth).send({ version: 2, lines: [{ variantId: p.variantId, quantity: '5', unitPrice: '4000' }] });
    expect(resend.status).toBe(200); // same price as stored → not a price edit
    const lower = await t.http().patch(`${api}/invoices/${draft.body.id}`).set(cAuth).send({ version: 3, lines: [{ variantId: p.variantId, quantity: '5', unitPrice: '3000' }] });
    expect(lower.status).toBe(403);
    // stale version on complete
    const stale = await t.http().post(`${api}/invoices/${draft.body.id}/complete`).set(s.auth).send({ version: 1, payments: [{ method: 'CASH', amount: '20000' }] });
    expect(stale.status).toBe(409);
    expect(stale.body.code).toBe('VERSION_CONFLICT');
    const ok = await t.http().post(`${api}/invoices/${draft.body.id}/complete`).set(s.auth).send({ version: 3, payments: [{ method: 'CASH', amount: '20000' }] });
    expect(ok.status).toBe(200);
    // validation → 400 not 500
    const d2 = (await t.http().post(`${api}/invoices`).set(s.auth).send({ branchId: s.branchId, warehouseId: s.warehouseId, lines: [{ variantId: p.variantId, quantity: '1' }] })).body;
    expect((await t.http().patch(`${api}/invoices/${d2.id}`).set(s.auth).send({ version: 1, customerId: 'abc' })).status).toBe(400);
    expect((await checkout({ lines: [{ variantId: p.variantId, quantity: '1', unitPrice: '100000000000000' }] })).status).toBe(400);
    expect((await t.http().post(`${api}/invoices`).set(s.auth).send({ branchId: s.branchId, warehouseId: s.warehouseId, lines: [{ variantId: p.variantId, quantity: '1' }], payments: [{ method: 'CASH', amount: '1' }] })).status).toBe(400);
    // shifts: cashier cannot see others' shifts even with a userId filter
    const mine = await t.http().post(`${api}/shifts/open`).set(s.auth).send({ branchId: s.branchId, openingCash: '1' });
    const peek = await t.http().get(`${api}/shifts`).set(cAuth).query({ userId: s.userId });
    expect(peek.body.data.every((x: any) => x.userId !== s.userId)).toBe(true);
    expect((await t.http().get(`${api}/shifts/${mine.body.id}`).set(cAuth)).status).toBe(403);
    await t.http().post(`${api}/shifts/${mine.body.id}/close`).set(s.auth).send({ countedCash: '1' });
  });

  it('T-155 (M3) discount ceiling and price-book permission', async () => {
    const p = await stocked('50', '1000', '10000');
    await t.http().put(`${api}/settings`).set(s.auth).send({ settings: { 'pos.maxDiscountPercent': 20 } });
    const tooMuch = await checkout({ lines: [{ variantId: p.variantId, quantity: '1', discountAmount: '3000' }], payments: [{ method: 'CASH', amount: '7000' }] });
    expect(tooMuch.status).toBe(409);
    expect(tooMuch.body.code).toBe('DISCOUNT_LIMIT_EXCEEDED');
    const docTooMuch = await checkout({ lines: [{ variantId: p.variantId, quantity: '1' }], discountAmount: '2500', payments: [{ method: 'CASH', amount: '7500' }] });
    expect(docTooMuch.status).toBe(409);
    const fine = await checkout({ lines: [{ variantId: p.variantId, quantity: '1', discountAmount: '2000' }], payments: [{ method: 'CASH', amount: '8000' }] });
    expect(fine.status).toBe(201);
    await t.http().put(`${api}/settings`).set(s.auth).send({ settings: { 'pos.maxDiscountPercent': 100 } });
    // price-book selection is gated by invoice.pricebook.select
    const roles = await t.http().get(`${api}/roles`).set(s.auth);
    const limited = await t.http().post(`${api}/roles`).set(s.auth).send({ code: 'POS_NOPB', name: 'POS no PB', permissions: ['product.view', 'invoice.view', 'invoice.create', 'invoice.complete'] });
    await t.http().post(`${api}/users`).set(s.auth).send({ username: 'nopb', password: 'Secret123', fullName: 'N', roleIds: [limited.body.id], branchIds: [s.branchId] });
    const auth = { Authorization: `Bearer ${(await login(t, s.tenantCode, 'nopb', 'Secret123')).body.accessToken}` };
    const pb = await t.http().post(`${api}/price-books`).set(s.auth).send({ code: 'WS', name: 'Sỉ' });
    await t.http().put(`${api}/price-books/${pb.body.id}/items`).set(s.auth).send({ items: [{ variantId: p.variantId, price: '1' }] });
    const denied = await checkout({ priceBookId: pb.body.id, lines: [{ variantId: p.variantId, quantity: '1' }], payments: [{ method: 'CASH', amount: '1' }] }, auth);
    expect(denied.status).toBe(403);
    void roles;
    const allowed = await checkout({ priceBookId: pb.body.id, lines: [{ variantId: p.variantId, quantity: '1' }], payments: [{ method: 'CASH', amount: '1' }] });
    expect(allowed.status).toBe(201);
    expect(allowed.body.lines[0].listPrice).toBe('1');
  });

  it('T-156 idempotent cancel and transaction-conflict mapping', async () => {
    const p = await stocked('5');
    const inv = await checkout({ lines: [{ variantId: p.variantId, quantity: '1' }], payments: [{ method: 'CASH', amount: '5000' }] });
    const key = randomUUID();
    const results = await Promise.all(Array.from({ length: 3 }, () => t.http().post(`${api}/invoices/${inv.body.id}/cancel`).set(s.auth).set('Idempotency-Key', key).send({ reason: 'dup' })));
    expect(results.filter((r) => r.status === 200).length).toBeGreaterThanOrEqual(1);
    expect(results.every((r) => r.status < 500)).toBe(true);
    expect(await t.prisma.raw.stockMovement.count({ where: { documentId: inv.body.id, type: 'REVERSAL' } })).toBe(1);
  });
});
