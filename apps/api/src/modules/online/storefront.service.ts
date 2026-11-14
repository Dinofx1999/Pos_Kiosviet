import { Injectable } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { ClsService } from 'nestjs-cls';
import { AppError, Errors } from '../../common/errors/app-error';
import { D, money, ZERO } from '../../common/utils/decimal';
import { AuditService } from '../../infra/audit/audit.service';
import { CTX, RequestUser } from '../../infra/cls/request-context';
import { NumberingService } from '../../infra/numbering/numbering.service';
import { DbClient, PrismaService, TxClient } from '../../infra/prisma/prisma.service';
import { InvoiceLineDto } from '../sales/dto/sales.dto';
import { InvoicesService } from '../sales/invoices.service';
import { PlaceShopOrderDto, ShopProductsQueryDto } from './dto/online.dto';
import { ShopConfig } from './shop-config';
import { ShopSettingsService } from './shop-settings.service';

type FlashItem = Prisma.FlashSaleItemGetPayload<{ include: { flashSale: { select: { id: true; name: true; startsAt: true; endsAt: true } } } }>;
interface Store { tenantId: string; code: string; name: string; cfg: ShopConfig }

const num = (v: Prisma.Decimal | number | string | null | undefined) => (v === null || v === undefined ? 0 : Number(D(v).toFixed(0)));
const STOCK_CAP = 99;

/** Chuẩn hóa số điện thoại VN về dạng 0xxxxxxxxx; null nếu không hợp lệ. */
export function normalizePhone(raw: string | null | undefined): string | null {
  if (!raw) return null;
  let d = raw.replace(/\D/g, '');
  if (d.startsWith('84') && d.length >= 11) d = `0${d.slice(2)}`;
  return /^0\d{9,10}$/.test(d) ? d : null;
}

/** Chữ để tìm kiếm: bỏ dấu, đ → d, chữ thường, chỉ giữ chữ / số, có khoảng trắng hai đầu để so khớp đầu từ. */
export function foldText(s: string | null | undefined): string {
  return ` ${(s ?? '').normalize('NFD').replace(/[̀-ͯ]/g, '').replace(/đ/g, 'd').replace(/Đ/g, 'D').toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim()} `;
}
/** cụm từ ↔ chữ viết tắt quen dùng của cửa hàng mỹ phẩm (đã bỏ dấu) */
const SEARCH_SYNONYMS: Array<[string, string]> = [
  ['kem chong nang', 'kcn'], ['sua rua mat', 'srm'], ['tay te bao chet', 'ttbc'], ['nuoc tay trang', 'ntt'], ['bong tay trang', 'btt'], ['nuoc hoa chiet', 'nhc'], ['nuoc hoa', 'nh'],
];
/** Các cách hiểu câu tìm: mỗi cách là danh sách từ; từ viết tắt phải khớp nguyên từ, từ thường khớp đầu từ. */
export function searchAlternatives(q: string): Array<Array<{ t: string; exact: boolean }>> {
  const base = foldText(q).trim();
  if (!base) return [];
  const out = new Set<string>([base]);
  for (const [phrase, abbr] of SEARCH_SYNONYMS) {
    for (const v of Array.from(out)) {
      if (` ${v} `.includes(` ${phrase} `)) out.add(` ${v} `.replace(` ${phrase} `, ` ${abbr} `).trim());
      if (` ${v} `.includes(` ${abbr} `)) out.add(` ${v} `.replace(` ${abbr} `, ` ${phrase} `).trim());
    }
  }
  const abbrs = new Set(SEARCH_SYNONYMS.map(([, a]) => a));
  return Array.from(out).map((v) => v.split(' ').filter(Boolean).map((t) => ({ t, exact: abbrs.has(t) })));
}

/** Bỏ thẻ HTML trong mô tả hàng hóa (nhập từ KiotViet) để web hiển thị dạng chữ an toàn. */
function plainText(html: string | null): string | null {
  if (!html) return null;
  const t = html.replace(/<\s*br\s*\/?>/gi, '\n').replace(/<\/\s*(p|div|li|h\d)\s*>/gi, '\n').replace(/<[^>]+>/g, '')
    .replace(/&nbsp;/g, ' ').replace(/&amp;/g, '&').replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&quot;/g, '"').replace(/&#39;/g, "'")
    .replace(/\n{3,}/g, '\n\n').trim();
  return t || null;
}

/**
 * Web bán hàng công khai (BR-180..BR-186): danh mục, hàng hóa, Flash Sale, đặt hàng.
 * Không đăng nhập: mỗi yêu cầu xác định cửa hàng theo mã (hoặc cửa hàng mặc định) rồi đặt ngữ cảnh tenant.
 */
/** Ảnh đại diện hàng trên web (SQL, bí danh bảng `p`): ảnh hàng → ảnh đầu danh sách → combo chưa có ảnh dùng ảnh món đầu tiên có ảnh. */
const PRODUCT_IMAGE_SQL = Prisma.sql`COALESCE(NULLIF(p.image_url, ''), (SELECT pi.url FROM product_images pi WHERE pi.product_id = p.id ORDER BY pi.sort_order LIMIT 1),
  CASE WHEN p.type = 'COMBO' THEN (SELECT COALESCE(NULLIF(cv.image_url, ''), NULLIF(cp.image_url, '')) FROM combo_items ci JOIN product_variants cv ON cv.id = ci.component_variant_id JOIN products cp ON cp.id = cv.product_id
    WHERE ci.combo_product_id = p.id AND COALESCE(NULLIF(cv.image_url, ''), NULLIF(cp.image_url, '')) IS NOT NULL ORDER BY cv.name LIMIT 1) END)`;

@Injectable()
export class StorefrontService {
  constructor(
    private readonly prisma: PrismaService, private readonly cls: ClsService, private readonly settings: ShopSettingsService,
    private readonly invoices: InvoicesService, private readonly numbering: NumberingService, private readonly audit: AuditService,
  ) {}

  // ---------------------------------------------------------------- cửa hàng
  async enter(store: string, requireOpen = true): Promise<Store> {
    const code = (store ?? '').trim().toLowerCase();
    let tenantId: string | null = null;
    if (!code || code === 'default') tenantId = await this.settings.defaultTenantId();
    const tenant = tenantId
      ? await this.prisma.raw.tenant.findUnique({ where: { id: tenantId } })
      : code && code !== 'default' && /^[a-z0-9_-]{1,50}$/.test(code) ? await this.prisma.raw.tenant.findUnique({ where: { code } }) : null;
    if (!tenant || tenant.status === 'SUSPENDED' || tenant.status === 'CLOSED') throw Errors.notFound('Cửa hàng', store);
    this.cls.set(CTX.tenantId, tenant.id);
    const cfg = await this.settings.get();
    if (requireOpen && !cfg.enabled) throw new AppError('SHOP_CLOSED', 'Cửa hàng online đang tạm đóng', 404);
    return { tenantId: tenant.id, code: tenant.code, name: tenant.name, cfg };
  }

  async config(s: Store) {
    const { cfg } = s;
    const base = {
      store: s.code, enabled: cfg.enabled, shopName: cfg.shopName || s.name, hotline: cfg.hotline, zalo: cfg.zalo, facebook: cfg.facebook, address: cfg.address,
      intro: cfg.intro, bannerUrl: cfg.bannerUrl, logoUrl: cfg.logoUrl, themeColor: cfg.themeColor, serverTime: new Date().toISOString(),
    };
    if (!cfg.enabled) return base;
    return {
      ...base, showPrice: cfg.showPrice, showFlashPrice: cfg.showFlashPrice, flashSaleEnabled: cfg.flashSaleEnabled, allowOrder: cfg.allowOrder, showStock: cfg.showStock,
      categories: await this.categoryMenu(s),
      // mục Combo: tắt thì không có khối / ô / mục Combo (combo vẫn bán như hàng thường trong danh mục, tìm kiếm)
      combos: cfg.showCombos ? { ...(await this.comboGroups(s)), title: cfg.comboTitle || 'Combo ưu đãi', label: cfg.comboLabel || 'Combo', imageUrl: cfg.comboImageUrl } : null,
    };
  }

  /** Combo đang hiện trên web: tổng số + theo nhóm hàng (mục Combo, khối "Combo ưu đãi" ở trang chủ). */
  private async comboGroups(s: Store) {
    const hidden = await this.hiddenCategories(s.cfg);
    const rows = await this.prisma.raw.$queryRaw<Array<{ id: string | null; name: string | null; n: number }>>`
      SELECT p.category_id AS id, c.name, COUNT(*)::int AS n FROM products p LEFT JOIN product_categories c ON c.id = p.category_id
      WHERE ${this.visibleSql(s, hidden)} AND p.type = 'COMBO' GROUP BY p.category_id, c.name ORDER BY c.name NULLS LAST`;
    const label = (id: string, name: string) => s.cfg.webCategories.find((w) => w.id === id)?.name || name;
    return { count: rows.reduce((t, r) => t + r.n, 0), groups: rows.filter((r) => r.id && r.name).map((r) => ({ id: r.id!, name: label(r.id!, r.name!), count: r.n })) };
  }

  // ---------------------------------------------------------------- danh mục
  private async categoryTree() {
    const cats = await this.prisma.db.productCategory.findMany({ select: { id: true, name: true, parentId: true, sortOrder: true, isActive: true } });
    const children = new Map<string | null, typeof cats>();
    for (const c of cats) children.set(c.parentId, [...(children.get(c.parentId) ?? []), c]);
    const subtree = (id: string): string[] => { const out = [id]; for (let i = 0; i < out.length; i++) for (const ch of children.get(out[i]) ?? []) out.push(ch.id); return out; };
    return { cats, children, subtree };
  }

  private async hiddenCategories(cfg: ShopConfig, tree?: Awaited<ReturnType<StorefrontService['categoryTree']>>) {
    if (!cfg.hiddenCategoryIds.length) return [] as string[];
    const t = tree ?? (await this.categoryTree());
    return Array.from(new Set(cfg.hiddenCategoryIds.flatMap((id) => t.subtree(id))));
  }

  /**
   * Danh mục cấp 1 có hàng trên web (đếm cả danh mục con), kèm danh mục con có hàng. Thứ tự: theo cửa hàng sắp xếp (webCategories),
   * chưa sắp xếp thì nhiều hàng trước. Ảnh đại diện: ảnh cửa hàng chọn, không có thì hàng bán chạy còn hàng có ảnh. Đệm 5 phút.
   */
  private readonly menuCache = new Map<string, { at: number; value: unknown }>();
  private async categoryMenu(s: Store) {
    const key = JSON.stringify([s.tenantId, s.cfg]);
    const hit = this.menuCache.get(key);
    if (hit && Date.now() - hit.at < 300_000 && process.env.NODE_ENV !== 'test') return hit.value as Awaited<ReturnType<StorefrontService['categoryMenuUncached']>>;
    const value = await this.categoryMenuUncached(s);
    if (this.menuCache.size > 20) this.menuCache.clear();
    this.menuCache.set(key, { at: Date.now(), value });
    return value;
  }

  private async categoryMenuUncached(s: Store) {
    const stats = await this.categoryStats(s, true);
    const over = new Map(s.cfg.webCategories.map((w, i) => [w.id, { ...w, pos: i }]));
    // ownImage: ảnh cửa hàng tự chọn → web hiện tràn khung tròn (ảnh hàng hóa thì thu nhỏ vừa khung)
    const view = <T extends { id: string; name: string; imageUrl: string | null }>(c: T) => { const o = over.get(c.id); return { ...c, name: o?.name || c.name, imageUrl: o?.imageUrl || c.imageUrl, ownImage: !!o?.imageUrl }; };
    const pos = (id: string) => (s.cfg.customCategoryOrder ? over.get(id)?.pos ?? Number.MAX_SAFE_INTEGER : 0);
    return stats.filter((c) => c.count > 0)
      .sort((a, b) => pos(a.id) - pos(b.id) || b.count - a.count)
      .map((c) => ({ ...view(c), children: c.children.filter((ch) => ch.count > 0).map(view) }));
  }

  /** Danh mục cho màn Thiết lập web: mọi danh mục cấp 1 đang dùng (kể cả đang ẩn), số hàng hiện được và ảnh tự động. */
  async adminCategories(tenantId: string) {
    const [tenant, cfg] = await Promise.all([this.prisma.raw.tenant.findUniqueOrThrow({ where: { id: tenantId } }), this.settings.get()]);
    const s: Store = { tenantId, code: tenant.code, name: tenant.name, cfg };
    const stats = await this.categoryStats(s, false);
    return stats.map((c) => ({ id: c.id, name: c.name, count: c.count, autoImageUrl: c.imageUrl, children: c.children.length }));
  }

  /** Danh mục cấp 1 đang hoạt động (theo thứ tự của danh mục) với số hàng hiện trên web và ảnh tự động; `applyHidden` = bỏ danh mục cửa hàng ẩn. */
  private async categoryStats(s: Store, applyHidden: boolean) {
    const tree = await this.categoryTree();
    const hidden = applyHidden ? await this.hiddenCategories(s.cfg, tree) : [];
    const rows = await this.prisma.raw.$queryRaw<Array<{ category_id: string | null; n: number }>>`SELECT p.category_id, COUNT(*)::int AS n FROM products p WHERE ${this.visibleSql(s, hidden)} GROUP BY p.category_id`;
    const direct = new Map(rows.map((r) => [r.category_id, r.n]));
    const hiddenSet = new Set(hidden);
    const count = (id: string) => tree.subtree(id).filter((x) => !hiddenSet.has(x)).reduce((sum, x) => sum + (direct.get(x) ?? 0), 0);
    const byOrder = (a: { sortOrder: number; name: string }, b: { sortOrder: number; name: string }) => a.sortOrder - b.sortOrder || a.name.localeCompare(b.name, 'vi');
    // ảnh đại diện: hàng có ảnh, ưu tiên còn hàng rồi bán chạy 90 ngày, theo từng danh mục (kể cả danh mục con)
    const warehouseIds = await this.stockWarehouses(this.prisma.db, s.cfg);
    const pics = await this.prisma.raw.$queryRaw<Array<{ category_id: string; image: string; sellable: boolean; sold: Prisma.Decimal | null }>>`
      WITH vis AS (SELECT p.id, p.category_id, p.type, ${PRODUCT_IMAGE_SQL} AS image FROM products p WHERE ${this.visibleSql(s, hidden)} AND p.category_id IS NOT NULL),
      st AS (SELECT pv.product_id, SUM(GREATEST(sb.on_hand - sb.reserved, 0)) AS avail FROM stock_balances sb JOIN product_variants pv ON pv.id = sb.variant_id JOIN vis ON vis.id = pv.product_id
             WHERE sb.tenant_id = ${s.tenantId}::uuid AND sb.warehouse_id = ANY(${warehouseIds}::uuid[]) GROUP BY pv.product_id)
      SELECT vis.category_id, vis.image, (vis.type = 'COMBO' OR COALESCE(st.avail, 0) > 0) AS sellable, sold.q AS sold
      FROM vis LEFT JOIN st ON st.product_id = vis.id LEFT JOIN (${this.soldSql(s)}) sold ON sold.product_id = vis.id
      WHERE vis.image IS NOT NULL`;
    pics.sort((a, b) => Number(b.sellable) - Number(a.sellable) || Number(D(b.sold ?? 0).minus(D(a.sold ?? 0))));
    const imageOf = (id: string) => { const ids = new Set(tree.subtree(id).filter((x) => !hiddenSet.has(x))); return pics.find((p) => ids.has(p.category_id))?.image ?? null; };
    return (tree.children.get(null) ?? []).filter((c) => !hiddenSet.has(c.id) && c.isActive).sort(byOrder)
      .map((c) => ({
        id: c.id, name: c.name, count: count(c.id), imageUrl: imageOf(c.id),
        children: (tree.children.get(c.id) ?? []).filter((ch) => !hiddenSet.has(ch.id) && ch.isActive).sort(byOrder).map((ch) => ({ id: ch.id, name: ch.name, count: count(ch.id), imageUrl: imageOf(ch.id) })),
      }));
  }

  /** Số lượng đã bán 90 ngày gần nhất theo hàng hóa (hóa đơn hoàn thành) – dùng cho "Bán chạy" / "Nổi bật". */
  private soldSql(s: Store) {
    return Prisma.sql`SELECT pv.product_id, SUM(il.base_quantity) AS q FROM invoice_lines il JOIN invoices i ON i.id = il.invoice_id JOIN product_variants pv ON pv.id = il.variant_id
      WHERE i.tenant_id = ${s.tenantId}::uuid AND i.status = 'COMPLETED' AND i.invoice_date >= now() - interval '90 days' GROUP BY pv.product_id`;
  }

  /** Điều kiện hàng được hiện trên web (alias p = products). */
  private visibleSql(s: Store, hidden: string[]) {
    const conds: Prisma.Sql[] = [
      Prisma.sql`p.tenant_id = ${s.tenantId}::uuid`, Prisma.sql`p.deleted_at IS NULL`, Prisma.sql`p.is_active`, Prisma.sql`p.allow_sale`,
      Prisma.sql`p.type IN ('GOODS', 'COMBO')`, Prisma.sql`NOT p.track_batch`,
      Prisma.sql`EXISTS (SELECT 1 FROM product_variants v0 WHERE v0.product_id = p.id AND v0.deleted_at IS NULL AND v0.is_active)`,
    ];
    if (hidden.length) conds.push(Prisma.sql`(p.category_id IS NULL OR NOT (p.category_id = ANY(${hidden}::uuid[])))`);
    if (s.cfg.onlyWithImage) conds.push(Prisma.sql`(${PRODUCT_IMAGE_SQL}) IS NOT NULL`);
    return Prisma.join(conds, ' AND ');
  }

  // ---------------------------------------------------------------- tồn kho & Flash Sale
  private async destination(db: DbClient, cfg: ShopConfig) {
    if (cfg.warehouseId) {
      const w = await db.warehouse.findFirst({ where: { id: cfg.warehouseId, isActive: true }, include: { branch: { select: { isActive: true } } } });
      if (w && w.branch.isActive) return { branchId: w.branchId, warehouseId: w.id };
    }
    const b = (cfg.branchId ? await db.branch.findFirst({ where: { id: cfg.branchId, isActive: true } }) : null)
      ?? (await db.branch.findFirst({ where: { isActive: true }, orderBy: [{ isDefault: 'desc' }, { createdAt: 'asc' }] }));
    const w = b ? await db.warehouse.findFirst({ where: { branchId: b.id, isActive: true }, orderBy: [{ isDefault: 'desc' }, { createdAt: 'asc' }] }) : null;
    if (!b || !w) throw Errors.conflict('SHOP_NOT_READY', 'Cửa hàng chưa có chi nhánh / kho nhận đơn online');
    return { branchId: b.id, warehouseId: w.id };
  }

  /** BR-181: kho tính còn hàng trên web — các kho đã chọn, mặc định mọi kho đang hoạt động (cộng tồn). */
  private async stockWarehouses(db: DbClient, cfg: ShopConfig): Promise<string[]> {
    const rows = await db.warehouse.findMany({ where: { isActive: true, branch: { isActive: true }, ...(cfg.stockWarehouseIds.length ? { id: { in: cfg.stockWarehouseIds } } : {}) }, select: { id: true } });
    return rows.length ? rows.map((r) => r.id) : [(await this.destination(db, cfg)).warehouseId];
  }

  /** Số lượng có thể bán trên web theo biến thể, cộng các kho tính tồn (hàng thường: tồn − đang giữ; combo: theo thành phần). */
  private async availability(db: DbClient, warehouseIds: string[], variants: Array<{ id: string; productId: string; type: string }>) {
    const combos = variants.filter((v) => v.type === 'COMBO');
    const comboItems = combos.length ? await db.comboItem.findMany({ where: { comboProductId: { in: combos.map((c) => c.productId) } } }) : [];
    const ids = Array.from(new Set([...variants.filter((v) => v.type === 'GOODS').map((v) => v.id), ...comboItems.map((c) => c.componentVariantId)]));
    const rows = ids.length ? await db.stockBalance.groupBy({ by: ['variantId'], where: { warehouseId: { in: warehouseIds }, variantId: { in: ids } }, _sum: { onHand: true, reserved: true } }) : [];
    const base = new Map(rows.map((r) => [r.variantId, Math.max(0, Math.floor(Number(D(r._sum.onHand).minus(D(r._sum.reserved)))))]));
    const out = new Map<string, number>();
    for (const v of variants) {
      if (v.type === 'GOODS') out.set(v.id, base.get(v.id) ?? 0);
      else if (v.type === 'COMBO') {
        const parts = comboItems.filter((c) => c.comboProductId === v.productId);
        out.set(v.id, parts.length ? Math.min(...parts.map((c) => Math.floor((base.get(c.componentVariantId) ?? 0) / Math.max(Number(c.quantity), 0.001)))) : 0);
      }
    }
    return out;
  }

  private async activeFlashItems(db: DbClient, variantIds?: string[]): Promise<FlashItem[]> {
    const now = new Date();
    return db.flashSaleItem.findMany({
      where: { ...(variantIds ? { variantId: { in: variantIds } } : {}), flashSale: { isActive: true, startsAt: { lte: now }, endsAt: { gt: now } } },
      include: { flashSale: { select: { id: true, name: true, startsAt: true, endsAt: true } } }, orderBy: { sortOrder: 'asc' },
    });
  }

  /** BR-183: giá Flash Sale áp dụng = suất còn lại, giá thấp hơn giá bán; trùng nhiều chương trình lấy giá thấp nhất. */
  private pickFlash(items: FlashItem[], regular: Map<string, Prisma.Decimal>) {
    const best = new Map<string, FlashItem>();
    for (const it of items) {
      const price = regular.get(it.variantId);
      if (!price || !D(it.salePrice).lessThan(price)) continue;
      if (it.quantityLimit !== null && it.soldQuantity >= it.quantityLimit) continue;
      const cur = best.get(it.variantId);
      if (!cur || D(it.salePrice).lessThan(D(cur.salePrice))) best.set(it.variantId, it);
    }
    return best;
  }

  private flashInfo(it: FlashItem, regular: Prisma.Decimal, cfg: ShopConfig) {
    const remaining = it.quantityLimit === null ? null : Math.max(0, it.quantityLimit - it.soldQuantity);
    return {
      flashSaleId: it.flashSale.id, name: it.flashSale.name, endsAt: it.flashSale.endsAt,
      price: cfg.showFlashPrice ? num(it.salePrice) : null,
      discountPercent: regular.greaterThan(0) ? Math.max(1, Math.round((1 - Number(D(it.salePrice).div(regular))) * 100)) : 0,
      limit: it.quantityLimit, sold: it.soldQuantity, remaining, perOrderLimit: it.perOrderLimit,
    };
  }

  // ---------------------------------------------------------------- hàng hóa
  /** Danh sách hàng tính trên toàn bộ danh mục (≈0,5 s với 4.000+ hàng trên máy 1 CPU) → đệm 30 giây theo cửa hàng + bộ lọc + cấu hình. */
  private readonly listCache = new Map<string, { at: number; value: unknown }>();
  private static readonly LIST_TTL_MS = 30_000;

  async products(s: Store, q: ShopProductsQueryDto) {
    const key = JSON.stringify([s.tenantId, q.search ?? '', q.categoryId ?? '', q.sort ?? '', q.page ?? 1, q.pageSize ?? 24, q.ready ?? '', q.exclude ?? '', q.type ?? '', s.cfg]);
    const hit = this.listCache.get(key);
    if (hit && Date.now() - hit.at < StorefrontService.LIST_TTL_MS && process.env.NODE_ENV !== 'test') return hit.value as Awaited<ReturnType<StorefrontService['productsUncached']>>;
    const value = await this.productsUncached(s, q);
    if (this.listCache.size > 300) for (const [k, v] of this.listCache) if (Date.now() - v.at >= StorefrontService.LIST_TTL_MS || this.listCache.size > 300) this.listCache.delete(k);
    this.listCache.set(key, { at: Date.now(), value });
    return value;
  }

  /** Chỉ mục tìm kiếm (chữ đã bỏ dấu) của hàng hiện trên web, đệm 60 giây theo cửa hàng. */
  private readonly searchIndex = new Map<string, { at: number; rows: Array<{ id: string; text: string }> }>();
  private async searchIds(s: Store, hidden: string[], query: string): Promise<string[]> {
    const key = JSON.stringify([s.tenantId, hidden, s.cfg.onlyWithImage]);
    let idx = this.searchIndex.get(key);
    if (!idx || Date.now() - idx.at > 60_000 || process.env.NODE_ENV === 'test') {
      const rows = await this.prisma.raw.$queryRaw<Array<{ id: string; t: string | null }>>`
        SELECT p.id, concat_ws(' ', p.name, p.code, b.name,
          (SELECT string_agg(concat_ws(' ', v.sku, v.name, v.barcode), ' ') FROM product_variants v WHERE v.product_id = p.id AND v.deleted_at IS NULL)) AS t
        FROM products p LEFT JOIN brands b ON b.id = p.brand_id WHERE ${this.visibleSql(s, hidden)}`;
      idx = { at: Date.now(), rows: rows.map((r) => ({ id: r.id, text: foldText(r.t) })) };
      if (this.searchIndex.size > 20) this.searchIndex.clear();
      this.searchIndex.set(key, idx);
    }
    const alts = searchAlternatives(query);
    if (!alts.length) return [];
    return idx.rows.filter((r) => alts.some((words) => words.every((w) => r.text.includes(w.exact ? ` ${w.t} ` : ` ${w.t}`)))).map((r) => r.id);
  }

  private async productsUncached(s: Store, q: ShopProductsQueryDto) {
    const { cfg } = s;
    const page = q.page ?? 1;
    const size = q.pageSize ?? 24;
    const tree = await this.categoryTree();
    const hidden = await this.hiddenCategories(cfg, tree);
    const warehouseIds = await this.stockWarehouses(this.prisma.db, cfg);
    const conds: Prisma.Sql[] = [this.visibleSql(s, hidden)];
    if (q.categoryId) conds.push(Prisma.sql`p.category_id = ANY(${tree.subtree(q.categoryId)}::uuid[])`);
    if (q.exclude) conds.push(Prisma.sql`p.id <> ${q.exclude}::uuid`);
    if (q.type === 'combo') conds.push(Prisma.sql`p.type = 'COMBO'`);
    const ready = q.ready === '1' || q.ready === 'true';
    if (q.search) {
      // tìm không dấu, theo đầu từ, hiểu chữ viết tắt (KCN = kem chống nắng…) trên tên, mã, thương hiệu, mã / tên / mã vạch phân loại
      const ids = await this.searchIds(s, hidden, q.search);
      conds.push(ids.length ? Prisma.sql`p.id = ANY(${ids}::uuid[])` : Prisma.sql`FALSE`);
    }
    const sort = !cfg.showPrice && q.sort?.startsWith('price') ? 'featured' : q.sort ?? 'featured';
    // "Nổi bật": còn hàng → có ảnh → bán chạy 90 ngày → mới nhất (hàng không ảnh / hết hàng xuống cuối)
    const order = {
      featured: Prisma.sql`x.sellable DESC, (x.image IS NOT NULL) DESC, x.sold DESC, x.created_at DESC, x.id`,
      best: Prisma.sql`x.sold DESC, x.sellable DESC, (x.image IS NOT NULL) DESC, x.created_at DESC, x.id`,
      new: Prisma.sql`x.created_at DESC, x.id`,
      name: Prisma.sql`x.name ASC, x.id`,
      price_asc: Prisma.sql`x.min_price ASC, x.id`,
      price_desc: Prisma.sql`x.max_price DESC, x.id`,
    }[sort] ?? Prisma.sql`x.sellable DESC, (x.image IS NOT NULL) DESC, x.sold DESC, x.created_at DESC, x.id`;
    const where = [cfg.hideOutOfStock || ready ? Prisma.sql`x.sellable` : Prisma.sql`TRUE`, ready ? Prisma.sql`x.image IS NOT NULL` : Prisma.sql`TRUE`];
    const rows = await this.prisma.raw.$queryRaw<Array<{ id: string; code: string; name: string; type: string; image: string | null; brand: string | null; min_price: Prisma.Decimal; max_price: Prisma.Decimal; n: number; avail: Prisma.Decimal; sellable: boolean; total: number }>>`
      WITH vis AS (SELECT p.id, p.code, p.name, p.type, p.created_at, p.brand_id,
                     ${PRODUCT_IMAGE_SQL} AS image
                   FROM products p WHERE ${Prisma.join(conds, ' AND ')}),
      v AS (SELECT pv.product_id, COALESCE(MIN(pv.sell_price) FILTER (WHERE pv.sell_price > 0), 0) AS min_price, MAX(pv.sell_price) AS max_price, COUNT(*)::int AS n FROM product_variants pv JOIN vis ON vis.id = pv.product_id WHERE pv.deleted_at IS NULL AND pv.is_active GROUP BY pv.product_id),
      s AS (SELECT pv.product_id, SUM(GREATEST(sb.on_hand - sb.reserved, 0)) AS avail FROM stock_balances sb JOIN product_variants pv ON pv.id = sb.variant_id JOIN vis ON vis.id = pv.product_id
            WHERE sb.tenant_id = ${s.tenantId}::uuid AND sb.warehouse_id = ANY(${warehouseIds}::uuid[]) AND pv.deleted_at IS NULL AND pv.is_active GROUP BY pv.product_id),
      sold AS (${this.soldSql(s)}),
      x AS (SELECT vis.*, v.min_price, v.max_price, v.n, COALESCE(s.avail, 0) AS avail, (vis.type = 'COMBO' OR COALESCE(s.avail, 0) > 0) AS sellable, COALESCE(sold.q, 0) AS sold
            FROM vis JOIN v ON v.product_id = vis.id LEFT JOIN s ON s.product_id = vis.id LEFT JOIN sold ON sold.product_id = vis.id)
      SELECT x.id, x.code, x.name, x.type::text AS type, x.min_price, x.max_price, x.n, x.avail, x.sellable, x.image, b.name AS brand, COUNT(*) OVER()::int AS total
      FROM x LEFT JOIN brands b ON b.id = x.brand_id WHERE ${Prisma.join(where, ' AND ')}
      ORDER BY ${order} LIMIT ${size} OFFSET ${(page - 1) * size}`;
    const total = rows[0]?.total ?? 0;
    if (!rows.length) return { items: [], total, page, pageSize: size };

    const variants = await this.prisma.db.productVariant.findMany({ where: { productId: { in: rows.map((r) => r.id) }, deletedAt: null, isActive: true }, select: { id: true, productId: true, sellPrice: true } });
    const regular = new Map(variants.map((v) => [v.id, D(v.sellPrice)]));
    const flash = cfg.flashSaleEnabled ? this.pickFlash(await this.activeFlashItems(this.prisma.db, variants.map((v) => v.id)), regular) : new Map<string, FlashItem>();
    const comboRows = rows.filter((r) => r.type === 'COMBO');
    const comboAvail = comboRows.length
      ? await this.availability(this.prisma.db, warehouseIds, variants.filter((v) => comboRows.some((r) => r.id === v.productId)).map((v) => ({ id: v.id, productId: v.productId, type: 'COMBO' })))
      : new Map<string, number>();
    // combo: tổng giá lẻ các món (web hiện % tiết kiệm), chỉ khi đang hiện giá
    const comboParts = comboRows.length && cfg.showPrice ? await this.prisma.db.comboItem.findMany({ where: { comboProductId: { in: comboRows.map((r) => r.id) } }, select: { comboProductId: true, quantity: true, componentVariant: { select: { sellPrice: true } } } }) : [];
    const retailOf = (id: string) => num(comboParts.filter((c) => c.comboProductId === id).reduce((t, c) => t.plus(D(c.componentVariant.sellPrice).times(D(c.quantity))), D(0)));
    const items = rows.map((r) => {
      const own = variants.filter((v) => v.productId === r.id);
      const fl = own.map((v) => flash.get(v.id)).filter((x): x is FlashItem => !!x).sort((a, b) => Number(D(a.salePrice).minus(D(b.salePrice))))[0];
      const avail = r.type === 'COMBO' ? Math.max(0, ...own.map((v) => comboAvail.get(v.id) ?? 0)) : Math.floor(Number(r.avail));
      return {
        id: r.id, code: r.code, name: r.name, type: r.type, imageUrl: r.image, brand: r.brand, variantCount: r.n,
        price: cfg.showPrice ? num(r.min_price) : null, priceMax: cfg.showPrice ? num(r.max_price) : null,
        inStock: avail > 0, available: cfg.showStock ? Math.min(avail, STOCK_CAP) : null,
        flash: fl ? this.flashInfo(fl, regular.get(fl.variantId) ?? ZERO, cfg) : null,
        // hàng không có phiên bản: web thêm thẳng vào giỏ từ danh sách
        variantId: own.length === 1 ? own[0].id : null, maxQuantity: Math.min(Math.max(avail, 0), 999),
        retailPrice: r.type === 'COMBO' && cfg.showPrice ? retailOf(r.id) : null,
      };
    });
    return { items, total, page, pageSize: size };
  }

  async product(s: Store, id: string) {
    const { cfg } = s;
    if (!/^[0-9a-f-]{36}$/i.test(id)) throw Errors.notFound('Hàng hóa', id);
    const p = await this.prisma.db.product.findFirst({
      where: { id, deletedAt: null, isActive: true, allowSale: true, trackBatch: false, type: { in: ['GOODS', 'COMBO'] } },
      include: {
        variants: { where: { deletedAt: null, isActive: true }, orderBy: [{ isDefault: 'desc' }, { createdAt: 'asc' }], include: { images: { orderBy: { sortOrder: 'asc' } } } },
        images: { where: { variantId: null }, orderBy: { sortOrder: 'asc' } }, category: { select: { id: true, name: true, parentId: true } }, brand: { select: { name: true } },
        comboItems: { orderBy: { componentVariant: { name: 'asc' } }, include: { componentVariant: { select: { name: true, sellPrice: true, imageUrl: true, product: { select: { imageUrl: true } } } } } },
      },
    });
    const hidden = await this.hiddenCategories(cfg);
    if (!p || !p.variants.length || (p.categoryId && hidden.includes(p.categoryId))) throw Errors.notFound('Hàng hóa', id);
    let images = Array.from(new Set([p.imageUrl, ...p.images.map((i) => i.url), ...p.variants.flatMap((v) => [v.imageUrl, ...v.images.map((i) => i.url)])].filter((u): u is string => !!u)));
    // combo chưa có ảnh riêng → ảnh các món trong combo
    if (!images.length && p.type === 'COMBO') images = Array.from(new Set(p.comboItems.map((c) => c.componentVariant.imageUrl ?? c.componentVariant.product.imageUrl).filter((u): u is string => !!u)));
    if (cfg.onlyWithImage && !images.length) throw Errors.notFound('Hàng hóa', id);
    const avail = await this.availability(this.prisma.db, await this.stockWarehouses(this.prisma.db, cfg), p.variants.map((v) => ({ id: v.id, productId: p.id, type: p.type })));
    const regular = new Map(p.variants.map((v) => [v.id, D(v.sellPrice)]));
    const flash = cfg.flashSaleEnabled ? this.pickFlash(await this.activeFlashItems(this.prisma.db, p.variants.map((v) => v.id)), regular) : new Map<string, FlashItem>();
    return {
      id: p.id, code: p.code, name: p.name, type: p.type, description: plainText(p.description), unit: p.baseUnit,
      category: p.category ? { id: p.category.id, name: cfg.webCategories.find((w) => w.id === p.category!.id)?.name || p.category.name } : null, brand: p.brand?.name ?? null, images, attributeNames: p.attributeNames,
      // combo: danh sách món (giá lẻ cộng lại chỉ trả khi đang hiện giá)
      combo: p.type === 'COMBO' ? {
        items: p.comboItems.map((c) => ({ name: c.componentVariant.name, quantity: num(c.quantity), imageUrl: c.componentVariant.imageUrl ?? c.componentVariant.product.imageUrl ?? null })),
        retailPrice: cfg.showPrice ? num(p.comboItems.reduce((s, c) => s.plus(D(c.componentVariant.sellPrice).times(D(c.quantity))), D(0))) : null,
      } : null,
      variants: p.variants.map((v) => {
        const a = avail.get(v.id) ?? 0;
        const fl = flash.get(v.id);
        return {
          id: v.id, sku: v.sku, name: v.name, attributes: v.attributes, imageUrl: v.imageUrl ?? v.images[0]?.url ?? null,
          price: cfg.showPrice ? num(v.sellPrice) : null, inStock: a > 0, available: cfg.showStock ? Math.min(a, STOCK_CAP) : null,
          maxQuantity: Math.min(a, 999), flash: fl ? this.flashInfo(fl, D(v.sellPrice), cfg) : null,
        };
      }),
    };
  }

  // ---------------------------------------------------------------- Flash Sale
  async flashSale(s: Store) {
    const { cfg } = s;
    const now = new Date();
    if (!cfg.flashSaleEnabled) return { enabled: false, serverTime: now.toISOString(), campaigns: [], upcoming: null };
    const hidden = new Set(await this.hiddenCategories(cfg));
    const campaigns = await this.prisma.db.flashSale.findMany({
      where: { isActive: true, startsAt: { lte: now }, endsAt: { gt: now } }, orderBy: { endsAt: 'asc' }, take: 5,
      include: { items: { orderBy: { sortOrder: 'asc' }, include: { variant: { select: { id: true, name: true, sellPrice: true, imageUrl: true, isActive: true, deletedAt: true, product: { select: { id: true, name: true, type: true, imageUrl: true, isActive: true, allowSale: true, deletedAt: true, trackBatch: true, categoryId: true, images: { take: 1, orderBy: { sortOrder: 'asc' }, select: { url: true } } } } } } } } },
    });
    const warehouseIds = await this.stockWarehouses(this.prisma.db, cfg);
    const visible = (it: (typeof campaigns)[number]['items'][number]) => {
      const v = it.variant; const p = v.product;
      return v.isActive && !v.deletedAt && p.isActive && p.allowSale && !p.deletedAt && !p.trackBatch && (p.type === 'GOODS' || p.type === 'COMBO')
        && !(p.categoryId && hidden.has(p.categoryId)) && D(it.salePrice).lessThan(D(v.sellPrice))
        && (!cfg.onlyWithImage || !!(v.imageUrl || p.imageUrl || p.images[0]));
    };
    const all = campaigns.flatMap((c) => c.items.filter(visible));
    const avail = await this.availability(this.prisma.db, warehouseIds, all.map((it) => ({ id: it.variant.id, productId: it.variant.product.id, type: it.variant.product.type })));
    const upcoming = await this.prisma.db.flashSale.findFirst({ where: { isActive: true, startsAt: { gt: now } }, orderBy: { startsAt: 'asc' }, include: { _count: { select: { items: true } } } });
    return {
      enabled: true, serverTime: now.toISOString(),
      campaigns: campaigns.map((c) => ({
        id: c.id, name: c.name, startsAt: c.startsAt, endsAt: c.endsAt,
        items: c.items.filter(visible).map((it) => {
          const regular = D(it.variant.sellPrice);
          const info = this.flashInfo({ ...it, flashSale: { id: c.id, name: c.name, startsAt: c.startsAt, endsAt: c.endsAt } }, regular, cfg);
          const a = avail.get(it.variant.id) ?? 0;
          return {
            itemId: it.id, variantId: it.variant.id, productId: it.variant.product.id, name: it.variant.name,
            imageUrl: it.variant.imageUrl || it.variant.product.imageUrl || it.variant.product.images[0]?.url || null,
            price: cfg.showPrice ? num(regular) : null, salePrice: info.price, discountPercent: info.discountPercent,
            limit: info.limit, sold: info.sold, remaining: info.remaining, perOrderLimit: info.perOrderLimit, soldOut: info.remaining === 0, inStock: a > 0,
          };
        }),
      })).filter((c) => c.items.length > 0),
      upcoming: upcoming ? { id: upcoming.id, name: upcoming.name, startsAt: upcoming.startsAt, endsAt: upcoming.endsAt, itemCount: upcoming._count.items } : null,
    };
  }

  // ---------------------------------------------------------------- đặt hàng
  async placeOrder(s: Store, dto: PlaceShopOrderDto, ip?: string) {
    const { cfg } = s;
    if (!cfg.allowOrder) throw new AppError('SHOP_ORDER_DISABLED', 'Cửa hàng chưa nhận đặt hàng online, vui lòng gọi hotline', 409);
    if (dto.website) throw Errors.validation('Yêu cầu không hợp lệ');
    const phone = normalizePhone(dto.phone);
    if (!phone) throw Errors.validation('Số điện thoại không hợp lệ');
    const existing = await this.prisma.db.salesOrder.findFirst({ where: { clientRef: dto.clientRef }, select: { id: true } });
    if (existing) return this.summary(s, existing.id);

    // gộp dòng trùng hàng
    const merged = new Map<string, number>();
    for (const l of dto.lines) merged.set(l.variantId, (merged.get(l.variantId) ?? 0) + l.quantity);
    if (Array.from(merged.values()).some((q) => q > 999)) throw Errors.validation('Mỗi sản phẩm đặt tối đa 999');

    const orderId = await this.prisma.tx(async (tx) => {
      const hidden = new Set(await this.hiddenCategories(cfg));
      const variants = await tx.productVariant.findMany({ where: { id: { in: Array.from(merged.keys()) }, deletedAt: null, isActive: true }, include: { product: { select: { id: true, name: true, type: true, isActive: true, allowSale: true, deletedAt: true, trackBatch: true, categoryId: true } } } });
      const byId = new Map(variants.map((v) => [v.id, v]));
      for (const vid of merged.keys()) {
        const v = byId.get(vid);
        const p = v?.product;
        if (!v || !p || !p.isActive || !p.allowSale || p.deletedAt || p.trackBatch || (p.type !== 'GOODS' && p.type !== 'COMBO') || (p.categoryId && hidden.has(p.categoryId)))
          throw new AppError('PRODUCT_NOT_SELLABLE', `${v?.name ?? 'Một sản phẩm'} không còn bán online, vui lòng xóa khỏi giỏ`, 409, { variantId: vid });
      }
      const dest = await this.destination(tx, cfg);
      // BR-185: chỉ nhận đơn trong số lượng còn bán được (cộng các kho tính tồn web)
      const stockWh = await this.stockWarehouses(tx, cfg);
      const lineVariants = variants.map((v) => ({ id: v.id, productId: v.productId, type: v.product.type }));
      const avail = await this.availability(tx, stockWh, lineVariants);
      const short = variants.filter((v) => (merged.get(v.id) ?? 0) > (avail.get(v.id) ?? 0)).map((v) => ({ variantId: v.id, name: v.name, available: avail.get(v.id) ?? 0 }));
      if (short.length) {
        const msg = short.map((x) => (x.available > 0 ? `${x.name}: chỉ còn ${x.available}` : `${x.name}: đã hết hàng`)).join('; ');
        throw new AppError('OUT_OF_STOCK', msg, 409, { items: short });
      }
      // đơn gắn vào kho trong chi nhánh nhận đơn có đủ cả đơn (ưu tiên kho nhận đơn) để xác nhận / giữ tồn không bị thiếu
      const sameBranch = await tx.warehouse.findMany({ where: { id: { in: stockWh }, branchId: dest.branchId }, select: { id: true } });
      for (const w of [dest.warehouseId, ...sameBranch.map((x) => x.id).filter((id) => id !== dest.warehouseId)]) {
        const a = await this.availability(tx, [w], lineVariants);
        if (variants.every((v) => (merged.get(v.id) ?? 0) <= (a.get(v.id) ?? 0))) { dest.warehouseId = w; break; }
      }

      // BR-183/184: giữ suất Flash Sale (nguyên tử), phần vượt suất / vượt giới hạn mỗi đơn tính giá thường
      const regular = new Map(variants.map((v) => [v.id, D(v.sellPrice)]));
      const best = cfg.flashSaleEnabled ? this.pickFlash(await this.activeFlashItems(tx, variants.map((v) => v.id)), regular) : new Map<string, FlashItem>();
      const input: InvoiceLineDto[] = [];
      const claims: Array<{ itemId: string; quantity: number }> = [];
      for (const [vid, qtyWanted] of merged) {
        const it = best.get(vid);
        let flashQty = 0;
        if (it) {
          flashQty = await this.claimFlash(tx, it.id, Math.min(qtyWanted, it.perOrderLimit ?? qtyWanted));
          if (flashQty > 0) {
            claims.push({ itemId: it.id, quantity: flashQty });
            input.push({ variantId: vid, quantity: String(flashQty), unitPrice: money(it.salePrice).toString(), note: `Flash Sale: ${it.flashSale.name}`.slice(0, 500) } as InvoiceLineDto);
          }
        }
        if (qtyWanted - flashQty > 0) input.push({ variantId: vid, quantity: String(qtyWanted - flashQty) } as InvoiceLineDto);
      }
      const sys: RequestUser = { id: '00000000-0000-0000-0000-000000000000', tenantId: s.tenantId, username: 'web', fullName: 'Web bán hàng', isOwner: false, allBranches: false, permissions: new Set(), branchIds: [], warehouseIds: [] };
      const resolved = await this.invoices.resolveLines(tx, sys, input, null, undefined, true);
      const calc = await this.invoices.compute(tx, resolved, ZERO);

      const customer = await this.findOrCreateCustomer(tx, s.tenantId, phone, dto.name, dto.address);
      const code = await this.numbering.next(tx, 'SALES_ORDER');
      const note = [`[Web] Người nhận: ${dto.name} · ${phone}`, `Địa chỉ: ${dto.address}`, dto.note ? `Ghi chú: ${dto.note}` : null].filter(Boolean).join('\n').slice(0, 1000);
      const o = await tx.salesOrder.create({
        data: {
          tenantId: s.tenantId, branchId: dest.branchId, warehouseId: dest.warehouseId, customerId: customer.id, code, source: 'ONLINE', status: 'DRAFT', clientRef: dto.clientRef, note,
          subtotal: calc.subtotal, discountAmount: ZERO, taxAmount: calc.taxAmount, totalAmount: calc.totalAmount,
          lines: { create: resolved.map((l, i) => ({ tenantId: s.tenantId, lineNo: i + 1, variantId: l.variantId, batchId: null, productUnitId: null, unitName: l.unitName, conversionFactor: l.conversionFactor, quantity: l.quantity, baseQuantity: l.baseQuantity, listPrice: l.listPrice, unitPrice: l.unitPrice, discountAmount: l.discountAmount, taxRate: l.taxRate, taxAmount: calc.lines[i].taxAmount, lineTotal: calc.lines[i].lineTotal, note: l.note })) },
        },
      });
      if (claims.length) await tx.flashSaleUsage.createMany({ data: claims.map((c) => ({ tenantId: s.tenantId, itemId: c.itemId, orderId: o.id, quantity: c.quantity })) });
      await this.audit.log(tx, { action: 'order.create', entityType: 'SalesOrder', entityId: o.id, entityCode: code, after: { source: 'ONLINE', totalAmount: calc.totalAmount.toString(), lines: resolved.length, flashLines: claims.length, ip: ip ?? null } });
      return o.id;
    }).catch(async (e) => {
      // hai lần bấm đặt cùng lúc: lần sau trả về đơn của lần trước
      if (e instanceof Prisma.PrismaClientKnownRequestError && e.code === 'P2002') {
        const dup = await this.prisma.db.salesOrder.findFirst({ where: { clientRef: dto.clientRef }, select: { id: true } });
        if (dup) return dup.id;
      }
      throw e;
    });
    return this.summary(s, orderId);
  }

  /** Giữ tối đa `want` suất; còn ít hơn thì giữ phần còn lại. Trả về số suất đã giữ. */
  private async claimFlash(tx: TxClient, itemId: string, want: number): Promise<number> {
    if (want <= 0) return 0;
    const ok = await tx.$queryRaw<Array<{ id: string }>>`UPDATE flash_sale_items SET sold_quantity = sold_quantity + ${want} WHERE id = ${itemId}::uuid AND (quantity_limit IS NULL OR sold_quantity + ${want} <= quantity_limit) RETURNING id`;
    if (ok.length) return want;
    const [row] = await tx.$queryRaw<Array<{ sold_quantity: number; quantity_limit: number | null }>>`SELECT sold_quantity, quantity_limit FROM flash_sale_items WHERE id = ${itemId}::uuid FOR UPDATE`;
    const left = row && row.quantity_limit !== null ? row.quantity_limit - row.sold_quantity : 0;
    if (left <= 0) return 0;
    await tx.$executeRaw`UPDATE flash_sale_items SET sold_quantity = sold_quantity + ${left} WHERE id = ${itemId}::uuid`;
    return left;
  }

  /** Khách theo số điện thoại (BR-186): có rồi thì dùng lại (bổ sung địa chỉ nếu trống), chưa có thì tạo mới. */
  private async findOrCreateCustomer(tx: TxClient, tenantId: string, phone: string, name: string, address: string) {
    const variants = [phone, `84${phone.slice(1)}`, `+84${phone.slice(1)}`];
    const found = await tx.customer.findFirst({ where: { phone: { in: variants } }, orderBy: { createdAt: 'asc' } });
    if (found) {
      if (!found.address) await tx.customer.update({ where: { id: found.id }, data: { address } });
      return found;
    }
    let code = await this.numbering.next(tx, 'CUSTOMER');
    for (let i = 0; i < 5 && (await tx.customer.findFirst({ where: { code } })); i++) code = await this.numbering.next(tx, 'CUSTOMER');
    const c = await tx.customer.create({ data: { tenantId, code, name, phone, address, note: 'Khách đặt hàng trên web' } });
    await this.audit.log(tx, { action: 'customer.create', entityType: 'Customer', entityId: c.id, entityCode: code, after: { source: 'WEB' } });
    return c;
  }

  // ---------------------------------------------------------------- tra cứu đơn
  async lookup(s: Store, code: string, rawPhone: string) {
    const phone = normalizePhone(rawPhone);
    const o = /^[A-Za-z0-9_-]{1,50}$/.test(code) ? await this.prisma.db.salesOrder.findFirst({ where: { code: code.toUpperCase(), source: 'ONLINE' }, include: { customer: { select: { phone: true } } } }) : null;
    if (!o || !phone || normalizePhone(o.customer?.phone) !== phone) throw Errors.notFound('Đơn hàng', code);
    return this.summary(s, o.id);
  }

  private async summary(s: Store, id: string) {
    const o = await this.prisma.db.salesOrder.findFirstOrThrow({
      where: { id },
      include: { customer: { select: { name: true, phone: true } }, delivery: { select: { status: true, carrier: true, trackingCode: true } }, lines: { orderBy: { lineNo: 'asc' }, include: { variant: { select: { name: true, imageUrl: true, product: { select: { id: true, imageUrl: true } } } } } } },
    });
    // dòng Flash Sale theo nút "Hiển thị giá Flash Sale", dòng thường theo "Hiển thị giá hàng hóa"; tổng tiền chỉ hiện khi mọi dòng đều hiện giá
    const isFlash = (l: { note: string | null }) => !!l.note?.startsWith('Flash Sale');
    const showLine = (l: { note: string | null }) => (isFlash(l) ? s.cfg.showFlashPrice : s.cfg.showPrice);
    const show = o.lines.every(showLine);
    const p = normalizePhone(o.customer?.phone) ?? '';
    return {
      code: o.code, status: o.status, orderDate: o.orderDate, customerName: o.customer?.name ?? null, phone: p ? `${p.slice(0, 4)}***${p.slice(-3)}` : null,
      showPrice: show, totalAmount: show ? num(o.totalAmount) : null,
      delivery: o.delivery ? { status: o.delivery.status, carrier: o.delivery.carrier, trackingCode: o.delivery.trackingCode } : null,
      lines: o.lines.map((l) => {
        const sh = showLine(l);
        return {
          productId: l.variant.product.id, name: l.variant.name, imageUrl: l.variant.imageUrl ?? l.variant.product.imageUrl ?? null, quantity: num(l.quantity),
          unitPrice: sh ? num(l.unitPrice) : null, listPrice: sh && s.cfg.showPrice ? num(l.listPrice) : null, lineTotal: sh ? num(l.lineTotal) : null, flash: isFlash(l),
        };
      }),
    };
  }
}
