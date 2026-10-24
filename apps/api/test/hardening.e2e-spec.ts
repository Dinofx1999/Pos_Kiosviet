import { randomUUID } from 'node:crypto';
import { balanceOf, createProduct, createTestApp, login, postIssue, postReceipt, registerTenant, Session, TestApp } from './helpers';

/** Regression tests for the defects found in the session-1 code review (scope bypass, TOCTOU, idempotency, validation). */
describe('Hardening (review findings)', () => {
  let t: TestApp;
  let a: Session;
  let b: Session;
  let branchB: any;
  let whB: any;
  let whAuth: { Authorization: string };
  beforeAll(async () => {
    t = await createTestApp();
    a = await registerTenant(t);
    b = await registerTenant(t);
    branchB = (await t.http().post('/api/v1/branches').set(a.auth).send({ code: 'CN02', name: 'Chi nhánh B' })).body;
    whB = branchB.warehouses[0];
    const roles = await t.http().get('/api/v1/roles').set(a.auth);
    const whRole = roles.body.find((r: any) => r.code === 'WAREHOUSE');
    await t.http().post('/api/v1/users').set(a.auth).send({ username: 'whuser', password: 'Secret123', fullName: 'WH', roleIds: [whRole.id], branchIds: [a.branchId] });
    const lg = await login(t, a.tenantCode, 'whuser', 'Secret123');
    whAuth = { Authorization: `Bearer ${lg.body.accessToken}` };
  });
  afterAll(async () => { await t.close(); });

  it('H1: explicit warehouseId/branchId filters cannot widen the access scope', async () => {
    const p = await createProduct(t, a);
    const rec = await postReceipt(t, a, [{ variantId: p.variantId, quantity: '5', unitCost: '10' }], { branchId: branchB.id, warehouseId: whB.id });
    expect(rec.status).toBe(201);
    const bal = await t.http().get('/api/v1/inventory/balances').set(whAuth).query({ warehouseId: whB.id });
    expect(bal.status).toBe(200);
    expect(bal.body.meta.total).toBe(0);
    const mov = await t.http().get('/api/v1/inventory/movements').set(whAuth).query({ warehouseId: whB.id });
    expect(mov.body.meta.total).toBe(0);
    const docs = await t.http().get('/api/v1/inventory/documents').set(whAuth).query({ branchId: branchB.id });
    expect(docs.body.meta.total).toBe(0);
    const res = await t.http().get('/api/v1/inventory/reservations').set(whAuth).query({ warehouseId: whB.id });
    expect(res.body.meta.total).toBe(0);
    const sum = await t.http().get('/api/v1/inventory/balances/summary').set(whAuth).query({ warehouseId: whB.id });
    expect(sum.body.skuCount).toBe(0);
    const prods = await t.http().get('/api/v1/products').set(whAuth).query({ warehouseId: whB.id });
    expect(prods.status).toBe(403);
    const dash = await t.http().get('/api/v1/dashboard/overview').set(whAuth);
    expect(dash.body.recentDocuments.every((d: any) => d.branchId === a.branchId)).toBe(true);
    // owner still sees branch B
    const ownerBal = await t.http().get('/api/v1/inventory/balances').set(a.auth).query({ warehouseId: whB.id });
    expect(ownerBal.body.meta.total).toBe(1);
  });

  it('M2: a user restricted to one warehouse cannot post/cancel documents of another warehouse in the same branch', async () => {
    const wh2 = (await t.http().post('/api/v1/warehouses').set(a.auth).send({ branchId: a.branchId, code: 'KHO-A2', name: 'Kho A2' })).body;
    const roles = await t.http().get('/api/v1/roles').set(a.auth);
    const whRole = roles.body.find((r: any) => r.code === 'WAREHOUSE');
    await t.http().post('/api/v1/users').set(a.auth).send({ username: 'onlywh1', password: 'Secret123', fullName: 'W1', roleIds: [whRole.id], branchIds: [a.branchId], warehouseIds: [a.warehouseId] });
    const auth = { Authorization: `Bearer ${(await login(t, a.tenantCode, 'onlywh1', 'Secret123')).body.accessToken}` };
    const p = await createProduct(t, a);
    const draft = await t.http().post('/api/v1/inventory/documents').set(a.auth).send({ type: 'RECEIPT', branchId: a.branchId, warehouseId: wh2.id, lines: [{ variantId: p.variantId, quantity: '1', unitCost: '1' }] });
    expect(draft.status).toBe(201);
    const post = await t.http().post(`/api/v1/inventory/documents/${draft.body.id}/post`).set(auth);
    expect(post.status).toBe(403);
    expect(post.body.code).toBe('WAREHOUSE_ACCESS_DENIED');
    const del = await t.http().delete(`/api/v1/inventory/documents/${draft.body.id}`).set(auth);
    expect(del.status).toBe(403);
    const ownDraft = await t.http().post('/api/v1/inventory/documents').set(auth).send({ type: 'RECEIPT', branchId: a.branchId, warehouseId: a.warehouseId, lines: [{ variantId: p.variantId, quantity: '1', unitCost: '1' }] });
    expect(ownDraft.status).toBe(201);
    expect((await t.http().post(`/api/v1/inventory/documents/${ownDraft.body.id}/post`).set(auth)).status).toBe(200);
  });

  it('H2: adjustment delta is computed under the row lock (sale committed while the adjustment waits)', async () => {
    const p = await createProduct(t, a);
    await postReceipt(t, a, [{ variantId: p.variantId, quantity: '10', unitCost: '1' }]);
    const draft = await t.http().post('/api/v1/inventory/documents').set(a.auth).send({ type: 'ADJUSTMENT', reason: 'COUNT', branchId: a.branchId, warehouseId: a.warehouseId, lines: [{ variantId: p.variantId, actualQuantity: '8' }] });
    expect(draft.status).toBe(201);
    // Hold the variant row lock in a raw transaction, start the adjustment post (it must block on the lock),
    // commit an ISSUE first (needs the same lock → runs when we release), then let everything through.
    let release!: () => void;
    const gate = new Promise<void>((r) => (release = r));
    const holder = t.prisma.raw.$transaction(async (tx) => {
      await tx.$queryRaw`SELECT id FROM product_variants WHERE id = ${p.variantId}::uuid FOR UPDATE`;
      await gate;
    }, { timeout: 20000 });
    await new Promise((r) => setTimeout(r, 200));
    const adjustment = t.http().post(`/api/v1/inventory/documents/${draft.body.id}/post`).set(a.auth);
    await new Promise((r) => setTimeout(r, 300));
    const issue = postIssue(t, a, [{ variantId: p.variantId, quantity: '5' }]);
    await new Promise((r) => setTimeout(r, 300));
    release();
    await holder;
    const [adj, iss] = await Promise.all([adjustment, issue]);
    expect(iss.status).toBe(201);
    expect(adj.status).toBe(200);
    const final = await balanceOf(t, a, p.variantId);
    // whichever order Postgres granted the lock, the posted systemQuantity must equal the on-hand the delta was applied to
    const sys = Number(adj.body.lines[0].systemQuantity);
    const delta = Number(adj.body.lines[0].quantity);
    expect(8 - sys).toBe(delta);
    expect([3, 8]).toContain(Number(final.onHand)); // adjustment first → 8 then −5 = 3; issue first → system 5 → final 8
    const rec = await t.http().post('/api/v1/inventory/reconcile').set(a.auth);
    expect(rec.body.ok).toBe(true);
  });

  it('M4: issues respect reserved stock (available), reversals too', async () => {
    const p = await createProduct(t, a);
    await postReceipt(t, a, [{ variantId: p.variantId, quantity: '5', unitCost: '1' }]);
    const r = await t.http().post('/api/v1/inventory/reservations').set(a.auth).send({ warehouseId: a.warehouseId, variantId: p.variantId, quantity: '4', documentType: 'SALES_ORDER', documentId: randomUUID() });
    expect(r.status).toBe(201);
    const tooMuch = await postIssue(t, a, [{ variantId: p.variantId, quantity: '2' }]);
    expect(tooMuch.status).toBe(409);
    expect(tooMuch.body.details.available).toBe('1');
    expect((await postIssue(t, a, [{ variantId: p.variantId, quantity: '1' }])).status).toBe(201);
    await t.http().post(`/api/v1/inventory/reservations/${r.body.id}/release`).set(a.auth);
    expect((await postIssue(t, a, [{ variantId: p.variantId, quantity: '2' }])).status).toBe(201);
  });

  it('M1: reservations validate batch/variant/tenant and release requires warehouse access', async () => {
    await t.http().put('/api/v1/settings').set(a.auth).send({ settings: { 'inventory.allowNegativeStock': true } });
    const plain = await createProduct(t, a);
    const batched = await createProduct(t, a, { trackBatch: true, variants: [{ sellPrice: '1' }] });
    const batch = (await t.http().post(`/api/v1/variants/${batched.variantId}/batches`).set(a.auth).send({ batchNo: 'L1' })).body;
    const foreignBatch = await createProduct(t, b, { trackBatch: true, variants: [{ sellPrice: '1' }] });
    const fb = (await t.http().post(`/api/v1/variants/${foreignBatch.variantId}/batches`).set(b.auth).send({ batchNo: 'FB' })).body;
    const base = { warehouseId: a.warehouseId, documentType: 'SALES_ORDER', documentId: randomUUID(), quantity: '1' };
    expect((await t.http().post('/api/v1/inventory/reservations').set(a.auth).send({ ...base, variantId: plain.variantId, batchId: batch.id })).body.code).toBe('BATCH_NOT_ALLOWED');
    expect((await t.http().post('/api/v1/inventory/reservations').set(a.auth).send({ ...base, variantId: batched.variantId })).body.code).toBe('BATCH_REQUIRED');
    expect((await t.http().post('/api/v1/inventory/reservations').set(a.auth).send({ ...base, variantId: batched.variantId, batchId: fb.id })).status).toBe(404);
    expect(await t.prisma.raw.stockBalance.count({ where: { tenantId: a.tenantId, batchId: fb.id } })).toBe(0);
    const ok = await t.http().post('/api/v1/inventory/reservations').set(a.auth).send({ ...base, variantId: batched.variantId, batchId: batch.id });
    expect(ok.status).toBe(201);
    // whuser has access to branch A only; a reservation in branch B cannot be released by them
    const pB = await createProduct(t, a);
    await postReceipt(t, a, [{ variantId: pB.variantId, quantity: '3', unitCost: '1' }], { branchId: branchB.id, warehouseId: whB.id });
    const rB = await t.http().post('/api/v1/inventory/reservations').set(a.auth).send({ warehouseId: whB.id, variantId: pB.variantId, quantity: '1', documentType: 'SALES_ORDER', documentId: randomUUID() });
    expect(rB.status).toBe(201);
    expect((await t.http().post(`/api/v1/inventory/reservations/${rB.body.id}/release`).set(whAuth)).status).toBe(403);
    await t.http().put('/api/v1/settings').set(a.auth).send({ settings: { 'inventory.allowNegativeStock': false } });
  });

  it('M3: concurrent identical requests with one key → one document; keys are per user; expired keys are reclaimed', async () => {
    const p = await createProduct(t, a);
    const key = randomUUID();
    const body = [{ variantId: p.variantId, quantity: '1', unitCost: '1' }];
    const results = await Promise.all(Array.from({ length: 4 }, () => postReceipt(t, a, body, {}, { 'Idempotency-Key': key })));
    const created = results.filter((r) => r.status === 201 && r.headers['idempotent-replayed'] !== 'true');
    expect(created).toHaveLength(1);
    expect(results.every((r) => r.status === 201 || r.body.code === 'IDEMPOTENCY_IN_PROGRESS')).toBe(true);
    expect((await balanceOf(t, a, p.variantId)).onHand).toBe('1');
    // same key + payload from another user is NOT a replay of the first user's response
    const roles = await t.http().get('/api/v1/roles').set(a.auth);
    const mgr = roles.body.find((r: any) => r.code === 'MANAGER');
    await t.http().post('/api/v1/users').set(a.auth).send({ username: 'mgr1', password: 'Secret123', fullName: 'M', roleIds: [mgr.id], allBranches: true });
    const mgrAuth = { Authorization: `Bearer ${(await login(t, a.tenantCode, 'mgr1', 'Secret123')).body.accessToken}` };
    const other = await t.http().post('/api/v1/inventory/documents/post-now').set(mgrAuth).set('Idempotency-Key', key).send({ type: 'RECEIPT', branchId: a.branchId, warehouseId: a.warehouseId, lines: body });
    expect(other.status).toBe(201);
    expect(other.headers['idempotent-replayed']).toBeUndefined();
    expect(other.body.id).not.toBe(created[0].body.id);
    // expired key → treated as a new request
    await t.prisma.raw.idempotencyKey.updateMany({ where: { tenantId: a.tenantId, key }, data: { expiresAt: new Date(Date.now() - 1000) } });
    const again = await postReceipt(t, a, body, {}, { 'Idempotency-Key': key });
    expect(again.status).toBe(201);
    expect(again.headers['idempotent-replayed']).toBeUndefined();
    expect((await balanceOf(t, a, p.variantId)).onHand).toBe('3');
  });

  it('M6: concurrent refresh with one token (two tabs, BR-05b) → both get a fresh pair, old token is dead afterwards', async () => {
    const s = await registerTenant(t);
    const results = await Promise.all([
      t.http().post('/api/v1/auth/refresh').send({ refreshToken: s.refreshToken }),
      t.http().post('/api/v1/auth/refresh').send({ refreshToken: s.refreshToken }),
    ]);
    expect(results.map((r) => r.status)).toEqual([200, 200]);
    expect(results[0].body.refreshToken).not.toBe(results[1].body.refreshToken);
    // both new tokens are usable
    for (const r of results) expect((await t.http().post('/api/v1/auth/refresh').send({ refreshToken: r.body.refreshToken })).status).toBe(200);
    // the original token, replayed after the grace window, kills the family
    await t.prisma.raw.refreshToken.updateMany({ where: { userId: s.userId, revokedAt: { not: null } }, data: { revokedAt: new Date(Date.now() - 120_000) } });
    expect((await t.http().post('/api/v1/auth/refresh').send({ refreshToken: s.refreshToken })).body.code).toBe('REFRESH_TOKEN_REUSED');
    expect(await t.prisma.raw.refreshToken.count({ where: { userId: s.userId, revokedAt: null } })).toBe(0);
    expect((await t.http().get('/api/v1/auth/me').set('Authorization', `Bearer ${s.token}`).query({ access_token: s.token })).status).toBe(200);
    expect((await t.http().get('/api/v1/auth/me').query({ access_token: s.token })).status).toBe(401);
  });

  it('M7: price books reject branch ids of another tenant', async () => {
    const res = await t.http().post('/api/v1/price-books').set(b.auth).send({ code: 'PB1', name: 'x', branchIds: [a.branchId] });
    expect(res.status).toBe(400);
    const ok = await t.http().post('/api/v1/price-books').set(b.auth).send({ code: 'PB1', name: 'x', branchIds: [b.branchId] });
    expect(ok.status).toBe(201);
  });

  it('validation: bad enums/dates/negative numbers return 400, not 500', async () => {
    expect((await t.http().get('/api/v1/inventory/movements').set(a.auth).query({ type: 'FOO' })).status).toBe(400);
    expect((await t.http().get('/api/v1/inventory/movements').set(a.auth).query({ from: 'garbage' })).status).toBe(400);
    expect((await t.http().get('/api/v1/audit-logs').set(a.auth).query({ from: 'garbage' })).status).toBe(400);
    expect((await t.http().post('/api/v1/products').set(a.auth).send({ name: 'neg', variants: [{ sellPrice: '-5' }] })).status).toBe(400);
    expect((await t.http().post('/api/v1/products').set(a.auth).send({ name: 'exp', variants: [{ sellPrice: '1e5' }] })).status).toBe(400);
    expect((await t.http().post('/api/v1/products').set(a.auth).send({ name: 'tax', taxRate: '999', variants: [{ sellPrice: '1' }] })).status).toBe(400);
    const comp = await createProduct(t, a);
    expect((await t.http().post('/api/v1/products').set(a.auth).send({ name: 'c0', type: 'COMBO', variants: [{ sellPrice: '1' }], comboItems: [{ componentVariantId: comp.variantId, quantity: '0' }] })).status).toBe(400);
    const p = await createProduct(t, a);
    expect((await postIssue(t, a, [{ variantId: p.variantId, quantity: '1' }], { reason: 'OPENING' })).status).toBe(400);
    expect((await t.http().post('/api/v1/inventory/documents').set(a.auth).send({ type: 'ADJUSTMENT', branchId: a.branchId, warehouseId: a.warehouseId, lines: [{ variantId: p.variantId, quantity: '0' }] })).status).toBe(400);
    expect((await t.http().put('/api/v1/settings/sequences').set(a.auth).send({ items: [{ docType: 'PRODUCT', prefix: 'SP', padding: 99, resetPolicy: 'NEVER' }] })).status).toBe(400);
    expect((await t.http().get('/api/v1/products/search').set(a.auth).query({ q: 'x', warehouseId: 'not-a-uuid' })).status).toBe(400);
    // barcode is trimmed so scanner lookups match
    const trimmed = await createProduct(t, a, { variants: [{ sellPrice: '1', barcode: ' 7770001 ' }] });
    expect(trimmed.body.variants[0].barcode).toBe('7770001');
    expect((await t.http().get('/api/v1/products/by-barcode/7770001').set(a.auth)).status).toBe(200);
  });
});
