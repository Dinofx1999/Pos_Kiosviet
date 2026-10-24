import { randomUUID } from 'node:crypto';
import { balanceOf, createProduct, createTestApp, login, postReceipt, registerTenant, Session, TestApp } from './helpers';

const api = '/api/v1';

describe('Sales returns & exchanges (Module 07) – T-160..T-170', () => {
  let t: TestApp;
  let s: Session;
  let customerId: string;
  beforeAll(async () => {
    t = await createTestApp();
    s = await registerTenant(t);
    customerId = (await t.http().post(`${api}/customers`).set(s.auth).send({ name: 'KH Trả' })).body.id;
  });
  afterAll(async () => { await t.close(); });

  const stocked = async (qty = '20', cost = '1000', price = '5000', extra: Record<string, unknown> = {}) => {
    const p = await createProduct(t, s, { variants: [{ sellPrice: price, costPrice: cost }], ...extra });
    await postReceipt(t, s, [{ variantId: p.variantId, quantity: qty, unitCost: cost }]);
    return p;
  };
  const checkout = (body: Record<string, unknown>, auth = s.auth) => t.http().post(`${api}/invoices/checkout`).set(auth).send({ branchId: s.branchId, warehouseId: s.warehouseId, ...body });
  const custBalance = async (id = customerId) => (await t.http().get(`${api}/customers/${id}`).set(s.auth)).body.balance as string;

  it('T-160 walk-in cash sale returned in full: stock restocked at original cost, phiếu chi PC, invoice returnedAmount', async () => {
    const p = await stocked('10', '1000', '5000');
    const inv = await checkout({ lines: [{ variantId: p.variantId, quantity: '2' }], payments: [{ method: 'CASH', amount: '10000' }] });
    const line = inv.body.lines[0];
    // raise the average cost after the sale to prove the return comes back at the ORIGINAL cost
    await postReceipt(t, s, [{ variantId: p.variantId, quantity: '8', unitCost: '3000' }]);
    const returnable = await t.http().get(`${api}/sales-returns/returnable/${inv.body.id}`).set(s.auth);
    expect(returnable.body.lines[0].returnableQuantity).toBe('2');
    expect(returnable.body.lines[0].refundUnitPrice).toBe('5000');
    const res = await t.http().post(`${api}/sales-returns/complete-now`).set(s.auth).send({ invoiceId: inv.body.id, reason: 'Khách đổi ý', lines: [{ invoiceLineId: line.id, quantity: '2' }], refund: { method: 'CASH', amount: '10000' } });
    expect(res.status).toBe(201);
    expect(res.body.code).toBe('TH000001');
    expect(res.body.status).toBe('COMPLETED');
    expect(res.body.totalRefund).toBe('10000');
    expect(res.body.refundedAmount).toBe('10000');
    expect(res.body.refunds[0].payment.code).toMatch(/^PC\d{6}$/);
    expect(res.body.restockValue).toBe('2000'); // 2 × 1,000 original COGS
    const mv = await t.prisma.raw.stockMovement.findFirst({ where: { documentId: res.body.id, type: 'SALE_RETURN' } });
    expect(mv?.unitCost.toString()).toBe('1000');
    expect((await balanceOf(t, s, p.variantId)).onHand).toBe('18');
    const detail = await t.http().get(`${api}/invoices/${inv.body.id}`).set(s.auth);
    expect(detail.body.returnedAmount).toBe('10000');
    expect(detail.body.lines[0].returnedQuantity).toBe('2');
    expect(detail.body.returns[0].code).toBe('TH000001');
    // walk-in must be refunded in full
    const inv2 = await checkout({ lines: [{ variantId: p.variantId, quantity: '1' }], payments: [{ method: 'CASH', amount: '5000' }] });
    const partial = await t.http().post(`${api}/sales-returns/complete-now`).set(s.auth).send({ invoiceId: inv2.body.id, lines: [{ invoiceLineId: inv2.body.lines[0].id, quantity: '1' }], refund: { method: 'CASH', amount: '3000' } });
    expect(partial.status).toBe(400);
  });

  it('T-161 partial & repeated returns never exceed sold quantity or invoice value; cancelled invoice blocked while returns exist', async () => {
    const p = await stocked('10', '1000', '5000');
    const inv = await checkout({ customerId, lines: [{ variantId: p.variantId, quantity: '5' }], payments: [{ method: 'CASH', amount: '25000' }] });
    const line = inv.body.lines[0];
    const r1 = await t.http().post(`${api}/sales-returns/complete-now`).set(s.auth).send({ invoiceId: inv.body.id, lines: [{ invoiceLineId: line.id, quantity: '2' }] });
    expect(r1.status).toBe(201);
    const r2 = await t.http().post(`${api}/sales-returns/complete-now`).set(s.auth).send({ invoiceId: inv.body.id, lines: [{ invoiceLineId: line.id, quantity: '2' }] });
    expect(r2.status).toBe(201);
    const r3 = await t.http().post(`${api}/sales-returns/complete-now`).set(s.auth).send({ invoiceId: inv.body.id, lines: [{ invoiceLineId: line.id, quantity: '2' }] });
    expect(r3.status).toBe(409);
    expect(r3.body.code).toBe('RETURN_QUANTITY_EXCEEDED');
    expect((await t.http().get(`${api}/sales-returns/returnable/${inv.body.id}`).set(s.auth)).body.lines[0].returnableQuantity).toBe('1');
    const cancelInv = await t.http().post(`${api}/invoices/${inv.body.id}/cancel`).set(s.auth).send({ reason: 'x' });
    expect(cancelInv.status).toBe(409);
    expect(cancelInv.body.code).toBe('INVOICE_HAS_RETURNS');
    const concurrent = await Promise.all([1, 2, 3].map(() => t.http().post(`${api}/sales-returns/complete-now`).set(s.auth).send({ invoiceId: inv.body.id, lines: [{ invoiceLineId: line.id, quantity: '1' }] })));
    expect(concurrent.filter((x) => x.status === 201)).toHaveLength(1);
    expect(concurrent.every((x) => x.status < 500)).toBe(true);
  });

  it('T-162 customer credit: return without refund credits the ledger; refund later via phiếu chi; damaged goods do not restock', async () => {
    const p = await stocked('10', '1000', '5000');
    const before = await custBalance();
    const inv = await checkout({ customerId, lines: [{ variantId: p.variantId, quantity: '4' }], payments: [{ method: 'CASH', amount: '20000' }] });
    const res = await t.http().post(`${api}/sales-returns/complete-now`).set(s.auth).send({ invoiceId: inv.body.id, lines: [{ invoiceLineId: inv.body.lines[0].id, quantity: '2', condition: 'DAMAGED' }, { invoiceLineId: inv.body.lines[0].id, quantity: '1' }], feeAmount: '1000' });
    expect(res.status).toBe(201);
    expect(res.body.subtotal).toBe('15000');
    expect(res.body.totalRefund).toBe('14000');
    expect(res.body.refundedAmount).toBe('0');
    expect(res.body.damagedValue).toBe('2000');
    expect(res.body.restockValue).toBe('1000');
    expect((await balanceOf(t, s, p.variantId)).onHand).toBe('7'); // 10 − 4 + 1 restocked (damaged not restocked)
    expect(Number(await custBalance())).toBe(Number(before) - 14000); // customer has credit
    const ledger = await t.http().get(`${api}/customers/${customerId}/ledger`).set(s.auth);
    expect(ledger.body.data[0].type).toBe('SALE_RETURN');
    const refund = await t.http().post(`${api}/payments`).set(s.auth).send({ branchId: s.branchId, direction: 'OUT', partyType: 'CUSTOMER', partyId: customerId, amount: '14000', method: 'CASH', allocations: [{ documentType: 'SALES_RETURN', documentId: res.body.id, amount: '14000' }] });
    expect(refund.status).toBe(201);
    expect(Number(await custBalance())).toBe(Number(before));
    expect((await t.http().get(`${api}/sales-returns/${res.body.id}`).set(s.auth)).body.dueRefund).toBe('0');
    const over = await t.http().post(`${api}/payments`).set(s.auth).send({ branchId: s.branchId, direction: 'OUT', partyType: 'CUSTOMER', partyId: customerId, amount: '1', allocations: [{ documentType: 'SALES_RETURN', documentId: res.body.id, amount: '1' }] });
    expect(over.body.code).toBe('OVERPAYMENT');
    const history = await t.http().get(`${api}/customers/${customerId}/history`).set(s.auth);
    expect(history.body.returns[0].code).toBe(res.body.code);
  });

  it('T-163 refund price default = amount actually paid per unit (doc discount, tax); overpriced return rejected; price edit needs permission', async () => {
    const p = await stocked('10', '1000', '10000', { taxRate: '10' });
    const inv = await checkout({ customerId, lines: [{ variantId: p.variantId, quantity: '2', discountAmount: '2000' }], discountAmount: '3000', payments: [{ method: 'CASH', amount: '15000' }] });
    expect(inv.body.totalAmount).toBe('15000'); // 20,000 − 2,000 − 3,000 (tax included)
    const returnable = await t.http().get(`${api}/sales-returns/returnable/${inv.body.id}`).set(s.auth);
    expect(returnable.body.lines[0].refundUnitPrice).toBe('7500');
    const tooHigh = await t.http().post(`${api}/sales-returns/complete-now`).set(s.auth).send({ invoiceId: inv.body.id, lines: [{ invoiceLineId: inv.body.lines[0].id, quantity: '1', unitPrice: '10000' }] });
    expect(tooHigh.status).toBe(400);
    const roles = await t.http().get(`${api}/roles`).set(s.auth);
    const cashier = roles.body.find((r: any) => r.code === 'CASHIER');
    await t.http().post(`${api}/users`).set(s.auth).send({ username: 'ret1', password: 'Secret123', fullName: 'R', roleIds: [cashier.id], branchIds: [s.branchId] });
    const cAuth = { Authorization: `Bearer ${(await login(t, s.tenantCode, 'ret1', 'Secret123')).body.accessToken}` };
    const lower = await t.http().post(`${api}/sales-returns/complete-now`).set(cAuth).send({ invoiceId: inv.body.id, lines: [{ invoiceLineId: inv.body.lines[0].id, quantity: '1', unitPrice: '5000' }] });
    expect(lower.status).toBe(403);
    const ok = await t.http().post(`${api}/sales-returns/complete-now`).set(cAuth).send({ invoiceId: inv.body.id, lines: [{ invoiceLineId: inv.body.lines[0].id, quantity: '1' }] });
    expect(ok.status).toBe(201);
    expect(ok.body.lines[0].unitPrice).toBe('7500');
    expect(ok.body.restockValue).toBeUndefined(); // cost hidden for cashier
  });

  it('T-164 exchange: cheaper replacement → OFFSET vouchers + cash refund of the difference; dearer → customer pays extra', async () => {
    const a = await stocked('10', '1000', '5000');
    const b = await stocked('10', '2000', '8000');
    const inv = await checkout({ customerId, lines: [{ variantId: a.variantId, quantity: '2' }], payments: [{ method: 'CASH', amount: '10000' }] });
    const before = await custBalance();
    // return 2 × 5,000 = 10,000, buy 1 × 8,000 → refund 2,000
    const ex1 = await t.http().post(`${api}/sales-returns/exchange`).set(s.auth).send({ return: { invoiceId: inv.body.id, lines: [{ invoiceLineId: inv.body.lines[0].id, quantity: '2' }] }, newInvoice: { lines: [{ variantId: b.variantId, quantity: '1' }] }, refund: { method: 'CASH', amount: '2000' } });
    expect(ex1.status).toBe(201);
    expect(ex1.body.settlement.offset).toBe('8000');
    expect(ex1.body.settlement.refundDue).toBe('2000');
    expect(ex1.body.invoice.status).toBe('COMPLETED');
    expect(ex1.body.invoice.paidAmount).toBe('8000');
    expect(ex1.body.invoice.dueAmount).toBe('0');
    expect(ex1.body.return.refundedAmount).toBe('10000'); // 8,000 offset + 2,000 cash
    expect(ex1.body.return.exchangeInvoice.code).toBe(ex1.body.invoice.code);
    expect(ex1.body.invoice.payments.map((x: any) => x.payment.method).sort()).toEqual(['OFFSET']);
    expect(await custBalance()).toBe(before);
    expect((await balanceOf(t, s, a.variantId)).onHand).toBe('10');
    expect((await balanceOf(t, s, b.variantId)).onHand).toBe('9');
    // dearer replacement: return 1 × 8,000, buy 2 × 5,000 + 1 × 8,000 = 18,000 → pays 10,000 cash
    const ex2 = await t.http().post(`${api}/sales-returns/exchange`).set(s.auth).send({ return: { invoiceId: ex1.body.invoice.id, lines: [{ invoiceLineId: ex1.body.invoice.lines[0].id, quantity: '1' }] }, newInvoice: { lines: [{ variantId: a.variantId, quantity: '2' }, { variantId: b.variantId, quantity: '1' }] }, payments: [{ method: 'CASH', amount: '10000' }] });
    expect(ex2.status).toBe(201);
    expect(ex2.body.settlement.offset).toBe('8000');
    expect(ex2.body.settlement.customerPays).toBe('10000');
    expect(ex2.body.invoice.dueAmount).toBe('0');
    expect(await custBalance()).toBe(before);
    // paying too little on a dearer exchange books debt only with a customer; too much → OVERPAYMENT
    const over = await t.http().post(`${api}/sales-returns/exchange`).set(s.auth).send({ return: { invoiceId: ex2.body.invoice.id, lines: [{ invoiceLineId: ex2.body.invoice.lines[1].id, quantity: '1' }] }, newInvoice: { lines: [{ variantId: a.variantId, quantity: '1' }] }, payments: [{ method: 'CASH', amount: '1' }] });
    expect(over.status).toBe(409);
    expect(over.body.code).toBe('OVERPAYMENT');
    expect((await t.http().post(`${api}/payments/reconcile`).set(s.auth)).body.ok).toBe(true);
    expect((await t.http().post(`${api}/inventory/reconcile`).set(s.auth)).body.ok).toBe(true);
    // a cashier cannot use OFFSET through the public payments API
    const forged = await t.http().post(`${api}/payments`).set(s.auth).send({ branchId: s.branchId, direction: 'IN', partyType: 'CUSTOMER', partyId: customerId, amount: '1', method: 'OFFSET' });
    expect(forged.status).toBe(400);
  });

  it('T-165 cancel return: stock reversed, invoice reopened for returns, refund voucher cancelled; exchange-linked returns are protected', async () => {
    const p = await stocked('10', '1000', '5000');
    const inv = await checkout({ customerId, lines: [{ variantId: p.variantId, quantity: '3' }], payments: [{ method: 'CASH', amount: '15000' }] });
    const before = await custBalance();
    const ret = await t.http().post(`${api}/sales-returns/complete-now`).set(s.auth).send({ invoiceId: inv.body.id, lines: [{ invoiceLineId: inv.body.lines[0].id, quantity: '3' }], refund: { method: 'CASH', amount: '15000' } });
    expect((await balanceOf(t, s, p.variantId)).onHand).toBe('10');
    const cancel = await t.http().post(`${api}/sales-returns/${ret.body.id}/cancel`).set(s.auth).send({ reason: 'nhầm' });
    expect(cancel.status).toBe(200);
    expect(cancel.body.status).toBe('CANCELLED');
    expect((await balanceOf(t, s, p.variantId)).onHand).toBe('7');
    expect(await custBalance()).toBe(before);
    expect((await t.http().get(`${api}/sales-returns/returnable/${inv.body.id}`).set(s.auth)).body.lines[0].returnableQuantity).toBe('3');
    expect((await t.prisma.raw.payment.findFirst({ where: { allocations: { some: { documentType: 'SALES_RETURN', documentId: ret.body.id } } } }))?.status).toBe('CANCELLED');
    // exchange-linked
    const b = await stocked('5', '1000', '5000');
    const ex = await t.http().post(`${api}/sales-returns/exchange`).set(s.auth).send({ return: { invoiceId: inv.body.id, lines: [{ invoiceLineId: inv.body.lines[0].id, quantity: '1' }] }, newInvoice: { lines: [{ variantId: b.variantId, quantity: '1' }] } });
    expect(ex.status).toBe(201);
    const blocked = await t.http().post(`${api}/sales-returns/${ex.body.return.id}/cancel`).set(s.auth).send({ reason: 'x' });
    expect(blocked.status).toBe(409);
    expect(blocked.body.code).toBe('RETURN_LINKED_EXCHANGE');
    expect((await t.http().post(`${api}/invoices/${ex.body.invoice.id}/cancel`).set(s.auth).send({ reason: 'x' })).status).toBe(200);
    expect((await t.http().post(`${api}/sales-returns/${ex.body.return.id}/cancel`).set(s.auth).send({ reason: 'x' })).status).toBe(200);
    expect(await custBalance()).toBe(before);
    expect((await t.http().post(`${api}/payments/reconcile`).set(s.auth)).body.ok).toBe(true);
  });

  it('T-166 drafts, return window, shift attachment, idempotency, scoping', async () => {
    const p = await stocked('10', '1000', '5000');
    const open = await t.http().post(`${api}/shifts/open`).set(s.auth).send({ branchId: s.branchId, openingCash: '100000' });
    const inv = await checkout({ customerId, lines: [{ variantId: p.variantId, quantity: '2' }], payments: [{ method: 'CASH', amount: '10000' }] });
    const draft = await t.http().post(`${api}/sales-returns`).set(s.auth).send({ invoiceId: inv.body.id, lines: [{ invoiceLineId: inv.body.lines[0].id, quantity: '1' }] });
    expect(draft.status).toBe(201);
    expect(draft.body.status).toBe('DRAFT');
    expect((await balanceOf(t, s, p.variantId)).onHand).toBe('8');
    const upd = await t.http().patch(`${api}/sales-returns/${draft.body.id}`).set(s.auth).send({ version: 1, lines: [{ invoiceLineId: inv.body.lines[0].id, quantity: '2' }], feeAmount: '500' });
    expect(upd.body.totalRefund).toBe('9500');
    const key = randomUUID();
    const results = await Promise.all([1, 2].map(() => t.http().post(`${api}/sales-returns/${draft.body.id}/complete`).set(s.auth).set('Idempotency-Key', key).send({ version: 2, refund: { method: 'CASH', amount: '9500' } })));
    expect(results.filter((r) => r.status === 200 && r.headers['idempotent-replayed'] !== 'true')).toHaveLength(1);
    const cur = await t.http().get(`${api}/shifts/current`).set(s.auth).query({ branchId: s.branchId });
    expect(cur.body.expectedCash).toBe('100500'); // 100,000 + 10,000 − 9,500
    await t.http().post(`${api}/shifts/${open.body.id}/close`).set(s.auth).send({ countedCash: '100500' });
    await t.http().put(`${api}/settings`).set(s.auth).send({ settings: { 'sales.returnMaxDays': 1 } });
    await t.prisma.raw.invoice.update({ where: { id: inv.body.id }, data: { invoiceDate: new Date(Date.now() - 3 * 86400 * 1000) } });
    const late = await t.http().post(`${api}/sales-returns/complete-now`).set(s.auth).send({ invoiceId: inv.body.id, lines: [{ invoiceLineId: inv.body.lines[0].id, quantity: '1' }] });
    expect(late.status).toBe(409);
    expect(late.body.code).toBe('RETURN_WINDOW_EXPIRED');
    await t.http().put(`${api}/settings`).set(s.auth).send({ settings: { 'sales.returnMaxDays': 0 } });
    const other = await registerTenant(t);
    expect((await t.http().get(`${api}/sales-returns/returnable/${inv.body.id}`).set(other.auth)).status).toBe(404);
    const rep = await t.http().get(`${api}/sales/reports/summary`).set(s.auth).query({ from: new Date(Date.now() - 3600_000).toISOString() });
    expect(Number(rep.body.totals.returned)).toBeGreaterThan(0);
    expect(Number(rep.body.totals.netRevenue)).toBe(Number(rep.body.totals.revenue) - Number(rep.body.totals.returned));
  });

  // ---------------------------------------------------------------- review follow-ups (H1, H2, M1..M5, L1..L3)
  it('T-167 cancelling an exchange invoice re-opens the offset part of the refund; OFFSET vouchers cannot be cancelled by hand', async () => {
    const a = await stocked('10', '1000', '5000');
    const b = await stocked('10', '2000', '8000');
    const before = Number(await custBalance());
    const inv = await checkout({ customerId, lines: [{ variantId: a.variantId, quantity: '2' }], payments: [{ method: 'CASH', amount: '10000' }] });
    const ex = await t.http().post(`${api}/sales-returns/exchange`).set(s.auth).send({ return: { invoiceId: inv.body.id, lines: [{ invoiceLineId: inv.body.lines[0].id, quantity: '2' }] }, newInvoice: { lines: [{ variantId: b.variantId, quantity: '1' }] }, refund: { method: 'CASH', amount: '2000' } });
    expect(ex.status).toBe(201);
    expect(ex.body.settlement.offset).toBe('8000');
    expect(ex.body.return.refundedAmount).toBe('10000');
    expect(Number(await custBalance())).toBe(before);
    const offsetOut = ex.body.return.refunds.find((r: { payment: { method: string } }) => r.payment.method === 'OFFSET').payment;
    const manual = await t.http().post(`${api}/payments/${offsetOut.id}/cancel`).set(s.auth).send({ reason: 'thử' });
    expect(manual.status).toBe(409);
    expect(manual.body.code).toBe('PAYMENT_IS_OFFSET');
    const cancel = await t.http().post(`${api}/invoices/${ex.body.invoice.id}/cancel`).set(s.auth).send({ reason: 'khách trả lại hàng đổi' });
    expect(cancel.status).toBe(200);
    expect(Number(await custBalance())).toBe(before - 8000); // store owes the customer the offset part again
    const ret = await t.http().get(`${api}/sales-returns/${ex.body.return.id}`).set(s.auth);
    expect(ret.body.refundedAmount).toBe('2000');
    expect(ret.body.dueRefund).toBe('8000');
    expect((await t.http().get(`${api}/payments/${offsetOut.id}`).set(s.auth)).body.status).toBe('CANCELLED');
    expect((await t.http().post(`${api}/payments/reconcile`).set(s.auth)).status).toBe(200);
    expect((await balanceOf(t, s, b.variantId)).onHand).toBe('10');
    // the return itself can now be undone too, which restores everything
    const undo = await t.http().post(`${api}/sales-returns/${ex.body.return.id}/cancel`).set(s.auth).send({ reason: 'hủy cả giao dịch' });
    expect(undo.status).toBe(200);
    expect(Number(await custBalance())).toBe(before);
    expect((await balanceOf(t, s, a.variantId)).onHand).toBe('8');
  });

  it('T-168 walk-in exchange must settle the exact difference; malformed exchange bodies are 400; cashiers see no COGS; zero quantity rejected', async () => {
    const a = await stocked('10', '1000', '5000');
    const b = await stocked('10', '2000', '8000');
    const sell = async () => (await checkout({ lines: [{ variantId: a.variantId, quantity: '2' }], payments: [{ method: 'CASH', amount: '10000' }] })).body;
    const body = (inv: { id: string; lines: { id: string }[] }, extra: Record<string, unknown> = {}) => ({ return: { invoiceId: inv.id, lines: [{ invoiceLineId: inv.lines[0].id, quantity: '2' }] }, newInvoice: { lines: [{ variantId: b.variantId, quantity: '1' }] }, ...extra });
    const inv = await sell();
    expect((await t.http().post(`${api}/sales-returns/exchange`).set(s.auth).send(body(inv))).status).toBe(400);
    expect((await t.http().post(`${api}/sales-returns/exchange`).set(s.auth).send(body(inv, { refund: { method: 'CASH', amount: '1000' } }))).status).toBe(400);
    const ok = await t.http().post(`${api}/sales-returns/exchange`).set(s.auth).send(body(inv, { refund: { method: 'CASH', amount: '2000' } }));
    expect(ok.status).toBe(201);
    expect(ok.body.invoice.paidAmount).toBe('8000');
    expect(ok.body.settlement.refundDue).toBe('2000');
    expect(ok.body.return.dueRefund).toBe('0');
    // dearer replacement without enough payment: a walk-in cannot owe
    const inv2 = await sell();
    const short = await t.http().post(`${api}/sales-returns/exchange`).set(s.auth).send({ return: { invoiceId: inv2.id, lines: [{ invoiceLineId: inv2.lines[0].id, quantity: '2' }] }, newInvoice: { lines: [{ variantId: b.variantId, quantity: '3' }] }, payments: [{ method: 'CASH', amount: '9000' }] });
    expect(short.status).toBe(400);
    expect((await balanceOf(t, s, b.variantId)).onHand).toBe('9'); // rolled back
    // malformed bodies never 500
    for (const bad of [{}, { return: { invoiceId: inv2.id, lines: [{ invoiceLineId: inv2.lines[0].id, quantity: '1' }] } }, { newInvoice: { lines: [] } }]) {
      const res = await t.http().post(`${api}/sales-returns/exchange`).set(s.auth).send(bad);
      expect(res.status).toBe(400);
    }
    expect((await t.http().post(`${api}/sales-returns`).set(s.auth).send({ invoiceId: inv2.id, lines: [{ invoiceLineId: inv2.lines[0].id, quantity: '0.0004' }] })).status).toBe(400);
    // cashier list: no cost fields
    const roles = (await t.http().get(`${api}/roles`).set(s.auth)).body;
    const cashier = roles.find((r: { code: string }) => r.code === 'CASHIER');
    await t.http().post(`${api}/users`).set(s.auth).send({ username: 'tn2', password: 'Secret123', fullName: 'Thu ngân 2', roleIds: [cashier.id], branchIds: [s.branchId] });
    const login = await t.http().post(`${api}/auth/login`).send({ tenantCode: s.tenantCode, username: 'tn2', password: 'Secret123' });
    const list = await t.http().get(`${api}/sales-returns`).set({ Authorization: `Bearer ${login.body.accessToken}` });
    expect(list.status).toBe(200);
    expect(list.body.data.length).toBeGreaterThan(0);
    expect(list.body.data.every((r: Record<string, unknown>) => r.restockValue === undefined && r.damagedValue === undefined)).toBe(true);
    const admin = await t.http().get(`${api}/sales-returns`).set(s.auth);
    expect(admin.body.data.some((r: Record<string, unknown>) => r.restockValue !== undefined)).toBe(true);
  });

  it('T-169 refund prices round down and the last unit trues the line up: a full return always refunds exactly what was paid', async () => {
    const p = await stocked('20', '1000', '10000');
    const inv = await checkout({ customerId, lines: [{ variantId: p.variantId, quantity: '3', discountAmount: '1000' }], payments: [{ method: 'CASH', amount: '29000' }] });
    expect(inv.body.totalAmount).toBe('29000');
    const returnable = await t.http().get(`${api}/sales-returns/returnable/${inv.body.id}`).set(s.auth);
    expect(returnable.body.lines[0].refundUnitPrice).toBe('9666.6666');
    const full = await t.http().post(`${api}/sales-returns/complete-now`).set(s.auth).send({ invoiceId: inv.body.id, lines: [{ invoiceLineId: inv.body.lines[0].id, quantity: '3' }] });
    expect(full.status).toBe(201);
    expect(full.body.totalRefund).toBe('29000');
    // partial returns in several steps add up to the invoice total, also with document discount and tax-excluded pricing
    await t.http().put(`${api}/settings`).set(s.auth).send({ settings: { 'pricing.priceIncludesTax': false } });
    const q = await createProduct(t, s, { taxRate: '10', variants: [{ sellPrice: '10000', costPrice: '1000' }] });
    await postReceipt(t, s, [{ variantId: q.variantId, quantity: '20', unitCost: '1000' }]);
    const inv2 = await checkout({ customerId, discountAmount: '3000', lines: [{ variantId: q.variantId, quantity: '3' }, { variantId: p.variantId, quantity: '1' }], payments: [] });
    expect(inv2.status).toBe(201);
    const l0 = inv2.body.lines[0].id; const l1 = inv2.body.lines[1].id;
    const r1 = await t.http().post(`${api}/sales-returns/complete-now`).set(s.auth).send({ invoiceId: inv2.body.id, lines: [{ invoiceLineId: l0, quantity: '1' }] });
    const r2 = await t.http().post(`${api}/sales-returns/complete-now`).set(s.auth).send({ invoiceId: inv2.body.id, lines: [{ invoiceLineId: l0, quantity: '2' }, { invoiceLineId: l1, quantity: '1' }] });
    await t.http().put(`${api}/settings`).set(s.auth).send({ settings: { 'pricing.priceIncludesTax': true } });
    expect(r1.status).toBe(201);
    expect(r2.status).toBe(201);
    expect(Number(r1.body.totalRefund) + Number(r2.body.totalRefund)).toBe(Number(inv2.body.totalAmount));
    expect((await t.http().get(`${api}/invoices/${inv2.body.id}`).set(s.auth)).body.returnedAmount).toBe(inv2.body.totalAmount);
  });

  it('T-178 partial restocks of combo components and converted units telescope to the exact sold quantity', async () => {
    const comp = await stocked('10', '4000', '8000');
    const combo = await t.http().post(`${api}/products`).set(s.auth).send({ name: 'Combo lẻ', type: 'COMBO', variants: [{ sellPrice: '15000' }], comboItems: [{ componentVariantId: comp.variantId, quantity: '0.125' }] });
    expect(combo.status).toBe(201);
    const sale = await checkout({ customerId, lines: [{ variantId: combo.body.variants[0].id, quantity: '1' }], payments: [{ method: 'CASH', amount: '15000' }] });
    expect(sale.status).toBe(201);
    expect((await balanceOf(t, s, comp.variantId)).onHand).toBe('9.875');
    for (const qty of ['0.5', '0.5']) expect((await t.http().post(`${api}/sales-returns/complete-now`).set(s.auth).send({ invoiceId: sale.body.id, lines: [{ invoiceLineId: sale.body.lines[0].id, quantity: qty }] })).status).toBe(201);
    expect((await balanceOf(t, s, comp.variantId)).onHand).toBe('10');
    // selling unit ×12, returned in thirds
    const u = await createProduct(t, s, { variants: [{ sellPrice: '1000', costPrice: '500' }], units: [{ unitName: 'Thùng', conversionFactor: '12', sellPrice: '11000' }] });
    await postReceipt(t, s, [{ variantId: u.variantId, quantity: '24', unitCost: '500' }]);
    const unit = (await t.http().get(`${api}/products/${u.productId}`).set(s.auth)).body.units[0];
    const sale2 = await checkout({ customerId, lines: [{ variantId: u.variantId, quantity: '1', productUnitId: unit.id }], payments: [{ method: 'CASH', amount: '11000' }] });
    expect(sale2.status).toBe(201);
    expect((await balanceOf(t, s, u.variantId)).onHand).toBe('12');
    for (const qty of ['0.333', '0.333', '0.334']) expect((await t.http().post(`${api}/sales-returns/complete-now`).set(s.auth).send({ invoiceId: sale2.body.id, lines: [{ invoiceLineId: sale2.body.lines[0].id, quantity: qty }] })).status).toBe(201);
    expect((await balanceOf(t, s, u.variantId)).onHand).toBe('24');
    expect((await t.http().get(`${api}/invoices/${sale2.body.id}`).set(s.auth)).body.returnedAmount).toBe('11000');
  });

  it('T-179 with pos.requireOpenShift a cash refund or an exchange needs an open shift; a credit-only return does not', async () => {
    const p = await stocked('10', '1000', '5000');
    const inv = await checkout({ customerId, lines: [{ variantId: p.variantId, quantity: '3' }], payments: [{ method: 'CASH', amount: '15000' }] });
    await t.http().put(`${api}/settings`).set(s.auth).send({ settings: { 'pos.requireOpenShift': true } });
    try {
      const refund = await t.http().post(`${api}/sales-returns/complete-now`).set(s.auth).send({ invoiceId: inv.body.id, lines: [{ invoiceLineId: inv.body.lines[0].id, quantity: '1' }], refund: { method: 'CASH', amount: '5000' } });
      expect(refund.status).toBe(409);
      expect(refund.body.code).toBe('SHIFT_REQUIRED');
      const ex = await t.http().post(`${api}/sales-returns/exchange`).set(s.auth).send({ return: { invoiceId: inv.body.id, lines: [{ invoiceLineId: inv.body.lines[0].id, quantity: '1' }] }, newInvoice: { lines: [{ variantId: p.variantId, quantity: '1' }] } });
      expect(ex.status).toBe(409);
      const credit = await t.http().post(`${api}/sales-returns/complete-now`).set(s.auth).send({ invoiceId: inv.body.id, lines: [{ invoiceLineId: inv.body.lines[0].id, quantity: '1' }] });
      expect(credit.status).toBe(201);
      const open = await t.http().post(`${api}/shifts/open`).set(s.auth).send({ branchId: s.branchId, openingCash: '100000' });
      expect(open.status).toBe(201);
      const ok = await t.http().post(`${api}/sales-returns/complete-now`).set(s.auth).send({ invoiceId: inv.body.id, lines: [{ invoiceLineId: inv.body.lines[0].id, quantity: '1' }], refund: { method: 'CASH', amount: '5000' } });
      expect(ok.status).toBe(201);
      expect(ok.body.shiftId).toBe(open.body.id);
      const close = await t.http().post(`${api}/shifts/${open.body.id}/close`).set(s.auth).send({ countedCash: '95000' });
      expect(close.body.expectedCash).toBe('95000');
    } finally {
      await t.http().put(`${api}/settings`).set(s.auth).send({ settings: { 'pos.requireOpenShift': false } });
    }
  });

  it('T-180 exchange, debt payment and draft-return completion on the same invoice run concurrently without deadlocks', async () => {
    const a = await stocked('100', '1000', '5000');
    const b = await stocked('100', '2000', '8000');
    for (let round = 0; round < 3; round++) {
      const inv = await checkout({ customerId, lines: [{ variantId: a.variantId, quantity: '5' }, { variantId: a.variantId, quantity: '5' }], payments: [] });
      expect(inv.status).toBe(201);
      const draft = await t.http().post(`${api}/sales-returns`).set(s.auth).send({ invoiceId: inv.body.id, lines: [{ invoiceLineId: inv.body.lines[1].id, quantity: '1' }] });
      expect(draft.status).toBe(201);
      const results = await Promise.all([
        t.http().post(`${api}/sales-returns/exchange`).set(s.auth).send({ return: { invoiceId: inv.body.id, lines: [{ invoiceLineId: inv.body.lines[0].id, quantity: '1' }] }, newInvoice: { lines: [{ variantId: b.variantId, quantity: '1' }] }, payments: [{ method: 'CASH', amount: '3000' }] }),
        t.http().post(`${api}/payments`).set(s.auth).send({ branchId: s.branchId, direction: 'IN', method: 'CASH', partyType: 'CUSTOMER', partyId: customerId, amount: '5000', allocations: [{ documentType: 'INVOICE', documentId: inv.body.id, amount: '5000' }] }),
        t.http().post(`${api}/sales-returns/${draft.body.id}/complete`).set(s.auth).send({ refund: { method: 'CASH', amount: '5000' } }),
        t.http().post(`${api}/payments`).set(s.auth).send({ branchId: s.branchId, direction: 'IN', method: 'CASH', partyType: 'CUSTOMER', partyId: customerId, amount: '2000', allocations: [{ documentType: 'INVOICE', documentId: inv.body.id, amount: '2000' }] }),
      ]);
      for (const r of results) {
        expect(r.status).toBeLessThan(500);
        expect(r.body.code).not.toBe('TRANSACTION_CONFLICT');
        expect(r.status).toBeLessThan(400);
      }
    }
    expect((await t.http().post(`${api}/payments/reconcile`).set(s.auth)).status).toBe(200);
  });
});
