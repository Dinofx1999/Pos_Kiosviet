import { randomUUID } from 'node:crypto';
import { balanceOf, createProduct, createTestApp, login, registerTenant, Session, TestApp } from './helpers';

const api = '/api/v1';

/** Regression tests for the Module 04 review findings (T-120..T-126). */
describe('Purchasing hardening', () => {
  let t: TestApp;
  let s: Session;
  let supplierId: string;
  let whAuth: { Authorization: string };
  beforeAll(async () => {
    t = await createTestApp();
    s = await registerTenant(t);
    supplierId = (await t.http().post(`${api}/suppliers`).set(s.auth).send({ name: 'NCC H' })).body.id;
    const roles = await t.http().get(`${api}/roles`).set(s.auth);
    const wh = roles.body.find((r: any) => r.code === 'WAREHOUSE');
    await t.http().post(`${api}/users`).set(s.auth).send({ username: 'whh', password: 'Secret123', fullName: 'W', roleIds: [wh.id], branchIds: [s.branchId] });
    whAuth = { Authorization: `Bearer ${(await login(t, s.tenantCode, 'whh', 'Secret123')).body.accessToken}` };
  });
  afterAll(async () => { await t.close(); });

  const receipt = (auth: Record<string, string>, lines: any[], extra: Record<string, unknown> = {}) =>
    t.http().post(`${api}/purchase-receipts/post-now`).set(auth).send({ branchId: s.branchId, warehouseId: s.warehouseId, supplierId, lines, ...extra });

  it('T-120 (H1) embedded payment/refund requires payment.create – thủ kho gets 403 and no voucher is created', async () => {
    const p = await createProduct(t, s);
    const before = await t.prisma.raw.payment.count({ where: { tenantId: s.tenantId } });
    const res = await receipt(whAuth, [{ variantId: p.variantId, quantity: '1', unitPrice: '1000' }], { payment: { amount: '1000' } });
    expect(res.status).toBe(403);
    expect(await t.prisma.raw.payment.count({ where: { tenantId: s.tenantId } })).toBe(before);
    expect(await t.prisma.raw.purchaseReceipt.count({ where: { tenantId: s.tenantId, status: 'POSTED' } })).toBe(0); // whole tx rolled back
    const ok = await receipt(whAuth, [{ variantId: p.variantId, quantity: '2', unitPrice: '1000' }]);
    expect(ok.status).toBe(201);
    const ret = await t.http().post(`${api}/purchase-returns/post-now`).set(whAuth).send({ receiptId: ok.body.id, lines: [{ receiptLineId: ok.body.lines[0].id, quantity: '1' }], refund: { amount: '1000' } });
    expect(ret.status).toBe(403);
    expect(await t.prisma.raw.purchaseReturn.count({ where: { tenantId: s.tenantId } })).toBe(0);
  });

  it('T-121 (H2/M6) return price is capped at the per-unit amount paid and Σ returns at the receipt total; default price includes doc discount & tax', async () => {
    const p = await createProduct(t, s);
    // 10 × 100 = 1,000 − doc discount 200 + 10% tax on 800 = 880 payable → 88 per unit
    const r = await receipt(s.auth, [{ variantId: p.variantId, quantity: '10', unitPrice: '100', taxRate: '10' }], { discountAmount: '200' });
    expect(r.body.totalAmount).toBe('880');
    const line = r.body.lines[0];
    const tooHigh = await t.http().post(`${api}/purchase-returns/post-now`).set(s.auth).send({ receiptId: r.body.id, lines: [{ receiptLineId: line.id, quantity: '1', unitPrice: '50000000' }] });
    expect(tooHigh.status).toBe(400);
    const def = await t.http().post(`${api}/purchase-returns/post-now`).set(s.auth).send({ receiptId: r.body.id, lines: [{ receiptLineId: line.id, quantity: '5' }] });
    expect(def.status).toBe(201);
    expect(def.body.lines[0].unitPrice).toBe('88');
    expect(def.body.totalAmount).toBe('440');
    expect((await t.http().get(`${api}/suppliers/${supplierId}`).set(s.auth)).body.balance).toBe(String(880 - 440 + 2000)); // + T-120's receipt
    // refund cannot exceed the return value
    const refundTooBig = await t.http().post(`${api}/payments`).set(s.auth).send({ branchId: s.branchId, direction: 'IN', partyType: 'SUPPLIER', partyId: supplierId, amount: '441', allocations: [{ documentType: 'PURCHASE_RETURN', documentId: def.body.id, amount: '441' }] });
    expect(refundTooBig.status).toBe(409);
    // DB CHECK constraints exist as a last line of defence
    await expect(t.prisma.raw.$executeRaw`UPDATE purchase_receipts SET paid_amount = total_amount + 1 WHERE id = ${r.body.id}::uuid`).rejects.toThrow();
  });

  it('T-122 (M1/M2/M3) lock-order stress: no 500s under concurrent post/cancel/payment combinations', async () => {
    const a = await createProduct(t, s);
    const b = await createProduct(t, s);
    const po = await t.http().post(`${api}/purchase-orders`).set(s.auth).send({ branchId: s.branchId, warehouseId: s.warehouseId, supplierId, lines: [{ variantId: a.variantId, quantity: '100', unitPrice: '10' }, { variantId: b.variantId, quantity: '100', unitPrice: '10' }] });
    await t.http().post(`${api}/purchase-orders/${po.body.id}/confirm`).set(s.auth);
    const [lineA, lineB] = po.body.lines;
    const statuses: number[] = [];
    for (let round = 0; round < 4; round++) {
      // (a) cancel receipt X while posting receipt Y on the same order + variant
      const x = await receipt(s.auth, [{ variantId: a.variantId, quantity: '1', unitPrice: '10', orderLineId: lineA.id }, { variantId: b.variantId, quantity: '1', unitPrice: '10', orderLineId: lineB.id }], { orderId: po.body.id });
      expect(x.status).toBe(201);
      const results = await Promise.all([
        t.http().post(`${api}/purchase-receipts/${x.body.id}/cancel`).set(s.auth).send({ reason: 'stress' }),
        receipt(s.auth, [{ variantId: b.variantId, quantity: '1', unitPrice: '10', orderLineId: lineB.id }, { variantId: a.variantId, quantity: '1', unitPrice: '10', orderLineId: lineA.id }], { orderId: po.body.id }),
        // (b) immediate payment vs standalone payment for the same supplier
        receipt(s.auth, [{ variantId: a.variantId, quantity: '1', unitPrice: '10' }], { payment: { amount: '10' } }),
        t.http().post(`${api}/payments`).set(s.auth).send({ branchId: s.branchId, direction: 'OUT', partyType: 'SUPPLIER', partyId: supplierId, amount: '1' }),
      ]);
      statuses.push(...results.map((r) => r.status));
    }
    expect(statuses.every((st) => st < 500)).toBe(true);
    // (c) allocations in opposite order
    const r1 = await receipt(s.auth, [{ variantId: a.variantId, quantity: '1', unitPrice: '100' }]);
    const r2 = await receipt(s.auth, [{ variantId: a.variantId, quantity: '1', unitPrice: '100' }]);
    const pays = await Promise.all(Array.from({ length: 6 }, (_, i) => t.http().post(`${api}/payments`).set(s.auth).send({ branchId: s.branchId, direction: 'OUT', partyType: 'SUPPLIER', partyId: supplierId, amount: '20', allocations: i % 2 ? [{ documentType: 'PURCHASE_RECEIPT', documentId: r1.body.id, amount: '10' }, { documentType: 'PURCHASE_RECEIPT', documentId: r2.body.id, amount: '10' }] : [{ documentType: 'PURCHASE_RECEIPT', documentId: r2.body.id, amount: '10' }, { documentType: 'PURCHASE_RECEIPT', documentId: r1.body.id, amount: '10' }] })));
    expect(pays.every((p) => p.status === 201)).toBe(true);
    expect((await t.http().get(`${api}/purchase-receipts/${r1.body.id}`).set(s.auth)).body.paidAmount).toBe('60');
    const rec = await t.http().post(`${api}/payments/reconcile`).set(s.auth);
    expect(rec.body.ok).toBe(true);
    expect((await t.http().post(`${api}/inventory/reconcile`).set(s.auth)).body.ok).toBe(true);
    expect((await balanceOf(t, s, a.variantId)).onHandTotal).toBe(String(4 + 4 + 2)); // 4 posted "y" receipts + 4 paid receipts + r1,r2 ( "x" receipts cancelled)
  });

  it('T-123 (M4/M5) payments respect branch scope and validate the branch', async () => {
    const roles = await t.http().get(`${api}/roles`).set(s.auth);
    const mgr = roles.body.find((r: any) => r.code === 'MANAGER');
    const br = await t.http().post(`${api}/branches`).set(s.auth).send({ code: 'CN-B', name: 'B' });
    const whB = br.body.warehouses[0];
    await t.http().post(`${api}/users`).set(s.auth).send({ username: 'mgrA', password: 'Secret123', fullName: 'M', roleIds: [mgr.id], branchIds: [s.branchId] });
    const mgrAuth = { Authorization: `Bearer ${(await login(t, s.tenantCode, 'mgrA', 'Secret123')).body.accessToken}` };
    const p = await createProduct(t, s);
    const inB = await t.http().post(`${api}/purchase-receipts/post-now`).set(s.auth).send({ branchId: br.body.id, warehouseId: whB.id, supplierId, lines: [{ variantId: p.variantId, quantity: '1', unitPrice: '500' }] });
    expect(inB.status).toBe(201);
    const cross = await t.http().post(`${api}/payments`).set(mgrAuth).send({ branchId: s.branchId, direction: 'OUT', partyType: 'SUPPLIER', partyId: supplierId, amount: '500', allocations: [{ documentType: 'PURCHASE_RECEIPT', documentId: inB.body.id, amount: '500' }] });
    expect(cross.status).toBe(403);
    expect((await t.http().get(`${api}/purchase-receipts/${inB.body.id}`).set(s.auth)).body.paidAmount).toBe('0');
    const badBranch = await t.http().post(`${api}/payments`).set(s.auth).send({ branchId: randomUUID(), direction: 'OUT', partyType: 'SUPPLIER', partyId: supplierId, amount: '1' });
    expect(badBranch.status).toBe(404);
    const other = await registerTenant(t);
    const foreignBranch = await t.http().post(`${api}/payments`).set(s.auth).send({ branchId: other.branchId, direction: 'OUT', partyType: 'SUPPLIER', partyId: supplierId, amount: '1' });
    expect(foreignBranch.status).toBe(404);
    // branch-limited manager sees only own-branch ledger entries of the supplier
    const ledger = await t.http().get(`${api}/suppliers/${supplierId}/ledger`).set(mgrAuth);
    expect(ledger.status).toBe(200);
    expect(ledger.body.data.every((e: any) => e.branchId === null || e.branchId === s.branchId)).toBe(true);
  });

  it('T-124 (M7/L1/L6/L10) data-integrity edges return 4xx, not 500', async () => {
    const p = await createProduct(t, s);
    const noOrder = await receipt(s.auth, [{ variantId: p.variantId, quantity: '1', unitPrice: '1', orderLineId: randomUUID() }]);
    expect(noOrder.status).toBe(400);
    const zeroPrice = await receipt(s.auth, [{ variantId: p.variantId, quantity: '10', unitPrice: '0' }], { costs: [{ name: 'Ship', amount: '500', allocationMethod: 'BY_VALUE' }] });
    expect(zeroPrice.status).toBe(201);
    expect(zeroPrice.body.lines[0].unitCost).toBe('50'); // landed cost still lands in inventory
    expect(zeroPrice.body.totalAmount).toBe('500');
    const manual = await t.http().post(`${api}/suppliers`).set(s.auth).send({ code: 'NCC000002', name: 'manual' });
    expect(manual.status).toBe(201);
    const auto = await t.http().post(`${api}/suppliers`).set(s.auth).send({ name: 'auto after manual' });
    expect(auto.status).toBe(201);
    expect(auto.body.code).not.toBe('NCC000002');
    expect((await t.http().post(`${api}/purchase-receipts/${zeroPrice.body.id}/cancel`).set(s.auth).send({ reason: '   ' })).status).toBe(400);
    // duplicate orderLineId lines summed against remaining
    const po = await t.http().post(`${api}/purchase-orders`).set(s.auth).send({ branchId: s.branchId, warehouseId: s.warehouseId, supplierId, lines: [{ variantId: p.variantId, quantity: '3', unitPrice: '1' }] });
    await t.http().post(`${api}/purchase-orders/${po.body.id}/confirm`).set(s.auth);
    const dupLines = await t.http().post(`${api}/purchase-receipts`).set(s.auth).send({ branchId: s.branchId, warehouseId: s.warehouseId, supplierId, orderId: po.body.id, lines: [{ variantId: p.variantId, quantity: '2', unitPrice: '1', orderLineId: po.body.lines[0].id }, { variantId: p.variantId, quantity: '2', unitPrice: '1', orderLineId: po.body.lines[0].id }] });
    expect(dupLines.status).toBe(409);
    expect(dupLines.body.code).toBe('PO_QUANTITY_EXCEEDED');
  });

  it('T-125 (L5) cancelling a receipt restores the previous last purchase price', async () => {
    const p = await createProduct(t, s);
    await receipt(s.auth, [{ variantId: p.variantId, quantity: '1', unitPrice: '111' }]);
    const second = await receipt(s.auth, [{ variantId: p.variantId, quantity: '1', unitPrice: '222' }]);
    expect((await t.prisma.raw.productVariant.findUniqueOrThrow({ where: { id: p.variantId } })).lastPurchasePrice?.toString()).toBe('222');
    await t.http().post(`${api}/purchase-receipts/${second.body.id}/cancel`).set(s.auth).send({ reason: 'x' });
    expect((await t.prisma.raw.productVariant.findUniqueOrThrow({ where: { id: p.variantId } })).lastPurchasePrice?.toString()).toBe('111');
  });
});
