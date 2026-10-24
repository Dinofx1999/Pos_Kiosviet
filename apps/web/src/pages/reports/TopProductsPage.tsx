import { Alert, Button, Card, Empty, Input, Segmented, Skeleton, Table } from 'antd';
import type { ColumnsType } from 'antd/es/table';
import { FallOutlined, ReloadOutlined, RiseOutlined, SearchOutlined } from '@ant-design/icons';
import { useState } from 'react';
import { errMsg } from '../../api/client';
import { TopProductRow, TopProductsBy, useTopProducts } from '../../api/reports';
import { FilterCard, FilterPanel } from '../../components/FilterPanel';
import { useIsMobile } from '../../hooks/useMedia';
import { qty, toNum } from '../../utils/format';
import { BranchSelect, CardPager, CategorySelect, DateRangeBar, ExportButton, HBarChart, Range, RankBadge, Stat, fmtPct, pctOf, presetRange, vnd } from './ReportShared';

const BY_OPTIONS: { value: TopProductsBy; label: string }[] = [{ value: 'revenue', label: 'Doanh thu' }, { value: 'quantity', label: 'Số lượng' }, { value: 'profit', label: 'Lợi nhuận' }];
const BY_LABEL: Record<TopProductsBy, string> = { revenue: 'doanh thu', quantity: 'số lượng', profit: 'lợi nhuận' };

/** Hàng bán chạy / bán chậm theo doanh thu, số lượng, lợi nhuận (BR-112). */
export default function TopProductsPage() {
  const isMobile = useIsMobile();
  const [range, setRange] = useState<Range>(() => presetRange('month'));
  const [branchId, setBranchId] = useState<string>();
  const [categoryId, setCategoryId] = useState<string>();
  const [by, setBy] = useState<TopProductsBy>('revenue');
  const [order, setOrder] = useState<'desc' | 'asc'>('desc');
  const [search, setSearch] = useState<string>();
  const [searchText, setSearchText] = useState('');
  const [page, setPage] = useState(1);
  const [pageSize, setPageSize] = useState(20);
  const filters = { from: range[0].toISOString(), to: range[1].toISOString(), branchId, categoryId };
  const { data, isLoading, isFetching, error, refetch } = useTopProducts({ ...filters, search, by, order, page, pageSize });
  const top = useTopProducts({ ...filters, search, by, order, page: 1, pageSize: 10 });
  const rows = data?.data ?? [];
  const reset = () => setPage(1);
  const metric = (r: TopProductRow) => (by === 'quantity' ? toNum(r.quantity) : by === 'profit' ? toNum(r.profit) : toNum(r.revenue));
  const metricText = (r: TopProductRow) => (by === 'quantity' ? qty(r.quantity) : vnd(metric(r)));
  const rankOf = (i: number) => (page - 1) * pageSize + i + 1;
  const pageRevenue = rows.reduce((s, r) => s + toNum(r.revenue), 0);
  const pageProfit = rows.reduce((s, r) => s + toNum(r.profit), 0);
  const pageQty = rows.reduce((s, r) => s + toNum(r.quantity), 0);
  const hasProfit = rows.some((r) => r.profit !== undefined);

  const tiles = data && (
    <div className="rp-stats">
      <Stat label="Mặt hàng có bán" value={data.meta.total} sub={`${range[0].format('DD/MM')} – ${range[1].format('DD/MM/YYYY')}`} />
      <Stat label="SL bán (trang này)" value={qty(pageQty)} />
      <Stat label="Doanh thu (trang này)" value={vnd(pageRevenue)} tone="blue" />
      <Stat label="Lợi nhuận (trang này)" value={hasProfit ? vnd(pageProfit) : '—'} tone={pageProfit < 0 ? 'neg' : 'pos'} sub={hasProfit ? `tỷ suất ${fmtPct(pctOf(pageProfit, pageRevenue))}` : undefined} />
    </div>
  );

  const chart = (
    <Card size="small" className="rp-chart-card" title={`Top 10 ${order === 'desc' ? 'bán chạy' : 'bán chậm'} theo ${BY_LABEL[by]}`} style={{ marginBottom: 12 }}>
      {top.isLoading ? <Skeleton active paragraph={{ rows: 4 }} /> : !top.data?.data.length ? <div className="muted">Không có hàng hóa nào được bán trong kỳ</div> : (
        <HBarChart tone={order === 'asc' ? 'asc' : 'blue'} rows={top.data.data.map((r) => ({ key: r.variantId, name: r.name, sub: r.sku, value: metric(r), display: metricText(r) }))} />
      )}
    </Card>
  );

  const cards = (
    <div className="rp-cards">
      {isLoading ? <Skeleton active /> : rows.length === 0 ? <Empty className="rp-empty" description={error ? errMsg(error) : 'Không có hàng hóa nào được bán trong kỳ'} /> : rows.map((r, i) => {
        const margin = pctOf(r.profit, r.revenue);
        return (
          <div className="rp-card ranked" key={r.variantId}>
            <RankBadge rank={rankOf(i)} />
            <div className="nm">{r.name}</div>
            <div><div className={`amt${by === 'profit' && toNum(r.profit) < 0 ? ' neg' : ' blue'}`}>{metricText(r)}</div><div className="sub">{BY_LABEL[by]}</div></div>
            <div className="meta"><span>{r.sku}</span>{r.category && <span>· {r.category}</span>}<span>· {r.invoices} HĐ</span></div>
            <div className="rows">
              <div className="cell"><span>SL bán</span><b>{qty(r.quantity)}{toNum(r.returnedQuantity) > 0 && <span className="neg" style={{ fontWeight: 500 }}> (trả {qty(r.returnedQuantity)})</span>}</b></div>
              <div className="cell"><span>Doanh thu</span><b>{vnd(r.revenue)}</b></div>
              {r.profit !== undefined && <div className="cell"><span>Lợi nhuận</span><b className={toNum(r.profit) < 0 ? 'neg' : 'pos'}>{vnd(r.profit)}</b></div>}
              {r.profit !== undefined && <div className="cell"><span>Tỷ suất</span><b>{fmtPct(margin)}</b></div>}
            </div>
          </div>
        );
      })}
      <CardPager page={page} pageSize={pageSize} total={data?.meta.total ?? 0} onChange={(p, s) => { setPage(p); setPageSize(s); }} />
    </div>
  );

  const columns: ColumnsType<TopProductRow> = [
    { title: '#', width: 52, render: (_, __, i) => <RankBadge rank={rankOf(i)} /> },
    { title: 'Mã hàng', dataIndex: 'sku', width: 120, render: (v) => <b>{v}</b> },
    { title: 'Tên hàng', dataIndex: 'name', render: (v, r) => <span>{v}{r.category && <div className="kv-hint">{r.category}</div>}</span> },
    { title: 'HĐ', dataIndex: 'invoices', className: 'num', width: 60 },
    { title: 'SL bán', dataIndex: 'quantity', className: 'num', width: 90, render: (v) => <b>{qty(v)}</b> },
    { title: 'SL trả', dataIndex: 'returnedQuantity', className: 'num', width: 80, render: (v) => (toNum(v) > 0 ? <span className="neg">{qty(v)}</span> : '') },
    { title: 'Doanh thu', dataIndex: 'revenue', className: 'num', width: 130, render: (v) => <b>{vnd(v)}</b> },
    ...(hasProfit ? [
      { title: 'Giá vốn', dataIndex: 'cost', className: 'num', width: 120, render: (v: string) => vnd(v) },
      { title: 'Lợi nhuận', dataIndex: 'profit', className: 'num', width: 130, render: (v: string) => <b className={toNum(v) < 0 ? 'neg' : 'pos'}>{vnd(v)}</b> },
      { title: 'Tỷ suất', className: 'num', width: 90, render: (_: unknown, r: TopProductRow) => fmtPct(pctOf(r.profit, r.revenue)) },
    ] as ColumnsType<TopProductRow> : []),
  ];
  const table = (
    <div className="kv-card">
      <Table<TopProductRow> className="kv-table" rowKey="variantId" size="small" loading={isLoading} dataSource={rows} scroll={{ x: hasProfit ? 1100 : 760 }}
        locale={{ emptyText: error ? <Empty description={errMsg(error)} /> : <Empty description="Không có hàng hóa nào được bán trong kỳ" /> }}
        onChange={(p) => { setPage(p.current ?? 1); setPageSize(p.pageSize ?? 20); }}
        pagination={{ current: page, pageSize, total: data?.meta.total ?? 0, showSizeChanger: true, pageSizeOptions: [20, 50, 100], showTotal: (t) => `${t} mặt hàng` }}
        columns={columns} />
    </div>
  );

  return (
    <div className="kv-list rp-page">
      <FilterPanel>
        <FilterCard title="Chi nhánh"><BranchSelect size="small" value={branchId} onChange={(v) => { setBranchId(v); reset(); }} /></FilterCard>
        <FilterCard title="Nhóm hàng"><CategorySelect size="small" value={categoryId} onChange={(v) => { setCategoryId(v); reset(); }} /></FilterCard>
      </FilterPanel>
      <div className="kv-main">
        <div className="rp-head">
          <h1 className="kv-page-title">Hàng bán chạy / bán chậm</h1>
          <div className="rp-actions">
            <Button icon={<ReloadOutlined />} onClick={() => refetch()} loading={isFetching} />
            <ExportButton query={{ type: 'top-products', ...filters, by }} />
          </div>
        </div>
        <div className="rp-toolbar">
          <DateRangeBar value={range} onChange={(r) => { setRange(r); reset(); }} />
          <Segmented className="rp-half" value={by} onChange={(v) => { setBy(v as TopProductsBy); reset(); }} options={BY_OPTIONS} />
          <Segmented className="rp-half" value={order} onChange={(v) => { setOrder(v as 'desc' | 'asc'); reset(); }}
            options={[{ value: 'desc', label: 'Bán chạy nhất', icon: <RiseOutlined /> }, { value: 'asc', label: 'Bán chậm nhất', icon: <FallOutlined /> }]} />
          <Input.Search className="rp-grow" allowClear placeholder="Theo mã, tên hàng" value={searchText} onChange={(e) => setSearchText(e.target.value)} onSearch={(v) => { setSearch(v || undefined); reset(); }} enterButton={<SearchOutlined />} />
        </div>
        {error && !data && <Alert type="error" showIcon message={errMsg(error)} style={{ marginBottom: 10 }} />}
        {isLoading && !data ? <Skeleton active paragraph={{ rows: 2 }} /> : tiles}
        {chart}
        {isMobile ? cards : table}
      </div>
    </div>
  );
}
