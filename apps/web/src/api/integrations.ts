import { keepPreviousData, useQuery } from '@tanstack/react-query';
import { clean, http } from './client';
import type { Paginated } from './types';

// ---------------------------------------------------------------- types
export type ImportType = 'PRODUCTS' | 'CUSTOMERS' | 'SUPPLIERS' | 'INVOICES';
export type ImportSource = 'EXCEL' | 'KIOTVIET_API';
export type ImportJobStatus = 'PREVIEW' | 'RUNNING' | 'DONE' | 'FAILED';

export interface ImportOptions {
  /** cột tồn kho → kho nhận (khi file có nhiều cột "Tồn kho (<chi nhánh>)") */
  stockColumns?: Array<{ header: string; warehouseId: string }>;
  /** kho nhận tồn khi file chỉ có một cột "Tồn kho" */
  defaultWarehouseId?: string;
  /** đưa công nợ KH/NCC đã có về đúng số trong file */
  syncDebt?: boolean;
  /** cập nhật bản ghi đã có (mặc định true) */
  updateExisting?: boolean;
  /** nhập tồn kho từ file (mặc định true) */
  importStock?: boolean;
  /** hóa đơn: tên chi nhánh KiotViet → id chi nhánh */
  branchMap?: Record<string, string>;
  defaultBranchId?: string;
  /** bỏ qua hóa đơn trước ngày (ISO) */
  invoicesFrom?: string;
}
export interface ImportField { key: string; label: string; aliases: string[]; required?: boolean }
export interface ImportIssue { row: number; code?: string; error: string }
/** Raw Excel row keyed by header; `__row` is the Excel row number. */
export type ImportRawRow = Record<string, string>;
export interface ImportPreview {
  jobId: string; type: ImportType; fileName: string | null; rowCount: number; headers: string[];
  mapping: Record<string, string>; unmapped: string[]; missing: string[]; stockHeaders: string[];
  sample: ImportRawRow[]; issues: ImportIssue[]; fields: ImportField[];
}
export interface ImportTotals { rows: number; created: number; updated: number; skipped: number; failed: number; stockLines?: number; stockDocuments?: number; units?: number; debtAdjusted?: number }
export interface ImportCommitResult extends ImportTotals { jobId: string; type: ImportType; errors: ImportIssue[] }
export interface ImportJob {
  id: string; type: ImportType; source: ImportSource; status: ImportJobStatus; fileName: string | null; rowCount: number;
  totals: ImportTotals | null; startedAt: string | null; finishedAt: string | null; createdAt: string; createdById?: string | null;
}
export interface ImportJobDetail extends ImportJob {
  errors: ImportIssue[] | null; mapping: Record<string, string> | null; options: ImportOptions | null; headers: string[] | null;
  sample: ImportRawRow[]; fields: ImportField[];
}
export interface ImportJobQuery { type?: ImportType; page?: number; pageSize?: number }
export interface Reconcile {
  products: { products: number; variants: number; withStock: number };
  stock: { quantity: string | number; value: string | number };
  customers: { count: number; debtors: number; receivable: string | number; credit: string | number };
  suppliers: { count: number; creditors: number; payable: string | number };
  importedInvoices: { count: number; revenue: string | number; first: string | null; last: string | null };
  recentJobs: Array<{ id: string; type: ImportType; source: ImportSource; totals: ImportTotals | null; finishedAt: string | null }>;
}
export type KiotVietStatus = 'DISCONNECTED' | 'CONFIGURED' | 'CONNECTED' | 'ERROR';
export interface KiotVietConnection {
  provider: 'KIOTVIET'; status: KiotVietStatus; retailer: string | null; clientId: string | null; hasSecret: boolean;
  branchMap: Record<string, string>; lastTestAt: string | null; lastSyncAt: string | null; lastError: string | null;
}
export interface KiotVietSaveBody { retailer: string; clientId: string; clientSecret?: string; branchMap?: Record<string, string> }
export interface KiotVietTestResult { ok: boolean; branches: Array<{ id: number; name: string; address?: string | null }>; warehouses: Array<{ id: string; name: string; branch: string }> }
export interface KiotVietImportBody {
  entities: ImportType[]; branchMap?: Record<string, string>; defaultWarehouseId?: string; defaultBranchId?: string;
  syncDebt?: boolean; updateExisting?: boolean; importStock?: boolean; invoicesFrom?: string; invoicesTo?: string;
}
export interface KiotVietImportResult { results: Array<{ entity: ImportType; jobId: string; totals: ImportCommitResult; errors: ImportIssue[] }>; reconcile: Reconcile }

/** Pulling a whole shop through the KiotViet API can take minutes. */
const KIOTVIET_IMPORT_TIMEOUT = 10 * 60 * 1000;

// ---------------------------------------------------------------- api
export const integrationsApi = {
  previewImport: (file: File, type: ImportType, options: ImportOptions = {}) => {
    const fd = new FormData();
    fd.append('file', file);
    fd.append('type', type);
    fd.append('options', JSON.stringify(clean(options as Record<string, unknown>)));
    return http.post<ImportPreview>('/integrations/import/preview', fd, { headers: { 'Content-Type': 'multipart/form-data' }, timeout: 5 * 60 * 1000 }).then((r) => r.data);
  },
  commitImport: (jobId: string, body: { mapping?: Record<string, string>; options?: ImportOptions } = {}) =>
    http.post<ImportCommitResult>(`/integrations/import/${jobId}/commit`, body, { timeout: KIOTVIET_IMPORT_TIMEOUT }).then((r) => r.data),
  jobs: (q: ImportJobQuery = {}) => http.get<Paginated<ImportJob>>('/integrations/import-jobs', { params: clean(q as Record<string, unknown>) }).then((r) => r.data),
  job: (id: string) => http.get<ImportJobDetail>(`/integrations/import-jobs/${id}`).then((r) => r.data),
  reconcile: () => http.get<Reconcile>('/integrations/reconcile').then((r) => r.data),
  getKiotViet: () => http.get<KiotVietConnection>('/integrations/kiotviet').then((r) => r.data),
  saveKiotViet: (body: KiotVietSaveBody) => http.put<KiotVietConnection>('/integrations/kiotviet', clean(body as unknown as Record<string, unknown>)).then((r) => r.data),
  removeKiotViet: () => http.delete<{ ok: boolean }>('/integrations/kiotviet').then((r) => r.data),
  testKiotViet: () => http.post<KiotVietTestResult>('/integrations/kiotviet/test', {}, { timeout: 2 * 60 * 1000 }).then((r) => r.data),
  importKiotViet: (body: KiotVietImportBody) => http.post<KiotVietImportResult>('/integrations/kiotviet/import', clean(body as unknown as Record<string, unknown>), { timeout: KIOTVIET_IMPORT_TIMEOUT }).then((r) => r.data),
};

// ---------------------------------------------------------------- hooks
export const useImportJobs = (q: ImportJobQuery, enabled = true) => useQuery({ queryKey: ['import-jobs', q], queryFn: () => integrationsApi.jobs(q), placeholderData: keepPreviousData, enabled });
export const useImportJob = (id?: string | null) => useQuery({ queryKey: ['import-job', id], queryFn: () => integrationsApi.job(id!), enabled: !!id });
export const useReconcile = (enabled = true) => useQuery({ queryKey: ['integrations-reconcile'], queryFn: integrationsApi.reconcile, enabled });
export const useKiotViet = (enabled = true) => useQuery({ queryKey: ['kiotviet-connection'], queryFn: integrationsApi.getKiotViet, enabled });
