import { balanceOf, createProduct, createTestApp, postReceipt, registerTenant, Session, TestApp } from './helpers';

const api = '/api/v1';

describe('Promotions & price-book targeting (Module 09) – T-190..T-197', () => {
  let t: TestApp;
  let s: Session;
  let vipId: string;
  let walkinCustomerId: string;
  beforeAll(async () => {
    t = await createTestApp();
    s = await registerTenant(t);
    vipId = (await t.http().post(`${api}/customers`).set(s.auth).send({ name: 'Khách VIP', groupName: 'VIP' })).body.id;
    walkinCustomerId = (await t.http().post(`${api}/customers`).set(s.auth).send({ name: 'Khách thường' })).body.id;
  });
  afterAll(async () => { await t.close(); });
  // each scenario starts without active promotions, even when an earlier one failed half-way
  afterEach(async () => {
    const active = await t.http().get(`${api}/promotions`).set(s.auth).query({ status: 'ACTIVE', pageSize: 100 });
    for (const p of active.body.data ?? []) await t.http().patch(`${api}/promotions/${p.id}`).set(s.auth).send({ status: 'INACTIVE' });
  });

  const stocked = async (price: string, qty = '50', cost = '1000', extra: Record<string, unknown> = {}) => {
    const p = await createProduct(t, s, { variants: [{ sellPrice: price, costPrice: cost }], ...extra });
    await postReceipt(t, s, [{ variantId: p.variantId, quantity: qty, unitCost: cost }]);
    return p;
  };
  const preview = (body: Record<string, unknown>) => t.http().post(`${api}/invoices/preview`).set(s.auth).send({ branchId: s.branchId, warehouseId: s.warehouseId, ...body });
  const checkout = (body: Record<string, unknown>) => t.http().post(`${api}/invoices/checkout`).set(s.auth).send({ branchId: s.branchId, warehouseId: s.warehouseId, ...body });
  const promo = (body: Record<string, unknown>) => t.http().post(`${api}/promotions`).set(s.auth).send(body);
  const deactivate = (id: string) => t.http().patch(`${api}/promotions/${id}`).set(s.auth).send({ status: 'INACTIVE' });

  it('T-190 product discount + invoice discount tiers apply automatically at preview and checkout; stored per line / invoice; reports net', async () => {
    const a = await stocked('100000');
    const b = await stocked('50000');
    const pd = await promo({ name: 'Giảm 10% hàng A', type: 'PRODUCT_DISCOUNT', stackable: true, priority: 10, config: { variantIds: [a.variantId], discountPercent: '10' } });
    expect(pd.status).toBe(201);
    expect(pd.body.code).toBe('KM0001');
    const inv = await promo({ name: 'Hóa đơn từ 200k giảm 5%', type: 'INVOICE_DISCOUNT', stackable: true, config: { tiers: [{ minTotal: '200000', discountPercent: '5' }, { minTotal: '500000', discountAmount: '50000' }] } });
    expect(inv.status).toBe(201);
    const bad = await promo({ name: 'x', type: 'INVOICE_DISCOUNT', config: { tiers: [{ minTotal: '1', discountPercent: '150' }] } });
    expect(bad.status).toBe(400);
    const pv = await preview({ lines: [{ variantId: a.variantId, quantity: '2' }, { variantId: b.variantId, quantity: '1' }] });
    expect(pv.status).toBe(200);
    expect(pv.body.lines[0].promotionDiscount).toBe('20000');
    expect(pv.body.lines[0].promotionId).toBe(pd.body.id);
    expect(pv.body.promotionDiscount).toBe('11500'); // (250 000 − 20 000) × 5 %
    expect(pv.body.totalAmount).toBe('218500');
    expect(pv.body.promotions.map((p: { code: string }) => p.code)).toEqual(['KM0001', 'KM0002']);
    const sale = await checkout({ customerId: vipId, lines: [{ variantId: a.variantId, quantity: '2' }, { variantId: b.variantId, quantity: '1' }], payments: [{ method: 'CASH', amount: '218500' }] });
    expect(sale.status).toBe(201);
    expect(sale.body.totalAmount).toBe('218500');
    expect(sale.body.promotionDiscount).toBe('11500');
    expect(sale.body.discountAmount).toBe('0');
    expect(sale.body.lines[0].promotionDiscount).toBe('20000');
    expect(sale.body.lines[0].lineTotal).toBe('180000');
    expect(sale.body.promotions).toHaveLength(2);
    const detail = await t.http().get(`${api}/promotions/${pd.body.id}`).set(s.auth);
    expect(detail.body.usageCount).toBe(1);
    expect(detail.body.stats.uses).toBe(1);
    expect(detail.body.stats.amount).toBe('20000');
    // opting out of an automatic promotion
    const noPromo = await preview({ lines: [{ variantId: a.variantId, quantity: '2' }], excludePromotionIds: [pd.body.id] });
    expect(noPromo.body.lines[0].promotionDiscount).toBe('0');
    expect(noPromo.body.promotions.map((x: { code: string }) => x.code)).toEqual(['KM0002']); // only the product promotion was skipped
    expect(noPromo.body.promotionDiscount).toBe('10000');
    const off = await preview({ lines: [{ variantId: a.variantId, quantity: '2' }], applyPromotions: false });
    expect(off.body.totalAmount).toBe('200000');
    // report
    const rep = await t.http().get(`${api}/promotions/report`).set(s.auth);
    expect(rep.body.rows.find((r: { code: string }) => r.code === 'KM0001').uses).toBe(1);
    const salesRep = await t.http().get(`${api}/sales/reports/summary`).set(s.auth).query({ from: new Date(Date.now() - 3600_000).toISOString() });
    expect(salesRep.body.totals.discount).toBe('11500'); // document-level discounts (manual + promotion); line-level ones are already inside line totals
    // returns use the net paid price (promotion-aware)
    const returnable = await t.http().get(`${api}/sales-returns/returnable/${sale.body.id}`).set(s.auth);
    const sumPaid = returnable.body.lines.reduce((acc: number, l: { refundUnitPrice: string; quantity: string }) => acc + Number(l.refundUnitPrice) * Number(l.quantity), 0);
    expect(Math.abs(sumPaid - 218500)).toBeLessThan(1);
    await deactivate(pd.body.id); await deactivate(inv.body.id);
  });

  it('T-191 buy X get Y: gift lines at zero, cart lines free when no gift line, over-claim rejected, stock & COGS of gifts recorded', async () => {
    const x = await stocked('30000');
    const y = await stocked('12000', '10', '5000');
    const bx = await promo({ name: 'Mua 2 X tặng 1 Y', type: 'BUY_X_GET_Y', config: { buy: { variantIds: [x.variantId], quantity: '2' }, get: { variantIds: [y.variantId], quantity: '1' }, maxRepeats: 3 } });
    expect(bx.status).toBe(201);
    const pv = await preview({ lines: [{ variantId: x.variantId, quantity: '4' }] });
    expect(pv.body.gifts[0].quantity).toBe('2');
    expect(pv.body.gifts[0].remaining).toBe('2');
    expect(pv.body.gifts[0].variants[0].id).toBe(y.variantId);
    const tooMany = await checkout({ lines: [{ variantId: x.variantId, quantity: '4' }, { variantId: y.variantId, quantity: '3', isGift: true, promotionId: bx.body.id }], payments: [{ method: 'CASH', amount: '120000' }] });
    expect(tooMany.status).toBe(400);
    const noPromoId = await checkout({ lines: [{ variantId: x.variantId, quantity: '4' }, { variantId: y.variantId, quantity: '1', isGift: true }], payments: [{ method: 'CASH', amount: '120000' }] });
    expect(noPromoId.status).toBe(400);
    const sale = await checkout({ lines: [{ variantId: x.variantId, quantity: '4' }, { variantId: y.variantId, quantity: '2', isGift: true, promotionId: bx.body.id }], payments: [{ method: 'CASH', amount: '120000' }] });
    expect(sale.status).toBe(201);
    expect(sale.body.totalAmount).toBe('120000');
    const gift = sale.body.lines.find((l: { isGift: boolean }) => l.isGift);
    expect(gift.lineTotal).toBe('0');
    expect(gift.promotionDiscount).toBe('24000');
    expect(gift.unitPrice).toBe('12000');
    expect(gift.costTotal).toBe('10000'); // COGS of the gift is still real
    expect((await balanceOf(t, s, y.variantId)).onHand).toBe('8');
    expect(sale.body.promotions[0].giftQuantity).toBe('2');
    // Y bought normally is also discounted when no gift line claims it
    const inCart = await preview({ lines: [{ variantId: x.variantId, quantity: '2' }, { variantId: y.variantId, quantity: '1' }] });
    expect(inCart.body.lines[1].promotionDiscount).toBe('12000');
    expect(inCart.body.totalAmount).toBe('60000');
    // a gift line for a promotion whose condition is not met
    expect((await checkout({ lines: [{ variantId: x.variantId, quantity: '1' }, { variantId: y.variantId, quantity: '1', isGift: true, promotionId: bx.body.id }], payments: [{ method: 'CASH', amount: '30000' }] })).status).toBe(400);
    await deactivate(bx.body.id);
  });

  it('T-192 vouchers: issue, lookup, single use under concurrency, usage returned on cancel, customer-bound and expired codes', async () => {
    const p = await stocked('100000');
    const v = await promo({ name: 'Voucher 30k', type: 'VOUCHER', stackable: true, config: { discountAmount: '30000', minTotal: '150000' } });
    expect(v.status).toBe(201);
    const issued = await t.http().post(`${api}/promotions/${v.body.id}/vouchers`).set(s.auth).send({ codes: ['SALE30'], maxUses: 1 });
    expect(issued.status).toBe(201);
    const gen = await t.http().post(`${api}/promotions/${v.body.id}/vouchers`).set(s.auth).send({ count: 3, prefix: 'KM' });
    expect(gen.body.count).toBe(3);
    expect(gen.body.codes.every((c: string) => c.startsWith('KM'))).toBe(true);
    const look = await t.http().get(`${api}/promotions/vouchers/lookup`).set(s.auth).query({ code: 'sale30', branchId: s.branchId });
    expect(look.body.valid).toBe(true);
    expect((await t.http().get(`${api}/promotions/vouchers/lookup`).set(s.auth).query({ code: 'NOPE' })).body.valid).toBe(false);
    // below minTotal → voucher not applied (no error), unknown code → 409
    const low = await preview({ lines: [{ variantId: p.variantId, quantity: '1' }], voucherCode: 'SALE30' });
    expect(low.body.promotionDiscount).toBe('0');
    expect((await preview({ lines: [{ variantId: p.variantId, quantity: '2' }], voucherCode: 'NOPE' })).status).toBe(409);
    const ok = await preview({ lines: [{ variantId: p.variantId, quantity: '2' }], voucherCode: 'SALE30' });
    expect(ok.body.promotionDiscount).toBe('30000');
    expect(ok.body.voucherCode).toBe('SALE30');
    // two cashiers race for the single-use code
    const race = await Promise.all([1, 2].map(() => checkout({ lines: [{ variantId: p.variantId, quantity: '2' }], voucherCode: 'SALE30', payments: [{ method: 'CASH', amount: '170000' }] })));
    const won = race.filter((r) => r.status === 201);
    expect(won).toHaveLength(1);
    expect(race.find((r) => r.status !== 201)?.body.code).toBe('VOUCHER_INVALID');
    const vouchers = await t.http().get(`${api}/promotions/${v.body.id}/vouchers`).set(s.auth).query({ search: 'SALE30' });
    expect(vouchers.body.data[0].status).toBe('USED');
    // cancelling the invoice gives the voucher back
    expect((await t.http().post(`${api}/invoices/${won[0].body.id}/cancel`).set(s.auth).send({ reason: 'khách đổi ý' })).status).toBe(200);
    expect((await t.http().get(`${api}/promotions/${v.body.id}/vouchers`).set(s.auth).query({ search: 'SALE30' })).body.data[0].status).toBe('ACTIVE');
    expect((await t.http().get(`${api}/promotions/${v.body.id}`).set(s.auth)).body.usageCount).toBe(0);
    // customer-bound and expired
    await t.http().post(`${api}/promotions/${v.body.id}/vouchers`).set(s.auth).send({ codes: ['VIPONLY'], customerId: vipId });
    expect((await preview({ customerId: walkinCustomerId, lines: [{ variantId: p.variantId, quantity: '2' }], voucherCode: 'VIPONLY' })).status).toBe(409);
    expect((await preview({ customerId: vipId, lines: [{ variantId: p.variantId, quantity: '2' }], voucherCode: 'VIPONLY' })).body.promotionDiscount).toBe('30000');
    await t.http().post(`${api}/promotions/${v.body.id}/vouchers`).set(s.auth).send({ codes: ['OLD'], expiresAt: '2020-01-01T00:00:00Z' });
    expect((await preview({ lines: [{ variantId: p.variantId, quantity: '2' }], voucherCode: 'OLD' })).status).toBe(409);
    const disabled = await t.http().patch(`${api}/promotions/vouchers/${vouchers.body.data[0].id}`).set(s.auth).send({ status: 'DISABLED' });
    expect(disabled.status).toBe(200);
    expect((await preview({ lines: [{ variantId: p.variantId, quantity: '2' }], voucherCode: 'SALE30' })).status).toBe(409);
    await deactivate(v.body.id);
  });

  it('T-193 usage limit is enforced under concurrency; per-customer limit; non-stackable priority wins; branch & group targeting', async () => {
    const p = await stocked('100000', '200');
    const limited = await promo({ name: 'Giảm 20k, 2 lượt', type: 'INVOICE_DISCOUNT', usageLimit: 2, config: { tiers: [{ minTotal: '0', discountAmount: '20000' }] } });
    const race = await Promise.all([1, 2, 3, 4].map(() => checkout({ lines: [{ variantId: p.variantId, quantity: '1' }], payments: [{ method: 'CASH', amount: '80000' }] })));
    const okCount = race.filter((r) => r.status === 201).length;
    // once the limit is hit the promotion is no longer offered → the 80 000 payment is short → 400 (walk-in cannot owe)
    expect(okCount).toBe(2);
    expect(race.every((r) => r.status < 500)).toBe(true);
    expect((await t.http().get(`${api}/promotions/${limited.body.id}`).set(s.auth)).body.usageCount).toBe(2);
    await deactivate(limited.body.id);
    const perCust = await promo({ name: '1 lần / khách', type: 'INVOICE_DISCOUNT', perCustomerLimit: 1, config: { tiers: [{ minTotal: '0', discountPercent: '10' }] } });
    expect((await checkout({ customerId: vipId, lines: [{ variantId: p.variantId, quantity: '1' }], payments: [{ method: 'CASH', amount: '90000' }] })).status).toBe(201);
    expect((await preview({ customerId: vipId, lines: [{ variantId: p.variantId, quantity: '1' }] })).body.promotionDiscount).toBe('0');
    expect((await preview({ customerId: walkinCustomerId, lines: [{ variantId: p.variantId, quantity: '1' }] })).body.promotionDiscount).toBe('10000');
    await deactivate(perCust.body.id);
    // non-stackable with higher priority blocks the rest
    const big = await promo({ name: 'Giảm 30% không cộng dồn', type: 'INVOICE_DISCOUNT', priority: 100, stackable: false, config: { tiers: [{ minTotal: '0', discountPercent: '30' }] } });
    const small = await promo({ name: 'Giảm 5% cộng dồn', type: 'INVOICE_DISCOUNT', priority: 1, stackable: true, config: { tiers: [{ minTotal: '0', discountPercent: '5' }] } });
    const pv = await preview({ lines: [{ variantId: p.variantId, quantity: '1' }] });
    expect(pv.body.promotionDiscount).toBe('30000');
    expect(pv.body.promotions).toHaveLength(1);
    await deactivate(big.body.id);
    expect((await preview({ lines: [{ variantId: p.variantId, quantity: '1' }] })).body.promotionDiscount).toBe('5000');
    await deactivate(small.body.id);
    // branch + customer group targeting
    const other = (await t.http().post(`${api}/branches`).set(s.auth).send({ code: 'CN9', name: 'CN 9' })).body;
    const vipOnly = await promo({ name: 'VIP CN9', type: 'INVOICE_DISCOUNT', branchIds: [other.id], customerGroups: ['VIP'], config: { tiers: [{ minTotal: '0', discountPercent: '50' }] } });
    expect((await preview({ customerId: vipId, lines: [{ variantId: p.variantId, quantity: '1' }] })).body.promotionDiscount).toBe('0'); // wrong branch
    const list = await t.http().get(`${api}/promotions`).set(s.auth).query({ branchId: other.id, running: 'true' });
    expect(list.body.data.map((x: { id: string }) => x.id)).toContain(vipOnly.body.id);
    expect((await t.http().get(`${api}/promotions`).set(s.auth).query({ branchId: s.branchId, running: 'true' })).body.data.map((x: { id: string }) => x.id)).not.toContain(vipOnly.body.id);
    await deactivate(vipOnly.body.id);
  });

  it('T-194 invoice gift tiers; held order keeps promotions, re-evaluated on edit; promotion in use cannot be deleted', async () => {
    const p = await stocked('300000');
    const g = await stocked('25000', '10', '8000');
    const ig = await promo({ name: 'Từ 500k tặng 1 quà', type: 'INVOICE_GIFT', config: { tiers: [{ minTotal: '500000', gifts: [{ variantId: g.variantId, quantity: '1' }] }] } });
    const pv = await preview({ lines: [{ variantId: p.variantId, quantity: '2' }] });
    expect(pv.body.gifts[0].variants[0].id).toBe(g.variantId);
    const hold = await t.http().post(`${api}/invoices`).set(s.auth).send({ branchId: s.branchId, warehouseId: s.warehouseId, lines: [{ variantId: p.variantId, quantity: '2' }, { variantId: g.variantId, quantity: '1', isGift: true, promotionId: ig.body.id }] });
    expect(hold.status).toBe(201);
    expect(hold.body.totalAmount).toBe('600000');
    expect(hold.body.promotions[0].giftQuantity).toBe('1');
    expect((await t.http().delete(`${api}/promotions/${ig.body.id}`).set(s.auth)).status).toBe(409);
    // edit below the threshold with the gift still in → rejected; without the gift → ok
    const edit = await t.http().patch(`${api}/invoices/${hold.body.id}`).set(s.auth).send({ version: 1, lines: [{ variantId: p.variantId, quantity: '1' }, { variantId: g.variantId, quantity: '1', isGift: true, promotionId: ig.body.id }] });
    expect(edit.status).toBe(400);
    const edit2 = await t.http().patch(`${api}/invoices/${hold.body.id}`).set(s.auth).send({ version: 1, lines: [{ variantId: p.variantId, quantity: '1' }] });
    expect(edit2.status).toBe(200);
    expect(edit2.body.promotions).toHaveLength(0);
    const done = await t.http().post(`${api}/invoices/${hold.body.id}/complete`).set(s.auth).send({ version: 2, payments: [{ method: 'CASH', amount: '300000' }] });
    expect(done.status).toBe(200);
    expect((await t.http().get(`${api}/promotions/${ig.body.id}`).set(s.auth)).body.usageCount).toBe(0);
    await deactivate(ig.body.id);
    expect((await t.http().delete(`${api}/promotions/${ig.body.id}`).set(s.auth)).status).toBe(204);
  });

  it('T-195 time windows: weekday / hour restrictions and date range decide eligibility', async () => {
    const p = await stocked('100000');
    const now = new Date();
    const otherDay = (now.getDay() + 1) % 7;
    const dayOff = await promo({ name: 'Ngày khác', type: 'INVOICE_DISCOUNT', daysOfWeek: [otherDay], config: { tiers: [{ minTotal: '0', discountPercent: '10' }] } });
    expect((await preview({ lines: [{ variantId: p.variantId, quantity: '1' }] })).body.promotionDiscount).toBe('0');
    await deactivate(dayOff.body.id);
    const today = await promo({ name: 'Hôm nay', type: 'INVOICE_DISCOUNT', daysOfWeek: [now.getDay()], startsAt: new Date(Date.now() - 60_000).toISOString(), endsAt: new Date(Date.now() + 3600_000).toISOString(), config: { tiers: [{ minTotal: '0', discountPercent: '10' }] } });
    expect((await preview({ lines: [{ variantId: p.variantId, quantity: '1' }] })).body.promotionDiscount).toBe('10000');
    await deactivate(today.body.id);
    const h = now.getHours();
    const closedHour = `${String((h + 2) % 24).padStart(2, '0')}:00`; const closedHour2 = `${String((h + 3) % 24).padStart(2, '0')}:00`;
    const night = await promo({ name: 'Khung giờ khác', type: 'INVOICE_DISCOUNT', timeFrom: closedHour, timeTo: closedHour2, config: { tiers: [{ minTotal: '0', discountPercent: '10' }] } });
    expect((await preview({ lines: [{ variantId: p.variantId, quantity: '1' }] })).body.promotionDiscount).toBe('0');
    await deactivate(night.body.id);
    expect((await promo({ name: 'x', type: 'INVOICE_DISCOUNT', startsAt: '2026-12-31T00:00:00Z', endsAt: '2026-01-01T00:00:00Z', config: { tiers: [{ minTotal: '0', discountPercent: '10' }] } })).status).toBe(400);
    expect((await promo({ name: 'x', type: 'INVOICE_DISCOUNT', timeFrom: '25:00', config: { tiers: [{ minTotal: '0', discountPercent: '10' }] } })).status).toBe(400);
  });

  it('T-196 price books targeted at customer groups: applicable list and enforcement', async () => {
    const p = await stocked('100000');
    const pb = await t.http().post(`${api}/price-books`).set(s.auth).send({ code: 'VIPPB', name: 'Giá VIP', priority: 5, customerGroups: ['VIP'] });
    expect(pb.status).toBe(201);
    await t.http().put(`${api}/price-books/${pb.body.id}/items`).set(s.auth).send({ items: [{ variantId: p.variantId, price: '80000' }] });
    const forVip = await t.http().get(`${api}/invoices/price-books`).set(s.auth).query({ branchId: s.branchId, customerId: vipId });
    expect(forVip.body.map((b: { code: string }) => b.code)).toContain('VIPPB');
    const forWalkin = await t.http().get(`${api}/invoices/price-books`).set(s.auth).query({ branchId: s.branchId });
    expect(forWalkin.body.map((b: { code: string }) => b.code)).not.toContain('VIPPB');
    expect((await preview({ customerId: walkinCustomerId, priceBookId: pb.body.id, lines: [{ variantId: p.variantId, quantity: '1' }] })).status).toBe(400);
    const vip = await preview({ customerId: vipId, priceBookId: pb.body.id, lines: [{ variantId: p.variantId, quantity: '1' }] });
    expect(vip.status).toBe(200);
    expect(vip.body.lines[0].unitPrice).toBe('80000');
  });

  it('T-197 permissions and tenant isolation', async () => {
    const roles = (await t.http().get(`${api}/roles`).set(s.auth)).body;
    const cashier = roles.find((r: { code: string }) => r.code === 'CASHIER');
    await t.http().post(`${api}/users`).set(s.auth).send({ username: 'tnkm', password: 'Secret123', fullName: 'TN', roleIds: [cashier.id], branchIds: [s.branchId] });
    const l = await t.http().post(`${api}/auth/login`).send({ tenantCode: s.tenantCode, username: 'tnkm', password: 'Secret123' });
    const c = { Authorization: `Bearer ${l.body.accessToken}` };
    expect((await t.http().get(`${api}/promotions`).set(c)).status).toBe(200);
    expect((await t.http().post(`${api}/promotions`).set(c).send({ name: 'x', type: 'INVOICE_DISCOUNT', config: { tiers: [{ minTotal: '0', discountPercent: '1' }] } })).status).toBe(403);
    const mine = await promo({ name: 'Riêng', type: 'INVOICE_DISCOUNT', status: 'INACTIVE', config: { tiers: [{ minTotal: '0', discountPercent: '1' }] } });
    const other = await registerTenant(t);
    expect((await t.http().get(`${api}/promotions/${mine.body.id}`).set(other.auth)).status).toBe(404);
    expect((await t.http().get(`${api}/promotions`).set(other.auth)).body.meta.total).toBe(0);
  });
});
