import { keepPreviousData, useQuery } from '@tanstack/react-query';
import { clean, http } from './client';
import type { Paginated } from './types';

// ---------------------------------------------------------------- types (Module 09 – khuyến mãi, BR-90..BR-96)
export type PromotionType = 'INVOICE_DISCOUNT' | 'INVOICE_GIFT' | 'PRODUCT_DISCOUNT' | 'BUY_X_GET_Y' | 'VOUCHER';
export type PromotionStatus = 'ACTIVE' | 'INACTIVE';
export type VoucherStatus = 'ACTIVE' | 'USED' | 'DISABLED';

export interface PromoTargets { variantIds?: string[]; categoryIds?: string[] }
export interface InvoiceDiscountTier { minTotal: string; discountPercent?: string; discountAmount?: string; maxDiscount?: string }
export interface InvoiceGiftTier { minTotal: string; gifts: { variantId: string; quantity: string }[] }
export interface InvoiceDiscountConfig { tiers: InvoiceDiscountTier[] }
export interface InvoiceGiftConfig { tiers: InvoiceGiftTier[] }
export interface ProductDiscountConfig extends PromoTargets { minQuantity?: string; maxQuantity?: string; discountPercent?: string; discountAmount?: string; fixedPrice?: string; maxDiscount?: string }
export interface BuyXGetYConfig { buy: PromoTargets & { quantity: string }; get: { variantIds: string[]; quantity: string; discountPercent?: string }; maxRepeats?: number | null; applyToCart?: boolean }
export interface VoucherConfig extends PromoTargets { discountPercent?: string; discountAmount?: string; maxDiscount?: string; minTotal?: string }
export type PromotionConfig = InvoiceDiscountConfig | InvoiceGiftConfig | ProductDiscountConfig | BuyXGetYConfig | VoucherConfig;

export interface VariantLite { id: string; sku: string; name: string; sellPrice: string }
export interface Promotion {
  id: string; code: string; name: string; type: PromotionType; status: PromotionStatus; description?: string | null; running: boolean;
  priority: number; stackable: boolean; startsAt?: string | null; endsAt?: string | null; daysOfWeek: number[]; timeFrom?: string | null; timeTo?: string | null;
  customerGroups: string[]; branchIds: string[]; usageLimit?: number | null; usageCount: number; perCustomerLimit?: number | null; config: PromotionConfig; createdAt: string; updatedAt?: string;
  _count?: { vouchers: number; uses: number };
}
export interface PromotionDetail extends Promotion { stats: { uses: number; amount: string; gifts: string }; variants: VariantLite[] }
export interface PromotionInput {
  code?: string; name: string; type: PromotionType; description?: string; status?: PromotionStatus; startsAt?: string | null; endsAt?: string | null; daysOfWeek?: number[]; timeFrom?: string | null; timeTo?: string | null;
  branchIds?: string[]; customerGroups?: string[]; priority?: number; stackable?: boolean; usageLimit?: number | null; perCustomerLimit?: number | null; config: PromotionConfig;
}
export type PromotionUpdate = Partial<Omit<PromotionInput, 'type' | 'code'>>;
export interface PromotionQuery { page?: number; pageSize?: number; search?: string; status?: string; type?: string; running?: string; branchId?: string; sortBy?: string; sortDir?: 'asc' | 'desc' }

export interface Voucher { id: string; promotionId: string; code: string; status: VoucherStatus; maxUses: number; usedCount: number; customerId?: string | null; expiresAt?: string | null; note?: string | null; createdAt: string }
export interface VoucherQuery { page?: number; pageSize?: number; search?: string; status?: string }
export interface CreateVouchersInput { count?: number; codes?: string[]; prefix?: string; maxUses?: number; customerId?: string; expiresAt?: string; note?: string }
export interface VoucherLookup {
  valid: boolean; reason?: string | null;
  voucher?: { id: string; code: string; status: VoucherStatus; maxUses: number; usedCount: number; expiresAt?: string | null };
  promotion?: { id: string; code: string; name: string; config: VoucherConfig; stackable: boolean };
}
export interface PromotionReportRow { promotionId: string; code: string; name: string; type: PromotionType; uses: number; amount: string; gifts: string; revenue: string }
export interface PromotionReport { from: string; to: string; totals: { promotions: number; uses: number; discount: string }; rows: PromotionReportRow[] }

/** POST /invoices/preview – live cart pricing with promotions (no persistence). */
export interface PosPreviewLine { variantId: string; productUnitId?: string | null; quantity: string; listPrice: string; unitPrice: string; discountAmount: string; promotionDiscount: string; promotionId?: string | null; isGift: boolean; taxAmount: string; lineTotal: string }
export interface PosPreviewPromotion { promotionId: string; code: string; name: string; type: PromotionType; amount: string; giftQuantity: string; voucherId?: string | null }
export interface PosPreviewGift { promotionId: string; code: string; name: string; variantIds: string[]; quantity: string; claimed: string; remaining: string; discountPercent: string; variants: VariantLite[] }
export interface PosPreview { subtotal: string; discountAmount: string; promotionDiscount: string; taxAmount: string; totalAmount: string; voucherCode?: string | null; lines: PosPreviewLine[]; promotions: PosPreviewPromotion[]; gifts: PosPreviewGift[] }
export interface ApplicablePriceBook { id: string; code: string; name: string; priority: number; customerGroups: string[]; items: number; suggested: boolean }

// ---------------------------------------------------------------- api
export const promotionsApi = {
  list: (q: PromotionQuery) => http.get<Paginated<Promotion>>('/promotions', { params: clean(q as any) }).then((r) => r.data),
  get: (id: string) => http.get<PromotionDetail>(`/promotions/${id}`).then((r) => r.data),
  create: (b: PromotionInput) => http.post<PromotionDetail>('/promotions', b).then((r) => r.data),
  update: (id: string, b: PromotionUpdate) => http.patch<PromotionDetail>(`/promotions/${id}`, b).then((r) => r.data),
  remove: (id: string) => http.delete(`/promotions/${id}`),
  vouchers: (id: string, q: VoucherQuery) => http.get<Paginated<Voucher>>(`/promotions/${id}/vouchers`, { params: clean(q as any) }).then((r) => r.data),
  createVouchers: (id: string, b: CreateVouchersInput) => http.post<{ count: number; codes: string[] }>(`/promotions/${id}/vouchers`, b).then((r) => r.data),
  updateVoucher: (voucherId: string, b: { status?: 'ACTIVE' | 'DISABLED'; expiresAt?: string | null; note?: string }) => http.patch<Voucher>(`/promotions/vouchers/${voucherId}`, b).then((r) => r.data),
  lookupVoucher: (q: { code: string; branchId?: string; customerId?: string }) => http.get<VoucherLookup>('/promotions/vouchers/lookup', { params: clean(q as any) }).then((r) => r.data),
  report: (q: { from?: string; to?: string; branchId?: string }) => http.get<PromotionReport>('/promotions/report', { params: clean(q as any) }).then((r) => r.data),
};

// ---------------------------------------------------------------- hooks
export const usePromotions = (q: PromotionQuery, enabled = true) => useQuery({ queryKey: ['promotions', q], queryFn: () => promotionsApi.list(q), placeholderData: keepPreviousData, enabled });
export const usePromotion = (id?: string) => useQuery({ queryKey: ['promotion', id], queryFn: () => promotionsApi.get(id!), enabled: !!id });
export const useVouchers = (id: string | undefined, q: VoucherQuery, enabled = true) => useQuery({ queryKey: ['vouchers', id, q], queryFn: () => promotionsApi.vouchers(id!, q), enabled: !!id && enabled, placeholderData: keepPreviousData });
export const usePromotionReport = (q: { from?: string; to?: string; branchId?: string }, enabled = true) => useQuery({ queryKey: ['promotion-report', q], queryFn: () => promotionsApi.report(q), enabled });

/** Query keys touched by promotion mutations – invalidate them all after a write. */
export const PROMOTION_KEYS = ['promotions', 'promotion', 'vouchers', 'promotion-report'];

export const PROMOTION_TYPE_LABEL: Record<PromotionType, string> = { INVOICE_DISCOUNT: 'Giảm giá hóa đơn', INVOICE_GIFT: 'Tặng hàng theo hóa đơn', PRODUCT_DISCOUNT: 'Giảm giá hàng hóa', BUY_X_GET_Y: 'Mua X tặng Y', VOUCHER: 'Voucher / mã giảm giá' };
export const PROMOTION_TYPE_SHORT: Record<PromotionType, string> = { INVOICE_DISCOUNT: 'Giảm HĐ', INVOICE_GIFT: 'Tặng theo HĐ', PRODUCT_DISCOUNT: 'Giảm hàng', BUY_X_GET_Y: 'Mua X tặng Y', VOUCHER: 'Voucher' };
export const PROMOTION_TYPE_COLOR: Record<PromotionType, string> = { INVOICE_DISCOUNT: 'blue', INVOICE_GIFT: 'purple', PRODUCT_DISCOUNT: 'cyan', BUY_X_GET_Y: 'magenta', VOUCHER: 'gold' };
export const PROMOTION_TYPES: PromotionType[] = ['INVOICE_DISCOUNT', 'INVOICE_GIFT', 'PRODUCT_DISCOUNT', 'BUY_X_GET_Y', 'VOUCHER'];
export const VOUCHER_STATUS_LABEL: Record<VoucherStatus, string> = { ACTIVE: 'Còn hiệu lực', USED: 'Đã dùng', DISABLED: 'Đã khóa' };
export const VOUCHER_STATUS_COLOR: Record<VoucherStatus, string> = { ACTIVE: 'green', USED: 'default', DISABLED: 'red' };
