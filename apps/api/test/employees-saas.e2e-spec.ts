import { createProduct, createTestApp, postReceipt, registerTenant, Session, TestApp } from './helpers';

const api = '/api/v1';

describe('Employees (commission, attendance, performance), SaaS plans and tax report (Modules 11, 12, 14) – T-240..T-245', () => {
  let t: TestApp;
  let s: Session;
  let cashierId: string;
  let cashierAuth: { Authorization: string };
  let variantId: string;
  let categoryId: string;
  beforeAll(async () => {
    t = await createTestApp();
    s = await registerTenant(t, { plan: 'FREE' });
    const roles = (await t.http().get(`${api}/roles`).set(s.auth)).body;
    const cashier = roles.find((r: { code: string }) => r.code === 'CASHIER');
    const u = await t.http().post(`${api}/users`).set(s.auth).send({ username: 'nvban', password: 'Secret123', fullName: 'Nguyễn Văn Bán', roleIds: [cashier.id], branchIds: [s.branchId], position: 'Thu ngân', hiredAt: '2026-01-15', baseSalary: '7000000' });
    expect(u.status).toBe(201);
    cashierId = u.body.id;
    const l = await t.http().post(`${api}/auth/login`).send({ tenantCode: s.tenantCode, username: 'nvban', password: 'Secret123' });
    cashierAuth = { Authorization: `Bearer ${l.body.accessToken}` };
    categoryId = (await t.http().post(`${api}/categories`).set(s.auth).send({ name: 'Son môi' })).body.id;
    const p = await createProduct(t, s, { categoryId, taxRate: '10', variants: [{ sellPrice: '110000', costPrice: '50000' }] });
    variantId = p.variantId;
    await postReceipt(t, s, [{ variantId, quantity: '100', unitCost: '50000' }]);
  });
  afterAll(async () => { await t.close(); });

  const checkoutAs = (auth: { Authorization: string }, body: Record<string, unknown>) => t.http().post(`${api}/invoices/checkout`).set(auth).send({ branchId: s.branchId, warehouseId: s.warehouseId, ...body });

  it('T-240 employee profile fields, commission rules (specific rule wins, minRevenue gate, basis variants) and the commission report', async () => {
    const list = await t.http().get(`${api}/employees`).set(s.auth);
    const me = list.body.data.find((e: { id: string }) => e.id === cashierId);
    expect(me.position).toBe('Thu ngân');
    expect(me.baseSalary).toBe('7000000');
    expect((await t.http().get(`${api}/employees`).set(cashierAuth)).status).toBe(403);
    // sales by the cashier: 3 × 110 000 (son) + 1 × 110 000 returned later
    const inv = await checkoutAs(cashierAuth, { lines: [{ variantId, quantity: '3' }], payments: [{ method: 'CASH', amount: '330000' }] });
    expect(inv.status).toBe(201);
    const other = await createProduct(t, s, { variants: [{ sellPrice: '200000', costPrice: '150000' }] });
    await postReceipt(t, s, [{ variantId: other.variantId, quantity: '10', unitCost: '150000' }]);
    expect((await checkoutAs(cashierAuth, { lines: [{ variantId: other.variantId, quantity: '1' }], payments: [{ method: 'CASH', amount: '200000' }] })).status).toBe(201);
    // rules: 2 % revenue for everyone, 5 % gross profit on the lipstick category for this cashier, 10 000 đ per unit on the other product
    // /users exposes the profile fields (salary only with employee.manage) and hiredAt can be cleared with null
    const uv = await t.http().get(`${api}/users/${cashierId}`).set(s.auth);
    expect(uv.body.position).toBe('Thu ngân');
    expect(uv.body.hiredAt).toMatch(/^2026-01-15/);
    expect(uv.body.baseSalary).toBe('7000000');
    expect((await t.http().patch(`${api}/users/${cashierId}`).set(s.auth).send({ hiredAt: null })).body.hiredAt).toBeNull();
    const all = await t.http().post(`${api}/employees/commission-rules`).set(s.auth).send({ name: '2% doanh thu', rate: '2' });
    expect(all.status).toBe(201);
    const cat = await t.http().post(`${api}/employees/commission-rules`).set(s.auth).send({ name: '5% LN gộp son', userId: cashierId, categoryId, basis: 'GROSS_PROFIT', rate: '5', priority: 1 });
    expect(cat.status).toBe(201);
    const unit = await t.http().post(`${api}/employees/commission-rules`).set(s.auth).send({ name: '10k/đơn vị', variantId: other.variantId, basis: 'QUANTITY', rate: '10000' });
    expect(unit.status).toBe(201);
    expect((await t.http().post(`${api}/employees/commission-rules`).set(cashierAuth).send({ name: 'x', rate: '1' })).status).toBe(403);
    const ruleList = (await t.http().get(`${api}/employees/commission-rules`).set(s.auth)).body;
    expect(ruleList.find((r: { id: string }) => r.id === cat.body.id).category?.name).toBeTruthy();
    expect(ruleList.find((r: { id: string }) => r.id === unit.body.id).variant?.sku).toBeTruthy();
    const rep = await t.http().get(`${api}/employees/commissions`).set(s.auth).query({ from: new Date(Date.now() - 3600_000).toISOString() });
    expect(rep.status).toBe(200);
    const row = rep.body.data.find((r: { sellerId: string }) => r.sellerId === cashierId);
    expect(row.revenue).toBe('530000');
    // lipstick: profit (330 000 − 150 000) × 5 % = 9 000 (user+category rule beats the generic 2 %); other: 1 unit × 10 000
    expect(row.commission).toBe('19000');
    expect(row.byRule.map((r: { name: string; commission: string }) => `${r.name}:${r.commission}`).sort()).toEqual(['10k/đơn vị:10000', '5% LN gộp son:9000']);
    // minRevenue gate: raise the threshold above the seller's revenue → that rule pays nothing
    await t.http().patch(`${api}/employees/commission-rules/${cat.body.id}`).set(s.auth).send({ minRevenue: '1000000' });
    const gated = await t.http().get(`${api}/employees/commissions`).set(s.auth).query({ from: new Date(Date.now() - 3600_000).toISOString() });
    expect(gated.body.data.find((r: { sellerId: string }) => r.sellerId === cashierId).commission).toBe('10000');
    await t.http().patch(`${api}/employees/commission-rules/${cat.body.id}`).set(s.auth).send({ minRevenue: '0' });
    // returns reduce the commission base
    const ret = await t.http().post(`${api}/sales-returns/complete-now`).set(s.auth).send({ invoiceId: inv.body.id, lines: [{ invoiceLineId: inv.body.lines[0].id, quantity: '1' }], refund: { method: 'CASH', amount: '110000' } });
    expect(ret.status).toBe(201);
    const after = await t.http().get(`${api}/employees/commissions`).set(s.auth).query({ from: new Date(Date.now() - 3600_000).toISOString() });
    expect(after.body.data.find((r: { sellerId: string }) => r.sellerId === cashierId).revenue).toBe('420000');
    // the cashier sees only their own commission
    const mine = await t.http().get(`${api}/employees/commissions/me`).set(cashierAuth);
    expect(mine.status).toBe(200);
    expect(mine.body.data).toHaveLength(1);
    expect(mine.body.data[0].sellerId).toBe(cashierId);
    expect((await t.http().get(`${api}/employees/commissions`).set(cashierAuth)).status).toBe(403);
  });

  it('T-241 attendance: check-in / out, no double check-in, own history, manager list with hours, manual correction', async () => {
    expect((await t.http().post(`${api}/employees/attendance/check-out`).set(cashierAuth).send({})).body.code).toBe('ATTENDANCE_NOT_OPEN');
    const inRes = await t.http().post(`${api}/employees/attendance/check-in`).set(cashierAuth).send({ branchId: s.branchId, note: 'ca sáng' });
    expect(inRes.status).toBe(201);
    expect((await t.http().post(`${api}/employees/attendance/check-in`).set(cashierAuth).send({})).body.code).toBe('ATTENDANCE_OPEN');
    const cur = await t.http().get(`${api}/employees/attendance/current`).set(cashierAuth);
    expect(cur.body.open.id).toBe(inRes.body.id);
    const out = await t.http().post(`${api}/employees/attendance/check-out`).set(cashierAuth).send({ note: 'về' });
    expect(out.status).toBe(200);
    expect(out.body.checkOutAt).toBeTruthy();
    expect(out.body.minutes).toBeGreaterThanOrEqual(0);
    const mine = await t.http().get(`${api}/employees/attendance/me`).set(cashierAuth);
    expect(mine.body.data).toHaveLength(1);
    expect((await t.http().get(`${api}/employees/attendance`).set(cashierAuth)).status).toBe(403);
    // manager corrects the times and adds a manual session
    const edit = await t.http().patch(`${api}/employees/attendance/${inRes.body.id}`).set(s.auth).send({ checkInAt: '2026-10-24T01:00:00.000Z', checkOutAt: '2026-10-24T09:30:00.000Z' });
    expect(edit.status).toBe(200);
    expect(edit.body.minutes).toBe(510);
    expect((await t.http().patch(`${api}/employees/attendance/${inRes.body.id}`).set(s.auth).send({ checkOutAt: '2026-10-23T09:30:00.000Z' })).status).toBe(400);
    const manual = await t.http().post(`${api}/employees/attendance`).set(s.auth).send({ userId: cashierId, checkInAt: '2026-10-23T01:00:00.000Z', checkOutAt: '2026-10-23T05:00:00.000Z', note: 'quên chấm' });
    expect(manual.status).toBe(201);
    expect(manual.body.source).toBe('MANUAL');
    const all = await t.http().get(`${api}/employees/attendance`).set(s.auth).query({ userId: cashierId });
    expect(all.body.meta.total).toBe(2);
    expect(all.body.summary[0].minutes).toBe(750);
    expect(all.body.summary[0].hours).toBe(12.5);
  });

  it('T-242 performance report combines sales, returns, shifts, attendance and commission per seller', async () => {
    const open = await t.http().post(`${api}/shifts/open`).set(cashierAuth).send({ branchId: s.branchId, openingCash: '100000' });
    expect(open.status).toBe(201);
    await checkoutAs(cashierAuth, { lines: [{ variantId, quantity: '1' }], payments: [{ method: 'CASH', amount: '110000' }] });
    const close = await t.http().post(`${api}/shifts/${open.body.id}/close`).set(cashierAuth).send({ countedCash: '205000' }); // 5 000 short
    expect(close.status).toBe(200);
    const perf = await t.http().get(`${api}/employees/performance`).set(s.auth).query({ from: new Date(Date.now() - 7 * 86400_000).toISOString() });
    expect(perf.status).toBe(200);
    const row = perf.body.data.find((r: { sellerId: string }) => r.sellerId === cashierId);
    expect(row.invoices).toBe(3);
    expect(row.returned).toBe('110000');
    expect(row.netRevenue).toBe('530000');
    expect(row.shifts).toBe(1);
    expect(row.cashDifference).toBe('-5000');
    expect(row.attendanceSessions).toBe(2);
    expect(Number(row.commission)).toBeGreaterThan(0);
    expect((await t.http().get(`${api}/employees/performance`).set(cashierAuth)).status).toBe(403);
  });

  it('T-243 SaaS: FREE plan limits block extra users; subscription shows usage; platform key changes plan and the limit lifts', async () => {
    const sub = await t.http().get(`${api}/subscription`).set(s.auth);
    expect(sub.status).toBe(200);
    expect(sub.body.plan.code).toBe('FREE');
    expect(sub.body.limits.users).toBe(3);
    expect(sub.body.usage.users).toBe(2);
    expect(sub.body.trialDaysLeft).toBeGreaterThan(20);
    expect(sub.body.readOnly).toBe(false);
    expect((await t.http().post(`${api}/users`).set(s.auth).send({ username: 'user3', password: 'Secret123', fullName: 'U3' })).status).toBe(201);
    const blocked = await t.http().post(`${api}/users`).set(s.auth).send({ username: 'user4', password: 'Secret123', fullName: 'U4' });
    expect(blocked.status).toBe(409);
    expect(blocked.body.code).toBe('PLAN_LIMIT_REACHED');
    expect(blocked.body.details.limit).toBe(3);
    const b2 = await t.http().post(`${api}/branches`).set(s.auth).send({ code: 'CN-X', name: 'CN X' });
    expect(b2.body.code).toBe('PLAN_LIMIT_REACHED');
    // platform operator upgrades the tenant
    process.env.PLATFORM_ADMIN_KEY = 'test-platform-key-1234567890';
    try {
      expect((await t.http().get(`${api}/platform/tenants`).set('x-platform-key', 'wrong')).status).toBe(403);
      const tenants = await t.http().get(`${api}/platform/tenants`).set('x-platform-key', process.env.PLATFORM_ADMIN_KEY).query({ search: s.tenantCode });
      expect(tenants.status).toBe(200);
      expect(tenants.body.data[0].id).toBe(s.tenantId);
      expect(tenants.body.data[0].counts.users).toBe(3);
      const up = await t.http().patch(`${api}/platform/tenants/${s.tenantId}`).set('x-platform-key', process.env.PLATFORM_ADMIN_KEY).send({ planCode: 'PRO', status: 'ACTIVE', planExpiresAt: new Date(Date.now() + 365 * 86400_000).toISOString() });
      expect(up.status).toBe(200);
      expect(up.body.planCode).toBe('PRO');
      expect((await t.http().post(`${api}/users`).set(s.auth).send({ username: 'user4', password: 'Secret123', fullName: 'U4' })).status).toBe(201);
      expect((await t.http().post(`${api}/branches`).set(s.auth).send({ code: 'CN-X', name: 'CN X' })).status).toBe(201);
      expect((await t.http().get(`${api}/subscription`).set(s.auth)).body.plan.code).toBe('PRO');
    } finally { delete process.env.PLATFORM_ADMIN_KEY; }
    expect((await t.http().get(`${api}/platform/tenants`).set('x-platform-key', 'anything')).status).toBe(403); // key not configured → refused
  });

  it('T-244 expired trial → read-only: GETs work, writes return TRIAL_EXPIRED, auth still works; suspension blocks everything', async () => {
    const fresh = await registerTenant(t, { plan: 'FREE' });
    await t.prisma.raw.tenant.update({ where: { id: fresh.tenantId }, data: { trialEndsAt: new Date(Date.now() - 86400_000) } });
    expect((await t.http().get(`${api}/products`).set(fresh.auth)).status).toBe(200);
    const write = await t.http().post(`${api}/customers`).set(fresh.auth).send({ name: 'X' });
    expect(write.status).toBe(403);
    expect(write.body.code).toBe('TRIAL_EXPIRED');
    expect((await t.http().get(`${api}/subscription`).set(fresh.auth)).body.readOnly).toBe(true);
    expect((await t.http().post(`${api}/auth/login`).send({ tenantCode: fresh.tenantCode, username: 'owner', password: 'Secret123' })).status).toBe(200);
    await t.prisma.raw.tenant.update({ where: { id: fresh.tenantId }, data: { status: 'SUSPENDED' } });
    expect((await t.http().get(`${api}/products`).set(fresh.auth)).status).toBe(401);
    expect((await t.http().post(`${api}/auth/login`).send({ tenantCode: fresh.tenantCode, username: 'owner', password: 'Secret123' })).status).toBe(401);
  });

  it('T-245 tax report: output VAT by rate from completed invoices, input VAT from receipts, payable difference', async () => {
    const rep = await t.http().get(`${api}/reports/tax`).set(s.auth).query({ from: new Date(Date.now() - 86400_000).toISOString() });
    expect(rep.status).toBe(200);
    const ten = rep.body.output.find((r: { taxRate: string }) => r.taxRate === '10');
    expect(ten).toBeDefined();
    expect(Number(ten.tax)).toBeGreaterThan(0);
    expect(Number(ten.taxable)).toBeGreaterThan(0);
    expect(Number(rep.body.totals.outputTax)).toBeGreaterThan(0);
    expect(rep.body.returns.count).toBe(1);
    expect((await t.http().get(`${api}/reports/tax`).set(cashierAuth)).status).toBe(403);
  });
});
