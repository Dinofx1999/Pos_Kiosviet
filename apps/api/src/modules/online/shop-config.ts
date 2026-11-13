/** Cấu hình web bán hàng của một cửa hàng, lưu ở tenant_settings key `online.shop` (BR-180). */
export const SHOP_SETTING_KEY = 'online.shop';

export interface ShopConfig {
  /** Mở website bán hàng cho khách */
  enabled: boolean;
  /** Hiển thị giá hàng hóa trên web (tắt: hiện "Liên hệ") – không gồm giá Flash Sale */
  showPrice: boolean;
  /** Hiển thị giá Flash Sale (tắt: hàng Flash Sale chỉ hiện mức giảm %, giá "Liên hệ") */
  showFlashPrice: boolean;
  /** Bật Flash Sale trên web (tắt: mọi chương trình Flash Sale đều tạm ngưng trên web) */
  flashSaleEnabled: boolean;
  /** Cho khách đặt hàng trên web (tắt: chỉ xem hàng, gọi / nhắn Zalo để mua) */
  allowOrder: boolean;
  /** Hiện số lượng còn lại ("Còn 5 sản phẩm"); trạng thái Hết hàng luôn hiện */
  showStock: boolean;
  /** Ẩn hàng đã hết khỏi danh sách */
  hideOutOfStock: boolean;
  /** Chỉ hiện hàng có ảnh */
  onlyWithImage: boolean;
  shopName: string | null;
  hotline: string | null;
  zalo: string | null;
  facebook: string | null;
  address: string | null;
  intro: string | null;
  bannerUrl: string | null;
  logoUrl: string | null;
  themeColor: string;
  /** Chi nhánh / kho nhận đơn web (null = chi nhánh mặc định và kho mặc định của nó) */
  branchId: string | null;
  warehouseId: string | null;
  /** Kho tính còn / hết hàng trên web, cộng tồn các kho ([] = mọi kho đang hoạt động) */
  stockWarehouseIds: string[];
  /** Danh mục ẩn khỏi web (kể cả danh mục con) */
  hiddenCategoryIds: string[];
  /** Danh mục cấp 1 trên web: ảnh đại diện và tên hiển thị riêng (bỏ trống = ảnh hàng bán chạy / tên danh mục); thứ tự trong danh sách = thứ tự tự sắp xếp. */
  webCategories: WebCategory[];
  /** true = danh mục hiện theo thứ tự webCategories (danh mục không có trong danh sách xếp sau); false = tự động, nhiều hàng trước */
  customCategoryOrder: boolean;
}

export interface WebCategory { id: string; imageUrl: string | null; name: string | null }

export const SHOP_DEFAULTS: ShopConfig = {
  enabled: false,
  showPrice: true,
  showFlashPrice: true,
  flashSaleEnabled: true,
  allowOrder: true,
  showStock: false,
  hideOutOfStock: false,
  onlyWithImage: false,
  shopName: null,
  hotline: null,
  zalo: null,
  facebook: null,
  address: null,
  intro: null,
  bannerUrl: null,
  logoUrl: null,
  themeColor: '#d6336c',
  branchId: null,
  warehouseId: null,
  stockWarehouseIds: [],
  hiddenCategoryIds: [],
  webCategories: [],
  customCategoryOrder: false,
};

/** Gộp giá trị đã lưu với mặc định, bỏ khóa lạ. */
export function normalizeShopConfig(raw: unknown): ShopConfig {
  const v = (raw && typeof raw === 'object' ? raw : {}) as Record<string, unknown>;
  const out = { ...SHOP_DEFAULTS };
  for (const k of Object.keys(SHOP_DEFAULTS) as Array<keyof ShopConfig>) {
    if (v[k] === undefined) continue;
    const def = SHOP_DEFAULTS[k];
    if (typeof def === 'boolean' && typeof v[k] === 'boolean') (out as any)[k] = v[k];
    else if ((k === 'hiddenCategoryIds' || k === 'stockWarehouseIds') && Array.isArray(v[k])) out[k] = (v[k] as unknown[]).filter((x): x is string => typeof x === 'string');
    else if (k === 'webCategories' && Array.isArray(v[k])) out.webCategories = normalizeWebCategories(v[k] as unknown[]);
    else if (k === 'themeColor' && typeof v[k] === 'string') out.themeColor = v[k] as string;
    else if (typeof def !== 'boolean' && !Array.isArray(def) && (typeof v[k] === 'string' || v[k] === null)) (out as any)[k] = v[k];
  }
  // cấu hình cũ chỉ có một nút "Hiển thị giá" (tắt thì ẩn cả giá Flash Sale) → giữ nguyên cách hiện khi chưa lưu nút riêng
  if (typeof v.showFlashPrice !== 'boolean' && typeof v.showPrice === 'boolean') out.showFlashPrice = v.showPrice;
  return out;
}

function normalizeWebCategories(list: unknown[]): WebCategory[] {
  const seen = new Set<string>();
  const out: WebCategory[] = [];
  for (const x of list) {
    if (!x || typeof x !== 'object') continue;
    const r = x as Record<string, unknown>;
    if (typeof r.id !== 'string' || seen.has(r.id)) continue;
    seen.add(r.id);
    const img = typeof r.imageUrl === 'string' && r.imageUrl.trim() ? r.imageUrl.trim() : null;
    const name = typeof r.name === 'string' && r.name.trim() ? r.name.trim().slice(0, 60) : null;
    out.push({ id: r.id, imageUrl: img, name });
  }
  return out;
}
