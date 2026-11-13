// Web bán hàng: gọi API công khai /shop/:store/… (không đăng nhập, không dùng axios / antd để gói nhẹ)
const API = (import.meta.env.VITE_API_URL as string | undefined) ?? '/api/v1';

export function resolveStore(): string {
  const q = new URLSearchParams(window.location.search).get('store');
  try {
    if (q) sessionStorage.setItem('shop.store', q);
    return q || sessionStorage.getItem('shop.store') || 'default';
  } catch { return q || 'default'; }
}
export const STORE = resolveStore();

export class ShopError extends Error {
  constructor(public status: number, public code: string, message: string, public details?: any) { super(message); }
}

async function req<T>(path: string, init?: RequestInit): Promise<T> {
  let res: Response;
  try {
    res = await fetch(`${API}/shop/${encodeURIComponent(STORE)}${path}`, { ...init, headers: { 'Content-Type': 'application/json', ...(init?.headers ?? {}) } });
  } catch { throw new ShopError(0, 'NETWORK', 'Không kết nối được, vui lòng kiểm tra mạng và thử lại'); }
  const body = await res.json().catch(() => ({}));
  if (!res.ok) {
    const msg = Array.isArray(body?.message) ? body.message[0] : body?.message;
    throw new ShopError(res.status, body?.code ?? 'ERROR', res.status === 429 ? 'Bạn thao tác quá nhanh, vui lòng thử lại sau ít phút' : msg || 'Có lỗi xảy ra, vui lòng thử lại', body?.details);
  }
  return body as T;
}

/** Danh mục theo thứ tự cửa hàng chọn (máy chủ đã sắp xếp: tự sắp xếp hoặc nhiều hàng trước) */
export interface Category { id: string; name: string; count: number; imageUrl?: string | null; ownImage?: boolean; children?: Category[] }
export interface ShopConfig {
  store: string; enabled: boolean; shopName: string; hotline: string | null; zalo: string | null; facebook: string | null; address: string | null; intro: string | null;
  bannerUrl: string | null; logoUrl: string | null; themeColor: string; serverTime: string;
  showPrice?: boolean; showFlashPrice?: boolean; flashSaleEnabled?: boolean; allowOrder?: boolean; showStock?: boolean; categories?: Category[];
}
export interface FlashInfo { flashSaleId: string; name: string; endsAt: string; price: number | null; discountPercent: number; limit: number | null; sold: number; remaining: number | null; perOrderLimit: number | null }
export interface ProductCard { id: string; code: string; name: string; type: string; imageUrl: string | null; brand?: string | null; variantCount: number; price: number | null; priceMax: number | null; inStock: boolean; available: number | null; flash: FlashInfo | null; /** biến thể duy nhất (hàng không có phiên bản) – cho nút thêm nhanh vào giỏ */ variantId?: string | null; maxQuantity?: number }
export interface ProductList { items: ProductCard[]; total: number; page: number; pageSize: number }
export interface Variant { id: string; sku: string; name: string; attributes: Record<string, string> | null; imageUrl: string | null; price: number | null; inStock: boolean; available: number | null; maxQuantity: number; flash: FlashInfo | null }
export interface ProductDetail { id: string; code: string; name: string; type: string; description: string | null; unit: string | null; category: { id: string; name: string } | null; brand: string | null; images: string[]; attributeNames: string[]; variants: Variant[] }
export interface FlashItem { itemId: string; variantId: string; productId: string; name: string; imageUrl: string | null; price: number | null; salePrice: number | null; discountPercent: number; limit: number | null; sold: number; remaining: number | null; perOrderLimit: number | null; soldOut: boolean; inStock: boolean }
export interface FlashCampaign { id: string; name: string; startsAt: string; endsAt: string; items: FlashItem[] }
export interface FlashSaleData { enabled: boolean; serverTime: string; campaigns: FlashCampaign[]; upcoming: { id: string; name: string; startsAt: string; endsAt: string; itemCount: number } | null }
export interface OrderSummary {
  code: string; status: 'DRAFT' | 'CONFIRMED' | 'COMPLETED' | 'CANCELLED'; orderDate: string; customerName: string | null; phone: string | null; showPrice: boolean; totalAmount: number | null;
  delivery: { status: string; carrier: string | null; trackingCode: string | null } | null;
  lines: Array<{ productId: string; name: string; imageUrl: string | null; quantity: number; unitPrice: number | null; listPrice: number | null; lineTotal: number | null; flash: boolean }>;
}
export interface PlaceOrderInput { clientRef: string; name: string; phone: string; address: string; note?: string; website?: string; lines: Array<{ variantId: string; quantity: number }> }

export const shopApi = {
  config: () => req<ShopConfig>('/config'),
  products: (p: { search?: string; categoryId?: string; sort?: string; page?: number; pageSize?: number; ready?: 1; exclude?: string }) => {
    const q = new URLSearchParams();
    for (const [k, v] of Object.entries(p)) if (v !== undefined && v !== '' && v !== null) q.set(k, String(v));
    return req<ProductList>(`/products?${q.toString()}`);
  },
  product: (id: string) => req<ProductDetail>(`/products/${encodeURIComponent(id)}`),
  flashSale: () => req<FlashSaleData>('/flash-sale'),
  placeOrder: (body: PlaceOrderInput) => req<OrderSummary>('/orders', { method: 'POST', body: JSON.stringify(body) }),
  order: (code: string, phone: string) => req<OrderSummary>(`/orders/${encodeURIComponent(code)}?phone=${encodeURIComponent(phone)}`),
};

// ---------------------------------------------------------------- tiện ích hiển thị
const nf = new Intl.NumberFormat('vi-VN');
export const vnd = (n: number | null | undefined) => (n === null || n === undefined ? '' : `${nf.format(Math.round(n))}đ`);
export const zaloLink = (z: string | null) => (!z ? null : /^https?:\/\//.test(z) ? z : `https://zalo.me/${z.replace(/\D/g, '')}`);
export const telLink = (p: string | null) => (p ? `tel:${p.replace(/[^\d+]/g, '')}` : null);
export const uid = () => (typeof crypto !== 'undefined' && 'randomUUID' in crypto ? crypto.randomUUID() : 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, (c) => { const r = (Math.random() * 16) | 0; return (c === 'x' ? r : (r & 0x3) | 0x8).toString(16); }));
export const ORDER_STATUS: Record<OrderSummary['status'], string> = { DRAFT: 'Chờ cửa hàng xác nhận', CONFIRMED: 'Đã xác nhận – đang chuẩn bị hàng', COMPLETED: 'Hoàn tất', CANCELLED: 'Đã hủy' };
export const DELIVERY_STATUS: Record<string, string> = { PENDING: 'Chờ lấy hàng', PICKING: 'Đang lấy hàng', DELIVERING: 'Đang giao', DELIVERED: 'Đã giao', RETURNING: 'Đang hoàn', RETURNED: 'Đã hoàn', CANCELLED: 'Đã hủy giao' };

export function lsGet<T>(key: string, fallback: T): T {
  try { const v = localStorage.getItem(`${key}:${STORE}`); return v ? (JSON.parse(v) as T) : fallback; } catch { return fallback; }
}
export function lsSet(key: string, value: unknown) {
  try { localStorage.setItem(`${key}:${STORE}`, JSON.stringify(value)); } catch { /* chế độ riêng tư */ }
}
