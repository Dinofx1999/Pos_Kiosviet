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
  /** kiểm kho lịch sử: tên chi nhánh / kho KiotViet → warehouseId (mặc định: kho cùng tên, rồi kho mặc định của chi nhánh) */
  warehouseMap?: Record<string, string>;
  defaultBranchId?: string;
  /** skip invoices older than this date */
  invoicesFrom?: string;
  /** invoice history: line codes missing from the catalogue become inactive placeholder products (default true) */
  createMissingProducts?: boolean;
  /** bảng giá: chỉ nhập các cột này (mặc định mọi cột không khớp trường chuẩn) */
  priceBookColumns?: string[];
  /** bảng giá: cập nhật giá bán chung của biến thể theo cột "Giá bán" (mặc định không) */
  updateBasePrice?: boolean;
  /** bảng giá: trạng thái / hiệu lực / nhóm khách theo tên cột (lấy từ KiotViet) */
  priceBookMeta?: Record<string, { status?: 'ACTIVE' | 'INACTIVE'; startsAt?: string; endsAt?: string; customerGroups?: string[]; priority?: number }>;
}
interface RowError { row: number; code?: string; error: string }
interface Totals { rows: number; created: number; updated: number; skipped: number; failed: number; stockLines?: number; stockDocuments?: number; debtAdjusted?: number; units?: number; products?: number; negativeStock?: number; pointsAdjusted?: number; placeholders?: number; missingInvoices?: number; priceBooks?: number; items?: number; unknownCodes?: number; unitCodes?: number; basePriceUpdated?: number; suppliers?: number; linked?: number; categories?: number; cancelled?: number; open?: number }

const BATCH = 200;
/** Biến thể khớp với mã hàng trên dòng KiotViet (sku / mã hàng hóa / mã ĐVT quy đổi). */
type LineVariant = { id: string; sku: string | null; costPrice: Prisma.Decimal; productId: string; product: { code: string; baseUnit: string | null } };
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
      } else if (type === 'PRICEBOOKS') {
        if (!get(r, 'code')) out.push({ row, error: 'Thiếu mã hàng' });
      } else if (type === 'RETURNS') {
        if (!get(r, 'code')) out.push({ row, error: 'Thiếu mã trả hàng' });
        if (get(r, 'date') && !parseDate(get(r, 'date'))) out.push({ row, code: get(r, 'code'), error: `Ngày không hợp lệ: ${get(r, 'date')}` });
      } else if (type === 'PURCHASES') {
        if (!get(r, 'code')) out.push({ row, error: 'Thiếu mã nhập hàng' });
        if (get(r, 'date') && !parseDate(get(r, 'date'))) out.push({ row, code: get(r, 'code'), error: `Ngày không hợp lệ: ${get(r, 'date')}` });
      } else if (type === 'ORDERS') {
        if (!get(r, 'code')) out.push({ row, error: 'Thiếu mã đặt hàng' });
        if (get(r, 'date') && !parseDate(get(r, 'date'))) out.push({ row, code: get(r, 'code'), error: `Ngày không hợp lệ: ${get(r, 'date')}` });
      } else if (type === 'CASHBOOK') {
        if (!get(r, 'code')) continue; // dòng tổng / quỹ đầu kỳ của file KiotViet không có mã → bỏ qua
        if (get(r, 'amount') && parseNumber(get(r, 'amount')) === null) out.push({ row, code: get(r, 'code'), error: `Số tiền không hợp lệ: ${get(r, 'amount')}` });
        if (get(r, 'date') && !parseDate(get(r, 'date'))) out.push({ row, code: get(r, 'code'), error: `Ngày không hợp lệ: ${get(r, 'date')}` });
      } else if (type === 'STOCKTAKES') {
        if (!get(r, 'code')) out.push({ row, error: 'Thiếu mã kiểm kho' });
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
            : type === 'PRICEBOOKS' ? await this.importPriceBooks(user, rows, mapping, options)
              : type === 'RETURNS' ? await this.importReturns(user, rows, mapping, options)
                : type === 'PURCHASES' ? await this.importPurchases(user, rows, mapping, options)
                  : type === 'ORDERS' ? await this.importOrders(user, rows, mapping, options)
                    : type === 'CASHBOOK' ? await this.importCashBook(user, rows, mapping, options)
                      : type === 'STOCKTAKES' ? await this.importStocktakes(user, rows, mapping, options)
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

  /** Mã hàng trên dòng KiotViet (đã hạ chữ thường) → biến thể theo sku / mã hàng hóa (vByCode), hoặc đơn vị quy đổi / alias KiotViet có mã riêng (uByCode: hàng gốc + hệ số). */
  private async resolveLineCodes(codes: string[]) {
    const variants = codes.length ? await this.prisma.db.productVariant.findMany({ where: { OR: [{ sku: { in: Array.from(new Set(codes)), mode: 'insensitive' } }, { product: { code: { in: Array.from(new Set(codes)), mode: 'insensitive' } } }] }, select: { id: true, sku: true, costPrice: true, productId: true, product: { select: { code: true, baseUnit: true } } } }) : [];
    const vByCode = new Map<string, LineVariant>();
    for (const v of variants) { vByCode.set(v.product.code.toLowerCase(), v); if (v.sku) vByCode.set(v.sku.toLowerCase(), v); }
    // KiotViet bán theo đơn vị quy đổi bằng mã riêng của ĐVT (1 miếng trong hộp 10, 1 tuýp trong set 3…) → dòng thuộc hàng gốc,
    // số lượng gốc = SL × hệ số quy đổi; không tạo hàng giữ chỗ cho những mã này
    const uniqCodes = Array.from(new Set(codes));
    const unitRows = uniqCodes.length ? await this.prisma.db.productUnit.findMany({ where: { OR: [{ sku: { in: uniqCodes, mode: 'insensitive' } }, { barcode: { in: uniqCodes, mode: 'insensitive' } }] }, select: { id: true, unitName: true, conversionFactor: true, sku: true, barcode: true, product: { select: { code: true, baseUnit: true, variants: { where: { deletedAt: null }, orderBy: { createdAt: 'asc' }, take: 1, select: { id: true, sku: true, costPrice: true, productId: true } } } } } }) : [];
    const uByCode = new Map<string, { unitId: string | null; unitName: string | null; factor: Prisma.Decimal; variant: LineVariant }>();
    for (const u of unitRows) {
      const base = u.product.variants[0];
      if (!base) continue;
      const entry = { unitId: u.id, unitName: u.unitName, factor: D(u.conversionFactor), variant: { id: base.id, sku: base.sku, costPrice: base.costPrice, productId: base.productId, product: { code: u.product.code, baseUnit: u.product.baseUnit } } as LineVariant };
      if (u.sku) uByCode.set(u.sku.toLowerCase(), entry);
      if (u.barcode) uByCode.set(u.barcode.toLowerCase(), entry);
    }
    const aliases = uniqCodes.length ? await this.prisma.db.importCodeAlias.findMany({ where: { source: 'KIOTVIET', code: { in: uniqCodes } }, select: { code: true, productUnitId: true, unitName: true, factor: true, variant: { select: { id: true, sku: true, costPrice: true, deletedAt: true, productId: true, product: { select: { code: true, baseUnit: true } } } } } }) : [];
    for (const a of aliases) if (!a.variant.deletedAt) uByCode.set(a.code, { unitId: a.productUnitId, unitName: a.unitName, factor: D(a.factor), variant: { id: a.variant.id, sku: a.variant.sku, costPrice: a.variant.costPrice, productId: a.variant.productId, product: a.variant.product } as LineVariant });
    return { vByCode, uByCode };
  }

  /** Mã hàng trên dòng lịch sử không còn trong danh mục (đã xóa / ngừng bán ở KiotViet) → tạo hàng "ngừng kinh doanh" giữ chỗ để lịch sử đủ dòng. */
  private async createPlaceholderProducts(user: RequestUser, groups: Map<string, RawRow[]>, get: (r: RawRow, f: string) => string, vByCode: Map<string, LineVariant>, uByCode: Map<string, { variant: LineVariant }>, totals: Totals, errors: RowError[], reason: string) {
    const missing = new Map<string, { code: string; name: string; price: string }>();
    for (const g of groups.values()) for (const r of g) {
      const c = safeCode(get(r, 'lineCode'));
      if (c && !uByCode.has(c.toLowerCase()) && !vByCode.has(c.toLowerCase()) && !missing.has(c.toLowerCase())) missing.set(c.toLowerCase(), { code: c, name: get(r, 'lineName') || c, price: parseNumber(get(r, 'linePrice')) ?? '0' });
    }
    if (!missing.size) return;
    const cat = (await this.prisma.db.productCategory.findFirst({ where: { name: 'Hàng ngừng kinh doanh (KiotViet)', parentId: null } }))
      ?? (await this.prisma.db.productCategory.create({ data: { tenantId: user.tenantId, name: 'Hàng ngừng kinh doanh (KiotViet)' } }));
    for (const [lc, m] of missing) {
      try {
        const dto = plainToInstance(CreateProductDto, { code: m.code, name: m.name.slice(0, 300), type: 'GOODS', categoryId: cat.id, description: reason, variants: [{ sellPrice: m.price }] });
        await this.assertDto(dto);
        const created = await this.products.create(user, dto);
        await this.products.update(user, created.id, plainToInstance(UpdateProductDto, { isActive: false }));
        const v = created.variants[0] as unknown as { id: string; sku: string; costPrice: Prisma.Decimal };
        vByCode.set(lc, { id: v.id, sku: v.sku, costPrice: D(v.costPrice ?? 0), productId: created.id, product: { code: created.code, baseUnit: created.baseUnit ?? null } } as LineVariant);
        totals.placeholders = (totals.placeholders ?? 0) + 1;
      } catch (e) { errors.push({ row: 0, code: lc, error: `Không tạo được hàng giữ chỗ: ${err(e)}` }); }
    }
  }

  // ---------------------------------------------------------------- lịch sử nhập hàng (KiotViet Mua hàng → Nhập hàng; không động kho / giá vốn / sổ quỹ / công nợ)
  /**
   * Mỗi phiếu nhập KiotViet thành một phiếu nhập hàng mã KV-<mã>: "Đã nhập hàng" → POSTED nhưng chỉ là lịch sử (không ghi kho, giá vốn,
   * công nợ NCC hay sổ quỹ – tồn và nợ đã lấy theo số hiện tại của KiotViet); "Phiếu tạm" → DRAFT (hoàn tất sau ở đây sẽ nhập kho như phiếu
   * thường); "Đã hủy" → CANCELLED. Dòng khớp theo mã hàng (sku / mã hàng hóa / mã ĐVT quy đổi → quy về đơn vị gốc); mã không còn trong danh
   * mục → hàng giữ chỗ như lịch sử hóa đơn. NCC chưa có → tạo theo mã/tên. Chạy lại bỏ qua mã đã có, riêng phiếu còn DRAFT mà KiotViet đã
   * nhập hàng / hủy thì đổi trạng thái (vẫn không động kho).
   */
  async importPurchases(user: RequestUser, rows: RawRow[], mapping: Record<string, string>, options: ImportOptions) {
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
    const { vByCode, uByCode } = await this.resolveLineCodes(codes);
    if (options.createMissingProducts !== false) await this.createPlaceholderProducts(user, groups, get, vByCode, uByCode, totals, errors, 'Tạo tự động khi nhập lịch sử nhập hàng KiotViet (mã không còn trong danh mục)');
    const groupCodes = Array.from(groups.keys());
    const existing = new Map<string, { id: string; status: string }>();
    for (let i = 0; i < groupCodes.length; i += 5000) {
      const found = await this.prisma.db.purchaseReceipt.findMany({ where: { code: { in: groupCodes.slice(i, i + 5000).map((c) => `KV-${c}`) } }, select: { id: true, code: true, status: true } });
      for (const f of found) existing.set(f.code.slice(3), { id: f.id, status: f.status });
    }
    const suppliers = await this.prisma.db.supplier.findMany({ select: { id: true, code: true, name: true } });
    const sByCode = new Map(suppliers.map((s) => [s.code.toLowerCase(), s]));
    const sByName = new Map(suppliers.map((s) => [s.name.trim().toLowerCase(), s]));
    const users = await this.prisma.db.user.findMany({ select: { id: true, fullName: true, username: true } });
    const userOf = (name: string) => users.find((u) => u.fullName.toLowerCase() === name.toLowerCase() || u.username.toLowerCase() === name.toLowerCase())?.id ?? user.id;
    const warehouses = await this.prisma.db.warehouse.findMany({ select: { id: true, branchId: true, isDefault: true } });
    for (const [code, g] of groups) {
      const head = g[0]; const row = Number(head.__row);
      try {
        const date = parseDate(get(head, 'date')) ?? new Date();
        if (since && date < since) { totals.skipped++; continue; }
        const statusRaw = normalize(get(head, 'status'));
        const status: 'DRAFT' | 'POSTED' | 'CANCELLED' = statusRaw.includes('huy') || statusRaw === 'cancelled' ? 'CANCELLED' : statusRaw.includes('tam') || statusRaw === 'draft' ? 'DRAFT' : 'POSTED';
        const prev = existing.get(code);
        if (prev) {
          if (prev.status === 'DRAFT' && status !== 'DRAFT') {
            await this.prisma.db.purchaseReceipt.update({ where: { id: prev.id }, data: { status, postedAt: status === 'POSTED' ? date : null, postedById: status === 'POSTED' ? userOf(get(head, 'receiver')) : null, cancelledAt: status === 'CANCELLED' ? date : null, cancelledById: status === 'CANCELLED' ? user.id : null, cancelReason: status === 'CANCELLED' ? 'Đã hủy ở KiotViet' : null } });
            totals.updated++;
          } else totals.skipped++;
          continue;
        }
        const branchId = branchOf(get(head, 'branch'));
        if (!branchId) throw new Error('Không xác định được chi nhánh');
        this.access.assertBranch(user, branchId);
        const warehouseId = (warehouses.find((w) => w.branchId === branchId && w.isDefault) ?? warehouses.find((w) => w.branchId === branchId))?.id;
        if (!warehouseId) throw new Error('Chi nhánh chưa có kho');
        // nhà cung cấp theo mã rồi theo tên; chưa có → tạo mới ("Nhà cung cấp lẻ" của KiotViet cũng vậy)
        const sCode = safeCode(get(head, 'supplierCode'));
        const sName = (get(head, 'supplierName') || sCode || 'Nhà cung cấp KiotViet').slice(0, 200);
        let supplier = (sCode ? sByCode.get(sCode.toLowerCase()) : undefined) ?? sByName.get(sName.toLowerCase());
        if (!supplier) {
          const dto = plainToInstance(CreateSupplierDto, { code: sCode || undefined, name: sName, note: 'Tạo tự động khi nhập lịch sử nhập hàng KiotViet' });
          await this.assertDto(dto);
          const created = (await this.suppliers.create(user, dto)) as { id: string; code: string; name: string };
          supplier = { id: created.id, code: created.code, name: created.name };
          sByCode.set(created.code.toLowerCase(), supplier); sByName.set(sName.toLowerCase(), supplier);
          totals.suppliers = (totals.suppliers ?? 0) + 1;
        }
        const lines = g.filter((r) => get(r, 'lineCode') || get(r, 'lineName')).map((r, i) => {
          const lc = safeCode(get(r, 'lineCode')).toLowerCase();
          const unit = uByCode.get(lc);
          const v = unit?.variant ?? vByCode.get(lc);
          if (!v) throw new Error(`Dòng ${r.__row ?? i + 1}: không tìm thấy hàng ${get(r, 'lineCode') || get(r, 'lineName')} (nhập hàng hóa trước)`);
          const factor = unit?.factor ?? D(1);
          const quantity = toQty(toQty(parseNumber(get(r, 'lineQty')) ?? '1').times(factor)); // theo đơn vị gốc
          const priceRaw = money(parseNumber(get(r, 'linePrice')) ?? parseNumber(get(r, 'lineCost')) ?? '0');
          const unitPrice = factor.eq(1) ? priceRaw : money(priceRaw.div(factor));
          const lineTotal = parseNumber(get(r, 'lineTotal')) !== null ? money(parseNumber(get(r, 'lineTotal'))!) : money(quantity.times(unitPrice).minus(money(parseNumber(get(r, 'lineDiscount')) ?? '0')));
          const discount = Prisma.Decimal.max(money(quantity.times(unitPrice).minus(lineTotal)), ZERO);
          const unitCost = quantity.gt(0) ? money(lineTotal.div(quantity)) : unitPrice;
          return { lineNo: i + 1, variantId: v.id, quantity, unitPrice, discountAmount: discount, taxRate: ZERO, taxAmount: ZERO, lineTotal, allocatedCost: ZERO, unitCost, note: unit?.unitName ? `ĐVT ${unit.unitName}` : null };
        });
        const subtotal = parseNumber(get(head, 'subtotal')) !== null ? money(parseNumber(get(head, 'subtotal'))!) : lines.reduce((s, l) => s.plus(l.lineTotal), ZERO);
        const discount = money(parseNumber(get(head, 'discount')) ?? '0');
        const supplierFee = money(parseNumber(get(head, 'supplierFee')) ?? '0');
        const otherFee = money(parseNumber(get(head, 'otherFee')) ?? '0');
        const total = Prisma.Decimal.max(parseNumber(get(head, 'total')) !== null ? money(parseNumber(get(head, 'total'))!) : subtotal.minus(discount).plus(supplierFee), ZERO);
        const paid = Prisma.Decimal.min(Prisma.Decimal.max(money(parseNumber(get(head, 'paid')) ?? '0'), ZERO), total);
        const costs = [supplierFee.gt(0) ? { name: 'Chi phí nhập trả NCC', amount: supplierFee, payToSupplier: true } : null, otherFee.gt(0) ? { name: 'Chi phí nhập khác', amount: otherFee, payToSupplier: false } : null].filter((c): c is { name: string; amount: Prisma.Decimal; payToSupplier: boolean } => !!c);
        const by = userOf(get(head, 'receiver'));
        await this.prisma.db.purchaseReceipt.create({ data: { tenantId: user.tenantId, branchId, warehouseId, supplierId: supplier.id, code: `KV-${code}`, status, receiptDate: date, supplierInvoiceNo: get(head, 'supplierInvoiceNo').slice(0, 100) || null, note: ['Nhập từ KiotViet', get(head, 'note')].filter(Boolean).join(' · ').slice(0, 1000), subtotal, discountAmount: discount, taxAmount: ZERO, landedCostTotal: supplierFee.plus(otherFee), totalAmount: total, paidAmount: paid, postedAt: status === 'POSTED' ? date : null, postedById: status === 'POSTED' ? by : null, cancelledAt: status === 'CANCELLED' ? date : null, cancelledById: status === 'CANCELLED' ? by : null, cancelReason: status === 'CANCELLED' ? 'Đã hủy ở KiotViet' : null, createdById: by, lines: { create: lines.map((l) => ({ tenantId: user.tenantId, ...l })) }, costs: { create: costs.map((c) => ({ tenantId: user.tenantId, ...c })) } } });
        totals.created++;
      } catch (e) { totals.failed++; errors.push({ row, code, error: err(e) }); }
    }
    return { totals, errors };
  }

  // ---------------------------------------------------------------- lịch sử đặt hàng (KiotViet Đơn hàng → Đặt hàng; không giữ tồn / sổ quỹ / công nợ)
  /**
   * Mỗi phiếu đặt KiotViet thành đơn đặt hàng mã KV-<mã>: "Hoàn thành" → COMPLETED gắn hóa đơn KV-<mã hóa đơn> nếu có; "Đã hủy" → CANCELLED;
   * "Phiếu tạm" → DRAFT; "Đang xử lý" / "Đang giao hàng" → CONFIRMED nhưng không giữ tồn (hủy xác nhận rồi xác nhận lại ở đây nếu cần giữ).
   * Tiền cọc = "Khách đã trả", chỉ ghi trên đơn (phiếu thu nằm trong lịch sử sổ quỹ). Người nhận / ĐVVC / mã vận đơn ghi vào ghi chú.
   * Chạy lại bỏ qua mã đã có, đơn còn mở mà KiotViet đã hoàn thành / hủy thì đổi trạng thái.
   */
  async importOrders(user: RequestUser, rows: RawRow[], mapping: Record<string, string>, options: ImportOptions) {
    const get = (r: RawRow, f: string) => (mapping[f] ? (r[mapping[f]] ?? '').trim() : '');
    const totals: Totals = { rows: rows.length, created: 0, updated: 0, skipped: 0, failed: 0, linked: 0, open: 0 };
    const errors: RowError[] = [];
    const branches = await this.prisma.db.branch.findMany({ select: { id: true, name: true, code: true } });
    const defaultBranchId = options.defaultBranchId ?? (branches.find((b) => (user.branchIds ?? []).includes(b.id))?.id ?? branches[0]?.id);
    const branchOf = (name: string) => options.branchMap?.[name] ?? branches.find((b) => b.name.toLowerCase() === name.toLowerCase() || b.code.toLowerCase() === name.toLowerCase())?.id ?? defaultBranchId;
    const since = options.invoicesFrom ? new Date(options.invoicesFrom) : null;
    const groups = new Map<string, RawRow[]>();
    for (const r of rows) { const c = get(r, 'code'); if (!c) { totals.skipped++; continue; } (groups.get(c) ?? groups.set(c, []).get(c)!).push(r); }
    const codes = Array.from(groups.values()).flatMap((g) => g.map((r) => safeCode(get(r, 'lineCode')).toLowerCase()).filter(Boolean));
    const { vByCode, uByCode } = await this.resolveLineCodes(codes);
    if (options.createMissingProducts !== false) await this.createPlaceholderProducts(user, groups, get, vByCode, uByCode, totals, errors, 'Tạo tự động khi nhập lịch sử đặt hàng KiotViet (mã không còn trong danh mục)');
    const groupCodes = Array.from(groups.keys());
    const existing = new Map<string, { id: string; status: string; invoiceId: string | null }>();
    for (let i = 0; i < groupCodes.length; i += 5000) {
      const found = await this.prisma.db.salesOrder.findMany({ where: { code: { in: groupCodes.slice(i, i + 5000).map((c) => `KV-${c}`) } }, select: { id: true, code: true, status: true, invoiceId: true } });
      for (const f of found) existing.set(f.code.slice(3), { id: f.id, status: f.status, invoiceId: f.invoiceId });
    }
    // hóa đơn của đơn đã hoàn thành (theo mã KiotViet) – mỗi hóa đơn chỉ gắn được một đơn
    const invCodes = Array.from(new Set(Array.from(groups.values()).map((g) => safeCode(get(g[0], 'invoiceCode'))).filter(Boolean)));
    const invByCode = new Map<string, { id: string; customerId: string | null }>();
    for (let i = 0; i < invCodes.length; i += 5000) {
      const chunk = invCodes.slice(i, i + 5000);
      const found = await this.prisma.db.invoice.findMany({ where: { OR: [{ externalRef: { in: chunk } }, { code: { in: chunk } }, { code: { in: chunk.map((c) => `KV-${c}`) } }] }, select: { id: true, code: true, externalRef: true, customerId: true } });
      for (const f of found) { if (f.externalRef) invByCode.set(f.externalRef.toLowerCase(), f); invByCode.set(f.code.toLowerCase(), f); if (f.code.startsWith('KV-')) invByCode.set(f.code.slice(3).toLowerCase(), f); }
    }
    const usedInvoices = new Set((await this.prisma.db.salesOrder.findMany({ where: { invoiceId: { not: null } }, select: { invoiceId: true } })).map((o) => o.invoiceId!));
    const customers = await this.prisma.db.customer.findMany({ select: { id: true, code: true } });
    const cByCode = new Map(customers.map((c) => [c.code.toLowerCase(), c]));
    const users = await this.prisma.db.user.findMany({ select: { id: true, fullName: true, username: true } });
    const userOf = (name: string) => users.find((u) => u.fullName.toLowerCase() === name.toLowerCase() || u.username.toLowerCase() === name.toLowerCase())?.id ?? null;
    const warehouses = await this.prisma.db.warehouse.findMany({ select: { id: true, branchId: true, isDefault: true } });
    const sourceOf = (channel: string) => { const n = normalize(channel); if (!n || /truc tiep|tai quay|pos/.test(n)) return 'POS'; if (/dien thoai|phone/.test(n)) return 'PHONE'; if (/face ?book|\bfb\b/.test(n)) return 'FACEBOOK'; if (/zalo/.test(n)) return 'ZALO'; if (/shopee/.test(n)) return 'SHOPEE'; if (/web|online|lazada|tiktok|tik tok/.test(n)) return 'ONLINE'; return 'OTHER'; };
    for (const [code, g] of groups) {
      const head = g[0]; const row = Number(head.__row);
      try {
        const date = parseDate(get(head, 'date')) ?? new Date();
        if (since && date < since) { totals.skipped++; continue; }
        const statusRaw = normalize(get(head, 'status'));
        const status: 'DRAFT' | 'CONFIRMED' | 'COMPLETED' | 'CANCELLED' = statusRaw.includes('huy') || statusRaw === 'cancelled' ? 'CANCELLED' : statusRaw.includes('hoan thanh') || statusRaw === 'completed' ? 'COMPLETED' : statusRaw.includes('tam') || statusRaw === 'draft' || !statusRaw ? 'DRAFT' : 'CONFIRMED';
        const invRef = safeCode(get(head, 'invoiceCode')).toLowerCase();
        const inv = invRef ? invByCode.get(invRef) : undefined;
        const linkInvoice = status === 'COMPLETED' && inv && !usedInvoices.has(inv.id) ? inv.id : null;
        const prev = existing.get(code);
        if (prev) {
          if ((prev.status === 'DRAFT' || prev.status === 'CONFIRMED') && status !== prev.status && (status === 'COMPLETED' || status === 'CANCELLED')) {
            await this.prisma.db.salesOrder.update({ where: { id: prev.id }, data: { status, completedAt: status === 'COMPLETED' ? date : null, invoiceId: status === 'COMPLETED' && !prev.invoiceId ? linkInvoice : undefined, cancelledAt: status === 'CANCELLED' ? date : null, cancelledById: status === 'CANCELLED' ? user.id : null, cancelReason: status === 'CANCELLED' ? 'Đã hủy ở KiotViet' : null, version: { increment: 1 } } });
            if (status === 'COMPLETED' && linkInvoice && !prev.invoiceId) { usedInvoices.add(linkInvoice); totals.linked!++; }
            totals.updated++;
          } else totals.skipped++;
          continue;
        }
        const branchId = branchOf(get(head, 'branch'));
        if (!branchId) throw new Error('Không xác định được chi nhánh');
        this.access.assertBranch(user, branchId);
        const warehouseId = (warehouses.find((w) => w.branchId === branchId && w.isDefault) ?? warehouses.find((w) => w.branchId === branchId))?.id;
        if (!warehouseId) throw new Error('Chi nhánh chưa có kho');
        const customer = (get(head, 'customerCode') ? cByCode.get(safeCode(get(head, 'customerCode')).toLowerCase()) : undefined) ?? (inv?.customerId ? { id: inv.customerId } : undefined);
        const lines = g.filter((r) => get(r, 'lineCode') || get(r, 'lineName')).map((r, i) => {
          const lc = safeCode(get(r, 'lineCode')).toLowerCase();
          const unit = uByCode.get(lc);
          const v = unit?.variant ?? vByCode.get(lc);
          if (!v) throw new Error(`Dòng ${r.__row ?? i + 1}: không tìm thấy hàng ${get(r, 'lineCode') || get(r, 'lineName')} (nhập hàng hóa trước)`);
          const quantity = toQty(parseNumber(get(r, 'lineQty')) ?? '1');
          const factor = unit?.factor ?? D(1);
          const listPrice = money(parseNumber(get(r, 'linePrice')) ?? parseNumber(get(r, 'lineSellPrice')) ?? '0');
          const lineTotal = parseNumber(get(r, 'lineTotal')) !== null ? money(parseNumber(get(r, 'lineTotal'))!) : money(quantity.times(money(parseNumber(get(r, 'lineSellPrice')) ?? listPrice.toString())));
          const discount = Prisma.Decimal.max(money(quantity.times(listPrice).minus(lineTotal)), ZERO);
          return { lineNo: i + 1, variantId: v.id, productUnitId: unit?.unitId ?? null, unitName: unit?.unitName ?? v.product.baseUnit, conversionFactor: factor, quantity, baseQuantity: toQty(quantity.times(factor)), listPrice, unitPrice: listPrice, discountAmount: discount, taxRate: ZERO, taxAmount: ZERO, lineTotal };
        });
        const subtotal = parseNumber(get(head, 'subtotal')) !== null ? money(parseNumber(get(head, 'subtotal'))!) : lines.reduce((s, l) => s.plus(l.lineTotal), ZERO);
        const discount = money(parseNumber(get(head, 'discount')) ?? '0');
        const otherFee = money(parseNumber(get(head, 'otherFee')) ?? '0');
        const total = Prisma.Decimal.max(parseNumber(get(head, 'total')) !== null ? money(parseNumber(get(head, 'total'))!) : subtotal.minus(discount).plus(otherFee), ZERO);
        const deposit = Prisma.Decimal.min(Prisma.Decimal.max(money(parseNumber(get(head, 'paid')) ?? '0'), ZERO), total);
        const receiver = [get(head, 'receiverName'), get(head, 'receiverPhone'), [get(head, 'receiverAddress'), get(head, 'receiverWard'), get(head, 'receiverArea')].filter(Boolean).join(', ')].filter(Boolean).join(' – ');
        const shipping = [get(head, 'carrier'), get(head, 'trackingCode')].filter(Boolean).join(' ');
        const note = ['Nhập từ KiotViet', get(head, 'channel') ? `Kênh ${get(head, 'channel')}` : '', receiver ? `Giao: ${receiver}` : '', shipping ? `ĐVVC: ${shipping}` : '', get(head, 'note')].filter(Boolean).join(' · ').slice(0, 1000);
        const sellerId = userOf(get(head, 'seller'));
        await this.prisma.db.salesOrder.create({ data: { tenantId: user.tenantId, branchId, warehouseId, customerId: customer?.id ?? null, sellerId, invoiceId: linkInvoice, code: `KV-${code}`, status, source: sourceOf(get(head, 'channel')), orderDate: date, expectedAt: parseDate(get(head, 'deliveryAt')), note, subtotal, discountAmount: discount, taxAmount: ZERO, totalAmount: total, depositAmount: deposit, confirmedAt: status === 'CONFIRMED' || status === 'COMPLETED' ? date : null, completedAt: status === 'COMPLETED' ? date : null, cancelledAt: status === 'CANCELLED' ? date : null, cancelledById: status === 'CANCELLED' ? sellerId ?? user.id : null, cancelReason: status === 'CANCELLED' ? 'Đã hủy ở KiotViet' : null, createdById: sellerId ?? user.id, lines: { create: lines.map((l) => ({ tenantId: user.tenantId, ...l })) } } });
        if (linkInvoice) { usedInvoices.add(linkInvoice); totals.linked!++; }
        if (status === 'DRAFT' || status === 'CONFIRMED') totals.open!++;
        totals.created++;
      } catch (e) { totals.failed++; errors.push({ row, code, error: err(e) }); }
    }
    return { totals, errors };
  }

  // ---------------------------------------------------------------- lịch sử sổ quỹ (KiotViet Sổ quỹ; chỉ ghi phiếu, không động công nợ; số dư quỹ cân lại sau)
  /**
   * Mỗi phiếu thu/chi KiotViet thành một phiếu mã KV-<mã>: chiều theo loại phiếu / dấu số tiền; phương thức → quỹ (tiền mặt / ngân hàng / ví);
   * loại thu chi → danh mục thu/chi (tạo nếu chưa có, chỉ với phiếu không gắn chứng từ); đối tác theo mã KH/NCC, hoặc theo chứng từ gốc suy từ
   * mã phiếu (TTHD… → hóa đơn, TTTH… → phiếu trả hàng, TTDH… → đơn đặt, TTPN… → phiếu nhập) và gắn phân bổ vào chứng từ đó. Không ghi sổ
   * công nợ (đã lấy số hiện tại) và KHÔNG cộng vào số dư quỹ: sau khi nhập, đặt quỹ đầu kỳ = tồn quỹ KiotViet − tổng phiếu đã nhập của quỹ.
   * Ghi theo lô (createMany) vì sổ quỹ có hàng trăm nghìn phiếu. Chạy lại bỏ qua mã đã có.
   */
  async importCashBook(user: RequestUser, rows: RawRow[], mapping: Record<string, string>, options: ImportOptions) {
    const get = (r: RawRow, f: string) => (mapping[f] ? (r[mapping[f]] ?? '').trim() : '');
    const totals: Totals = { rows: rows.length, created: 0, updated: 0, skipped: 0, failed: 0, linked: 0, categories: 0, cancelled: 0 };
    const errors: RowError[] = [];
    const branches = await this.prisma.db.branch.findMany({ select: { id: true, name: true, code: true } });
    const defaultBranchId = options.defaultBranchId ?? (branches.find((b) => (user.branchIds ?? []).includes(b.id))?.id ?? branches[0]?.id);
    const branchOf = (name: string) => options.branchMap?.[name] ?? branches.find((b) => b.name.toLowerCase() === name.toLowerCase() || b.code.toLowerCase() === name.toLowerCase())?.id ?? defaultBranchId;
    const since = options.invoicesFrom ? new Date(options.invoicesFrom) : null;
    const accounts = await this.prisma.db.cashAccount.findMany({ where: { isActive: true }, select: { id: true, type: true, branchId: true }, orderBy: [{ isDefault: 'desc' }, { createdAt: 'asc' }] });
    const accountFor = (branchId: string, method: string) => {
      const type = method === 'CASH' || method === 'OTHER' ? 'CASH' : method === 'EWALLET' ? 'EWALLET' : 'BANK';
      const pick = (t: string) => accounts.find((a) => a.type === t && a.branchId === branchId) ?? accounts.find((a) => a.type === t);
      return (pick(type) ?? (type === 'EWALLET' ? pick('BANK') : undefined) ?? pick('CASH') ?? accounts[0])?.id ?? null;
    };
    const methodOf = (s: string): 'CASH' | 'BANK_TRANSFER' | 'CARD' | 'EWALLET' | 'OTHER' => { const n = normalize(s); if (!n || /tien mat|^cash$/.test(n)) return 'CASH'; if (/chuyen khoan|transfer|bank|ngan hang/.test(n)) return 'BANK_TRANSFER'; if (/^the|card/.test(n)) return 'CARD'; if (/^vi|wallet|momo|zalo|vnpay/.test(n)) return 'EWALLET'; return 'OTHER'; };
    const catList = await this.prisma.db.paymentCategory.findMany({ select: { id: true, direction: true, name: true } });
    const cats = new Map(catList.map((c) => [`${c.direction}:${c.name.toLowerCase()}`, c.id]));
    const categoryOf = async (direction: 'IN' | 'OUT', kind: string) => {
      const name = (kind.replace(/^(phiếu|phieu)?\s*(thu|chi)\s*/i, '').trim() || (direction === 'IN' ? 'Thu khác' : 'Chi khác')).slice(0, 200);
      const key = `${direction}:${name.toLowerCase()}`;
      if (!cats.has(key)) { const c = await this.prisma.db.paymentCategory.create({ data: { tenantId: user.tenantId, direction, name } }); cats.set(key, c.id); totals.categories!++; }
      return cats.get(key)!;
    };
    const valid = rows.filter((r) => get(r, 'code'));
    totals.skipped += rows.length - valid.length;
    const codes = valid.map((r) => get(r, 'code'));
    const existing = new Set<string>();
    for (let i = 0; i < codes.length; i += 5000) for (const f of await this.prisma.db.payment.findMany({ where: { code: { in: codes.slice(i, i + 5000).map((c) => `KV-${c}`) } }, select: { code: true } })) existing.add(f.code.slice(3));
    // chứng từ gốc theo mã phiếu KiotViet: TTHD201925 → HD201925 (hóa đơn), TTTH… → phiếu trả, TTDH… → đơn đặt, PCPN… / TTPN… → phiếu nhập
    const docRef = (code: string) => { const m = code.match(/^(?:TT|PC|PT|CT)(HD[D_A-Z0-9]*|TH\d+|DH\d+|PN\d+)$/i); return m ? m[1] : null; };
    const refs = Array.from(new Set(valid.map((r) => (get(r, 'document') ? safeCode(get(r, 'document')) : docRef(get(r, 'code')))).filter((x): x is string => !!x)));
    const invRefs = refs.filter((x) => /^HD/i.test(x)); const retRefs = refs.filter((x) => /^TH/i.test(x)); const ordRefs = refs.filter((x) => /^DH/i.test(x)); const purRefs = refs.filter((x) => /^PN/i.test(x));
    const docs = new Map<string, { type: 'INVOICE' | 'SALES_RETURN' | 'SALES_ORDER' | 'PURCHASE_RECEIPT'; id: string; partyType: 'CUSTOMER' | 'SUPPLIER' | null; partyId: string | null; dir: 'IN' | 'OUT' }>();
    for (let i = 0; i < invRefs.length; i += 5000) { const chunk = invRefs.slice(i, i + 5000); for (const f of await this.prisma.db.invoice.findMany({ where: { OR: [{ externalRef: { in: chunk } }, { code: { in: chunk.map((c) => `KV-${c}`) } }] }, select: { id: true, code: true, externalRef: true, customerId: true } })) docs.set((f.externalRef ?? f.code.replace(/^KV-/, '')).toLowerCase(), { type: 'INVOICE', id: f.id, partyType: f.customerId ? 'CUSTOMER' : null, partyId: f.customerId, dir: 'IN' }); }
    for (let i = 0; i < retRefs.length; i += 5000) for (const f of await this.prisma.db.salesReturn.findMany({ where: { code: { in: retRefs.slice(i, i + 5000).map((c) => `KV-${c}`) } }, select: { id: true, code: true, customerId: true } })) docs.set(f.code.slice(3).toLowerCase(), { type: 'SALES_RETURN', id: f.id, partyType: f.customerId ? 'CUSTOMER' : null, partyId: f.customerId, dir: 'OUT' });
    for (let i = 0; i < ordRefs.length; i += 5000) for (const f of await this.prisma.db.salesOrder.findMany({ where: { code: { in: ordRefs.slice(i, i + 5000).map((c) => `KV-${c}`) } }, select: { id: true, code: true, customerId: true } })) docs.set(f.code.slice(3).toLowerCase(), { type: 'SALES_ORDER', id: f.id, partyType: f.customerId ? 'CUSTOMER' : null, partyId: f.customerId, dir: 'IN' });
    for (let i = 0; i < purRefs.length; i += 5000) for (const f of await this.prisma.db.purchaseReceipt.findMany({ where: { code: { in: purRefs.slice(i, i + 5000).map((c) => `KV-${c}`) } }, select: { id: true, code: true, supplierId: true } })) docs.set(f.code.slice(3).toLowerCase(), { type: 'PURCHASE_RECEIPT', id: f.id, partyType: 'SUPPLIER', partyId: f.supplierId, dir: 'OUT' });
    const customers = await this.prisma.db.customer.findMany({ select: { id: true, code: true } });
    const cByCode = new Map(customers.map((c) => [c.code.toLowerCase(), c.id]));
    const suppliers = await this.prisma.db.supplier.findMany({ select: { id: true, code: true } });
    const sByCode = new Map(suppliers.map((s) => [s.code.toLowerCase(), s.id]));
    const users = await this.prisma.db.user.findMany({ select: { id: true, fullName: true, username: true } });
    const userOf = (name: string) => users.find((u) => u.fullName.toLowerCase() === name.toLowerCase() || u.username.toLowerCase() === name.toLowerCase())?.id ?? user.id;
    type Pending = { data: Prisma.PaymentCreateManyInput; alloc: { documentType: string; documentId: string; amount: Prisma.Decimal } | null };
    const pending: Pending[] = [];
    const flush = async () => {
      if (!pending.length) return;
      const batch = pending.splice(0, pending.length);
      const created = await this.prisma.db.payment.createManyAndReturn({ data: batch.map((p) => p.data), select: { id: true, code: true } });
      const idByCode = new Map(created.map((c) => [c.code, c.id]));
      const allocs = batch.filter((p) => p.alloc && idByCode.has(p.data.code)).map((p) => ({ tenantId: user.tenantId, paymentId: idByCode.get(p.data.code)!, documentType: p.alloc!.documentType, documentId: p.alloc!.documentId, amount: p.alloc!.amount }));
      if (allocs.length) await this.prisma.db.paymentAllocation.createMany({ data: allocs });
      totals.created += created.length; totals.linked! += allocs.length;
    };
    const seen = new Set<string>();
    for (const r of valid) {
      const code = get(r, 'code'); const row = Number(r.__row);
      try {
        if (existing.has(code) || seen.has(code)) { totals.skipped++; continue; }
        const date = parseDate(get(r, 'date')) ?? new Date();
        if (since && date < since) { totals.skipped++; continue; }
        const raw = parseNumber(get(r, 'amount'));
        if (raw === null) throw new Error(`Số tiền không hợp lệ: ${get(r, 'amount')}`);
        const kindN = normalize(get(r, 'kind'));
        const direction: 'IN' | 'OUT' = /^(phieu )?chi|^tra |^hoan/.test(kindN) ? 'OUT' : /^(phieu )?thu/.test(kindN) ? 'IN' : D(raw).isNegative() ? 'OUT' : 'IN';
        const amount = money(D(raw).abs());
        if (amount.isZero()) { totals.skipped++; continue; }
        const statusN = normalize(get(r, 'status'));
        const status: 'POSTED' | 'CANCELLED' = /huy|cancel|^1$|^2$/.test(statusN) && !/da thanh toan|hoan thanh|^0$/.test(statusN) ? 'CANCELLED' : 'POSTED';
        const branchId = branchOf(get(r, 'branch'));
        if (!branchId) throw new Error('Không xác định được chi nhánh');
        const method = methodOf(get(r, 'method'));
        const ref = (get(r, 'document') ? safeCode(get(r, 'document')) : docRef(code))?.toLowerCase();
        const doc = ref ? docs.get(ref) : undefined;
        const alloc = doc && doc.dir === direction ? { documentType: doc.type, documentId: doc.id, amount } : null;
        const pt = normalize(get(r, 'partyType')); const pc = safeCode(get(r, 'partyCode')).toLowerCase();
        let partyType: 'CUSTOMER' | 'SUPPLIER' | null = null; let partyId: string | null = null;
        if (pc && /^s|ncc|nha cung cap|supplier/.test(pt) && sByCode.has(pc)) { partyType = 'SUPPLIER'; partyId = sByCode.get(pc)!; }
        else if (pc && cByCode.has(pc)) { partyType = 'CUSTOMER'; partyId = cByCode.get(pc)!; }
        else if (pc && sByCode.has(pc)) { partyType = 'SUPPLIER'; partyId = sByCode.get(pc)!; }
        else if (doc?.partyId) { partyType = doc.partyType; partyId = doc.partyId; }
        const categoryId = alloc ? null : await categoryOf(direction, get(r, 'kind'));
        const note = ['Nhập từ KiotViet', !partyId && get(r, 'partyName') ? get(r, 'partyName') : '', get(r, 'note')].filter(Boolean).join(' · ').slice(0, 1000);
        seen.add(code);
        if (status === 'CANCELLED') totals.cancelled!++;
        pending.push({ data: { tenantId: user.tenantId, branchId, code: `KV-${code}`, direction, method, partyType, partyId, cashAccountId: accountFor(branchId, method), categoryId, amount, allocated: alloc ? amount : ZERO, paymentDate: date, note, status, cancelledAt: status === 'CANCELLED' ? date : null, cancelReason: status === 'CANCELLED' ? 'Đã hủy ở KiotViet' : null, createdById: userOf(get(r, 'creator')) }, alloc: status === 'POSTED' ? alloc : null });
        if (pending.length >= 500) await flush();
      } catch (e) { totals.failed++; errors.push({ row, code, error: err(e) }); }
    }
    await flush();
    return { totals, errors };
  }

  // ---------------------------------------------------------------- lịch sử kiểm kho (KiotViet Kho hàng → Kiểm kho; phiếu đã cân bằng không ghi kho lại)
  /**
   * Mỗi phiếu kiểm KiotViet thành phiếu kiểm kho mã KV-<mã> ở kho theo tên chi nhánh / kho (`warehouseMap`, kho cùng tên, rồi kho mặc định của chi
   * nhánh). "Đã cân bằng" → COMPLETED với tồn hệ thống / thực tế / lệch / giá vốn đúng như KiotViet lúc đó, KHÔNG ghi biến động kho (tồn đã lấy theo
   * số hiện tại); "Đã hủy" → CANCELLED; "Phiếu tạm" → DRAFT với tồn hệ thống = tồn hiện tại ở đây để hoàn tất sau sẽ cân bằng kho như phiếu thường.
   * Dòng khớp theo mã hàng (sku / mã hàng hóa / mã ĐVT quy đổi → quy về đơn vị gốc); mã không còn trong danh mục → hàng giữ chỗ. Chạy lại bỏ qua mã
   * đã có, phiếu còn DRAFT mà KiotViet đã cân bằng / hủy thì đổi trạng thái (không động kho).
   */
  async importStocktakes(user: RequestUser, rows: RawRow[], mapping: Record<string, string>, options: ImportOptions) {
    const get = (r: RawRow, f: string) => (mapping[f] ? (r[mapping[f]] ?? '').trim() : '');
    const totals: Totals = { rows: rows.length, created: 0, updated: 0, skipped: 0, failed: 0, open: 0, items: 0 };
    const errors: RowError[] = [];
    const branches = await this.prisma.db.branch.findMany({ select: { id: true, name: true, code: true } });
    const defaultBranchId = options.defaultBranchId ?? (branches.find((b) => (user.branchIds ?? []).includes(b.id))?.id ?? branches[0]?.id);
    const branchOf = (name: string) => options.branchMap?.[name] ?? branches.find((b) => b.name.toLowerCase() === name.toLowerCase() || b.code.toLowerCase() === name.toLowerCase())?.id ?? defaultBranchId;
    const warehouses = await this.prisma.db.warehouse.findMany({ select: { id: true, branchId: true, name: true, code: true, isDefault: true } });
    const warehouseOf = (name: string) => {
      const mapped = options.warehouseMap?.[name];
      if (mapped) return warehouses.find((w) => w.id === mapped);
      const byName = name ? warehouses.find((w) => w.name.toLowerCase() === name.toLowerCase() || w.code.toLowerCase() === name.toLowerCase()) : undefined;
      if (byName) return byName;
      const branchId = branchOf(name);
      return warehouses.find((w) => w.branchId === branchId && w.isDefault) ?? warehouses.find((w) => w.branchId === branchId);
    };
    const since = options.invoicesFrom ? new Date(options.invoicesFrom) : null;
    const groups = new Map<string, RawRow[]>();
    for (const r of rows) { const c = get(r, 'code'); if (!c) { totals.skipped++; continue; } (groups.get(c) ?? groups.set(c, []).get(c)!).push(r); }
    const codes = Array.from(groups.values()).flatMap((g) => g.map((r) => safeCode(get(r, 'lineCode')).toLowerCase()).filter(Boolean));
    const { vByCode, uByCode } = await this.resolveLineCodes(codes);
    if (options.createMissingProducts !== false) await this.createPlaceholderProducts(user, groups, get, vByCode, uByCode, totals, errors, 'Tạo tự động khi nhập lịch sử kiểm kho KiotViet (mã không còn trong danh mục)');
    const groupCodes = Array.from(groups.keys());
    const existing = new Map<string, { id: string; status: string }>();
    for (let i = 0; i < groupCodes.length; i += 5000) {
      const found = await this.prisma.db.stocktake.findMany({ where: { code: { in: groupCodes.slice(i, i + 5000).map((c) => `KV-${c}`) } }, select: { id: true, code: true, status: true } });
      for (const f of found) existing.set(f.code.slice(3), { id: f.id, status: f.status });
    }
    const users = await this.prisma.db.user.findMany({ select: { id: true, fullName: true, username: true } });
    const userOf = (name: string) => users.find((u) => u.fullName.toLowerCase() === name.toLowerCase() || u.username.toLowerCase() === name.toLowerCase())?.id ?? user.id;
    const statusOf = (raw: string): 'DRAFT' | 'COMPLETED' | 'CANCELLED' => { const n = normalize(raw); return n.includes('huy') || n === 'cancelled' ? 'CANCELLED' : n.includes('can bang') || n.includes('hoan thanh') || n === 'completed' ? 'COMPLETED' : 'DRAFT'; };
    type Line = { variantId: string; systemQuantity: Prisma.Decimal; countedQuantity: Prisma.Decimal | null; deltaQuantity: Prisma.Decimal; unitCost: Prisma.Decimal; deltaValue: Prisma.Decimal; note: string | null };
    const buildLines = async (g: RawRow[], status: 'DRAFT' | 'COMPLETED' | 'CANCELLED', warehouseId: string): Promise<Line[]> => {
      const out = new Map<string, Line>();
      const lines = g.filter((r) => get(r, 'lineCode') || get(r, 'lineName'));
      const onHand = new Map<string, Prisma.Decimal>();
      if (status === 'DRAFT') {
        const ids = Array.from(new Set(lines.map((r) => { const lc = safeCode(get(r, 'lineCode')).toLowerCase(); return (uByCode.get(lc)?.variant ?? vByCode.get(lc))?.id; }).filter((x): x is string => !!x)));
        for (const b of await this.prisma.db.stockBalance.findMany({ where: { warehouseId, variantId: { in: ids }, batchKey: '' }, select: { variantId: true, onHand: true } })) onHand.set(b.variantId, D(b.onHand));
      }
      lines.forEach((r, i) => {
        const lc = safeCode(get(r, 'lineCode')).toLowerCase();
        const unit = uByCode.get(lc);
        const v = unit?.variant ?? vByCode.get(lc);
        if (!v) throw new Error(`Dòng ${r.__row ?? i + 1}: không tìm thấy hàng ${get(r, 'lineCode') || get(r, 'lineName')} (nhập hàng hóa trước)`);
        const factor = unit?.factor ?? D(1);
        const sysRaw = parseNumber(get(r, 'lineSystem')); const actRaw = parseNumber(get(r, 'lineActual')); const deltaRaw = parseNumber(get(r, 'lineDelta'));
        const system = status === 'DRAFT' ? (onHand.get(v.id) ?? ZERO) : toQty(D(sysRaw ?? '0').times(factor));
        const countedRaw = actRaw !== null ? toQty(D(actRaw).times(factor)) : deltaRaw !== null && sysRaw !== null ? toQty(D(sysRaw).plus(D(deltaRaw)).times(factor)) : null;
        // KiotViet cho phép "thực tế" âm; ở đây số đếm không âm → ghi 0 và giữ số gốc trong ghi chú dòng
        const counted = countedRaw !== null && countedRaw.isNegative() ? ZERO : countedRaw;
        const delta = counted !== null ? toQty(counted.minus(system)) : ZERO;
        const costRaw = parseNumber(get(r, 'lineCost'));
        const unitCost = money(costRaw !== null && factor.eq(1) ? D(costRaw) : D(v.costPrice));
        const note = [unit?.unitName ? `ĐVT ${unit.unitName}` : '', countedRaw !== null && countedRaw.isNegative() ? `KiotViet thực tế ${countedRaw.toString()}` : ''].filter(Boolean).join(' · ') || null;
        const prev = out.get(v.id);
        if (prev) { // cùng biến thể xuất hiện nhiều dòng (mã ĐVT khác nhau) → gộp
          const c2 = prev.countedQuantity !== null || counted !== null ? toQty(D(prev.countedQuantity ?? 0).plus(counted ?? ZERO)) : null;
          const s2 = status === 'DRAFT' ? prev.systemQuantity : toQty(prev.systemQuantity.plus(system));
          const d2 = c2 !== null ? toQty(c2.minus(s2)) : ZERO;
          out.set(v.id, { ...prev, systemQuantity: s2, countedQuantity: c2, deltaQuantity: d2, deltaValue: money(d2.times(prev.unitCost)) });
        } else out.set(v.id, { variantId: v.id, systemQuantity: system, countedQuantity: counted, deltaQuantity: delta, unitCost, deltaValue: money(delta.times(unitCost)), note });
      });
      return Array.from(out.values());
    };
    const sums = (lines: Line[]) => lines.reduce((s, l) => { if (l.deltaQuantity.isNegative()) { s.decQ = s.decQ.plus(l.deltaQuantity.abs()); s.decV = s.decV.plus(l.deltaValue.abs()); } else { s.incQ = s.incQ.plus(l.deltaQuantity); s.incV = s.incV.plus(l.deltaValue); } return s; }, { incQ: ZERO, decQ: ZERO, incV: ZERO, decV: ZERO });
    for (const [code, g] of groups) {
      const head = g[0]; const row = Number(head.__row);
      try {
        const date = parseDate(get(head, 'date')) ?? parseDate(get(head, 'createdAt')) ?? new Date();
        if (since && date < since) { totals.skipped++; continue; }
        const status = statusOf(get(head, 'status'));
        const prev = existing.get(code);
        const wh = warehouseOf(get(head, 'branch'));
        if (!wh) throw new Error('Không xác định được kho');
        this.access.assertBranch(user, wh.branchId);
        if (prev) {
          if (prev.status === 'DRAFT' && status !== 'DRAFT') {
            const lines = status === 'COMPLETED' ? await buildLines(g, status, wh.id) : [];
            await this.prisma.tx(async (tx) => {
              if (status === 'COMPLETED') {
                const byVariant = new Map(lines.map((l) => [l.variantId, l]));
                for (const l of await tx.stocktakeLine.findMany({ where: { stocktakeId: prev.id }, select: { id: true, variantId: true } })) {
                  const n = byVariant.get(l.variantId);
                  if (n) await tx.stocktakeLine.update({ where: { id: l.id }, data: { systemQuantity: n.systemQuantity, countedQuantity: n.countedQuantity, deltaQuantity: n.deltaQuantity, unitCost: n.unitCost, deltaValue: n.deltaValue, countedById: userOf(get(head, 'balancer') || get(head, 'creator')), countedAt: date } });
                }
                const s = sums(lines);
                await tx.stocktake.update({ where: { id: prev.id }, data: { status, completedAt: date, completedById: userOf(get(head, 'balancer') || get(head, 'creator')), uncountedAs: 'SKIP', increaseQuantity: s.incQ, decreaseQuantity: s.decQ, increaseValue: s.incV, decreaseValue: s.decV, countedLines: lines.filter((l) => l.countedQuantity !== null).length, version: { increment: 1 } } });
              } else await tx.stocktake.update({ where: { id: prev.id }, data: { status, cancelledAt: date, cancelledById: user.id, cancelReason: 'Đã hủy ở KiotViet', version: { increment: 1 } } });
            });
            totals.updated++;
          } else totals.skipped++;
          continue;
        }
        const lines = await buildLines(g, status, wh.id);
        if (!lines.length) throw new Error('Phiếu không có dòng hàng');
        const s = sums(lines);
        const by = userOf(get(head, 'creator') || get(head, 'balancer'));
        const doneBy = userOf(get(head, 'balancer') || get(head, 'creator'));
        await this.prisma.db.stocktake.create({ data: { tenantId: user.tenantId, branchId: wh.branchId, warehouseId: wh.id, code: `KV-${code}`, status, scope: 'SELECTED', note: ['Nhập từ KiotViet', get(head, 'note')].filter(Boolean).join(' · ').slice(0, 1000), snapshotAt: date, totalLines: lines.length, countedLines: lines.filter((l) => l.countedQuantity !== null).length, increaseQuantity: status === 'COMPLETED' ? s.incQ : ZERO, decreaseQuantity: status === 'COMPLETED' ? s.decQ : ZERO, increaseValue: status === 'COMPLETED' ? s.incV : ZERO, decreaseValue: status === 'COMPLETED' ? s.decV : ZERO, uncountedAs: status === 'COMPLETED' ? 'SKIP' : null, completedAt: status === 'COMPLETED' ? date : null, completedById: status === 'COMPLETED' ? doneBy : null, cancelledAt: status === 'CANCELLED' ? date : null, cancelledById: status === 'CANCELLED' ? doneBy : null, cancelReason: status === 'CANCELLED' ? 'Đã hủy ở KiotViet' : null, createdById: by, createdAt: date, lines: { create: lines.map((l) => ({ tenantId: user.tenantId, ...l, countedById: l.countedQuantity !== null ? doneBy : null, countedAt: l.countedQuantity !== null ? date : null })) } } });
        totals.items! += lines.length;
        if (status === 'DRAFT') totals.open!++;
        totals.created++;
      } catch (e) { totals.failed++; errors.push({ row, code, error: err(e) }); }
    }
    return { totals, errors };
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
    const { vByCode, uByCode } = await this.resolveLineCodes(codes);
    // hóa đơn cũ có mã hàng không còn trong danh mục (đã xóa / ngừng bán ở KiotViet) → tạo hàng "ngừng kinh doanh" giữ chỗ để lịch sử đủ dòng
    if (options.createMissingProducts !== false) await this.createPlaceholderProducts(user, groups, get, vByCode, uByCode, totals, errors, 'Tạo tự động khi nhập lịch sử hóa đơn KiotViet (mã không còn trong danh mục)');
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
          if (!v) throw new Error(`Dòng ${r.__row ?? i + 1}: không tìm thấy hàng ${get(r, 'lineCode') || get(r, 'lineName')} (nhập hàng hóa trước)`);
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

  // ---------------------------------------------------------------- lịch sử trả hàng (KiotViet Giao dịch → Trả hàng; không động kho / sổ quỹ / công nợ)
  /**
   * Mỗi phiếu trả gắn vào hóa đơn gốc theo mã KiotViet (external_ref của hóa đơn đã nhập) hoặc mã hóa đơn trong hệ thống;
   * dòng trả khớp dòng hóa đơn theo biến thể (ưu tiên cùng đơn vị và còn số lượng chưa trả). Phiếu hoàn thành cộng vào
   * số lượng / tiền đã trả của hóa đơn để số còn được trả đúng như KiotViet. Mã phiếu = KV-<mã KiotViet>, chạy lại bỏ qua mã đã có.
   */
  async importReturns(user: RequestUser, rows: RawRow[], mapping: Record<string, string>, options: ImportOptions) {
    const get = (r: RawRow, f: string) => (mapping[f] ? (r[mapping[f]] ?? '').trim() : '');
    const totals: Totals = { rows: rows.length, created: 0, updated: 0, skipped: 0, failed: 0, missingInvoices: 0 };
    const errors: RowError[] = [];
    const branches = await this.prisma.db.branch.findMany({ select: { id: true, name: true, code: true } });
    const branchOf = (name: string) => (name ? options.branchMap?.[name] ?? branches.find((b) => b.name.toLowerCase() === name.toLowerCase() || b.code.toLowerCase() === name.toLowerCase())?.id : undefined);
    const since = options.invoicesFrom ? new Date(options.invoicesFrom) : null;
    const groups = new Map<string, RawRow[]>();
    for (const r of rows) { const c = safeCode(get(r, 'code')); if (!c) { totals.skipped++; continue; } (groups.get(c) ?? groups.set(c, []).get(c)!).push(r); }
    const invoiceCodes = Array.from(new Set(Array.from(groups.values()).map((g) => safeCode(get(g[0], 'invoiceCode'))).filter(Boolean)));
    type InvLine = { id: string; variantId: string; unitName: string | null; quantity: Prisma.Decimal; returnedQuantity: Prisma.Decimal; unitPrice: Prisma.Decimal; lineTotal: Prisma.Decimal; unitCost: Prisma.Decimal; variant: { productId: string } };
    type Inv = { id: string; code: string; externalRef: string | null; branchId: string; warehouseId: string; customerId: string | null; totalAmount: Prisma.Decimal; returnedAmount: Prisma.Decimal; lines: InvLine[] };
    const invByCode = new Map<string, Inv>();
    for (let i = 0; i < invoiceCodes.length; i += 2000) {
      const chunk = invoiceCodes.slice(i, i + 2000);
      const found: Inv[] = await this.prisma.db.invoice.findMany({ where: { OR: [{ externalRef: { in: chunk } }, { code: { in: chunk, mode: 'insensitive' } }, { code: { in: chunk.map((c) => `KV-${c}`) } }] }, select: { id: true, code: true, externalRef: true, branchId: true, warehouseId: true, customerId: true, totalAmount: true, returnedAmount: true, lines: { orderBy: { lineNo: 'asc' }, select: { id: true, variantId: true, unitName: true, quantity: true, returnedQuantity: true, unitPrice: true, lineTotal: true, unitCost: true, variant: { select: { productId: true } } } } } });
      for (const inv of found) { if (inv.externalRef) invByCode.set(inv.externalRef.toLowerCase(), inv); invByCode.set(inv.code.toLowerCase(), inv); if (inv.code.startsWith('KV-')) invByCode.set(inv.code.slice(3).toLowerCase(), inv); }
    }
    const codes = Array.from(groups.values()).flatMap((g) => g.map((r) => safeCode(get(r, 'lineCode')).toLowerCase()).filter(Boolean));
    const { vByCode, uByCode } = await this.resolveLineCodes(codes);
    // phiếu đã nhập ở lần trước (mã KV-…) → bỏ qua
    const kvCodes = Array.from(groups.keys()).map((c) => `KV-${c}`);
    const already = new Set<string>();
    for (let i = 0; i < kvCodes.length; i += 5000) {
      const found = await this.prisma.db.salesReturn.findMany({ where: { code: { in: kvCodes.slice(i, i + 5000) } }, select: { code: true } });
      for (const f of found) already.add(f.code);
    }
    const customers = mapping.customerCode ? await this.prisma.db.customer.findMany({ select: { id: true, code: true } }) : [];
    const cByCode = new Map(customers.map((c) => [c.code.toLowerCase(), c]));
    const warehouses = await this.prisma.db.warehouse.findMany({ select: { id: true, branchId: true, isDefault: true } });
    const methodLabel = (raw: string) => { const m = normalize(raw); if (!m) return ''; if (m.includes('tien mat') || m === 'cash') return 'Tiền mặt'; if (m.includes('chuyen khoan') || m.includes('bank')) return 'Chuyển khoản'; if (m.includes('the') || m === 'card') return 'Thẻ'; if (m.includes('vi') || m.includes('wallet')) return 'Ví'; return raw; };
    for (const [code, g] of groups) {
      const head = g[0]; const row = Number(head.__row);
      const kvCode = `KV-${code}`;
      try {
        if (already.has(kvCode)) { totals.skipped++; continue; }
        const date = parseDate(get(head, 'date')) ?? new Date();
        if (since && date < since) { totals.skipped++; continue; }
        const invCode = safeCode(get(head, 'invoiceCode'));
        const inv = invCode ? invByCode.get(invCode.toLowerCase()) : undefined;
        if (!inv) { totals.missingInvoices = (totals.missingInvoices ?? 0) + 1; throw new Error(invCode ? `Không tìm thấy hóa đơn ${invCode} (nhập lịch sử hóa đơn trước)` : 'Phiếu trả không có mã hóa đơn'); }
        const branchId = branchOf(get(head, 'branch')) ?? inv.branchId;
        this.access.assertBranch(user, branchId);
        const warehouseId = branchId === inv.branchId ? inv.warehouseId : (warehouses.find((w) => w.branchId === branchId && w.isDefault) ?? warehouses.find((w) => w.branchId === branchId))?.id ?? inv.warehouseId;
        const statusRaw = normalize(get(head, 'status'));
        const status: 'COMPLETED' | 'CANCELLED' = statusRaw.includes('huy') || statusRaw === 'cancelled' ? 'CANCELLED' : 'COMPLETED';
        const customerId = (get(head, 'customerCode') ? cByCode.get(safeCode(get(head, 'customerCode')).toLowerCase())?.id : undefined) ?? inv.customerId;
        // dòng trả → dòng hóa đơn cùng biến thể: ưu tiên cùng đơn vị và còn đủ số lượng chưa trả
        const used = new Map<string, Prisma.Decimal>();
        const remaining = (l: InvLine) => D(l.quantity).minus(D(l.returnedQuantity)).minus(used.get(l.id) ?? ZERO);
        const lines = g.filter((r) => get(r, 'lineCode') || get(r, 'lineName')).map((r, i) => {
          const lc = safeCode(get(r, 'lineCode')).toLowerCase();
          const unit = uByCode.get(lc);
          const v = unit?.variant ?? vByCode.get(lc);
          const quantity = toQty(parseNumber(get(r, 'lineQty')) ?? '1');
          const factor = unit?.factor ?? D(1);
          const wantUnit = unit?.unitName ?? v?.product.baseUnit ?? null;
          const rowNo = r.__row ?? i + 1;
          let candidates = v ? inv.lines.filter((l) => l.variantId === v.id) : [];
          // cùng hàng hóa nhưng khác biến thể (mã hàng trỏ tới biến thể khác của cùng sản phẩm)
          if (!candidates.length && v) candidates = inv.lines.filter((l) => l.variant.productId === v.productId && remaining(l).gte(quantity));
          // mã không còn trong danh mục, mã ĐVT quy đổi hoặc hàng giữ chỗ đã sửa lại sang hàng gốc → dòng hóa đơn mang biến thể khác:
          // khớp theo giá bán (đơn giá hoặc giá sau giảm = thành tiền / SL) còn số lượng chưa trả, hoặc hóa đơn chỉ có một dòng; dòng trả mang biến thể của dòng hóa đơn
          if (!candidates.length) {
            const price = parseNumber(get(r, 'linePrice'));
            const effective = (l: InvLine) => (D(l.quantity).gt(0) ? money(D(l.lineTotal).div(D(l.quantity))) : D(l.unitPrice));
            candidates = price !== null ? inv.lines.filter((l) => (D(l.unitPrice).eq(money(price)) || effective(l).eq(money(price))) && remaining(l).gte(quantity)) : [];
            if (!candidates.length && inv.lines.length === 1) candidates = inv.lines;
          }
          if (!candidates.length) throw new Error(v ? `Dòng ${rowNo}: hàng ${get(r, 'lineCode')} không có trong hóa đơn ${invCode}` : `Dòng ${rowNo}: không tìm thấy hàng ${get(r, 'lineCode') || get(r, 'lineName')} và không khớp được dòng nào của hóa đơn ${invCode}`);
          const sameUnit = (l: InvLine) => (l.unitName ?? '') === (wantUnit ?? '');
          const il = candidates.find((l) => sameUnit(l) && remaining(l).gte(quantity)) ?? candidates.find((l) => remaining(l).gte(quantity)) ?? candidates.find(sameUnit) ?? candidates[0];
          const unitName = wantUnit ?? il.unitName ?? null;
          used.set(il.id, (used.get(il.id) ?? ZERO).plus(quantity));
          const unitPrice = money(parseNumber(get(r, 'linePrice')) ?? il.unitPrice.toString());
          const discount = money(parseNumber(get(r, 'lineDiscount')) ?? '0');
          const lineTotal = parseNumber(get(r, 'lineTotal')) !== null ? money(parseNumber(get(r, 'lineTotal'))!) : money(quantity.times(unitPrice).minus(discount));
          const unitCost = money(D(il.unitCost));
          return { lineNo: i + 1, invoiceLineId: il.id, variantId: il.variantId, unitName, conversionFactor: factor, quantity, baseQuantity: toQty(quantity.times(factor)), unitPrice, lineTotal, condition: 'RESTOCK' as const, unitCost, costTotal: money(quantity.times(unitCost)) };
        });
        if (!lines.length) throw new Error('Phiếu trả không có dòng hàng');
        const subtotal = parseNumber(get(head, 'subtotal')) !== null ? money(parseNumber(get(head, 'subtotal'))!) : lines.reduce((s, l) => s.plus(l.lineTotal), ZERO);
        const fee = money(parseNumber(get(head, 'fee')) ?? '0').plus(money(parseNumber(get(head, 'discount')) ?? '0'));
        const totalRefund = parseNumber(get(head, 'total')) !== null ? money(parseNumber(get(head, 'total'))!) : Prisma.Decimal.max(subtotal.minus(fee), ZERO);
        const paid = money(parseNumber(get(head, 'paid')) ?? totalRefund.toString());
        const restockValue = lines.reduce((s, l) => s.plus(l.costTotal), ZERO);
        await this.prisma.tx(async (tx) => {
          if (await tx.salesReturn.findFirst({ where: { code: kvCode } })) throw new Error(`Mã ${kvCode} đã tồn tại`);
          await tx.salesReturn.create({ data: { tenantId: user.tenantId, branchId, warehouseId, invoiceId: inv.id, customerId, code: kvCode, status, returnDate: date, completedAt: status === 'COMPLETED' ? date : null, cancelledAt: status === 'CANCELLED' ? date : null, reason: get(head, 'reason').slice(0, 200) || null, note: ['Nhập từ KiotViet', methodLabel(get(head, 'method')), get(head, 'note')].filter(Boolean).join(' · ').slice(0, 1000), subtotal, feeAmount: fee, totalRefund, refundedAmount: Prisma.Decimal.min(paid, totalRefund), restockValue, damagedValue: ZERO, createdById: user.id, lines: { create: lines.map((l) => ({ tenantId: user.tenantId, ...l })) } } });
          if (status === 'COMPLETED') {
            for (const [ilId, q] of used) {
              const il = inv.lines.find((l) => l.id === ilId)!;
              const inc = Prisma.Decimal.min(q, Prisma.Decimal.max(D(il.quantity).minus(D(il.returnedQuantity)), ZERO));
              if (inc.gt(0)) { await tx.invoiceLine.update({ where: { id: ilId }, data: { returnedQuantity: { increment: inc } } }); il.returnedQuantity = D(il.returnedQuantity).plus(inc); }
            }
            // KiotViet cho trả vượt tiền hóa đơn (hóa đơn đổi hàng HDD_…) → chỉ cộng tới mức tổng hóa đơn (ràng buộc invoices_returned_range)
            const incAmt = Prisma.Decimal.min(totalRefund, Prisma.Decimal.max(D(inv.totalAmount).minus(D(inv.returnedAmount)), ZERO));
            if (incAmt.gt(0)) { await tx.invoice.update({ where: { id: inv.id }, data: { returnedAmount: { increment: incAmt } } }); inv.returnedAmount = D(inv.returnedAmount).plus(incAmt); }
          }
        });
        totals.created++;
      } catch (e) { totals.failed++; errors.push({ row, code, error: err(e) }); }
    }
    return { totals, errors };
  }

  // ---------------------------------------------------------------- reconciliation snapshot (compare with KiotViet)
  // ---------------------------------------------------------------- bảng giá (Thiết lập giá KiotViet)
  /**
   * Mỗi cột giá trong file = một bảng giá (tiêu đề cột = tên bảng giá); giá theo biến thể (mã hàng = sku, hoặc mã hàng hóa
   * khi hàng chỉ có một biến thể). Chạy lại = thay toàn bộ giá của bảng giá đó theo file (ảnh chụp giá tại thời điểm xuất –
   * bảng giá "tự tính theo %" của KiotViet được lưu thành giá cụ thể). Mã đơn vị quy đổi không có giá riêng → bỏ qua.
   */
  async importPriceBooks(user: RequestUser, rows: RawRow[], mapping: Record<string, string>, options: ImportOptions) {
    const get = (r: RawRow, f: string) => (mapping[f] ? (r[mapping[f]] ?? '').trim() : '');
    const totals: Totals = { rows: rows.length, created: 0, updated: 0, skipped: 0, failed: 0, priceBooks: 0, items: 0, unknownCodes: 0, unitCodes: 0 };
    const errors: RowError[] = [];
    const mapped = new Set(Object.values(mapping));
    const headerSet = new Set<string>();
    for (const r of rows) for (const k of Object.keys(r)) if (k !== '__row') headerSet.add(k);
    const notPrice = /^(gia von|gia nhap cuoi|gia nhap|gia ban|bang gia chung|gia chung|ton kho|ton|so luong|dvt|don vi tinh|don vi|nhom hang|ma vach|thuong hieu|loai hang|trang thai|stt)$/;
    const cols = options.priceBookColumns?.length ? options.priceBookColumns.filter((c) => headerSet.has(c)) : Array.from(headerSet).filter((h) => !mapped.has(h) && !notPrice.test(normalize(h)));
    if (!cols.length) throw Errors.validation('Không có cột bảng giá nào: mỗi bảng giá là một cột giá với tiêu đề là tên bảng giá (ví dụ "Bảng giá CTV")');
    // mã hàng → biến thể: theo sku, hoặc mã hàng hóa khi hàng chỉ có một biến thể
    const codes = Array.from(new Set(rows.map((r) => safeCode(get(r, 'code')).toLowerCase()).filter(Boolean)));
    const vByCode = new Map<string, { id: string; sellPrice: Prisma.Decimal }>();
    for (let i = 0; i < codes.length; i += 2000) {
      const part = codes.slice(i, i + 2000);
      const variants = await this.prisma.db.productVariant.findMany({ where: { deletedAt: null, OR: [{ sku: { in: part, mode: 'insensitive' } }, { product: { code: { in: part, mode: 'insensitive' } } }] }, select: { id: true, sku: true, sellPrice: true, product: { select: { code: true, variants: { where: { deletedAt: null }, select: { id: true } } } } } });
      for (const v of variants) { if (v.sku) vByCode.set(v.sku.toLowerCase(), v); if (v.product.variants.length === 1) vByCode.set(v.product.code.toLowerCase(), v); }
    }
    // mã không khớp biến thể: mã đơn vị quy đổi (ĐVT có mã riêng / alias KiotViet) thì bỏ qua lặng lẽ, còn lại báo lỗi
    const unmatched = codes.filter((c) => !vByCode.has(c));
    const unitCodes = new Set<string>();
    for (let i = 0; i < unmatched.length; i += 2000) {
      const part = unmatched.slice(i, i + 2000);
      (await this.prisma.db.productUnit.findMany({ where: { OR: [{ sku: { in: part, mode: 'insensitive' } }, { barcode: { in: part, mode: 'insensitive' } }] }, select: { sku: true, barcode: true } })).forEach((u) => { if (u.sku) unitCodes.add(u.sku.toLowerCase()); if (u.barcode) unitCodes.add(u.barcode.toLowerCase()); });
      (await this.prisma.db.importCodeAlias.findMany({ where: { source: 'KIOTVIET', code: { in: part } }, select: { code: true } })).forEach((a) => unitCodes.add(a.code.toLowerCase()));
    }
    const perBook = new Map<string, Map<string, string>>(cols.map((c) => [c, new Map<string, string>()]));
    const basePrices = new Map<string, string>();
    for (const r of rows) {
      const code = safeCode(get(r, 'code')); const lc = code.toLowerCase(); const row = Number(r.__row);
      if (!code) { totals.skipped++; continue; }
      const v = vByCode.get(lc);
      if (!v) {
        if (unitCodes.has(lc)) { totals.unitCodes!++; totals.skipped++; } else { totals.unknownCodes!++; totals.failed++; if (errors.length < 500) errors.push({ row, code, error: 'Không có hàng hóa mã này trong danh mục' }); }
        continue;
      }
      let any = false;
      for (const c of cols) {
        const raw = (r[c] ?? '').trim();
        if (!raw) continue;
        const n = parseNumber(raw);
        if (n === null || Number(n) < 0) { if (errors.length < 500) errors.push({ row, code, error: `Giá không hợp lệ ở cột "${c}": ${raw}` }); continue; }
        perBook.get(c)!.set(v.id, n); any = true;
      }
      if (!any) totals.skipped++;
      if (options.updateBasePrice && mapping.basePrice) { const n = parseNumber(get(r, 'basePrice')); if (n !== null && Number(n) >= 0 && !D(n).equals(D(v.sellPrice))) basePrices.set(v.id, n); }
    }
    const existing = await this.prisma.db.priceBook.findMany({ select: { id: true, code: true, name: true } });
    const usedCodes = new Set(existing.map((p) => p.code.toLowerCase()));
    const newCode = (name: string) => { const base = (normalize(name).replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '').toUpperCase().slice(0, 40) || 'BG'); let c = base; let i = 2; while (usedCodes.has(c.toLowerCase())) c = `${base}-${i++}`; usedCodes.add(c.toLowerCase()); return c; };
    for (const col of cols) {
      const name = col.trim().slice(0, 200);
      const meta = options.priceBookMeta?.[col] ?? options.priceBookMeta?.[name];
      const items = perBook.get(col)!;
      const found = existing.find((p) => p.name.toLowerCase() === name.toLowerCase());
      if (found && options.updateExisting === false) { totals.skipped++; continue; }
      await this.prisma.tx(async (tx) => {
        let pb = found;
        if (!pb) {
          pb = await tx.priceBook.create({ data: { tenantId: user.tenantId, code: newCode(name), name, status: meta?.status ?? 'ACTIVE', priority: meta?.priority ?? 0, customerGroups: meta?.customerGroups ?? [], startsAt: meta?.startsAt ? new Date(meta.startsAt) : null, endsAt: meta?.endsAt ? new Date(meta.endsAt) : null }, select: { id: true, code: true, name: true } });
          existing.push(pb); totals.created++;
        } else {
          if (meta) await tx.priceBook.update({ where: { id: pb.id }, data: { status: meta.status, priority: meta.priority, customerGroups: meta.customerGroups, startsAt: meta.startsAt ? new Date(meta.startsAt) : undefined, endsAt: meta.endsAt ? new Date(meta.endsAt) : undefined } });
          totals.updated++;
        }
        await tx.priceBookItem.deleteMany({ where: { priceBookId: pb.id } });
        const data = Array.from(items, ([variantId, price]) => ({ priceBookId: pb!.id, variantId, price: D(price) }));
        for (let i = 0; i < data.length; i += 1000) await tx.priceBookItem.createMany({ data: data.slice(i, i + 1000) });
        totals.items! += data.length; totals.priceBooks!++;
        await this.audit.log(tx, { action: 'pricebook.import', entityType: 'PriceBook', entityId: pb.id, entityCode: pb.code, after: { name: pb.name, items: data.length, source: 'KIOTVIET' } });
      });
    }
    if (basePrices.size) {
      for (const [variantId, price] of basePrices) await this.prisma.db.productVariant.update({ where: { id: variantId }, data: { sellPrice: D(price) } });
      totals.basePriceUpdated = basePrices.size;
    }
    return { totals, errors };
  }

  async reconcile(user: RequestUser) {
    const tenant = user.tenantId;
    const [products, variants, customers, suppliers, stock, debt, imported, importedRet, importedPur, importedOrd, importedCash, importedStk] = await Promise.all([
      this.prisma.db.product.count({ where: { deletedAt: null } }),
      this.prisma.db.productVariant.count({ where: { deletedAt: null } }),
      this.prisma.db.customer.count(),
      this.prisma.db.supplier.count(),
      this.prisma.raw.$queryRaw<{ qty: Prisma.Decimal; value: Prisma.Decimal; skus: bigint }[]>`SELECT COALESCE(SUM(b.on_hand),0) AS qty, COALESCE(SUM(b.on_hand * v.cost_price),0) AS value, count(DISTINCT b.variant_id) FILTER (WHERE b.on_hand <> 0)::bigint AS skus FROM stock_balances b JOIN product_variants v ON v.id = b.variant_id WHERE b.tenant_id = ${tenant}::uuid`,
      this.prisma.raw.$queryRaw<{ party_type: string; receivable: Prisma.Decimal; payable: Prisma.Decimal; parties: bigint }[]>`SELECT party_type::text AS party_type, COALESCE(SUM(balance) FILTER (WHERE balance > 0),0) AS receivable, COALESCE(SUM(-balance) FILTER (WHERE balance < 0),0) AS payable, count(*) FILTER (WHERE balance <> 0)::bigint AS parties FROM party_balances WHERE tenant_id = ${tenant}::uuid GROUP BY 1`,
      this.prisma.raw.$queryRaw<{ n: bigint; revenue: Prisma.Decimal; first: Date | null; last: Date | null }[]>`SELECT count(*)::bigint AS n, COALESCE(SUM(total_amount) FILTER (WHERE status = 'COMPLETED'),0) AS revenue, MIN(invoice_date) AS first, MAX(invoice_date) AS last FROM invoices WHERE tenant_id = ${tenant}::uuid AND imported = true`,
      this.prisma.raw.$queryRaw<{ n: bigint; refund: Prisma.Decimal; first: Date | null; last: Date | null }[]>`SELECT count(*)::bigint AS n, COALESCE(SUM(total_refund) FILTER (WHERE status = 'COMPLETED'),0) AS refund, MIN(return_date) AS first, MAX(return_date) AS last FROM sales_returns WHERE tenant_id = ${tenant}::uuid AND code LIKE 'KV-%'`,
      this.prisma.raw.$queryRaw<{ n: bigint; total: Prisma.Decimal; first: Date | null; last: Date | null }[]>`SELECT count(*)::bigint AS n, COALESCE(SUM(total_amount) FILTER (WHERE status = 'POSTED'),0) AS total, MIN(receipt_date) AS first, MAX(receipt_date) AS last FROM purchase_receipts WHERE tenant_id = ${tenant}::uuid AND code LIKE 'KV-%'`,
      this.prisma.raw.$queryRaw<{ n: bigint; total: Prisma.Decimal; open: bigint; first: Date | null; last: Date | null }[]>`SELECT count(*)::bigint AS n, COALESCE(SUM(total_amount) FILTER (WHERE status = 'COMPLETED'),0) AS total, count(*) FILTER (WHERE status IN ('DRAFT','CONFIRMED'))::bigint AS open, MIN(order_date) AS first, MAX(order_date) AS last FROM sales_orders WHERE tenant_id = ${tenant}::uuid AND code LIKE 'KV-%'`,
      this.prisma.raw.$queryRaw<{ n: bigint; income: Prisma.Decimal; expense: Prisma.Decimal; first: Date | null; last: Date | null }[]>`SELECT count(*)::bigint AS n, COALESCE(SUM(amount) FILTER (WHERE direction = 'IN' AND status = 'POSTED'),0) AS income, COALESCE(SUM(amount) FILTER (WHERE direction = 'OUT' AND status = 'POSTED'),0) AS expense, MIN(payment_date) AS first, MAX(payment_date) AS last FROM payments WHERE tenant_id = ${tenant}::uuid AND code LIKE 'KV-%'`,
      this.prisma.raw.$queryRaw<{ n: bigint; lines: bigint; open: bigint; first: Date | null; last: Date | null }[]>`SELECT count(*)::bigint AS n, COALESCE(SUM(total_lines),0)::bigint AS lines, count(*) FILTER (WHERE status = 'DRAFT')::bigint AS open, MIN(snapshot_at) AS first, MAX(snapshot_at) AS last FROM stocktakes WHERE tenant_id = ${tenant}::uuid AND code LIKE 'KV-%'`,
    ]);
    const byParty = (t: string) => debt.find((d) => d.party_type === t);
    const jobs = await this.prisma.db.importJob.findMany({ where: { status: 'DONE' }, select: { id: true, type: true, source: true, totals: true, finishedAt: true }, orderBy: { finishedAt: 'desc' }, take: 20 });
    return {
      products: { products, variants, withStock: Number(stock[0]?.skus ?? 0) },
      stock: { quantity: D(stock[0]?.qty ?? 0), value: D(stock[0]?.value ?? 0) },
      customers: { count: customers, debtors: Number(byParty('CUSTOMER')?.parties ?? 0), receivable: D(byParty('CUSTOMER')?.receivable ?? 0), credit: D(byParty('CUSTOMER')?.payable ?? 0) },
      suppliers: { count: suppliers, creditors: Number(byParty('SUPPLIER')?.parties ?? 0), payable: D(byParty('SUPPLIER')?.receivable ?? 0) },
      importedInvoices: { count: Number(imported[0]?.n ?? 0), revenue: D(imported[0]?.revenue ?? 0), first: imported[0]?.first ?? null, last: imported[0]?.last ?? null },
      importedReturns: { count: Number(importedRet[0]?.n ?? 0), refund: D(importedRet[0]?.refund ?? 0), first: importedRet[0]?.first ?? null, last: importedRet[0]?.last ?? null },
      importedPurchases: { count: Number(importedPur[0]?.n ?? 0), total: D(importedPur[0]?.total ?? 0), first: importedPur[0]?.first ?? null, last: importedPur[0]?.last ?? null },
      importedOrders: { count: Number(importedOrd[0]?.n ?? 0), total: D(importedOrd[0]?.total ?? 0), open: Number(importedOrd[0]?.open ?? 0), first: importedOrd[0]?.first ?? null, last: importedOrd[0]?.last ?? null },
      importedCash: { count: Number(importedCash[0]?.n ?? 0), income: D(importedCash[0]?.income ?? 0), expense: D(importedCash[0]?.expense ?? 0), first: importedCash[0]?.first ?? null, last: importedCash[0]?.last ?? null },
      importedStocktakes: { count: Number(importedStk[0]?.n ?? 0), lines: Number(importedStk[0]?.lines ?? 0), open: Number(importedStk[0]?.open ?? 0), first: importedStk[0]?.first ?? null, last: importedStk[0]?.last ?? null },
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
