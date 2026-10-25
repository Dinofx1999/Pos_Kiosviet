import { Button, Descriptions, Drawer, Empty, Skeleton, Tag } from 'antd';
import Table from '../../components/ResponsiveTable';
import { DownloadOutlined } from '@ant-design/icons';
import type { ReactNode } from 'react';
import { useImportJob, type ImportIssue, type ImportJobStatus, type ImportSource, type ImportTotals, type ImportType } from '../../api/integrations';
import { errMsg } from '../../api/client';
import { useIsMobile } from '../../hooks/useMedia';
import { downloadBlob, dt, qty } from '../../utils/format';

export const IMPORT_TYPE_LABEL: Record<ImportType, string> = { PRODUCTS: 'Hàng hóa', CUSTOMERS: 'Khách hàng', SUPPLIERS: 'Nhà cung cấp', INVOICES: 'Hóa đơn' };
export const IMPORT_SOURCE_LABEL: Record<ImportSource, string> = { EXCEL: 'Excel', KIOTVIET_API: 'KiotViet API' };
export const JOB_STATUS_LABEL: Record<ImportJobStatus, string> = { PREVIEW: 'Đang xem trước', RUNNING: 'Đang chạy', DONE: 'Hoàn thành', FAILED: 'Thất bại' };
export const JOB_STATUS_COLOR: Record<ImportJobStatus, string> = { PREVIEW: 'default', RUNNING: 'processing', DONE: 'green', FAILED: 'red' };
export const IMPORT_TYPE_OPTIONS = (Object.keys(IMPORT_TYPE_LABEL) as ImportType[]).map((value) => ({ value, label: IMPORT_TYPE_LABEL[value] }));

export const StatusTag = ({ status }: { status: ImportJobStatus }) => <Tag color={JOB_STATUS_COLOR[status] ?? 'default'}>{JOB_STATUS_LABEL[status] ?? status}</Tag>;
export const SourceTag = ({ source }: { source: ImportSource }) => <Tag color={source === 'KIOTVIET_API' ? 'purple' : 'blue'}>{IMPORT_SOURCE_LABEL[source] ?? source}</Tag>;

/** Short "12 mới · 3 cập nhật · 1 lỗi" summary for a job row. */
export function totalsSummary(t?: ImportTotals | null): string {
  if (!t) return '—';
  const parts = [`${t.created} mới`, `${t.updated} cập nhật`];
  if (t.skipped) parts.push(`${t.skipped} bỏ qua`);
  if (t.failed) parts.push(`${t.failed} lỗi`);
  return parts.join(' · ');
}

/** Tiles for an import result (shared by the Excel flow, the KiotViet flow and the job drawer). */
export function ResultTiles({ totals, type }: { totals: ImportTotals; type?: ImportType }) {
  const tiles: Array<{ key: string; label: string; value: number | undefined; tone?: 'pos' | 'neg' | 'muted' | 'info' }> = [
    { key: 'rows', label: 'Số dòng', value: totals.rows, tone: 'muted' },
    { key: 'created', label: 'Tạo mới', value: totals.created, tone: 'pos' },
    { key: 'updated', label: 'Cập nhật', value: totals.updated, tone: 'info' },
    { key: 'skipped', label: 'Bỏ qua', value: totals.skipped, tone: 'muted' },
    { key: 'failed', label: 'Lỗi', value: totals.failed, tone: totals.failed ? 'neg' : 'muted' },
  ];
  if (type === 'PRODUCTS' || totals.stockLines !== undefined) tiles.push({ key: 'stockLines', label: 'Dòng tồn kho', value: totals.stockLines ?? 0, tone: 'info' });
  if (type === 'PRODUCTS' || totals.stockDocuments !== undefined) tiles.push({ key: 'stockDocuments', label: 'Phiếu điều chỉnh', value: totals.stockDocuments ?? 0, tone: 'muted' });
  if (type === 'PRODUCTS' || totals.units !== undefined) tiles.push({ key: 'units', label: 'Đơn vị quy đổi', value: totals.units ?? 0, tone: 'muted' });
  if (type === 'CUSTOMERS' || type === 'SUPPLIERS' || totals.debtAdjusted !== undefined) tiles.push({ key: 'debtAdjusted', label: 'Công nợ điều chỉnh', value: totals.debtAdjusted ?? 0, tone: 'info' });
  return (
    <div className="ig-tiles">
      {tiles.map((t) => (
        <div key={t.key} className={`ig-tile ig-tile-${t.tone ?? 'muted'}${qty(t.value ?? 0).length > 9 ? ' long' : ''}`}>
          <div className="ig-tile-v">{qty(t.value ?? 0)}</div>
          <div className="ig-tile-l">{t.label}</div>
        </div>
      ))}
    </div>
  );
}

/** Client-side CSV of row errors (UTF-8 BOM so Excel opens Vietnamese correctly). */
export function downloadErrorsCsv(errors: ImportIssue[], name: string) {
  const esc = (v: unknown) => `"${String(v ?? '').replace(/"/g, '""')}"`;
  const lines = ['Dòng,Mã,Lỗi', ...errors.map((e) => [e.row, e.code ?? '', e.error].map(esc).join(','))];
  downloadBlob(new Blob(['﻿' + lines.join('\r\n')], { type: 'text/csv;charset=utf-8' }), name);
}

export function ErrorTable({ errors, fileName, title }: { errors: ImportIssue[]; fileName?: string; title?: ReactNode }) {
  const isMobile = useIsMobile();
  if (!errors.length) return null;
  return (
    <div className="ig-errors">
      <div className="ig-errors-head">
        <b>{title ?? `Lỗi theo dòng (${errors.length})`}</b>
        <Button size="small" icon={<DownloadOutlined />} onClick={() => downloadErrorsCsv(errors, fileName ?? 'loi-nhap-du-lieu.csv')}>Tải lỗi (.csv)</Button>
      </div>
      {isMobile ? (
        <div className="ig-error-cards">
          {errors.slice(0, 200).map((e, i) => (
            <div key={`${e.row}-${i}`} className="ig-error-card">
              <div className="ig-error-meta"><span>Dòng <b>{e.row}</b></span>{e.code && <code>{e.code}</code>}</div>
              <div className="ig-error-msg">{e.error}</div>
            </div>
          ))}
        </div>
      ) : (
        <Table size="small" rowKey={(e, i) => `${e.row}-${i}`} pagination={errors.length > 20 ? { pageSize: 20, size: 'small' } : false} dataSource={errors}
          columns={[{ title: 'Dòng', dataIndex: 'row', width: 80, className: 'num' }, { title: 'Mã', dataIndex: 'code', width: 160, render: (v) => v ? <code>{v}</code> : '—' }, { title: 'Lỗi', dataIndex: 'error' }]} />
      )}
    </div>
  );
}

/** Job detail drawer: totals + errors + mapping; used by the reconcile tab and the history tab. */
export function JobDrawer({ id, onClose }: { id: string | null; onClose: () => void }) {
  const { data, isLoading, error } = useImportJob(id);
  const isMobile = useIsMobile();
  return (
    <Drawer title={data ? `${IMPORT_TYPE_LABEL[data.type] ?? data.type} · ${IMPORT_SOURCE_LABEL[data.source] ?? data.source}` : 'Chi tiết lần nhập'} open={!!id} onClose={onClose} width={isMobile ? undefined : 720} destroyOnHidden>
      {isLoading && <Skeleton active />}
      {error && <Empty description={errMsg(error)} />}
      {data && (
        <>
          <Descriptions size="small" column={isMobile ? 1 : 2} bordered className="ig-desc">
            <Descriptions.Item label="Trạng thái"><StatusTag status={data.status} /></Descriptions.Item>
            <Descriptions.Item label="Nguồn"><SourceTag source={data.source} /></Descriptions.Item>
            <Descriptions.Item label="File">{data.fileName ?? '—'}</Descriptions.Item>
            <Descriptions.Item label="Số dòng">{qty(data.rowCount)}</Descriptions.Item>
            <Descriptions.Item label="Bắt đầu">{data.startedAt ? dt(data.startedAt, 'DD/MM/YYYY HH:mm:ss') : '—'}</Descriptions.Item>
            <Descriptions.Item label="Kết thúc">{data.finishedAt ? dt(data.finishedAt, 'DD/MM/YYYY HH:mm:ss') : '—'}</Descriptions.Item>
          </Descriptions>
          {data.totals && <ResultTiles totals={data.totals} type={data.type} />}
          {data.status === 'PREVIEW' && <div className="kv-hint" style={{ margin: '8px 0' }}>Lần nhập này mới ở bước xem trước, chưa ghi dữ liệu nào.</div>}
          {data.mapping && Object.keys(data.mapping).length > 0 && (
            <details className="ig-mapping-details">
              <summary>Ánh xạ cột đã dùng ({Object.keys(data.mapping).length})</summary>
              <div className="kv-kv">
                {Object.entries(data.mapping).map(([field, header]) => <span key={field} className="k" style={{ display: 'contents' }}><span className="k">{data.fields.find((f) => f.key === field)?.label ?? field}</span><span className="v">{header}</span></span>)}
              </div>
            </details>
          )}
          <ErrorTable errors={data.errors ?? []} fileName={`loi-${(data.type ?? 'import').toLowerCase()}-${data.id.slice(0, 8)}.csv`} />
        </>
      )}
    </Drawer>
  );
}
