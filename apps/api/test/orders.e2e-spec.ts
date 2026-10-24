import { balanceOf, createProduct, createTestApp, postReceipt, registerTenant, Session, TestApp } from './helpers';

const api = '/api/v1';

describe('Sales orders & deliveries (Module 06) – T-200..T-206', () => {
  let t: TestApp;
  let s: Session;
  let customerId: string;
  beforeAll(async () => {
    t = await createTestApp();
    s = await registerTenant(t);
    customerId = (await t.http().post(`${api}/customers`).set(s.auth).send({ name: 'Khách đặt hàng', phone: '0912345678', address: '12 Lê Lợi' })).body.id;
  });
  afterAll(async () => { await t.close(); });

  const stocked = async (qty = '10', cost = '1000', price = '50000') => {
    const p = await createProduct(t, s, { variants: [{ sellPrice: price, costPrice: cost }] });
    await postReceipt(t, s, [{ variantId: p.variantId, quantity: qty, unitCost: cost }]);
    return p;
  };
  const order = (body: Record<string, unknown>) => t.http().post(`${api}/orders`).set(s.auth).send({ branchId: s.branchId, warehouseId: s.warehouseId, ...body });
  const checkout = (body: Record<string, unknown>) => t.http().post(`${api}/invoices/checkout`).set(s.auth).send({ branchId: s.branchId, warehouseId: s.warehouseId, ...body });
  const custBalance = async () => (await t.http().get(`${api}/customers/${customerId}`).set(s.auth)).body.balance as string;

  it('T-200 order lifecycle: confirm reserves stock (POS cannot sell it), deposit, complete → invoice with deposit applied, reservations consumed', async () => {
    const p = await stocked('5');
    const before = Number(await custBalance());
    const o = await order({ customerId, source: 'PHONE', lines: [{ variantId: p.variantId, quantity: '3' }], deposits: [{ method: 'CASH', amount: '50000' }], note: 'giao chiều' });
    expect(o.status).toBe(201);
    expect(o.body.code).toBe('DH000001');
    expect(o.body.status).toBe('CONFIRMED');
    expect(o.body.totalAmount).toBe('150000');
    expect(o.body.depositAmount).toBe('50000');
    expect(o.body.dueAmount).toBe('100000');
    expect(o.body.deposits[0].payment.code).toMatch(/^PT\d{6}$/);
    expect(o.body.reservations).toHaveLength(1);
    const bal = await balanceOf(t, s, p.variantId);
    expect(bal.onHand).toBe('5');
    expect(bal.reserved).toBe('3');
    // the deposit is a receipt on the customer account (credit until the sale)
    expect(Number(await custBalance())).toBe(before - 50000);
    // POS cannot sell the reserved units
    const sell = await checkout({ lines: [{ variantId: p.variantId, quantity: '3' }], payments: [{ method: 'CASH', amount: '150000' }] });
    expect(sell.status).toBe(409);
    expect(sell.body.code).toBe('INSUFFICIENT_STOCK');
    expect((await checkout({ lines: [{ variantId: p.variantId, quantity: '2' }], payments: [{ method: 'CASH', amount: '100000' }] })).status).toBe(201);
    // second deposit over the due → OVERPAYMENT
    expect((await t.http().post(`${api}/orders/${o.body.id}/deposit`).set(s.auth).send({ method: 'CASH', amount: '200000' })).status).toBe(409);
    const done = await t.http().post(`${api}/orders/${o.body.id}/complete`).set(s.auth).send({ payments: [{ method: 'CASH', amount: '100000' }] });
    expect(done.status).toBe(200);
    expect(done.body.order.status).toBe('COMPLETED');
    expect(done.body.invoice.code).toMatch(/^HD\d{6}$/);
    expect(done.body.invoice.totalAmount).toBe('150000');
    expect(done.body.invoice.paidAmount).toBe('150000');
    expect(done.body.invoice.dueAmount).toBe('0');
    expect(done.body.invoice.payments).toHaveLength(2); // deposit + remainder
    expect(done.body.invoice.salesOrder.code).toBe('DH000001');
    expect(done.body.order.depositAmount).toBe('0');
    const after = await balanceOf(t, s, p.variantId);
    expect(after.onHand).toBe('0');
    expect(after.reserved).toBe('0');
    expect(Number(await custBalance())).toBe(before); // paid in full
    expect((await t.http().post(`${api}/payments/reconcile`).set(s.auth)).status).toBe(200);
    expect((await t.http().post(`${api}/inventory/reconcile`).set(s.auth)).body.ok).toBe(true);
  });

  it('T-201 draft orders do not reserve; confirm / unconfirm; availability checked at confirm; concurrent confirms never overbook', async () => {
    const p = await stocked('4');
    const d = await order({ confirm: false, lines: [{ variantId: p.variantId, quantity: '3' }] });
    expect(d.status).toBe(201);
    expect(d.body.status).toBe('DRAFT');
    expect((await balanceOf(t, s, p.variantId)).reserved).toBe('0');
    const upd = await t.http().patch(`${api}/orders/${d.body.id}`).set(s.auth).send({ version: 1, lines: [{ variantId: p.variantId, quantity: '2' }], note: 'bớt 1' });
    expect(upd.status).toBe(200);
    expect(upd.body.totalAmount).toBe('100000');
    const c = await t.http().post(`${api}/orders/${d.body.id}/confirm`).set(s.auth).send({ version: 2 });
    expect(c.status).toBe(200);
    expect((await balanceOf(t, s, p.variantId)).reserved).toBe('2');
    expect((await t.http().patch(`${api}/orders/${d.body.id}`).set(s.auth).send({ version: 3, lines: [{ variantId: p.variantId, quantity: '1' }] })).status).toBe(409);
    const un = await t.http().post(`${api}/orders/${d.body.id}/unconfirm`).set(s.auth);
    expect(un.body.status).toBe('DRAFT');
    expect((await balanceOf(t, s, p.variantId)).reserved).toBe('0');
    // 3 orders of 2 each on 4 units: only two can be confirmed
    const results = await Promise.all([1, 2, 3].map(() => order({ lines: [{ variantId: p.variantId, quantity: '2' }] })));
    expect(results.filter((r) => r.status === 201)).toHaveLength(2);
    expect(results.filter((r) => r.status === 409 && r.body.code === 'INSUFFICIENT_STOCK')).toHaveLength(1);
    expect((await balanceOf(t, s, p.variantId)).reserved).toBe('4');
    expect((await t.http().post(`${api}/orders/${d.body.id}/confirm`).set(s.auth).send({})).status).toBe(409);
    expect((await t.http().delete(`${api}/orders/${d.body.id}`).set(s.auth)).status).toBe(204);
  });

  it('T-202 cancel: reservations released; deposit refunded (walk-in must) or kept as customer credit', async () => {
    const p = await stocked('10');
    const before = Number(await custBalance());
    const walkin = await order({ lines: [{ variantId: p.variantId, quantity: '2' }], deposits: [{ method: 'CASH', amount: '30000' }] });
    expect(walkin.status).toBe(201);
    expect((await t.http().post(`${api}/orders/${walkin.body.id}/cancel`).set(s.auth).send({ reason: 'khách hủy', depositAction: 'CREDIT' })).status).toBe(400);
    const cancelled = await t.http().post(`${api}/orders/${walkin.body.id}/cancel`).set(s.auth).send({ reason: 'khách hủy' });
    expect(cancelled.status).toBe(200);
    expect(cancelled.body.status).toBe('CANCELLED');
    expect(cancelled.body.deposits).toHaveLength(0);
    expect((await balanceOf(t, s, p.variantId)).reserved).toBe('0');
    const voucher = await t.http().get(`${api}/payments`).set(s.auth).query({ search: 'DH000', pageSize: 5 });
    expect(voucher.status).toBe(200);
    // customer keeps the deposit as credit
    const cust = await order({ customerId, lines: [{ variantId: p.variantId, quantity: '2' }], deposits: [{ method: 'CASH', amount: '40000' }] });
    expect(Number(await custBalance())).toBe(before - 40000);
    const kept = await t.http().post(`${api}/orders/${cust.body.id}/cancel`).set(s.auth).send({ reason: 'đổi ý', depositAction: 'CREDIT' });
    expect(kept.status).toBe(200);
    expect(kept.body.depositAmount).toBe('0');
    expect(Number(await custBalance())).toBe(before - 40000); // credit stays on the account
    const pay = await t.http().get(`${api}/payments/${cust.body.deposits[0].paymentId}`).set(s.auth);
    expect(pay.body.allocated).toBe('0');
    expect(pay.body.status).toBe('POSTED');
    // refund path for a customer order reverses the ledger
    const cust2 = await order({ customerId, lines: [{ variantId: p.variantId, quantity: '1' }], deposits: [{ method: 'CASH', amount: '10000' }] });
    await t.http().post(`${api}/orders/${cust2.body.id}/cancel`).set(s.auth).send({ reason: 'hoàn cọc', depositAction: 'REFUND' });
    expect(Number(await custBalance())).toBe(before - 40000);
    expect((await t.http().post(`${api}/orders/${cust2.body.id}/cancel`).set(s.auth).send({ reason: 'again' })).status).toBe(409);
    expect((await t.http().post(`${api}/payments/reconcile`).set(s.auth)).status).toBe(200);
  });

  it('T-203 delivery on an order: created with the order, follows the invoice after completion, status machine with history, COD collected to the fund + fee as other income', async () => {
    const p = await stocked('10');
    const o = await order({ customerId, lines: [{ variantId: p.variantId, quantity: '2' }], deposits: [{ method: 'BANK_TRANSFER', amount: '20000' }], delivery: { receiverName: 'Chị Lan', receiverPhone: '0909000111', address: '5 Nguyễn Huệ', district: 'Q1', province: 'HCM', carrier: 'GHTK', shippingFee: '15000', shippingCost: '12000' } });
    expect(o.status).toBe(201);
    expect(o.body.delivery.code).toBe('GH000001');
    expect(o.body.delivery.status).toBe('PENDING');
    expect(o.body.delivery.codAmount).toBe('95000'); // 100 000 − 20 000 deposit + 15 000 fee
    expect((await order({ customerId, lines: [{ variantId: p.variantId, quantity: '1' }], delivery: { receiverName: 'x', address: 'y' } })).status).toBe(201);
    // complete the order with no further payment (customer pays COD)
    const done = await t.http().post(`${api}/orders/${o.body.id}/complete`).set(s.auth).send({});
    expect(done.status).toBe(200);
    expect(done.body.invoice.dueAmount).toBe('80000');
    const dId = o.body.delivery.id;
    const d1 = await t.http().get(`${api}/deliveries/${dId}`).set(s.auth);
    expect(d1.body.invoice.code).toBe(done.body.invoice.code);
    expect(d1.body.allowedNext).toEqual(['PICKING', 'DELIVERING', 'CANCELLED']);
    expect((await t.http().post(`${api}/deliveries/${dId}/status`).set(s.auth).send({ status: 'DELIVERED' })).status).toBe(409);
    expect((await t.http().post(`${api}/deliveries/${dId}/status`).set(s.auth).send({ status: 'PICKING', note: 'shipper lấy hàng' })).status).toBe(200);
    expect((await t.http().post(`${api}/deliveries/${dId}/status`).set(s.auth).send({ status: 'DELIVERING' })).status).toBe(200);
    // invoice cannot be cancelled while the parcel is on the road
    const cancelInv = await t.http().post(`${api}/invoices/${done.body.invoice.id}/cancel`).set(s.auth).send({ reason: 'x' });
    expect(cancelInv.body.code).toBe('INVOICE_HAS_DELIVERY');
    const drawerBefore = Number((await t.http().get(`${api}/cash/accounts`).set(s.auth)).body.find((a: { type: string }) => a.type === 'CASH').balance);
    const delivered = await t.http().post(`${api}/deliveries/${dId}/status`).set(s.auth).send({ status: 'DELIVERED', collectCod: { method: 'CASH' } });
    expect(delivered.status).toBe(200);
    expect(delivered.body.status).toBe('DELIVERED');
    expect(delivered.body.codCollected).toBe(true);
    expect(delivered.body.events.map((e: { status: string }) => e.status)).toEqual(['PENDING', 'PICKING', 'DELIVERING', 'DELIVERED']);
    const inv = await t.http().get(`${api}/invoices/${done.body.invoice.id}`).set(s.auth);
    expect(inv.body.dueAmount).toBe('0');
    expect(inv.body.deliveries[0].code).toBe('GH000001');
    const fee = await t.http().get(`${api}/payments`).set(s.auth).query({ search: 'GH000001', direction: 'IN' });
    expect(fee.body.data.some((x: { category: { name: string } | null; amount: string }) => x.category?.name === 'Phí giao hàng thu hộ' && x.amount === '15000')).toBe(true);
    const drawerAfter = Number((await t.http().get(`${api}/cash/accounts`).set(s.auth)).body.find((a: { type: string }) => a.type === 'CASH').balance);
    expect(drawerAfter - drawerBefore).toBe(95000);
    expect((await t.http().post(`${api}/deliveries/${dId}/collect-cod`).set(s.auth).send({ method: 'CASH' })).body.code).toBe('COD_COLLECTED');
    expect((await t.http().get(`${api}/deliveries`).set(s.auth).query({ status: 'DELIVERED' })).body.meta.total).toBe(1);
  });

  it('T-204 delivery on an invoice; returning flow; COD remitted later; cancelled delivery frees the invoice', async () => {
    const p = await stocked('10');
    const inv = await checkout({ customerId, lines: [{ variantId: p.variantId, quantity: '1' }], payments: [] });
    expect(inv.status).toBe(201);
    const d = await t.http().post(`${api}/deliveries`).set(s.auth).send({ invoiceId: inv.body.id, receiverName: 'Anh Bình', address: '9 Pasteur', carrier: 'Viettel Post' });
    expect(d.status).toBe(201);
    expect(d.body.codAmount).toBe('50000');
    expect((await t.http().post(`${api}/deliveries`).set(s.auth).send({ receiverName: 'x', address: 'y' })).status).toBe(400);
    await t.http().post(`${api}/deliveries/${d.body.id}/status`).set(s.auth).send({ status: 'DELIVERING' });
    const ret = await t.http().post(`${api}/deliveries/${d.body.id}/status`).set(s.auth).send({ status: 'RETURNING', note: 'khách không nghe máy' });
    expect(ret.body.allowedNext).toEqual(['RETURNED', 'DELIVERED']);
    const back = await t.http().post(`${api}/deliveries/${d.body.id}/status`).set(s.auth).send({ status: 'RETURNED' });
    expect(back.body.status).toBe('RETURNED');
    expect((await t.http().patch(`${api}/deliveries/${d.body.id}`).set(s.auth).send({ note: 'x' })).status).toBe(409);
    // a second delivery for the same invoice, delivered without collecting, then COD remitted later by the carrier
    const d2 = await t.http().post(`${api}/deliveries`).set(s.auth).send({ invoiceId: inv.body.id, receiverName: 'Anh Bình', address: '9 Pasteur', codAmount: '50000' });
    await t.http().post(`${api}/deliveries/${d2.body.id}/status`).set(s.auth).send({ status: 'DELIVERING' });
    const delivered = await t.http().post(`${api}/deliveries/${d2.body.id}/status`).set(s.auth).send({ status: 'DELIVERED' });
    expect(delivered.body.codCollected).toBe(false);
    expect((await t.http().get(`${api}/deliveries`).set(s.auth).query({ codPending: 'true' })).body.data.map((x: { id: string }) => x.id)).toContain(d2.body.id);
    const remit = await t.http().post(`${api}/deliveries/${d2.body.id}/collect-cod`).set(s.auth).send({ method: 'BANK_TRANSFER', reference: 'GHTK tuần 43' });
    expect(remit.status).toBe(200);
    expect(remit.body.codCollected).toBe(true);
    expect((await t.http().get(`${api}/invoices/${inv.body.id}`).set(s.auth)).body.dueAmount).toBe('0');
    // cancelled delivery no longer blocks invoice cancellation
    const d3 = await t.http().post(`${api}/deliveries`).set(s.auth).send({ invoiceId: inv.body.id, receiverName: 'x', address: 'y' });
    await t.http().post(`${api}/deliveries/${d3.body.id}/status`).set(s.auth).send({ status: 'PICKING' });
    expect((await t.http().post(`${api}/invoices/${inv.body.id}/cancel`).set(s.auth).send({ reason: 'x' })).body.code).toBe('INVOICE_HAS_DELIVERY');
    await t.http().post(`${api}/deliveries/${d3.body.id}/status`).set(s.auth).send({ status: 'CANCELLED' });
    expect((await t.http().post(`${api}/invoices/${inv.body.id}/cancel`).set(s.auth).send({ reason: 'x' })).status).toBe(200);
  });

  it('T-205 order with a price book / custom prices converts with the agreed prices even when the cashier cannot edit prices; combos reserve components', async () => {
    const comp = await stocked('10', '2000', '8000');
    const combo = await t.http().post(`${api}/products`).set(s.auth).send({ name: 'Combo đặt', type: 'COMBO', variants: [{ sellPrice: '15000' }], comboItems: [{ componentVariantId: comp.variantId, quantity: '2' }] });
    const p = await stocked('10', '1000', '50000');
    const o = await order({ customerId, lines: [{ variantId: p.variantId, quantity: '1', unitPrice: '45000' }, { variantId: combo.body.variants[0].id, quantity: '2' }], discountAmount: '5000' });
    expect(o.status).toBe(201);
    expect(o.body.totalAmount).toBe('70000'); // 45 000 + 30 000 − 5 000
    expect((await balanceOf(t, s, comp.variantId)).reserved).toBe('4');
    // a cashier without price-edit / discount permission completes the order
    const roles = (await t.http().get(`${api}/roles`).set(s.auth)).body;
    const cashier = roles.find((r: { code: string }) => r.code === 'CASHIER');
    await t.http().post(`${api}/users`).set(s.auth).send({ username: 'tndh', password: 'Secret123', fullName: 'TN', roleIds: [cashier.id], branchIds: [s.branchId] });
    const l = await t.http().post(`${api}/auth/login`).send({ tenantCode: s.tenantCode, username: 'tndh', password: 'Secret123' });
    const c = { Authorization: `Bearer ${l.body.accessToken}` };
    const done = await t.http().post(`${api}/orders/${o.body.id}/complete`).set(c).send({ payments: [{ method: 'CASH', amount: '70000' }] });
    expect(done.status).toBe(200);
    expect(done.body.invoice.totalAmount).toBe('70000');
    expect(done.body.invoice.lines[0].unitPrice).toBe('45000');
    expect((await balanceOf(t, s, comp.variantId)).onHand).toBe('6');
    expect((await balanceOf(t, s, comp.variantId)).reserved).toBe('0');
    expect((await t.http().post(`${api}/inventory/reconcile`).set(s.auth)).body.ok).toBe(true);
  });

  it('T-206 permissions, scoping and validation', async () => {
    const p = await stocked('3');
    expect((await order({ lines: [{ variantId: p.variantId, quantity: '1', isGift: true, promotionId: s.branchId }] })).status).toBe(400);
    expect((await order({ lines: [] })).status).toBe(400);
    const roles = (await t.http().get(`${api}/roles`).set(s.auth)).body;
    const wh = roles.find((r: { code: string }) => r.code === 'WAREHOUSE');
    await t.http().post(`${api}/users`).set(s.auth).send({ username: 'khodh', password: 'Secret123', fullName: 'Kho', roleIds: [wh.id], branchIds: [s.branchId] });
    const l = await t.http().post(`${api}/auth/login`).send({ tenantCode: s.tenantCode, username: 'khodh', password: 'Secret123' });
    const k = { Authorization: `Bearer ${l.body.accessToken}` };
    expect((await t.http().get(`${api}/orders`).set(k)).status).toBe(403);
    expect((await t.http().post(`${api}/orders`).set(k).send({ branchId: s.branchId, warehouseId: s.warehouseId, lines: [{ variantId: p.variantId, quantity: '1' }] })).status).toBe(403);
    const o = await order({ lines: [{ variantId: p.variantId, quantity: '1' }] });
    const other = await registerTenant(t);
    expect((await t.http().get(`${api}/orders/${o.body.id}`).set(other.auth)).status).toBe(404);
    expect((await t.http().post(`${api}/orders/${o.body.id}/complete`).set(other.auth).send({})).status).toBe(404);
    const list = await t.http().get(`${api}/orders`).set(s.auth).query({ status: 'CONFIRMED', unpaid: 'true' });
    expect(list.body.data.every((x: { dueAmount: string }) => Number(x.dueAmount) > 0)).toBe(true);
  });
});
