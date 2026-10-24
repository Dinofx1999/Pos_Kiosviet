import { keepPreviousData, useQuery } from '@tanstack/react-query';
import { clean, http } from './client';
import type { Movement, Paginated } from './types';
import { uuid } from '../utils/format';

// ====================================================================== types
export type TransferStatus = 'DRAFT' | 'IN_TRANSIT' | 'RECEIVED' | 'CANCELLED';
export type ShortageAction = 'WRITE_OFF' | 'RETURN_TO_SOURCE';
export type StocktakeStatus = 'DRAFT' | 'COMPLETED' | 'CANCELLED';
export type StocktakeScope = 'SELECTED' | 'ALL';
export type UncountedAs = 'SKIP' | 'ZERO';

export interface NamedRef { id: string; name: string; code?: string }
export interface TransferVariant { id: string; sku: string; barcode?: string | null; name: string; costPrice?: string; product: { id: string; code: string; name: string; baseUnit?: string | null; trackBatch: boolean; categoryId?: string | null } }
export interface BatchRef { id: string; batchNo: string; expiryDate?: string | null }

export interface TransferLine {
  id: string; lineNo: number; variantId: string; batchId?: string | null; quantity: string; receivedQuantity?: string | null;
  unitCost?: string; totalCost?: string; note?: string | null; variant: TransferVariant; batch?: BatchRef | null;
}
export interface TransferRow {
  id: string; code: string; status: TransferStatus; fromBranchId: string; fromWarehouseId: string; toBranchId: string; toWarehouseId: string;
  fromWarehouse: NamedRef; toWarehouse: NamedRef; fromBranch: NamedRef; toBranch: NamedRef;
  note?: string | null; totalQuantity: string; totalCost?: string; receivedQuantity: string; shortageQuantity: string; shortageValue?: string; shortageAction?: ShortageAction | null; receiveNote?: string | null;
  dispatchedAt?: string | null; receivedAt?: string | null; cancelledAt?: string | null; cancelReason?: string | null; version: number; createdById?: string | null; createdAt: string;
  _count?: { lines: number };
}
export interface Transfer extends TransferRow { lines: TransferLine[]; movements: Movement[] }

export interface TransferLineInput { variantId: string; batchId?: string; quantity: string; note?: string }
export interface TransferInput { fromWarehouseId: string; toWarehouseId: string; note?: string; lines: TransferLineInput[] }
export interface TransferUpdateInput { version: number; toWarehouseId?: string; note?: string; lines?: TransferLineInput[] }
export interface ReceiveLineInput { lineId: string; receivedQuantity: string; note?: string }
export interface ReceiveInput { version?: number; lines?: ReceiveLineInput[]; shortageAction?: ShortageAction; note?: string }
export interface TransferQuery { page?: number; pageSize?: number; search?: string; status?: TransferStatus | string; fromWarehouseId?: string; toWarehouseId?: string; branchId?: string; direction?: 'in' | 'out'; from?: string; to?: string; sortBy?: string; sortDir?: 'asc' | 'desc' }

export interface StocktakeLine {
  id: string; stocktakeId: string; variantId: string; batchId?: string | null; batchKey: string; systemQuantity: string; countedQuantity: string | null; deltaQuantity: string;
  unitCost?: string; deltaValue?: string; currentOnHand?: string; pendingDelta: string | null; countedById?: string | null; countedAt?: string | null; note?: string | null;
  variant: TransferVariant; batch?: BatchRef | null;
}
export interface StocktakeRow {
  id: string; code: string; status: StocktakeStatus; branchId: string; warehouseId: string; scope: StocktakeScope | string; note?: string | null; snapshotAt: string;
  totalLines: number; countedLines: number; increaseQuantity: string; decreaseQuantity: string; increaseValue?: string; decreaseValue?: string; uncountedAs?: UncountedAs | string | null;
  completedAt?: string | null; cancelledAt?: string | null; cancelReason?: string | null; version: number; createdById?: string | null; createdAt: string;
  warehouse: NamedRef; branch: NamedRef;
}
export interface Stocktake extends StocktakeRow { lines: StocktakeLine[]; movements: Movement[] }

export interface StocktakeLineInput { variantId: string; batchId?: string; countedQuantity?: string; note?: string }
export interface StocktakeInput { warehouseId: string; scope?: StocktakeScope; categoryId?: string; note?: string; lines?: StocktakeLineInput[] }
export interface StocktakeQuery { page?: number; pageSize?: number; search?: string; status?: StocktakeStatus | string; warehouseId?: string; branchId?: string; from?: string; to?: string; sortBy?: string; sortDir?: 'asc' | 'desc' }

// ====================================================================== labels
export const TRANSFER_STATUS_LABEL: Record<string, string> = { DRAFT: 'Phiếu tạm', IN_TRANSIT: 'Đang chuyển', RECEIVED: 'Đã nhận', CANCELLED: 'Đã hủy' };
export const TRANSFER_STATUS_COLOR: Record<string, string> = { DRAFT: 'default', IN_TRANSIT: 'blue', RECEIVED: 'green', CANCELLED: 'red' };
export const SHORTAGE_ACTION_LABEL: Record<string, string> = { WRITE_OFF: 'Ghi nhận thất thoát', RETURN_TO_SOURCE: 'Trả về kho nguồn' };
export const STOCKTAKE_STATUS_LABEL: Record<string, string> = { DRAFT: 'Đang kiểm', COMPLETED: 'Đã cân bằng', CANCELLED: 'Đã hủy' };
export const STOCKTAKE_STATUS_COLOR: Record<string, string> = { DRAFT: 'gold', COMPLETED: 'green', CANCELLED: 'red' };
export const STOCKTAKE_SCOPE_LABEL: Record<string, string> = { SELECTED: 'Chọn hàng', ALL: 'Toàn bộ kho' };

/** Query keys touched by transfer / stocktake mutations (stock balances and movements change too). */
export const TRANSFER_KEYS = ['transfers', 'transfer', 'stocktakes', 'stocktake', 'balances', 'balance-summary', 'movements', 'products', 'product', 'dashboard'];

const idem = () => ({ headers: { 'Idempotency-Key': uuid() } });

// ====================================================================== api
export const transfersApi = {
  list: (q: TransferQuery) => http.get<Paginated<TransferRow>>('/transfers', { params: clean(q as any) }).then((r) => r.data),
  get: (id: string) => http.get<Transfer>(`/transfers/${id}`).then((r) => r.data),
  create: (b: TransferInput) => http.post<Transfer>('/transfers', b, idem()).then((r) => r.data),
  dispatchNow: (b: TransferInput) => http.post<Transfer>('/transfers/dispatch-now', b, idem()).then((r) => r.data),
  update: (id: string, b: TransferUpdateInput) => http.patch<Transfer>(`/transfers/${id}`, b).then((r) => r.data),
  remove: (id: string) => http.delete(`/transfers/${id}`),
  dispatch: (id: string, version?: number) => http.post<Transfer>(`/transfers/${id}/dispatch`, clean({ version }), idem()).then((r) => r.data),
  receive: (id: string, b: ReceiveInput) => http.post<Transfer>(`/transfers/${id}/receive`, b, idem()).then((r) => r.data),
  cancel: (id: string, reason: string) => http.post<Transfer>(`/transfers/${id}/cancel`, { reason }, idem()).then((r) => r.data),
};

export const stocktakesApi = {
  list: (q: StocktakeQuery) => http.get<Paginated<StocktakeRow>>('/stocktakes', { params: clean(q as any) }).then((r) => r.data),
  get: (id: string) => http.get<Stocktake>(`/stocktakes/${id}`).then((r) => r.data),
  create: (b: StocktakeInput) => http.post<Stocktake>('/stocktakes', b, idem()).then((r) => r.data),
  update: (id: string, b: { version: number; note?: string }) => http.patch<Stocktake>(`/stocktakes/${id}`, b).then((r) => r.data),
  count: (id: string, lines: StocktakeLineInput[]) => http.post<Stocktake>(`/stocktakes/${id}/lines`, { lines }).then((r) => r.data),
  removeLine: (id: string, lineId: string) => http.delete<Stocktake>(`/stocktakes/${id}/lines/${lineId}`).then((r) => r.data),
  refreshSnapshot: (id: string) => http.post<Stocktake>(`/stocktakes/${id}/refresh-snapshot`, {}).then((r) => r.data),
  complete: (id: string, b: { version?: number; uncountedAs?: UncountedAs }) => http.post<Stocktake>(`/stocktakes/${id}/complete`, clean(b as any), idem()).then((r) => r.data),
  cancel: (id: string, reason: string) => http.post<Stocktake>(`/stocktakes/${id}/cancel`, { reason }, idem()).then((r) => r.data),
};

// ====================================================================== hooks
export const useTransfers = (q: TransferQuery, enabled = true) => useQuery({ queryKey: ['transfers', q], queryFn: () => transfersApi.list(q), placeholderData: keepPreviousData, enabled });
export const useTransfer = (id?: string) => useQuery({ queryKey: ['transfer', id], queryFn: () => transfersApi.get(id!), enabled: !!id });
export const useStocktakes = (q: StocktakeQuery, enabled = true) => useQuery({ queryKey: ['stocktakes', q], queryFn: () => stocktakesApi.list(q), placeholderData: keepPreviousData, enabled });
export const useStocktake = (id?: string) => useQuery({ queryKey: ['stocktake', id], queryFn: () => stocktakesApi.get(id!), enabled: !!id });
