import { keepPreviousData, useQuery } from '@tanstack/react-query';
import { clean, http } from './client';
import type { Balance, BalanceSummary, InventoryDocument, Movement, Paginated, Reservation } from './types';
import { uuid } from '../utils/format';

export interface DocLineInput { variantId: string; batchId?: string; quantity?: string; actualQuantity?: string; unitCost?: string; note?: string }
export interface DocInput { type: 'RECEIPT' | 'ISSUE' | 'ADJUSTMENT'; branchId: string; warehouseId: string; reason?: string; note?: string; lines: DocLineInput[] }
export interface DocQuery { page?: number; pageSize?: number; search?: string; type?: string; status?: string; warehouseId?: string; branchId?: string; from?: string; to?: string; sortBy?: string; sortDir?: 'asc' | 'desc' }
export interface BalanceQuery { page?: number; pageSize?: number; search?: string; warehouseId?: string; variantId?: string; productId?: string; categoryId?: string; lowStock?: string; nonZero?: string }
export interface MovementQuery { page?: number; pageSize?: number; search?: string; warehouseId?: string; variantId?: string; productId?: string; documentType?: string; documentId?: string; type?: string; from?: string; to?: string }

const idem = () => ({ headers: { 'Idempotency-Key': uuid() } });

export const inventoryApi = {
  balances: (q: BalanceQuery) => http.get<Paginated<Balance>>('/inventory/balances', { params: clean(q as any) }).then((r) => r.data),
  summary: (warehouseId?: string) => http.get<BalanceSummary>('/inventory/balances/summary', { params: clean({ warehouseId }) }).then((r) => r.data),
  movements: (q: MovementQuery) => http.get<Paginated<Movement>>('/inventory/movements', { params: clean(q as any) }).then((r) => r.data),
  documents: (q: DocQuery) => http.get<Paginated<InventoryDocument>>('/inventory/documents', { params: clean(q as any) }).then((r) => r.data),
  document: (id: string) => http.get<InventoryDocument>(`/inventory/documents/${id}`).then((r) => r.data),
  createDraft: (b: DocInput) => http.post<InventoryDocument>('/inventory/documents', b, idem()).then((r) => r.data),
  createAndPost: (b: DocInput) => http.post<InventoryDocument>('/inventory/documents/post-now', b, idem()).then((r) => r.data),
  updateDraft: (id: string, b: Partial<DocInput> & { version: number }) => http.patch<InventoryDocument>(`/inventory/documents/${id}`, b).then((r) => r.data),
  deleteDraft: (id: string) => http.delete(`/inventory/documents/${id}`),
  post: (id: string) => http.post<InventoryDocument>(`/inventory/documents/${id}/post`, {}, idem()).then((r) => r.data),
  cancel: (id: string, reason: string) => http.post<InventoryDocument>(`/inventory/documents/${id}/cancel`, { reason }, idem()).then((r) => r.data),
  reservations: (q: any) => http.get<Paginated<Reservation>>('/inventory/reservations', { params: clean(q) }).then((r) => r.data),
  reconcile: () => http.post('/inventory/reconcile').then((r) => r.data),
};

export const useBalances = (q: BalanceQuery) => useQuery({ queryKey: ['balances', q], queryFn: () => inventoryApi.balances(q), placeholderData: keepPreviousData });
export const useBalanceSummary = (warehouseId?: string) => useQuery({ queryKey: ['balance-summary', warehouseId], queryFn: () => inventoryApi.summary(warehouseId) });
export const useMovements = (q: MovementQuery, enabled = true) => useQuery({ queryKey: ['movements', q], queryFn: () => inventoryApi.movements(q), placeholderData: keepPreviousData, enabled });
export const useDocuments = (q: DocQuery) => useQuery({ queryKey: ['documents', q], queryFn: () => inventoryApi.documents(q), placeholderData: keepPreviousData });
export const useDocument = (id?: string) => useQuery({ queryKey: ['document', id], queryFn: () => inventoryApi.document(id!), enabled: !!id });
