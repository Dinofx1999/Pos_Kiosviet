import { createProduct, createTestApp, postReceipt, registerTenant, Session, TestApp } from './helpers';

describe('Products (T-010..T-014)', () => {
  let t: TestApp;
  let s: Session;
  beforeAll(async () => { t = await createTestApp(); s = await registerTenant(t); });
  afterAll(async () => { await t.close(); });

  it('T-010 auto-generates sequential product codes and default variant sku = code', async () => {
    const a = await createProduct(t, s);
    const b = await createProduct(t, s);
    expect(a.code).toBe('SP000001');
    expect(b.code).toBe('SP000002');
    expect(a.body.variants[0].sku).toBe('SP000001');
    expect(a.body.variants[0].isDefault).toBe(true);
    expect(a.body.variants[0].costPrice).toBe('60000');
  });

  it('accepts a manual code and rejects duplicates', async () => {
    const r1 = await t.http().post('/api/v1/products').set(s.auth).send({ code: 'MANUAL-1', name: 'Manual', variants: [{ sellPrice: '1' }] });
    expect(r1.status).toBe(201);
    const r2 = await t.http().post('/api/v1/products').set(s.auth).send({ code: 'MANUAL-1', name: 'Manual 2', variants: [{ sellPrice: '1' }] });
    expect(r2.status).toBe(409);
    expect(r2.body.code).toBe('DUPLICATE_CODE');
  });

  it('T-011 rejects duplicate SKU and barcode within tenant', async () => {
    await createProduct(t, s, { variants: [{ sku: 'SKU-X', barcode: '8930000001', sellPrice: '10' }] });
    const dupSku = await t.http().post('/api/v1/products').set(s.auth).send({ name: 'Dup', variants: [{ sku: 'SKU-X', sellPrice: '10' }] });
    expect(dupSku.status).toBe(409);
    expect(dupSku.body.code).toBe('DUPLICATE_SKU');
    const dupBarcode = await t.http().post('/api/v1/products').set(s.auth).send({ name: 'Dup', variants: [{ barcode: '8930000001', sellPrice: '10' }] });
    expect(dupBarcode.status).toBe(409);
    expect(dupBarcode.body.code).toBe('DUPLICATE_BARCODE');
  });

  it('T-012 creates variants from attributes, finds by barcode, updates prices', async () => {
    const res = await t.http().post('/api/v1/products').set(s.auth).send({
      name: 'Áo thun', attributeNames: ['Màu', 'Size'],
      variants: [
        { attributes: { Màu: 'Đỏ', Size: 'M' }, sellPrice: '120000', barcode: '111' },
        { attributes: { Màu: 'Đỏ', Size: 'L' }, sellPrice: '125000', barcode: '112' },
      ],
      units: [{ unitName: 'Lốc', conversionFactor: '5', barcode: '113', sellPrice: '550000' }],
    });
    expect(res.status).toBe(201);
    expect(res.body.variants).toHaveLength(2);
    expect(res.body.variants[0].name).toBe('Áo thun - Đỏ - M');
    expect(res.body.variants[1].sku).toBe(`${res.body.code}-2`);
    expect(res.body.hasVariants).toBe(true);

    const byBarcode = await t.http().get('/api/v1/products/by-barcode/112').set(s.auth);
    expect(byBarcode.status).toBe(200);
    expect(byBarcode.body.sku).toBe(`${res.body.code}-2`);
    const byUnitBarcode = await t.http().get('/api/v1/products/by-barcode/113').set(s.auth);
    expect(byUnitBarcode.status).toBe(200);
    expect(byUnitBarcode.body.unit.unitName).toBe('Lốc');

    const upd = await t.http().patch(`/api/v1/products/${res.body.id}`).set(s.auth).send({ variants: [{ id: res.body.variants[0].id, sellPrice: '130000' }, { attributes: { Màu: 'Xanh', Size: 'M' }, sellPrice: '120000' }] });
    expect(upd.status).toBe(200);
    expect(upd.body.variants).toHaveLength(3);
    expect(upd.body.variants.find((v: any) => v.id === res.body.variants[0].id).sellPrice).toBe('130000');

    const missingAttr = await t.http().post('/api/v1/products').set(s.auth).send({ name: 'Bad', attributeNames: ['Màu'], variants: [{ attributes: { Màu: 'Đỏ' }, sellPrice: '1' }, { attributes: {}, sellPrice: '1' }] });
    expect(missingAttr.status).toBe(400);
  });

  it('T-013 cannot delete a product with stock movements; deactivation works', async () => {
    const p = await createProduct(t, s);
    const rec = await postReceipt(t, s, [{ variantId: p.variantId, quantity: '5', unitCost: '50000' }]);
    expect(rec.status).toBe(201);
    const del = await t.http().delete(`/api/v1/products/${p.productId}`).set(s.auth);
    expect(del.status).toBe(409);
    expect(del.body.code).toBe('PRODUCT_IN_USE');
    const off = await t.http().post(`/api/v1/products/${p.productId}/deactivate`).set(s.auth);
    expect(off.status).toBe(200);
    expect(off.body.isActive).toBe(false);
    // cost price cannot be overwritten once there are movements
    const upd = await t.http().patch(`/api/v1/products/${p.productId}`).set(s.auth).send({ variants: [{ id: p.variantId, sellPrice: '1', costPrice: '1' }] });
    expect(upd.body.variants[0].costPrice).toBe('50000');
    const unused = await createProduct(t, s);
    expect((await t.http().delete(`/api/v1/products/${unused.productId}`).set(s.auth)).status).toBe(204);
  });

  it('T-014 lists with search, category/brand filters, stock filters and pagination', async () => {
    const cat = await t.http().post('/api/v1/categories').set(s.auth).send({ name: 'Son' });
    const brand = await t.http().post('/api/v1/brands').set(s.auth).send({ name: 'Brand A' });
    expect(cat.status).toBe(201); expect(brand.status).toBe(201);
    const p = await createProduct(t, s, { name: 'Son môi đặc biệt', categoryId: cat.body.id, brandId: brand.body.id, variants: [{ sellPrice: '1', minStock: '10' }] });
    const list = await t.http().get('/api/v1/products').set(s.auth).query({ search: 'đặc biệt', categoryId: cat.body.id, brandId: brand.body.id });
    expect(list.status).toBe(200);
    expect(list.body.meta.total).toBe(1);
    expect(list.body.data[0].id).toBe(p.productId);
    const low = await t.http().get('/api/v1/products').set(s.auth).query({ stockStatus: 'low' });
    expect(low.body.data.some((x: any) => x.id === p.productId)).toBe(true);
    const out = await t.http().get('/api/v1/products').set(s.auth).query({ stockStatus: 'in', search: 'đặc biệt' });
    expect(out.body.meta.total).toBe(0);
    const page = await t.http().get('/api/v1/products').set(s.auth).query({ page: 1, pageSize: 2 });
    expect(page.body.data).toHaveLength(2);
    expect(page.body.meta.total).toBeGreaterThan(2);
    const tree = await t.http().get('/api/v1/categories').set(s.auth);
    expect(tree.body[0].productCount).toBe(1);
  });

  it('opening stock on create posts a RECEIPT document (OPENING)', async () => {
    const res = await t.http().post('/api/v1/products').set(s.auth).send({ name: 'Có tồn đầu', variants: [{ sellPrice: '10', costPrice: '7' }], initialStock: [{ warehouseId: s.warehouseId, quantity: '12', unitCost: '8' }] });
    expect(res.status).toBe(201);
    expect(res.body.variants[0].onHand).toBe('12');
    expect(res.body.variants[0].costPrice).toBe('8');
    const docs = await t.http().get('/api/v1/inventory/documents').set(s.auth).query({ search: res.body.code });
    expect(docs.body.data[0].status).toBe('POSTED');
    expect(docs.body.data[0].reason).toBe('OPENING');
  });

  it('SERVICE products cannot be stocked; COMBO requires components and reports derived stock', async () => {
    const svc = await createProduct(t, s, { type: 'SERVICE', variants: [{ sellPrice: '50000' }] });
    const rec = await postReceipt(t, s, [{ variantId: svc.variantId, quantity: '1', unitCost: '1' }]);
    expect(rec.status).toBe(400);
    const comp = await createProduct(t, s, { variants: [{ sellPrice: '10', costPrice: '5' }] });
    await postReceipt(t, s, [{ variantId: comp.variantId, quantity: '7', unitCost: '5' }]);
    const noItems = await t.http().post('/api/v1/products').set(s.auth).send({ name: 'Combo', type: 'COMBO', variants: [{ sellPrice: '1' }] });
    expect(noItems.status).toBe(400);
    const combo = await t.http().post('/api/v1/products').set(s.auth).send({ name: 'Combo', type: 'COMBO', variants: [{ sellPrice: '18' }], comboItems: [{ componentVariantId: comp.variantId, quantity: '2' }] });
    expect(combo.status).toBe(201);
    expect(combo.body.onHand).toBe('3'); // floor(7 / 2)
  });

  it('exports products to xlsx and imports the template', async () => {
    const exp = await t.http().get('/api/v1/products/export').set(s.auth).buffer(true).parse((res, cb) => { const chunks: Buffer[] = []; res.on('data', (c) => chunks.push(c)); res.on('end', () => cb(null, Buffer.concat(chunks))); });
    expect(exp.status).toBe(200);
    expect(exp.headers['content-type']).toContain('spreadsheetml');
    const tpl = await t.http().get('/api/v1/products/import-template').set(s.auth).buffer(true).parse((res, cb) => { const chunks: Buffer[] = []; res.on('data', (c) => chunks.push(c)); res.on('end', () => cb(null, Buffer.concat(chunks))); });
    const imp = await t.http().post('/api/v1/products/import').set(s.auth).attach('file', tpl.body as Buffer, 'template.xlsx');
    expect(imp.status).toBe(201);
    expect(imp.body.created).toBe(1);
    expect(imp.body.failed).toHaveLength(0);
    const found = await t.http().get('/api/v1/products').set(s.auth).query({ search: 'SON-HONG' });
    expect(found.body.meta.total).toBe(1);
    expect(found.body.data[0].variants).toHaveLength(2);
  });
});
