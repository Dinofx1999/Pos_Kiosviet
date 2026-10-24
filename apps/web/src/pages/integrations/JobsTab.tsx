import { Button, Card, Empty, Pagination, Select, Skeleton, Table } from 'antd';
import { ReloadOutlined } from '@ant-design/icons';
import { useState } from 'react';
import { type ImportJob, type ImportJobQuery, type ImportType, useImportJobs } from '../../api/integrations';
import { errMsg } from '../../api/client';
import { useIsMobile } from '../../hooks/useMedia';
import { dt, qty } from '../../utils/format';
import { IMPORT_TYPE_LABEL, IMPORT_TYPE_OPTIONS, JobDrawer, SourceTag, StatusTag, totalsSummary } from './shared';

export function JobsTab() {
  const isMobile = useIsMobile();
  const [q, setQ] = useState<ImportJobQuery>({ page: 1, pageSize: 20 });
  const { data, isLoading, isFetching, error, refetch } = useImportJobs(q);
  const [jobId, setJobId] = useState<string | null>(null);
  const rows = data?.data ?? [];
  return (
    <div className="ig-jobs">
      <div className="kv-toolbar">
        <Select allowClear placeholder="Loại dữ liệu" value={q.type} style={{ width: isMobile ? '100%' : 180 }} options={IMPORT_TYPE_OPTIONS} onChange={(v: ImportType | undefined) => setQ((s) => ({ ...s, page: 1, type: v }))} />
        <span className="spacer" />
        <Button icon={<ReloadOutlined />} loading={isFetching} onClick={() => refetch()}>Làm mới</Button>
      </div>
      {isMobile ? (
        <div className="ig-job-cards">
          {isLoading ? <Skeleton active /> : rows.length === 0 ? <Empty description={error ? errMsg(error) : 'Chưa có lần nhập nào'} /> : rows.map((j) => <JobCard key={j.id} j={j} onClick={() => setJobId(j.id)} />)}
          {(data?.meta.total ?? 0) > (q.pageSize ?? 20) && <div className="ig-pager"><Pagination simple current={q.page} pageSize={q.pageSize} total={data?.meta.total ?? 0} onChange={(p) => setQ((s) => ({ ...s, page: p }))} /></div>}
        </div>
      ) : (
        <Card size="small" className="ig-card">
          <Table className="kv-table" size="small" rowKey="id" loading={isLoading} dataSource={rows} onRow={(r) => ({ onClick: () => setJobId(r.id) })}
            locale={{ emptyText: <Empty description={error ? errMsg(error) : 'Chưa có lần nhập nào'} /> }}
            onChange={(p) => setQ((s) => ({ ...s, page: p.current ?? 1, pageSize: p.pageSize ?? 20 }))}
            pagination={{ current: q.page, pageSize: q.pageSize, total: data?.meta.total ?? 0, showSizeChanger: true, showTotal: (t) => `${t} lần nhập` }}
            columns={[
              { title: 'Thời gian', dataIndex: 'createdAt', width: 150, render: (v) => dt(v) },
              { title: 'Loại', dataIndex: 'type', width: 130, render: (v) => IMPORT_TYPE_LABEL[v as ImportType] ?? v },
              { title: 'Nguồn', dataIndex: 'source', width: 130, render: (v) => <SourceTag source={v} /> },
              { title: 'File', dataIndex: 'fileName', ellipsis: true, render: (v) => v ?? <span className="muted">—</span> },
              { title: 'Số dòng', dataIndex: 'rowCount', width: 90, className: 'num', render: (v) => qty(v) },
              { title: 'Kết quả', width: 260, render: (_, r) => totalsSummary(r.totals) },
              { title: 'Trạng thái', dataIndex: 'status', width: 130, render: (v) => <StatusTag status={v} /> },
              { title: 'Kết thúc', dataIndex: 'finishedAt', width: 150, render: (v) => v ? dt(v) : '—' },
            ]} />
        </Card>
      )}
      <JobDrawer id={jobId} onClose={() => setJobId(null)} />
    </div>
  );
}

function JobCard({ j, onClick }: { j: ImportJob; onClick: () => void }) {
  return (
    <button type="button" className="ig-job-card" onClick={onClick}>
      <div className="ig-job-head"><b>{IMPORT_TYPE_LABEL[j.type] ?? j.type}</b><span className="ig-job-tags"><SourceTag source={j.source} /><StatusTag status={j.status} /></span></div>
      {j.fileName && <div className="ig-job-file">{j.fileName}</div>}
      <div className="ig-job-meta">{qty(j.rowCount)} dòng · {totalsSummary(j.totals)}</div>
      <div className="kv-hint">{dt(j.createdAt)}{j.finishedAt ? ` → ${dt(j.finishedAt, 'HH:mm')}` : ''}</div>
    </button>
  );
}
