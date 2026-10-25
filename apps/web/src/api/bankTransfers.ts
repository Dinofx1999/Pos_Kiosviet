import { keepPreviousData, useQuery, type QueryClient } from '@tanstack/react-query';
import { clean, http } from './client';
import type { Paginated } from './types';
import { useCan } from '../store/auth';

// ---------------------------------------------------------------- types (Thanh toán chuyển khoản tự động – SePay / VietQR)
export type BankTxStatus = 'MATCHED' | 'UNMATCHED' | 'APPLIED' | 'IGNORED';
export type BankRequestStatus = 'PENDING' | 'PARTIAL' | 'PAID' | 'CANCELLED';
export type BankRequestPurpose = 'POS' | 'INVOICE' | 'SALES_ORDER';
export type BankApplyTarget = 'INVOICE' | 'SALES_ORDER' | 'CUSTOMER';

export interface SepayConfig {
  provider: 'SEPAY'; enabled: boolean; bankCode: string | null; accountNumber: string | null; accountName: string | null;
  cashAccountId: string | null; cashAccount: { id: string; code: string; name: string; type: string; branchId: string | null } | null;
  codePrefix: string; posTtlMinutes: number; hasWebhookKey: boolean; webhookKeyLast4: string | null; webhookPath: string; lastWebhookAt: string | null;
  /** enabled + bank + account → selling screens may create VietQR codes */
  ready: boolean;
  stats30d: Partial<Record<BankTxStatus, { count: number; amount: string }>>;
}
export interface SepayConfigInput { enabled?: boolean; bankCode?: string; accountNumber?: string; accountName?: string; cashAccountId?: string | null; codePrefix?: string; posTtlMinutes?: number }
export interface SepayKey { apiKey: string; webhookKeyLast4: string; webhookPath: string }

export interface BankRequestTx { id: string; amount: string; referenceCode: string | null; transactionDate: string; gateway: string | null; status: BankTxStatus; paymentId: string | null }
export interface BankRequest {
  id: string; code: string; purpose: BankRequestPurpose; status: BankRequestStatus; expired: boolean;
  branchId: string; documentId: string | null; documentCode: string | null; customerId: string | null;
  /** requested amount; paidAmount = received so far; usedAmount = already turned into receipts */
  amount: string; paidAmount: string; usedAmount: string;
  /** amount − paid (what the QR asks for now) */
  remaining: string;
  /** paid − used (what the POS may still put on an invoice) */
  available: string;
  bankCode: string; bankName: string; accountNumber: string; accountName: string | null;
  transferContent: string; qrUrl: string;
  expiresAt: string; paidAt: string | null; consumedAt: string | null; cancelledAt?: string | null; note?: string | null; createdAt: string;
  transactions?: BankRequestTx[];
}
export interface BankRequestInput { purpose: BankRequestPurpose; branchId?: string; documentId?: string; amount?: string; note?: string }
export interface BankRequestQuery { status?: BankRequestStatus; purpose?: BankRequestPurpose; documentId?: string; page?: number; pageSize?: number }

export interface BankTransaction {
  id: string; externalId: string; gateway: string | null; accountNumber: string | null; transferType: string; amount: string;
  content: string | null; code: string | null; referenceCode: string | null; transactionDate: string; status: BankTxStatus; matchNote: string | null;
  request: { id: string; code: string; purpose: BankRequestPurpose; documentCode: string | null; status: BankRequestStatus } | null;
  payment: { id: string; code?: string; status?: string } | null;
  handledAt: string | null; createdAt: string;
}
export type BankTransactionList = Paginated<BankTransaction> & { unmatchedCount: number };
export interface BankTransactionQuery { status?: BankTxStatus; search?: string; page?: number; pageSize?: number }
export interface BankApplyInput { target: BankApplyTarget; documentId?: string; customerId?: string; note?: string }
export interface BankApplyResult { id: string; status: 'APPLIED'; paymentId: string; paymentCode: string; note: string | null }

export const BANK_TX_STATUS_LABEL: Record<BankTxStatus, string> = { UNMATCHED: 'Chưa khớp', MATCHED: 'Đã khớp tự động', APPLIED: 'Đã gắn tay', IGNORED: 'Bỏ qua' };
export const BANK_TX_STATUS_COLOR: Record<BankTxStatus, string> = { UNMATCHED: 'red', MATCHED: 'green', APPLIED: 'blue', IGNORED: 'default' };
export const BANK_REQUEST_STATUS_LABEL: Record<BankRequestStatus, string> = { PENDING: 'Đang chờ', PARTIAL: 'Nhận một phần', PAID: 'Đã nhận đủ', CANCELLED: 'Đã hủy' };
export const BANK_PURPOSE_LABEL: Record<BankRequestPurpose, string> = { POS: 'Bán tại quầy', INVOICE: 'Thu nợ hóa đơn', SALES_ORDER: 'Cọc đơn đặt hàng' };

// ---------------------------------------------------------------- api
export const bankApi = {
  config: () => http.get<SepayConfig>('/integrations/sepay').then((r) => r.data),
  saveConfig: (b: SepayConfigInput) => http.put<SepayConfig>('/integrations/sepay', b).then((r) => r.data),
  rotateKey: () => http.post<SepayKey>('/integrations/sepay/key', {}).then((r) => r.data),
  createRequest: (b: BankRequestInput) => http.post<BankRequest>('/bank-transfers/requests', clean(b as unknown as Record<string, unknown>)).then((r) => r.data),
  request: (id: string) => http.get<BankRequest>(`/bank-transfers/requests/${id}`).then((r) => r.data),
  cancelRequest: (id: string) => http.post<BankRequest>(`/bank-transfers/requests/${id}/cancel`, {}).then((r) => r.data),
  requests: (q: BankRequestQuery) => http.get<Paginated<BankRequest>>('/bank-transfers/requests', { params: clean(q as Record<string, unknown>) }).then((r) => r.data),
  transactions: (q: BankTransactionQuery) => http.get<BankTransactionList>('/bank-transfers/transactions', { params: clean(q as Record<string, unknown>) }).then((r) => r.data),
  apply: (id: string, b: BankApplyInput) => http.post<BankApplyResult>(`/bank-transfers/transactions/${id}/apply`, clean(b as unknown as Record<string, unknown>)).then((r) => r.data),
  ignore: (id: string, note?: string) => http.post<{ id: string; status: 'IGNORED'; note: string | null }>(`/bank-transfers/transactions/${id}/ignore`, clean({ note })).then((r) => r.data),
};

/** Still waiting for money (the QR screen keeps polling). */
export const isOpenRequest = (r?: Pick<BankRequest, 'status'> | null) => !!r && (r.status === 'PENDING' || r.status === 'PARTIAL');

// ---------------------------------------------------------------- hooks
export const useSepayConfig = (enabled = true) => useQuery({ queryKey: ['sepay-config'], queryFn: bankApi.config, staleTime: 30_000, enabled });
/** Polls every 2 s while the request still waits for money (and the screen asks for it). */
export const useBankRequest = (id?: string | null, poll = true) => useQuery({
  queryKey: ['bank-request', id], queryFn: () => bankApi.request(id!), enabled: !!id,
  refetchInterval: (q) => (poll && (!q.state.data || isOpenRequest(q.state.data)) ? 2000 : false), refetchIntervalInBackground: true,
});
export const useBankRequests = (q: BankRequestQuery, enabled = true) => useQuery({ queryKey: ['bank-requests', q], queryFn: () => bankApi.requests(q), placeholderData: keepPreviousData, enabled });
export const useBankTransactions = (q: BankTransactionQuery, enabled = true) => useQuery({ queryKey: ['bank-transactions', q], queryFn: () => bankApi.transactions(q), placeholderData: keepPreviousData, enabled, refetchInterval: 30_000 });
/** Unmatched count for the menu badge (cheap: one row). */
export const useUnmatchedBankCount = (enabled = true) => useQuery({ queryKey: ['bank-transactions', 'badge'], queryFn: () => bankApi.transactions({ status: 'UNMATCHED', pageSize: 1 }).then((r) => r.unmatchedCount), enabled, staleTime: 60_000, refetchInterval: 120_000 });

/**
 * May the selling screens offer "QR chuyển khoản"? `GET /bank-transfers/status` is readable by anyone who sells or collects money
 * (invoice.create / payment.create / cash.view); a 409 SEPAY_NOT_CONFIGURED later still hides the option (markSepayUnavailable).
 */
export function useSepayReady(): boolean {
  const can = useCan();
  const allowed = can('invoice.create') || can('payment.create') || can('cash.view');
  const { data } = useQuery({ queryKey: ['sepay-status'], queryFn: () => http.get<{ ready: boolean }>('/bank-transfers/status').then((r) => r.data), staleTime: 60_000, enabled: allowed });
  const { data: off } = useQuery({ queryKey: ['sepay-off'], queryFn: () => false, staleTime: Infinity, gcTime: Infinity });
  return allowed && !!data?.ready && !off;
}
export const markSepayUnavailable = (qc: QueryClient) => { qc.setQueryData(['sepay-off'], true); qc.invalidateQueries({ queryKey: ['sepay-config'] }); qc.invalidateQueries({ queryKey: ['sepay-status'] }); };

/** Query keys touched when money lands on an invoice / order / customer. */
export const BANK_KEYS = ['bank-transactions', 'bank-requests', 'bank-request', 'sepay-config', 'invoices', 'invoice', 'orders', 'order', 'payments', 'payment', 'customers', 'customer', 'customer-history', 'customer-ledger', 'customer-debt', 'cash-accounts', 'cash-book', 'cash-summary', 'dashboard'];
export const invalidateBank = (qc: QueryClient) => BANK_KEYS.forEach((k) => qc.invalidateQueries({ queryKey: [k] }));

/** Copy to clipboard with a fallback for non-secure contexts (http on LAN, older iOS). */
export async function copyText(text: string): Promise<boolean> {
  try { await navigator.clipboard.writeText(text); return true; } catch {
    try {
      const ta = document.createElement('textarea');
      ta.value = text; ta.setAttribute('readonly', ''); ta.style.position = 'fixed'; ta.style.opacity = '0'; ta.style.top = '0';
      document.body.appendChild(ta); ta.select(); ta.setSelectionRange(0, text.length);
      const ok = document.execCommand('copy'); ta.remove(); return ok;
    } catch { return false; }
  }
}
