import { createProduct, createTestApp, postIssue, postReceipt, registerTenant, Session, TestApp } from './helpers';

const api = '/api/v1';

describe('Reports: NXT, slow movers, top products, profit, valuation, Excel (Module 10) – T-210..T-214', () => {
  let t: TestApp;
  let s: Session;
  let customerId: string;
  beforeAll(async () => {
    t = await createTestApp();
    s = await registerTenant(t);
    customerId = (await t.http().post(`${api}/customers`).set(s.auth).send({ name: 'KH báo cáo' })).body.id;
  });
  afterAll(async () => { await t.close(); });

  const checkout = (body: Record<string, unknown>) => t.http().post(`${api}/invoices/checkout`).set(s.auth).send({ branchId: s.branchId, warehouseId: s.warehouseId, ...body });
  const dayAgo = (n: number) => new Date(Date.now() - n * 86400_000).toISOString();

  it('T-210 NXT: opening + in − out = closing per product and in totals; values hidden without inventory.cost.view', async () => {
    const cat = (await t.http().post(`${api}/categories`).set(s.auth).send({ name: 'Serum' })).body;
    const a = await createProduct(t, s, { categoryId: cat.id, variants: [{ sellPrice: '50000', costPrice: '20000' }] });
    const b = await createProduct(t, s, { variants: [{ sellPrice: '10000', costPrice: '4000' }] });
    // movements "before" the period are simulated by backdating created_at directly in the ledger (the API never backdates)
    await postReceipt(t, s, [{ variantId: a.variantId, quantity: '10', unitCost: '20000' }, { variantId: b.variantId, quantity: '5', unitCost: '4000' }]);
    await t.prisma.raw.$executeRaw`UPDATE stock_movements SET created_at = now() - interval '10 days' WHERE tenant_id = ${s.tenantId}::uuid`;
    await t.prisma.raw.$executeRaw`UPDATE cost_ledger_entries SET created_at = now() - interval '10 days' WHERE tenant_id = ${s.tenantId}::uuid`;
    await postReceipt(t, s, [{ variantId: a.variantId, quantity: '4', unitCost: '26000' }]); // in: 4 × 26 000
    await postIssue(t, s, [{ variantId: a.variantId, quantity: '3' }]); // out at the new average
    await checkout({ lines: [{ variantId: a.variantId, quantity: '2' }], payments: [{ method: 'CASH', amount: '100000' }] });
    const r = await t.http().get(`${api}/reports/inventory/nxt`).set(s.auth).query({ from: dayAgo(3), to: new Date().toISOString() });
    expect(r.status).toBe(200);
    const ra = r.body.data.find((x: { variantId: string }) => x.variantId === a.variantId);
    expect(ra.openingQty).toBe('10');
    expect(ra.inQty).toBe('4');
    expect(ra.outQty).toBe('5');
    expect(ra.closingQty).toBe('9');
    expect(ra.openingValue).toBe('200000');
    expect(ra.inValue).toBe('104000');
    expect(Number(ra.closingValue)).toBeCloseTo(9 * Number(ra.costPrice), 0);
    expect(r.body.totals.closingQty).toBe('14'); // a: 9, b: 5
    // hideEmpty default hides products without movement; explicit false shows them
    const c = await createProduct(t, s, { variants: [{ sellPrice: '1', costPrice: '1' }] });
    expect((await t.http().get(`${api}/reports/inventory/nxt`).set(s.auth).query({ from: dayAgo(3) })).body.data.some((x: { variantId: string }) => x.variantId === c.variantId)).toBe(false);
    expect((await t.http().get(`${api}/reports/inventory/nxt`).set(s.auth).query({ from: dayAgo(3), hideEmpty: 'false', pageSize: 100 })).body.data.some((x: { variantId: string }) => x.variantId === c.variantId)).toBe(true);
    // category filter
    const byCat = await t.http().get(`${api}/reports/inventory/nxt`).set(s.auth).query({ from: dayAgo(3), categoryId: cat.id });
    expect(byCat.body.data.map((x: { variantId: string }) => x.variantId)).toEqual([a.variantId]);
    // cashier (no cost permission): quantities only
    const roles = (await t.http().get(`${api}/roles`).set(s.auth)).body;
    const cashier = roles.find((x: { code: string }) => x.code === 'CASHIER');
    await t.http().post(`${api}/users`).set(s.auth).send({ username: 'tnbc', password: 'Secret123', fullName: 'TN', roleIds: [cashier.id], branchIds: [s.branchId] });
    const l = await t.http().post(`${api}/auth/login`).send({ tenantCode: s.tenantCode, username: 'tnbc', password: 'Secret123' });
    const cAuth = { Authorization: `Bearer ${l.body.accessToken}` };
    const rc = await t.http().get(`${api}/reports/inventory/nxt`).set(cAuth).query({ from: dayAgo(3) });
    expect(rc.status).toBe(200);
    expect(rc.body.data[0].closingQty).toBeDefined();
    expect(rc.body.data[0].closingValue).toBeUndefined();
    expect((await t.http().get(`${api}/reports/inventory/valuation`).set(cAuth)).status).toBe(403);
  });

  it('T-211 slow movers: products with stock and no sale in N days, ordered oldest first; sold products drop out', async () => {
    const slow = await createProduct(t, s, { variants: [{ sellPrice: '30000', costPrice: '10000' }] });
    const fresh = await createProduct(t, s, { variants: [{ sellPrice: '30000', costPrice: '10000' }] });
    await postReceipt(t, s, [{ variantId: slow.variantId, quantity: '6', unitCost: '10000' }, { variantId: fresh.variantId, quantity: '6', unitCost: '10000' }]);
    await checkout({ lines: [{ variantId: fresh.variantId, quantity: '1' }], payments: [{ method: 'CASH', amount: '30000' }] });
    const r = await t.http().get(`${api}/reports/inventory/slow-movers`).set(s.auth).query({ days: 7, pageSize: 100 });
    expect(r.status).toBe(200);
    const ids = r.body.data.map((x: { variantId: string }) => x.variantId);
    expect(ids).toContain(slow.variantId);
    expect(ids).not.toContain(fresh.variantId);
    const row = r.body.data.find((x: { variantId: string }) => x.variantId === slow.variantId);
    expect(row.onHand).toBe('6');
    expect(row.value).toBe('60000');
    expect(row.lastSaleAt).toBeNull();
    expect(row.daysSinceSale).toBeNull();
    // a product sold long ago shows the days since its last sale
    await t.prisma.raw.$executeRaw`UPDATE stock_movements SET created_at = now() - interval '40 days' WHERE tenant_id = ${s.tenantId}::uuid AND variant_id = ${fresh.variantId}::uuid AND type = 'SALE'`;
    const r2 = await t.http().get(`${api}/reports/inventory/slow-movers`).set(s.auth).query({ days: 30, pageSize: 100 });
    const f = r2.body.data.find((x: { variantId: string }) => x.variantId === fresh.variantId);
    expect(f.daysSinceSale).toBeGreaterThanOrEqual(39);
  });

  it('T-212 top products by revenue / quantity / profit with category filter; ascending = slow sellers', async () => {
    const cat = (await t.http().post(`${api}/categories`).set(s.auth).send({ name: 'Son' })).body;
    const x = await createProduct(t, s, { categoryId: cat.id, variants: [{ sellPrice: '100000', costPrice: '40000' }] });
    const y = await createProduct(t, s, { variants: [{ sellPrice: '20000', costPrice: '19000' }] });
    await postReceipt(t, s, [{ variantId: x.variantId, quantity: '10', unitCost: '40000' }, { variantId: y.variantId, quantity: '50', unitCost: '19000' }]);
    expect((await checkout({ customerId, lines: [{ variantId: x.variantId, quantity: '2' }, { variantId: y.variantId, quantity: '10' }], payments: [] })).status).toBe(201);
    const byRevenue = await t.http().get(`${api}/reports/sales/products`).set(s.auth).query({ from: dayAgo(1), by: 'revenue' });
    expect(byRevenue.status).toBe(200);
    const first = byRevenue.body.data[0];
    expect([x.variantId, y.variantId]).toContain(first.variantId); // x 200 000 vs y 200 000 tie → name order
    const byQty = await t.http().get(`${api}/reports/sales/products`).set(s.auth).query({ from: dayAgo(1), by: 'quantity' });
    expect(byQty.body.data[0].variantId).toBe(y.variantId);
    const byProfit = await t.http().get(`${api}/reports/sales/products`).set(s.auth).query({ from: dayAgo(1), by: 'profit' });
    expect(byProfit.body.data[0].variantId).toBe(x.variantId); // 120 000 vs 10 000
    expect(byProfit.body.data[0].profit).toBe('120000');
    const slowest = await t.http().get(`${api}/reports/sales/products`).set(s.auth).query({ from: dayAgo(1), by: 'profit', order: 'asc' });
    expect(slowest.body.data[0].variantId).toBe(y.variantId);
    const inCat = await t.http().get(`${api}/reports/sales/products`).set(s.auth).query({ from: dayAgo(1), categoryId: cat.id });
    expect(inCat.body.data.map((r: { variantId: string }) => r.variantId)).toEqual([x.variantId]);
  });

  it('T-213 profit (P&L): net revenue − COGS − other expenses − losses + other income, with returns and shipping cost', async () => {
    const fresh = await registerTenant(t);
    const auth = fresh.auth;
    const co = (body: Record<string, unknown>) => t.http().post(`${api}/invoices/checkout`).set(auth).send({ branchId: fresh.branchId, warehouseId: fresh.warehouseId, ...body });
    const p = await createProduct(t, fresh, { variants: [{ sellPrice: '100000', costPrice: '60000' }] });
    await t.http().post(`${api}/inventory/documents/post-now`).set(auth).send({ type: 'RECEIPT', branchId: fresh.branchId, warehouseId: fresh.warehouseId, lines: [{ variantId: p.variantId, quantity: '10', unitCost: '60000' }] });
    const inv = await co({ lines: [{ variantId: p.variantId, quantity: '3' }], payments: [{ method: 'CASH', amount: '300000' }] });
    expect(inv.status).toBe(201);
    // return one unit (restocked) → net revenue 200 000, COGS 120 000
    expect((await t.http().post(`${api}/sales-returns/complete-now`).set(auth).send({ invoiceId: inv.body.id, lines: [{ invoiceLineId: inv.body.lines[0].id, quantity: '1' }], refund: { method: 'CASH', amount: '100000' } })).status).toBe(201);
    const outCat = (await t.http().post(`${api}/cash/categories`).set(auth).send({ direction: 'OUT', name: 'Tiền thuê mặt bằng' })).body;
    const inCat = (await t.http().post(`${api}/cash/categories`).set(auth).send({ direction: 'IN', name: 'Thu khác' })).body;
    expect((await t.http().post(`${api}/payments`).set(auth).send({ branchId: fresh.branchId, direction: 'OUT', method: 'CASH', amount: '50000', categoryId: outCat.id })).status).toBe(201);
    expect((await t.http().post(`${api}/payments`).set(auth).send({ branchId: fresh.branchId, direction: 'IN', method: 'CASH', amount: '5000', categoryId: inCat.id })).status).toBe(201);
    // a delivered parcel with carrier cost 12 000 (fee 15 000 collected as other income)
    const inv2 = await co({ lines: [{ variantId: p.variantId, quantity: '1' }], payments: [] , customerId: (await t.http().post(`${api}/customers`).set(auth).send({ name: 'KH' })).body.id });
    const d = await t.http().post(`${api}/deliveries`).set(auth).send({ invoiceId: inv2.body.id, receiverName: 'A', address: 'B', shippingFee: '15000', shippingCost: '12000' });
    await t.http().post(`${api}/deliveries/${d.body.id}/status`).set(auth).send({ status: 'DELIVERING' });
    expect((await t.http().post(`${api}/deliveries/${d.body.id}/status`).set(auth).send({ status: 'DELIVERED', collectCod: { method: 'CASH' } })).status).toBe(200);
    const r = await t.http().get(`${api}/reports/profit`).set(auth).query({ from: dayAgo(1), groupBy: 'day' });
    expect(r.status).toBe(200);
    const tt = r.body.totals;
    expect(tt.revenue).toBe('400000'); // 300 000 + 100 000
    expect(tt.refunds).toBe('100000');
    expect(tt.netRevenue).toBe('300000');
    expect(tt.cogs).toBe('180000'); // 240 000 − 60 000 restocked
    expect(tt.grossProfit).toBe('120000');
    expect(tt.otherExpense).toBe('50000');
    expect(tt.otherIncome).toBe('20000'); // 5 000 + 15 000 shipping fee
    expect(tt.shippingCost).toBe('12000');
    expect(tt.netProfit).toBe('78000'); // 120 000 + 20 000 − 50 000 − 12 000
    expect(r.body.expenseByCategory[0].name).toBe('Tiền thuê mặt bằng');
    expect(r.body.byPeriod).toHaveLength(1);
    // profit report is restricted
    const roles = (await t.http().get(`${api}/roles`).set(auth)).body;
    const cashier = roles.find((x: { code: string }) => x.code === 'CASHIER');
    await t.http().post(`${api}/users`).set(auth).send({ username: 'tnpl', password: 'Secret123', fullName: 'TN', roleIds: [cashier.id], branchIds: [fresh.branchId] });
    const l = await t.http().post(`${api}/auth/login`).send({ tenantCode: fresh.tenantCode, username: 'tnpl', password: 'Secret123' });
    expect((await t.http().get(`${api}/reports/profit`).set({ Authorization: `Bearer ${l.body.accessToken}` })).status).toBe(403);
  });

  it('T-214 valuation by category / warehouse and Excel export of every report type', async () => {
    const v = await t.http().get(`${api}/reports/inventory/valuation`).set(s.auth).query({ groupBy: 'category' });
    expect(v.status).toBe(200);
    expect(Number(v.body.totals.value)).toBeGreaterThan(0);
    expect(v.body.rows.some((r: { name: string }) => r.name === 'Serum')).toBe(true);
    const byWh = await t.http().get(`${api}/reports/inventory/valuation`).set(s.auth).query({ groupBy: 'warehouse' });
    expect(byWh.body.rows[0].key).toBe(s.warehouseId);
    expect(byWh.body.totals.value).toBe(v.body.totals.value);
    const drawer = (await t.http().get(`${api}/cash/accounts`).set(s.auth)).body[0];
    for (const type of ['nxt', 'slow-movers', 'top-products', 'profit', 'valuation', 'sales', 'customer-debt', 'supplier-debt']) {
      const res = await t.http().get(`${api}/reports/export`).set(s.auth).query({ type, from: dayAgo(30) }).buffer(true).parse((r, cb) => { const chunks: Buffer[] = []; r.on('data', (c: Buffer) => chunks.push(c)); r.on('end', () => cb(null, Buffer.concat(chunks))); });
      expect(res.status).toBe(200);
      expect(res.headers['content-type']).toContain('spreadsheetml');
      expect(res.headers['content-disposition']).toContain('.xlsx');
      expect((res.body as Buffer).length).toBeGreaterThan(2000);
      expect((res.body as Buffer).subarray(0, 2).toString()).toBe('PK');
    }
    const cash = await t.http().get(`${api}/reports/export`).set(s.auth).query({ type: 'cashbook', accountId: drawer.id }).buffer(true).parse((r, cb) => { const chunks: Buffer[] = []; r.on('data', (c: Buffer) => chunks.push(c)); r.on('end', () => cb(null, Buffer.concat(chunks))); });
    expect(cash.status).toBe(200);
    expect((await t.http().get(`${api}/reports/export`).set(s.auth).query({ type: 'cashbook' })).status).toBe(400);
    expect((await t.http().get(`${api}/reports/export`).set(s.auth).query({ type: 'nope' })).status).toBe(400);
  });
});
