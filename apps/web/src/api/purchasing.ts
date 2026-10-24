import { keepPreviousData, useQuery } from '@tanstack/react-query';
import { clean, http } from './client';
import type { LedgerEntry, Paginated, Payment, PurchaseOrder, PurchaseReceipt, PurchaseReturn, PurchaseSummary, Supplier, SupplierDebt, SupplierHistory } from './types';
import { uuid } from '../utils/format';

const idem = () => ({ headers: { 'Idempotency-Key': uuid() } });

export interface SupplierQuery { page?: number; pageSize?: number; search?: string; isActive?: string; hasDebt?: string; groupName?: string; sortBy?: string; sortDir?: 'asc' | 'desc' }
export interface OrderQuery { page?: number; pageSize?: number; search?: string; status?: string; supplierId?: string; branchId?: string; warehouseId?: string; from?: string; to?: string }
export interface ReceiptQuery { page?: number; pageSize?: number; search?: string; status?: string; supplierId?: string; branchId?: string; warehouseId?: string; orderId?: string; unpaid?: string; from?: string; to?: string }
export interface ReturnQuery { page?: number; pageSize?: number; search?: string; status?: string; supplierId?: string; receiptId?: string; branchId?: string; from?: string; to?: string }
export interface PaymentQuery { page?: number; pageSize?: number; search?: string; direction?: string; partyType?: string; partyId?: string; branchId?: string; status?: string; from?: string; to?: string }

export interface OrderLineInput { variantId: string; quantity: string; unitPrice: string; discountAmount?: string; taxRate?: string; note?: string }
export interface OrderInput { branchId: string; warehouseId: string; supplierId: string; orderDate?: string; expectedDate?: string; discountAmount?: string; note?: string; lines: OrderLineInput[] }
export interface ReceiptLineInput { variantId: string; batchId?: string; orderLineId?: string; quantity: string; unitPrice: string; discountAmount?: string; taxRate?: string; note?: string }
export interface ReceiptCostInput { name: string; amount: string; allocationMethod?: 'BY_VALUE' | 'BY_QUANTITY'; payToSupplier?: boolean }
export interface ImmediatePayment { amount: string; method?: string; reference?: string }
export interface ReceiptInput { branchId: string; warehouseId: string; supplierId: string; orderId?: string; receiptDate?: string; supplierInvoiceNo?: string; discountAmount?: string; note?: string; lines: ReceiptLineInput[]; costs?: ReceiptCostInput[]; payment?: ImmediatePayment }
export interface ReturnLineInput { receiptLineId: string; quantity: string; unitPrice?: string; note?: string }
export interface ReturnInput { receiptId: string; returnDate?: string; reason?: string; note?: string; lines: ReturnLineInput[]; refund?: ImmediatePayment }
export interface PaymentInput { branchId: string; direction: 'IN' | 'OUT'; method?: string; partyType: 'SUPPLIER' | 'CUSTOMER'; partyId: string; amount: string; paymentDate?: string; reference?: string; note?: string; allocations?: { documentType: 'PURCHASE_RECEIPT' | 'PURCHASE_RETURN'; documentId: string; amount: string }[] }

export const purchasingApi = {
  // suppliers
  suppliers: (q: SupplierQuery) => http.get<Paginated<Supplier>>('/suppliers', { params: clean(q as any) }).then((r) => r.data),
  supplierGroups: () => http.get<{ name: string; count: number }[]>('/suppliers/groups').then((r) => r.data),
  supplier: (id: string) => http.get<Supplier>(`/suppliers/${id}`).then((r) => r.data),
  supplierHistory: (id: string) => http.get<SupplierHistory>(`/suppliers/${id}/history`).then((r) => r.data),
  supplierLedger: (id: string, q: { page?: number; pageSize?: number; from?: string; to?: string }) => http.get<Paginated<LedgerEntry>>(`/suppliers/${id}/ledger`, { params: clean(q as any) }).then((r) => r.data),
  createSupplier: (b: any) => http.post<Supplier>('/suppliers', b).then((r) => r.data),
  updateSupplier: (id: string, b: any) => http.patch<Supplier>(`/suppliers/${id}`, b).then((r) => r.data),
  // purchase orders
  orders: (q: OrderQuery) => http.get<Paginated<PurchaseOrder>>('/purchase-orders', { params: clean(q as any) }).then((r) => r.data),
  order: (id: string) => http.get<PurchaseOrder>(`/purchase-orders/${id}`).then((r) => r.data),
  createOrder: (b: OrderInput) => http.post<PurchaseOrder>('/purchase-orders', b, idem()).then((r) => r.data),
  updateOrder: (id: string, b: Partial<OrderInput> & { version: number }) => http.patch<PurchaseOrder>(`/purchase-orders/${id}`, b).then((r) => r.data),
  deleteOrder: (id: string) => http.delete(`/purchase-orders/${id}`),
  confirmOrder: (id: string) => http.post<PurchaseOrder>(`/purchase-orders/${id}/confirm`).then((r) => r.data),
  cancelOrder: (id: string, reason: string) => http.post<PurchaseOrder>(`/purchase-orders/${id}/cancel`, { reason }).then((r) => r.data),
  // purchase receipts
  receipts: (q: ReceiptQuery) => http.get<Paginated<PurchaseReceipt>>('/purchase-receipts', { params: clean(q as any) }).then((r) => r.data),
  receipt: (id: string) => http.get<PurchaseReceipt>(`/purchase-receipts/${id}`).then((r) => r.data),
  createReceipt: (b: ReceiptInput) => http.post<PurchaseReceipt>('/purchase-receipts', b, idem()).then((r) => r.data),
  createAndPostReceipt: (b: ReceiptInput) => http.post<PurchaseReceipt>('/purchase-receipts/post-now', b, idem()).then((r) => r.data),
  updateReceipt: (id: string, b: Partial<ReceiptInput> & { version: number }) => http.patch<PurchaseReceipt>(`/purchase-receipts/${id}`, b).then((r) => r.data),
  deleteReceipt: (id: string) => http.delete(`/purchase-receipts/${id}`),
  postReceipt: (id: string, payment?: ImmediatePayment) => http.post<PurchaseReceipt>(`/purchase-receipts/${id}/post`, payment ? { payment } : {}, idem()).then((r) => r.data),
  cancelReceipt: (id: string, reason: string) => http.post<PurchaseReceipt>(`/purchase-receipts/${id}/cancel`, { reason }, idem()).then((r) => r.data),
  // purchase returns
  returns: (q: ReturnQuery) => http.get<Paginated<PurchaseReturn>>('/purchase-returns', { params: clean(q as any) }).then((r) => r.data),
  return: (id: string) => http.get<PurchaseReturn>(`/purchase-returns/${id}`).then((r) => r.data),
  createReturn: (b: ReturnInput) => http.post<PurchaseReturn>('/purchase-returns', b, idem()).then((r) => r.data),
  createAndPostReturn: (b: ReturnInput) => http.post<PurchaseReturn>('/purchase-returns/post-now', b, idem()).then((r) => r.data),
  updateReturn: (id: string, b: Partial<ReturnInput> & { version: number }) => http.patch<PurchaseReturn>(`/purchase-returns/${id}`, b).then((r) => r.data),
  deleteReturn: (id: string) => http.delete(`/purchase-returns/${id}`),
  postReturn: (id: string, refund?: ImmediatePayment) => http.post<PurchaseReturn>(`/purchase-returns/${id}/post`, refund ? { refund } : {}, idem()).then((r) => r.data),
  cancelReturn: (id: string, reason: string) => http.post<PurchaseReturn>(`/purchase-returns/${id}/cancel`, { reason }, idem()).then((r) => r.data),
  // payments
  payments: (q: PaymentQuery) => http.get<Paginated<Payment>>('/payments', { params: clean(q as any) }).then((r) => r.data),
  payment: (id: string) => http.get<Payment>(`/payments/${id}`).then((r) => r.data),
  createPayment: (b: PaymentInput) => http.post<Payment>('/payments', b, idem()).then((r) => r.data),
  cancelPayment: (id: string, reason: string) => http.post<Payment>(`/payments/${id}/cancel`, { reason }, idem()).then((r) => r.data),
  // reports
  summary: (q: { from?: string; to?: string; supplierId?: string; branchId?: string; groupBy?: 'day' | 'month' }) => http.get<PurchaseSummary>('/purchasing/reports/summary', { params: clean(q as any) }).then((r) => r.data),
  debt: () => http.get<SupplierDebt>('/purchasing/reports/debt').then((r) => r.data),
};

export const useSuppliers = (q: SupplierQuery, enabled = true) => useQuery({ queryKey: ['suppliers', q], queryFn: () => purchasingApi.suppliers(q), placeholderData: keepPreviousData, enabled });
export const useSupplierGroups = () => useQuery({ queryKey: ['supplier-groups'], queryFn: purchasingApi.supplierGroups, staleTime: 60_000 });
export const useSupplier = (id?: string) => useQuery({ queryKey: ['supplier', id], queryFn: () => purchasingApi.supplier(id!), enabled: !!id });
export const useSupplierHistory = (id?: string) => useQuery({ queryKey: ['supplier-history', id], queryFn: () => purchasingApi.supplierHistory(id!), enabled: !!id });
export const useSupplierLedger = (id: string | undefined, q: { page?: number; pageSize?: number }) => useQuery({ queryKey: ['supplier-ledger', id, q], queryFn: () => purchasingApi.supplierLedger(id!, q), enabled: !!id, placeholderData: keepPreviousData });
export const usePurchaseOrders = (q: OrderQuery) => useQuery({ queryKey: ['purchase-orders', q], queryFn: () => purchasingApi.orders(q), placeholderData: keepPreviousData });
export const usePurchaseOrder = (id?: string) => useQuery({ queryKey: ['purchase-order', id], queryFn: () => purchasingApi.order(id!), enabled: !!id });
export const usePurchaseReceipts = (q: ReceiptQuery, enabled = true) => useQuery({ queryKey: ['purchase-receipts', q], queryFn: () => purchasingApi.receipts(q), placeholderData: keepPreviousData, enabled });
export const usePurchaseReceipt = (id?: string) => useQuery({ queryKey: ['purchase-receipt', id], queryFn: () => purchasingApi.receipt(id!), enabled: !!id });
export const usePurchaseReturns = (q: ReturnQuery) => useQuery({ queryKey: ['purchase-returns', q], queryFn: () => purchasingApi.returns(q), placeholderData: keepPreviousData });
export const usePurchaseReturn = (id?: string) => useQuery({ queryKey: ['purchase-return', id], queryFn: () => purchasingApi.return(id!), enabled: !!id });
export const usePayments = (q: PaymentQuery) => useQuery({ queryKey: ['payments', q], queryFn: () => purchasingApi.payments(q), placeholderData: keepPreviousData });
export const usePayment = (id?: string) => useQuery({ queryKey: ['payment', id], queryFn: () => purchasingApi.payment(id!), enabled: !!id });
export const usePurchaseSummary = (q: Parameters<typeof purchasingApi.summary>[0], enabled = true) => useQuery({ queryKey: ['purchase-summary', q], queryFn: () => purchasingApi.summary(q), enabled });
export const useSupplierDebt = () => useQuery({ queryKey: ['supplier-debt'], queryFn: purchasingApi.debt });

/** Query keys touched by purchasing mutations – invalidate them all after a write. */
export const PURCHASING_KEYS = ['suppliers', 'supplier', 'supplier-history', 'supplier-ledger', 'supplier-groups', 'purchase-orders', 'purchase-order', 'purchase-receipts', 'purchase-receipt', 'purchase-returns', 'purchase-return', 'payments', 'payment', 'purchase-summary', 'supplier-debt', 'balances', 'balance-summary', 'movements', 'products', 'product', 'dashboard'];
