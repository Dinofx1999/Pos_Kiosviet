import { createProduct, createTestApp, postReceipt, registerTenant, Session, TestApp } from './helpers';

const api = '/api/v1';

describe('Dashboard home screen (GET /dashboard/home) – T-250', () => {
  let t: TestApp;
  let s: Session;
  let cashierAuth: { Authorization: string };
  let variantId: string;
  beforeAll(async () => {
    t = await createTestApp();
    s = await registerTenant(t);
    const roles = (await t.http().get(`${api}/roles`).set(s.auth)).body;
    const cashier = roles.find((r: { code: string }) => r.code === 'CASHIER');
    await t.http().post(`${api}/users`).set(s.auth).send({ username: 'nvhome', password: 'Secret123', fullName: 'Nhân Viên Home', roleIds: [cashier.id], branchIds: [s.branchId] });
    const l = await t.http().post(`${api}/auth/login`).send({ tenantCode: s.tenantCode, username: 'nvhome', password: 'Secret123' });
    cashierAuth = { Authorization: `Bearer ${l.body.accessToken}` };
    const p = await createProduct(t, s, { name: 'Kem dưỡng home', variants: [{ sellPrice: '100000', costPrice: '60000', minStock: '50' }] });
    variantId = p.variantId;
    await postReceipt(t, s, [{ variantId, quantity: '10', unitCost: '60000' }]); // 10 ≤ minStock 50 → low stock
  });
  afterAll(async () => { await t.close(); });

  const checkoutAs = (auth: { Authorization: string }, body: Record<string, unknown>) => t.http().post(`${api}/invoices/checkout`).set(auth).send({ branchId: s.branchId, warehouseId: s.warehouseId, ...body });

  it('T-250 owner sees today vs yesterday, hourly & daily series, top products, activity, todo counters; cashier sees only their own sales and no profit', async () => {
    const shift = await t.http().post(`${api}/shifts/open`).set(s.auth).send({ branchId: s.branchId, openingCash: '100000' });
    expect(shift.status).toBe(201);
    expect((await checkoutAs(s.auth, { lines: [{ variantId, quantity: '2' }], payments: [{ method: 'CASH', amount: '200000' }] })).status).toBe(201);
    expect((await checkoutAs(cashierAuth, { lines: [{ variantId, quantity: '1' }], payments: [{ method: 'CASH', amount: '100000' }] })).status).toBe(201);
    // a partially paid invoice and a held (draft) one feed the "cần xử lý" counters
    const customer = await t.http().post(`${api}/customers`).set(s.auth).send({ name: 'Khách nợ Home', phone: '0900000777' });
    const unpaid = await checkoutAs(s.auth, { customerId: customer.body.id, lines: [{ variantId, quantity: '1' }], payments: [{ method: 'CASH', amount: '40000' }] });
    expect(unpaid.status).toBe(201);
    expect((await t.http().post(`${api}/invoices`).set(s.auth).send({ branchId: s.branchId, warehouseId: s.warehouseId, lines: [{ variantId, quantity: '1' }] })).status).toBe(201);

    const home = await t.http().get(`${api}/dashboard/home`).set(s.auth);
    expect(home.status).toBe(200);
    const h = home.body;
    expect(h.sales.today.invoices).toBe(3);
    expect(h.sales.today.revenue).toBe('400000.00');
    expect(h.sales.today.grossProfit).toBe('160000.00');
    expect(h.sales.yesterday.invoices).toBe(0);
    expect(h.sales.week.revenue).toBe('400000.00');
    expect(h.sales.month.invoices).toBe(3);
    expect(h.sales.byHour.reduce((sum: number, x: { invoices: number }) => sum + x.invoices, 0)).toBe(3);
    expect(h.sales.byDay).toHaveLength(1);
    expect(h.sales.byDay[0].revenue).toBe('400000.00');
    expect(h.sales.topProducts[0].variantId).toBe(variantId);
    expect(h.sales.topProducts[0].quantity).toBe('4.000');
    expect(h.sales.recentInvoices).toHaveLength(3); // drafts are not activity
    expect(h.sales.recentInvoices[0].sellerName).toBeTruthy();
    expect(h.sales.unpaid).toEqual({ count: 1, amount: '60000.00' });
    expect(h.todo.heldInvoices).toBe(1);
    expect(h.todo.pendingOrders).toBe(0);
    expect(h.inventory.lowStockCount).toBe(1);
    expect(h.inventory.onHandTotal).toBe('6');
    expect(h.inventory.recentDocuments.length).toBeGreaterThanOrEqual(1);
    expect(h.shift.code).toBe(shift.body.code);
    expect(h.shift.invoices).toBe(2); // the owner's two completed sales were made inside the open shift
    expect(h.shift.cashNet).toBe('240000.00');

    // cashier: no sales.report.view → only their own invoices, no profit figures, no stock value
    const mine = await t.http().get(`${api}/dashboard/home`).set(cashierAuth);
    expect(mine.status).toBe(200);
    expect(mine.body.sales.today.invoices).toBe(1);
    expect(mine.body.sales.today.revenue).toBe('100000.00');
    expect(mine.body.sales.today.grossProfit).toBeUndefined();
    expect(mine.body.sales.recentInvoices).toHaveLength(1);
    expect(mine.body.todo.heldInvoices).toBe(0);
    expect(mine.body.shift).toBeNull();

    // a branch outside the user's scope yields empty sales instead of leaking data
    const other = await t.http().get(`${api}/dashboard/home`).set(cashierAuth).query({ branchId: '11111111-1111-4111-8111-111111111111' });
    expect(other.status).toBe(200);
    expect(other.body.sales.today.invoices).toBe(0);
    expect(other.body.sales.recentInvoices).toEqual([]);
  });
});
