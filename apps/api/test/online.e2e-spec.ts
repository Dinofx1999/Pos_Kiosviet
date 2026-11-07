import { randomUUID } from 'node:crypto';
import { createProduct, createTestApp, postReceipt, registerTenant, Session, TestApp } from './helpers';

const api = '/api/v1';

describe('Bán online: web bán hàng & Flash Sale – T-270..T-276', () => {
  let t: TestApp;
  let s: Session;
  const shop = (path: string) => `${api}/shop/${s.tenantCode}${path}`;
  const settings = (body: Record<string, unknown>) => t.http().put(`${api}/online/settings`).set(s.auth).send(body);
  const stocked = async (qty: string, price = '100000', extra: Record<string, unknown> = {}) => {
    const p = await createProduct(t, s, { variants: [{ sellPrice: price, costPrice: '40000' }], ...extra });
    if (Number(qty) > 0) await postReceipt(t, s, [{ variantId: p.variantId, quantity: qty, unitCost: '40000' }]);
    return p;
  };
  const hour = 3600_000;
  const flash = (body: Record<string, unknown>) => t.http().post(`${api}/online/flash-sales`).set(s.auth).send({ name: 'Flash Sale 12h', startsAt: new Date(Date.now() - hour).toISOString(), endsAt: new Date(Date.now() + hour).toISOString(), ...body });
  const order = (lines: Array<{ variantId: string; quantity: number }>, extra: Record<string, unknown> = {}) =>
    t.http().post(shop('/orders')).send({ clientRef: randomUUID(), name: 'Nguyễn Thị Lan', phone: '0987 654 321', address: '25 Trần Phú, Tam Kỳ', lines, ...extra });

  beforeAll(async () => {
    t = await createTestApp();
    s = await registerTenant(t);
  });
  afterAll(async () => { await t.close(); });

  it('T-270 web đóng mặc định; bật web; cần quyền online.manage; cấu hình sai bị từ chối', async () => {
    const view = await t.http().get(`${api}/online/settings`).set(s.auth);
    expect(view.status).toBe(200);
    expect(view.body.config.enabled).toBe(false);
    expect(view.body.config.showPrice).toBe(true);
    expect(view.body.config.flashSaleEnabled).toBe(true);
    expect(view.body.tenantCode).toBe(s.tenantCode);
    const closed = await t.http().get(shop('/config'));
    expect(closed.status).toBe(200);
    expect(closed.body.enabled).toBe(false);
    expect(closed.body.categories).toBeUndefined();
    expect((await t.http().get(shop('/products'))).body.code).toBe('SHOP_CLOSED');
    expect((await t.http().get(`${api}/online/settings`)).status).toBe(401);
    expect((await t.http().get(`${api}/shop/khong-co-cua-hang/config`)).status).toBe(404);
    expect((await settings({ themeColor: 'pink' })).status).toBe(400);
    expect((await settings({ warehouseId: randomUUID() })).status).toBe(400);
    const on = await settings({ enabled: true, shopName: 'Bảo Ân Cosmetic', hotline: '0905 123 456' });
    expect(on.status).toBe(200);
    expect(on.body.config.enabled).toBe(true);
    const cfg = await t.http().get(shop('/config'));
    expect(cfg.body).toMatchObject({ enabled: true, shopName: 'Bảo Ân Cosmetic', hotline: '0905 123 456', showPrice: true, flashSaleEnabled: true, allowOrder: true });
    // cửa hàng mặc định của /shop theo biến môi trường
    process.env.SHOP_DEFAULT_TENANT = s.tenantCode;
    expect((await t.http().get(`${api}/shop/default/config`)).body.store).toBe(s.tenantCode);
    delete process.env.SHOP_DEFAULT_TENANT;
  });

  it('T-271 danh sách hàng: bật / tắt hiển thị giá, ẩn danh mục, hàng theo lô / ngừng bán không hiện, hết hàng, tìm kiếm', async () => {
    const cat = (await t.http().post(`${api}/categories`).set(s.auth).send({ name: 'Son môi' })).body;
    const hiddenCat = (await t.http().post(`${api}/categories`).set(s.auth).send({ name: 'Hàng nội bộ' })).body;
    const lip = await stocked('5', '150000', { name: 'Son kem lì Bảo Ân 01', categoryId: cat.id });
    const none = await stocked('0', '80000', { name: 'Kem dưỡng hết hàng' });
    await stocked('3', '50000', { name: 'Hàng nội bộ không bán web', categoryId: hiddenCat.id });
    await createProduct(t, s, { name: 'Serum theo lô', trackBatch: true, variants: [{ sellPrice: '300000' }] });
    await createProduct(t, s, { name: 'Ngừng bán', allowSale: false, variants: [{ sellPrice: '300000' }] });
    await settings({ hiddenCategoryIds: [hiddenCat.id], showStock: true });

    const list = await t.http().get(shop('/products?pageSize=60'));
    expect(list.status).toBe(200);
    const names = list.body.items.map((i: any) => i.name);
    expect(names).toEqual(expect.arrayContaining(['Son kem lì Bảo Ân 01', 'Kem dưỡng hết hàng']));
    expect(names).not.toEqual(expect.arrayContaining(['Hàng nội bộ không bán web']));
    expect(names).not.toContain('Serum theo lô');
    expect(names).not.toContain('Ngừng bán');
    const lipCard = list.body.items.find((i: any) => i.id === lip.productId);
    expect(lipCard).toMatchObject({ price: 150000, inStock: true, available: 5, flash: null });
    expect(list.body.items.find((i: any) => i.id === none.productId)).toMatchObject({ inStock: false, available: 0 });
    // hàng còn bán đứng trước hàng hết
    expect(list.body.items[list.body.items.length - 1].inStock).toBe(false);
    expect((await t.http().get(shop(`/products?search=${encodeURIComponent('son kem')}`))).body.items.map((i: any) => i.id)).toEqual([lip.productId]);
    expect((await t.http().get(shop(`/products?categoryId=${cat.id}`))).body.total).toBe(1);
    const cfg = await t.http().get(shop('/config'));
    expect(cfg.body.categories.map((c: any) => c.name)).toEqual(['Son môi']);
    expect((await t.http().get(shop(`/products/${lip.productId}`))).body.variants[0]).toMatchObject({ price: 150000, inStock: true, available: 5 });

    // tắt hiển thị giá → không lộ giá ở danh sách / chi tiết; ẩn hàng hết
    await settings({ showPrice: false, hideOutOfStock: true, showStock: false });
    const hiddenPrice = await t.http().get(shop('/products?pageSize=60'));
    expect(hiddenPrice.body.items.every((i: any) => i.price === null && i.priceMax === null && i.available === null)).toBe(true);
    expect(hiddenPrice.body.items.map((i: any) => i.id)).not.toContain(none.productId);
    expect((await t.http().get(shop(`/products/${lip.productId}`))).body.variants[0].price).toBeNull();
    expect((await t.http().get(shop('/config'))).body.showPrice).toBe(false);
    await settings({ showPrice: true, hideOutOfStock: false });
  });

  it('T-272 Flash Sale: kiểm tra dữ liệu, bật / tắt từng chương trình và bật / tắt Flash Sale toàn web', async () => {
    const p = await stocked('20', '200000', { name: 'Phấn nước Flash' });
    expect((await flash({ items: [{ variantId: p.variantId, salePrice: '200000' }] })).status).toBe(400); // không thấp hơn giá bán
    expect((await flash({ endsAt: new Date(Date.now() - 2 * hour).toISOString(), items: [{ variantId: p.variantId, salePrice: '150000' }] })).status).toBe(400);
    expect((await flash({ items: [{ variantId: p.variantId, salePrice: '150000' }, { variantId: p.variantId, salePrice: '140000' }] })).status).toBe(400);
    expect((await flash({ items: [{ variantId: p.variantId, salePrice: '150000', quantityLimit: 2, perOrderLimit: 5 }] })).status).toBe(400);
    const fs = await flash({ items: [{ variantId: p.variantId, salePrice: '150000', quantityLimit: 10 }] });
    expect(fs.status).toBe(201);
    expect(fs.body.state).toBe('RUNNING');

    const live = await t.http().get(shop('/flash-sale'));
    expect(live.body.enabled).toBe(true);
    expect(live.body.campaigns).toHaveLength(1);
    expect(live.body.campaigns[0].items[0]).toMatchObject({ variantId: p.variantId, price: 200000, salePrice: 150000, discountPercent: 25, limit: 10, sold: 0, remaining: 10 });
    expect((await t.http().get(shop(`/products/${p.productId}`))).body.variants[0].flash).toMatchObject({ price: 150000, discountPercent: 25 });

    // tắt chương trình
    const off = await t.http().patch(`${api}/online/flash-sales/${fs.body.id}/active`).set(s.auth).send({ isActive: false });
    expect(off.body.state).toBe('OFF');
    expect((await t.http().get(shop('/flash-sale'))).body.campaigns).toHaveLength(0);
    expect((await t.http().get(shop(`/products/${p.productId}`))).body.variants[0].flash).toBeNull();
    await t.http().patch(`${api}/online/flash-sales/${fs.body.id}/active`).set(s.auth).send({ isActive: true });

    // tắt Flash Sale toàn web
    await settings({ flashSaleEnabled: false });
    expect((await t.http().get(shop('/flash-sale'))).body).toMatchObject({ enabled: false, campaigns: [] });
    expect((await t.http().get(shop(`/products/${p.productId}`))).body.variants[0].flash).toBeNull();
    await settings({ flashSaleEnabled: true });

    // ẩn giá: Flash Sale chỉ còn mức giảm %
    await settings({ showPrice: false });
    const noPrice = (await t.http().get(shop('/flash-sale'))).body.campaigns[0].items[0];
    expect(noPrice).toMatchObject({ price: null, salePrice: null, discountPercent: 25 });
    await settings({ showPrice: true });

    const listed = await t.http().get(`${api}/online/flash-sales?state=RUNNING`).set(s.auth);
    expect(listed.body.map((x: any) => x.id)).toContain(fs.body.id);
    await t.http().delete(`${api}/online/flash-sales/${fs.body.id}`).set(s.auth).expect(204);
  });

  it('T-273 đặt hàng: giá Flash Sale trong giới hạn mỗi đơn, phần còn lại giá thường; tạo khách theo SĐT; chống gửi trùng; tra cứu đơn', async () => {
    const p = await stocked('10', '120000', { name: 'Tẩy trang Flash' });
    const normal = await stocked('10', '50000', { name: 'Bông tẩy trang' });
    const fs = await flash({ items: [{ variantId: p.variantId, salePrice: '90000', quantityLimit: 5, perOrderLimit: 2 }] });
    const clientRef = randomUUID();
    const res = await order([{ variantId: p.variantId, quantity: 3 }, { variantId: normal.variantId, quantity: 1 }], { clientRef, note: 'Giao giờ hành chính' });
    expect(res.status).toBe(201);
    expect(res.body.code).toMatch(/^DH\d{6}$/);
    expect(res.body.status).toBe('DRAFT');
    expect(res.body.totalAmount).toBe(2 * 90000 + 120000 + 50000);
    expect(res.body.lines.map((l: any) => [l.quantity, l.unitPrice, l.flash])).toEqual([[2, 90000, true], [1, 120000, false], [1, 50000, false]]);
    expect(res.body.phone).toBe('0987***321');

    const db = await t.prisma.raw.salesOrder.findFirstOrThrow({ where: { tenantId: s.tenantId, code: res.body.code }, include: { customer: true } });
    expect(db.source).toBe('ONLINE');
    expect(db.customer?.phone).toBe('0987654321');
    expect(db.note).toContain('25 Trần Phú');
    expect((await t.prisma.raw.flashSaleItem.findFirstOrThrow({ where: { flashSaleId: fs.body.id } })).soldQuantity).toBe(2);

    // gửi lại cùng clientRef → cùng đơn, không giữ thêm suất
    const again = await order([{ variantId: p.variantId, quantity: 3 }], { clientRef });
    expect(again.body.code).toBe(res.body.code);
    expect((await t.prisma.raw.flashSaleItem.findFirstOrThrow({ where: { flashSaleId: fs.body.id } })).soldQuantity).toBe(2);

    // khách cũ (SĐT dạng 84…) được dùng lại
    const second = await order([{ variantId: normal.variantId, quantity: 1 }], { phone: '+84 987 654 321', name: 'Lan' });
    const db2 = await t.prisma.raw.salesOrder.findFirstOrThrow({ where: { tenantId: s.tenantId, code: second.body.code } });
    expect(db2.customerId).toBe(db.customerId);

    // tra cứu đơn: đúng SĐT mới xem được
    expect((await t.http().get(shop(`/orders/${res.body.code}?phone=0987654321`))).body.totalAmount).toBe(350000);
    expect((await t.http().get(shop(`/orders/${res.body.code}?phone=0911111111`))).status).toBe(404);

    // đơn web hiện trong danh sách đặt hàng, lọc theo nguồn Website
    const listed = await t.http().get(`${api}/orders?source=ONLINE`).set(s.auth);
    expect(listed.body.data.map((o: any) => o.code)).toEqual(expect.arrayContaining([res.body.code, second.body.code]));
    expect((await t.http().get(`${api}/online/summary`).set(s.auth)).body.pendingOrders).toBeGreaterThanOrEqual(2);
  });

  it('T-274 suất Flash Sale: hết suất tính giá thường, hủy / xóa đơn trả lại suất', async () => {
    const p = await stocked('20', '100000', { name: 'Mặt nạ suất giới hạn' });
    const fs = await flash({ items: [{ variantId: p.variantId, salePrice: '60000', quantityLimit: 3 }] });
    const sold = async () => (await t.prisma.raw.flashSaleItem.findFirstOrThrow({ where: { flashSaleId: fs.body.id } })).soldQuantity;
    const a = await order([{ variantId: p.variantId, quantity: 2 }]);
    expect(a.body.totalAmount).toBe(120000);
    const b = await order([{ variantId: p.variantId, quantity: 2 }]); // còn 1 suất
    expect(b.body.lines.map((l: any) => [l.quantity, l.unitPrice])).toEqual([[1, 60000], [1, 100000]]);
    expect(await sold()).toBe(3);
    expect((await t.http().get(shop(`/products/${p.productId}`))).body.variants[0].flash).toBeNull(); // hết suất
    const c = await order([{ variantId: p.variantId, quantity: 1 }]);
    expect(c.body.totalAmount).toBe(100000);

    // hủy đơn a → trả 2 suất
    const oa = await t.prisma.raw.salesOrder.findFirstOrThrow({ where: { tenantId: s.tenantId, code: a.body.code } });
    expect((await t.http().post(`${api}/orders/${oa.id}/cancel`).set(s.auth).send({ reason: 'Khách đổi ý' })).status).toBe(200);
    expect(await sold()).toBe(1);
    // xóa phiếu tạm b → trả 1 suất
    const ob = await t.prisma.raw.salesOrder.findFirstOrThrow({ where: { tenantId: s.tenantId, code: b.body.code } });
    await t.http().delete(`${api}/orders/${ob.id}`).set(s.auth).expect(204);
    expect(await sold()).toBe(0);
    expect((await t.http().get(shop(`/products/${p.productId}`))).body.variants[0].flash).toMatchObject({ remaining: 3 });
    // sửa chương trình: không hạ số suất dưới số đã bán, giữ số đã bán của hàng còn lại
    await order([{ variantId: p.variantId, quantity: 2 }]);
    const body = { name: 'Flash Sale sửa', startsAt: fs.body.startsAt, endsAt: fs.body.endsAt };
    expect((await t.http().put(`${api}/online/flash-sales/${fs.body.id}`).set(s.auth).send({ ...body, items: [{ variantId: p.variantId, salePrice: '60000', quantityLimit: 1 }] })).status).toBe(400);
    const upd = await t.http().put(`${api}/online/flash-sales/${fs.body.id}`).set(s.auth).send({ ...body, items: [{ variantId: p.variantId, salePrice: '55000', quantityLimit: 4 }] });
    expect(upd.status).toBe(200);
    expect(upd.body.items[0]).toMatchObject({ soldQuantity: 2, quantityLimit: 4, salePrice: '55000' });
  });

  it('T-275 đặt hàng bị từ chối: vượt tồn, hàng không bán web, tắt nhận đơn, bẫy bot; ẩn giá vẫn nhận đơn', async () => {
    const p = await stocked('2', '70000', { name: 'Kem chống nắng còn 2' });
    const r = await order([{ variantId: p.variantId, quantity: 3 }]);
    expect(r.status).toBe(409);
    expect(r.body.code).toBe('OUT_OF_STOCK');
    expect(r.body.message).toContain('chỉ còn 2');
    const batch = await createProduct(t, s, { name: 'Hàng lô', trackBatch: true, variants: [{ sellPrice: '10000' }] });
    expect((await order([{ variantId: batch.variantId, quantity: 1 }])).body.code).toBe('PRODUCT_NOT_SELLABLE');
    expect((await order([{ variantId: p.variantId, quantity: 1 }], { website: 'http://spam' })).status).toBe(400);
    expect((await order([{ variantId: p.variantId, quantity: 1 }], { phone: '12345' })).status).toBe(400);
    await settings({ allowOrder: false });
    expect((await order([{ variantId: p.variantId, quantity: 1 }])).body.code).toBe('SHOP_ORDER_DISABLED');
    await settings({ allowOrder: true, showPrice: false });
    const hidden = await order([{ variantId: p.variantId, quantity: 1 }]);
    expect(hidden.status).toBe(201);
    expect(hidden.body.totalAmount).toBeNull();
    expect(hidden.body.lines[0].unitPrice).toBeNull();
    const db = await t.prisma.raw.salesOrder.findFirstOrThrow({ where: { tenantId: s.tenantId, code: hidden.body.code } });
    expect(db.totalAmount.toString()).toBe('70000'); // cửa hàng vẫn thấy giá trong đơn
    await settings({ showPrice: true });
  });

  it('T-276 web đóng lại thì không nhận đơn; nhân viên bán hàng không sửa được thiết lập web', async () => {
    const p = await stocked('5', '30000');
    await settings({ enabled: false });
    expect((await order([{ variantId: p.variantId, quantity: 1 }])).body.code).toBe('SHOP_CLOSED');
    expect((await t.http().get(shop('/config'))).body.enabled).toBe(false);
    await settings({ enabled: true });
    const roles = (await t.http().get(`${api}/roles`).set(s.auth)).body;
    const cashierRole = (Array.isArray(roles) ? roles : roles.data).find((r: any) => r.code === 'CASHIER');
    const u = await t.http().post(`${api}/users`).set(s.auth).send({ username: 'thungan', password: 'Secret123', fullName: 'Thu ngân', roleIds: [cashierRole.id], allBranches: true });
    expect(u.status).toBe(201);
    const login = await t.http().post(`${api}/auth/login`).send({ tenantCode: s.tenantCode, username: 'thungan', password: 'Secret123' });
    const auth = { Authorization: `Bearer ${login.body.accessToken}` };
    expect((await t.http().put(`${api}/online/settings`).set(auth).send({ showPrice: false })).status).toBe(403);
    expect((await t.http().get(`${api}/online/summary`).set(auth)).status).toBe(200);
  });

  it('T-277 còn hàng trên web cộng tồn các kho; đơn gắn vào kho đủ hàng cùng chi nhánh; chọn riêng kho tính tồn', async () => {
    const wh2 = (await t.http().post(`${api}/warehouses`).set(s.auth).send({ branchId: s.branchId, code: 'KHO-TONG', name: 'Kho tổng' })).body;
    expect(wh2.id).toBeDefined();
    const a = await stocked('1', '40000', { name: 'Toner hai kho' });
    await postReceipt(t, s, [{ variantId: a.variantId, quantity: '4', unitCost: '20000' }], { warehouseId: wh2.id });
    const b = await createProduct(t, s, { name: 'Chỉ có ở kho tổng', variants: [{ sellPrice: '30000' }] });
    await postReceipt(t, s, [{ variantId: b.variantId, quantity: '3', unitCost: '10000' }], { warehouseId: wh2.id });
    await settings({ showStock: true, stockWarehouseIds: [] });
    expect((await t.http().get(shop(`/products/${a.productId}`))).body.variants[0]).toMatchObject({ inStock: true, available: 5 });
    expect((await t.http().get(shop(`/products/${b.productId}`))).body.variants[0]).toMatchObject({ inStock: true, available: 3 });
    expect((await t.http().get(shop(`/products?search=${encodeURIComponent('Chỉ có ở kho tổng')}`))).body.items[0]).toMatchObject({ inStock: true, available: 3 });
    // 1 + 4 = 5 → đặt được 5, đặt 6 thì "chỉ còn 5"
    expect((await order([{ variantId: a.variantId, quantity: 6 }])).body.message).toContain('chỉ còn 5');
    expect((await order([{ variantId: a.variantId, quantity: 5 }])).status).toBe(201);
    // hàng chỉ có ở kho tổng → đơn gắn kho tổng, xác nhận (giữ tồn) được ngay
    const ob = await order([{ variantId: b.variantId, quantity: 2 }]);
    const dbb = await t.prisma.raw.salesOrder.findFirstOrThrow({ where: { tenantId: s.tenantId, code: ob.body.code } });
    expect(dbb.warehouseId).toBe(wh2.id);
    expect((await t.http().post(`${api}/orders/${dbb.id}/confirm`).set(s.auth).send({})).status).toBe(200);
    // chỉ tính kho chính → hàng b hết trên web
    await settings({ stockWarehouseIds: [s.warehouseId] });
    expect((await t.http().get(shop(`/products/${b.productId}`))).body.variants[0].inStock).toBe(false);
    expect((await order([{ variantId: b.variantId, quantity: 1 }])).body.code).toBe('OUT_OF_STOCK');
    expect((await settings({ stockWarehouseIds: [randomUUID()] })).status).toBe(400);
    await settings({ stockWarehouseIds: [] });
  });
});
