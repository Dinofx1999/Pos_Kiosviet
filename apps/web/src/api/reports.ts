import { keepPreviousData, useQuery } from '@tanstack/react-query';
import { clean, http } from './client';
import type { Paginated } from './types';

// ---------------------------------------------------------------- Module 10 – báo cáo kho & lãi lỗ
// All money / quantity values come back as decimal strings; dates as ISO strings.

export interface NxtQuery { from?: string; to?: string; warehouseId?: string; branchId?: string; categoryId?: string; search?: string; hideEmpty?: 'true' | 'false'; page?: number; pageSize?: number }
export interface NxtRow {
  variantId: string; sku: string; name: string; barcode?: string | null; unit?: string | null; category?: string | null;
  openingQty: string; inQty: string; outQty: string; closingQty: string;
  openingValue?: string; inValue?: string; outValue?: string; closingValue?: string; costPrice?: string;
}
export interface NxtTotals { openingQty: string; inQty: string; outQty: string; closingQty: string; openingValue?: string; inValue?: string; outValue?: string; closingValue?: string }
export interface NxtReport extends Paginated<NxtRow> { from: string; to: string; totals: NxtTotals }

export interface SlowMoversQuery { days?: number; warehouseId?: string; branchId?: string; categoryId?: string; search?: string; page?: number; pageSize?: number }
export interface SlowMoverRow {
  variantId: string; sku: string; name: string; category?: string | null; onHand: string; costPrice?: string; value?: string;
  lastSaleAt?: string | null; lastReceiptAt?: string | null; daysSinceSale: number | null; soldInPeriod: string;
}
export interface SlowMoversReport extends Paginated<SlowMoverRow> { days: number; since: string; pageValue?: string }

export type TopProductsBy = 'revenue' | 'quantity' | 'profit';
export interface TopProductsQuery { from?: string; to?: string; branchId?: string; categoryId?: string; search?: string; by?: TopProductsBy; order?: 'desc' | 'asc'; page?: number; pageSize?: number }
export interface TopProductRow { variantId: string; sku: string; name: string; category?: string | null; quantity: string; returnedQuantity: string; revenue: string; cost?: string; profit?: string; invoices: number }
export interface TopProductsReport extends Paginated<TopProductRow> { from: string; to: string }

export interface ProfitQuery { from?: string; to?: string; branchId?: string; groupBy?: 'day' | 'month' }
export interface ProfitTotals {
  invoices: number; revenue: string; refunds: string; netRevenue: string; discount: string; cogs: string; grossProfit: string;
  otherIncome: string; otherExpense: string; damaged: string; shortage: string; stocktakeLoss: string; shippingCost: string; losses: string; netProfit: string;
}
export interface ProfitPeriod extends ProfitTotals { period: string; restock: string; cost: string }
export interface NamedAmount { name: string; amount: string }
export interface ProfitReport { from: string; to: string; groupBy: 'day' | 'month'; totals: ProfitTotals; byPeriod: ProfitPeriod[]; expenseByCategory: NamedAmount[]; incomeByCategory: NamedAmount[] }

export type ValuationGroupBy = 'category' | 'warehouse' | 'brand';
export interface ValuationQuery { groupBy?: ValuationGroupBy; warehouseId?: string; branchId?: string }
export interface ValuationRow { key: string; name: string; skus: number; quantity: string; value: string; retail: string; potentialMargin: string }
export interface ValuationReport { groupBy: ValuationGroupBy; rows: ValuationRow[]; totals: { skus: number; quantity: string; value: string; retail: string } }

export type ReportExportType = 'nxt' | 'slow-movers' | 'top-products' | 'profit' | 'valuation' | 'sales' | 'cashbook' | 'customer-debt' | 'supplier-debt';
export interface ReportExportQuery { type: ReportExportType; from?: string; to?: string; warehouseId?: string; branchId?: string; categoryId?: string; accountId?: string; days?: number; by?: string }

const FALLBACK_NAME: Record<ReportExportType, string> = { nxt: 'nhap-xuat-ton', 'slow-movers': 'hang-ton-lau', 'top-products': 'hang-ban-chay', profit: 'lai-lo', valuation: 'gia-tri-ton-kho', sales: 'doanh-thu', cashbook: 'so-quy', 'customer-debt': 'cong-no-khach-hang', 'supplier-debt': 'cong-no-nha-cung-cap' };

/** Reads `filename="…"` (or RFC 5987 `filename*=`) out of a Content-Disposition header. */
export function filenameFromDisposition(header?: string): string | undefined {
  if (!header) return undefined;
  const star = /filename\*=(?:UTF-8'')?([^;]+)/i.exec(header);
  if (star) { try { return decodeURIComponent(star[1].trim().replace(/^"|"$/g, '')); } catch { /* fall through */ } }
  const plain = /filename="?([^";]+)"?/i.exec(header);
  return plain ? plain[1].trim() : undefined;
}

export const reportsApi = {
  nxt: (q: NxtQuery) => http.get<NxtReport>('/reports/inventory/nxt', { params: clean({ ...q }) }).then((r) => r.data),
  slowMovers: (q: SlowMoversQuery) => http.get<SlowMoversReport>('/reports/inventory/slow-movers', { params: clean({ ...q }) }).then((r) => r.data),
  topProducts: (q: TopProductsQuery) => http.get<TopProductsReport>('/reports/sales/products', { params: clean({ ...q }) }).then((r) => r.data),
  profit: (q: ProfitQuery) => http.get<ProfitReport>('/reports/profit', { params: clean({ ...q }) }).then((r) => r.data),
  valuation: (q: ValuationQuery) => http.get<ValuationReport>('/reports/inventory/valuation', { params: clean({ ...q }) }).then((r) => r.data),
  /** Excel export of one report; resolves to the spreadsheet blob and the server-suggested file name. */
  download: (q: ReportExportQuery) => http.get('/reports/export', { params: clean({ ...q }), responseType: 'blob' }).then((r) => ({
    blob: r.data as Blob,
    filename: filenameFromDisposition(r.headers?.['content-disposition'] as string | undefined) ?? `${FALLBACK_NAME[q.type]}.xlsx`,
  })),
};

export const useNxtReport = (q: NxtQuery, enabled = true) => useQuery({ queryKey: ['reports', 'nxt', q], queryFn: () => reportsApi.nxt(q), placeholderData: keepPreviousData, enabled });
export const useSlowMovers = (q: SlowMoversQuery, enabled = true) => useQuery({ queryKey: ['reports', 'slow-movers', q], queryFn: () => reportsApi.slowMovers(q), placeholderData: keepPreviousData, enabled });
export const useTopProducts = (q: TopProductsQuery, enabled = true) => useQuery({ queryKey: ['reports', 'top-products', q], queryFn: () => reportsApi.topProducts(q), placeholderData: keepPreviousData, enabled });
export const useProfitReport = (q: ProfitQuery, enabled = true) => useQuery({ queryKey: ['reports', 'profit', q], queryFn: () => reportsApi.profit(q), placeholderData: keepPreviousData, enabled });
export const useValuation = (q: ValuationQuery, enabled = true) => useQuery({ queryKey: ['reports', 'valuation', q], queryFn: () => reportsApi.valuation(q), placeholderData: keepPreviousData, enabled });
