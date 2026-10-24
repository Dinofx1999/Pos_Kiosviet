import { Button, DatePicker, Empty, Input, Select, Table, Tag } from 'antd';
import { ReloadOutlined, SearchOutlined } from '@ant-design/icons';
import { useState } from 'react';
import { Link, useSearchParams } from 'react-router-dom';
import { MovementQuery, useMovements } from '../../api/inventory';
import { errMsg } from '../../api/client';
import { FilterCard, FilterPanel } from '../../components/FilterPanel';
import { useBranchWarehouses, useCan } from '../../store/auth';
import { MOVEMENT_LABEL, REASON_LABEL, dt, money, qty, signedQty } from '../../utils/format';

export default function MovementsPage() {
  const can = useCan();
  const [sp] = useSearchParams();
  const warehouses = useBranchWarehouses();
  const [q, setQ] = useState<MovementQuery>({ page: 1, pageSize: 20, documentId: sp.get('documentId') ?? undefined, variantId: sp.get('variantId') ?? undefined });
  const [searchText, setSearchText] = useState('');
  const { data, isLoading, isFetching, error, refetch } = useMovements(q);
  const set = (patch: Partial<MovementQuery>) => setQ((s) => ({ ...s, ...patch, page: patch.page ?? 1 }));
  const canSeeCost = can('inventory.cost.view');

  return (
    <div className="kv-list">
      <FilterPanel>
        <FilterCard title="Kho hàng"><Select allowClear size="small" style={{ width: '100%' }} placeholder="Tất cả kho" value={q.warehouseId} onChange={(v) => set({ warehouseId: v })} options={warehouses.map((w) => ({ value: w.id, label: w.name }))} /></FilterCard>
        <FilterCard title="Loại giao dịch"><Select allowClear size="small" style={{ width: '100%' }} placeholder="Tất cả" value={q.type} onChange={(v) => set({ type: v })} options={Object.entries(MOVEMENT_LABEL).map(([value, label]) => ({ value, label }))} /></FilterCard>
        <FilterCard title="Thời gian"><DatePicker.RangePicker size="small" style={{ width: '100%' }} format="DD/MM/YYYY" onChange={(r) => set({ from: r?.[0]?.startOf('day').toISOString(), to: r?.[1]?.endOf('day').toISOString() })} /></FilterCard>
      </FilterPanel>
      <div className="kv-main">
        <h1 className="kv-page-title">Thẻ kho / Lịch sử biến động</h1>
        <div className="kv-toolbar">
          <Input.Search className="kv-search" allowClear placeholder="Theo mã chứng từ, mã/tên hàng" value={searchText} onChange={(e) => setSearchText(e.target.value)} onSearch={(v) => set({ search: v || undefined, documentId: undefined, variantId: undefined })} enterButton={<SearchOutlined />} />
          {q.documentId && <Tag closable onClose={() => set({ documentId: undefined })}>Theo chứng từ</Tag>}
          <span className="spacer" />
          <Button icon={<ReloadOutlined />} onClick={() => refetch()} loading={isFetching} />
        </div>
        <div className="kv-card">
          <Table className="kv-table" rowKey="id" size="small" loading={isLoading} dataSource={data?.data ?? []} scroll={{ x: 900 }}
            locale={{ emptyText: error ? <Empty description={errMsg(error)} /> : <Empty description="Chưa có giao dịch kho" /> }}
            onChange={(p) => set({ page: p.current, pageSize: p.pageSize })}
            pagination={{ current: q.page, pageSize: q.pageSize, total: data?.meta.total ?? 0, showSizeChanger: true, pageSizeOptions: [15, 20, 50, 100], showTotal: (t) => `${t} giao dịch` }}
            columns={[
              { title: 'Thời gian', dataIndex: 'createdAt', width: 140, render: (v) => dt(v, 'DD/MM/YYYY HH:mm:ss') },
              { title: 'Chứng từ', dataIndex: 'documentCode', width: 150, render: (v, m) => <span><Link to={`/inventory/documents?search=${v}`}><b>{v}</b></Link>{m.reason && <div className="kv-hint">{REASON_LABEL[m.reason] ?? m.reason}</div>}</span> },
              { title: 'Loại', dataIndex: 'type', width: 110, render: (v) => <Tag color={v === 'REVERSAL' ? 'red' : 'default'}>{MOVEMENT_LABEL[v] ?? v}</Tag> },
              { title: 'Hàng hóa', render: (_, m) => <span>{m.variant?.name}<div className="kv-hint">{m.variant?.sku}{m.batch ? ` · Lô ${m.batch.batchNo}` : ''}</div></span> },
              { title: 'Kho', render: (_, m) => m.warehouse?.name, width: 130 },
              { title: 'Số lượng', dataIndex: 'quantity', className: 'num', width: 100, render: (v) => <b className={Number(v) >= 0 ? 'pos' : 'neg'}>{signedQty(v)}</b> },
              ...(canSeeCost ? [{ title: 'Giá vốn', dataIndex: 'unitCost', className: 'num', width: 110, render: (v: string) => money(v) }, { title: 'Giá trị', dataIndex: 'totalCost', className: 'num', width: 110, render: (v: string) => money(v) }] : []),
              { title: 'Tồn sau GD', dataIndex: 'balanceAfter', className: 'num', width: 100, render: (v) => qty(v) },
              { title: 'Ghi chú', dataIndex: 'note', ellipsis: true },
            ]} />
        </div>
      </div>
    </div>
  );
}
