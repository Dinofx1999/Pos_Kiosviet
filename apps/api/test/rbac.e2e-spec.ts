import { createProduct, createTestApp, login, postReceipt, registerTenant, Session, TestApp } from './helpers';

describe('RBAC, branch scoping and tenant isolation (T-004..T-006)', () => {
  let t: TestApp;
  let a: Session;
  let b: Session;
  beforeAll(async () => { t = await createTestApp(); a = await registerTenant(t); b = await registerTenant(t); });
  afterAll(async () => { await t.close(); });

  it('T-004 tenant B cannot read or modify tenant A data', async () => {
    const p = await createProduct(t, a);
    expect((await t.http().get(`/api/v1/products/${p.productId}`).set(b.auth)).status).toBe(404);
    expect((await t.http().patch(`/api/v1/products/${p.productId}`).set(b.auth).send({ name: 'hacked' })).status).toBe(404);
    const list = await t.http().get('/api/v1/products').set(b.auth);
    expect(list.body.meta.total).toBe(0);
    // same SKU is allowed in another tenant
    const same = await t.http().post('/api/v1/products').set(b.auth).send({ name: 'x', variants: [{ sku: p.code, sellPrice: '1' }] });
    expect(same.status).toBe(201);
    // posting a receipt into tenant A's warehouse from tenant B fails
    const rec = await t.http().post('/api/v1/inventory/documents/post-now').set(b.auth).send({ type: 'RECEIPT', branchId: a.branchId, warehouseId: a.warehouseId, lines: [{ variantId: p.variantId, quantity: '1', unitCost: '1' }] });
    expect([403, 404]).toContain(rec.status);
  });

  it('T-005 permission guard: user without permission gets 403; granting a role enables access', async () => {
    const roles = await t.http().get('/api/v1/roles').set(a.auth);
    const cashier = roles.body.find((r: any) => r.code === 'CASHIER');
    const create = await t.http().post('/api/v1/users').set(a.auth).send({ username: 'cashier1', password: 'Secret123', fullName: 'Cashier', roleIds: [cashier.id], branchIds: [a.branchId] });
    expect(create.status).toBe(201);
    const lg = await login(t, a.tenantCode, 'cashier1', 'Secret123');
    const auth = { Authorization: `Bearer ${lg.body.accessToken}` };
    expect((await t.http().get('/api/v1/products').set(auth)).status).toBe(200);
    const denied = await t.http().post('/api/v1/products').set(auth).send({ name: 'x', variants: [{ sellPrice: '1' }] });
    expect(denied.status).toBe(403);
    expect(denied.body.code).toBe('FORBIDDEN');
    expect((await t.http().get('/api/v1/users').set(auth)).status).toBe(403);
    // cost is hidden without product.cost.view
    const p = await createProduct(t, a);
    const view = await t.http().get(`/api/v1/products/${p.productId}`).set(auth);
    expect(view.body.variants[0].costPrice).toBeUndefined();
    // grant a custom role with product.create
    const role = await t.http().post('/api/v1/roles').set(a.auth).send({ code: 'CUSTOM', name: 'Custom', permissions: ['product.view', 'product.create'] });
    expect(role.status).toBe(201);
    const badRole = await t.http().post('/api/v1/roles').set(a.auth).send({ code: 'BAD', name: 'Bad', permissions: ['nope.nothing'] });
    expect(badRole.status).toBe(400);
    await t.http().patch(`/api/v1/users/${create.body.id}`).set(a.auth).send({ roleIds: [cashier.id, role.body.id] });
    const allowed = await t.http().post('/api/v1/products').set(auth).send({ name: 'x', variants: [{ sellPrice: '1' }] });
    expect(allowed.status).toBe(201);
  });

  it('T-006 branch scoping: warehouse user limited to branch A cannot post in branch B', async () => {
    const br = await t.http().post('/api/v1/branches').set(a.auth).send({ code: 'CN02', name: 'Chi nhánh 2' });
    expect(br.status).toBe(201);
    const whB = br.body.warehouses[0];
    const roles = await t.http().get('/api/v1/roles').set(a.auth);
    const whRole = roles.body.find((r: any) => r.code === 'WAREHOUSE');
    const u = await t.http().post('/api/v1/users').set(a.auth).send({ username: 'wh1', password: 'Secret123', fullName: 'WH', roleIds: [whRole.id], branchIds: [a.branchId] });
    expect(u.status).toBe(201);
    const lg = await login(t, a.tenantCode, 'wh1', 'Secret123');
    const auth = { Authorization: `Bearer ${lg.body.accessToken}` };
    const p = await createProduct(t, a);
    const okA = await t.http().post('/api/v1/inventory/documents/post-now').set(auth).send({ type: 'RECEIPT', branchId: a.branchId, warehouseId: a.warehouseId, lines: [{ variantId: p.variantId, quantity: '1', unitCost: '1' }] });
    expect(okA.status).toBe(201);
    const deniedB = await t.http().post('/api/v1/inventory/documents/post-now').set(auth).send({ type: 'RECEIPT', branchId: br.body.id, warehouseId: whB.id, lines: [{ variantId: p.variantId, quantity: '1', unitCost: '1' }] });
    expect(deniedB.status).toBe(403);
    expect(deniedB.body.code).toBe('BRANCH_ACCESS_DENIED');
    // mixing branch A with warehouse of branch B is a validation error
    const mismatch = await t.http().post('/api/v1/inventory/documents/post-now').set(auth).send({ type: 'RECEIPT', branchId: a.branchId, warehouseId: whB.id, lines: [{ variantId: p.variantId, quantity: '1', unitCost: '1' }] });
    expect(mismatch.status).toBe(400);
    // documents list is filtered to accessible branches
    const ownerDocB = await postReceipt(t, a, [{ variantId: p.variantId, quantity: '1', unitCost: '1' }], { branchId: br.body.id, warehouseId: whB.id });
    expect(ownerDocB.status).toBe(201);
    const list = await t.http().get('/api/v1/inventory/documents').set(auth);
    expect(list.body.data.every((d: any) => d.branch.id === a.branchId)).toBe(true);
    const me = await t.http().get('/api/v1/auth/me').set(auth);
    expect(me.body.branches.map((x: any) => x.id)).toEqual([a.branchId]);
    // owner cannot be locked, user cannot lock self
    const lockOwner = await t.http().patch(`/api/v1/users/${a.userId}`).set(a.auth).send({ status: 'LOCKED' });
    expect(lockOwner.status).toBe(409);
  });

  it('audit log records user management actions and is queryable', async () => {
    const logs = await t.http().get('/api/v1/audit-logs').set(a.auth).query({ entityType: 'User' });
    expect(logs.status).toBe(200);
    expect(logs.body.data.some((l: any) => l.action === 'user.create')).toBe(true);
    const hist = await t.http().get('/api/v1/login-history').set(a.auth);
    expect(hist.body.data.length).toBeGreaterThan(0);
  });

  it('settings: only known keys, validated types; sequences configurable', async () => {
    const bad = await t.http().put('/api/v1/settings').set(a.auth).send({ settings: { 'inventory.allowNegativeStock': 'yes' } });
    expect(bad.status).toBe(400);
    const ok = await t.http().put('/api/v1/settings').set(a.auth).send({ settings: { 'inventory.allowNegativeStock': true } });
    expect(ok.status).toBe(200);
    expect(ok.body['inventory.allowNegativeStock']).toBe(true);
    const seq = await t.http().put('/api/v1/settings/sequences').set(a.auth).send({ items: [{ docType: 'INVENTORY_ISSUE', prefix: 'XH', padding: 4, resetPolicy: 'MONTHLY' }] });
    expect(seq.status).toBe(200);
    const p = await createProduct(t, a);
    const issue = await t.http().post('/api/v1/inventory/documents').set(a.auth).send({ type: 'ISSUE', reason: 'DAMAGE', branchId: a.branchId, warehouseId: a.warehouseId, lines: [{ variantId: p.variantId, quantity: '1' }] });
    expect(issue.status).toBe(201);
    expect(issue.body.code).toMatch(/^XH\d{6}-0001$/);
  });
});
