import { Alert, Button, Card, Empty, Segmented, Skeleton, Table } from 'antd';
import type { ColumnsType } from 'antd/es/table';
import { ReloadOutlined } from '@ant-design/icons';
import { useMemo, useState } from 'react';
import { errMsg } from '../../api/client';
import { ValuationGroupBy, ValuationRow, useValuation } from '../../api/reports';
import { FilterCard, FilterPanel } from '../../components/FilterPanel';
import { useIsMobile } from '../../hooks/useMedia';
import { qty, toNum } from '../../utils/format';
import { BranchSelect, Donut, DonutSlice, ExportButton, OTHER_COLOR, SERIES_COLORS, ShareBar, Stat, WarehouseSelect, compactMoney, fmtPct, pctOf, vnd } from './ReportShared';

const GROUP_LABEL: Record<ValuationGroupBy, string> = { category: 'Nhóm hàng', warehouse: 'Kho', brand: 'Thương hiệu' };
const TOP = 8;

/** Giá trị tồn kho theo nhóm hàng / kho / thương hiệu (BR-114). */
export default function ValuationPage() {
  const isMobile = useIsMobile();
  const [groupBy, setGroupBy] = useState<ValuationGroupBy>('category');
  const [warehouseId, setWarehouseId] = useState<string>();
  const [branchId, setBranchId] = useState<string>();
  const filters = { warehouseId, branchId };
  const { data, isLoading, isFetching, error, refetch } = useValuation({ groupBy, ...filters });
  const rows = data?.rows ?? [];
  const totals = data?.totals;
  const totalValue = toNum(totals?.value);
  const potential = toNum(totals?.retail) - totalValue;

  const slices = useMemo<DonutSlice[]>(() => {
    const sorted = [...rows].filter((r) => toNum(r.value) > 0).sort((a, b) => toNum(b.value) - toNum(a.value));
    const head = sorted.slice(0, TOP).map((r, i) => ({ key: r.key || `_${i}`, name: r.name, value: toNum(r.value), color: SERIES_COLORS[i] }));
    const rest = sorted.slice(TOP).reduce((s, r) => s + toNum(r.value), 0);
    return rest > 0 ? [...head, { key: '__other', name: `Khác (${sorted.length - TOP})`, value: rest, color: OTHER_COLOR }] : head;
  }, [rows]);

  const tiles = totals && (
    <div className="rp-stats five">
      <Stat label="Số SKU có tồn" value={totals.skus} />
      <Stat label="Số lượng tồn" value={qty(totals.quantity)} />
      <Stat label="Giá trị vốn" value={vnd(totals.value)} tone="blue" />
      <Stat label="Giá trị bán" value={vnd(totals.retail)} sub="theo giá bán lẻ" />
      <Stat label="Lãi tiềm năng" value={vnd(potential)} tone={potential < 0 ? 'neg' : 'pos'} sub={`tỷ suất ${fmtPct(pctOf(potential, totals.retail))}`} />
    </div>
  );

  const cards = (
    <div className="rp-cards">
      {rows.length === 0 ? <Empty className="rp-empty" description="Không có hàng tồn kho" /> : rows.map((r) => {
        const margin = toNum(r.potentialMargin);
        return (
          <div className="rp-card" key={r.key || r.name}>
            <div className="nm">{r.name}</div>
            <div><div className="amt blue">{vnd(r.value)}</div><div className="sub">giá trị vốn</div></div>
            <div className="meta"><span>{r.skus} SKU</span><span>· SL {qty(r.quantity)}</span></div>
            <div className="row"><span className="k">Tỷ trọng</span><span className="v"><ShareBar pct={pctOf(r.value, totalValue)} /></span></div>
            <div className="row"><span className="k">Giá trị bán</span><span className="v">{vnd(r.retail)}</span></div>
            <div className="row"><span className="k">Lãi tiềm năng</span><span className={`v ${margin < 0 ? 'neg' : 'pos'}`}>{vnd(margin)} <span className="muted" style={{ fontWeight: 500 }}>({fmtPct(pctOf(margin, r.retail), 0)})</span></span></div>
          </div>
        );
      })}
    </div>
  );

  const columns: ColumnsType<ValuationRow> = [
    { title: GROUP_LABEL[groupBy], dataIndex: 'name', render: (v) => <b>{v}</b> },
    { title: 'SKU', dataIndex: 'skus', className: 'num', width: 70 },
    { title: 'Số lượng', dataIndex: 'quantity', className: 'num', width: 100, render: (v) => qty(v) },
    { title: 'Giá trị vốn', dataIndex: 'value', className: 'num', width: 140, render: (v) => <b>{vnd(v)}</b> },
    { title: 'Tỷ trọng', width: 130, render: (_, r) => <ShareBar pct={pctOf(r.value, totalValue)} /> },
    { title: 'Giá trị bán', dataIndex: 'retail', className: 'num', width: 140, render: (v) => vnd(v) },
    { title: 'Lãi tiềm năng', dataIndex: 'potentialMargin', className: 'num', width: 140, render: (v) => <span className={toNum(v) < 0 ? 'neg' : 'pos'}>{vnd(v)}</span> },
    { title: 'Tỷ suất', className: 'num', width: 80, render: (_, r) => fmtPct(pctOf(r.potentialMargin, r.retail)) },
  ];
  const table = totals && (
    <Table<ValuationRow> className="kv-table" rowKey={(r) => r.key || r.name} size="small" dataSource={rows} pagination={false} scroll={{ x: 900 }} locale={{ emptyText: <Empty description="Không có hàng tồn kho" /> }} columns={columns}
      summary={() => rows.length ? (
        <Table.Summary fixed>
          <Table.Summary.Row>
            <Table.Summary.Cell index={0}><b>Tổng cộng</b></Table.Summary.Cell>
            <Table.Summary.Cell index={1} className="num"><b>{totals.skus}</b></Table.Summary.Cell>
            <Table.Summary.Cell index={2} className="num"><b>{qty(totals.quantity)}</b></Table.Summary.Cell>
            <Table.Summary.Cell index={3} className="num"><b>{vnd(totals.value)}</b></Table.Summary.Cell>
            <Table.Summary.Cell index={4}><b>100%</b></Table.Summary.Cell>
            <Table.Summary.Cell index={5} className="num"><b>{vnd(totals.retail)}</b></Table.Summary.Cell>
            <Table.Summary.Cell index={6} className="num"><b className={potential < 0 ? 'neg' : 'pos'}>{vnd(potential)}</b></Table.Summary.Cell>
            <Table.Summary.Cell index={7} className="num"><b>{fmtPct(pctOf(potential, totals.retail))}</b></Table.Summary.Cell>
          </Table.Summary.Row>
        </Table.Summary>
      ) : null} />
  );

  return (
    <div className="kv-list rp-page">
      <FilterPanel>
        <FilterCard title="Chi nhánh"><BranchSelect size="small" value={branchId} onChange={(v) => { setBranchId(v); setWarehouseId(undefined); }} /></FilterCard>
        <FilterCard title="Kho hàng"><WarehouseSelect size="small" value={warehouseId} branchId={branchId} onChange={setWarehouseId} /></FilterCard>
      </FilterPanel>
      <div className="kv-main">
        <div className="rp-head">
          <h1 className="kv-page-title">Giá trị tồn kho</h1>
          <div className="rp-actions">
            <Button icon={<ReloadOutlined />} onClick={() => refetch()} loading={isFetching} />
            <ExportButton query={{ type: 'valuation', ...filters }} />
          </div>
        </div>
        <div className="rp-toolbar">
          <Segmented value={groupBy} onChange={(v) => setGroupBy(v as ValuationGroupBy)} options={(Object.keys(GROUP_LABEL) as ValuationGroupBy[]).map((k) => ({ value: k, label: GROUP_LABEL[k] }))} />
        </div>
        {error && !data && <Alert type="error" showIcon message={errMsg(error)} style={{ marginBottom: 10 }} />}
        {isLoading && !data ? <Skeleton active paragraph={{ rows: 8 }} /> : data && (
          <>
            {tiles}
            <Card size="small" className="rp-chart-card" title={`Cơ cấu giá trị vốn theo ${GROUP_LABEL[groupBy].toLowerCase()}`} style={{ marginBottom: 12 }}>
              {slices.length === 0 ? <div className="muted">Không có hàng tồn kho</div> : <Donut slices={slices} centerLabel="Giá trị vốn" centerValue={compactMoney(totalValue)} />}
            </Card>
            <Card size="small" title={`Chi tiết theo ${GROUP_LABEL[groupBy].toLowerCase()}`}>{isMobile ? cards : table}</Card>
          </>
        )}
      </div>
    </div>
  );
}
