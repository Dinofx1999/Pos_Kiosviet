/** Cấu hình web bán hàng của một cửa hàng, lưu ở tenant_settings key `online.shop` (BR-180). */
export const SHOP_SETTING_KEY = 'online.shop';

export interface ShopConfig {
  /** Mở website bán hàng cho khách */
  enabled: boolean;
  /** Hiển thị giá trên web (tắt: hiện "Liên hệ", Flash Sale chỉ hiện mức giảm %) */
  showPrice: boolean;
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
}

export const SHOP_DEFAULTS: ShopConfig = {
  enabled: false,
  showPrice: true,
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
    else if (k === 'themeColor' && typeof v[k] === 'string') out.themeColor = v[k] as string;
    else if (typeof def !== 'boolean' && !Array.isArray(def) && (typeof v[k] === 'string' || v[k] === null)) (out as any)[k] = v[k];
  }
  return out;
}
