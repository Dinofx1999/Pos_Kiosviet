import { keepPreviousData, useQuery } from '@tanstack/react-query';
import { clean, http } from './client';
import type { Customer, CustomerDebt, CustomerHistory, CustomerHit, ExchangeResult, Invoice, LedgerEntry, Paginated, PosPrice, ReturnCondition, Returnable, SalesReturn, SalesSummary, Shift } from './types';
import { uuid } from '../utils/format';
import type { ApplicablePriceBook, PosPreview } from './promotions';

const idem = () => ({ headers: { 'Idempotency-Key': uuid() } });

export interface CustomerQuery { page?: number; pageSize?: number; search?: string; isActive?: string; hasDebt?: string; groupName?: string; sortBy?: string; sortDir?: 'asc' | 'desc' }
export interface InvoiceQuery { page?: number; pageSize?: number; search?: string; status?: string; branchId?: string; warehouseId?: string; customerId?: string; sellerId?: string; shiftId?: string; unpaid?: string; from?: string; to?: string; sortBy?: string; sortDir?: 'asc' | 'desc' }
export interface ShiftQuery { page?: number; pageSize?: number; search?: string; status?: string; branchId?: string; userId?: string; from?: string; to?: string }
export interface SalesReportQuery { from?: string; to?: string; branchId?: string; sellerId?: string; groupBy?: 'day' | 'month' }

export interface InvoiceLineInput { variantId: string; batchId?: string; productUnitId?: string; quantity: string; unitPrice?: string; discountAmount?: string; note?: string; isGift?: boolean; promotionId?: string }
export interface InvoicePaymentInput { method: string; amount: string; reference?: string }
export interface InvoiceInput { branchId: string; warehouseId: string; customerId?: string; sellerId?: string; priceBookId?: string; invoiceDate?: string; discountAmount?: string; note?: string; lines: InvoiceLineInput[]; payments?: InvoicePaymentInput[]; voucherCode?: string; excludePromotionIds?: string[]; applyPromotions?: boolean; redeemPoints?: string }
export interface InvoiceUpdateInput { version: number; warehouseId?: string; customerId?: string | null; sellerId?: string; priceBookId?: string | null; discountAmount?: string; note?: string; lines?: InvoiceLineInput[]; voucherCode?: string | null; excludePromotionIds?: string[]; applyPromotions?: boolean; redeemPoints?: string }

export const salesApi = {
  // customers
  customers: (q: CustomerQuery) => http.get<Paginated<Customer>>('/customers', { params: clean(q as any) }).then((r) => r.data),
  customerSearch: (q: string) => http.get<CustomerHit[]>('/customers/search', { params: { q } }).then((r) => r.data),
  customerGroups: () => http.get<{ name: string; count: number }[]>('/customers/groups').then((r) => r.data),
  customerDebt: () => http.get<CustomerDebt>('/customers/debt').then((r) => r.data),
  customer: (id: string) => http.get<Customer>(`/customers/${id}`).then((r) => r.data),
  customerHistory: (id: string) => http.get<CustomerHistory>(`/customers/${id}/history`).then((r) => r.data),
  customerLedger: (id: string, q: { page?: number; pageSize?: number; from?: string; to?: string }) => http.get<Paginated<LedgerEntry>>(`/customers/${id}/ledger`, { params: clean(q as any) }).then((r) => r.data),
  createCustomer: (b: any) => http.post<Customer>('/customers', b).then((r) => r.data),
  updateCustomer: (id: string, b: any) => http.patch<Customer>(`/customers/${id}`, b).then((r) => r.data),
  // shifts
  shifts: (q: ShiftQuery) => http.get<Paginated<Shift>>('/shifts', { params: clean(q as any) }).then((r) => r.data),
  shift: (id: string) => http.get<Shift>(`/shifts/${id}`).then((r) => r.data),
  currentShift: (branchId: string) => http.get<Shift | null>('/shifts/current', { params: { branchId } }).then((r) => r.data || null),
  openShift: (b: { branchId: string; openingCash?: string; note?: string }) => http.post<Shift>('/shifts/open', b).then((r) => r.data),
  closeShift: (id: string, b: { countedCash: string; note?: string }) => http.post<Shift>(`/shifts/${id}/close`, b).then((r) => r.data),
  // invoices
  invoices: (q: InvoiceQuery) => http.get<Paginated<Invoice>>('/invoices', { params: clean(q as any) }).then((r) => r.data),
  invoice: (id: string) => http.get<Invoice>(`/invoices/${id}`).then((r) => r.data),
  price: (q: { variantId: string; priceBookId?: string; productUnitId?: string; quantity?: string }) => http.get<PosPrice>('/invoices/price', { params: clean(q as any) }).then((r) => r.data),
  hold: (b: InvoiceInput) => http.post<Invoice>('/invoices', b, idem()).then((r) => r.data),
  checkout: (b: InvoiceInput) => http.post<Invoice>('/invoices/checkout', b, idem()).then((r) => r.data),
  updateInvoice: (id: string, b: InvoiceUpdateInput) => http.patch<Invoice>(`/invoices/${id}`, b).then((r) => r.data),
  deleteInvoice: (id: string) => http.delete(`/invoices/${id}`),
  complete: (id: string, payments: InvoicePaymentInput[], version?: number) => http.post<Invoice>(`/invoices/${id}/complete`, { payments, version }, idem()).then((r) => r.data),
  cancelInvoice: (id: string, reason: string) => http.post<Invoice>(`/invoices/${id}/cancel`, { reason }, idem()).then((r) => r.data),
  // sales returns / exchanges (Module 07)
  returns: (q: SalesReturnQuery) => http.get<Paginated<SalesReturn>>('/sales-returns', { params: clean(q as any) }).then((r) => r.data),
  return: (id: string) => http.get<SalesReturn>(`/sales-returns/${id}`).then((r) => r.data),
  returnable: (invoiceId: string) => http.get<Returnable>(`/sales-returns/returnable/${invoiceId}`).then((r) => r.data),
  createReturn: (b: ReturnInput) => http.post<SalesReturn>('/sales-returns', b, idem()).then((r) => r.data),
  completeReturnNow: (b: ReturnInput & { refund?: RefundInput }) => http.post<SalesReturn>('/sales-returns/complete-now', b, idem()).then((r) => r.data),
  updateReturn: (id: string, b: ReturnUpdateInput) => http.patch<SalesReturn>(`/sales-returns/${id}`, b).then((r) => r.data),
  deleteReturn: (id: string) => http.delete(`/sales-returns/${id}`),
  completeReturn: (id: string, b: { version?: number; refund?: RefundInput }) => http.post<SalesReturn>(`/sales-returns/${id}/complete`, b, idem()).then((r) => r.data),
  cancelReturn: (id: string, reason: string) => http.post<SalesReturn>(`/sales-returns/${id}/cancel`, { reason }, idem()).then((r) => r.data),
  exchange: (b: ExchangeInput) => http.post<ExchangeResult>('/sales-returns/exchange', b, idem()).then((r) => r.data),
  /** Phiếu chi hoàn phần còn lại của một phiếu trả đã hoàn thành (khách lẻ: bỏ partyType/partyId, phân bổ toàn bộ). */
  refundReturn: (b: { branchId: string; method: string; amount: string; reference?: string; note?: string; partyId?: string | null; returnId: string }) =>
    http.post('/payments', { branchId: b.branchId, direction: 'OUT', method: b.method, partyType: b.partyId ? 'CUSTOMER' : undefined, partyId: b.partyId ?? undefined, amount: b.amount, reference: b.reference || undefined, note: b.note || undefined, allocations: [{ documentType: 'SALES_RETURN', documentId: b.returnId, amount: b.amount }] }, idem()).then((r) => r.data as { id: string; code: string }),
  // reports
  summary: (q: SalesReportQuery) => http.get<SalesSummary>('/sales/reports/summary', { params: clean(q as any) }).then((r) => r.data),
  // Module 09 – promotions at the POS
  /** Tính thử giỏ hàng (giá, khuyến mãi tự động, voucher, hàng tặng, tổng tiền) – không lưu. */
  preview: (b: Omit<InvoiceInput, 'payments'>, signal?: AbortSignal) => http.post<PosPreview>('/invoices/preview', b, { signal }).then((r) => r.data),
  /** Bảng giá áp dụng được cho chi nhánh / khách hàng (suggested = dành cho nhóm của khách). */
  applicablePriceBooks: (q: { branchId: string; customerId?: string }) => http.get<ApplicablePriceBook[]>('/invoices/price-books', { params: clean(q as any) }).then((r) => r.data),
};

export interface SalesReturnQuery { page?: number; pageSize?: number; search?: string; status?: string; branchId?: string; invoiceId?: string; customerId?: string; from?: string; to?: string; sortBy?: string; sortDir?: 'asc' | 'desc' }
export interface ReturnLineInput { invoiceLineId: string; quantity: string; unitPrice?: string; condition?: ReturnCondition; note?: string }
export interface ReturnInput { invoiceId: string; returnDate?: string; reason?: string; note?: string; feeAmount?: string; lines: ReturnLineInput[] }
export interface ReturnUpdateInput { version: number; returnDate?: string; reason?: string; note?: string; feeAmount?: string; lines?: ReturnLineInput[] }
export interface RefundInput { method: string; amount: string; reference?: string }
export interface ExchangeInput { return: ReturnInput; newInvoice: { warehouseId?: string; sellerId?: string; priceBookId?: string; discountAmount?: string; note?: string; lines: InvoiceLineInput[] }; payments?: InvoicePaymentInput[]; refund?: RefundInput }
export const useSalesReturns = (q: SalesReturnQuery, enabled = true) => useQuery({ queryKey: ['sales-returns', q], queryFn: () => salesApi.returns(q), placeholderData: keepPreviousData, enabled });
export const useSalesReturn = (id?: string) => useQuery({ queryKey: ['sales-return', id], queryFn: () => salesApi.return(id!), enabled: !!id });
export const useReturnable = (invoiceId?: string) => useQuery({ queryKey: ['returnable', invoiceId], queryFn: () => salesApi.returnable(invoiceId!), enabled: !!invoiceId });

export const useCustomers = (q: CustomerQuery) => useQuery({ queryKey: ['customers', q], queryFn: () => salesApi.customers(q), placeholderData: keepPreviousData });
export const useCustomerGroups = () => useQuery({ queryKey: ['customer-groups'], queryFn: salesApi.customerGroups, staleTime: 60_000 });
export const useCustomer = (id?: string) => useQuery({ queryKey: ['customer', id], queryFn: () => salesApi.customer(id!), enabled: !!id });
export const useCustomerHistory = (id?: string) => useQuery({ queryKey: ['customer-history', id], queryFn: () => salesApi.customerHistory(id!), enabled: !!id });
export const useCustomerLedger = (id: string | undefined, q: { page?: number; pageSize?: number }) => useQuery({ queryKey: ['customer-ledger', id, q], queryFn: () => salesApi.customerLedger(id!, q), enabled: !!id, placeholderData: keepPreviousData });
export const useCustomerDebt = () => useQuery({ queryKey: ['customer-debt'], queryFn: salesApi.customerDebt });
export const useShifts = (q: ShiftQuery) => useQuery({ queryKey: ['shifts', q], queryFn: () => salesApi.shifts(q), placeholderData: keepPreviousData });
export const useShift = (id?: string) => useQuery({ queryKey: ['shift', id], queryFn: () => salesApi.shift(id!), enabled: !!id });
export const useCurrentShift = (branchId?: string | null) => useQuery({ queryKey: ['shift-current', branchId], queryFn: () => salesApi.currentShift(branchId!), enabled: !!branchId, refetchInterval: 60_000 });
export const useInvoices = (q: InvoiceQuery, enabled = true) => useQuery({ queryKey: ['invoices', q], queryFn: () => salesApi.invoices(q), placeholderData: keepPreviousData, enabled });
export const useInvoice = (id?: string) => useQuery({ queryKey: ['invoice', id], queryFn: () => salesApi.invoice(id!), enabled: !!id });
export const useSalesSummary = (q: SalesReportQuery, enabled = true) => useQuery({ queryKey: ['sales-summary', q], queryFn: () => salesApi.summary(q), enabled });

/** Query keys touched by sales mutations – invalidate them all after a write. */
export const SALES_KEYS = ['customers', 'customer', 'customer-history', 'customer-ledger', 'customer-groups', 'customer-debt', 'shifts', 'shift', 'shift-current', 'invoices', 'invoice', 'sales-summary', 'payments', 'payment', 'balances', 'balance-summary', 'movements', 'products', 'product', 'dashboard', 'sales-returns', 'sales-return', 'returnable'];
