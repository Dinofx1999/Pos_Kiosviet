import { Alert, Button, Empty, Input, InputNumber, Segmented, Skeleton, Tag } from 'antd';
import Table from '../../components/ResponsiveTable';
import type { ColumnsType } from 'antd/es/table';
import { ReloadOutlined, SearchOutlined } from '@ant-design/icons';
import dayjs from 'dayjs';
import { useState } from 'react';
import { errMsg } from '../../api/client';
import { SlowMoverRow, useSlowMovers } from '../../api/reports';
import { FilterCard, FilterPanel } from '../../components/FilterPanel';
import { useIsMobile } from '../../hooks/useMedia';
import { d, qty } from '../../utils/format';
import { BranchSelect, CardPager, CategorySelect, ExportButton, Stat, WarehouseSelect, vnd } from './ReportShared';

const DAY_OPTIONS = [30, 60, 90, 180];
const CUSTOM = 'custom';

/** Hàng tồn lâu / không bán được trong N ngày (BR-111). */
export default function SlowMoversPage() {
  const isMobile = useIsMobile();
  const [days, setDays] = useState(30);
  const [custom, setCustom] = useState(false);
  const [draft, setDraft] = useState<number | null>(30);
  const [warehouseId, setWarehouseId] = useState<string>();
  const [branchId, setBranchId] = useState<string>();
  const [categoryId, setCategoryId] = useState<string>();
  const [search, setSearch] = useState<string>();
  const [searchText, setSearchText] = useState('');
  const [page, setPage] = useState(1);
  const [pageSize, setPageSize] = useState(20);
  const filters = { days, warehouseId, branchId, categoryId };
  const { data, isLoading, isFetching, error, refetch } = useSlowMovers({ ...filters, search, page, pageSize });
  const rows = data?.data ?? [];
  const showValue = data?.pageValue !== undefined;
  const reset = () => setPage(1);
  const applyDays = (n: number | null) => { if (n && n >= 1 && n <= 3650 && n !== days) { setDays(Math.round(n)); reset(); } };
  const segValue = custom || !DAY_OPTIONS.includes(days) ? CUSTOM : days;

  const lastSale = (r: SlowMoverRow) => r.lastSaleAt
    ? <span>{d(r.lastSaleAt)} <Tag color={r.daysSinceSale !== null && r.daysSinceSale >= days * 2 ? 'red' : 'orange'} style={{ marginInlineEnd: 0 }}>{r.daysSinceSale} ngày</Tag></span>
    : <Tag color="red" style={{ marginInlineEnd: 0 }}>Chưa bán lần nào</Tag>;

  const tiles = data && (
    <div className="rp-stats three">
      <Stat label="Mặt hàng tồn lâu" value={data.meta.total} sub={`không bán ≥ ${data.days} ngày`} />
      <Stat label={showValue ? 'Giá trị ứ đọng' : 'Số dòng trên trang'} value={showValue ? vnd(data.pageValue) : rows.length} tone={showValue ? 'warn' : undefined} sub={showValue ? `trang này · ${rows.length} mặt hàng` : undefined} />
      <Stat label="Không bán kể từ" value={dayjs(data.since).format('DD/MM/YYYY')} sub={dayjs(data.since).fromNow()} />
    </div>
  );

  const cards = (
    <div className="rp-cards">
      {isLoading ? <Skeleton active /> : rows.length === 0 ? <Empty className="rp-empty" description={error ? errMsg(error) : `Không có hàng tồn nào chưa bán trong ${days} ngày qua`} /> : rows.map((r) => (
        <div className="rp-card" key={r.variantId}>
          <div className="nm">{r.name}</div>
          <div><div className="amt">{qty(r.onHand)}</div><div className="sub">tồn kho</div></div>
          <div className="meta"><span>{r.sku}</span>{r.category && <span>· {r.category}</span>}</div>
          <div className="row"><span className="k">Bán lần cuối</span><span className="v">{lastSale(r)}</span></div>
          <div className="rows">
            {r.value !== undefined && <div className="cell"><span>Giá trị tồn</span><b>{vnd(r.value)}</b></div>}
            {r.costPrice !== undefined && <div className="cell"><span>Giá vốn</span><b>{vnd(r.costPrice)}</b></div>}
            <div className="cell"><span>Nhập lần cuối</span><b>{r.lastReceiptAt ? d(r.lastReceiptAt) : '—'}</b></div>
            <div className="cell"><span>Bán trong kỳ</span><b>{qty(r.soldInPeriod)}</b></div>
          </div>
        </div>
      ))}
      <CardPager page={page} pageSize={pageSize} total={data?.meta.total ?? 0} onChange={(p, s) => { setPage(p); setPageSize(s); }} />
    </div>
  );

  const columns: ColumnsType<SlowMoverRow> = [
    { title: 'Mã hàng', dataIndex: 'sku', width: 120, render: (v) => <b>{v}</b> },
    { title: 'Tên hàng', dataIndex: 'name', render: (v, r) => <span>{v}{r.category && <div className="kv-hint">{r.category}</div>}</span> },
    { title: 'Tồn kho', dataIndex: 'onHand', className: 'num', width: 90, render: (v) => <b>{qty(v)}</b> },
    ...(showValue ? [
      { title: 'Giá vốn', dataIndex: 'costPrice', className: 'num', width: 110, render: (v: string) => vnd(v) },
      { title: 'Giá trị tồn', dataIndex: 'value', className: 'num', width: 130, render: (v: string) => <b className="warn" style={{ color: '#d97706' }}>{vnd(v)}</b> },
    ] as ColumnsType<SlowMoverRow> : []),
    { title: 'Bán lần cuối', width: 190, render: (_, r) => lastSale(r) },
    { title: 'Nhập lần cuối', dataIndex: 'lastReceiptAt', width: 120, render: (v) => (v ? d(v) : <span className="muted">—</span>) },
    { title: `Bán trong ${days} ngày`, dataIndex: 'soldInPeriod', className: 'num', width: 120, render: (v) => qty(v) },
  ];
  const table = (
    <div className="kv-card">
      <Table<SlowMoverRow> className="kv-table" rowKey="variantId" size="small" loading={isLoading} dataSource={rows} scroll={{ x: showValue ? 1050 : 820 }}
        locale={{ emptyText: error ? <Empty description={errMsg(error)} /> : <Empty description={`Không có hàng tồn nào chưa bán trong ${days} ngày qua`} /> }}
        onChange={(p) => { setPage(p.current ?? 1); setPageSize(p.pageSize ?? 20); }}
        pagination={{ current: page, pageSize, total: data?.meta.total ?? 0, showSizeChanger: true, pageSizeOptions: [20, 50, 100], showTotal: (t) => `${t} mặt hàng` }}
        columns={columns} />
    </div>
  );

  return (
    <div className="kv-list rp-page">
      <FilterPanel>
        <FilterCard title="Chi nhánh"><BranchSelect size="small" value={branchId} onChange={(v) => { setBranchId(v); setWarehouseId(undefined); reset(); }} /></FilterCard>
        <FilterCard title="Kho hàng"><WarehouseSelect size="small" value={warehouseId} branchId={branchId} onChange={(v) => { setWarehouseId(v); reset(); }} /></FilterCard>
        <FilterCard title="Nhóm hàng"><CategorySelect size="small" value={categoryId} onChange={(v) => { setCategoryId(v); reset(); }} /></FilterCard>
      </FilterPanel>
      <div className="kv-main">
        <div className="rp-head">
          <h1 className="kv-page-title">Hàng tồn lâu</h1>
          <div className="rp-actions">
            <Button icon={<ReloadOutlined />} onClick={() => refetch()} loading={isFetching} />
            <ExportButton query={{ type: 'slow-movers', ...filters }} />
          </div>
        </div>
        <div className="rp-toolbar">
          <span className="rp-range-label" style={{ flex: '1 1 100%' }}>Hàng còn tồn nhưng không bán được trong</span>
          <Segmented value={segValue} onChange={(v) => { if (v === CUSTOM) { setCustom(true); setDraft(days); } else { setCustom(false); setDays(v as number); reset(); } }}
            options={[...DAY_OPTIONS.map((n) => ({ value: n, label: `${n} ngày` })), { value: CUSTOM, label: 'Tùy chọn' }]} />
          {segValue === CUSTOM && (
            <span className="rp-inline-days">
              <InputNumber min={1} max={3650} value={draft} onChange={setDraft} onBlur={() => applyDays(draft)} onPressEnter={() => applyDays(draft)} inputMode="numeric" /> ngày
            </span>
          )}
          <Input.Search className="rp-grow" allowClear placeholder="Theo mã, tên hàng" value={searchText} onChange={(e) => setSearchText(e.target.value)} onSearch={(v) => { setSearch(v || undefined); reset(); }} enterButton={<SearchOutlined />} />
        </div>
        {error && !data && <Alert type="error" showIcon message={errMsg(error)} style={{ marginBottom: 10 }} />}
        {isLoading && !data ? <Skeleton active paragraph={{ rows: 2 }} /> : tiles}
        {isMobile ? cards : table}
      </div>
    </div>
  );
}
