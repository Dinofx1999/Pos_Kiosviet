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
import { LoyaltyService } from '../sales/loyalty.service';
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
  /** invoice history: line codes missing from the catalogue become inactive placeholder products (default true) */
  createMissingProducts?: boolean;
}
interface RowError { row: number; code?: string; error: string }
interface Totals { rows: number; created: number; updated: number; skipped: number; failed: number; stockLines?: number; stockDocuments?: number; debtAdjusted?: number; units?: number; products?: number; negativeStock?: number; pointsAdjusted?: number; placeholders?: number }

const BATCH = 200;
const err = (e: unknown) => (e as { response?: { message?: string }; message?: string })?.response?.message ?? (e as Error)?.message ?? String(e);

/** Nhập dữ liệu từ Excel KiotViet (BR-130..BR-133): xem trước → xác nhận; idempotent theo mã (chạy lại = cập nhật). */
@Injectable()
export class ImportService {
  private readonly log = new Logger(ImportService.name);
  constructor(
    private readonly prisma: PrismaService, private readonly access: AccessService, private readonly audit: AuditService, private readonly products: ProductsService,
    private readonly customers: CustomersService, private readonly suppliers: SuppliersService, private readonly documents: InventoryDocumentsService, private readonly ledger: LedgerService,
    private readonly loyalty: LoyaltyService,
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
    // "Tồn kho", "Tồn kho (Chi nhánh A)" và kiểu KiotViet mới "Kho: Kho bán hàng"
    const stockHeaders = headers.filter((h) => /^ton kho/.test(normalize(h)) || normalize(h) === 'ton' || /^kho\s*:/.test(normalize(h)));
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

    // KiotViet "hàng cùng loại": các mã có thuộc tính nối về mã chính qua "Mã HH Liên quan" → một hàng hóa nhiều biến thể
    const lc = (v: string) => v.toLowerCase();
    const relatedOf = new Map<string, string>();
    for (const r of baseRows) {
      const c = lc(safeCode(get(r, 'code'))); const rel = lc(safeCode(get(r, 'relatedCode')));
      if (c && rel && rel !== c) relatedOf.set(c, rel);
    }
    const rootOf = (c: string) => { let cur = c; const seen = new Set<string>(); while (relatedOf.has(cur) && !seen.has(cur)) { seen.add(cur); cur = relatedOf.get(cur)!; } return cur; };
    const codesInFile = new Set(baseRows.map((r) => lc(safeCode(get(r, 'code')))).filter(Boolean));
    const groups = new Map<string, RawRow[]>();
    for (const r of baseRows) {
      const c = lc(safeCode(get(r, 'code')));
      let key = c ? rootOf(c) : `__row${r.__row}`;
      if (c && !codesInFile.has(key)) key = c; // mã chính không có trong file → mã này là một hàng hóa riêng
      (groups.get(key) ?? groups.set(key, []).get(key)!).push(r);
    }
    const parseAttrs = (v: string) => {
      const out: Record<string, string> = {};
      for (const part of v.split('|')) { const i = part.indexOf(':'); if (i > 0) { const k = part.slice(0, i).trim(); const val = part.slice(i + 1).trim(); if (k && val) out[k] = val; } }
      return Object.keys(out).length ? out : undefined;
    };
    const imagesOf = (r: RawRow) => splitList(get(r, 'images')).filter((u) => /^https?:\/\//i.test(u));

    for (const [key, members] of groups) {
      members.sort((a, b) => (lc(safeCode(get(a, 'code'))) === key ? -1 : lc(safeCode(get(b, 'code'))) === key ? 1 : Number(a.__row) - Number(b.__row)));
      const main = members[0];
      const row = Number(main.__row);
      const code = safeCode(get(main, 'code')); const name = get(main, 'name');
      if (!name && !code) { totals.skipped += members.length; continue; }
      const multi = members.length > 1;
      try {
        const typeRaw = normalize(get(main, 'type'));
        const type = typeRaw.includes('dich vu') || typeRaw === 'service' ? 'SERVICE' : typeRaw.includes('combo') ? 'COMBO' : 'GOODS';
        const categoryId = get(main, 'category') ? await ensureCategory(categoryPath(get(main, 'category'))) : undefined;
        const brandId = get(main, 'brand') ? await ensureBrand(get(main, 'brand')) : undefined;
        const images = Array.from(new Set(members.flatMap(imagesOf))).slice(0, 20).map((url, i) => ({ url, sortOrder: i }));
        const active = truthy(get(main, 'isActive')); const allowSale = truthy(get(main, 'allowSale'));
        const taxRate = parseNumber(get(main, 'taxRate')) ?? undefined; const weight = parseNumber(get(main, 'weight')) ?? undefined;
        const variantsIn = members.map((r) => ({
          r, sku: multi ? safeCode(get(r, 'code')) || undefined : undefined, barcode: get(r, 'barcode') || undefined,
          attributes: parseAttrs(get(r, 'attributes')), sellPrice: parseNumber(get(r, 'sellPrice')) ?? '0', costPrice: parseNumber(get(r, 'costPrice')) ?? undefined,
          minStock: parseNumber(get(r, 'minStock')) ?? undefined, maxStock: parseNumber(get(r, 'maxStock')) ?? undefined,
          imageUrl: multi ? imagesOf(r)[0] : undefined, isActive: multi ? truthy(get(r, 'isActive')) ?? undefined : undefined,
        }));
        // tên thuộc tính của hàng (vd ["MÀU", "SIZE"]); nhóm biến thể không có thuộc tính → dùng "Phân loại" = mã
        let attributeNames = Array.from(new Set(variantsIn.flatMap((v) => Object.keys(v.attributes ?? {}))));
        if (multi && !attributeNames.length) {
          attributeNames = ['Phân loại'];
          for (const v of variantsIn) v.attributes = { 'Phân loại': v.sku ?? safeCode(get(v.r, 'code')) };
        }
        const findVariant = (list: Array<{ id: string; sku: string }>, sku?: string) => (sku ? list.find((x) => lc(x.sku) === lc(sku)) : undefined) ?? (!multi ? list[0] : undefined);
        const existing = code ? await this.prisma.db.product.findFirst({ where: { code, deletedAt: null }, include: { variants: { where: { deletedAt: null }, orderBy: { createdAt: 'asc' } } } }) : null;
        let variantIds: Array<string | undefined>;
        if (existing) {
          if (!updateExisting) { totals.skipped += members.length; variantIds = variantsIn.map((v) => findVariant(existing.variants, v.sku)?.id); }
          else {
            const variants = variantsIn.map((v) => {
              const ex = findVariant(existing.variants, v.sku) as (typeof existing.variants)[number] | undefined;
              const common = { barcode: v.barcode, attributes: v.attributes, sellPrice: v.sellPrice, minStock: v.minStock, maxStock: v.maxStock, imageUrl: v.imageUrl, isActive: v.isActive };
              return ex ? { id: ex.id, ...common, ...(ex.onHandTotal.isZero() && v.costPrice ? { costPrice: v.costPrice } : {}) } : { sku: v.sku, ...common, costPrice: v.costPrice };
            });
            const dto = plainToInstance(UpdateProductDto, { name: name || undefined, categoryId, brandId, baseUnit: get(main, 'unit') || undefined, description: get(main, 'description') || undefined, taxRate, weight, allowSale: allowSale ?? undefined, isActive: active ?? undefined, ...(images.length ? { images } : {}), ...(attributeNames.length ? { attributeNames } : {}), variants });
            await this.assertDto(dto);
            await this.products.update(user, existing.id, dto);
            const after = await this.prisma.db.productVariant.findMany({ where: { productId: existing.id, deletedAt: null }, orderBy: { createdAt: 'asc' }, select: { id: true, sku: true } });
            variantIds = variantsIn.map((v) => findVariant(after, v.sku)?.id);
            totals.updated += members.length;
          }
        } else {
          const dto = plainToInstance(CreateProductDto, {
            code: code || undefined, name: name || code, type, categoryId, brandId, baseUnit: get(main, 'unit') || undefined, description: get(main, 'description') || undefined, taxRate, weight, allowSale: allowSale ?? undefined, images, ...(attributeNames.length ? { attributeNames } : {}),
            variants: variantsIn.map((v) => ({ sku: v.sku, barcode: v.barcode, attributes: v.attributes, sellPrice: v.sellPrice, costPrice: v.costPrice, minStock: v.minStock, maxStock: v.maxStock, imageUrl: v.imageUrl, isActive: v.isActive })),
          });
          await this.assertDto(dto);
          const created = await this.products.create(user, dto);
          if (active === false) await this.products.update(user, created.id, plainToInstance(UpdateProductDto, { isActive: false }));
          variantIds = variantsIn.map((v) => findVariant(created.variants as Array<{ id: string; sku: string }>, v.sku)?.id);
          totals.created += members.length; totals.products = (totals.products ?? 0) + 1;
        }
        for (const [i, v] of variantsIn.entries()) {
          const variantId = variantIds[i]; const vcode = safeCode(get(v.r, 'code'));
          if (variantId && vcode) codeToVariant.set(lc(vcode), variantId);
          if (!(importStock && variantId && type === 'GOODS')) continue;
          for (const sc of stockCols) {
            const rawQ = parseNumber((v.r[sc.header] ?? '').trim());
            if (rawQ === null) continue;
            // KiotViet xuất số lẻ dạng 1.2999999999 → làm tròn theo độ chính xác tồn kho (3 số lẻ) để lần nhập lại không sinh điều chỉnh 0
            let q = toQty(rawQ).toString();
            if (D(q).isNegative()) {
              // tồn âm (bán quá tồn) ở KiotViet → nhập 0, ghi lại để kiểm kho
              errors.push({ row: Number(v.r.__row), code: vcode, error: `Tồn âm ở KiotViet (${q}) tại "${sc.header}" → nhập 0, cần kiểm kho` });
              totals.negativeStock = (totals.negativeStock ?? 0) + 1;
              q = '0';
            }
            (stockPlan.get(sc.warehouseId) ?? stockPlan.set(sc.warehouseId, []).get(sc.warehouseId)!).push({ variantId, quantity: q, unitCost: v.costPrice ?? '0' });
          }
        }
      } catch (e) { totals.failed += members.length; errors.push({ row, code, error: `${multi ? `(${members.length} biến thể) ` : ''}${err(e)}` }); }
    }
    // conversion units
    for (const r of unitRows) {
      const row = Number(r.__row); const base = safeCode(get(r, 'baseUnitCode'));
      try {
        const include = { units: true, variants: { where: { deletedAt: null }, orderBy: { createdAt: 'asc' as const }, select: { id: true, sku: true } } };
        const product = (await this.prisma.db.product.findFirst({ where: { code: base, deletedAt: null }, include }))
          ?? (await this.prisma.db.product.findFirst({ where: { deletedAt: null, variants: { some: { sku: { equals: base, mode: 'insensitive' }, deletedAt: null } } }, include }));
        if (!product) throw new Error(`Không tìm thấy hàng cơ bản ${base}`);
        const unitName = get(r, 'unit') || get(r, 'name'); const factor = parseNumber(get(r, 'conversion'));
        if (!unitName || !factor || D(factor).lessThanOrEqualTo(0)) throw new Error('Thiếu tên đơn vị hoặc hệ số quy đổi');
        // mã ĐVT → đúng biến thể gốc + hệ số (hàng nhiều biến thể có nhiều mã ĐVT cùng tên ĐVT, product_units chỉ giữ được một)
        const unitCode = safeCode(get(r, 'code')).toLowerCase();
        const baseVariant = product.variants.find((v) => v.sku?.toLowerCase() === base.toLowerCase()) ?? product.variants[0];
        if (unitCode && baseVariant) {
          const alias = { variantId: baseVariant.id, unitName: unitName.slice(0, 50), factor: D(factor) };
          await this.prisma.db.importCodeAlias.upsert({ where: { tenantId_source_code: { tenantId: user.tenantId, source: 'KIOTVIET', code: unitCode } }, update: alias, create: { tenantId: user.tenantId, source: 'KIOTVIET', code: unitCode, ...alias } });
        }
        const units = product.units.filter((u) => u.unitName.toLowerCase() !== unitName.toLowerCase()).map((u) => ({ id: u.id, unitName: u.unitName, conversionFactor: u.conversionFactor.toString(), sku: u.sku ?? undefined, barcode: u.barcode ?? undefined, sellPrice: u.sellPrice?.toString() }));
        units.push({ id: undefined as unknown as string, unitName, conversionFactor: factor, sku: safeCode(get(r, 'code')) || undefined, barcode: get(r, 'barcode') || undefined, sellPrice: parseNumber(get(r, 'sellPrice')) ?? undefined });
        const dto = plainToInstance(UpdateProductDto, { units: units.map((u) => ({ ...u, id: u.id || undefined })) });
        await this.assertDto(dto);
        await this.products.update(user, product.id, dto);
        const unitId = (await this.prisma.db.productUnit.findFirst({ where: { productId: product.id, unitName: { equals: unitName, mode: 'insensitive' } }, select: { id: true } }))?.id;
        if (unitCode && unitId) await this.prisma.db.importCodeAlias.updateMany({ where: { source: 'KIOTVIET', code: unitCode }, data: { productUnitId: unitId } });
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
        const points = party === 'CUSTOMER' ? parseNumber(get(r, 'points')) : null;
        const common = { name, phone: get(r, 'phone') || undefined, email: /@/.test(get(r, 'email')) ? get(r, 'email') : undefined, address: [get(r, 'address'), get(r, 'ward'), get(r, 'area')].filter(Boolean).join(', ') || undefined, taxCode: get(r, 'taxCode') || undefined, groupName: get(r, 'groupName') || undefined, note: [get(r, 'note'), get(r, 'company') ? `Công ty: ${get(r, 'company')}` : ''].filter(Boolean).join(' · ') || undefined };
        if (party === 'CUSTOMER') {
          const existing = code ? await this.prisma.db.customer.findFirst({ where: { code } }) : await this.prisma.db.customer.findFirst({ where: { phone: common.phone ?? '__none__' } });
          if (existing) {
            if (updateExisting) { const dto = plainToInstance(UpdateCustomerDto, { ...common, gender: genderOf(get(r, 'gender')), birthday: dateOnly(parseDate(get(r, 'birthday'))), isActive: truthy(get(r, 'isActive')) ?? undefined }); await this.assertDto(dto); await this.customers.update(user, existing.id, dto); totals.updated++; } else totals.skipped++;
            if (options.syncDebt && debt !== null) { if (await this.syncDebt(user, 'CUSTOMER', existing.id, existing.code, debt)) totals.debtAdjusted!++; }
            if (points !== null && (await this.syncPoints(user, existing.id, existing.code, points))) totals.pointsAdjusted = (totals.pointsAdjusted ?? 0) + 1;
          } else {
            const dto = plainToInstance(CreateCustomerDto, { code: code || undefined, ...common, gender: genderOf(get(r, 'gender')), birthday: dateOnly(parseDate(get(r, 'birthday'))), openingBalance: debt ?? undefined });
            await this.assertDto(dto);
            const created = await this.customers.create(user, dto) as { id: string; code: string };
            totals.created++;
            if (points !== null && (await this.syncPoints(user, created.id, created.code, points))) totals.pointsAdjusted = (totals.pointsAdjusted ?? 0) + 1;
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

  /** Đưa điểm tích lũy của khách về đúng số điểm hiện tại ở KiotViet bằng một bút toán ADJUST trong sổ điểm (chạy lại không cộng trùng). */
  private async syncPoints(user: RequestUser, customerId: string, code: string, target: string) {
    return this.prisma.tx(async (tx) => {
      const c = await tx.customer.findFirst({ where: { id: customerId }, select: { points: true } });
      const delta = D(target).toDecimalPlaces(2).minus(D(c?.points ?? 0));
      if (delta.isZero()) return false;
      await this.loyalty.post(tx, user, { customerId, type: 'ADJUST', points: delta, documentType: 'IMPORT', documentId: customerId, documentCode: code, note: 'Điểm tích lũy chuyển từ KiotViet' });
      return true;
    });
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
    // KiotViet bán theo đơn vị quy đổi bằng mã riêng của ĐVT (1 miếng trong hộp 10, 1 tuýp trong set 3…) → dòng thuộc hàng gốc,
    // số lượng gốc = SL × hệ số quy đổi; không tạo hàng giữ chỗ cho những mã này
    const uniqCodes = Array.from(new Set(codes));
    const unitRows = uniqCodes.length ? await this.prisma.db.productUnit.findMany({ where: { OR: [{ sku: { in: uniqCodes, mode: 'insensitive' } }, { barcode: { in: uniqCodes, mode: 'insensitive' } }] }, select: { id: true, unitName: true, conversionFactor: true, sku: true, barcode: true, product: { select: { code: true, baseUnit: true, variants: { where: { deletedAt: null }, orderBy: { createdAt: 'asc' }, take: 1, select: { id: true, sku: true, costPrice: true } } } } } }) : [];
    const uByCode = new Map<string, { unitId: string | null; unitName: string | null; factor: Prisma.Decimal; variant: (typeof variants)[number] }>();
    for (const u of unitRows) {
      const base = u.product.variants[0];
      if (!base) continue;
      const entry = { unitId: u.id, unitName: u.unitName, factor: D(u.conversionFactor), variant: { id: base.id, sku: base.sku, costPrice: base.costPrice, product: { code: u.product.code, baseUnit: u.product.baseUnit } } as (typeof variants)[number] };
      if (u.sku) uByCode.set(u.sku.toLowerCase(), entry);
      if (u.barcode) uByCode.set(u.barcode.toLowerCase(), entry);
    }
    const aliases = uniqCodes.length ? await this.prisma.db.importCodeAlias.findMany({ where: { source: 'KIOTVIET', code: { in: uniqCodes } }, select: { code: true, productUnitId: true, unitName: true, factor: true, variant: { select: { id: true, sku: true, costPrice: true, deletedAt: true, product: { select: { code: true, baseUnit: true } } } } } }) : [];
    for (const a of aliases) if (!a.variant.deletedAt) uByCode.set(a.code, { unitId: a.productUnitId, unitName: a.unitName, factor: D(a.factor), variant: { id: a.variant.id, sku: a.variant.sku, costPrice: a.variant.costPrice, product: a.variant.product } as (typeof variants)[number] });
    // hóa đơn cũ có mã hàng không còn trong danh mục (đã xóa / ngừng bán ở KiotViet) → tạo hàng "ngừng kinh doanh" giữ chỗ để lịch sử đủ dòng
    if (options.createMissingProducts !== false) {
      const missing = new Map<string, { code: string; name: string; price: string }>();
      for (const g of groups.values()) for (const r of g) {
        const c = safeCode(get(r, 'lineCode'));
        if (c && !uByCode.has(c.toLowerCase()) && !vByCode.has(c.toLowerCase()) && !missing.has(c.toLowerCase())) missing.set(c.toLowerCase(), { code: c, name: get(r, 'lineName') || c, price: parseNumber(get(r, 'linePrice')) ?? '0' });
      }
      if (missing.size) {
        const cat = (await this.prisma.db.productCategory.findFirst({ where: { name: 'Hàng ngừng kinh doanh (KiotViet)', parentId: null } }))
          ?? (await this.prisma.db.productCategory.create({ data: { tenantId: user.tenantId, name: 'Hàng ngừng kinh doanh (KiotViet)' } }));
        for (const [lc, m] of missing) {
          try {
            const dto = plainToInstance(CreateProductDto, { code: m.code, name: m.name.slice(0, 300), type: 'GOODS', categoryId: cat.id, description: 'Tạo tự động khi nhập lịch sử hóa đơn KiotViet (mã không còn trong danh mục)', variants: [{ sellPrice: m.price }] });
            await this.assertDto(dto);
            const created = await this.products.create(user, dto);
            await this.products.update(user, created.id, plainToInstance(UpdateProductDto, { isActive: false }));
            const v = created.variants[0] as unknown as { id: string; sku: string; costPrice: Prisma.Decimal };
            vByCode.set(lc, { id: v.id, sku: v.sku, costPrice: D(v.costPrice ?? 0), product: { code: created.code, baseUnit: created.baseUnit ?? null } } as (typeof variants)[number]);
            totals.placeholders = (totals.placeholders ?? 0) + 1;
          } catch (e) { errors.push({ row: 0, code: lc, error: `Không tạo được hàng giữ chỗ: ${err(e)}` }); }
        }
      }
    }
    // hóa đơn đã nhập ở lần trước (theo mã KiotViet) → bỏ qua, nạp sẵn một lần thay vì hỏi từng hóa đơn
    const groupCodes = Array.from(groups.keys());
    const already = new Set<string>();
    for (let i = 0; i < groupCodes.length; i += 5000) {
      const found = await this.prisma.db.invoice.findMany({ where: { imported: true, externalRef: { in: groupCodes.slice(i, i + 5000) } }, select: { externalRef: true } });
      for (const f of found) if (f.externalRef) already.add(f.externalRef);
    }
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
          const lc = safeCode(get(r, 'lineCode')).toLowerCase();
          const unit = uByCode.get(lc);
          const v = unit?.variant ?? vByCode.get(lc);
          if (!v) throw new Error(`Dòng ${r.__row}: không tìm thấy hàng ${get(r, 'lineCode') || get(r, 'lineName')} (nhập hàng hóa trước)`);
          const quantity = toQty(parseNumber(get(r, 'lineQty')) ?? '1');
          const factor = unit?.factor ?? D(1);
          const unitCost = money(D(v.costPrice).times(factor));
          const unitPrice = money(parseNumber(get(r, 'linePrice')) ?? '0');
          const discount = money(parseNumber(get(r, 'lineDiscount')) ?? '0');
          const lineTotal = parseNumber(get(r, 'lineTotal')) !== null ? money(parseNumber(get(r, 'lineTotal'))!) : money(quantity.times(unitPrice).minus(discount));
          return { lineNo: i + 1, variantId: v.id, productUnitId: unit?.unitId ?? null, unitName: unit?.unitName ?? v.product.baseUnit, quantity, baseQuantity: toQty(quantity.times(factor)), listPrice: unitPrice, unitPrice, discountAmount: discount, lineTotal, unitCost, costTotal: money(quantity.times(unitCost)) };
        });
        const subtotal = parseNumber(get(head, 'subtotal')) !== null ? money(parseNumber(get(head, 'subtotal'))!) : lines.reduce((s, l) => s.plus(l.lineTotal), ZERO);
        const discount = money(parseNumber(get(head, 'discount')) ?? '0');
        const total = parseNumber(get(head, 'total')) !== null ? money(parseNumber(get(head, 'total'))!) : subtotal.minus(discount);
        const paid = money(parseNumber(get(head, 'paid')) ?? total.toString());
        if (already.has(code)) { totals.skipped++; continue; }
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
