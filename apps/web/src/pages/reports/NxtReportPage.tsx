import { Alert, Button, Empty, Input, Skeleton, Switch } from 'antd';
import Table from '../../components/ResponsiveTable';
import { ReloadOutlined, SearchOutlined } from '@ant-design/icons';
import { useState } from 'react';
import { errMsg } from '../../api/client';
import { NxtRow, useNxtReport } from '../../api/reports';
import { FilterCard, FilterPanel } from '../../components/FilterPanel';
import { useIsMobile } from '../../hooks/useMedia';
import { useCan } from '../../store/auth';
import { qty } from '../../utils/format';
import { BranchSelect, CardPager, CategorySelect, DateRangeBar, ExportButton, Range, Stat, WarehouseSelect, presetRange, vnd } from './ReportShared';

/** Báo cáo nhập – xuất – tồn theo kỳ (BR-110). */
export default function NxtReportPage() {
  const isMobile = useIsMobile();
  const can = useCan();
  const [range, setRange] = useState<Range>(() => presetRange('month'));
  const [warehouseId, setWarehouseId] = useState<string>();
  const [branchId, setBranchId] = useState<string>();
  const [categoryId, setCategoryId] = useState<string>();
  const [search, setSearch] = useState<string>();
  const [searchText, setSearchText] = useState('');
  const [hideEmpty, setHideEmpty] = useState(true);
  const [page, setPage] = useState(1);
  const [pageSize, setPageSize] = useState(20);
  const period = { from: range[0].toISOString(), to: range[1].toISOString() };
  const filters = { ...period, warehouseId, branchId, categoryId };
  const { data, isLoading, isFetching, error, refetch } = useNxtReport({ ...filters, search, hideEmpty: hideEmpty ? 'true' : 'false', page, pageSize });
  const rows = data?.data ?? [];
  const hasValue = data?.totals.openingValue !== undefined || can('inventory.cost.view');
  const showValue = data?.totals.openingValue !== undefined;
  const reset = () => setPage(1);

  const tiles = data && (
    <div className="rp-stats">
      <Stat label="Tồn đầu kỳ" value={qty(data.totals.openingQty)} sub={showValue ? `${vnd(data.totals.openingValue)} ₫` : range[0].format('DD/MM/YYYY')} />
      <Stat label="Nhập trong kỳ" value={`+${qty(data.totals.inQty)}`} tone="pos" sub={showValue ? `${vnd(data.totals.inValue)} ₫` : undefined} />
      <Stat label="Xuất trong kỳ" value={`−${qty(data.totals.outQty)}`} tone="neg" sub={showValue ? `${vnd(data.totals.outValue)} ₫` : undefined} />
      <Stat label="Tồn cuối kỳ" value={qty(data.totals.closingQty)} tone="blue" sub={showValue ? `${vnd(data.totals.closingValue)} ₫` : range[1].format('DD/MM/YYYY')} />
    </div>
  );

  const cards = (
    <div className="rp-cards">
      {isLoading ? <Skeleton active /> : rows.length === 0 ? <Empty className="rp-empty" description={error ? errMsg(error) : 'Không có hàng hóa nào biến động trong kỳ'} /> : rows.map((r) => (
        <div className="rp-card" key={r.variantId}>
          <div className="nm">{r.name}</div>
          <div className="amt blue">{qty(r.closingQty)}<span className="muted" style={{ fontSize: 11, fontWeight: 500 }}> {r.unit ?? ''}</span></div>
          <div className="meta"><span>{r.sku}</span>{r.category && <span>· {r.category}</span>}{r.barcode && <span>· {r.barcode}</span>}</div>
          <div className="rp-flow">
            <div className="cell"><div className="k">Tồn đầu</div><div className="q">{qty(r.openingQty)}</div>{r.openingValue !== undefined && <div className="m">{vnd(r.openingValue)}</div>}</div>
            <span className="arrow">›</span>
            <div className="cell"><div className="k">Nhập</div><div className="q in">+{qty(r.inQty)}</div>{r.inValue !== undefined && <div className="m">{vnd(r.inValue)}</div>}</div>
            <span className="arrow">›</span>
            <div className="cell"><div className="k">Xuất</div><div className="q out">−{qty(r.outQty)}</div>{r.outValue !== undefined && <div className="m">{vnd(r.outValue)}</div>}</div>
            <span className="arrow">›</span>
            <div className="cell"><div className="k">Tồn cuối</div><div className="q end">{qty(r.closingQty)}</div>{r.closingValue !== undefined && <div className="m">{vnd(r.closingValue)}</div>}</div>
          </div>
        </div>
      ))}
      <CardPager page={page} pageSize={pageSize} total={data?.meta.total ?? 0} onChange={(p, s) => { setPage(p); setPageSize(s); }} />
    </div>
  );

  const valueCols = showValue ? [
    { title: 'GT đầu kỳ', dataIndex: 'openingValue', className: 'num', width: 120, render: (v: string) => vnd(v) },
    { title: 'GT nhập', dataIndex: 'inValue', className: 'num', width: 120, render: (v: string) => vnd(v) },
    { title: 'GT xuất', dataIndex: 'outValue', className: 'num', width: 120, render: (v: string) => vnd(v) },
    { title: 'GT cuối kỳ', dataIndex: 'closingValue', className: 'num', width: 130, render: (v: string) => <b>{vnd(v)}</b> },
  ] : [];
  const table = (
    <div className="kv-card">
      <Table<NxtRow> className="kv-table" rowKey="variantId" size="small" loading={isLoading} dataSource={rows} scroll={{ x: showValue ? 1200 : 760 }}
        locale={{ emptyText: error ? <Empty description={errMsg(error)} /> : <Empty description="Không có hàng hóa nào biến động trong kỳ" /> }}
        onChange={(p) => { setPage(p.current ?? 1); setPageSize(p.pageSize ?? 20); }}
        pagination={{ current: page, pageSize, total: data?.meta.total ?? 0, showSizeChanger: true, pageSizeOptions: [20, 50, 100], showTotal: (t) => `${t} mặt hàng` }}
        columns={[
          { title: 'Mã hàng', dataIndex: 'sku', width: 120, render: (v) => <b>{v}</b> },
          { title: 'Tên hàng', dataIndex: 'name', render: (v, r) => <span>{v}<div className="kv-hint">{[r.category, r.barcode].filter(Boolean).join(' · ')}</div></span> },
          { title: 'ĐVT', dataIndex: 'unit', width: 70, render: (v) => v ?? '' },
          { title: 'Tồn đầu', dataIndex: 'openingQty', className: 'num', width: 90, render: (v) => qty(v) },
          { title: 'Nhập', dataIndex: 'inQty', className: 'num', width: 90, render: (v) => <span className="pos">+{qty(v)}</span> },
          { title: 'Xuất', dataIndex: 'outQty', className: 'num', width: 90, render: (v) => <span className="neg">−{qty(v)}</span> },
          { title: 'Tồn cuối', dataIndex: 'closingQty', className: 'num', width: 90, render: (v) => <b>{qty(v)}</b> },
          ...valueCols,
        ]}
        summary={() => data && rows.length ? (
          <Table.Summary fixed>
            <Table.Summary.Row>
              <Table.Summary.Cell index={0} colSpan={3}><b>Tổng cộng</b></Table.Summary.Cell>
              <Table.Summary.Cell index={3} className="num"><b>{qty(data.totals.openingQty)}</b></Table.Summary.Cell>
              <Table.Summary.Cell index={4} className="num"><b className="pos">+{qty(data.totals.inQty)}</b></Table.Summary.Cell>
              <Table.Summary.Cell index={5} className="num"><b className="neg">−{qty(data.totals.outQty)}</b></Table.Summary.Cell>
              <Table.Summary.Cell index={6} className="num"><b>{qty(data.totals.closingQty)}</b></Table.Summary.Cell>
              {showValue && <>
                <Table.Summary.Cell index={7} className="num"><b>{vnd(data.totals.openingValue)}</b></Table.Summary.Cell>
                <Table.Summary.Cell index={8} className="num"><b>{vnd(data.totals.inValue)}</b></Table.Summary.Cell>
                <Table.Summary.Cell index={9} className="num"><b>{vnd(data.totals.outValue)}</b></Table.Summary.Cell>
                <Table.Summary.Cell index={10} className="num"><b>{vnd(data.totals.closingValue)}</b></Table.Summary.Cell>
              </>}
            </Table.Summary.Row>
          </Table.Summary>
        ) : null}
      />
      <p className="rp-table-note" style={{ padding: '0 10px 8px' }}>Tổng cộng tính trên toàn bộ kết quả theo bộ lọc, không chỉ trang hiện tại.{hasValue && !showValue ? ' Giá trị tồn chỉ hiển thị khi có quyền xem giá vốn.' : ''}</p>
    </div>
  );

  return (
    <div className="kv-list rp-page">
      <FilterPanel>
        <FilterCard title="Chi nhánh"><BranchSelect size="small" value={branchId} onChange={(v) => { setBranchId(v); setWarehouseId(undefined); reset(); }} /></FilterCard>
        <FilterCard title="Kho hàng"><WarehouseSelect size="small" value={warehouseId} branchId={branchId} onChange={(v) => { setWarehouseId(v); reset(); }} /></FilterCard>
        <FilterCard title="Nhóm hàng"><CategorySelect size="small" value={categoryId} onChange={(v) => { setCategoryId(v); reset(); }} /></FilterCard>
        <FilterCard title="Tùy chọn"><label className="rp-switch"><Switch size="small" checked={hideEmpty} onChange={(v) => { setHideEmpty(v); reset(); }} /> Ẩn hàng không biến động</label></FilterCard>
      </FilterPanel>
      <div className="kv-main">
        <div className="rp-head">
          <h1 className="kv-page-title">Nhập xuất tồn</h1>
          <div className="rp-actions">
            <Button icon={<ReloadOutlined />} onClick={() => refetch()} loading={isFetching} />
            <ExportButton query={{ type: 'nxt', ...filters }} />
          </div>
        </div>
        <div className="rp-toolbar">
          <DateRangeBar value={range} onChange={(r) => { setRange(r); reset(); }} />
          <Input.Search className="rp-grow" allowClear placeholder="Theo mã, tên hàng, mã vạch" value={searchText} onChange={(e) => setSearchText(e.target.value)} onSearch={(v) => { setSearch(v || undefined); reset(); }} enterButton={<SearchOutlined />} />
        </div>
        {error && !data && <Alert type="error" showIcon message={errMsg(error)} style={{ marginBottom: 10 }} />}
        {isLoading && !data ? <Skeleton active paragraph={{ rows: 2 }} /> : tiles}
        {isMobile ? cards : table}
      </div>
    </div>
  );
}
