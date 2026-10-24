import { keepPreviousData, useQuery } from '@tanstack/react-query';
import { clean, http } from './client';
import type { Paginated, Payment, Shift } from './types';
import { uuid } from '../utils/format';

const idem = () => ({ headers: { 'Idempotency-Key': uuid() } });

// ---------------------------------------------------------------- types (Module 08 – Sổ quỹ)
export type CashAccountType = 'CASH' | 'BANK' | 'EWALLET';
export type PaymentDirection = 'IN' | 'OUT';

export interface CashReconciliation { id: string; accountId: string; bookBalance: string; countedBalance: string; difference: string; note?: string | null; createdById?: string | null; createdAt: string }
export interface CashAccount {
  id: string; code: string; name: string; type: CashAccountType; branchId: string | null; branch?: { id: string; name: string } | null;
  bankName?: string | null; accountNumber?: string | null; accountHolder?: string | null;
  openingBalance: string; balance: string; isDefault: boolean; isActive: boolean; createdAt: string; updatedAt?: string;
  lastReconciliation?: CashReconciliation | null;
}
export interface PaymentCategory { id: string; direction: PaymentDirection; name: string; isActive: boolean }
export interface CashTransferLeg { id: string; code: string; direction: PaymentDirection; status: 'POSTED' | 'CANCELLED' }
export interface CashTransfer {
  id: string; code: string; branchId: string; fromAccount: { id: string; code: string; name: string }; toAccount: { id: string; code: string; name: string };
  amount: string; shiftId?: string | null; note?: string | null; status: 'POSTED' | 'CANCELLED'; cancelledAt?: string | null; cancelReason?: string | null; createdAt: string; payments: CashTransferLeg[];
}
/** Payment with the Module 08 relations the API now includes. */
export type PaymentEx = Payment & { cashAccountId?: string | null; categoryId?: string | null; transferId?: string | null; shiftId?: string | null; cashAccount?: { id: string; code: string; name: string } | null; category?: { id: string; name: string } | null; branch?: { id: string; name: string } | null; shift?: { id: string; code: string } | null };
/** One cash-book line. With an account the API adds partyName / categoryName / balanceAfter; without it the rows are plain payments. */
export interface CashbookEntry {
  id: string; code: string; direction: PaymentDirection; method: string; amount: string; paymentDate: string; note?: string | null;
  partyType?: string | null; partyId?: string | null; partyName?: string | null; categoryName?: string | null; balanceAfter?: string;
  transferId?: string | null; cashAccountId?: string | null; categoryId?: string | null; cashAccount?: { code: string; name: string } | null; category?: { name: string } | null; party?: { id: string; code: string; name: string } | null;
}
export interface Cashbook {
  account: { id: string; code: string; name: string; type: CashAccountType; balance: string } | null;
  openingBalance: string | null; totalIn?: string; totalOut?: string; closingBalance?: string;
  data: CashbookEntry[]; meta: { page: number; pageSize: number; total: number };
}
export type CashKind = 'CUSTOMER' | 'SUPPLIER' | 'CATEGORY' | 'TRANSFER' | 'WALKIN';
export interface CashSummary {
  from: string; to: string;
  totals: { in: string; out: string; net: string };
  byAccount: { accountId: string | null; code: string | null; name: string; balance: string | null; totalIn: string; totalOut: string }[];
  byKind: { direction: PaymentDirection; kind: CashKind; label: string | null; amount: string; count: number }[];
}
export interface DebtOffsetResult { amount: string; paymentId: string; customer: { id: string; code: string; name: string; balanceAfter: string }; supplier: { id: string; code: string; name: string; balanceAfter: string }; vouchers: string[] }

export interface CashAccountInput { code?: string; name: string; type?: CashAccountType; branchId?: string; bankName?: string; accountNumber?: string; accountHolder?: string; openingBalance?: string; isDefault?: boolean }
export interface CashAccountPatch { name?: string; bankName?: string | null; accountNumber?: string | null; accountHolder?: string | null; isDefault?: boolean; isActive?: boolean }
export interface TransferQuery { page?: number; pageSize?: number; search?: string; branchId?: string; status?: string; from?: string; to?: string }
export interface CashbookQuery { accountId?: string; branchId?: string; direction?: string; from?: string; to?: string; page?: number; pageSize?: number }
export interface CashSummaryQuery { from?: string; to?: string; branchId?: string; accountId?: string }
/** Phiếu thu / chi: either a party (customer / supplier) or an "other income / expense" category (no party). */
export interface VoucherInput { branchId: string; direction: PaymentDirection; method: string; partyType?: 'SUPPLIER' | 'CUSTOMER'; partyId?: string; amount: string; paymentDate?: string; reference?: string; note?: string; cashAccountId?: string; categoryId?: string }
export interface ShiftCloseInput { countedCash: string; note?: string; handoverAmount?: string; handoverToAccountId?: string }
export type ShiftClosed = Shift & { handover: { code: string; amount: string } | null };

export const CASH_ACCOUNT_TYPE_LABEL: Record<string, string> = { CASH: 'Tiền mặt', BANK: 'Ngân hàng', EWALLET: 'Ví điện tử' };
export const CASH_ACCOUNT_TYPE_COLOR: Record<string, string> = { CASH: 'green', BANK: 'blue', EWALLET: 'purple' };
export const CASH_KIND_LABEL: Record<string, string> = { CUSTOMER: 'Khách hàng', SUPPLIER: 'Nhà cung cấp', CATEGORY: 'Thu / chi khác', TRANSFER: 'Chuyển quỹ', WALKIN: 'Khách lẻ (hóa đơn)' };
/** Fund type that a payment method lands on by default (mirrors the API's resolveCashAccount). */
export const METHOD_ACCOUNT_TYPE: Record<string, CashAccountType | null> = { CASH: 'CASH', BANK_TRANSFER: 'BANK', CARD: 'BANK', EWALLET: 'EWALLET', OTHER: null };
export const ACCOUNT_TYPE_METHOD: Record<CashAccountType, string> = { CASH: 'CASH', BANK: 'BANK_TRANSFER', EWALLET: 'EWALLET' };

// ---------------------------------------------------------------- api
export const financeApi = {
  accounts: (includeInactive = false) => http.get<CashAccount[]>('/cash/accounts', { params: { includeInactive } }).then((r) => r.data),
  account: (id: string) => http.get<CashAccount>(`/cash/accounts/${id}`).then((r) => r.data),
  createAccount: (b: CashAccountInput) => http.post<CashAccount>('/cash/accounts', b).then((r) => r.data),
  updateAccount: (id: string, b: CashAccountPatch) => http.patch<CashAccount>(`/cash/accounts/${id}`, b).then((r) => r.data),
  reconcile: (id: string, b: { countedBalance: string; note?: string }) => http.post<CashReconciliation>(`/cash/accounts/${id}/reconcile`, b).then((r) => r.data),
  reconciliations: (id: string) => http.get<CashReconciliation[]>(`/cash/accounts/${id}/reconciliations`).then((r) => r.data),
  categories: (q: { direction?: string; includeInactive?: boolean } = {}) => http.get<PaymentCategory[]>('/cash/categories', { params: clean(q as any) }).then((r) => r.data),
  createCategory: (b: { direction: PaymentDirection; name: string }) => http.post<PaymentCategory>('/cash/categories', b).then((r) => r.data),
  updateCategory: (id: string, b: { name?: string; isActive?: boolean }) => http.patch<PaymentCategory>(`/cash/categories/${id}`, b).then((r) => r.data),
  transfers: (q: TransferQuery) => http.get<Paginated<CashTransfer>>('/cash/transfers', { params: clean(q as any) }).then((r) => r.data),
  createTransfer: (b: { branchId: string; fromAccountId: string; toAccountId: string; amount: string; note?: string }) => http.post<CashTransfer>('/cash/transfers', b, idem()).then((r) => r.data),
  cancelTransfer: (id: string, reason: string) => http.post<CashTransfer>(`/cash/transfers/${id}/cancel`, { reason }, idem()).then((r) => r.data),
  book: (q: CashbookQuery) => http.get<Cashbook>('/cash/book', { params: clean(q as any) }).then((r) => r.data),
  summary: (q: CashSummaryQuery) => http.get<CashSummary>('/cash/summary', { params: clean(q as any) }).then((r) => r.data),
  debtOffset: (b: { branchId: string; customerId: string; supplierId: string; amount: string; note?: string }) => http.post<DebtOffsetResult>('/cash/debt-offset', b, idem()).then((r) => r.data),
  cancelDebtOffset: (paymentId: string, reason: string) => http.post<{ cancelled: string[] }>(`/cash/debt-offset/${paymentId}/cancel`, { reason }, idem()).then((r) => r.data),
  // payments (extended create: party-less "other" vouchers with a category, explicit fund)
  createVoucher: (b: VoucherInput) => http.post<PaymentEx>('/payments', b, idem()).then((r) => r.data),
  cancelVoucher: (id: string, reason: string) => http.post<PaymentEx>(`/payments/${id}/cancel`, { reason }, idem()).then((r) => r.data),
  voucher: (id: string) => http.get<PaymentEx>(`/payments/${id}`).then((r) => r.data),
  // shift close with cash handover (sales.ts is owned by another module → call the endpoint directly)
  closeShift: (id: string, b: ShiftCloseInput) => http.post<ShiftClosed>(`/shifts/${id}/close`, b).then((r) => r.data),
};

// ---------------------------------------------------------------- hooks
export const useCashAccounts = (includeInactive = false, enabled = true) => useQuery({ queryKey: ['cash-accounts', includeInactive], queryFn: () => financeApi.accounts(includeInactive), staleTime: 30_000, enabled });
export const useCashAccount = (id?: string) => useQuery({ queryKey: ['cash-account', id], queryFn: () => financeApi.account(id!), enabled: !!id });
export const useCashCategories = (q: { direction?: string; includeInactive?: boolean } = {}, enabled = true) => useQuery({ queryKey: ['cash-categories', q], queryFn: () => financeApi.categories(q), staleTime: 30_000, enabled });
export const useCashTransfers = (q: TransferQuery, enabled = true) => useQuery({ queryKey: ['cash-transfers', q], queryFn: () => financeApi.transfers(q), placeholderData: keepPreviousData, enabled });
export const useCashBook = (q: CashbookQuery, enabled = true) => useQuery({ queryKey: ['cash-book', q], queryFn: () => financeApi.book(q), placeholderData: keepPreviousData, enabled });
export const useCashSummary = (q: CashSummaryQuery, enabled = true) => useQuery({ queryKey: ['cash-summary', q], queryFn: () => financeApi.summary(q), enabled });
export const useReconciliations = (id?: string) => useQuery({ queryKey: ['cash-reconciliations', id], queryFn: () => financeApi.reconciliations(id!), enabled: !!id });
export const useVoucher = (id?: string) => useQuery({ queryKey: ['payment', id], queryFn: () => financeApi.voucher(id!), enabled: !!id });

/** Query keys touched by cash-book mutations – invalidate them all after a write. */
export const FINANCE_KEYS = ['cash-accounts', 'cash-account', 'cash-categories', 'cash-transfers', 'cash-book', 'cash-summary', 'cash-reconciliations', 'payments', 'payment', 'shifts', 'shift', 'shift-current', 'customers', 'customer', 'customer-history', 'customer-ledger', 'customer-debt', 'suppliers', 'supplier', 'supplier-history', 'supplier-ledger', 'supplier-debt', 'dashboard'];
