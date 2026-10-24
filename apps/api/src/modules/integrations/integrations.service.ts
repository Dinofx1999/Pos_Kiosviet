import { Injectable, Logger } from '@nestjs/common';
import { createCipheriv, createDecipheriv, createHash, randomBytes } from 'node:crypto';
import { Errors } from '../../common/errors/app-error';
import { AuditService } from '../../infra/audit/audit.service';
import { RequestUser } from '../../infra/cls/request-context';
import { PrismaService } from '../../infra/prisma/prisma.service';
import { RawRow } from './import-parsers';
import { ImportOptions, ImportService } from './import.service';
import { KiotVietClient, KiotVietCredentials, KvInvoice, KvProduct } from './kiotviet.client';

const PROVIDER = 'KIOTVIET';
const keyOf = () => createHash('sha256').update(process.env.APP_ENCRYPTION_KEY ?? process.env.JWT_ACCESS_SECRET ?? 'retail-erp').digest();
export const encryptSecret = (plain: string) => { const iv = randomBytes(12); const c = createCipheriv('aes-256-gcm', keyOf(), iv); const enc = Buffer.concat([c.update(plain, 'utf8'), c.final()]); return [iv, c.getAuthTag(), enc].map((b) => b.toString('base64')).join(':'); };
export const decryptSecret = (packed: string) => { const [iv, tag, enc] = packed.split(':').map((s) => Buffer.from(s, 'base64')); const d = createDecipheriv('aes-256-gcm', keyOf(), iv); d.setAuthTag(tag); return Buffer.concat([d.update(enc), d.final()]).toString('utf8'); };

export interface KiotVietImportRequest { entities: Array<'PRODUCTS' | 'CUSTOMERS' | 'SUPPLIERS' | 'INVOICES'>; branchMap?: Record<string, string>; defaultWarehouseId?: string; defaultBranchId?: string; syncDebt?: boolean; updateExisting?: boolean; importStock?: boolean; invoicesFrom?: string; invoicesTo?: string }

/** Kết nối KiotViet Public API (BR-134): thông tin kết nối do người dùng nhập, secret mã hóa; nhập dữ liệu qua cùng pipeline với Excel. */
@Injectable()
export class IntegrationsService {
  private readonly log = new Logger(IntegrationsService.name);
  /** replaced in tests to avoid real network */
  clientFactory: (creds: KiotVietCredentials) => KiotVietClient = (creds) => new KiotVietClient(creds);
  constructor(private readonly prisma: PrismaService, private readonly audit: AuditService, private readonly imports: ImportService) {}

  async getKiotViet(_user: RequestUser) {
    const c = await this.prisma.db.integrationConnection.findFirst({ where: { provider: PROVIDER } });
    if (!c) return { provider: PROVIDER, status: 'DISCONNECTED', retailer: null, clientId: null, hasSecret: false, branchMap: {}, lastTestAt: null, lastSyncAt: null, lastError: null };
    return { provider: PROVIDER, status: c.status, retailer: c.retailer, clientId: c.clientId ? `${c.clientId.slice(0, 4)}…${c.clientId.slice(-4)}` : null, hasSecret: !!c.secretEnc, branchMap: (c.branchMap as Record<string, string>) ?? {}, lastTestAt: c.lastTestAt, lastSyncAt: c.lastSyncAt, lastError: c.lastError };
  }

  /** The user types the credentials themselves (never logged, never returned). */
  async saveKiotViet(_user: RequestUser, dto: { retailer?: string; clientId?: string; clientSecret?: string; branchMap?: Record<string, string> }) {
    const existing = await this.prisma.db.integrationConnection.findFirst({ where: { provider: PROVIDER } });
    if (!existing) {
      const missing = (['retailer', 'clientId', 'clientSecret'] as const).filter((k) => !dto[k]);
      if (missing.length) throw Errors.validation(`Cần nhập đủ Retailer, Client ID và Client Secret khi tạo kết nối (thiếu: ${missing.join(', ')})`);
    }
    if (dto.branchMap && Object.keys(dto.branchMap).length) {
      const ids = [...new Set(Object.values(dto.branchMap))];
      const known = await this.prisma.db.warehouse.count({ where: { id: { in: ids } } });
      if (known !== ids.length) throw Errors.validation('Ánh xạ chi nhánh trỏ tới kho không tồn tại');
    }
    const credentialsChanged = !!(dto.retailer || dto.clientId || dto.clientSecret);
    const data = {
      ...(dto.retailer ? { retailer: dto.retailer.trim() } : {}),
      ...(dto.clientId ? { clientId: dto.clientId.trim() } : {}),
      ...(dto.clientSecret ? { secretEnc: encryptSecret(dto.clientSecret.trim()) } : {}),
      ...(dto.branchMap ? { branchMap: dto.branchMap } : {}),
      // new credentials must be tested again; a branch-map-only save keeps the current status
      ...(credentialsChanged || !existing ? { status: 'CONFIGURED', lastError: null } : {}),
    };
    const c = existing ? await this.prisma.db.integrationConnection.update({ where: { id: existing.id }, data }) : await this.prisma.db.integrationConnection.create({ data: { tenantId: _user.tenantId, provider: PROVIDER, ...data } });
    await this.audit.log(this.prisma.db as never, { action: 'integration.kiotviet.save', entityType: 'IntegrationConnection', entityId: c.id, after: { retailer: c.retailer, clientId: c.clientId ? `${c.clientId.slice(0, 4)}…` : null } });
    return this.getKiotViet(_user);
  }

  async removeKiotViet(_user: RequestUser) {
    const c = await this.prisma.db.integrationConnection.findFirst({ where: { provider: PROVIDER } });
    if (c) { await this.prisma.db.integrationConnection.delete({ where: { id: c.id } }); await this.audit.log(this.prisma.db as never, { action: 'integration.kiotviet.remove', entityType: 'IntegrationConnection', entityId: c.id }); }
    return { ok: true };
  }

  private async client(): Promise<{ client: KiotVietClient; id: string }> {
    const c = await this.prisma.db.integrationConnection.findFirst({ where: { provider: PROVIDER } });
    if (!c || !c.retailer || !c.clientId || !c.secretEnc) throw Errors.conflict('KIOTVIET_NOT_CONFIGURED', 'Chưa cấu hình kết nối KiotViet (Thiết lập → Tích hợp)');
    return { client: this.clientFactory({ retailer: c.retailer, clientId: c.clientId, clientSecret: decryptSecret(c.secretEnc) }), id: c.id };
  }

  /** Connection test: lists KiotViet branches (the user maps them to our warehouses). */
  async testKiotViet(_user: RequestUser) {
    const { client, id } = await this.client();
    try {
      const branches = await client.branches();
      await this.prisma.db.integrationConnection.update({ where: { id }, data: { status: 'CONNECTED', lastTestAt: new Date(), lastError: null } });
      const warehouses = await this.prisma.db.warehouse.findMany({ where: { isActive: true }, select: { id: true, name: true, branch: { select: { id: true, name: true } } } });
      return { ok: true, branches: branches.map((b) => ({ id: b.id, name: b.branchName, address: b.address })), warehouses: warehouses.map((w) => ({ id: w.id, name: w.name, branch: w.branch.name })) };
    } catch (e) {
      const message = (e as Error).message;
      await this.prisma.db.integrationConnection.update({ where: { id }, data: { status: 'ERROR', lastTestAt: new Date(), lastError: message.slice(0, 1000) } });
      throw e;
    }
  }

  /** Pulls the chosen entities from KiotViet, converts them to the Excel row format and runs the importers. */
  async importFromKiotViet(user: RequestUser, req: KiotVietImportRequest) {
    const { client, id } = await this.client();
    const results: Array<{ entity: string; jobId: string; totals: Record<string, unknown>; errors: unknown[] }> = [];
    const branchMap = req.branchMap ?? {};
    const common: ImportOptions = { syncDebt: req.syncDebt, updateExisting: req.updateExisting, importStock: req.importStock, defaultWarehouseId: req.defaultWarehouseId, defaultBranchId: req.defaultBranchId, invoicesFrom: req.invoicesFrom };
    const order: Array<'PRODUCTS' | 'CUSTOMERS' | 'SUPPLIERS' | 'INVOICES'> = ['PRODUCTS', 'CUSTOMERS', 'SUPPLIERS', 'INVOICES'];
    try {
      for (const entity of order.filter((e) => req.entities.includes(e))) {
        let headers: string[] = []; let rows: RawRow[] = []; let options: ImportOptions = { ...common };
        if (entity === 'PRODUCTS') {
          const products = await client.products();
          const stockCols: Array<{ header: string; warehouseId: string }> = [];
          const branchNames = Array.from(new Set(products.flatMap((p) => (p.inventories ?? []).map((i) => i.branchName ?? String(i.branchId)))));
          for (const bn of branchNames) { const wh = branchMap[bn] ?? req.defaultWarehouseId; if (wh && req.importStock !== false) stockCols.push({ header: `Tồn kho (${bn})`, warehouseId: wh }); }
          headers = ['Mã hàng', 'Tên hàng', 'Loại hàng', 'Nhóm hàng', 'Thương hiệu', 'Mã vạch', 'ĐVT', 'Mã ĐVT cơ bản', 'Quy đổi', 'Giá bán', 'Giá vốn', 'Hình ảnh', 'Trọng lượng', 'Đang kinh doanh', 'Được bán trực tiếp', 'Mô tả', 'Tồn nhỏ nhất', 'Tồn lớn nhất', ...stockCols.map((s) => s.header)];
          rows = products.map((p, i) => this.productRow(p, i + 2, products));
          options = { ...options, stockColumns: stockCols };
        } else if (entity === 'CUSTOMERS') {
          headers = ['Mã khách hàng', 'Tên khách hàng', 'Điện thoại', 'Email', 'Địa chỉ', 'Phường/Xã', 'Khu vực', 'Giới tính', 'Ngày sinh', 'Nhóm khách hàng', 'Mã số thuế', 'Công ty', 'Ghi chú', 'Nợ cần thu hiện tại', 'Điểm hiện tại', 'Trạng thái'];
          rows = (await client.customers()).map((c, i) => ({ __row: String(i + 2), 'Mã khách hàng': c.code ?? '', 'Tên khách hàng': c.name ?? '', 'Điện thoại': c.contactNumber ?? '', Email: c.email ?? '', 'Địa chỉ': c.address ?? '', 'Phường/Xã': c.wardName ?? '', 'Khu vực': c.locationName ?? '', 'Giới tính': c.gender === true ? 'Nam' : c.gender === false ? 'Nữ' : '', 'Ngày sinh': c.birthDate ?? '', 'Nhóm khách hàng': (c.groups ?? '').split(',')[0]?.trim() ?? '', 'Mã số thuế': c.taxCode ?? '', 'Công ty': c.organization ?? '', 'Ghi chú': c.comments ?? '', 'Nợ cần thu hiện tại': String(c.debt ?? 0), 'Điểm hiện tại': String(c.totalPoint ?? 0), 'Trạng thái': c.isActive === false ? 'Ngừng hoạt động' : 'Đang hoạt động' }));
        } else if (entity === 'SUPPLIERS') {
          headers = ['Mã nhà cung cấp', 'Tên nhà cung cấp', 'Điện thoại', 'Email', 'Địa chỉ', 'Mã số thuế', 'Công ty', 'Nhóm NCC', 'Ghi chú', 'Nợ cần trả hiện tại', 'Trạng thái'];
          rows = (await client.suppliers()).map((s, i) => ({ __row: String(i + 2), 'Mã nhà cung cấp': s.code ?? '', 'Tên nhà cung cấp': s.name ?? '', 'Điện thoại': s.contactNumber ?? '', Email: s.email ?? '', 'Địa chỉ': [s.address, s.wardName, s.locationName].filter(Boolean).join(', '), 'Mã số thuế': s.taxCode ?? '', 'Công ty': s.organization ?? '', 'Nhóm NCC': (s.groups ?? '').split(',')[0]?.trim() ?? '', 'Ghi chú': s.comments ?? '', 'Nợ cần trả hiện tại': String(s.debt ?? 0), 'Trạng thái': s.isActive === false ? 'Ngừng hoạt động' : 'Đang hoạt động' }));
        } else {
          const invoices = await client.invoices(req.invoicesFrom, req.invoicesTo);
          headers = ['Mã hóa đơn', 'Thời gian', 'Mã khách hàng', 'Khách hàng', 'Chi nhánh', 'Người bán', 'Tổng tiền hàng', 'Giảm giá', 'Khách cần trả', 'Khách đã trả', 'Trạng thái', 'Ghi chú', 'Mã hàng', 'Tên hàng', 'Số lượng', 'Đơn giá', 'Giảm giá dòng', 'Thành tiền'];
          rows = invoices.flatMap((inv, i) => this.invoiceRows(inv, i + 2));
          // KiotViet branch names → our branches through the same map (warehouse → branch)
          const whs = await this.prisma.db.warehouse.findMany({ select: { id: true, branchId: true } });
          const bmap: Record<string, string> = {};
          for (const [kvBranch, whId] of Object.entries(branchMap)) { const w = whs.find((x) => x.id === whId); if (w) bmap[kvBranch] = w.branchId; }
          options = { ...options, branchMap: bmap };
        }
        const preview = await this.imports.previewRows(user, entity, `kiotviet-${entity.toLowerCase()}`, headers, rows, options, 'KIOTVIET_API');
        const committed = await this.imports.commit(user, preview.jobId, {});
        results.push({ entity, jobId: preview.jobId, totals: committed as unknown as Record<string, unknown>, errors: committed.errors });
      }
      await this.prisma.db.integrationConnection.update({ where: { id }, data: { lastSyncAt: new Date(), status: 'CONNECTED', lastError: null } });
    } catch (e) {
      await this.prisma.db.integrationConnection.update({ where: { id }, data: { status: 'ERROR', lastError: String((e as Error).message).slice(0, 1000) } });
      throw e;
    }
    return { results, reconcile: await this.imports.reconcile(user) };
  }

  private productRow(p: KvProduct, rowNo: number, all: KvProduct[]): RawRow {
    const isUnit = !!p.masterUnitId && p.masterUnitId !== p.id;
    const master = isUnit ? all.find((x) => x.id === p.masterUnitId) : undefined;
    const row: RawRow = {
      __row: String(rowNo), 'Mã hàng': p.code ?? '', 'Tên hàng': p.fullName || p.name || '', 'Loại hàng': 'Hàng hóa', 'Nhóm hàng': p.categoryName ?? '', 'Thương hiệu': p.tradeMarkName ?? '', 'Mã vạch': p.barCode ?? '', ĐVT: p.unit ?? '',
      'Mã ĐVT cơ bản': isUnit ? (master?.code ?? p.masterCode ?? '') : '', 'Quy đổi': isUnit ? String(p.conversionValue ?? '') : '', 'Giá bán': String(p.basePrice ?? 0), 'Giá vốn': String(p.inventories?.[0]?.cost ?? ''),
      'Hình ảnh': (p.images ?? []).join(','), 'Trọng lượng': p.weight ? String(p.weight) : '', 'Đang kinh doanh': p.isActive === false ? 'Ngừng kinh doanh' : 'Đang kinh doanh', 'Được bán trực tiếp': p.allowsSale === false ? 'Không' : 'Có', 'Mô tả': p.description ?? '',
      'Tồn nhỏ nhất': p.inventories?.[0]?.minQuantity ? String(p.inventories[0].minQuantity) : '', 'Tồn lớn nhất': p.inventories?.[0]?.maxQuantity ? String(p.inventories[0].maxQuantity) : '',
    };
    for (const inv of p.inventories ?? []) row[`Tồn kho (${inv.branchName ?? inv.branchId})`] = String(inv.onHand ?? 0);
    return row;
  }

  private invoiceRows(inv: KvInvoice, rowNo: number): RawRow[] {
    const head = { 'Mã hóa đơn': inv.code, 'Thời gian': inv.purchaseDate, 'Mã khách hàng': inv.customerCode ?? '', 'Khách hàng': inv.customerName ?? '', 'Chi nhánh': inv.branchName ?? '', 'Người bán': inv.soldByName ?? '', 'Tổng tiền hàng': String((inv.total ?? 0) + (inv.discount ?? 0)), 'Giảm giá': String(inv.discount ?? 0), 'Khách cần trả': String(inv.total ?? 0), 'Khách đã trả': String(inv.totalPayment ?? inv.total ?? 0), 'Trạng thái': inv.status === 2 ? 'Đã hủy' : (inv.statusValue ?? 'Hoàn thành'), 'Ghi chú': inv.description ?? '' };
    const details = inv.invoiceDetails ?? [];
    if (!details.length) return [{ __row: String(rowNo), ...head, 'Mã hàng': '', 'Tên hàng': '', 'Số lượng': '', 'Đơn giá': '', 'Giảm giá dòng': '', 'Thành tiền': '' }];
    return details.map((d, i) => ({ __row: `${rowNo}.${i + 1}`, ...head, 'Mã hàng': d.productCode ?? '', 'Tên hàng': d.productName ?? '', 'Số lượng': String(d.quantity ?? 0), 'Đơn giá': String(d.price ?? 0), 'Giảm giá dòng': String(d.discount ?? 0), 'Thành tiền': String(d.subTotal ?? (d.quantity ?? 0) * (d.price ?? 0) - (d.discount ?? 0)) }));
  }
}
