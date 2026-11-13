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
    // từ trước các buổi chấm công ghi cứng 23–24/10 ở T-241 (không phụ thuộc ngày chạy test)
    const perf = await t.http().get(`${api}/employees/performance`).set(s.auth).query({ from: '2026-10-01T00:00:00.000Z' });
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
  it('T-246 GPS attendance at the branch + trusted devices: branch coordinates; gpsRequired rejects missing / far / inaccurate positions and stores the distance in range; deviceLock binds one phone per employee, a new phone waits for approval, a colleague\'s phone is rejected (no proxy check-in); manager approves / blocks / removes devices', async () => {
    await t.http().post(`${api}/employees/attendance/check-out`).set(cashierAuth).send({});
    const br = await t.http().patch(`${api}/branches/${s.branchId}`).set(s.auth).send({ latitude: 15.5736, longitude: 108.474, radiusMeters: 100 });
    expect(br.status).toBe(200);
    expect(Number(br.body.latitude)).toBeCloseTo(15.5736, 4);
    expect((await t.http().put(`${api}/settings`).set(s.auth).send({ settings: { 'attendance.gpsRequired': true, 'attendance.deviceLock': true, 'attendance.maxAccuracyMeters': 100 } })).status).toBe(200);
    const cur0 = await t.http().get(`${api}/employees/attendance/current`).set(cashierAuth).query({ deviceId: 'phone-A' });
    expect(cur0.body.policy).toMatchObject({ gpsRequired: true, deviceLock: true });
    expect(cur0.body.branches.find((b: { id: string }) => b.id === s.branchId)).toMatchObject({ hasGeo: true, radius: 100 });
    expect(cur0.body.device).toBeNull();
    const ci = (auth: { Authorization: string }, body: Record<string, unknown>) => t.http().post(`${api}/employees/attendance/check-in`).set(auth).send({ branchId: s.branchId, ...body });
    expect((await ci(cashierAuth, { deviceId: 'phone-A' })).body.code).toBe('ATTENDANCE_GPS_REQUIRED');
    expect((await ci(cashierAuth, { deviceId: 'phone-A', latitude: 15.58, longitude: 108.474, accuracy: 10 })).body.code).toBe('ATTENDANCE_OUT_OF_RANGE'); // ~700 m away
    expect((await ci(cashierAuth, { deviceId: 'phone-A', latitude: 15.5736, longitude: 108.474, accuracy: 500 })).body.code).toBe('ATTENDANCE_GPS_INACCURATE');
    const ok = await ci(cashierAuth, { deviceId: 'phone-A', deviceName: 'iPhone · Safari', latitude: 15.5738, longitude: 108.4742, accuracy: 12 });
    expect(ok.status).toBe(201);
    expect(ok.body.distanceMeters).toBeGreaterThan(0);
    expect(ok.body.distanceMeters).toBeLessThan(60);
    expect(ok.body.deviceId).toBe('phone-A');
    expect(ok.body.flags).toEqual([]);
    expect((await t.http().get(`${api}/employees/attendance/current`).set(cashierAuth).query({ deviceId: 'phone-A' })).body.device.status).toBe('TRUSTED');
    // check-out far away from another device: never blocked, only flagged
    const out = await t.http().post(`${api}/employees/attendance/check-out`).set(cashierAuth).send({ deviceId: 'phone-B', latitude: 15.6, longitude: 108.474, accuracy: 10 });
    expect(out.status).toBe(200);
    expect(out.body.flags).toEqual(expect.arrayContaining(['OUT_OUT_OF_RANGE', 'DEVICE_CHANGED']));
    // same employee, new phone → pending approval
    expect((await ci(cashierAuth, { deviceId: 'phone-B', latitude: 15.5736, longitude: 108.474, accuracy: 10 })).body.code).toBe('ATTENDANCE_DEVICE_UNTRUSTED');
    // a colleague logs in on the cashier's phone to check in for them → rejected
    const roles = (await t.http().get(`${api}/roles`).set(s.auth)).body;
    const u2 = await t.http().post(`${api}/users`).set(s.auth).send({ username: 'nvhai', password: 'Secret123', fullName: 'Trần Thị Hai', roleIds: [roles.find((r: { code: string }) => r.code === 'CASHIER').id], branchIds: [s.branchId] });
    expect(u2.status).toBe(201);
    const l2 = await t.http().post(`${api}/auth/login`).send({ tenantCode: s.tenantCode, username: 'nvhai', password: 'Secret123' });
    const auth2 = { Authorization: `Bearer ${l2.body.accessToken}` };
    expect((await ci(auth2, { deviceId: 'phone-A', latitude: 15.5736, longitude: 108.474, accuracy: 10 })).body.code).toBe('ATTENDANCE_DEVICE_SHARED');
    // manager: list, approve phone-B, cashier can use it
    const devs = await t.http().get(`${api}/employees/attendance/devices`).set(s.auth);
    expect(devs.status).toBe(200);
    const devB = devs.body.find((d: { deviceId: string }) => d.deviceId === 'phone-B');
    expect(devB.status).toBe('PENDING');
    expect(devB.user.id).toBe(cashierId);
    expect((await t.http().patch(`${api}/employees/attendance/devices/${devB.id}`).set(cashierAuth).send({ status: 'TRUSTED' })).status).toBe(403);
    expect((await t.http().patch(`${api}/employees/attendance/devices/${devB.id}`).set(s.auth).send({ status: 'TRUSTED' })).body.status).toBe('TRUSTED');
    expect((await ci(cashierAuth, { deviceId: 'phone-B', latitude: 15.5736, longitude: 108.474, accuracy: 10 })).status).toBe(201);
    await t.http().post(`${api}/employees/attendance/check-out`).set(cashierAuth).send({ deviceId: 'phone-B' });
    // block phone-A → rejected; remove it → the colleague can register that phone as their own
    const devA = devs.body.find((d: { deviceId: string }) => d.deviceId === 'phone-A');
    await t.http().patch(`${api}/employees/attendance/devices/${devA.id}`).set(s.auth).send({ status: 'BLOCKED' });
    expect((await ci(cashierAuth, { deviceId: 'phone-A', latitude: 15.5736, longitude: 108.474, accuracy: 10 })).body.code).toBe('ATTENDANCE_DEVICE_BLOCKED');
    expect((await t.http().delete(`${api}/employees/attendance/devices/${devA.id}`).set(s.auth)).status).toBe(204);
    expect((await ci(auth2, { deviceId: 'phone-A', latitude: 15.5736, longitude: 108.474, accuracy: 10 })).status).toBe(201);
    // manager list shows distance and flags
    const list = await t.http().get(`${api}/employees/attendance`).set(s.auth).query({ userId: cashierId });
    const first = list.body.data.find((a: { id: string }) => a.id === ok.body.id);
    expect(first.distanceMeters).toBe(ok.body.distanceMeters);
    expect(first.flags).toEqual(expect.arrayContaining(['DEVICE_CHANGED']));
    // relax for the rest of the suite
    await t.http().put(`${api}/settings`).set(s.auth).send({ settings: { 'attendance.gpsRequired': false, 'attendance.deviceLock': false } });
    await t.http().post(`${api}/employees/attendance/check-out`).set(auth2).send({});
  });

  it('T-280 ca làm việc: chấm sớm tính từ giờ vào ca, chấm ra muộn tính đến hết ca; tự nhận ca theo giờ vào (gần giờ vào ca nhất), ca qua đêm, ngoài giờ ca gắn cờ; quản lý đổi ca / sửa giờ; đổi giờ ca không đổi lượt cũ; xóa ca đã dùng thì ngừng dùng', async () => {
    const shifts = `${api}/employees/attendance/shifts`;
    // tạo / kiểm tra dữ liệu / quyền
    expect((await t.http().post(shifts).set(cashierAuth).send({ name: 'Ca sáng', start: '07:00', end: '14:00' })).status).toBe(403);
    expect((await t.http().post(shifts).set(s.auth).send({ name: 'Sai', start: '7h', end: '14:00' })).status).toBe(400);
    expect((await t.http().post(shifts).set(s.auth).send({ name: 'Trùng giờ', start: '08:00', end: '08:00' })).status).toBe(400);
    const morning = (await t.http().post(shifts).set(s.auth).send({ name: 'Ca sáng', start: '07:00', end: '14:00' })).body;
    const evening = (await t.http().post(shifts).set(s.auth).send({ name: 'Ca chiều', start: '14:00', end: '22:00', branchId: s.branchId })).body;
    const night = (await t.http().post(shifts).set(s.auth).send({ name: 'Ca đêm', start: '22:00', end: '06:00', isActive: false })).body;
    expect(morning).toMatchObject({ start: '07:00', end: '14:00', startMinute: 420, endMinute: 840 });
    const list = await t.http().get(shifts).set(s.auth);
    expect(list.body.map((x: any) => x.name)).toEqual(['Ca sáng', 'Ca chiều']);
    expect((await t.http().get(shifts).set(s.auth).query({ includeInactive: true })).body).toHaveLength(3);

    const manual = (body: Record<string, unknown>) => t.http().post(`${api}/employees/attendance`).set(s.auth).send({ userId: cashierId, branchId: s.branchId, ...body });
    // vào sớm 6:40, ra muộn 14:35 → tính 7:00–14:00 = 420 phút
    const a1 = await manual({ checkInAt: '2026-10-20T06:40:00+07:00', checkOutAt: '2026-10-20T14:35:00+07:00' });
    expect(a1.status).toBe(201);
    expect(a1.body).toMatchObject({ workShiftId: morning.id, minutes: 420, workShift: { name: 'Ca sáng' } });
    expect(new Date(a1.body.shiftStartAt).toISOString()).toBe('2026-10-20T00:00:00.000Z');
    expect(new Date(a1.body.shiftEndAt).toISOString()).toBe('2026-10-20T07:00:00.000Z');
    // 13:50 gần giờ vào ca chiều hơn ca sáng → ca chiều; ra 23:00 → tính đến 22:00 = 480 phút
    const a2 = await manual({ checkInAt: '2026-10-20T13:50:00+07:00', checkOutAt: '2026-10-20T23:00:00+07:00' });
    expect(a2.body).toMatchObject({ workShiftId: evening.id, minutes: 480 });
    // đi muộn / về sớm: tính đúng giờ có mặt
    expect((await manual({ checkInAt: '2026-10-21T07:20:00+07:00', checkOutAt: '2026-10-21T13:00:00+07:00' })).body).toMatchObject({ workShiftId: morning.id, minutes: 340 });
    // ngoài mọi ca (23:10–23:50) → không gắn ca, tính cả lượt, cờ OFF_SHIFT
    const off = await manual({ checkInAt: '2026-10-21T23:10:00+07:00', checkOutAt: '2026-10-21T23:50:00+07:00' });
    expect(off.body).toMatchObject({ workShiftId: null, minutes: 40, flags: ['OFF_SHIFT'] });
    // ca qua đêm (bật lại ca đêm): 21:45 → 06:30 hôm sau = 22:00–06:00 = 480 phút
    await t.http().patch(`${shifts}/${night.id}`).set(s.auth).send({ isActive: true });
    expect((await manual({ checkInAt: '2026-10-22T21:45:00+07:00', checkOutAt: '2026-10-23T06:30:00+07:00' })).body).toMatchObject({ workShiftId: night.id, minutes: 480 });
    // chọn rõ "không theo ca" → tính cả lượt
    expect((await manual({ checkInAt: '2026-10-24T06:40:00+07:00', checkOutAt: '2026-10-24T14:35:00+07:00', workShiftId: null })).body).toMatchObject({ workShiftId: null, minutes: 475 });

    // quản lý sửa: giờ ra sớm hơn → tính lại trong khung ca; bỏ ca → tính cả lượt; gắn ca cho lượt ngoài ca → bỏ cờ
    const e1 = await t.http().patch(`${api}/employees/attendance/${a1.body.id}`).set(s.auth).send({ checkOutAt: '2026-10-20T12:00:00+07:00' });
    expect(e1.body).toMatchObject({ workShiftId: morning.id, minutes: 300 });
    expect((await t.http().patch(`${api}/employees/attendance/${a1.body.id}`).set(s.auth).send({ workShiftId: null })).body).toMatchObject({ workShiftId: null, minutes: 320 });
    expect((await t.http().patch(`${api}/employees/attendance/${off.body.id}`).set(s.auth).send({ workShiftId: evening.id })).body).toMatchObject({ workShiftId: evening.id, minutes: 0, flags: [] });

    // đổi giờ ca không đổi lượt cũ
    await t.http().patch(`${shifts}/${evening.id}`).set(s.auth).send({ end: '21:00' });
    expect((await t.prisma.raw.attendance.findUniqueOrThrow({ where: { id: a2.body.id } })).minutes).toBe(480);

    // chấm công thật: chọn ca → lượt mang khung ca; ra ngay → giờ công không vượt thời gian có mặt
    await t.http().post(`${api}/employees/attendance/check-out`).set(cashierAuth).send({});
    const cur = await t.http().get(`${api}/employees/attendance/current`).set(cashierAuth);
    const br = cur.body.branches.find((b: any) => b.id === s.branchId);
    expect(br.shifts.map((x: any) => x.name).sort()).toEqual(['Ca chiều', 'Ca sáng', 'Ca đêm']);
    expect('suggestedShiftId' in br).toBe(true);
    const ci = await t.http().post(`${api}/employees/attendance/check-in`).set(cashierAuth).send({ branchId: s.branchId, workShiftId: morning.id });
    expect(ci.status).toBe(201);
    expect(ci.body.workShiftId).toBe(morning.id);
    expect(new Date(ci.body.shiftEndAt).getTime() - new Date(ci.body.shiftStartAt).getTime()).toBe(7 * 3600_000);
    expect((await t.http().get(`${api}/employees/attendance/current`).set(cashierAuth)).body.open.workShift.name).toBe('Ca sáng');
    const co = await t.http().post(`${api}/employees/attendance/check-out`).set(cashierAuth).send({});
    expect(co.body.minutes).toBeLessThanOrEqual(1);
    expect((await t.http().post(`${api}/employees/attendance/check-in`).set(cashierAuth).send({ branchId: s.branchId, workShiftId: '00000000-0000-4000-8000-000000000000' })).status).toBe(400);

    // xóa: ca chưa dùng → xóa hẳn; ca đã dùng → ngừng dùng, lượt cũ giữ nguyên
    const tmp = (await t.http().post(shifts).set(s.auth).send({ name: 'Ca tạm', start: '09:00', end: '12:00' })).body;
    expect((await t.http().delete(`${shifts}/${tmp.id}`).set(s.auth)).body).toEqual({ removed: true, deactivated: false });
    expect((await t.http().delete(`${shifts}/${morning.id}`).set(s.auth)).body).toEqual({ removed: false, deactivated: true });
    expect((await t.http().get(shifts).set(s.auth)).body.map((x: any) => x.name)).not.toContain('Ca sáng');
    expect((await t.prisma.raw.attendance.findUniqueOrThrow({ where: { id: ci.body.id } })).workShiftId).toBe(morning.id);
  });

  it('T-281 phạt đi trễ: mặc định tắt; cho phép trễ; phạt theo mức (lấy mức cao nhất) / theo phút; tắt phạt vẫn ghi phút trễ; quản lý sửa giờ vào tính lại, đặt 0 = miễn phạt; tổng hợp số lần trễ + tiền phạt', async () => {
    const policy = `${api}/employees/attendance/late-policy`;
    expect((await t.http().get(policy).set(s.auth)).body).toMatchObject({ enabled: false, graceMinutes: 5, mode: 'TIERS' });
    const tiers = { enabled: true, graceMinutes: 5, mode: 'TIERS', perMinute: 1000, tiers: [{ fromMinutes: 16, amount: 50000 }, { fromMinutes: 6, amount: 20000 }] };
    expect((await t.http().put(policy).set(cashierAuth).send(tiers)).status).toBe(403);
    expect((await t.http().put(policy).set(s.auth).send({ ...tiers, mode: 'X' })).status).toBe(400);
    expect((await t.http().put(policy).set(s.auth).send({ ...tiers, tiers: [] })).status).toBe(400);
    const saved = await t.http().put(policy).set(s.auth).send(tiers);
    expect(saved.status).toBe(200);
    expect(saved.body.tiers).toEqual([{ fromMinutes: 6, amount: 20000 }, { fromMinutes: 16, amount: 50000 }]);

    const ca = (await t.http().post(`${api}/employees/attendance/shifts`).set(s.auth).send({ name: 'Ca T281', start: '08:00', end: '16:00' })).body;
    const manual = (checkInAt: string) => t.http().post(`${api}/employees/attendance`).set(s.auth).send({ userId: cashierId, branchId: s.branchId, workShiftId: ca.id, checkInAt, checkOutAt: checkInAt.replace(/T\d\d:\d\d/, 'T16:30') });
    const onTime = (await manual('2026-09-01T08:04:00+07:00')).body; // trong 5 phút cho phép
    expect(onTime).toMatchObject({ lateMinutes: 0 });
    expect(Number(onTime.latePenalty)).toBe(0);
    const l10 = (await manual('2026-09-02T08:10:00+07:00')).body;
    expect(l10.lateMinutes).toBe(10);
    expect(Number(l10.latePenalty)).toBe(20000);
    expect(l10.minutes).toBe(470); // 08:10 → 16:00
    const l20 = (await manual('2026-09-03T08:20:00+07:00')).body;
    expect([l20.lateMinutes, Number(l20.latePenalty)]).toEqual([20, 50000]);
    // theo phút
    await t.http().put(policy).set(s.auth).send({ ...tiers, mode: 'PER_MINUTE', perMinute: 1000 });
    const pm = (await manual('2026-09-04T08:12:00+07:00')).body;
    expect([pm.lateMinutes, Number(pm.latePenalty)]).toEqual([12, 12000]);
    // tắt phạt: vẫn ghi phút trễ, không phạt
    await t.http().put(policy).set(s.auth).send({ ...tiers, enabled: false });
    const off = (await manual('2026-09-05T08:30:00+07:00')).body;
    expect([off.lateMinutes, Number(off.latePenalty)]).toEqual([30, 0]);
    // lượt không theo ca: không tính trễ
    const noShift = (await t.http().post(`${api}/employees/attendance`).set(s.auth).send({ userId: cashierId, workShiftId: null, checkInAt: '2026-09-06T09:00:00+07:00', checkOutAt: '2026-09-06T10:00:00+07:00' })).body;
    expect([noShift.lateMinutes, noShift.latePenalty]).toEqual([null, null]);

    // quản lý: sửa giờ vào → tính lại theo cấu hình hiện tại; đặt 0 = miễn phạt
    await t.http().put(policy).set(s.auth).send(tiers);
    const fixed = (await t.http().patch(`${api}/employees/attendance/${l20.id}`).set(s.auth).send({ checkInAt: '2026-09-03T08:00:00+07:00' })).body;
    expect([fixed.lateMinutes, Number(fixed.latePenalty)]).toEqual([0, 0]);
    const waived = (await t.http().patch(`${api}/employees/attendance/${l10.id}`).set(s.auth).send({ latePenalty: 0, note: 'kẹt xe, miễn phạt' })).body;
    expect([waived.lateMinutes, Number(waived.latePenalty)]).toEqual([10, 0]);

    // tổng hợp: số lần trễ (l10, pm, off) và tiền phạt (12.000)
    const sum = (await t.http().get(`${api}/employees/attendance`).set(s.auth).query({ userId: cashierId, from: '2026-09-01T00:00:00+07:00', to: '2026-09-30T23:59:59+07:00' })).body.summary[0];
    expect(sum).toMatchObject({ lateCount: 3, latePenalty: 12000 });
    const cur = (await t.http().get(`${api}/employees/attendance/current`).set(cashierAuth)).body;
    expect(cur.latePolicy).toMatchObject({ enabled: true, graceMinutes: 5 });
    expect(typeof cur.monthLatePenalty).toBe('number');
  });
});
