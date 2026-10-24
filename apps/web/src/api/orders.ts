import { keepPreviousData, useQuery } from '@tanstack/react-query';
import { clean, http } from './client';
import type { Paginated } from './types';
import { uuid } from '../utils/format';

const idem = () => ({ headers: { 'Idempotency-Key': uuid() } });

// ---------------------------------------------------------------- types (Module 06 – Đặt hàng & Giao hàng)
export type OrderStatus = 'DRAFT' | 'CONFIRMED' | 'COMPLETED' | 'CANCELLED';
export type OrderSource = 'POS' | 'PHONE' | 'ONLINE' | 'FACEBOOK' | 'ZALO' | 'SHOPEE' | 'OTHER';
export type DeliveryStatus = 'PENDING' | 'PICKING' | 'DELIVERING' | 'DELIVERED' | 'RETURNING' | 'RETURNED' | 'CANCELLED';

export interface OrderLine {
  id: string; lineNo: number; variantId: string; batchId?: string | null; productUnitId?: string | null; unitName?: string | null; conversionFactor: string;
  quantity: string; baseQuantity: string; listPrice: string; unitPrice: string; discountAmount: string; taxRate: string; taxAmount: string; lineTotal: string; note?: string | null;
  variant: { id: string; sku: string; barcode?: string | null; name: string; product: { id: string; code: string; name: string; type: string; baseUnit?: string | null; trackBatch: boolean } };
  batch?: { id: string; batchNo: string } | null;
}
export interface DeliveryEvent { id: string; status: DeliveryStatus; note?: string | null; createdAt: string; createdById?: string | null }
export interface Delivery {
  id: string; code: string; status: DeliveryStatus; branchId: string; orderId?: string | null; invoiceId?: string | null; customerId?: string | null;
  receiverName: string; receiverPhone?: string | null; address: string; ward?: string | null; district?: string | null; province?: string | null;
  carrier?: string | null; trackingCode?: string | null; shippingFee: string; shippingCost: string; codAmount: string; codCollected: boolean; weightGram?: number | null;
  expectedAt?: string | null; deliveredAt?: string | null; note?: string | null; createdAt: string; updatedAt?: string;
  events?: DeliveryEvent[]; allowedNext?: DeliveryStatus[];
  order?: { id: string; code: string; status?: string; totalAmount?: string; depositAmount?: string } | null;
  invoice?: { id: string; code: string; status?: string; totalAmount?: string; paidAmount?: string } | null;
  customer?: { id: string; code?: string; name: string; phone?: string | null } | null;
  branch?: { id: string; code?: string; name: string } | null;
}
export interface OrderDeposit { id: string; paymentId: string; documentType: string; documentId: string; amount: string; payment: { id: string; code: string; status: string; method: string; paymentDate: string; amount: string; reference?: string | null } }
export interface OrderReservation { id: string; variantId: string; batchId?: string | null; quantity: string; warehouseId: string }
export interface SalesOrder {
  id: string; code: string; status: OrderStatus; source: OrderSource | string; branchId: string; warehouseId: string; customerId?: string | null; sellerId?: string | null; priceBookId?: string | null;
  orderDate: string; expectedAt?: string | null; subtotal: string; discountAmount: string; taxAmount: string; totalAmount: string; depositAmount: string; dueAmount: string; note?: string | null; version: number;
  confirmedAt?: string | null; completedAt?: string | null; cancelledAt?: string | null; cancelReason?: string | null; invoiceId?: string | null; createdAt: string;
  customer?: { id: string; code: string; name: string; phone?: string | null; address?: string | null; groupName?: string | null } | null;
  branch?: { id: string; code?: string; name: string } | null; warehouse?: { id: string; code?: string; name: string } | null;
  invoice?: { id: string; code: string; status?: string; totalAmount?: string; paidAmount?: string } | null;
  delivery?: Delivery | null;
  lines?: OrderLine[]; deposits?: OrderDeposit[]; reservations?: OrderReservation[]; _count?: { lines: number };
}

export interface OrderLineInput { variantId: string; quantity: string; unitPrice?: string; discountAmount?: string; productUnitId?: string; batchId?: string; note?: string }
export interface OrderPaymentInput { method: string; amount: string; reference?: string }
export interface DeliveryInfoInput { receiverName: string; receiverPhone?: string; address: string; ward?: string; district?: string; province?: string; carrier?: string; trackingCode?: string; shippingFee?: string; shippingCost?: string; codAmount?: string; weightGram?: number; expectedAt?: string; note?: string }
export interface OrderInput { branchId: string; warehouseId: string; customerId?: string; sellerId?: string; priceBookId?: string; source?: OrderSource; orderDate?: string; expectedAt?: string; discountAmount?: string; note?: string; lines: OrderLineInput[]; confirm?: boolean; deposits?: OrderPaymentInput[]; delivery?: DeliveryInfoInput }
export interface OrderUpdateInput { version: number; warehouseId?: string; customerId?: string | null; sellerId?: string; priceBookId?: string | null; expectedAt?: string | null; discountAmount?: string; note?: string; lines?: OrderLineInput[] }
export interface DepositInput { method: string; amount: string; cashAccountId?: string; reference?: string; note?: string }
export interface CompleteOrderInput { version?: number; payments?: OrderPaymentInput[]; warehouseId?: string }
export interface CancelOrderInput { reason: string; depositAction?: 'REFUND' | 'CREDIT' }
export interface DeliveryInput extends DeliveryInfoInput { orderId?: string; invoiceId?: string; branchId?: string }
export type DeliveryPatch = Partial<Omit<DeliveryInfoInput, 'expectedAt'>> & { expectedAt?: string | null };
export interface CodCollectInput { method: string; amount?: string; cashAccountId?: string; reference?: string }
export interface DeliveryStatusInput { status: DeliveryStatus; note?: string; collectCod?: CodCollectInput }
export interface OrderQuery { page?: number; pageSize?: number; search?: string; status?: string; branchId?: string; customerId?: string; source?: string; unpaid?: string; from?: string; to?: string; sortBy?: string; sortDir?: 'asc' | 'desc' }
export interface DeliveryQuery { page?: number; pageSize?: number; search?: string; status?: string; branchId?: string; carrier?: string; codPending?: string; from?: string; to?: string; sortBy?: string; sortDir?: 'asc' | 'desc' }
export interface CompleteOrderResult { order: SalesOrder; invoice: { id: string; code: string; status: string; totalAmount: string; paidAmount: string; dueAmount?: string; customerId?: string | null } & Record<string, unknown> }

// ---------------------------------------------------------------- api
export const ordersApi = {
  list: (q: OrderQuery) => http.get<Paginated<SalesOrder>>('/orders', { params: clean(q as any) }).then((r) => r.data),
  get: (id: string) => http.get<SalesOrder>(`/orders/${id}`).then((r) => r.data),
  create: (b: OrderInput) => http.post<SalesOrder>('/orders', b, idem()).then((r) => r.data),
  update: (id: string, b: OrderUpdateInput) => http.patch<SalesOrder>(`/orders/${id}`, b).then((r) => r.data),
  remove: (id: string) => http.delete(`/orders/${id}`),
  confirm: (id: string, version?: number) => http.post<SalesOrder>(`/orders/${id}/confirm`, { version }, idem()).then((r) => r.data),
  unconfirm: (id: string) => http.post<SalesOrder>(`/orders/${id}/unconfirm`, {}).then((r) => r.data),
  deposit: (id: string, b: DepositInput) => http.post<SalesOrder>(`/orders/${id}/deposit`, b, idem()).then((r) => r.data),
  complete: (id: string, b: CompleteOrderInput) => http.post<CompleteOrderResult>(`/orders/${id}/complete`, b, idem()).then((r) => r.data),
  cancel: (id: string, b: CancelOrderInput) => http.post<SalesOrder>(`/orders/${id}/cancel`, b, idem()).then((r) => r.data),
};

export const deliveriesApi = {
  list: (q: DeliveryQuery) => http.get<Paginated<Delivery>>('/deliveries', { params: clean(q as any) }).then((r) => r.data),
  get: (id: string) => http.get<Delivery>(`/deliveries/${id}`).then((r) => r.data),
  create: (b: DeliveryInput) => http.post<Delivery>('/deliveries', b, idem()).then((r) => r.data),
  update: (id: string, b: DeliveryPatch) => http.patch<Delivery>(`/deliveries/${id}`, b).then((r) => r.data),
  setStatus: (id: string, b: DeliveryStatusInput) => http.post<Delivery>(`/deliveries/${id}/status`, b, idem()).then((r) => r.data),
  collectCod: (id: string, b: CodCollectInput) => http.post<Delivery>(`/deliveries/${id}/collect-cod`, b, idem()).then((r) => r.data),
};

// ---------------------------------------------------------------- hooks
export const useOrders = (q: OrderQuery, enabled = true) => useQuery({ queryKey: ['orders', q], queryFn: () => ordersApi.list(q), placeholderData: keepPreviousData, enabled });
export const useOrder = (id?: string) => useQuery({ queryKey: ['order', id], queryFn: () => ordersApi.get(id!), enabled: !!id });
export const useDeliveries = (q: DeliveryQuery, enabled = true) => useQuery({ queryKey: ['deliveries', q], queryFn: () => deliveriesApi.list(q), placeholderData: keepPreviousData, enabled });
export const useDelivery = (id?: string) => useQuery({ queryKey: ['delivery', id], queryFn: () => deliveriesApi.get(id!), enabled: !!id });

/** Query keys touched by order / delivery mutations – invalidate them all after a write. */
export const ORDER_KEYS = ['orders', 'order', 'deliveries', 'delivery', 'invoices', 'invoice', 'payments', 'payment', 'customers', 'customer', 'customer-history', 'customer-ledger', 'customer-debt', 'balances', 'balance-summary', 'movements', 'products', 'product', 'cash-accounts', 'cash-book', 'cash-summary', 'shift-current', 'dashboard'];
