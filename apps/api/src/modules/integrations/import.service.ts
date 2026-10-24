import { Injectable, Logger } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { plainToInstance } from 'class-transformer';
import { validate } from 'class-validator';
import { Errors } from '../../common/errors/app-error';
import { paginated, skipTake } from '../../common/pagination';
import { D, money, qty as toQty, ZERO } from '../../common/utils/decimal';
import { AccessService } from '../../infra/access/access.service';
import { AuditService } from '../../infra/audit/audit.service';
import { RequestUser } from '../../infra/cls/request-context';
import { PrismaService } from '../../infra/prisma/prisma.service';
import { CreateProductDto, UpdateProductDto } from '../catalog/dto/catalog.dto';
import { ProductsService } from '../catalog/products.service';
import { LedgerService } from '../finance/ledger.service';
import { InventoryDocumentsService } from '../inventory/documents.service';
import { CreateSupplierDto, UpdateSupplierDto } from '../purchasing/dto/purchasing.dto';
import { SuppliersService } from '../purchasing/suppliers.service';
import { CustomersService } from '../sales/customers.service';
import { CreateCustomerDto, UpdateCustomerDto } from '../sales/dto/sales.dto';
import { categoryPath, detectMapping, FIELDS, genderOf, ImportEntity, parseDate, parseNumber, parseXlsx, RawRow, safeCode, splitList, truthy } from './import-parsers';

export interface ImportOptions {
  /** stock column → warehouse; empty = the stock column (if any) goes to `defaultWarehouseId` */
  stockColumns?: Array<{ header: string; warehouseId: string }>;
  defaultWarehouseId?: string;
  /** set debts to the exported value even for existing parties (ledger ADJUSTMENT) */
  syncDebt?: boolean;
  /** update existing records (default true); false = only create missing ones */
  updateExisting?: boolean;
  /** import stock from the sheet (default true when a stock column is mapped) */
  importStock?: boolean;
  /** invoice history: branch name → branchId */
  branchMap?: Record<string, string>;
  defaultBranchId?: string;
  /** skip invoices older than this date */
  invoicesFrom?: string;
}
interface RowError { row: number; code?: string; error: string }
interface Totals { rows: number; created: number; updated: number; skipped: number; failed: number; stockLines?: number; stockDocuments?: number; debtAdjusted?: number; units?: number }

const BATCH = 200;
const err = (e: unknown) => (e as { response?: { message?: string }; message?: string })?.response?.message ?? (e as Error)?.message ?? String(e);

/** Nhập dữ liệu từ Excel KiotViet (BR-130..BR-133): xem trước → xác nhận; idempotent theo mã (chạy lại = cập nhật). */
@Injectable()
export class ImportService {
  private readonly log = new Logger(ImportService.name);
  constructor(
    private readonly prisma: PrismaService, private readonly access: AccessService, private readonly audit: AuditService, private readonly products: ProductsService,
    private readonly customers: CustomersService, private readonly suppliers: SuppliersService, private readonly documents: InventoryDocumentsService, private readonly ledger: LedgerService,
  ) {}

  // ---------------------------------------------------------------- jobs
  async list(user: RequestUser, q: { page: number; pageSize: number; type?: string }) {
    const where: Prisma.ImportJobWhereInput = q.type ? { type: q.type } : {};
    const [rows, total] = await Promise.all([this.prisma.db.importJob.findMany({ where, select: { id: true, type: true, source: true, status: true, fileName: true, rowCount: true, totals: true, startedAt: true, finishedAt: true, createdAt: true, createdById: true }, ...skipTake(q), orderBy: { createdAt: 'desc' } }), this.prisma.db.importJob.count({ where })]);
    return paginated(rows, total, q);
  }

  async get(user: RequestUser, id: string) {
    const job = await this.prisma.db.importJob.findFirst({ where: { id } });
    if (!job) throw Errors.notFound('Lần nhập dữ liệu', id);
    const rows = (job.payload as RawRow[] | null) ?? [];
    return { ...job, payload: undefined, sample: rows.slice(0, 10), fields: FIELDS[job.type as ImportEntity] ?? [] };
  }

  /** Step 1: parse + detect columns; nothing is written except the job itself. */
  async preview(user: RequestUser, type: ImportEntity, fileName: string, buffer: Buffer, options: ImportOptions = {}, source = 'EXCEL') {
    const parsed = await parseXlsx(buffer);
    return this.previewRows(user, type, fileName, parsed.headers, parsed.rows, options, source);
  }

  async previewRows(user: RequestUser, type: ImportEntity, fileName: string | null, headers: string[], rows: RawRow[], options: ImportOptions = {}, source = 'EXCEL') {
    const { mapping, unmapped, missing } = detectMapping(headers, type);
    const stockHeaders = headers.filter((h) => /^ton kho/.test(normalize(h)) || normalize(h) === 'ton');
    const job = await this.prisma.db.importJob.create({ data: { tenantId: user.tenantId, type, source, status: 'PREVIEW', fileName, headers: headers as Prisma.InputJsonValue, mapping: mapping as Prisma.InputJsonValue, options: options as Prisma.InputJsonValue, payload: rows as unknown as Prisma.InputJsonValue, rowCount: rows.length, createdById: user.id } });
    const issues = this.validateRows(type, mapping, rows).slice(0, 50);
    return { jobId: job.id, type, fileName, rowCount: rows.length, headers, mapping, unmapped, missing, stockHeaders, sample: rows.slice(0, 10), issues, fields: FIELDS[type] };
  }

  private validateRows(type: ImportEntity, mapping: Record<string, string>, rows: RawRow[]): RowError[] {
    const out: RowError[] = [];
    const get = (r: RawRow, f: string) => (mapping[f] ? (r[mapping[f]] ?? '').trim() : '');
    const seen = new Set<string>();
    for (const r of rows) {
      const row = Number(r.__row);
      if (type === 'PRODUCTS') {
        const code = get(r, 'code'); const name = get(r, 'name');
        if (!code && !name) out.push({ row, error: 'Thiếu mã hàng và tên hàng' });
        if (code && seen.has(code.toLowerCase())) out.push({ row, code, error: 'Mã hàng trùng trong file' });
        seen.add(code.toLowerCase());
        if (get(r, 'sellPrice') && parseNumber(get(r, 'sellPrice')) === null) out.push({ row, code, error: `Giá bán không hợp lệ: ${get(r, 'sellPrice')}` });
      } else if (type === 'CUSTOMERS' || type === 'SUPPLIERS') {
        if (!get(r, 'name')) out.push({ row, error: 'Thiếu tên' });
        if (get(r, 'debt') && parseNumber(get(r, 'debt')) === null) out.push({ row, code: get(r, 'code'), error: `Công nợ không hợp lệ: ${get(r, 'debt')}` });
      } else if (type === 'INVOICES') {
        if (!get(r, 'code')) out.push({ row, error: 'Thiếu mã hóa đơn' });
        if (get(r, 'date') && !parseDate(get(r, 'date'))) out.push({ row, code: get(r, 'code'), error: `Ngày không hợp lệ: ${get(r, 'date')}` });
      }
    }
    return out;
  }

  /** Step 2: run the import with the (possibly corrected) mapping. */
  async commit(user: RequestUser, jobId: string, override: { mapping?: Record<string, string>; options?: ImportOptions } = {}) {
    const job = await this.prisma.db.importJob.findFirst({ where: { id: jobId } });
    if (!job) throw Errors.notFound('Lần nhập dữ liệu', jobId);
    if (job.status !== 'PREVIEW') throw Errors.conflict('IMPORT_NOT_PREVIEW', 'Lần nhập này đã được thực hiện', { status: job.status });
    const mapping = { ...((job.mapping as Record<string, string>) ?? {}), ...(override.mapping ?? {}) };
    const options: ImportOptions = { ...((job.options as ImportOptions) ?? {}), ...(override.options ?? {}) };
    const type = job.type as ImportEntity;
    const missing = FIELDS[type].filter((f) => f.required && !mapping[f.key]);
    if (missing.length) throw Errors.validation(`Thiếu cột bắt buộc: ${missing.map((m) => m.label).join(', ')}`, { missing: missing.map((m) => m.key) });
    await this.prisma.db.importJob.update({ where: { id: jobId }, data: { status: 'RUNNING', startedAt: new Date(), mapping: mapping as Prisma.InputJsonValue, options: options as Prisma.InputJsonValue } });
    const rows = (job.payload as RawRow[] | null) ?? [];
    try {
      const result = type === 'PRODUCTS' ? await this.importProducts(user, rows, mapping, options)
        : type === 'CUSTOMERS' ? await this.importParties(user, 'CUSTOMER', rows, mapping, options)
          : type === 'SUPPLIERS' ? await this.importParties(user, 'SUPPLIER', rows, mapping, options)
            : await this.importInvoices(user, rows, mapping, options);
      await this.prisma.db.importJob.update({ where: { id: jobId }, data: { status: 'DONE', finishedAt: new Date(), totals: result.totals as unknown as Prisma.InputJsonValue, errors: result.errors.slice(0, 500) as unknown as Prisma.InputJsonValue, payload: Prisma.DbNull } });
      await this.audit.log(this.prisma.db as never, { action: 'import.commit', entityType: 'ImportJob', entityId: jobId, after: { type, ...result.totals } });
      return { jobId, type, ...result.totals, errors: result.errors.slice(0, 200) };
    } catch (e) {
      this.log.error(`import ${jobId} failed: ${err(e)}`);
      await this.prisma.db.importJob.update({ where: { id: jobId }, data: { status: 'FAILED', finishedAt: new Date(), errors: [{ row: 0, error: err(e) }] as unknown as Prisma.InputJsonValue } });
      throw e;
    }
  }

  // ---------------------------------------------------------------- products (+ units, images, stock)
  async importProducts(user: RequestUser, rows: RawRow[], mapping: Record<string, string>, options: ImportOptions) {
    const get = (r: RawRow, f: string) => (mapping[f] ? (r[mapping[f]] ?? '').trim() : '');
    const totals: Totals = { rows: rows.length, created: 0, updated: 0, skipped: 0, failed: 0, units: 0, stockLines: 0, stockDocuments: 0 };
    const errors: RowError[] = [];
    const updateExisting = options.updateExisting !== false;
    const [cats, brands] = await Promise.all([this.prisma.db.productCategory.findMany({ select: { id: true, name: true, parentId: true } }), this.prisma.db.brand.findMany({ select: { id: true, name: true } })]);
    const catKey = (name: string, parentId: string | null) => `${parentId ?? ''}|${name.toLowerCase()}`;
    const catCache = new Map(cats.map((c) => [catKey(c.name, c.parentId), c.id]));
    const brandCache = new Map(brands.map((b) => [b.name.toLowerCase(), b.id]));
    const ensureCategory = async (path: string[]) => {
      let parentId: string | null = null;
      for (const name of path) {
        const k = catKey(name, parentId);
        let id = catCache.get(k);
        if (!id) { id = (await this.prisma.db.productCategory.create({ data: { tenantId: user.tenantId, name, parentId } })).id; catCache.set(k, id); }
        parentId = id;
      }
      return parentId ?? undefined;
    };
    const ensureBrand = async (name: string) => {
      const k = name.toLowerCase();
      let id = brandCache.get(k);
      if (!id) { id = (await this.prisma.db.brand.create({ data: { tenantId: user.tenantId, name } })).id; brandCache.set(k, id); }
      return id;
    };
    // unit rows (a KiotViet conversion unit is a row whose "Mã ĐVT cơ bản" points at another code)
    const unitRows = rows.filter((r) => { const b = get(r, 'baseUnitCode'); return b && b !== get(r, 'code'); });
    const baseRows = rows.filter((r) => !unitRows.includes(r));
    const stockPlan = new Map<string, Array<{ variantId: string; quantity: string; unitCost: string }>>(); // warehouseId → lines
    const stockCols: Array<{ header: string; warehouseId: string }> = options.stockColumns?.length ? options.stockColumns : mapping.stock && options.defaultWarehouseId ? [{ header: mapping.stock, warehouseId: options.defaultWarehouseId }] : [];
    for (const sc of stockCols) await this.access.assertWarehouse(user, sc.warehouseId);
    const importStock = options.importStock !== false && stockCols.length > 0;
    const codeToVariant = new Map<string, string>();

    for (const r of baseRows) {
      const row = Number(r.__row);
      const code = safeCode(get(r, 'code')); const name = get(r, 'name');
      if (!name && !code) { totals.skipped++; continue; }
      try {
        const typeRaw = normalize(get(r, 'type'));
        const type = typeRaw.includes('dich vu') || typeRaw === 'service' ? 'SERVICE' : typeRaw.includes('combo') ? 'COMBO' : 'GOODS';
        const categoryId = get(r, 'category') ? await ensureCategory(categoryPath(get(r, 'category'))) : undefined;
        const brandId = get(r, 'brand') ? await ensureBrand(get(r, 'brand')) : undefined;
        const sellPrice = parseNumber(get(r, 'sellPrice')) ?? '0';
        const costPrice = parseNumber(get(r, 'costPrice')) ?? undefined;
        const barcode = get(r, 'barcode') || undefined;
        const images = splitList(get(r, 'images')).filter((u) => /^https?:\/\//i.test(u)).slice(0, 20).map((url, i) => ({ url, sortOrder: i }));
        const active = truthy(get(r, 'isActive')); const allowSale = truthy(get(r, 'allowSale'));
        const minStock = parseNumber(get(r, 'minStock')) ?? undefined; const maxStock = parseNumber(get(r, 'maxStock')) ?? undefined;
        const taxRate = parseNumber(get(r, 'taxRate')) ?? undefined; const weight = parseNumber(get(r, 'weight')) ?? undefined;
        const existing = code ? await this.prisma.db.product.findFirst({ where: { code, deletedAt: null }, include: { variants: { where: { deletedAt: null }, orderBy: { createdAt: 'asc' } } } }) : null;
        let variantId: string;
        if (existing) {
          if (!updateExisting) { totals.skipped++; variantId = existing.variants[0]?.id; }
          else {
            const v = existing.variants[0];
            const dto = plainToInstance(UpdateProductDto, { name: name || undefined, categoryId, brandId, baseUnit: get(r, 'unit') || undefined, description: get(r, 'description') || undefined, taxRate, weight, allowSale: allowSale ?? undefined, isActive: active ?? undefined, ...(images.length ? { images } : {}), variants: v ? [{ id: v.id, sellPrice, barcode: barcode ?? undefined, minStock, maxStock, ...(v.onHandTotal.isZero() && costPrice ? { costPrice } : {}) }] : undefined });
            await this.assertDto(dto);
            await this.products.update(user, existing.id, dto);
            totals.updated++; variantId = v?.id;
          }
        } else {
          const dto = plainToInstance(CreateProductDto, { code: code || undefined, name: name || code, type, categoryId, brandId, baseUnit: get(r, 'unit') || undefined, description: get(r, 'description') || undefined, taxRate, weight, allowSale: allowSale ?? undefined, images, variants: [{ barcode, sellPrice, costPrice, minStock, maxStock }] });
          await this.assertDto(dto);
          const created = await this.products.create(user, dto);
          if (active === false) await this.products.update(user, created.id, plainToInstance(UpdateProductDto, { isActive: false }));
          totals.created++; variantId = created.variants[0].id;
        }
        if (variantId && code) codeToVariant.set(code.toLowerCase(), variantId);
        if (importStock && variantId && type === 'GOODS') {
          for (const sc of stockCols) {
            const q = parseNumber((r[sc.header] ?? '').trim());
            if (q === null) continue;
            (stockPlan.get(sc.warehouseId) ?? stockPlan.set(sc.warehouseId, []).get(sc.warehouseId)!).push({ variantId, quantity: q, unitCost: costPrice ?? '0' });
          }
        }
      } catch (e) { totals.failed++; errors.push({ row, code, error: err(e) }); }
    }
    // conversion units
    for (const r of unitRows) {
      const row = Number(r.__row); const base = safeCode(get(r, 'baseUnitCode'));
      try {
        const product = await this.prisma.db.product.findFirst({ where: { code: base, deletedAt: null }, include: { units: true } });
        if (!product) throw new Error(`Không tìm thấy hàng cơ bản ${base}`);
        const unitName = get(r, 'unit') || get(r, 'name'); const factor = parseNumber(get(r, 'conversion'));
        if (!unitName || !factor || D(factor).lessThanOrEqualTo(0)) throw new Error('Thiếu tên đơn vị hoặc hệ số quy đổi');
        const units = product.units.filter((u) => u.unitName.toLowerCase() !== unitName.toLowerCase()).map((u) => ({ id: u.id, unitName: u.unitName, conversionFactor: u.conversionFactor.toString(), sku: u.sku ?? undefined, barcode: u.barcode ?? undefined, sellPrice: u.sellPrice?.toString() }));
        units.push({ id: undefined as unknown as string, unitName, conversionFactor: factor, sku: safeCode(get(r, 'code')) || undefined, barcode: get(r, 'barcode') || undefined, sellPrice: parseNumber(get(r, 'sellPrice')) ?? undefined });
        const dto = plainToInstance(UpdateProductDto, { units: units.map((u) => ({ ...u, id: u.id || undefined })) });
        await this.assertDto(dto);
        await this.products.update(user, product.id, dto);
        totals.units!++;
      } catch (e) { totals.failed++; errors.push({ row, code: get(r, 'code'), error: err(e) }); }
    }
    // stock: one ADJUSTMENT document per warehouse per 200 lines, actual quantity = exported stock
    for (const [warehouseId, planned] of stockPlan) {
      const wh = await this.prisma.db.warehouse.findFirst({ where: { id: warehouseId }, select: { branchId: true } });
      if (!wh) continue;
      // idempotent: lines whose on-hand already equals the exported figure produce no adjustment
      const current = await this.prisma.db.stockBalance.findMany({ where: { warehouseId, variantId: { in: planned.map((l) => l.variantId) }, batchKey: '' }, select: { variantId: true, onHand: true } });
      const onHand = new Map(current.map((b) => [b.variantId, D(b.onHand)]));
      const lines = planned.filter((l) => !(onHand.get(l.variantId) ?? ZERO).equals(D(l.quantity)));
      for (let i = 0; i < lines.length; i += BATCH) {
        const chunk = lines.slice(i, i + BATCH);
        try {
          await this.documents.createAndPost(user, { type: 'ADJUSTMENT', branchId: wh.branchId, warehouseId, reason: 'OTHER', note: 'Nhập tồn kho từ KiotViet', lines: chunk.map((l) => ({ variantId: l.variantId, actualQuantity: l.quantity, unitCost: l.unitCost })) });
          totals.stockDocuments!++; totals.stockLines! += chunk.length;
        } catch (e) {
          // fall back line by line so one bad product does not block the batch
          for (const l of chunk) {
            try { await this.documents.createAndPost(user, { type: 'ADJUSTMENT', branchId: wh.branchId, warehouseId, reason: 'OTHER', note: 'Nhập tồn kho từ KiotViet', lines: [{ variantId: l.variantId, actualQuantity: l.quantity, unitCost: l.unitCost }] }); totals.stockDocuments!++; totals.stockLines!++; }
            catch (e2) { totals.failed++; errors.push({ row: 0, code: l.variantId, error: `Tồn kho: ${err(e2)}` }); }
          }
          void e;
        }
      }
    }
    return { totals, errors };
  }

  // ---------------------------------------------------------------- customers / suppliers (+ debt)
  async importParties(user: RequestUser, party: 'CUSTOMER' | 'SUPPLIER', rows: RawRow[], mapping: Record<string, string>, options: ImportOptions) {
    const get = (r: RawRow, f: string) => (mapping[f] ? (r[mapping[f]] ?? '').trim() : '');
    const totals: Totals = { rows: rows.length, created: 0, updated: 0, skipped: 0, failed: 0, debtAdjusted: 0 };
    const errors: RowError[] = [];
    const updateExisting = options.updateExisting !== false;
    for (const r of rows) {
      const row = Number(r.__row); const code = safeCode(get(r, 'code')).replace(/\//g, '-'); const name = get(r, 'name');
      if (!name) { totals.skipped++; continue; }
      try {
        const debt = parseNumber(get(r, 'debt'));
        const common = { name, phone: get(r, 'phone') || undefined, email: /@/.test(get(r, 'email')) ? get(r, 'email') : undefined, address: [get(r, 'address'), get(r, 'ward'), get(r, 'area')].filter(Boolean).join(', ') || undefined, taxCode: get(r, 'taxCode') || undefined, groupName: get(r, 'groupName') || undefined, note: [get(r, 'note'), get(r, 'company') ? `Công ty: ${get(r, 'company')}` : ''].filter(Boolean).join(' · ') || undefined };
        if (party === 'CUSTOMER') {
          const existing = code ? await this.prisma.db.customer.findFirst({ where: { code } }) : await this.prisma.db.customer.findFirst({ where: { phone: common.phone ?? '__none__' } });
          if (existing) {
            if (updateExisting) { const dto = plainToInstance(UpdateCustomerDto, { ...common, gender: genderOf(get(r, 'gender')), birthday: dateOnly(parseDate(get(r, 'birthday'))), isActive: truthy(get(r, 'isActive')) ?? undefined }); await this.assertDto(dto); await this.customers.update(user, existing.id, dto); totals.updated++; } else totals.skipped++;
            if (options.syncDebt && debt !== null) { if (await this.syncDebt(user, 'CUSTOMER', existing.id, existing.code, debt)) totals.debtAdjusted!++; }
          } else {
            const dto = plainToInstance(CreateCustomerDto, { code: code || undefined, ...common, gender: genderOf(get(r, 'gender')), birthday: dateOnly(parseDate(get(r, 'birthday'))), openingBalance: debt ?? undefined });
            await this.assertDto(dto);
            await this.customers.create(user, dto);
            totals.created++;
          }
        } else {
          const existing = code ? await this.prisma.db.supplier.findFirst({ where: { code } }) : await this.prisma.db.supplier.findFirst({ where: { phone: common.phone ?? '__none__' } });
          if (existing) {
            if (updateExisting) { const dto = plainToInstance(UpdateSupplierDto, { ...common, isActive: truthy(get(r, 'isActive')) ?? undefined }); await this.assertDto(dto); await this.suppliers.update(user, existing.id, dto); totals.updated++; } else totals.skipped++;
            if (options.syncDebt && debt !== null) { if (await this.syncDebt(user, 'SUPPLIER', existing.id, existing.code, debt)) totals.debtAdjusted!++; }
          } else {
            const dto = plainToInstance(CreateSupplierDto, { code: code || undefined, ...common, openingBalance: debt ?? undefined });
            await this.assertDto(dto);
            await this.suppliers.create(user, dto);
            totals.created++;
          }
        }
      } catch (e) { totals.failed++; errors.push({ row, code, error: err(e) }); }
    }
    return { totals, errors };
  }

  /** Brings the party balance to the exported figure with one ADJUSTMENT ledger entry (BR-132). */
  private async syncDebt(user: RequestUser, partyType: 'CUSTOMER' | 'SUPPLIER', partyId: string, code: string, target: string) {
    return this.prisma.tx(async (tx) => {
      const current = await this.ledger.lockBalance(tx, user.tenantId, partyType, partyId);
      const delta = money(target).minus(current);
      if (delta.isZero()) return false;
      await this.ledger.post(tx, { tenantId: user.tenantId, partyType, partyId, type: 'ADJUSTMENT', amount: delta, documentType: 'IMPORT', documentId: partyId, documentCode: code, note: 'Đồng bộ công nợ từ KiotViet', userId: user.id });
      return true;
    });
  }

  // ---------------------------------------------------------------- invoice history (no stock / ledger / cash effects)
  async importInvoices(user: RequestUser, rows: RawRow[], mapping: Record<string, string>, options: ImportOptions) {
    const get = (r: RawRow, f: string) => (mapping[f] ? (r[mapping[f]] ?? '').trim() : '');
    const totals: Totals = { rows: rows.length, created: 0, updated: 0, skipped: 0, failed: 0 };
    const errors: RowError[] = [];
    const branches = await this.prisma.db.branch.findMany({ select: { id: true, name: true, code: true } });
    const defaultBranchId = options.defaultBranchId ?? (branches.find((b) => (user.branchIds ?? []).includes(b.id))?.id ?? branches[0]?.id);
    const branchOf = (name: string) => options.branchMap?.[name] ?? branches.find((b) => b.name.toLowerCase() === name.toLowerCase() || b.code.toLowerCase() === name.toLowerCase())?.id ?? defaultBranchId;
    const since = options.invoicesFrom ? new Date(options.invoicesFrom) : null;
    const groups = new Map<string, RawRow[]>();
    for (const r of rows) { const c = get(r, 'code'); if (!c) { totals.skipped++; continue; } (groups.get(c) ?? groups.set(c, []).get(c)!).push(r); }
    const codes = Array.from(groups.values()).flatMap((g) => g.map((r) => safeCode(get(r, 'lineCode')).toLowerCase()).filter(Boolean));
    const variants = codes.length ? await this.prisma.db.productVariant.findMany({ where: { OR: [{ sku: { in: Array.from(new Set(codes)), mode: 'insensitive' } }, { product: { code: { in: Array.from(new Set(codes)), mode: 'insensitive' } } }] }, select: { id: true, sku: true, costPrice: true, product: { select: { code: true, baseUnit: true } } } }) : [];
    const vByCode = new Map<string, (typeof variants)[number]>();
    for (const v of variants) { vByCode.set(v.product.code.toLowerCase(), v); if (v.sku) vByCode.set(v.sku.toLowerCase(), v); }
    const customers = await this.prisma.db.customer.findMany({ select: { id: true, code: true, phone: true, name: true } });
    const cByCode = new Map(customers.map((c) => [c.code.toLowerCase(), c]));
    const sellers = await this.prisma.db.user.findMany({ select: { id: true, fullName: true, username: true } });
    const sellerOf = (name: string) => sellers.find((u) => u.fullName.toLowerCase() === name.toLowerCase() || u.username.toLowerCase() === name.toLowerCase())?.id ?? null;
    const warehouses = await this.prisma.db.warehouse.findMany({ select: { id: true, branchId: true, isDefault: true } });
    for (const [code, g] of groups) {
      const head = g[0]; const row = Number(head.__row);
      try {
        const date = parseDate(get(head, 'date')) ?? new Date();
        if (since && date < since) { totals.skipped++; continue; }
        const branchId = branchOf(get(head, 'branch'));
        if (!branchId) throw new Error('Không xác định được chi nhánh');
        this.access.assertBranch(user, branchId);
        const warehouseId = (warehouses.find((w) => w.branchId === branchId && w.isDefault) ?? warehouses.find((w) => w.branchId === branchId))?.id;
        if (!warehouseId) throw new Error('Chi nhánh chưa có kho');
        const statusRaw = normalize(get(head, 'status'));
        const status = statusRaw.includes('huy') || statusRaw === 'cancelled' ? 'CANCELLED' : 'COMPLETED';
        const customer = get(head, 'customerCode') ? cByCode.get(safeCode(get(head, 'customerCode')).toLowerCase()) : undefined;
        const lines = g.filter((r) => get(r, 'lineCode') || get(r, 'lineName')).map((r, i) => {
          const v = vByCode.get(safeCode(get(r, 'lineCode')).toLowerCase());
          if (!v) throw new Error(`Dòng ${r.__row}: không tìm thấy hàng ${get(r, 'lineCode') || get(r, 'lineName')} (nhập hàng hóa trước)`);
          const quantity = toQty(parseNumber(get(r, 'lineQty')) ?? '1');
          const unitPrice = money(parseNumber(get(r, 'linePrice')) ?? '0');
          const discount = money(parseNumber(get(r, 'lineDiscount')) ?? '0');
          const lineTotal = parseNumber(get(r, 'lineTotal')) !== null ? money(parseNumber(get(r, 'lineTotal'))!) : money(quantity.times(unitPrice).minus(discount));
          return { lineNo: i + 1, variantId: v.id, unitName: v.product.baseUnit, quantity, baseQuantity: quantity, listPrice: unitPrice, unitPrice, discountAmount: discount, lineTotal, unitCost: v.costPrice, costTotal: money(quantity.times(v.costPrice)) };
        });
        const subtotal = parseNumber(get(head, 'subtotal')) !== null ? money(parseNumber(get(head, 'subtotal'))!) : lines.reduce((s, l) => s.plus(l.lineTotal), ZERO);
        const discount = money(parseNumber(get(head, 'discount')) ?? '0');
        const total = parseNumber(get(head, 'total')) !== null ? money(parseNumber(get(head, 'total'))!) : subtotal.minus(discount);
        const paid = money(parseNumber(get(head, 'paid')) ?? total.toString());
        const existing = await this.prisma.db.invoice.findFirst({ where: { externalRef: code, imported: true } });
        if (existing) { totals.skipped++; continue; }
        const invCode = `KV-${code}`;
        await this.prisma.tx(async (tx) => {
          if (await tx.invoice.findFirst({ where: { code: invCode } })) throw new Error(`Mã ${invCode} đã tồn tại`);
          const inv = await tx.invoice.create({ data: { tenantId: user.tenantId, branchId, warehouseId, customerId: customer?.id ?? null, sellerId: sellerOf(get(head, 'seller')), code: invCode, externalRef: code, imported: true, status, invoiceDate: date, completedAt: status === 'COMPLETED' ? date : null, cancelledAt: status === 'CANCELLED' ? date : null, note: ['Nhập từ KiotViet', get(head, 'note')].filter(Boolean).join(' · '), subtotal, discountAmount: discount, taxAmount: ZERO, totalAmount: total, paidAmount: Prisma.Decimal.min(paid, total), costTotal: lines.reduce((s, l) => s.plus(l.costTotal), ZERO), createdById: user.id, lines: { create: lines.map((l) => ({ tenantId: user.tenantId, ...l })) } } });
          void inv;
        });
        totals.created++;
      } catch (e) { totals.failed++; errors.push({ row, code, error: err(e) }); }
    }
    return { totals, errors };
  }

  // ---------------------------------------------------------------- reconciliation snapshot (compare with KiotViet)
  async reconcile(user: RequestUser) {
    const tenant = user.tenantId;
    const [products, variants, customers, suppliers, stock, debt, imported] = await Promise.all([
      this.prisma.db.product.count({ where: { deletedAt: null } }),
      this.prisma.db.productVariant.count({ where: { deletedAt: null } }),
      this.prisma.db.customer.count(),
      this.prisma.db.supplier.count(),
      this.prisma.raw.$queryRaw<{ qty: Prisma.Decimal; value: Prisma.Decimal; skus: bigint }[]>`SELECT COALESCE(SUM(b.on_hand),0) AS qty, COALESCE(SUM(b.on_hand * v.cost_price),0) AS value, count(DISTINCT b.variant_id) FILTER (WHERE b.on_hand <> 0)::bigint AS skus FROM stock_balances b JOIN product_variants v ON v.id = b.variant_id WHERE b.tenant_id = ${tenant}::uuid`,
      this.prisma.raw.$queryRaw<{ party_type: string; receivable: Prisma.Decimal; payable: Prisma.Decimal; parties: bigint }[]>`SELECT party_type::text AS party_type, COALESCE(SUM(balance) FILTER (WHERE balance > 0),0) AS receivable, COALESCE(SUM(-balance) FILTER (WHERE balance < 0),0) AS payable, count(*) FILTER (WHERE balance <> 0)::bigint AS parties FROM party_balances WHERE tenant_id = ${tenant}::uuid GROUP BY 1`,
      this.prisma.raw.$queryRaw<{ n: bigint; revenue: Prisma.Decimal; first: Date | null; last: Date | null }[]>`SELECT count(*)::bigint AS n, COALESCE(SUM(total_amount) FILTER (WHERE status = 'COMPLETED'),0) AS revenue, MIN(invoice_date) AS first, MAX(invoice_date) AS last FROM invoices WHERE tenant_id = ${tenant}::uuid AND imported = true`,
    ]);
    const byParty = (t: string) => debt.find((d) => d.party_type === t);
    const jobs = await this.prisma.db.importJob.findMany({ where: { status: 'DONE' }, select: { id: true, type: true, source: true, totals: true, finishedAt: true }, orderBy: { finishedAt: 'desc' }, take: 20 });
    return {
      products: { products, variants, withStock: Number(stock[0]?.skus ?? 0) },
      stock: { quantity: D(stock[0]?.qty ?? 0), value: D(stock[0]?.value ?? 0) },
      customers: { count: customers, debtors: Number(byParty('CUSTOMER')?.parties ?? 0), receivable: D(byParty('CUSTOMER')?.receivable ?? 0), credit: D(byParty('CUSTOMER')?.payable ?? 0) },
      suppliers: { count: suppliers, creditors: Number(byParty('SUPPLIER')?.parties ?? 0), payable: D(byParty('SUPPLIER')?.receivable ?? 0) },
      importedInvoices: { count: Number(imported[0]?.n ?? 0), revenue: D(imported[0]?.revenue ?? 0), first: imported[0]?.first ?? null, last: imported[0]?.last ?? null },
      recentJobs: jobs,
    };
  }

  private async assertDto(dto: object) {
    const errors = await validate(dto, { whitelist: true });
    if (errors.length) {
      const msgs = errors.flatMap((e) => [...Object.values(e.constraints ?? {}), ...(e.children ?? []).flatMap((c) => [...Object.values(c.constraints ?? {}), ...(c.children ?? []).flatMap((cc) => Object.values(cc.constraints ?? {}))])]);
      throw new Error(msgs.join('; ') || 'Dữ liệu không hợp lệ');
    }
  }
}

const normalize = (h: string) => h.normalize('NFD').replace(/[̀-ͯ]/g, '').replace(/đ/g, 'd').replace(/Đ/g, 'D').toLowerCase().replace(/\s+/g, ' ').trim();
/** local calendar date → 'YYYY-MM-DD' (birthdays must not shift with the timezone) */
const dateOnly = (d: Date | null) => (d ? `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}` : undefined);
