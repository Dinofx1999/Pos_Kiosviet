import { createProduct, createTestApp, postReceipt, registerTenant, Session, TestApp } from './helpers';

const api = '/api/v1';

describe('Loyalty points & CRM (Module 11) – T-230..T-233', () => {
  let t: TestApp;
  let s: Session;
  let customerId: string;
  let variantId: string;
  beforeAll(async () => {
    t = await createTestApp();
    s = await registerTenant(t);
    customerId = (await t.http().post(`${api}/customers`).set(s.auth).send({ name: 'Khách tích điểm', phone: '0911000001', birthday: '1992-10-24' })).body.id;
    const p = await createProduct(t, s, { variants: [{ sellPrice: '100000', costPrice: '40000' }] });
    variantId = p.variantId;
    await postReceipt(t, s, [{ variantId, quantity: '100', unitCost: '40000' }]);
  });
  afterAll(async () => { await t.close(); });

  const checkout = (body: Record<string, unknown>) => t.http().post(`${api}/invoices/checkout`).set(s.auth).send({ branchId: s.branchId, warehouseId: s.warehouseId, ...body });
  const preview = (body: Record<string, unknown>) => t.http().post(`${api}/invoices/preview`).set(s.auth).send({ branchId: s.branchId, warehouseId: s.warehouseId, ...body });
  const points = async () => (await t.http().get(`${api}/customers/${customerId}/points`).set(s.auth)).body;
  const settings = (v: Record<string, unknown>) => t.http().put(`${api}/settings`).set(s.auth).send({ settings: v });

  it('T-230 disabled by default: no points earned; enabling earns whole points on money paid; cancel reverses', async () => {
    const off = await checkout({ customerId, lines: [{ variantId, quantity: '1' }], payments: [{ method: 'CASH', amount: '100000' }] });
    expect(off.status).toBe(201);
    expect(off.body.pointsEarned).toBe('0');
    expect((await points()).balance).toBe('0');
    expect((await settings({ 'loyalty.enabled': true, 'loyalty.earnPoints': 1, 'loyalty.earnPerAmount': 10000, 'loyalty.redeemValue': 1000, 'loyalty.maxRedeemPercent': 50 })).status).toBe(200);
    const pv = await preview({ customerId, lines: [{ variantId, quantity: '3' }] });
    expect(pv.body.loyalty.enabled).toBe(true);
    expect(pv.body.loyalty.earnPreview).toBe('30');
    expect(pv.body.loyalty.balance).toBe('0');
    const on = await checkout({ customerId, lines: [{ variantId, quantity: '3' }, { variantId, quantity: '1', discountAmount: '5000' }], payments: [{ method: 'CASH', amount: '395000' }] });
    expect(on.status).toBe(201);
    expect(on.body.pointsEarned).toBe('39'); // floor(395 000 / 10 000)
    const l = await points();
    expect(l.balance).toBe('39');
    expect(l.data[0].type).toBe('EARN');
    expect(l.data[0].documentCode).toBe(on.body.code);
    // walk-in sale earns nothing; a sale on credit still earns on the invoice total (points follow the sale, debt is separate)
    expect((await checkout({ lines: [{ variantId, quantity: '1' }], payments: [{ method: 'CASH', amount: '100000' }] })).body.pointsEarned).toBe('0');
    const cancel = await t.http().post(`${api}/invoices/${on.body.id}/cancel`).set(s.auth).send({ reason: 'nhầm' });
    expect(cancel.status).toBe(200);
    const after = await points();
    expect(after.balance).toBe('0');
    expect(after.data[0].type).toBe('REVERSAL');
  });

  it('T-231 redeeming points pays part of the invoice (POINTS payment), capped by balance and max percent, concurrent redemptions never overspend', async () => {
    const earn = await checkout({ customerId, lines: [{ variantId, quantity: '5' }], payments: [{ method: 'CASH', amount: '500000' }] });
    expect(earn.body.pointsEarned).toBe('50');
    const pv = await preview({ customerId, lines: [{ variantId, quantity: '1' }], redeemPoints: '50' });
    expect(pv.status).toBe(200);
    expect(pv.body.loyalty.maxRedeemPoints).toBe('50'); // 50 % of 100 000 = 50 000 = 50 points
    expect(pv.body.loyalty.redeemValue).toBe('50000');
    expect(pv.body.loyalty.payableAfterPoints).toBe('50000');
    expect(pv.body.loyalty.earnPreview).toBe('5'); // earned on the money part only
    const tooMany = await checkout({ customerId, lines: [{ variantId, quantity: '1' }], redeemPoints: '60', payments: [{ method: 'CASH', amount: '40000' }] });
    expect(tooMany.status).toBe(409);
    expect(['POINTS_INSUFFICIENT', 'POINTS_MAX_REDEEM']).toContain(tooMany.body.code);
    const overCap = await checkout({ customerId, lines: [{ variantId, quantity: '1' }, { variantId, quantity: '1' }], redeemPoints: '50', payments: [{ method: 'CASH', amount: '150000' }] }); // 50 pts = 50 000 ≤ 50 % of 200 000 → ok
    expect(overCap.status).toBe(201);
    expect(overCap.body.pointsRedeemed).toBe('50');
    expect(overCap.body.pointsValue).toBe('50000');
    expect(overCap.body.paidAmount).toBe('200000');
    expect(overCap.body.dueAmount).toBe('0');
    expect(overCap.body.payments.map((p: { payment: { method: string } }) => p.payment.method).sort()).toEqual(['CASH', 'POINTS']);
    expect(overCap.body.pointsEarned).toBe('15'); // 150 000 paid with money
    const bal = await points();
    expect(bal.balance).toBe('15');
    expect(bal.redeemed).toBe('50');
    // the POINTS voucher is not cash and cannot be cancelled by hand
    const pointsPay = overCap.body.payments.find((p: { payment: { method: string } }) => p.payment.method === 'POINTS').payment;
    expect((await t.http().post(`${api}/payments/${pointsPay.id}/cancel`).set(s.auth).send({ reason: 'x' })).status).toBe(409);
    expect((await t.http().get(`${api}/payments/${pointsPay.id}`).set(s.auth)).body.cashAccountId).toBeNull();
    const cash = await t.http().get(`${api}/cash/summary`).set(s.auth);
    expect(cash.body.byKind.some((k: { kind: string; direction: string }) => k.direction === 'IN' && k.kind === 'CUSTOMER')).toBe(true);
    expect(cash.body.totals.in).toBe('850000'); // 100k + 100k (walk-in) + 500k + 150k; the cancelled 395k sale and the points never enter the cash book
    // two terminals try to spend the same 15 points
    const race = await Promise.all([1, 2].map(() => checkout({ customerId, lines: [{ variantId, quantity: '1' }], redeemPoints: '15', payments: [{ method: 'CASH', amount: '85000' }] })));
    expect(race.filter((r) => r.status === 201)).toHaveLength(1);
    expect(race.find((r) => r.status !== 201)?.body.code).toBe('POINTS_INSUFFICIENT');
    expect(Number((await points()).balance)).toBeGreaterThanOrEqual(0);
    // cancelling the points sale gives the points back and removes the earned ones
    const won = race.find((r) => r.status === 201)!;
    const before = Number((await points()).balance);
    await t.http().post(`${api}/invoices/${won.body.id}/cancel`).set(s.auth).send({ reason: 'x' });
    expect(Number((await points()).balance)).toBe(before + 15 - Number(won.body.pointsEarned));
    expect((await t.http().post(`${api}/payments/reconcile`).set(s.auth)).status).toBe(200);
  });

  it('T-232 returns take back the pro-rata earned points; held orders keep the redemption; manual adjustment; cashier may not adjust', async () => {
    const sale = await checkout({ customerId, lines: [{ variantId, quantity: '4' }], payments: [{ method: 'CASH', amount: '400000' }] });
    expect(sale.body.pointsEarned).toBe('40');
    const before = Number((await points()).balance);
    const ret = await t.http().post(`${api}/sales-returns/complete-now`).set(s.auth).send({ invoiceId: sale.body.id, lines: [{ invoiceLineId: sale.body.lines[0].id, quantity: '1' }], refund: { method: 'CASH', amount: '100000' } });
    expect(ret.status).toBe(201);
    expect(Number((await points()).balance)).toBe(before - 10);
    const cancel = await t.http().post(`${api}/sales-returns/${ret.body.id}/cancel`).set(s.auth).send({ reason: 'nhầm' });
    expect(cancel.status).toBe(200);
    expect(Number((await points()).balance)).toBe(before);
    // held order with points, completed later; stale balance is re-checked at completion
    const hold = await t.http().post(`${api}/invoices`).set(s.auth).send({ branchId: s.branchId, warehouseId: s.warehouseId, customerId, lines: [{ variantId, quantity: '1' }], redeemPoints: '20' });
    expect(hold.status).toBe(201);
    expect(hold.body.pointsRedeemed).toBe('20');
    const adj = await t.http().post(`${api}/customers/${customerId}/points/adjust`).set(s.auth).send({ points: `-${before}`, note: 'reset thử nghiệm' });
    expect(adj.status).toBe(201);
    expect((await points()).balance).toBe('0');
    const complete = await t.http().post(`${api}/invoices/${hold.body.id}/complete`).set(s.auth).send({ version: 1, payments: [{ method: 'CASH', amount: '80000' }] });
    expect(complete.status).toBe(409);
    expect(complete.body.code).toBe('POINTS_INSUFFICIENT');
    const fixed = await t.http().patch(`${api}/invoices/${hold.body.id}`).set(s.auth).send({ version: 1, redeemPoints: '0' });
    expect(fixed.status).toBe(200);
    expect(fixed.body.pointsRedeemed).toBe('0');
    expect((await t.http().post(`${api}/invoices/${hold.body.id}/complete`).set(s.auth).send({ version: 2, payments: [{ method: 'CASH', amount: '100000' }] })).status).toBe(200);
    expect((await t.http().post(`${api}/customers/${customerId}/points/adjust`).set(s.auth).send({ points: '0', note: 'x' })).status).toBe(400);
    const roles = (await t.http().get(`${api}/roles`).set(s.auth)).body;
    const cashier = roles.find((r: { code: string }) => r.code === 'CASHIER');
    await t.http().post(`${api}/users`).set(s.auth).send({ username: 'tnpt', password: 'Secret123', fullName: 'TN', roleIds: [cashier.id], branchIds: [s.branchId] });
    const l = await t.http().post(`${api}/auth/login`).send({ tenantCode: s.tenantCode, username: 'tnpt', password: 'Secret123' });
    const c = { Authorization: `Bearer ${l.body.accessToken}` };
    expect((await t.http().get(`${api}/customers/${customerId}/points`).set(c)).status).toBe(200);
    expect((await t.http().post(`${api}/customers/${customerId}/points/adjust`).set(c).send({ points: '5', note: 'x' })).status).toBe(403);
  });

  it('T-233 birthdays list, settings validation, points on customer record, top customers report', async () => {
    const bd = await t.http().get(`${api}/customers/birthdays`).set(s.auth).query({ month: 10 });
    expect(bd.status).toBe(200);
    expect(bd.body.customers.map((c: { id: string }) => c.id)).toContain(customerId);
    expect(bd.body.customers[0].day).toBe(24);
    expect((await t.http().get(`${api}/customers/birthdays`).set(s.auth).query({ month: 10, day: 25 })).body.customers).toHaveLength(0);
    expect((await settings({ 'loyalty.maxRedeemPercent': 150 })).status).toBe(400);
    expect((await settings({ 'loyalty.earnPerAmount': 0 })).status).toBe(400);
    const cust = await t.http().get(`${api}/customers/${customerId}`).set(s.auth);
    expect(cust.body.points).toBeDefined();
    const rep = await t.http().get(`${api}/reports/customers`).set(s.auth).query({ from: new Date(Date.now() - 3600_000).toISOString() });
    expect(rep.status).toBe(200);
    const row = rep.body.data.find((r: { customerId: string }) => r.customerId === customerId);
    expect(row).toBeDefined();
    expect(Number(row.invoices)).toBeGreaterThan(0);
    expect(Number(row.revenue)).toBeGreaterThan(0);
    expect(row.lastPurchaseAt).toBeTruthy();
    expect(rep.body.totals.customers).toBeGreaterThan(0);
    expect(rep.body.totals.newCustomers).toBeGreaterThanOrEqual(1);
  });
});
