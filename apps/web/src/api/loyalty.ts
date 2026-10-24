import { keepPreviousData, useQuery } from '@tanstack/react-query';
import { clean, http } from './client';
import type { Paginated } from './types';

// ---------------------------------------------------------------- Module 11 – điểm tích lũy (BR-140..BR-144), gói dịch vụ (BR-160), thuế GTGT (BR-155)
// Money / points are decimal strings.

export type PointEntryType = 'EARN' | 'REDEEM' | 'ADJUST' | 'REVERSAL';
export interface PointEntry { id: string; customerId: string; type: PointEntryType; points: string; balanceAfter: string; documentType?: string | null; documentId?: string | null; documentCode?: string | null; note?: string | null; createdAt: string }
export interface LoyaltyConfig { enabled: boolean; earnPoints: number; earnPerAmount: number; redeemValue: number; minRedeem: number; maxRedeemPercent: number }
export interface CustomerPoints extends Paginated<PointEntry> { customer: { id: string; code: string; name: string; points: string }; balance: string; earned: string; redeemed: string; adjusted: string; config: LoyaltyConfig }
/** `loyalty` block of POST /invoices/preview (BR-141). */
export interface PosLoyalty { enabled: boolean; pointValue: number; minRedeem: number; balance: string; maxRedeemPoints: string; redeemPoints: string; redeemValue: string; payableAfterPoints: string; earnPreview: string }

export type PlanLimitKey = 'branches' | 'warehouses' | 'users' | 'products';
export interface PlanInfo { code: string; name: string; branches: number | null; warehouses: number | null; users: number | null; products: number | null; trialDays: number }
export interface Subscription {
  tenant: { id: string; code: string; name: string; status: string; planCode: string; trialEndsAt?: string | null; planExpiresAt?: string | null; planNote?: string | null; createdAt: string };
  plan: PlanInfo; usage: Record<PlanLimitKey, number>; limits: Record<PlanLimitKey, number | null>; trialDaysLeft: number | null; readOnly: boolean; plans: PlanInfo[];
}

export interface TaxQuery { from?: string; to?: string; branchId?: string }
export interface TaxOutputRow { taxRate: string; invoices: number; taxable: string; tax: string }
export interface TaxInputRow { taxRate: string; receipts: number; taxable: string; tax: string }
export interface TaxReport { from: string; to: string; output: TaxOutputRow[]; input: TaxInputRow[]; returns: { count: number; refund: string }; totals: { outputTaxable: string; outputTax: string; inputTaxable: string; inputTax: string; payable: string }; note: string }

// fields the Module 11 backend added to existing responses (types.ts / promotions.ts are owned elsewhere → augment here)
declare module './types' {
  interface Invoice { pointsEarned?: string; pointsRedeemed?: string; pointsValue?: string }
  interface Customer { points?: string }
  interface CustomerHit { points?: string }
}
declare module './promotions' {
  interface PosPreview { loyalty?: PosLoyalty }
}

export const loyaltyApi = {
  points: (customerId: string, q: { page?: number; pageSize?: number }) => http.get<CustomerPoints>(`/customers/${customerId}/points`, { params: clean({ ...q }) }).then((r) => r.data),
  /** points: "+50" / "-20" (whole points), note required (BR-144). */
  adjust: (customerId: string, b: { points: string; note: string }) => http.post<PointEntry>(`/customers/${customerId}/points/adjust`, b).then((r) => r.data),
  birthdays: (q: { month?: number; day?: number }) => http.get<{ month: number; day: number | null; customers: { id: string; code: string; name: string; phone?: string | null; birthday: string; groupName?: string | null; points: string; day: number }[] }>('/customers/birthdays', { params: clean({ ...q }) }).then((r) => r.data),
  subscription: () => http.get<Subscription>('/subscription').then((r) => r.data),
  tax: (q: TaxQuery) => http.get<TaxReport>('/reports/tax', { params: clean({ ...q }) }).then((r) => r.data),
};

export const useCustomerPoints = (customerId: string | undefined, q: { page?: number; pageSize?: number }, enabled = true) => useQuery({ queryKey: ['customer-points', customerId, q], queryFn: () => loyaltyApi.points(customerId!, q), enabled: !!customerId && enabled, placeholderData: keepPreviousData });
export const useSubscription = (enabled = true) => useQuery({ queryKey: ['subscription'], queryFn: loyaltyApi.subscription, enabled, staleTime: 60_000 });
export const useTaxReport = (q: TaxQuery, enabled = true) => useQuery({ queryKey: ['reports', 'tax', q], queryFn: () => loyaltyApi.tax(q), placeholderData: keepPreviousData, enabled });

export const POINT_TYPE_LABEL: Record<PointEntryType, string> = { EARN: 'Tích điểm', REDEEM: 'Dùng điểm', ADJUST: 'Điều chỉnh', REVERSAL: 'Hủy / đảo' };
export const POINT_TYPE_COLOR: Record<PointEntryType, string> = { EARN: 'green', REDEEM: 'blue', ADJUST: 'gold', REVERSAL: 'red' };
export const PLAN_LIMIT_LABEL: Record<PlanLimitKey, string> = { branches: 'Chi nhánh', warehouses: 'Kho hàng', users: 'Người dùng', products: 'Hàng hóa' };
export const TENANT_STATUS_LABEL: Record<string, string> = { TRIAL: 'Dùng thử', ACTIVE: 'Đang hoạt động', SUSPENDED: 'Tạm ngưng', CLOSED: 'Đã đóng' };

/** Whole-number points for display: "12.5" → "12,5"; "40" → "40". */
export const pts = (v: unknown) => { const n = Number(v ?? 0); return (Number.isFinite(n) ? n : 0).toLocaleString('vi-VN', { maximumFractionDigits: 2 }); };
