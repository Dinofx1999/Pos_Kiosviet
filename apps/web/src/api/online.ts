import { useQuery } from '@tanstack/react-query';
import { http } from './client';

// ---------------------------------------------------------------- Bán online (web bán hàng + Flash Sale)
export interface ShopConfig {
  enabled: boolean; showPrice: boolean; showFlashPrice: boolean; flashSaleEnabled: boolean; allowOrder: boolean; showStock: boolean; hideOutOfStock: boolean; onlyWithImage: boolean;
  shopName: string | null; hotline: string | null; zalo: string | null; facebook: string | null; address: string | null; intro: string | null;
  bannerUrl: string | null; logoUrl: string | null; themeColor: string; branchId: string | null; warehouseId: string | null; stockWarehouseIds: string[]; hiddenCategoryIds: string[];
  webCategories: WebCategory[]; customCategoryOrder: boolean;
}
/** Danh mục cấp 1 trên web: ảnh và tên riêng (null = tự động); thứ tự trong danh sách dùng khi customCategoryOrder. */
export interface WebCategory { id: string; imageUrl: string | null; name: string | null }
/** Danh mục cấp 1 cho màn thiết lập: số hàng hiện được trên web (chưa trừ danh mục ẩn), ảnh tự động (hàng bán chạy). */
export interface ShopAdminCategory { id: string; name: string; count: number; autoImageUrl: string | null; children: number }
export interface ShopSettingsView { config: ShopConfig; tenantCode: string; tenantName: string; isDefaultShop: boolean; pendingOrders: number }

export type FlashSaleState = 'RUNNING' | 'UPCOMING' | 'ENDED' | 'OFF';
export interface FlashSaleRow {
  id: string; name: string; startsAt: string; endsAt: string; isActive: boolean; note?: string | null; state: FlashSaleState;
  itemCount: number; soldQuantity: number; quantityLimit: number | null; createdAt: string;
}
export interface FlashSaleItem {
  id: string; variantId: string; salePrice: string; quantityLimit: number | null; perOrderLimit: number | null; soldQuantity: number; sortOrder: number;
  variant: { id: string; sku: string; name: string; sellPrice: string; imageUrl?: string | null; isActive: boolean; product: { id: string; code: string; name: string; imageUrl?: string | null; isActive: boolean } };
}
export interface FlashSaleDetail extends Omit<FlashSaleRow, 'itemCount' | 'soldQuantity' | 'quantityLimit'> { items: FlashSaleItem[] }
export interface FlashSaleInput {
  name: string; startsAt: string; endsAt: string; isActive?: boolean; note?: string;
  items: Array<{ variantId: string; salePrice: string; quantityLimit?: number | null; perOrderLimit?: number | null }>;
}

export const onlineApi = {
  settings: () => http.get<ShopSettingsView>('/online/settings').then((r) => r.data),
  categories: () => http.get<ShopAdminCategory[]>('/online/settings/categories').then((r) => r.data),
  saveSettings: (body: Partial<ShopConfig>) => http.put<ShopSettingsView>('/online/settings', body).then((r) => r.data),
  summary: () => http.get<{ pendingOrders: number; enabled: boolean }>('/online/summary').then((r) => r.data),
  flashSales: (state?: string) => http.get<FlashSaleRow[]>('/online/flash-sales', { params: state ? { state } : {} }).then((r) => r.data),
  flashSale: (id: string) => http.get<FlashSaleDetail>(`/online/flash-sales/${id}`).then((r) => r.data),
  createFlashSale: (body: FlashSaleInput) => http.post<FlashSaleDetail>('/online/flash-sales', body).then((r) => r.data),
  updateFlashSale: (id: string, body: FlashSaleInput) => http.put<FlashSaleDetail>(`/online/flash-sales/${id}`, body).then((r) => r.data),
  toggleFlashSale: (id: string, isActive: boolean) => http.patch<FlashSaleDetail>(`/online/flash-sales/${id}/active`, { isActive }).then((r) => r.data),
  removeFlashSale: (id: string) => http.delete(`/online/flash-sales/${id}`),
};

export const useShopSettings = () => useQuery({ queryKey: ['shop-settings'], queryFn: onlineApi.settings });
export const useShopCategories = () => useQuery({ queryKey: ['shop-categories'], queryFn: onlineApi.categories });
export const useOnlineSummary = (enabled: boolean) => useQuery({ queryKey: ['online-summary'], queryFn: onlineApi.summary, enabled, refetchInterval: 60_000, staleTime: 30_000 });
export const useFlashSales = (state?: string) => useQuery({ queryKey: ['flash-sales', state ?? ''], queryFn: () => onlineApi.flashSales(state) });
export const useFlashSale = (id?: string) => useQuery({ queryKey: ['flash-sale', id], queryFn: () => onlineApi.flashSale(id!), enabled: !!id });

export const FLASH_STATE_LABEL: Record<FlashSaleState, string> = { RUNNING: 'Đang diễn ra', UPCOMING: 'Sắp diễn ra', ENDED: 'Đã kết thúc', OFF: 'Đang tắt' };
export const FLASH_STATE_COLOR: Record<FlashSaleState, string> = { RUNNING: 'red', UPCOMING: 'blue', ENDED: 'default', OFF: 'default' };

/** Đường dẫn web bán hàng của cửa hàng: /shop nếu là cửa hàng mặc định của tên miền, ngược lại /shop?store=<mã>. */
export const shopUrl = (v: Pick<ShopSettingsView, 'tenantCode' | 'isDefaultShop'>) => `${window.location.origin}/shop${v.isDefaultShop ? '' : `?store=${encodeURIComponent(v.tenantCode)}`}`;
