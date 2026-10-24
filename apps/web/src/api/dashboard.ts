import { useQuery } from '@tanstack/react-query';
import { http } from './client';
import type { DashboardOverview } from './types';

export const useDashboard = () => useQuery({ queryKey: ['dashboard'], queryFn: () => http.get<DashboardOverview>('/dashboard/overview').then((r) => r.data), refetchInterval: 60_000 });

// ---------------- trang chủ (GET /dashboard/home)
export interface HomePeriod { invoices: number; revenue: string; customers: number; grossProfit?: string }
export interface HomeSales {
  today: HomePeriod; yesterday: HomePeriod; week: HomePeriod; lastWeek: HomePeriod; month: HomePeriod; lastMonth: HomePeriod;
  byHour: { hour: number; invoices: number; revenue: string }[];
  byDay: { day: string; invoices: number; revenue: string; grossProfit?: string }[];
  topProducts: { variantId: string; sku: string; name: string; quantity: string; revenue: string }[];
  recentInvoices: { id: string; code: string; invoiceDate: string; totalAmount: string; paidAmount: string; status: 'COMPLETED' | 'CANCELLED'; customerName: string | null; sellerName: string | null; lines: number }[];
  unpaid: { count: number; amount: string };
  returnsToday: { count: number; amount: string };
}
export interface HomeTodo { pendingOrders: number | null; deliveriesInProgress: number | null; transfersToReceive: number | null; birthdaysToday: number | null; heldInvoices: number | null }
export interface HomeInventory {
  skuCount: number; onHandTotal: string; reservedTotal: string; stockValue?: string; lowStockCount: number; products: number; warehouses: number;
  recentDocuments: { id: string; code: string; type: string; status: string; totalCost: string; createdAt: string; warehouse?: { name: string } | null }[];
}
export interface HomeShift { id: string; code: string; openedAt: string; branch: { id: string; name: string }; openingCash: string; invoices: number; revenue: string; cashNet: string }
export interface DashboardHome { generatedAt: string; timezone: string; sales: HomeSales | null; todo: HomeTodo; inventory: HomeInventory | null; shift: HomeShift | null }

export const useDashboardHome = (branchId?: string | null) => useQuery({
  queryKey: ['dashboard', 'home', branchId ?? 'all'],
  queryFn: () => http.get<DashboardHome>('/dashboard/home', { params: branchId ? { branchId } : {} }).then((r) => r.data),
  refetchInterval: 60_000,
  staleTime: 20_000,
});
