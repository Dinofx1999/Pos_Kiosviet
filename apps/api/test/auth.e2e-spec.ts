import { createTestApp, login, registerTenant, TestApp, uniqueCode } from './helpers';

describe('Auth & tenant registration (T-001..T-003)', () => {
  let t: TestApp;
  beforeAll(async () => { t = await createTestApp(); });
  afterAll(async () => { await t.close(); });

  it('T-001 registers a tenant with default branch, warehouse, ADMIN role and returns tokens', async () => {
    const s = await registerTenant(t);
    expect(s.token).toBeTruthy();
    const me = await t.http().get('/api/v1/auth/me').set(s.auth);
    expect(me.status).toBe(200);
    expect(me.body.permissions).toContain('*');
    expect(me.body.branches).toHaveLength(1);
    expect(me.body.branches[0].isDefault).toBe(true);
    expect(me.body.warehouses).toHaveLength(1);
    const roles = await t.prisma.raw.role.findMany({ where: { tenantId: s.tenantId } });
    expect(roles.map((r) => r.code).sort()).toEqual(['ADMIN', 'CASHIER', 'MANAGER', 'WAREHOUSE']);
  });

  it('rejects duplicate tenant code', async () => {
    const s = await registerTenant(t);
    const res = await t.http().post('/api/v1/auth/register-tenant').send({ tenantCode: s.tenantCode, tenantName: 'Shop X', ownerUsername: 'owner2', ownerPassword: 'Secret123', ownerFullName: 'O' });
    expect(res.status).toBe(409);
    expect(res.body.code).toBe('DUPLICATE_CODE');
  });

  it('T-003 login success/failure is recorded in login_history', async () => {
    const s = await registerTenant(t);
    const bad = await login(t, s.tenantCode, 'owner', 'wrong');
    expect(bad.status).toBe(401);
    expect(bad.body.code).toBe('INVALID_CREDENTIALS');
    const good = await login(t, s.tenantCode, 'owner', 'Secret123');
    expect(good.status).toBe(200);
    expect(good.body.accessToken).toBeTruthy();
    const hist = await t.prisma.raw.loginHistory.findMany({ where: { tenantId: s.tenantId }, orderBy: { createdAt: 'asc' } });
    expect(hist.map((h) => h.success)).toEqual([false, true]);
    expect(hist[0].reason).toBe('WRONG_PASSWORD');
  });

  it('T-002 refresh rotates tokens; reusing the old refresh token is rejected; logout revokes', async () => {
    const s = await registerTenant(t);
    const r1 = await t.http().post('/api/v1/auth/refresh').send({ refreshToken: s.refreshToken });
    expect(r1.status).toBe(200);
    expect(r1.body.refreshToken).not.toBe(s.refreshToken);
    // immediate reuse = a second browser tab refreshing with the same token (BR-05b): tolerated inside the grace window
    const reuse = await t.http().post('/api/v1/auth/refresh').send({ refreshToken: s.refreshToken });
    expect(reuse.status).toBe(200);
    expect(reuse.body.refreshToken).not.toBe(s.refreshToken);
    // after the grace window the same old token is a replay → rejected and the whole family revoked
    await t.prisma.raw.refreshToken.updateMany({ where: { userId: s.userId, revokedAt: { not: null } }, data: { revokedAt: new Date(Date.now() - 120_000) } });
    const replay = await t.http().post('/api/v1/auth/refresh').send({ refreshToken: s.refreshToken });
    expect(replay.status).toBe(401);
    expect(replay.body.code).toBe('REFRESH_TOKEN_REUSED');
    const r2 = await t.http().post('/api/v1/auth/refresh').send({ refreshToken: r1.body.refreshToken });
    expect(r2.status).toBe(401);
    const fresh = await login(t, s.tenantCode, 'owner', 'Secret123');
    const out = await t.http().post('/api/v1/auth/logout').send({ refreshToken: fresh.body.refreshToken });
    expect(out.status).toBe(204);
    const afterLogout = await t.http().post('/api/v1/auth/refresh').send({ refreshToken: fresh.body.refreshToken });
    expect(afterLogout.status).toBe(401);
  });

  it('rejects requests without token and with invalid token', async () => {
    expect((await t.http().get('/api/v1/auth/me')).status).toBe(401);
    expect((await t.http().get('/api/v1/auth/me').set('Authorization', 'Bearer nope')).status).toBe(401);
  });

  it('change-password invalidates refresh tokens', async () => {
    const s = await registerTenant(t);
    const res = await t.http().post('/api/v1/auth/change-password').set(s.auth).send({ currentPassword: 'Secret123', newPassword: 'NewPass456' });
    expect(res.status).toBe(204);
    expect((await login(t, s.tenantCode, 'owner', 'Secret123')).status).toBe(401);
    expect((await login(t, s.tenantCode, 'owner', 'NewPass456')).status).toBe(200);
    expect((await t.http().post('/api/v1/auth/refresh').send({ refreshToken: s.refreshToken })).status).toBe(401);
  });

  it('validates registration payload', async () => {
    const res = await t.http().post('/api/v1/auth/register-tenant').send({ tenantCode: 'BAD CODE', tenantName: '', ownerUsername: 'x', ownerPassword: '1', ownerFullName: '' });
    expect(res.status).toBe(400);
    expect(res.body.code).toBe('VALIDATION_ERROR');
    void uniqueCode;
  });
});
