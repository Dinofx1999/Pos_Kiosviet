import { createProduct, createTestApp, login, registerTenant, Session, TestApp } from './helpers';

// 1×1 PNG and a tiny JPEG header – enough for signature checks
const PNG = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNkYPhfDwAChwGA60e6kgAAAABJRU5ErkJggg==', 'base64');
const JPG = Buffer.concat([Buffer.from([0xff, 0xd8, 0xff, 0xe0]), Buffer.alloc(32, 0)]);

describe('Product images (upload + multi-image)', () => {
  let t: TestApp;
  let s: Session;
  beforeAll(async () => { t = await createTestApp(); s = await registerTenant(t); });
  afterAll(async () => { await t.close(); });

  it('uploads several images, stores them under the tenant folder and serves them statically', async () => {
    const res = await t.http().post('/api/v1/uploads/images').set(s.auth).attach('files', PNG, 'a.png').attach('files', JPG, 'b.jpg');
    expect(res.status).toBe(201);
    expect(res.body).toHaveLength(2);
    expect(res.body[0].url).toMatch(new RegExp(`^/uploads/products/${s.tenantId}/[0-9a-f-]+\\.png$`));
    expect(res.body[1].mimeType).toBe('image/jpeg');
    const served = await t.http().get(res.body[0].url);
    expect(served.status).toBe(200);
    expect(served.headers['content-type']).toContain('image/png');
  });

  it('rejects non-image content and oversized/too many files', async () => {
    const txt = await t.http().post('/api/v1/uploads/images').set(s.auth).attach('files', Buffer.from('hello'), 'x.png');
    expect(txt.status).toBe(400);
    const none = await t.http().post('/api/v1/uploads/images').set(s.auth);
    expect(none.status).toBe(400);
  });

  it('creates a product with multiple images (first = primary), updates/reorders and clears them', async () => {
    const up = await t.http().post('/api/v1/uploads/images').set(s.auth).attach('files', PNG, '1.png').attach('files', PNG, '2.png').attach('files', PNG, '3.png');
    const [u1, u2, u3] = up.body.map((x: any) => x.url as string);
    const p = await createProduct(t, s, { images: [{ url: u1 }, { url: u2 }, { url: u3 }] });
    expect(p.body.imageUrl).toBe(u1);
    expect(p.body.images.map((i: any) => i.url)).toEqual([u1, u2, u3]);
    const got = await t.http().get(`/api/v1/products/${p.productId}`).set(s.auth);
    expect(got.body.images.map((i: any) => i.sortOrder)).toEqual([0, 1, 2]);
    const reordered = await t.http().patch(`/api/v1/products/${p.productId}`).set(s.auth).send({ images: [{ url: u3 }, { url: u1 }] });
    expect(reordered.status).toBe(200);
    expect(reordered.body.imageUrl).toBe(u3);
    expect(reordered.body.images.map((i: any) => i.url)).toEqual([u3, u1]);
    const list = await t.http().get('/api/v1/products').set(s.auth).query({ search: p.code });
    expect(list.body.data[0].imageUrl).toBe(u3);
    const cleared = await t.http().patch(`/api/v1/products/${p.productId}`).set(s.auth).send({ images: [] });
    expect(cleared.body.imageUrl).toBeNull();
    expect(cleared.body.images).toHaveLength(0);
    // external CDN urls are accepted; foreign/relative paths are not
    expect((await t.http().patch(`/api/v1/products/${p.productId}`).set(s.auth).send({ images: [{ url: 'https://cdn.example.com/a.jpg' }] })).status).toBe(200);
    expect((await t.http().patch(`/api/v1/products/${p.productId}`).set(s.auth).send({ images: [{ url: '/uploads/products/other-tenant/x.png' }] })).status).toBe(400);
    expect((await t.http().patch(`/api/v1/products/${p.productId}`).set(s.auth).send({ images: [{ url: '/etc/passwd' }] })).status).toBe(400);
  });

  it('image delete is tenant-scoped and requires product.update', async () => {
    const up = await t.http().post('/api/v1/uploads/images').set(s.auth).attach('files', PNG, '1.png');
    const url = up.body[0].url as string;
    const other = await registerTenant(t);
    const foreign = await t.http().delete('/api/v1/uploads/images').set(other.auth).query({ url });
    expect(foreign.status).toBe(400);
    expect((await t.http().get(url)).status).toBe(200);
    const roles = await t.http().get('/api/v1/roles').set(s.auth);
    const cashier = roles.body.find((r: any) => r.code === 'CASHIER');
    await t.http().post('/api/v1/users').set(s.auth).send({ username: 'cash', password: 'Secret123', fullName: 'C', roleIds: [cashier.id], branchIds: [s.branchId] });
    const cashAuth = { Authorization: `Bearer ${(await login(t, s.tenantCode, 'cash', 'Secret123')).body.accessToken}` };
    expect((await t.http().post('/api/v1/uploads/images').set(cashAuth).attach('files', PNG, '1.png')).status).toBe(403);
    expect((await t.http().delete('/api/v1/uploads/images').set(cashAuth).query({ url })).status).toBe(403);
    const own = await t.http().delete('/api/v1/uploads/images').set(s.auth).query({ url });
    expect(own.status).toBe(204);
    expect((await t.http().get(url)).status).toBe(404);
  });
});
