import { balanceOf, createProduct, createTestApp, postIssue, postReceipt, registerTenant, Session, TestApp } from './helpers';

describe('Concurrency (T-024)', () => {
  let t: TestApp;
  let s: Session;
  beforeAll(async () => { t = await createTestApp(); s = await registerTenant(t); });
  afterAll(async () => { await t.close(); });

  it('two concurrent issues of the last unit → exactly one succeeds', async () => {
    const p = await createProduct(t, s);
    await postReceipt(t, s, [{ variantId: p.variantId, quantity: '1', unitCost: '10' }]);
    const results = await Promise.all([
      postIssue(t, s, [{ variantId: p.variantId, quantity: '1' }]),
      postIssue(t, s, [{ variantId: p.variantId, quantity: '1' }]),
    ]);
    const statuses = results.map((r) => r.status).sort();
    expect(statuses).toEqual([201, 409]);
    expect(results.find((r) => r.status === 409)!.body.code).toBe('INSUFFICIENT_STOCK');
    expect((await balanceOf(t, s, p.variantId)).onHand).toBe('0');
    expect(await t.prisma.raw.stockMovement.count({ where: { variantId: p.variantId, type: 'ISSUE' } })).toBe(1);
  });

  it('20 parallel issues against 10 units → exactly 10 succeed and ledger stays consistent', async () => {
    const p = await createProduct(t, s);
    await postReceipt(t, s, [{ variantId: p.variantId, quantity: '10', unitCost: '10' }]);
    const results = await Promise.all(Array.from({ length: 20 }, () => postIssue(t, s, [{ variantId: p.variantId, quantity: '1' }])));
    expect(results.filter((r) => r.status === 201)).toHaveLength(10);
    expect(results.filter((r) => r.status === 409)).toHaveLength(10);
    expect((await balanceOf(t, s, p.variantId)).onHand).toBe('0');
    const rec = await t.http().post('/api/v1/inventory/reconcile').set(s.auth);
    expect(rec.body.ok).toBe(true);
  });

  it('parallel receipts on two products in opposite line order do not deadlock', async () => {
    const a = await createProduct(t, s);
    const b = await createProduct(t, s);
    const results = await Promise.all(Array.from({ length: 8 }, (_, i) =>
      postReceipt(t, s, i % 2 === 0
        ? [{ variantId: a.variantId, quantity: '1', unitCost: '1' }, { variantId: b.variantId, quantity: '1', unitCost: '1' }]
        : [{ variantId: b.variantId, quantity: '1', unitCost: '1' }, { variantId: a.variantId, quantity: '1', unitCost: '1' }])));
    expect(results.every((r) => r.status === 201)).toBe(true);
    expect((await balanceOf(t, s, a.variantId)).onHand).toBe('8');
    expect((await balanceOf(t, s, b.variantId)).onHand).toBe('8');
    const codes = results.map((r) => r.body.code);
    expect(new Set(codes).size).toBe(8);
  });

  it('concurrent product creation yields unique sequential codes', async () => {
    const results = await Promise.all(Array.from({ length: 10 }, () => t.http().post('/api/v1/products').set(s.auth).send({ name: 'par', variants: [{ sellPrice: '1' }] })));
    expect(results.every((r) => r.status === 201)).toBe(true);
    const codes = results.map((r) => r.body.code);
    expect(new Set(codes).size).toBe(10);
  });
});
