import { randomUUID } from 'node:crypto';
import { balanceOf, createProduct, createTestApp, postIssue, postReceipt, registerTenant, Session, TestApp } from './helpers';

const api = '/api/v1';

describe('Stock transfers & stocktakes (Module 03b) – T-181..T-188', () => {
  let t: TestApp;
  let s: Session;
  let wh2: string; // second warehouse, same branch
  let branch2: string;
  let wh3: string; // warehouse of branch 2
  beforeAll(async () => {
    t = await createTestApp();
    s = await registerTenant(t);
    wh2 = (await t.http().post(`${api}/warehouses`).set(s.auth).send({ branchId: s.branchId, code: 'KHO-2', name: 'Kho phụ' })).body.id;
    const b2 = await t.http().post(`${api}/branches`).set(s.auth).send({ code: 'CN2', name: 'Chi nhánh 2' });
    branch2 = b2.body.id;
    wh3 = b2.body.warehouses[0].id; // a new branch gets its default warehouse
  });
  afterAll(async () => { await t.close(); });

  const stocked = async (qty = '20', cost = '1000') => {
    const p = await createProduct(t, s, { variants: [{ sellPrice: '5000', costPrice: cost }] });
    await postReceipt(t, s, [{ variantId: p.variantId, quantity: qty, unitCost: cost }]);
    return p;
  };
  const bal = (variantId: string, warehouseId: string) => balanceOf(t, s, variantId, warehouseId);
  const incomingOf = async (variantId: string, warehouseId: string) => (await t.prisma.raw.stockBalance.findFirst({ where: { tenantId: s.tenantId, variantId, warehouseId } }))?.incoming.toString() ?? '0';

  it('T-181 transfer lifecycle: draft → dispatch (out at avg cost, incoming at destination) → receive in full; stock value preserved', async () => {
    const p = await stocked('20', '1000');
    await postReceipt(t, s, [{ variantId: p.variantId, quantity: '10', unitCost: '4000' }]); // avg = 2000
    const draft = await t.http().post(`${api}/transfers`).set(s.auth).send({ fromWarehouseId: s.warehouseId, toWarehouseId: wh2, note: 'bổ sung kho phụ', lines: [{ variantId: p.variantId, quantity: '6' }] });
    expect(draft.status).toBe(201);
    expect(draft.body.code).toBe('CH000001');
    expect(draft.body.status).toBe('DRAFT');
    expect((await bal(p.variantId, s.warehouseId)).onHand).toBe('30');
    const same = await t.http().post(`${api}/transfers`).set(s.auth).send({ fromWarehouseId: s.warehouseId, toWarehouseId: s.warehouseId, lines: [{ variantId: p.variantId, quantity: '1' }] });
    expect(same.status).toBe(400);
    const upd = await t.http().patch(`${api}/transfers/${draft.body.id}`).set(s.auth).send({ version: 1, lines: [{ variantId: p.variantId, quantity: '8' }] });
    expect(upd.status).toBe(200);
    expect(upd.body.totalQuantity).toBe('8');
    expect((await t.http().patch(`${api}/transfers/${draft.body.id}`).set(s.auth).send({ version: 1, note: 'stale' })).status).toBe(409);
    const dispatch = await t.http().post(`${api}/transfers/${draft.body.id}/dispatch`).set(s.auth).send({ version: 2 });
    expect(dispatch.status).toBe(200);
    expect(dispatch.body.status).toBe('IN_TRANSIT');
    expect(dispatch.body.lines[0].unitCost).toBe('2000');
    expect(dispatch.body.totalCost).toBe('16000');
    expect((await bal(p.variantId, s.warehouseId)).onHand).toBe('22');
    expect((await bal(p.variantId, wh2)).onHand).toBe('0');
    expect(await incomingOf(p.variantId, wh2)).toBe('8');
    expect((await bal(p.variantId, s.warehouseId)).onHandTotal).toBe('22'); // in transit is not on hand anywhere
    expect((await t.http().patch(`${api}/transfers/${draft.body.id}`).set(s.auth).send({ version: 3, note: 'x' })).status).toBe(409);
    const receive = await t.http().post(`${api}/transfers/${draft.body.id}/receive`).set(s.auth).send({});
    expect(receive.status).toBe(200);
    expect(receive.body.status).toBe('RECEIVED');
    expect(receive.body.receivedQuantity).toBe('8');
    expect(receive.body.shortageQuantity).toBe('0');
    expect((await bal(p.variantId, wh2)).onHand).toBe('8');
    expect(await incomingOf(p.variantId, wh2)).toBe('0');
    expect((await bal(p.variantId, s.warehouseId)).onHandTotal).toBe('30');
    expect((await bal(p.variantId, s.warehouseId)).costPrice).toBe('2000'); // transfer never changes the average
    const mv = await t.prisma.raw.stockMovement.findMany({ where: { documentId: draft.body.id }, orderBy: { createdAt: 'asc' } });
    expect(mv.map((m) => m.type)).toEqual(['TRANSFER_OUT', 'TRANSFER_IN']);
    expect(mv.every((m) => m.unitCost.toString() === '2000')).toBe(true);
    expect((await t.http().post(`${api}/transfers/${draft.body.id}/cancel`).set(s.auth).send({ reason: 'x' })).body.code).toBe('TRANSFER_RECEIVED');
    expect((await t.http().post(`${api}/inventory/reconcile`).set(s.auth)).body.ok).toBe(true);
  });

  it('T-182 partial receipt: shortage written off (loss) or returned to the source; cannot receive more than sent', async () => {
    const p = await stocked('20', '1000');
    const tr = await t.http().post(`${api}/transfers/dispatch-now`).set(s.auth).send({ fromWarehouseId: s.warehouseId, toWarehouseId: wh2, lines: [{ variantId: p.variantId, quantity: '10' }] });
    expect(tr.status).toBe(201);
    expect(tr.body.status).toBe('IN_TRANSIT');
    const lineId = tr.body.lines[0].id;
    expect((await t.http().post(`${api}/transfers/${tr.body.id}/receive`).set(s.auth).send({ lines: [{ lineId, receivedQuantity: '11' }] })).status).toBe(400);
    const rec = await t.http().post(`${api}/transfers/${tr.body.id}/receive`).set(s.auth).send({ lines: [{ lineId, receivedQuantity: '7', note: 'vỡ 3' }], shortageAction: 'WRITE_OFF' });
    expect(rec.status).toBe(200);
    expect(rec.body.receivedQuantity).toBe('7');
    expect(rec.body.shortageQuantity).toBe('3');
    expect(rec.body.shortageValue).toBe('3000');
    expect(rec.body.shortageAction).toBe('WRITE_OFF');
    expect((await bal(p.variantId, wh2)).onHand).toBe('7');
    expect((await bal(p.variantId, s.warehouseId)).onHand).toBe('10');
    expect((await bal(p.variantId, s.warehouseId)).onHandTotal).toBe('17');
    // return-to-source variant
    const tr2 = await t.http().post(`${api}/transfers/dispatch-now`).set(s.auth).send({ fromWarehouseId: s.warehouseId, toWarehouseId: wh2, lines: [{ variantId: p.variantId, quantity: '4' }] });
    const rec2 = await t.http().post(`${api}/transfers/${tr2.body.id}/receive`).set(s.auth).send({ lines: [{ lineId: tr2.body.lines[0].id, receivedQuantity: '1' }], shortageAction: 'RETURN_TO_SOURCE' });
    expect(rec2.status).toBe(200);
    expect(rec2.body.shortageQuantity).toBe('3');
    expect(rec2.body.shortageValue).toBe('0');
    expect((await bal(p.variantId, wh2)).onHand).toBe('8');
    expect((await bal(p.variantId, s.warehouseId)).onHand).toBe('9'); // 6 left + 3 came back
    expect((await bal(p.variantId, s.warehouseId)).onHandTotal).toBe('17');
    expect((await t.http().post(`${api}/inventory/reconcile`).set(s.auth)).body.ok).toBe(true);
  });

  it('T-183 cancelling an in-transit transfer brings the goods back at the dispatched cost; insufficient stock blocks dispatch; idempotent dispatch-now', async () => {
    const p = await stocked('5', '1000');
    const tr = await t.http().post(`${api}/transfers/dispatch-now`).set(s.auth).send({ fromWarehouseId: s.warehouseId, toWarehouseId: wh2, lines: [{ variantId: p.variantId, quantity: '3' }] });
    expect(tr.status).toBe(201);
    expect((await bal(p.variantId, s.warehouseId)).onHand).toBe('2');
    expect(await incomingOf(p.variantId, wh2)).toBe('3');
    const tooMany = await t.http().post(`${api}/transfers/dispatch-now`).set(s.auth).send({ fromWarehouseId: s.warehouseId, toWarehouseId: wh2, lines: [{ variantId: p.variantId, quantity: '3' }] });
    expect(tooMany.status).toBe(409);
    expect(tooMany.body.code).toBe('INSUFFICIENT_STOCK');
    const cancel = await t.http().post(`${api}/transfers/${tr.body.id}/cancel`).set(s.auth).send({ reason: 'xe hỏng' });
    expect(cancel.status).toBe(200);
    expect(cancel.body.status).toBe('CANCELLED');
    expect((await bal(p.variantId, s.warehouseId)).onHand).toBe('5');
    expect(await incomingOf(p.variantId, wh2)).toBe('0');
    expect((await t.http().post(`${api}/transfers/${tr.body.id}/receive`).set(s.auth).send({})).status).toBe(409);
    const key = randomUUID();
    const body = { fromWarehouseId: s.warehouseId, toWarehouseId: wh2, lines: [{ variantId: p.variantId, quantity: '2' }] };
    const a = await t.http().post(`${api}/transfers/dispatch-now`).set(s.auth).set('Idempotency-Key', key).send(body);
    const b = await t.http().post(`${api}/transfers/dispatch-now`).set(s.auth).set('Idempotency-Key', key).send(body);
    expect(a.status).toBe(201);
    expect(b.body.id).toBe(a.body.id);
    expect((await bal(p.variantId, s.warehouseId)).onHand).toBe('3');
    // concurrent dispatches never overdraw
    const q = await stocked('4', '1000');
    const results = await Promise.all([1, 2, 3].map(() => t.http().post(`${api}/transfers/dispatch-now`).set(s.auth).send({ fromWarehouseId: s.warehouseId, toWarehouseId: wh2, lines: [{ variantId: q.variantId, quantity: '3' }] })));
    expect(results.filter((r) => r.status === 201)).toHaveLength(1);
    expect(results.every((r) => r.status < 500)).toBe(true);
    expect((await t.http().post(`${api}/inventory/reconcile`).set(s.auth)).body.ok).toBe(true);
  });

  it('T-184 cross-branch transfer: sender needs the source branch, receiver the destination branch; batches travel with the goods', async () => {
    const p = await stocked('10', '1000');
    const roles = (await t.http().get(`${api}/roles`).set(s.auth)).body;
    const wh = roles.find((r: { code: string }) => r.code === 'WAREHOUSE');
    await t.http().post(`${api}/users`).set(s.auth).send({ username: 'kho2', password: 'Secret123', fullName: 'Thủ kho CN2', roleIds: [wh.id], branchIds: [branch2] });
    const login = await t.http().post(`${api}/auth/login`).send({ tenantCode: s.tenantCode, username: 'kho2', password: 'Secret123' });
    const k2 = { Authorization: `Bearer ${login.body.accessToken}` };
    // branch-2 keeper cannot ship out of branch 1
    const denied = await t.http().post(`${api}/transfers`).set(k2).send({ fromWarehouseId: s.warehouseId, toWarehouseId: wh3, lines: [{ variantId: p.variantId, quantity: '2' }] });
    expect(denied.status).toBe(403);
    const tr = await t.http().post(`${api}/transfers/dispatch-now`).set(s.auth).send({ fromWarehouseId: s.warehouseId, toWarehouseId: wh3, lines: [{ variantId: p.variantId, quantity: '4' }] });
    expect(tr.status).toBe(201);
    expect(tr.body.toBranchId).toBe(branch2);
    // sender (branch 1 only) cannot receive into branch 2; branch-2 keeper can and sees the transfer in "in" direction
    const roleWh1 = await t.http().post(`${api}/users`).set(s.auth).send({ username: 'kho1', password: 'Secret123', fullName: 'Thủ kho CN1', roleIds: [wh.id], branchIds: [s.branchId] });
    expect(roleWh1.status).toBe(201);
    const l1 = await t.http().post(`${api}/auth/login`).send({ tenantCode: s.tenantCode, username: 'kho1', password: 'Secret123' });
    const k1 = { Authorization: `Bearer ${l1.body.accessToken}` };
    expect((await t.http().post(`${api}/transfers/${tr.body.id}/receive`).set(k1).send({})).status).toBe(403);
    const inbox = await t.http().get(`${api}/transfers`).set(k2).query({ direction: 'in', status: 'IN_TRANSIT' });
    expect(inbox.body.data.map((x: { id: string }) => x.id)).toContain(tr.body.id);
    const rec = await t.http().post(`${api}/transfers/${tr.body.id}/receive`).set(k2).send({});
    expect(rec.status).toBe(200);
    expect((await bal(p.variantId, wh3)).onHand).toBe('4');
    // batch-tracked goods keep their batch
    const batched = await createProduct(t, s, { trackBatch: true, variants: [{ sellPrice: '1', costPrice: '10' }] });
    const batch = (await t.http().post(`${api}/variants/${batched.variantId}/batches`).set(s.auth).send({ batchNo: 'L001', expiryDate: '2027-12-31' })).body;
    await postReceipt(t, s, [{ variantId: batched.variantId, quantity: '5', unitCost: '10', batchId: batch.id }]);
    expect((await t.http().post(`${api}/transfers`).set(s.auth).send({ fromWarehouseId: s.warehouseId, toWarehouseId: wh2, lines: [{ variantId: batched.variantId, quantity: '2' }] })).status).toBe(400);
    const btr = await t.http().post(`${api}/transfers/dispatch-now`).set(s.auth).send({ fromWarehouseId: s.warehouseId, toWarehouseId: wh2, lines: [{ variantId: batched.variantId, quantity: '2', batchId: batch.id }] });
    expect(btr.status).toBe(201);
    await t.http().post(`${api}/transfers/${btr.body.id}/receive`).set(s.auth).send({});
    const row = await t.prisma.raw.stockBalance.findFirst({ where: { tenantId: s.tenantId, variantId: batched.variantId, warehouseId: wh2 } });
    expect(row?.batchId).toBe(batch.id);
    expect(row?.onHand.toString()).toBe('2');
    // other tenant cannot see it
    const other = await registerTenant(t);
    expect((await t.http().get(`${api}/transfers/${tr.body.id}`).set(other.auth)).status).toBe(404);
  });

  it('T-185 stocktake: snapshot per line, counts from several people, completion posts counted − snapshot even when sales happen in between', async () => {
    const a = await stocked('50', '1000');
    const b = await stocked('10', '2000');
    const c = await stocked('5', '500');
    const st = await t.http().post(`${api}/stocktakes`).set(s.auth).send({ warehouseId: s.warehouseId, note: 'kiểm cuối tháng', lines: [{ variantId: a.variantId }, { variantId: b.variantId, countedQuantity: '12' }] });
    expect(st.status).toBe(201);
    expect(st.body.code).toBe('KK000001');
    expect(st.body.totalLines).toBe(2);
    expect(st.body.countedLines).toBe(1);
    expect(st.body.lines.find((l: { variantId: string }) => l.variantId === a.variantId).systemQuantity).toBe('50');
    // goods move while counting: the snapshot stays, live on-hand is shown
    await postIssue(t, s, [{ variantId: a.variantId, quantity: '5' }]);
    const counted = await t.http().post(`${api}/stocktakes/${st.body.id}/lines`).set(s.auth).send({ lines: [{ variantId: a.variantId, countedQuantity: '48' }, { variantId: c.variantId, countedQuantity: '5' }] });
    expect(counted.status).toBe(200);
    expect(counted.body.totalLines).toBe(3);
    expect(counted.body.countedLines).toBe(3);
    const la = counted.body.lines.find((l: { variantId: string }) => l.variantId === a.variantId);
    expect(la.systemQuantity).toBe('50');
    expect(la.currentOnHand).toBe('45');
    expect(la.pendingDelta).toBe('-2');
    const done = await t.http().post(`${api}/stocktakes/${st.body.id}/complete`).set(s.auth).send({});
    expect(done.status).toBe(200);
    expect(done.body.status).toBe('COMPLETED');
    expect(done.body.increaseQuantity).toBe('2'); // b: 12 − 10
    expect(done.body.decreaseQuantity).toBe('2'); // a: 48 − 50
    expect(done.body.increaseValue).toBe('4000');
    expect(done.body.decreaseValue).toBe('2000');
    expect((await bal(a.variantId, s.warehouseId)).onHand).toBe('43'); // 45 live − 2 (not 48!)
    expect((await bal(b.variantId, s.warehouseId)).onHand).toBe('12');
    expect((await bal(c.variantId, s.warehouseId)).onHand).toBe('5');
    expect(done.body.movements).toHaveLength(2);
    expect(done.body.movements.every((m: { type: string }) => m.type === 'STOCKTAKE')).toBe(true);
    expect((await t.http().post(`${api}/stocktakes/${st.body.id}/lines`).set(s.auth).send({ lines: [{ variantId: a.variantId, countedQuantity: '1' }] })).status).toBe(409);
    expect((await t.http().post(`${api}/inventory/reconcile`).set(s.auth)).body.ok).toBe(true);
  });

  it('T-186 stocktake scope ALL snapshots the whole warehouse; uncounted lines are kept or zeroed; refresh re-reads the snapshot; cancel reverses', async () => {
    const a = await stocked('7', '1000');
    const b = await stocked('3', '1000');
    const all = await t.http().post(`${api}/stocktakes`).set(s.auth).send({ warehouseId: wh2, scope: 'ALL' });
    expect(all.status).toBe(201);
    const ids = all.body.lines.map((l: { variantId: string }) => l.variantId);
    expect(ids).not.toContain(a.variantId); // a is in the main warehouse only
    const st = await t.http().post(`${api}/stocktakes`).set(s.auth).send({ warehouseId: s.warehouseId, lines: [{ variantId: a.variantId, countedQuantity: '7' }, { variantId: b.variantId }] });
    // SKIP keeps b untouched
    const skip = await t.http().post(`${api}/stocktakes/${st.body.id}/complete`).set(s.auth).send({ uncountedAs: 'SKIP' });
    expect(skip.status).toBe(200);
    expect((await bal(b.variantId, s.warehouseId)).onHand).toBe('3');
    expect(skip.body.movements).toHaveLength(0);
    // ZERO writes b off
    const st2 = await t.http().post(`${api}/stocktakes`).set(s.auth).send({ warehouseId: s.warehouseId, lines: [{ variantId: b.variantId }] });
    await postReceipt(t, s, [{ variantId: b.variantId, quantity: '2', unitCost: '1000' }]); // snapshot 3, live 5
    const refreshed = await t.http().post(`${api}/stocktakes/${st2.body.id}/refresh-snapshot`).set(s.auth);
    expect(refreshed.body.lines[0].systemQuantity).toBe('5');
    const zero = await t.http().post(`${api}/stocktakes/${st2.body.id}/complete`).set(s.auth).send({ uncountedAs: 'ZERO' });
    expect(zero.status).toBe(200);
    expect(zero.body.decreaseQuantity).toBe('5');
    expect((await bal(b.variantId, s.warehouseId)).onHand).toBe('0');
    const cancel = await t.http().post(`${api}/stocktakes/${st2.body.id}/cancel`).set(s.auth).send({ reason: 'đếm nhầm' });
    expect(cancel.status).toBe(200);
    expect(cancel.body.status).toBe('CANCELLED');
    expect((await bal(b.variantId, s.warehouseId)).onHand).toBe('5');
    expect((await t.http().post(`${api}/stocktakes/${st2.body.id}/cancel`).set(s.auth).send({ reason: 'again' })).status).toBe(409);
    // a draft can simply be cancelled; empty stocktake cannot complete
    const empty = await t.http().post(`${api}/stocktakes`).set(s.auth).send({ warehouseId: s.warehouseId });
    expect((await t.http().post(`${api}/stocktakes/${empty.body.id}/complete`).set(s.auth).send({})).status).toBe(400);
    expect((await t.http().post(`${api}/stocktakes/${empty.body.id}/cancel`).set(s.auth).send({ reason: 'bỏ' })).status).toBe(200);
    expect((await t.http().post(`${api}/inventory/reconcile`).set(s.auth)).body.ok).toBe(true);
  });

  it('T-187 concurrent counters on one stocktake and completion racing a sale stay consistent', async () => {
    const items = await Promise.all([1, 2, 3, 4].map(() => stocked('10', '1000')));
    const st = await t.http().post(`${api}/stocktakes`).set(s.auth).send({ warehouseId: s.warehouseId });
    const results = await Promise.all(items.map((p, i) => t.http().post(`${api}/stocktakes/${st.body.id}/lines`).set(s.auth).send({ lines: [{ variantId: p.variantId, countedQuantity: String(10 + i) }] })));
    expect(results.every((r) => r.status === 200)).toBe(true);
    const detail = await t.http().get(`${api}/stocktakes/${st.body.id}`).set(s.auth);
    expect(detail.body.totalLines).toBe(4);
    expect(detail.body.countedLines).toBe(4);
    // complete while an issue of the same goods runs: both < 500, stock reconciles
    const race = await Promise.all([
      t.http().post(`${api}/stocktakes/${st.body.id}/complete`).set(s.auth).send({}),
      postIssue(t, s, [{ variantId: items[0].variantId, quantity: '4' }]),
      postIssue(t, s, [{ variantId: items[3].variantId, quantity: '9' }]),
    ]);
    expect(race.every((r) => r.status < 500)).toBe(true);
    expect(race[0].status).toBe(200);
    expect((await t.http().post(`${api}/inventory/reconcile`).set(s.auth)).body.ok).toBe(true);
    const total = (await t.prisma.raw.stockMovement.aggregate({ where: { tenantId: s.tenantId, variantId: items[0].variantId }, _sum: { quantity: true } }))._sum.quantity?.toString();
    expect(total).toBe((await bal(items[0].variantId, s.warehouseId)).onHand);
  });

  it('T-188 permissions and cost visibility: warehouse keeper can transfer/count but cost fields are hidden without inventory.cost.view', async () => {
    const roles = (await t.http().get(`${api}/roles`).set(s.auth)).body;
    const cashier = roles.find((r: { code: string }) => r.code === 'CASHIER');
    await t.http().post(`${api}/users`).set(s.auth).send({ username: 'tn9', password: 'Secret123', fullName: 'TN', roleIds: [cashier.id], branchIds: [s.branchId] });
    const l = await t.http().post(`${api}/auth/login`).send({ tenantCode: s.tenantCode, username: 'tn9', password: 'Secret123' });
    const c = { Authorization: `Bearer ${l.body.accessToken}` };
    expect((await t.http().get(`${api}/transfers`).set(c)).status).toBe(403);
    expect((await t.http().get(`${api}/stocktakes`).set(c)).status).toBe(403);
    // a custom role: transfer.view only → no costs
    const role = await t.http().post(`${api}/roles`).set(s.auth).send({ code: 'VIEWER', name: 'Xem kho', permissions: ['transfer.view', 'stocktake.view'] });
    expect(role.status).toBe(201);
    await t.http().post(`${api}/users`).set(s.auth).send({ username: 'viewer', password: 'Secret123', fullName: 'V', roleIds: [role.body.id], branchIds: [s.branchId] });
    const lv = await t.http().post(`${api}/auth/login`).send({ tenantCode: s.tenantCode, username: 'viewer', password: 'Secret123' });
    const v = { Authorization: `Bearer ${lv.body.accessToken}` };
    const list = await t.http().get(`${api}/transfers`).set(v).query({ status: 'RECEIVED', pageSize: 1 });
    expect(list.status).toBe(200);
    const one = await t.http().get(`${api}/transfers/${list.body.data[0].id}`).set(v);
    expect(one.status).toBe(200);
    expect(one.body.totalCost).toBeUndefined();
    expect(one.body.lines[0].unitCost).toBeUndefined();
    expect((await t.http().post(`${api}/transfers`).set(v).send({ fromWarehouseId: s.warehouseId, toWarehouseId: wh2, lines: [] })).status).toBe(403);
  });
});
