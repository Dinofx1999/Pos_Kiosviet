import * as ExcelJS from 'exceljs';
import * as http from 'node:http';
import { AddressInfo } from 'node:net';
import { balanceOf, createTestApp, registerTenant, Session, TestApp } from './helpers';

const api = '/api/v1';

async function xlsx(headers: string[], rows: Array<Array<string | number>>): Promise<Buffer> {
  const wb = new ExcelJS.Workbook();
  const ws = wb.addWorksheet('Sheet1');
  ws.addRow(headers);
  for (const r of rows) ws.addRow(r);
  return Buffer.from(await wb.xlsx.writeBuffer());
}

describe('KiotViet migration: Excel importers, API connector, reconciliation (Module 13) – T-220..T-227', () => {
  let t: TestApp;
  let s: Session;
  beforeAll(async () => {
    t = await createTestApp();
    s = await registerTenant(t);
  });
  afterAll(async () => { await t.close(); });

  const preview = (type: string, buf: Buffer, options: Record<string, unknown> = {}, name = 'export.xlsx') => t.http().post(`${api}/integrations/import/preview`).set(s.auth).field('type', type).field('options', JSON.stringify(options)).attach('file', buf, name);
  const commit = (jobId: string, body: Record<string, unknown> = {}) => t.http().post(`${api}/integrations/import/${jobId}/commit`).set(s.auth).send(body);

  it('T-220 products export: columns detected, category path, brand, images, unit rows, stock adjusted to the exported figure; re-import updates instead of duplicating', async () => {
    const headers = ['Loại hàng', 'Nhóm hàng(3 Cấp)', 'Mã hàng', 'Mã vạch', 'Tên hàng', 'Thương hiệu', 'Giá bán', 'Giá vốn', 'Tồn kho', 'ĐVT', 'Mã ĐVT Cơ bản', 'Quy đổi', 'Hình ảnh (url1,url2...)', 'Đang kinh doanh', 'Mô tả'];
    const file = await xlsx(headers, [
      ['Hàng hóa', 'Mỹ phẩm>>Chăm sóc da>>Serum', 'SP000101', '8930001', 'Serum Vitamin C 30ml', 'Innisfree', '350.000', '210.000', '12', 'Chai', '', '', 'https://cdn.example.com/a.jpg,https://cdn.example.com/b.jpg', 'Đang kinh doanh', 'Sáng da'],
      ['Hàng hóa', 'Mỹ phẩm>>Trang điểm', 'SP000102', '', 'Son lì đỏ', '', '189000', '95000', '0', 'Cây', '', '', '', 'Ngừng kinh doanh', ''],
      ['Hàng hóa', 'Mỹ phẩm>>Chăm sóc da>>Serum', 'SP000101-H', '', 'Serum Vitamin C 30ml (Hộp 6)', 'Innisfree', '1.950.000', '', '', 'Hộp', 'SP000101', '6', '', 'Đang kinh doanh', ''],
      ['Dịch vụ', '', 'DV0001', '', 'Gói chăm sóc da mặt', '', '500000', '', '', 'Lần', '', '', '', 'Đang kinh doanh', ''],
    ]);
    const pv = await preview('PRODUCTS', file, { defaultWarehouseId: s.warehouseId });
    expect(pv.status).toBe(201);
    expect(pv.body.rowCount).toBe(4);
    expect(pv.body.mapping.code).toBe('Mã hàng');
    expect(pv.body.mapping.category).toBe('Nhóm hàng(3 Cấp)');
    expect(pv.body.mapping.images).toBe('Hình ảnh (url1,url2...)');
    expect(pv.body.mapping.stock).toBe('Tồn kho');
    expect(pv.body.missing).toEqual([]);
    expect(pv.body.issues).toEqual([]);
    const done = await commit(pv.body.jobId);
    expect(done.status).toBe(200);
    expect(done.body.created).toBe(3);
    expect(done.body.units).toBe(1);
    expect(done.body.failed).toBe(0);
    expect(done.body.stockLines).toBe(1); // only SP000101 has stock > current (son has 0 = current)
    const p1 = (await t.http().get(`${api}/products`).set(s.auth).query({ search: 'SP000101' })).body.data.find((x: { code: string }) => x.code === 'SP000101');
    expect(p1).toBeDefined();
    const detail = await t.http().get(`${api}/products/${p1.id}`).set(s.auth);
    expect(detail.body.category.name).toBe('Serum');
    expect(detail.body.brand.name).toBe('Innisfree');
    expect(detail.body.images.map((i: { url: string }) => i.url)).toEqual(['https://cdn.example.com/a.jpg', 'https://cdn.example.com/b.jpg']);
    expect(detail.body.variants[0].barcode).toBe('8930001');
    expect(detail.body.variants[0].sellPrice).toBe('350000');
    expect(detail.body.units[0].unitName).toBe('Hộp');
    expect(detail.body.units[0].conversionFactor).toBe('6');
    expect(detail.body.units[0].sellPrice).toBe('1950000');
    const bal = await balanceOf(t, s, detail.body.variants[0].id);
    expect(bal.onHand).toBe('12');
    expect(bal.costPrice).toBe('210000');
    const cats = (await t.http().get(`${api}/categories`).set(s.auth)).body;
    expect(cats.some((c: { name: string }) => c.name === 'Mỹ phẩm')).toBe(true);
    const son = (await t.http().get(`${api}/products`).set(s.auth).query({ search: 'SP000102', includeInactive: 'true' })).body.data.find((x: { code: string }) => x.code === 'SP000102');
    expect(son?.isActive).toBe(false);
    // re-import with changed price and stock → update, not duplicate; stock corrected
    const file2 = await xlsx(headers, [['Hàng hóa', 'Mỹ phẩm>>Chăm sóc da>>Serum', 'SP000101', '8930001', 'Serum Vitamin C 30ml', 'Innisfree', '360.000', '210.000', '10', 'Chai', '', '', '', 'Đang kinh doanh', '']]);
    const pv2 = await preview('PRODUCTS', file2, { defaultWarehouseId: s.warehouseId });
    const done2 = await commit(pv2.body.jobId);
    expect(done2.body.updated).toBe(1);
    expect(done2.body.created).toBe(0);
    expect((await balanceOf(t, s, detail.body.variants[0].id)).onHand).toBe('10');
    expect((await t.http().get(`${api}/products/${p1.id}`).set(s.auth)).body.variants[0].sellPrice).toBe('360000');
    expect((await t.http().get(`${api}/products`).set(s.auth).query({ search: 'Serum Vitamin' })).body.meta.total).toBe(1);
    expect((await t.http().post(`${api}/inventory/reconcile`).set(s.auth)).body.ok).toBe(true);
    // committing twice is refused; job list/detail
    expect((await commit(pv.body.jobId)).status).toBe(409);
    const jobs = await t.http().get(`${api}/integrations/import-jobs`).set(s.auth);
    expect(jobs.body.meta.total).toBe(2);
    expect((await t.http().get(`${api}/integrations/import-jobs/${pv.body.jobId}`).set(s.auth)).body.status).toBe('DONE');
  });

  it('T-221 customers & suppliers with debts: opening balances on create, syncDebt adjusts existing, phone dedupe, group names', async () => {
    const cust = await xlsx(['Mã khách hàng', 'Tên khách hàng', 'Điện thoại', 'Địa chỉ', 'Khu vực', 'Ngày sinh', 'Giới tính', 'Nhóm khách hàng', 'Nợ cần thu hiện tại', 'Điểm hiện tại', 'Trạng thái'], [
      ['KH000501', 'Nguyễn Thị Hoa', '0901000501', '12 Lê Lợi', 'Quận 1 - TP HCM', '15/08/1990', 'Nữ', 'VIP', '1.250.000', '120', 'Đang hoạt động'],
      ['KH000502', 'Trần Văn B', '0901000502', '', '', '', 'Nam', '', '0', '0', 'Đang hoạt động'],
      ['', 'Khách không mã', '0901000503', '', '', '', '', 'Thân thiết', '-200000', '', ''],
    ]);
    const pv = await preview('CUSTOMERS', cust);
    expect(pv.body.mapping.debt).toBe('Nợ cần thu hiện tại');
    const done = await commit(pv.body.jobId);
    expect(done.status).toBe(200);
    expect(done.body.created).toBe(3);
    const hoa = (await t.http().get(`${api}/customers`).set(s.auth).query({ search: 'KH000501' })).body.data[0];
    expect(hoa.balance).toBe('1250000');
    expect(hoa.groupName).toBe('VIP');
    expect(hoa.gender).toBe('FEMALE');
    expect(hoa.birthday).toContain('1990-08-15');
    expect(hoa.address).toContain('Quận 1');
    const noCode = (await t.http().get(`${api}/customers`).set(s.auth).query({ search: '0901000503' })).body.data[0];
    expect(noCode.balance).toBe('-200000'); // store owes the customer
    expect(noCode.code).toMatch(/^KH\d{6}$/);
    // re-import: debt changed in KiotViet → only adjusted with syncDebt
    const cust2 = await xlsx(['Mã khách hàng', 'Tên khách hàng', 'Điện thoại', 'Nợ cần thu hiện tại'], [['KH000501', 'Nguyễn Thị Hoa', '0901000501', '1.000.000'], ['', 'Khách không mã', '0901000503', '0']]);
    const pvA = await preview('CUSTOMERS', cust2, { syncDebt: false });
    const a = await commit(pvA.body.jobId);
    expect(a.body.updated).toBe(2);
    expect((await t.http().get(`${api}/customers/${hoa.id}`).set(s.auth)).body.balance).toBe('1250000');
    const pvB = await preview('CUSTOMERS', cust2, { syncDebt: true });
    const b = await commit(pvB.body.jobId);
    expect(b.body.debtAdjusted).toBe(2);
    expect((await t.http().get(`${api}/customers/${hoa.id}`).set(s.auth)).body.balance).toBe('1000000');
    expect((await t.http().get(`${api}/customers/${noCode.id}`).set(s.auth)).body.balance).toBe('0');
    expect((await t.http().get(`${api}/customers`).set(s.auth)).body.meta.total).toBe(3);
    const ledger = await t.http().get(`${api}/customers/${hoa.id}/ledger`).set(s.auth);
    expect(ledger.body.data.some((e: { type: string }) => e.type === 'ADJUSTMENT')).toBe(true);
    // suppliers
    const sup = await xlsx(['Mã nhà cung cấp', 'Tên nhà cung cấp', 'Điện thoại', 'Nợ cần trả hiện tại', 'Nhóm NCC', 'Công ty'], [['NCC000301', 'Công ty Mỹ phẩm Hoa Sen', '02838000301', '5.500.000', 'Mỹ phẩm', 'Hoa Sen Co.'], ['NCC000302', 'Kho sỉ Minh Anh', '', '0', '', '']]);
    const pvS = await preview('SUPPLIERS', sup);
    const ds = await commit(pvS.body.jobId);
    expect(ds.body.created).toBe(2);
    const hs = (await t.http().get(`${api}/suppliers`).set(s.auth).query({ search: 'NCC000301' })).body.data[0];
    expect(hs.balance).toBe('5500000');
    expect(hs.groupName).toBe('Mỹ phẩm');
    expect((await t.http().post(`${api}/payments/reconcile`).set(s.auth)).status).toBe(200);
  });

  it('T-222 invoice history: grouped by invoice code, lines matched by product code, no stock / ledger / cash side effects, cancelled kept, idempotent', async () => {
    const custBefore = (await t.http().get(`${api}/customers`).set(s.auth).query({ search: 'KH000501' })).body.data[0].balance;
    const p1 = (await t.http().get(`${api}/products`).set(s.auth).query({ search: 'SP000101' })).body.data.find((x: { code: string }) => x.code === 'SP000101');
    const onHandBefore = (await balanceOf(t, s, p1.variants?.[0]?.id ?? (await t.http().get(`${api}/products/${p1.id}`).set(s.auth)).body.variants[0].id)).onHand;
    const inv = await xlsx(['Mã hóa đơn', 'Thời gian', 'Mã khách hàng', 'Khách hàng', 'Chi nhánh', 'Người bán', 'Tổng tiền hàng', 'Giảm giá', 'Khách cần trả', 'Khách đã trả', 'Trạng thái', 'Mã hàng', 'Tên hàng', 'Số lượng', 'Đơn giá', 'Giảm giá dòng', 'Thành tiền'], [
      ['HD004501', '20/09/2026 10:15', 'KH000501', 'Nguyễn Thị Hoa', 'Chi nhánh trung tâm', 'Owner', '889.000', '39.000', '850.000', '850.000', 'Hoàn thành', 'SP000101', 'Serum Vitamin C 30ml', '2', '350.000', '0', '700.000'],
      ['HD004501', '20/09/2026 10:15', 'KH000501', 'Nguyễn Thị Hoa', 'Chi nhánh trung tâm', 'Owner', '889.000', '39.000', '850.000', '850.000', 'Hoàn thành', 'SP000102', 'Son lì đỏ', '1', '189.000', '0', '189.000'],
      ['HD004502', '21/09/2026 15:00', '', 'Khách lẻ', 'Chi nhánh trung tâm', '', '350.000', '0', '350.000', '0', 'Đã hủy', 'SP000101', 'Serum Vitamin C 30ml', '1', '350.000', '0', '350.000'],
      ['HD004503', '22/09/2026 09:00', '', 'Khách lẻ', 'Chi nhánh trung tâm', '', '99.000', '0', '99.000', '99.000', 'Hoàn thành', 'SP-KHONG-CO', 'Hàng chưa nhập', '1', '99.000', '0', '99.000'],
    ]);
    const pv = await preview('INVOICES', inv, { defaultBranchId: s.branchId });
    expect(pv.body.mapping.lineCode).toBe('Mã hàng');
    expect(pv.body.mapping.code).toBe('Mã hóa đơn');
    const done = await commit(pv.body.jobId);
    expect(done.status).toBe(200);
    // mã hàng không còn trong danh mục → tạo hàng "ngừng kinh doanh" giữ chỗ, hóa đơn vẫn đủ dòng
    expect(done.body.created).toBe(3);
    expect(done.body.failed).toBe(0);
    expect(done.body.placeholders).toBe(1);
    const ph = (await t.http().get(`${api}/products`).set(s.auth).query({ search: 'SP-KHONG-CO', includeInactive: 'true' })).body.data.find((x: { code: string }) => x.code === 'SP-KHONG-CO');
    expect(ph).toMatchObject({ name: 'Hàng chưa nhập', isActive: false });
    // ngày giờ trong file KiotViet là số ngày Excel → đọc đúng ngày, không thành năm 46320
    const serialFile = await xlsx(['Mã hóa đơn', 'Thời gian', 'Chi nhánh', 'Khách cần trả', 'Khách đã trả', 'Trạng thái', 'Mã hàng', 'Tên hàng', 'Số lượng', 'Đơn giá', 'Thành tiền'], [
      ['HD004509', '46295.93472271991', 'Chi nhánh trung tâm', '350000', '350000', 'Hoàn thành', 'SP000101', 'Serum Vitamin C 30ml', '1', '350000', '350000'],
    ]);
    expect((await commit((await preview('INVOICES', serialFile, { defaultBranchId: s.branchId })).body.jobId)).body.created).toBe(1);
    const serialInv = (await t.http().get(`${api}/invoices`).set(s.auth).query({ search: 'KV-HD004509' })).body.data[0];
    expect(new Date(new Date(serialInv.invoiceDate).getTime() + 7 * 3600_000).toISOString().slice(0, 16)).toBe('2026-09-30T22:26');
    const list = await t.http().get(`${api}/invoices`).set(s.auth).query({ search: 'KV-HD004501' });
    expect(list.body.data).toHaveLength(1);
    const detail = await t.http().get(`${api}/invoices/${list.body.data[0].id}`).set(s.auth);
    expect(detail.body.status).toBe('COMPLETED');
    expect(detail.body.imported).toBe(true);
    expect(detail.body.externalRef).toBe('HD004501');
    expect(detail.body.totalAmount).toBe('850000');
    expect(detail.body.paidAmount).toBe('850000');
    expect(detail.body.lines).toHaveLength(2);
    expect(detail.body.customer.code).toBe('KH000501');
    expect(detail.body.invoiceDate).toContain('2026-09-20');
    expect(detail.body.movements).toEqual([]);
    expect((await t.http().get(`${api}/invoices`).set(s.auth).query({ search: 'KV-HD004502', status: 'CANCELLED' })).body.data).toHaveLength(1);
    // nothing moved: stock, debt and funds are untouched by history
    expect((await balanceOf(t, s, detail.body.lines[0].variantId)).onHand).toBe(onHandBefore);
    expect((await t.http().get(`${api}/customers`).set(s.auth).query({ search: 'KH000501' })).body.data[0].balance).toBe(custBefore);
    // re-import skips already imported codes
    const again = await commit((await preview('INVOICES', inv, { defaultBranchId: s.branchId })).body.jobId);
    expect(again.body.created).toBe(0);
    expect(again.body.skipped).toBeGreaterThanOrEqual(2);
    const rec = await t.http().get(`${api}/integrations/reconcile`).set(s.auth);
    expect(rec.status).toBe(200);
    expect(rec.body.importedInvoices.count).toBe(4);
    expect(rec.body.importedInvoices.revenue).toBe('1299000');
    expect(rec.body.customers.count).toBe(3);
    expect(Number(rec.body.stock.value)).toBeGreaterThan(0);
  });

  it('T-223 KiotViet API connector: credentials stored encrypted, test lists branches, import pulls products/customers/suppliers/invoices through the same pipeline, auth failure reported', async () => {
    // a tiny stand-in for id.kiotviet.vn + public.kiotapi.com
    const calls: string[] = [];
    const server = http.createServer((req, res) => {
      const url = new URL(req.url ?? '/', 'http://x');
      calls.push(`${req.method} ${url.pathname}`);
      const json = (code: number, body: unknown) => { res.writeHead(code, { 'Content-Type': 'application/json' }); res.end(JSON.stringify(body)); };
      if (url.pathname === '/connect/token') {
        let body = ''; req.on('data', (c) => (body += c)); req.on('end', () => { const p = new URLSearchParams(body); if (p.get('client_secret') !== 'good-secret-123') return json(400, { error: 'invalid_client' }); json(200, { access_token: 'tok', expires_in: 3600, token_type: 'Bearer' }); });
        return;
      }
      if (req.headers.authorization !== 'Bearer tok' || req.headers.retailer !== 'myshop') return json(401, { message: 'unauthorized' });
      if (url.pathname === '/branches') return json(200, { total: 2, pageSize: 100, data: [{ id: 11, branchName: 'Cửa hàng chính' }, { id: 12, branchName: 'Kho online' }] });
      if (url.pathname === '/products') return json(200, { total: 2, pageSize: 100, data: [
        { id: 1, code: 'KV0001', name: 'Kem chống nắng', fullName: 'Kem chống nắng 50ml', categoryName: 'Chăm sóc da', basePrice: 250000, unit: 'Tuýp', barCode: '8931111', isActive: true, allowsSale: true, images: ['https://cdn.kiotviet.vn/kcn.jpg'], inventories: [{ branchId: 11, branchName: 'Cửa hàng chính', cost: 150000, onHand: 7 }, { branchId: 12, branchName: 'Kho online', cost: 150000, onHand: 3 }] },
        { id: 2, code: 'KV0001-L', name: 'Kem chống nắng (Lốc 3)', fullName: 'Kem chống nắng (Lốc 3)', basePrice: 700000, unit: 'Lốc', masterUnitId: 1, conversionValue: 3, isActive: true, inventories: [] },
      ] });
      if (url.pathname === '/customers') return json(200, { total: 1, pageSize: 100, data: [{ id: 5, code: 'KVKH001', name: 'Lê Thị Mai', gender: false, contactNumber: '0988000001', debt: 320000, groups: 'VIP, Online', birthDate: '1995-02-03T00:00:00' }] });
      if (url.pathname === '/suppliers') return json(200, { total: 1, pageSize: 100, data: [{ id: 7, code: 'KVNCC01', name: 'NCC Hàn Quốc', contactNumber: '0288000007', debt: 1500000 }] });
      if (url.pathname === '/invoices') return json(200, { total: 1, pageSize: 100, data: [{ id: 9, code: 'HD900001', purchaseDate: '2026-10-01T09:30:00', branchName: 'Cửa hàng chính', customerCode: 'KVKH001', total: 500000, totalPayment: 500000, discount: 0, status: 1, statusValue: 'Hoàn thành', invoiceDetails: [{ productCode: 'KV0001', productName: 'Kem chống nắng', quantity: 2, price: 250000, discount: 0, subTotal: 500000 }] }] });
      json(404, { message: 'not found' });
    });
    await new Promise<void>((r) => server.listen(0, '127.0.0.1', () => r()));
    const base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
    process.env.KIOTVIET_TOKEN_URL = `${base}/connect/token`;
    process.env.KIOTVIET_API_URL = base;
    try {
      expect((await t.http().post(`${api}/integrations/kiotviet/test`).set(s.auth)).body.code).toBe('KIOTVIET_NOT_CONFIGURED');
      const saved = await t.http().put(`${api}/integrations/kiotviet`).set(s.auth).send({ retailer: 'myshop', clientId: 'client-id-0001', clientSecret: 'wrong-secret-000' });
      expect(saved.status).toBe(200);
      expect(saved.body.hasSecret).toBe(true);
      expect(saved.body.clientId).not.toBe('client-id-0001'); // masked
      const row = await t.prisma.raw.integrationConnection.findFirst({ where: { tenantId: s.tenantId } });
      expect(row?.secretEnc).toBeTruthy();
      expect(row?.secretEnc).not.toContain('wrong-secret');
      const bad = await t.http().post(`${api}/integrations/kiotviet/test`).set(s.auth);
      expect(bad.status).toBe(409);
      expect(bad.body.code).toBe('KIOTVIET_AUTH_FAILED');
      expect((await t.http().get(`${api}/integrations/kiotviet`).set(s.auth)).body.status).toBe('ERROR');
      await t.http().put(`${api}/integrations/kiotviet`).set(s.auth).send({ retailer: 'myshop', clientId: 'client-id-0001', clientSecret: 'good-secret-123' });
      const ok = await t.http().post(`${api}/integrations/kiotviet/test`).set(s.auth);
      expect(ok.status).toBe(200);
      expect(ok.body.branches.map((b: { name: string }) => b.name)).toEqual(['Cửa hàng chính', 'Kho online']);
      expect(ok.body.warehouses[0].id).toBe(s.warehouseId);
      // second warehouse for the online stock
      const wh2 = (await t.http().post(`${api}/warehouses`).set(s.auth).send({ branchId: s.branchId, code: 'KHO-ONL', name: 'Kho online' })).body;
      const imp = await t.http().post(`${api}/integrations/kiotviet/import`).set(s.auth).send({ entities: ['PRODUCTS', 'CUSTOMERS', 'SUPPLIERS', 'INVOICES'], branchMap: { 'Cửa hàng chính': s.warehouseId, 'Kho online': wh2.id }, syncDebt: true });
      expect(imp.status).toBe(200);
      const byEntity = Object.fromEntries(imp.body.results.map((r: { entity: string; totals: Record<string, unknown> }) => [r.entity, r.totals]));
      expect(byEntity.PRODUCTS.created).toBe(1);
      expect(byEntity.PRODUCTS.units).toBe(1);
      expect(byEntity.PRODUCTS.stockLines).toBe(2);
      expect(byEntity.CUSTOMERS.created).toBe(1);
      expect(byEntity.SUPPLIERS.created).toBe(1);
      expect(byEntity.INVOICES.created).toBe(1);
      const kv = (await t.http().get(`${api}/products`).set(s.auth).query({ search: 'KV0001' })).body.data.find((x: { code: string }) => x.code === 'KV0001');
      const kvDetail = await t.http().get(`${api}/products/${kv.id}`).set(s.auth);
      expect(kvDetail.body.units[0].conversionFactor).toBe('3');
      expect((await balanceOf(t, s, kvDetail.body.variants[0].id)).onHand).toBe('7');
      expect((await balanceOf(t, s, kvDetail.body.variants[0].id, wh2.id)).onHand).toBe('3');
      expect((await t.http().get(`${api}/customers`).set(s.auth).query({ search: 'KVKH001' })).body.data[0].balance).toBe('320000');
      expect((await t.http().get(`${api}/customers`).set(s.auth).query({ search: 'KVKH001' })).body.data[0].groupName).toBe('VIP');
      expect((await t.http().get(`${api}/invoices`).set(s.auth).query({ search: 'KV-HD900001' })).body.data).toHaveLength(1);
      const conn = await t.http().get(`${api}/integrations/kiotviet`).set(s.auth);
      expect(conn.body.status).toBe('CONNECTED');
      expect(conn.body.lastSyncAt).toBeTruthy();
      expect(calls.filter((c) => c.endsWith('/products'))).toHaveLength(1);
      expect(imp.body.reconcile.products.products).toBeGreaterThan(3);
      expect((await t.http().delete(`${api}/integrations/kiotviet`).set(s.auth)).status).toBe(200);
      expect((await t.http().get(`${api}/integrations/kiotviet`).set(s.auth)).body.status).toBe('DISCONNECTED');
    } finally {
      delete process.env.KIOTVIET_TOKEN_URL; delete process.env.KIOTVIET_API_URL;
      await new Promise<void>((r) => server.close(() => r()));
    }
  });

  it('T-224 permissions, bad files and tenant isolation', async () => {
    const roles = (await t.http().get(`${api}/roles`).set(s.auth)).body;
    const cashier = roles.find((r: { code: string }) => r.code === 'CASHIER');
    await t.http().post(`${api}/users`).set(s.auth).send({ username: 'tnimp', password: 'Secret123', fullName: 'TN', roleIds: [cashier.id], branchIds: [s.branchId] });
    const l = await t.http().post(`${api}/auth/login`).send({ tenantCode: s.tenantCode, username: 'tnimp', password: 'Secret123' });
    const c = { Authorization: `Bearer ${l.body.accessToken}` };
    expect((await t.http().get(`${api}/integrations/import-jobs`).set(c)).status).toBe(403);
    expect((await t.http().post(`${api}/integrations/import/preview`).set(c).field('type', 'PRODUCTS').attach('file', await xlsx(['Mã hàng', 'Tên hàng'], [['A', 'B']]), 'x.xlsx')).status).toBe(403);
    expect((await t.http().post(`${api}/integrations/import/preview`).set(s.auth).field('type', 'PRODUCTS')).status).toBe(400);
    const corrupt = await t.http().post(`${api}/integrations/import/preview`).set(s.auth).field('type', 'PRODUCTS').attach('file', Buffer.from('not an xlsx'), 'x.xlsx');
    expect(corrupt.status).toBe(400); // a broken/non-xlsx upload is the user's problem, not a 500
    expect(corrupt.body.message).toMatch(/Không đọc được file Excel/);
    const missing = await preview('PRODUCTS', await xlsx(['Giá bán', 'Tồn kho', 'Ghi chú'], [['1', '2', '3']]));
    expect(missing.status).toBe(201);
    expect(missing.body.missing).toEqual(expect.arrayContaining(['code', 'name']));
    expect((await commit(missing.body.jobId)).status).toBe(400);
    const fixed = await commit(missing.body.jobId, { mapping: { code: 'Ghi chú', name: 'Ghi chú' } });
    expect(fixed.status).toBe(200);
    const other = await registerTenant(t);
    expect((await t.http().get(`${api}/integrations/import-jobs/${missing.body.jobId}`).set(other.auth)).status).toBe(404);
    expect((await t.http().get(`${api}/integrations/import-jobs`).set(other.auth)).body.meta.total).toBe(0);
  });

  it('T-226 invoice history sold by a unit code (1 miếng of a box of 10): line goes to the base product with the unit and base quantity = qty × factor, no placeholder product', async () => {
    const p = await t.http().post(`${api}/products`).set(s.auth).send({ code: 'SP-HOP10', name: 'Mặt nạ hộp 10 miếng', type: 'GOODS', variants: [{ sellPrice: '180000', costPrice: '100000' }], units: [{ unitName: 'Miếng', conversionFactor: '0.1', sku: 'SP-MIENG10', sellPrice: '18000' }] });
    expect(p.status).toBe(201);
    const file = await xlsx(['Mã hóa đơn', 'Thời gian', 'Chi nhánh', 'Khách cần trả', 'Khách đã trả', 'Trạng thái', 'Mã hàng', 'Tên hàng', 'Số lượng', 'Đơn giá', 'Thành tiền'], [
      ['HD004601', '23/09/2026 10:00', 'Chi nhánh trung tâm', '54000', '54000', 'Hoàn thành', 'SP-MIENG10', 'Mặt nạ hộp 10 miếng', '3', '18000', '54000'],
    ]);
    const done = await commit((await preview('INVOICES', file, { defaultBranchId: s.branchId })).body.jobId);
    expect(done.body.created).toBe(1);
    expect(done.body.failed).toBe(0);
    expect(done.body.placeholders ?? 0).toBe(0);
    const inv = (await t.http().get(`${api}/invoices`).set(s.auth).query({ search: 'KV-HD004601' })).body.data[0];
    const line = (await t.http().get(`${api}/invoices/${inv.id}`).set(s.auth)).body.lines[0];
    expect(line.variantId).toBe(p.body.variants[0].id);
    expect(line.unitName).toBe('Miếng');
    expect(line.productUnitId).toBe(p.body.units[0].id);
    expect(Number(line.quantity)).toBe(3);
    expect(Number(line.baseQuantity)).toBeCloseTo(0.3);
    expect(Number(line.unitCost)).toBe(10000);
    expect((await t.http().get(`${api}/products`).set(s.auth).query({ search: 'SP-MIENG10', includeInactive: 'true' })).body.data.filter((x: { code: string }) => x.code === 'SP-MIENG10')).toHaveLength(0);
  });

  it('T-227 variant group whose variants each have a "1 MIẾNG" unit with its own code: every unit code maps to its own variant when importing invoice history', async () => {
    const headers = ['Loại hàng', 'Mã hàng', 'Tên hàng', 'Giá bán', 'Giá vốn', 'Tồn kho', 'ĐVT', 'Mã ĐVT Cơ bản', 'Quy đổi', 'Thuộc tính', 'Mã HH Liên quan', 'Đang kinh doanh'];
    const file = await xlsx(headers, [
      ['Hàng hóa', 'MN-DO', 'Mặt nạ set 10 - Đỏ', '180000', '100000', '5', 'HỘP', '', '', 'MÀU:Đỏ', 'MN-DO', 'Đang kinh doanh'],
      ['Hàng hóa', 'MN-VANG', 'Mặt nạ set 10 - Vàng', '180000', '120000', '5', 'HỘP', '', '', 'MÀU:Vàng', 'MN-DO', 'Đang kinh doanh'],
      ['Hàng hóa', 'MN-DO-M', 'Mặt nạ set 10 - Đỏ', '18000', '', '', '1 MIẾNG', 'MN-DO', '0.1', 'MÀU:Đỏ', 'MN-DO', 'Đang kinh doanh'],
      ['Hàng hóa', 'MN-VANG-M', 'Mặt nạ set 10 - Vàng', '18000', '', '', '1 MIẾNG', 'MN-VANG', '0.1', 'MÀU:Vàng', 'MN-DO', 'Đang kinh doanh'],
    ]);
    const prod = await commit((await preview('PRODUCTS', file, { defaultWarehouseId: s.warehouseId })).body.jobId);
    expect(prod.body.failed).toBe(0);
    expect(prod.body.units).toBe(2);
    const inv = await xlsx(['Mã hóa đơn', 'Thời gian', 'Chi nhánh', 'Khách cần trả', 'Khách đã trả', 'Trạng thái', 'Mã hàng', 'Tên hàng', 'Số lượng', 'Đơn giá', 'Thành tiền'], [
      ['HD004701', '24/09/2026 10:00', 'Chi nhánh trung tâm', '90000', '90000', 'Hoàn thành', 'MN-DO-M', 'Mặt nạ set 10 - Đỏ', '2', '18000', '36000'],
      ['HD004701', '24/09/2026 10:00', 'Chi nhánh trung tâm', '90000', '90000', 'Hoàn thành', 'MN-VANG-M', 'Mặt nạ set 10 - Vàng', '3', '18000', '54000'],
    ]);
    const done = await commit((await preview('INVOICES', inv, { defaultBranchId: s.branchId })).body.jobId);
    expect(done.body.created).toBe(1);
    expect(done.body.placeholders ?? 0).toBe(0);
    const id = (await t.http().get(`${api}/invoices`).set(s.auth).query({ search: 'KV-HD004701' })).body.data[0].id;
    const lines = (await t.http().get(`${api}/invoices/${id}`).set(s.auth)).body.lines as Array<{ variant: { sku: string }; unitName: string; baseQuantity: string; unitCost: string }>;
    expect(lines.map((l) => [l.variant.sku, l.unitName, Number(l.baseQuantity), Number(l.unitCost)])).toEqual([['MN-DO', '1 MIẾNG', 0.2, 10000], ['MN-VANG', '1 MIẾNG', 0.3, 12000]]);
    // chạy lại file hàng hóa: không lỗi, không tạo thêm hàng
    const again = await commit((await preview('PRODUCTS', file, { defaultWarehouseId: s.warehouseId, updateExisting: true })).body.jobId);
    expect(again.body.failed).toBe(0);
  });

  it('T-225 KiotViet connection: creation needs all three credentials; later saves may change only the branch map or only one credential', async () => {
    const o = await registerTenant(t);
    expect((await t.http().put(`${api}/integrations/kiotviet`).set(o.auth).send({ retailer: 'shop', clientId: 'client-id-0001' })).status).toBe(400);
    expect((await t.http().put(`${api}/integrations/kiotviet`).set(o.auth).send({ retailer: 'shop', clientId: 'client-id-0001', clientSecret: 'secret-00000001' })).status).toBe(200);
    // branch-map-only save keeps credentials and does not reset the status
    expect((await t.http().put(`${api}/integrations/kiotviet`).set(o.auth).send({ branchMap: { 'Chi nhánh trung tâm': '00000000-0000-0000-0000-000000000000' } })).status).toBe(400); // unknown warehouse
    const bm = await t.http().put(`${api}/integrations/kiotviet`).set(o.auth).send({ branchMap: { 'Chi nhánh trung tâm': o.warehouseId } });
    expect(bm.status).toBe(200);
    expect(bm.body.retailer).toBe('shop');
    expect(bm.body.clientId).toBe('clie…0001');
    expect(bm.body.hasSecret).toBe(true);
    expect(bm.body.branchMap).toEqual({ 'Chi nhánh trung tâm': o.warehouseId });
    // retailer-only change keeps client id/secret and the branch map
    const rt = await t.http().put(`${api}/integrations/kiotviet`).set(o.auth).send({ retailer: 'shop2' });
    expect(rt.body.retailer).toBe('shop2');
    expect(rt.body.clientId).toBe('clie…0001');
    expect(rt.body.branchMap).toEqual({ 'Chi nhánh trung tâm': o.warehouseId });
    expect(rt.body.status).toBe('CONFIGURED');
  });
});
