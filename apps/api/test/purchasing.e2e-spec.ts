import { randomUUID } from 'node:crypto';
import { balanceOf, createProduct, createTestApp, login, postIssue, registerTenant, Session, TestApp } from './helpers';

const api = '/api/v1';

describe('Purchasing (Module 04) – T-100..T-112', () => {
  let t: TestApp;
  let s: Session;
  let supplierId: string;
  beforeAll(async () => {
    t = await createTestApp();
    s = await registerTenant(t);
    const sup = await t.http().post(`${api}/suppliers`).set(s.auth).send({ name: 'NCC Mỹ phẩm A', phone: '0900000001', openingBalance: '0' });
    expect(sup.status).toBe(201);
    supplierId = sup.body.id;
  });
  afterAll(async () => { await t.close(); });

  const receipt = (lines: any[], extra: Record<string, unknown> = {}, headers: Record<string, string> = {}) =>
    t.http().post(`${api}/purchase-receipts/post-now`).set(s.auth).set(headers).send({ branchId: s.branchId, warehouseId: s.warehouseId, supplierId, lines, ...extra });
  const supplierBalance = async (id = supplierId) => (await t.http().get(`${api}/suppliers/${id}`).set(s.auth)).body.balance as string;

  it('T-100 supplier: auto code NCC000001, opening balance goes through the ledger, duplicate code rejected', async () => {
    const sup = await t.http().get(`${api}/suppliers/${supplierId}`).set(s.auth);
    expect(sup.body.code).toBe('NCC000001');
    const withOpening = await t.http().post(`${api}/suppliers`).set(s.auth).send({ name: 'NCC B', openingBalance: '500000' });
    expect(withOpening.status).toBe(201);
    expect(withOpening.body.code).toBe('NCC000002');
    expect(await supplierBalance(withOpening.body.id)).toBe('500000');
    const ledger = await t.http().get(`${api}/suppliers/${withOpening.body.id}/ledger`).set(s.auth);
    expect(ledger.body.data[0].type).toBe('OPENING');
    expect(ledger.body.data[0].balanceAfter).toBe('500000');
    const dup = await t.http().post(`${api}/suppliers`).set(s.auth).send({ code: 'NCC000001', name: 'x' });
    expect(dup.status).toBe(409);
  });

  it('T-101 receipt posts stock at landed unit cost, records last purchase price and supplier payable', async () => {
    const p = await createProduct(t, s, { variants: [{ sellPrice: '200000', costPrice: '0' }] });
    const res = await receipt(
      [{ variantId: p.variantId, quantity: '10', unitPrice: '100000', taxRate: '10' }],
      { discountAmount: '50000', costs: [{ name: 'Vận chuyển', amount: '100000', allocationMethod: 'BY_VALUE' }], supplierInvoiceNo: 'HD-001' },
    );
    expect(res.status).toBe(201);
    expect(res.body.status).toBe('POSTED');
    expect(res.body.code).toBe('PN000001');
    // subtotal 1,000,000 − 50,000 doc discount + 95,000 tax + 100,000 shipping = 1,145,000 payable
    expect(res.body.totalAmount).toBe('1145000');
    expect(res.body.lines[0].unitCost).toBe('114500'); // (1,000,000 − 50,000 + 100,000 + 95,000) / 10
    const bal = await balanceOf(t, s, p.variantId);
    expect(bal).toMatchObject({ onHand: '10', costPrice: '114500' });
    const variant = await t.prisma.raw.productVariant.findUniqueOrThrow({ where: { id: p.variantId } });
    expect(variant.lastPurchasePrice?.toString()).toBe('100000');
    expect(await supplierBalance()).toBe('1145000');
    const movements = await t.prisma.raw.stockMovement.findMany({ where: { documentId: res.body.id } });
    expect(movements[0].type).toBe('PURCHASE');
    expect(res.body.dueAmount).toBe('1145000');
  });

  it('T-102 immediate payment on post-now creates a phiếu chi allocated to the receipt', async () => {
    const p = await createProduct(t, s);
    const res = await receipt([{ variantId: p.variantId, quantity: '2', unitPrice: '50000' }], { payment: { amount: '60000', method: 'BANK_TRANSFER' } });
    expect(res.status).toBe(201);
    expect(res.body.paidAmount).toBe('60000');
    expect(res.body.dueAmount).toBe('40000');
    expect(res.body.payments).toHaveLength(1);
    expect(res.body.payments[0].payment.code).toMatch(/^PC\d{6}$/);
    const over = await receipt([{ variantId: p.variantId, quantity: '1', unitPrice: '10' }], { payment: { amount: '999' } });
    expect(over.status).toBe(409);
    expect(over.body.code).toBe('OVERPAYMENT');
  });

  it('T-103 payments: partial allocation, overpayment rejected, cancel restores due and ledger', async () => {
    const p = await createProduct(t, s);
    const r = await receipt([{ variantId: p.variantId, quantity: '1', unitPrice: '300000' }]);
    const before = await supplierBalance();
    const pay = await t.http().post(`${api}/payments`).set(s.auth).send({ branchId: s.branchId, direction: 'OUT', partyType: 'SUPPLIER', partyId: supplierId, amount: '200000', allocations: [{ documentType: 'PURCHASE_RECEIPT', documentId: r.body.id, amount: '200000' }] });
    expect(pay.status).toBe(201);
    expect(pay.body.allocated).toBe('200000');
    expect((await t.http().get(`${api}/purchase-receipts/${r.body.id}`).set(s.auth)).body.dueAmount).toBe('100000');
    expect(Number(await supplierBalance())).toBe(Number(before) - 200000);
    const over = await t.http().post(`${api}/payments`).set(s.auth).send({ branchId: s.branchId, direction: 'OUT', partyType: 'SUPPLIER', partyId: supplierId, amount: '150000', allocations: [{ documentType: 'PURCHASE_RECEIPT', documentId: r.body.id, amount: '150000' }] });
    expect(over.status).toBe(409);
    expect(over.body.code).toBe('OVERPAYMENT');
    const moreThanAmount = await t.http().post(`${api}/payments`).set(s.auth).send({ branchId: s.branchId, direction: 'OUT', partyType: 'SUPPLIER', partyId: supplierId, amount: '10', allocations: [{ documentType: 'PURCHASE_RECEIPT', documentId: r.body.id, amount: '20' }] });
    expect(moreThanAmount.status).toBe(400);
    // unallocated advance payment reduces the balance anyway
    const advance = await t.http().post(`${api}/payments`).set(s.auth).send({ branchId: s.branchId, direction: 'OUT', partyType: 'SUPPLIER', partyId: supplierId, amount: '50000' });
    expect(advance.status).toBe(201);
    expect(Number(await supplierBalance())).toBe(Number(before) - 250000);
    const cancel = await t.http().post(`${api}/payments/${pay.body.id}/cancel`).set(s.auth).send({ reason: 'nhầm' });
    expect(cancel.status).toBe(200);
    expect(cancel.body.status).toBe('CANCELLED');
    expect((await t.http().get(`${api}/purchase-receipts/${r.body.id}`).set(s.auth)).body.dueAmount).toBe('300000');
    expect(Number(await supplierBalance())).toBe(Number(before) - 50000);
    expect((await t.http().post(`${api}/payments/${pay.body.id}/cancel`).set(s.auth).send({ reason: 'x' })).status).toBe(409);
  });

  it('T-104 purchase order: confirm → partial receipts → RECEIVED; over-receipt rejected; cancel receipt reopens the order', async () => {
    const a = await createProduct(t, s);
    const b = await createProduct(t, s);
    const po = await t.http().post(`${api}/purchase-orders`).set(s.auth).send({ branchId: s.branchId, warehouseId: s.warehouseId, supplierId, lines: [{ variantId: a.variantId, quantity: '10', unitPrice: '1000' }, { variantId: b.variantId, quantity: '4', unitPrice: '2000' }] });
    expect(po.status).toBe(201);
    expect(po.body.code).toBe('PDN000001');
    expect(po.body.totalAmount).toBe('18000');
    const lineA = po.body.lines[0]; const lineB = po.body.lines[1];
    // cannot receive from a DRAFT order
    const early = await receipt([{ variantId: a.variantId, quantity: '1', unitPrice: '1000', orderLineId: lineA.id }], { orderId: po.body.id });
    expect(early.status).toBe(409);
    expect(early.body.code).toBe('ORDER_NOT_RECEIVABLE');
    expect((await t.http().post(`${api}/purchase-orders/${po.body.id}/confirm`).set(s.auth)).body.status).toBe('CONFIRMED');
    const r1 = await receipt([{ variantId: a.variantId, quantity: '6', unitPrice: '1000', orderLineId: lineA.id }], { orderId: po.body.id });
    expect(r1.status).toBe(201);
    let order = (await t.http().get(`${api}/purchase-orders/${po.body.id}`).set(s.auth)).body;
    expect(order.status).toBe('PARTIAL');
    expect(order.lines[0].remainingQuantity).toBe('4');
    const tooMany = await receipt([{ variantId: a.variantId, quantity: '5', unitPrice: '1000', orderLineId: lineA.id }], { orderId: po.body.id });
    expect(tooMany.status).toBe(409);
    expect(tooMany.body.code).toBe('PO_QUANTITY_EXCEEDED');
    const r2 = await receipt([{ variantId: a.variantId, quantity: '4', unitPrice: '1000', orderLineId: lineA.id }, { variantId: b.variantId, quantity: '4', unitPrice: '2000', orderLineId: lineB.id }], { orderId: po.body.id });
    expect(r2.status).toBe(201);
    order = (await t.http().get(`${api}/purchase-orders/${po.body.id}`).set(s.auth)).body;
    expect(order.status).toBe('RECEIVED');
    expect(order.receipts).toHaveLength(2);
    // cancelling the second receipt reopens the order as PARTIAL and reverses stock
    const cancel = await t.http().post(`${api}/purchase-receipts/${r2.body.id}/cancel`).set(s.auth).send({ reason: 'hàng lỗi' });
    expect(cancel.status).toBe(200);
    expect(cancel.body.status).toBe('CANCELLED');
    order = (await t.http().get(`${api}/purchase-orders/${po.body.id}`).set(s.auth)).body;
    expect(order.status).toBe('PARTIAL');
    expect(order.lines[1].remainingQuantity).toBe('4');
    expect((await balanceOf(t, s, b.variantId)).onHand).toBe('0');
    expect((await balanceOf(t, s, a.variantId)).onHand).toBe('6');
    // order cancel is blocked while a draft receipt exists; allowed afterwards
    const draft = await t.http().post(`${api}/purchase-receipts`).set(s.auth).send({ branchId: s.branchId, warehouseId: s.warehouseId, supplierId, orderId: po.body.id, lines: [{ variantId: b.variantId, quantity: '1', unitPrice: '2000', orderLineId: lineB.id }] });
    expect(draft.status).toBe(201);
    expect((await t.http().post(`${api}/purchase-orders/${po.body.id}/cancel`).set(s.auth).send({ reason: 'x' })).body.code).toBe('ORDER_HAS_DRAFT_RECEIPTS');
    expect((await t.http().delete(`${api}/purchase-receipts/${draft.body.id}`).set(s.auth)).status).toBe(204);
    expect((await t.http().post(`${api}/purchase-orders/${po.body.id}/cancel`).set(s.auth).send({ reason: 'x' })).body.status).toBe('CANCELLED');
  });

  it('T-105 duplicate post-now with the same Idempotency-Key creates one receipt', async () => {
    const p = await createProduct(t, s);
    const key = randomUUID();
    const results = await Promise.all(Array.from({ length: 3 }, () => receipt([{ variantId: p.variantId, quantity: '1', unitPrice: '10' }], {}, { 'Idempotency-Key': key })));
    const created = results.filter((r) => r.status === 201 && r.headers['idempotent-replayed'] !== 'true');
    expect(created).toHaveLength(1);
    expect((await balanceOf(t, s, p.variantId)).onHand).toBe('1');
    expect(await t.prisma.raw.purchaseReceipt.count({ where: { tenantId: s.tenantId, code: created[0].body.code } })).toBe(1);
  });

  it('T-106 cancelling a posted receipt reverses stock and the payable; blocked when paid or returned', async () => {
    const p = await createProduct(t, s);
    const before = await supplierBalance();
    const r = await receipt([{ variantId: p.variantId, quantity: '5', unitPrice: '20000' }]);
    expect(await supplierBalance()).toBe(String(Number(before) + 100000));
    const cancel = await t.http().post(`${api}/purchase-receipts/${r.body.id}/cancel`).set(s.auth).send({ reason: 'sai' });
    expect(cancel.status).toBe(200);
    expect((await balanceOf(t, s, p.variantId)).onHand).toBe('0');
    expect(await supplierBalance()).toBe(before);
    const reversal = await t.prisma.raw.partyLedgerEntry.findFirst({ where: { documentId: r.body.id, type: 'REVERSAL' } });
    expect(reversal?.amount.toString()).toBe('-100000');
    expect((await t.http().post(`${api}/purchase-receipts/${r.body.id}/cancel`).set(s.auth).send({ reason: 'x' })).status).toBe(409);
    const paid = await receipt([{ variantId: p.variantId, quantity: '1', unitPrice: '1000' }], { payment: { amount: '1000' } });
    const blocked = await t.http().post(`${api}/purchase-receipts/${paid.body.id}/cancel`).set(s.auth).send({ reason: 'x' });
    expect(blocked.status).toBe(409);
    expect(blocked.body.code).toBe('RECEIPT_HAS_PAYMENTS');
    // stock consumed after receipt → reversal would go negative
    const r2 = await receipt([{ variantId: p.variantId, quantity: '3', unitPrice: '1000' }]);
    await postIssue(t, s, [{ variantId: p.variantId, quantity: '3' }]);
    const neg = await t.http().post(`${api}/purchase-receipts/${r2.body.id}/cancel`).set(s.auth).send({ reason: 'x' });
    expect(neg.status).toBe(409);
    expect(neg.body.code).toBe('INSUFFICIENT_STOCK');
  });

  it('T-107 purchase returns: multiple partial returns never exceed received qty; stock, receipt and ledger updated; refund', async () => {
    const p = await createProduct(t, s);
    const before = await supplierBalance();
    const r = await receipt([{ variantId: p.variantId, quantity: '10', unitPrice: '5000', discountAmount: '10000' }]); // net 4,000/unit
    expect(r.body.totalAmount).toBe('40000');
    const line = r.body.lines[0];
    const ret1 = await t.http().post(`${api}/purchase-returns/post-now`).set(s.auth).send({ receiptId: r.body.id, reason: 'Hàng lỗi', lines: [{ receiptLineId: line.id, quantity: '3' }] });
    expect(ret1.status).toBe(201);
    expect(ret1.body.code).toBe('THN000001');
    expect(ret1.body.status).toBe('POSTED');
    expect(ret1.body.lines[0].unitPrice).toBe('4000');
    expect(ret1.body.totalAmount).toBe('12000');
    expect((await balanceOf(t, s, p.variantId)).onHand).toBe('7');
    expect(Number(await supplierBalance())).toBe(Number(before) + 40000 - 12000);
    const detail = await t.http().get(`${api}/purchase-receipts/${r.body.id}`).set(s.auth);
    expect(detail.body.lines[0].returnableQuantity).toBe('7');
    expect(detail.body.returnedAmount).toBe('12000');
    const tooMany = await t.http().post(`${api}/purchase-returns/post-now`).set(s.auth).send({ receiptId: r.body.id, lines: [{ receiptLineId: line.id, quantity: '8' }] });
    expect(tooMany.status).toBe(409);
    expect(tooMany.body.code).toBe('RETURN_QUANTITY_EXCEEDED');
    const ret2 = await t.http().post(`${api}/purchase-returns/post-now`).set(s.auth).send({ receiptId: r.body.id, lines: [{ receiptLineId: line.id, quantity: '7', unitPrice: '3500' }], refund: { amount: '24500', method: 'CASH' } });
    expect(ret2.status).toBe(201);
    expect(ret2.body.refundedAmount).toBe('24500');
    expect(ret2.body.refunds[0].payment.code).toMatch(/^PT\d{6}$/);
    expect((await balanceOf(t, s, p.variantId)).onHand).toBe('0');
    // ledger: +40000 −12000 −24500 (return) +24500 (refund) = +28000 vs before
    expect(Number(await supplierBalance())).toBe(Number(before) + 28000);
    // receipt with returns cannot be cancelled; return with refund cannot be cancelled; return without refund can
    expect((await t.http().post(`${api}/purchase-receipts/${r.body.id}/cancel`).set(s.auth).send({ reason: 'x' })).body.code).toBe('RECEIPT_HAS_RETURNS');
    expect((await t.http().post(`${api}/purchase-returns/${ret2.body.id}/cancel`).set(s.auth).send({ reason: 'x' })).body.code).toBe('RETURN_HAS_REFUNDS');
    const cancelRet1 = await t.http().post(`${api}/purchase-returns/${ret1.body.id}/cancel`).set(s.auth).send({ reason: 'nhầm' });
    expect(cancelRet1.status).toBe(200);
    expect((await balanceOf(t, s, p.variantId)).onHand).toBe('3');
    expect((await t.http().get(`${api}/purchase-receipts/${r.body.id}`).set(s.auth)).body.lines[0].returnableQuantity).toBe('3');
    expect(Number(await supplierBalance())).toBe(Number(before) + 40000);
    // return more than on hand (goods already sold) is blocked by stock, not silently negative
    await postIssue(t, s, [{ variantId: p.variantId, quantity: '3' }]);
    const noStock = await t.http().post(`${api}/purchase-returns/post-now`).set(s.auth).send({ receiptId: r.body.id, lines: [{ receiptLineId: line.id, quantity: '3' }] });
    expect(noStock.status).toBe(409);
    expect(noStock.body.code).toBe('INSUFFICIENT_STOCK');
  });

  it('T-108 concurrent returns on the same receipt line cannot over-return', async () => {
    const p = await createProduct(t, s);
    const r = await receipt([{ variantId: p.variantId, quantity: '4', unitPrice: '100' }]);
    const line = r.body.lines[0];
    const results = await Promise.all(Array.from({ length: 4 }, () => t.http().post(`${api}/purchase-returns/post-now`).set(s.auth).send({ receiptId: r.body.id, lines: [{ receiptLineId: line.id, quantity: '3' }] })));
    expect(results.filter((x) => x.status === 201)).toHaveLength(1);
    expect(results.filter((x) => x.status === 409).every((x) => ['RETURN_QUANTITY_EXCEEDED', 'RETURN_AMOUNT_EXCEEDED', 'INSUFFICIENT_STOCK'].includes(x.body.code))).toBe(true);
    expect((await balanceOf(t, s, p.variantId)).onHand).toBe('1');
  });

  it('T-109 average cost after a purchase blends with existing stock; tax excluded from cost when setting is off', async () => {
    const p = await createProduct(t, s, { variants: [{ sellPrice: '1', costPrice: '100' }] });
    await receipt([{ variantId: p.variantId, quantity: '10', unitPrice: '100' }]);           // avg 100
    await receipt([{ variantId: p.variantId, quantity: '10', unitPrice: '200', taxRate: '10' }]); // landed 220 → avg 160
    expect((await balanceOf(t, s, p.variantId)).costPrice).toBe('160');
    await t.http().put(`${api}/settings`).set(s.auth).send({ settings: { 'purchasing.includeTaxInCost': false } });
    await receipt([{ variantId: p.variantId, quantity: '20', unitPrice: '200', taxRate: '10' }]); // cost 200 → (20×160 + 20×200)/40 = 180
    expect((await balanceOf(t, s, p.variantId)).costPrice).toBe('180');
    await t.http().put(`${api}/settings`).set(s.auth).send({ settings: { 'purchasing.includeTaxInCost': true } });
    const rec = await t.http().post(`${api}/inventory/reconcile`).set(s.auth);
    expect(rec.body.ok).toBe(true);
  });

  it('T-110 branch scoping and permissions on purchasing', async () => {
    const roles = await t.http().get(`${api}/roles`).set(s.auth);
    const wh = roles.body.find((r: any) => r.code === 'WAREHOUSE');
    const cashier = roles.body.find((r: any) => r.code === 'CASHIER');
    await t.http().post(`${api}/users`).set(s.auth).send({ username: 'whbuy', password: 'Secret123', fullName: 'W', roleIds: [wh.id], branchIds: [s.branchId] });
    await t.http().post(`${api}/users`).set(s.auth).send({ username: 'cashbuy', password: 'Secret123', fullName: 'C', roleIds: [cashier.id], branchIds: [s.branchId] });
    const whAuth = { Authorization: `Bearer ${(await login(t, s.tenantCode, 'whbuy', 'Secret123')).body.accessToken}` };
    const cashAuth = { Authorization: `Bearer ${(await login(t, s.tenantCode, 'cashbuy', 'Secret123')).body.accessToken}` };
    const p = await createProduct(t, s);
    // warehouse user can receive, but cannot see supplier debt nor create payments
    const ok = await t.http().post(`${api}/purchase-receipts/post-now`).set(whAuth).send({ branchId: s.branchId, warehouseId: s.warehouseId, supplierId, lines: [{ variantId: p.variantId, quantity: '1', unitPrice: '1' }] });
    expect(ok.status).toBe(201);
    expect((await t.http().get(`${api}/suppliers`).set(whAuth)).body.data[0].balance).toBeUndefined();
    expect((await t.http().get(`${api}/suppliers/${supplierId}/ledger`).set(whAuth)).status).toBe(403);
    expect((await t.http().post(`${api}/payments`).set(whAuth).send({ branchId: s.branchId, direction: 'OUT', partyType: 'SUPPLIER', partyId: supplierId, amount: '1' })).status).toBe(403);
    expect((await t.http().get(`${api}/purchase-receipts`).set(cashAuth)).status).toBe(403);
    // other branch
    const br = await t.http().post(`${api}/branches`).set(s.auth).send({ code: 'CN02', name: 'CN 2' });
    const whB = br.body.warehouses[0];
    const denied = await t.http().post(`${api}/purchase-receipts/post-now`).set(whAuth).send({ branchId: br.body.id, warehouseId: whB.id, supplierId, lines: [{ variantId: p.variantId, quantity: '1', unitPrice: '1' }] });
    expect(denied.status).toBe(403);
    const inB = await t.http().post(`${api}/purchase-receipts/post-now`).set(s.auth).send({ branchId: br.body.id, warehouseId: whB.id, supplierId, lines: [{ variantId: p.variantId, quantity: '1', unitPrice: '1' }] });
    expect(inB.status).toBe(201);
    const list = await t.http().get(`${api}/purchase-receipts`).set(whAuth).query({ branchId: br.body.id });
    expect(list.body.data).toHaveLength(0);
    expect((await t.http().get(`${api}/purchase-receipts/${inB.body.id}`).set(whAuth)).status).toBe(404);
  });

  it('T-111 tenant isolation: another tenant cannot use our supplier or receipts', async () => {
    const other = await registerTenant(t);
    const p = await createProduct(t, other);
    const res = await t.http().post(`${api}/purchase-receipts/post-now`).set(other.auth).send({ branchId: other.branchId, warehouseId: other.warehouseId, supplierId, lines: [{ variantId: p.variantId, quantity: '1', unitPrice: '1' }] });
    expect(res.status).toBe(404);
    expect((await t.http().get(`${api}/suppliers/${supplierId}`).set(other.auth)).status).toBe(404);
    const mine = await t.http().get(`${api}/purchase-receipts`).set(s.auth);
    expect((await t.http().get(`${api}/purchase-receipts/${mine.body.data[0].id}`).set(other.auth)).status).toBe(404);
  });

  it('T-112 reports and debt overview reflect posted documents; ledger reconciles', async () => {
    const summary = await t.http().get(`${api}/purchasing/reports/summary`).set(s.auth).query({ groupBy: 'day' });
    expect(summary.status).toBe(200);
    expect(summary.body.totals.receipts).toBeGreaterThan(0);
    expect(Number(summary.body.totals.purchased)).toBeGreaterThan(0);
    expect(summary.body.bySupplier[0].supplierId).toBe(supplierId);
    expect(summary.body.topProducts.length).toBeGreaterThan(0);
    const debt = await t.http().get(`${api}/purchasing/reports/debt`).set(s.auth);
    expect(debt.status).toBe(200);
    expect(debt.body.suppliers.some((x: any) => x.id === supplierId)).toBe(true);
    const history = await t.http().get(`${api}/suppliers/${supplierId}/history`).set(s.auth);
    expect(history.body.receipts.length).toBeGreaterThan(0);
    expect(history.body.payments.length).toBeGreaterThan(0);
    // cached balances equal Σ ledger for every party
    const diffs = await t.prisma.raw.$queryRaw<any[]>`WITH l AS (SELECT party_id, SUM(amount) AS ledger FROM party_ledger_entries WHERE tenant_id = ${s.tenantId}::uuid GROUP BY 1)
      SELECT b.party_id FROM party_balances b LEFT JOIN l ON l.party_id = b.party_id WHERE b.tenant_id = ${s.tenantId}::uuid AND b.balance <> COALESCE(l.ledger, 0)`;
    expect(diffs).toHaveLength(0);
    const unpaid = await t.http().get(`${api}/purchase-receipts`).set(s.auth).query({ unpaid: 'true' });
    expect(unpaid.body.data.every((r: any) => Number(r.dueAmount) > 0)).toBe(true);
  });
});
