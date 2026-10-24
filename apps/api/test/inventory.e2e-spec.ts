import { randomUUID } from 'node:crypto';
import { balanceOf, createProduct, createTestApp, postIssue, postReceipt, registerTenant, Session, TestApp } from './helpers';

describe('Inventory core (T-020..T-041)', () => {
  let t: TestApp;
  let s: Session;
  beforeAll(async () => { t = await createTestApp(); s = await registerTenant(t); });
  afterAll(async () => { await t.close(); });

  it('T-020/T-021 receipt posts balance, movement, cost ledger; second receipt averages; issue uses avg', async () => {
    const p = await createProduct(t, s, { variants: [{ sellPrice: '200', costPrice: '0' }] });
    const r1 = await postReceipt(t, s, [{ variantId: p.variantId, quantity: '10', unitCost: '100' }]);
    expect(r1.status).toBe(201);
    expect(r1.body.status).toBe('POSTED');
    expect(r1.body.code).toMatch(/^NK\d{6}$/);
    expect(r1.body.totalCost).toBe('1000');
    let b = await balanceOf(t, s, p.variantId);
    expect(b).toMatchObject({ onHand: '10', costPrice: '100', onHandTotal: '10' });

    const r2 = await postReceipt(t, s, [{ variantId: p.variantId, quantity: '10', unitCost: '200' }]);
    expect(r2.status).toBe(201);
    b = await balanceOf(t, s, p.variantId);
    expect(b).toMatchObject({ onHand: '20', costPrice: '150' });

    const i1 = await postIssue(t, s, [{ variantId: p.variantId, quantity: '5' }]);
    expect(i1.status).toBe(201);
    expect(i1.body.lines[0].unitCost).toBe('150');
    expect(i1.body.totalCost).toBe('750');
    b = await balanceOf(t, s, p.variantId);
    expect(b).toMatchObject({ onHand: '15', costPrice: '150' });

    const movements = await t.prisma.raw.stockMovement.findMany({ where: { variantId: p.variantId }, orderBy: { createdAt: 'asc' } });
    expect(movements.map((m) => `${m.type}:${m.quantity}:${m.balanceAfter}`)).toEqual(['RECEIPT:10:10', 'RECEIPT:10:20', 'ISSUE:-5:15']);
    const ledger = await t.prisma.raw.costLedgerEntry.findMany({ where: { variantId: p.variantId }, orderBy: { createdAt: 'asc' } });
    expect(ledger.map((l) => `${l.avgCostBefore}->${l.avgCostAfter}`)).toEqual(['0->100', '100->150', '150->150']);
    const value = ledger.reduce((sum, l) => sum + Number(l.valueDelta), 0);
    expect(value).toBe(15 * 150);
  });

  it('T-022 issuing more than on-hand is rejected atomically (no movements written)', async () => {
    const p = await createProduct(t, s);
    await postReceipt(t, s, [{ variantId: p.variantId, quantity: '3', unitCost: '10' }]);
    const before = await t.prisma.raw.stockMovement.count({ where: { tenantId: s.tenantId } });
    const res = await postIssue(t, s, [{ variantId: p.variantId, quantity: '5' }]);
    expect(res.status).toBe(409);
    expect(res.body.code).toBe('INSUFFICIENT_STOCK');
    expect(res.body.details.onHand).toBe('3');
    expect(await t.prisma.raw.stockMovement.count({ where: { tenantId: s.tenantId } })).toBe(before);
    expect((await balanceOf(t, s, p.variantId)).onHand).toBe('3');
    // the failed post-now must not leave a document behind either
    const docs = await t.prisma.raw.inventoryDocument.count({ where: { tenantId: s.tenantId, type: 'ISSUE', status: 'DRAFT' } });
    expect(docs).toBe(0);
  });

  it('T-023 allowNegativeStock=true permits negative on-hand', async () => {
    const s2 = await registerTenant(t);
    await t.http().put('/api/v1/settings').set(s2.auth).send({ settings: { 'inventory.allowNegativeStock': true } });
    const p = await createProduct(t, s2, { variants: [{ sellPrice: '1', costPrice: '40' }] });
    const res = await postIssue(t, s2, [{ variantId: p.variantId, quantity: '2' }]);
    expect(res.status).toBe(201);
    expect((await balanceOf(t, s2, p.variantId)).onHand).toBe('-2');
    // receipt after negative resets avg cost to unit cost (BR-31)
    await postReceipt(t, s2, [{ variantId: p.variantId, quantity: '5', unitCost: '50' }]);
    expect(await balanceOf(t, s2, p.variantId)).toMatchObject({ onHand: '3', costPrice: '50' });
  });

  it('T-025/T-026 Idempotency-Key: duplicate request replays, different payload is rejected', async () => {
    const p = await createProduct(t, s);
    const key = randomUUID();
    const r1 = await postReceipt(t, s, [{ variantId: p.variantId, quantity: '4', unitCost: '10' }], {}, { 'Idempotency-Key': key });
    expect(r1.status).toBe(201);
    const r2 = await postReceipt(t, s, [{ variantId: p.variantId, quantity: '4', unitCost: '10' }], {}, { 'Idempotency-Key': key });
    expect(r2.status).toBe(201);
    expect(r2.headers['idempotent-replayed']).toBe('true');
    expect(r2.body.id).toBe(r1.body.id);
    expect((await balanceOf(t, s, p.variantId)).onHand).toBe('4');
    expect(await t.prisma.raw.inventoryDocument.count({ where: { tenantId: s.tenantId, code: r1.body.code } })).toBe(1);
    const r3 = await postReceipt(t, s, [{ variantId: p.variantId, quantity: '99', unitCost: '10' }], {}, { 'Idempotency-Key': key });
    expect(r3.status).toBe(409);
    expect(r3.body.code).toBe('IDEMPOTENCY_KEY_REUSED');
    // a failed request releases the key so the client can retry with a corrected payload
    const bad = await postIssue(t, s, [{ variantId: p.variantId, quantity: '999' }], {}, { 'Idempotency-Key': 'retry-' + key });
    expect(bad.status).toBe(409);
    const retry = await postIssue(t, s, [{ variantId: p.variantId, quantity: '1' }], {}, { 'Idempotency-Key': 'retry-' + key });
    expect(retry.status).toBe(201);
  });

  it('T-027/T-028 cancelling a posted receipt writes reversals; cannot cancel twice; cannot cancel if stock was consumed', async () => {
    const p = await createProduct(t, s);
    const base = await postReceipt(t, s, [{ variantId: p.variantId, quantity: '10', unitCost: '100' }]);
    const extra = await postReceipt(t, s, [{ variantId: p.variantId, quantity: '10', unitCost: '200' }]);
    expect(await balanceOf(t, s, p.variantId)).toMatchObject({ onHand: '20', costPrice: '150' });
    const cancel = await t.http().post(`/api/v1/inventory/documents/${extra.body.id}/cancel`).set(s.auth).send({ reason: 'Nhập nhầm' });
    expect(cancel.status).toBe(200);
    expect(cancel.body.status).toBe('CANCELLED');
    expect(await balanceOf(t, s, p.variantId)).toMatchObject({ onHand: '10', costPrice: '100' });
    const reversals = await t.prisma.raw.stockMovement.findMany({ where: { documentId: extra.body.id, type: 'REVERSAL' } });
    expect(reversals).toHaveLength(1);
    expect(reversals[0].quantity.toString()).toBe('-10');
    expect(reversals[0].unitCost.toString()).toBe('200');
    const again = await t.http().post(`/api/v1/inventory/documents/${extra.body.id}/cancel`).set(s.auth).send({ reason: 'x' });
    expect(again.status).toBe(409);
    expect(again.body.code).toBe('DOCUMENT_NOT_POSTED');
    // consume 8 of the remaining 10, then cancelling the base receipt (−10) would go negative
    await postIssue(t, s, [{ variantId: p.variantId, quantity: '8' }]);
    const blocked = await t.http().post(`/api/v1/inventory/documents/${base.body.id}/cancel`).set(s.auth).send({ reason: 'x' });
    expect(blocked.status).toBe(409);
    expect(blocked.body.code).toBe('INSUFFICIENT_STOCK');
    expect((await t.prisma.raw.inventoryDocument.findUniqueOrThrow({ where: { id: base.body.id } })).status).toBe('POSTED');
  });

  it('T-029 posted documents are immutable; drafts are editable with optimistic locking', async () => {
    const p = await createProduct(t, s);
    const draft = await t.http().post('/api/v1/inventory/documents').set(s.auth).send({ type: 'RECEIPT', branchId: s.branchId, warehouseId: s.warehouseId, lines: [{ variantId: p.variantId, quantity: '1', unitCost: '5' }] });
    expect(draft.status).toBe(201);
    expect(draft.body.status).toBe('DRAFT');
    expect((await balanceOf(t, s, p.variantId)).onHand).toBe('0');
    const stale = await t.http().patch(`/api/v1/inventory/documents/${draft.body.id}`).set(s.auth).send({ version: 99, note: 'x' });
    expect(stale.status).toBe(409);
    expect(stale.body.code).toBe('VERSION_CONFLICT');
    const upd = await t.http().patch(`/api/v1/inventory/documents/${draft.body.id}`).set(s.auth).send({ version: 1, lines: [{ variantId: p.variantId, quantity: '2', unitCost: '5' }] });
    expect(upd.status).toBe(200);
    expect(upd.body.version).toBe(2);
    const posted = await t.http().post(`/api/v1/inventory/documents/${draft.body.id}/post`).set(s.auth);
    expect(posted.status).toBe(200);
    expect((await balanceOf(t, s, p.variantId)).onHand).toBe('2');
    const edit = await t.http().patch(`/api/v1/inventory/documents/${draft.body.id}`).set(s.auth).send({ version: 3, note: 'x' });
    expect(edit.status).toBe(409);
    expect(edit.body.code).toBe('DOCUMENT_NOT_EDITABLE');
    const del = await t.http().delete(`/api/v1/inventory/documents/${draft.body.id}`).set(s.auth);
    expect(del.status).toBe(409);
    const repost = await t.http().post(`/api/v1/inventory/documents/${draft.body.id}/post`).set(s.auth);
    expect(repost.status).toBe(409);
    expect(repost.body.code).toBe('DOCUMENT_NOT_DRAFT');
  });

  it('T-030 a failing line rolls back the whole posting (no partial balances)', async () => {
    const good = await createProduct(t, s);
    const other = await createProduct(t, s);
    const draft = await t.http().post('/api/v1/inventory/documents').set(s.auth).send({ type: 'ISSUE', reason: 'OTHER', branchId: s.branchId, warehouseId: s.warehouseId, lines: [{ variantId: good.variantId, quantity: '1' }, { variantId: other.variantId, quantity: '1' }] });
    expect(draft.status).toBe(201);
    await postReceipt(t, s, [{ variantId: good.variantId, quantity: '5', unitCost: '1' }]); // only "good" has stock
    const post = await t.http().post(`/api/v1/inventory/documents/${draft.body.id}/post`).set(s.auth);
    expect(post.status).toBe(409);
    expect((await balanceOf(t, s, good.variantId)).onHand).toBe('5');
    expect(await t.prisma.raw.stockMovement.count({ where: { documentId: draft.body.id } })).toBe(0);
    expect((await t.prisma.raw.inventoryDocument.findUniqueOrThrow({ where: { id: draft.body.id } })).status).toBe('DRAFT');
  });

  it('T-031 adjustment uses actual quantity at posting time; batch-tracked items require a batch', async () => {
    const p = await createProduct(t, s);
    await postReceipt(t, s, [{ variantId: p.variantId, quantity: '10', unitCost: '20' }]);
    const draft = await t.http().post('/api/v1/inventory/documents').set(s.auth).send({ type: 'ADJUSTMENT', reason: 'COUNT', branchId: s.branchId, warehouseId: s.warehouseId, lines: [{ variantId: p.variantId, actualQuantity: '7' }] });
    expect(draft.status).toBe(201);
    // a sale/issue happens while counting
    await postIssue(t, s, [{ variantId: p.variantId, quantity: '2' }]);
    const posted = await t.http().post(`/api/v1/inventory/documents/${draft.body.id}/post`).set(s.auth);
    expect(posted.status).toBe(200);
    expect(posted.body.lines[0].systemQuantity).toBe('8');
    expect(posted.body.lines[0].quantity).toBe('-1');
    expect((await balanceOf(t, s, p.variantId)).onHand).toBe('7');

    const batched = await createProduct(t, s, { trackBatch: true, variants: [{ sellPrice: '1' }] });
    const noBatch = await postReceipt(t, s, [{ variantId: batched.variantId, quantity: '1', unitCost: '1' }]);
    expect(noBatch.status).toBe(409);
    expect(noBatch.body.code).toBe('BATCH_REQUIRED');
    const batch = await t.http().post(`/api/v1/variants/${batched.variantId}/batches`).set(s.auth).send({ batchNo: 'L001', expiryDate: '2027-12-31' });
    expect(batch.status).toBe(201);
    const ok = await postReceipt(t, s, [{ variantId: batched.variantId, quantity: '3', unitCost: '1', batchId: batch.body.id }]);
    expect(ok.status).toBe(201);
    const bal = await t.prisma.raw.stockBalance.findFirst({ where: { variantId: batched.variantId, batchId: batch.body.id } });
    expect(bal?.onHand.toString()).toBe('3');
    const wrongBatch = await postReceipt(t, s, [{ variantId: p.variantId, quantity: '1', unitCost: '1', batchId: batch.body.id }]);
    expect(wrongBatch.body.code).toBe('BATCH_NOT_ALLOWED');
  });

  it('T-032/T-033 stock card and reconciliation agree with balances', async () => {
    const card = await t.http().get('/api/v1/inventory/movements').set(s.auth).query({ pageSize: 5 });
    expect(card.status).toBe(200);
    expect(card.body.data.length).toBeGreaterThan(0);
    expect(card.body.data[0]).toHaveProperty('balanceAfter');
    const rec = await t.http().post('/api/v1/inventory/reconcile').set(s.auth);
    expect(rec.status).toBe(200);
    expect(rec.body.ok).toBe(true);
    expect(rec.body.balanceDiffs).toHaveLength(0);
    expect(rec.body.variantDiffs).toHaveLength(0);
    expect(rec.body.costDiffs).toHaveLength(0);
    const balances = await t.http().get('/api/v1/inventory/balances').set(s.auth).query({ pageSize: 100 });
    expect(balances.body.data.every((b: any) => b.available !== undefined && b.value !== undefined)).toBe(true);
    const summary = await t.http().get('/api/v1/inventory/balances/summary').set(s.auth);
    expect(Number(summary.body.stockValue)).toBeGreaterThan(0);
  });

  it('T-034 reservations reduce available but not on-hand; release restores', async () => {
    const p = await createProduct(t, s);
    await postReceipt(t, s, [{ variantId: p.variantId, quantity: '5', unitCost: '1' }]);
    const r = await t.http().post('/api/v1/inventory/reservations').set(s.auth).send({ warehouseId: s.warehouseId, variantId: p.variantId, quantity: '4', documentType: 'SALES_ORDER', documentId: randomUUID() });
    expect(r.status).toBe(201);
    expect(await balanceOf(t, s, p.variantId)).toMatchObject({ onHand: '5', reserved: '4' });
    const over = await t.http().post('/api/v1/inventory/reservations').set(s.auth).send({ warehouseId: s.warehouseId, variantId: p.variantId, quantity: '2', documentType: 'SALES_ORDER', documentId: randomUUID() });
    expect(over.status).toBe(409);
    const list = await t.http().get('/api/v1/inventory/balances').set(s.auth).query({ variantId: p.variantId });
    expect(list.body.data[0].available).toBe('1');
    const rel = await t.http().post(`/api/v1/inventory/reservations/${r.body.id}/release`).set(s.auth);
    expect(rel.status).toBe(200);
    expect((await balanceOf(t, s, p.variantId)).reserved).toBe('0');
  });

  it('T-040/T-041 audit log and outbox events are written and published', async () => {
    const p = await createProduct(t, s);
    const rec = await postReceipt(t, s, [{ variantId: p.variantId, quantity: '1', unitCost: '1' }]);
    const logs = await t.http().get('/api/v1/audit-logs').set(s.auth).query({ entityType: 'InventoryDocument', entityId: rec.body.id });
    expect(logs.body.data.map((l: any) => l.action).sort()).toEqual(['inventory.document.create', 'inventory.document.post']);
    const pending = await t.prisma.raw.outboxEvent.findMany({ where: { aggregateId: rec.body.id } });
    expect(pending).toHaveLength(1);
    expect(pending[0].status).toBe('PENDING');
    let published = 0;
    for (let n = await t.outbox.runOnce(500); n > 0; n = await t.outbox.runOnce(500)) published += n; // drain everything accumulated by earlier suites
    expect(published).toBeGreaterThan(0);
    const after = await t.prisma.raw.outboxEvent.findUniqueOrThrow({ where: { id: pending[0].id } });
    expect(after.status).toBe('PUBLISHED');
  });

  it('dashboard overview returns real aggregates', async () => {
    const res = await t.http().get('/api/v1/dashboard/overview').set(s.auth);
    expect(res.status).toBe(200);
    expect(res.body.products).toBeGreaterThan(0);
    expect(res.body.recentDocuments.length).toBeGreaterThan(0);
  });
});
