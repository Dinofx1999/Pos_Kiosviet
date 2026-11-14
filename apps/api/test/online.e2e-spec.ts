import { randomUUID } from 'node:crypto';
import { normalizeShopConfig } from '../src/modules/online/shop-config';
import { createProduct, createTestApp, postReceipt, registerTenant, Session, TestApp } from './helpers';

const api = '/api/v1';

describe('Bán online: web bán hàng & Flash Sale – T-270..T-279', () => {
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
    await settings({ showPrice: false, showFlashPrice: false });
    const noPrice = (await t.http().get(shop('/flash-sale'))).body.campaigns[0].items[0];
    expect(noPrice).toMatchObject({ price: null, salePrice: null, discountPercent: 25 });
    await settings({ showPrice: true, showFlashPrice: true });

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

  it('T-278 trang chủ web: "Bán chạy" theo số bán 90 ngày, "Nổi bật" đưa hàng còn hàng có ảnh lên trước, lọc ready / exclude, ảnh đại diện danh mục, thương hiệu trên thẻ hàng', async () => {
    await settings({ showStock: false, hideOutOfStock: false, onlyWithImage: false });
    const cat = (await t.http().post(`${api}/categories`).set(s.auth).send({ name: 'Trang điểm T278' })).body;
    const brand = (await t.http().post(`${api}/brands`).set(s.auth).send({ name: 'Maybelline T278' })).body;
    const img = (n: number) => `https://example.com/t278-${n}.jpg`;
    const hot = await stocked('20', '120000', { name: 'Phấn phủ T278 bán chạy', categoryId: cat.id, brandId: brand.id, imageUrl: img(1) });
    const calm = await stocked('20', '90000', { name: 'Kẻ mắt T278 ít bán', categoryId: cat.id, imageUrl: img(2) });
    const noImg = await stocked('20', '80000', { name: 'Son T278 không ảnh', categoryId: cat.id });
    const out = await stocked('0', '70000', { name: 'Mascara T278 hết hàng', categoryId: cat.id, imageUrl: img(3) });
    const checkout = async (variantId: string, quantity: string, amount: string) => { const r = await t.http().post(`${api}/invoices/checkout`).set(s.auth).send({ branchId: s.branchId, warehouseId: s.warehouseId, lines: [{ variantId, quantity }], payments: [{ method: 'CASH', amount }] }); if (r.status !== 201) throw new Error(JSON.stringify(r.body)); return r; };
    await checkout(hot.variantId, '5', '600000');
    await checkout(calm.variantId, '1', '90000');
    const ids = (body: { items: Array<{ id: string }> }) => body.items.map((i) => i.id);
    const best = (await t.http().get(shop(`/products?categoryId=${cat.id}&sort=best`))).body;
    expect(ids(best).slice(0, 2)).toEqual([hot.productId, calm.productId]);
    expect(best.items[0].brand).toBe('Maybelline T278');
    // nổi bật: còn hàng & có ảnh trước, hàng không ảnh sau, hết hàng cuối
    const featured = ids((await t.http().get(shop(`/products?categoryId=${cat.id}`))).body);
    expect(featured).toEqual([hot.productId, calm.productId, noImg.productId, out.productId]);
    // ready: chỉ hàng còn hàng có ảnh; exclude: bỏ hàng đang xem
    expect(ids((await t.http().get(shop(`/products?categoryId=${cat.id}&ready=1&sort=best`))).body)).toEqual([hot.productId, calm.productId]);
    expect(ids((await t.http().get(shop(`/products?categoryId=${cat.id}&ready=1&exclude=${hot.productId}`))).body)).toEqual([calm.productId]);
    expect((await t.http().get(shop('/products?ready=yes'))).status).toBe(400);
    // danh mục có ảnh đại diện = hàng bán chạy còn hàng có ảnh
    const menu = (await t.http().get(shop('/config'))).body.categories as Array<{ id: string; imageUrl: string | null }>;
    expect(menu.find((c) => c.id === cat.id)?.imageUrl).toBe(img(1));
    // tìm không dấu, theo thương hiệu, và chữ viết tắt của cửa hàng (KCN = kem chống nắng)
    const kcn = await stocked('3', '250000', { name: 'ANESSA - KCN T278 60ML', categoryId: cat.id });
    const find = async (q: string) => ids((await t.http().get(shop(`/products?search=${encodeURIComponent(q)}`))).body);
    expect(await find('ke mat t278')).toEqual([calm.productId]);
    expect(await find('maybelline t278')).toEqual([hot.productId]);
    expect(await find('kem chống nắng t278')).toEqual([kcn.productId]);
    expect(await find('kcn t278')).toEqual([kcn.productId]);
    expect(await find('khong co hang nay xyz')).toEqual([]);
    // hàng nhiều phân loại có loại giá 0 → giá "từ" lấy giá thấp nhất khác 0
    const multi = await createProduct(t, s, { name: 'Son T278 nhiều màu', categoryId: cat.id, attributeNames: ['Màu'], variants: [{ sellPrice: '0', attributes: { 'Màu': 'Thử' } }, { sellPrice: '99000', attributes: { 'Màu': 'Đỏ' } }, { sellPrice: '129000', attributes: { 'Màu': 'Hồng' } }] });
    expect((await t.http().get(shop(`/products?search=${encodeURIComponent('son t278 nhieu mau')}`))).body.items[0]).toMatchObject({ id: multi.productId, price: 99000, priceMax: 129000 });
  });

  it('T-279 danh mục trên web: ảnh / tên riêng, tự sắp xếp, ẩn hiện; giá hàng hóa và giá Flash Sale bật / tắt riêng', async () => {
    await settings({ showPrice: true, showFlashPrice: true, hideOutOfStock: false, onlyWithImage: false, flashSaleEnabled: true });
    const many = (await t.http().post(`${api}/categories`).set(s.auth).send({ name: 'CHĂM SÓC DA T279' })).body;
    const few = (await t.http().post(`${api}/categories`).set(s.auth).send({ name: 'Nước hoa T279' })).body;
    const sub = (await t.http().post(`${api}/categories`).set(s.auth).send({ name: 'Toner T279', parentId: many.id })).body;
    const a1 = await stocked('5', '200000', { name: 'Sữa rửa mặt T279', categoryId: many.id, imageUrl: 'https://example.com/t279-a.jpg' });
    await stocked('5', '210000', { name: 'Toner hoa hồng T279', categoryId: sub.id });
    await stocked('5', '220000', { name: 'Kem dưỡng T279', categoryId: many.id });
    const f1 = await stocked('5', '500000', { name: 'Nước hoa T279', categoryId: few.id });
    const menu = async () => (await t.http().get(shop('/config'))).body.categories as Array<{ id: string; name: string; imageUrl: string | null; count: number; children: Array<{ id: string }> }>;
    const pos = (m: Array<{ id: string }>, id: string) => m.findIndex((c) => c.id === id);

    // tự động: nhiều hàng trước
    let m = await menu();
    expect(pos(m, many.id)).toBeGreaterThanOrEqual(0);
    expect(pos(m, many.id)).toBeLessThan(pos(m, few.id));
    expect(m.find((c) => c.id === many.id)).toMatchObject({ count: 3, imageUrl: 'https://example.com/t279-a.jpg' });

    // màn thiết lập: mọi danh mục cấp 1 kể cả đang ẩn, số hàng, ảnh tự động
    const admin = await t.http().get(`${api}/online/settings/categories`).set(s.auth);
    expect(admin.status).toBe(200);
    expect(admin.body.find((c: any) => c.id === many.id)).toMatchObject({ name: 'CHĂM SÓC DA T279', count: 3, autoImageUrl: 'https://example.com/t279-a.jpg', children: 1 });
    expect(admin.body.find((c: any) => c.name === 'Hàng nội bộ')).toBeTruthy(); // ẩn ở T-271 vẫn hiện để bật lại
    expect(admin.body.some((c: any) => c.id === sub.id)).toBe(false); // chỉ danh mục cấp 1

    // tự sắp xếp + ảnh riêng + tên riêng; id lạ bị bỏ, dữ liệu sai bị từ chối
    const ghost = randomUUID();
    const saved = await settings({ customCategoryOrder: true, webCategories: [{ id: few.id, imageUrl: '/uploads/cat-t279.webp', name: null }, { id: ghost, imageUrl: null, name: null }, { id: many.id, imageUrl: '', name: '  Da mặt  ' }] });
    expect(saved.status).toBe(200);
    expect(saved.body.config.webCategories).toEqual([{ id: few.id, imageUrl: '/uploads/cat-t279.webp', name: null }, { id: many.id, imageUrl: null, name: 'Da mặt' }]);
    m = await menu();
    expect(m.slice(0, 2).map((c) => c.id)).toEqual([few.id, many.id]);
    expect(m[0].imageUrl).toBe('/uploads/cat-t279.webp');
    expect(m[1]).toMatchObject({ name: 'Da mặt', imageUrl: 'https://example.com/t279-a.jpg' });
    expect(m[1].children.map((c) => c.id)).toEqual([sub.id]);
    expect((await t.http().get(shop(`/products/${a1.productId}`))).body.category).toEqual({ id: many.id, name: 'Da mặt' });
    expect((await settings({ webCategories: [{ id: few.id, imageUrl: 'javascript:alert(1)' }] })).status).toBe(400);
    expect((await settings({ webCategories: [{ id: 'abc' }] })).status).toBe(400);
    expect((await settings({ webCategories: [{ id: few.id, name: 'x'.repeat(61) }] })).status).toBe(400);
    // về tự động: thứ tự theo số hàng, ảnh / tên riêng giữ nguyên
    await settings({ customCategoryOrder: false });
    m = await menu();
    expect(pos(m, many.id)).toBeLessThan(pos(m, few.id));
    expect(m.find((c) => c.id === few.id)?.imageUrl).toBe('/uploads/cat-t279.webp');
    // ẩn danh mục: không hiện trên web
    await settings({ hiddenCategoryIds: [few.id] });
    expect(pos(await menu(), few.id)).toBe(-1);
    await settings({ hiddenCategoryIds: [], webCategories: [], customCategoryOrder: false });

    // giá hàng hóa / giá Flash Sale tách riêng
    await flash({ name: 'Flash T279', items: [{ variantId: f1.variantId, salePrice: '400000', quantityLimit: 10, perOrderLimit: 2 }] });
    const card = async () => (await t.http().get(shop(`/products?categoryId=${few.id}`))).body.items[0];
    const flashList = async () => (await t.http().get(shop('/flash-sale'))).body.campaigns.flatMap((c: any) => c.items).find((i: any) => i.variantId === f1.variantId);
    await settings({ showPrice: false, showFlashPrice: true });
    expect(await card()).toMatchObject({ price: null, flash: { price: 400000, discountPercent: 20 } });
    expect(await flashList()).toMatchObject({ price: null, salePrice: 400000 });
    expect((await t.http().get(shop('/config'))).body).toMatchObject({ showPrice: false, showFlashPrice: true });
    await settings({ showPrice: true, showFlashPrice: false });
    expect(await card()).toMatchObject({ price: 500000, flash: { price: null, discountPercent: 20 } });
    expect(await flashList()).toMatchObject({ price: 500000, salePrice: null });
    expect((await t.http().get(shop(`/products/${f1.productId}`))).body.variants[0]).toMatchObject({ price: 500000, flash: { price: null } });
    // đơn có dòng Flash Sale: giá dòng Flash Sale ẩn, tổng tiền ẩn; đơn vẫn lưu đúng giá
    const o = await order([{ variantId: f1.variantId, quantity: 3 }]);
    expect(o.status).toBe(201);
    expect(o.body.totalAmount).toBeNull();
    expect(o.body.lines.map((l: any) => [l.quantity, l.unitPrice, l.flash])).toEqual([[2, null, true], [1, 500000, false]]);
    expect(Number((await t.prisma.raw.salesOrder.findFirstOrThrow({ where: { tenantId: s.tenantId, code: o.body.code } })).totalAmount)).toBe(2 * 400000 + 500000);
    await settings({ showPrice: true, showFlashPrice: true });

    // cấu hình cũ chỉ có "Hiển thị giá": tắt thì ẩn cả giá Flash Sale như trước
    expect(normalizeShopConfig({ showPrice: false }).showFlashPrice).toBe(false);
    expect(normalizeShopConfig({ showPrice: true }).showFlashPrice).toBe(true);
    expect(normalizeShopConfig({ showPrice: false, showFlashPrice: true }).showFlashPrice).toBe(true);
  });

  it('T-283 combo trên web: config.combos theo nhóm, lọc type=combo, giá lẻ cộng lại, ảnh món, trang chi tiết; ẩn giá thì không lộ giá lẻ', async () => {
    await settings({ enabled: true, showPrice: true, hideOutOfStock: false, onlyWithImage: false });
    const before = (await t.http().get(shop('/config'))).body.combos.count as number;
    const grp = (await t.http().post(`${api}/categories`).set(s.auth).send({ name: 'Combo Makeup mùa hè' })).body;
    const lip = await stocked('4', '120000', { name: 'Son combo T283', images: [{ url: 'https://cdn.example.com/son-t283.jpg' }] });
    const powder = await stocked('0', '80000', { name: 'Phấn combo T283' });
    const combo = await t.http().post(`${api}/products`).set(s.auth).send({ name: 'Combo Makeup mùa hè T283', type: 'COMBO', categoryId: grp.id, variants: [{ sellPrice: '170000' }], comboItems: [{ componentVariantId: lip.variantId, quantity: '1' }, { componentVariantId: powder.variantId, quantity: '1' }] });
    expect(combo.status).toBe(201);

    const cfg = (await t.http().get(shop('/config'))).body;
    expect(cfg.combos.count).toBe(before + 1);
    expect(cfg.combos.groups).toContainEqual({ id: grp.id, name: 'Combo Makeup mùa hè', count: 1 });
    const list = await t.http().get(shop('/products')).query({ type: 'combo' });
    expect(list.status).toBe(200);
    expect(list.body.items.every((x: any) => x.type === 'COMBO')).toBe(true);
    const item = list.body.items.find((x: any) => x.id === combo.body.id);
    expect(item).toMatchObject({ price: 170000, retailPrice: 200000, inStock: false, imageUrl: 'https://cdn.example.com/son-t283.jpg' }); // phấn hết hàng → combo hết; chưa có ảnh → ảnh món
    expect((await t.http().get(shop('/products')).query({ type: 'combo', categoryId: grp.id })).body.total).toBe(1);
    expect((await t.http().get(shop('/products')).query({ type: 'goods' })).status).toBe(400);
    const detail = await t.http().get(shop(`/products/${combo.body.id}`));
    expect(detail.body.combo.retailPrice).toBe(200000);
    expect(detail.body.combo.items.map((x: any) => x.name).sort()).toEqual(['Phấn combo T283', 'Son combo T283']);
    expect(detail.body.images).toContain('https://cdn.example.com/son-t283.jpg');

    await settings({ showPrice: false });
    const hidden = (await t.http().get(shop('/products')).query({ type: 'combo' })).body.items.find((x: any) => x.id === combo.body.id);
    expect(hidden.price).toBeNull();
    expect(hidden.retailPrice).toBeNull();
    expect((await t.http().get(shop(`/products/${combo.body.id}`))).body.combo.retailPrice).toBeNull();
    await settings({ showPrice: true });
  });
});
