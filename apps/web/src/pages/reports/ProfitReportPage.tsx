import { Alert, Button, Card, Empty, Segmented, Skeleton, Table } from 'antd';
import type { ColumnsType } from 'antd/es/table';
import { ReloadOutlined } from '@ant-design/icons';
import { ReactNode, useState } from 'react';
import { errMsg } from '../../api/client';
import { NamedAmount, ProfitPeriod, useProfitReport } from '../../api/reports';
import { FilterCard, FilterPanel } from '../../components/FilterPanel';
import { useIsMobile } from '../../hooks/useMedia';
import { toNum } from '../../utils/format';
import { BranchSelect, DateRangeBar, ExportButton, PeriodBars, Range, Stat, fmtPct, pctOf, periodLabel, presetRange, signed, vnd } from './ReportShared';

type Op = '' | '+' | '−' | '=';
function Line({ op, label, sub, value, kind, pct }: { op: Op; label: ReactNode; sub?: ReactNode; value: unknown; kind?: 'sum' | 'total' | 'sub'; pct?: number | null }) {
  const n = toNum(value);
  const tone = kind === 'sum' || kind === 'total' ? (n < 0 ? ' neg' : n > 0 ? ' pos' : '') : op === '+' ? ' pos' : '';
  return (
    <div className={`line${kind ? ` ${kind}` : ''}`}>
      <span className="op">{op}</span>
      <span className="k">{label}{sub && <span className="sub">{sub}</span>}</span>
      <span className={`v${tone}`}>{op === '−' && kind !== 'sum' && Math.round(n) !== 0 ? `−${vnd(n)}` : signed(n)}{pct !== undefined && <span className="pct">({fmtPct(pct)})</span>}</span>
    </div>
  );
}

function NamedList({ rows, empty, tone }: { rows: NamedAmount[]; empty: string; tone: 'pos' | 'neg' }) {
  if (!rows.length) return <div className="muted">{empty}</div>;
  const total = rows.reduce((s, r) => s + toNum(r.amount), 0);
  return (
    <div className="rp-kvlist">
      {rows.map((r) => <div className="it" key={r.name}><span className="nm">{r.name}</span><span className={`v ${tone}`}>{vnd(r.amount)}</span></div>)}
      <div className="it total"><span className="nm">Tổng</span><span className={`v ${tone}`}>{vnd(total)}</span></div>
    </div>
  );
}

/** Báo cáo lãi lỗ: doanh thu thuần − giá vốn − chi phí − thất thoát + thu khác (BR-113). */
export default function ProfitReportPage() {
  const isMobile = useIsMobile();
  const [range, setRange] = useState<Range>(() => presetRange('month'));
  const [groupBy, setGroupBy] = useState<'day' | 'month'>('day');
  const [branchId, setBranchId] = useState<string>();
  const [selected, setSelected] = useState<string>();
  const filters = { from: range[0].toISOString(), to: range[1].toISOString(), branchId };
  const { data, isLoading, isFetching, error, refetch } = useProfitReport({ ...filters, groupBy });
  const t = data?.totals;
  const periods = data?.byPeriod ?? [];
  const sel = periods.find((p) => p.period === selected);
  const netMargin = t ? pctOf(t.netProfit, t.netRevenue) : null;
  const grossMargin = t ? pctOf(t.grossProfit, t.netRevenue) : null;

  const tiles = t && (
    <div className="rp-stats">
      <Stat label="Doanh thu thuần" value={vnd(t.netRevenue)} tone="blue" sub={`${t.invoices} hóa đơn · trả hàng ${vnd(t.refunds)}`} />
      <Stat label="Lợi nhuận gộp" value={signed(t.grossProfit)} tone={toNum(t.grossProfit) < 0 ? 'neg' : 'pos'} sub={`biên gộp ${fmtPct(grossMargin)}`} />
      <Stat label="Lợi nhuận ròng" value={signed(t.netProfit)} tone={toNum(t.netProfit) < 0 ? 'neg' : 'pos'} sub={`biên ròng ${fmtPct(netMargin)}`} />
      <Stat label="Chi phí & thất thoát" value={vnd(toNum(t.otherExpense) + toNum(t.losses) + toNum(t.shippingCost))} tone="warn" sub={`thu khác +${vnd(t.otherIncome)}`} />
    </div>
  );

  const statement = t && (
    <Card size="small" title="Báo cáo kết quả kinh doanh" extra={<span className="kv-hint">{range[0].format('DD/MM/YYYY')} – {range[1].format('DD/MM/YYYY')}</span>}>
      <div className="rp-pl">
        <Line op="" label="Doanh thu bán hàng" sub={`${t.invoices} hóa đơn hoàn thành · đã giảm giá ${vnd(t.discount)}`} value={t.revenue} />
        <Line op="−" label="Trả hàng" sub="tiền hoàn cho khách" value={t.refunds} />
        <Line op="=" label="Doanh thu thuần" value={t.netRevenue} kind="sum" />
        <Line op="−" label="Giá vốn hàng bán" sub="đã trừ hàng trả nhập lại kho" value={t.cogs} />
        <Line op="=" label="Lợi nhuận gộp" value={t.grossProfit} kind="sum" pct={grossMargin} />
        <Line op="+" label="Thu nhập khác" sub="phiếu thu không gắn hóa đơn" value={t.otherIncome} />
        <Line op="−" label="Chi phí khác" sub="phiếu chi không gắn nhập hàng" value={t.otherExpense} />
        <Line op="−" label="Thất thoát / hàng hỏng" value={t.losses} />
        <Line op="" label="Hàng hỏng khi khách trả" value={t.damaged} kind="sub" />
        <Line op="" label="Thiếu hụt khi chuyển kho" value={t.shortage} kind="sub" />
        <Line op="" label="Chênh lệch kiểm kho" value={t.stocktakeLoss} kind="sub" />
        <Line op="−" label="Chi phí giao hàng" sub="phí trả đơn vị vận chuyển" value={t.shippingCost} />
        <Line op="=" label="Lợi nhuận ròng" value={t.netProfit} kind="total" pct={netMargin} />
      </div>
    </Card>
  );

  const chart = data && (
    <Card size="small" className="rp-chart-card" title={`Lợi nhuận ròng theo ${groupBy === 'day' ? 'ngày' : 'tháng'}`} extra={<span className="rp-legend"><span><span className="sw" style={{ background: '#0070f4' }} />Lãi</span><span><span className="sw" style={{ background: '#dc2626' }} />Lỗ</span></span>}>
      {periods.length === 0 ? <div className="muted">Không có phát sinh trong kỳ</div> : (
        <>
          <PeriodBars rows={periods.map((p) => ({ key: p.period, label: periodLabel(p.period, groupBy), value: toNum(p.netProfit) }))} selected={selected} onSelect={setSelected} maxLabels={isMobile ? 6 : 16} />
          <div className="rp-pbar-detail">
            {sel ? <>
              <span>Kỳ <b>{periodLabel(sel.period, groupBy)}</b></span><span>HĐ <b>{sel.invoices}</b></span><span>DT thuần <b>{vnd(sel.netRevenue)}</b></span><span>Giá vốn <b>{vnd(sel.cogs)}</b></span>
              <span>LN gộp <b>{signed(sel.grossProfit)}</b></span><span>Chi khác <b>{vnd(sel.otherExpense)}</b></span><span>Thất thoát <b>{vnd(sel.losses)}</b></span><span>LN ròng <b className={toNum(sel.netProfit) < 0 ? 'neg' : 'pos'}>{signed(sel.netProfit)}</b></span>
            </> : <span className="muted">Chạm vào một cột để xem chi tiết kỳ</span>}
          </div>
        </>
      )}
    </Card>
  );

  const periodCards = (
    <div className="rp-cards">
      {periods.length === 0 ? <Empty className="rp-empty" description="Không có phát sinh trong kỳ" /> : periods.map((p) => (
        <div className="rp-card" key={p.period}>
          <div className="nm">{periodLabel(p.period, groupBy)}</div>
          <div><div className={`amt ${toNum(p.netProfit) < 0 ? 'neg' : 'pos'}`}>{signed(p.netProfit)}</div><div className="sub">lợi nhuận ròng</div></div>
          <div className="meta"><span>{p.invoices} hóa đơn</span><span>· biên ròng {fmtPct(pctOf(p.netProfit, p.netRevenue))}</span></div>
          <div className="rows">
            <div className="cell"><span>DT thuần</span><b>{vnd(p.netRevenue)}</b></div>
            <div className="cell"><span>Giá vốn</span><b>{vnd(p.cogs)}</b></div>
            <div className="cell"><span>LN gộp</span><b>{signed(p.grossProfit)}</b></div>
            <div className="cell"><span>Thu khác</span><b>{vnd(p.otherIncome)}</b></div>
            <div className="cell"><span>Chi khác</span><b>{vnd(p.otherExpense)}</b></div>
            <div className="cell"><span>Thất thoát</span><b>{vnd(p.losses)}</b></div>
            <div className="cell"><span>Giao hàng</span><b>{vnd(p.shippingCost)}</b></div>
            <div className="cell"><span>Trả hàng</span><b>{vnd(p.refunds)}</b></div>
          </div>
        </div>
      ))}
    </div>
  );
  const periodColumns: ColumnsType<ProfitPeriod> = [
    { title: 'Kỳ', dataIndex: 'period', width: 100, render: (v) => <b>{periodLabel(v, groupBy)}</b> },
    { title: 'HĐ', dataIndex: 'invoices', className: 'num', width: 60 },
    { title: 'Doanh thu', dataIndex: 'revenue', className: 'num', width: 120, render: (v) => vnd(v) },
    { title: 'Trả hàng', dataIndex: 'refunds', className: 'num', width: 110, render: (v) => vnd(v) },
    { title: 'DT thuần', dataIndex: 'netRevenue', className: 'num', width: 120, render: (v) => <b>{vnd(v)}</b> },
    { title: 'Giá vốn', dataIndex: 'cogs', className: 'num', width: 120, render: (v) => vnd(v) },
    { title: 'LN gộp', dataIndex: 'grossProfit', className: 'num', width: 120, render: (v) => <span className={toNum(v) < 0 ? 'neg' : ''}>{signed(v)}</span> },
    { title: 'Thu khác', dataIndex: 'otherIncome', className: 'num', width: 110, render: (v) => vnd(v) },
    { title: 'Chi khác', dataIndex: 'otherExpense', className: 'num', width: 110, render: (v) => vnd(v) },
    { title: 'Thất thoát', dataIndex: 'losses', className: 'num', width: 110, render: (v) => vnd(v) },
    { title: 'Giao hàng', dataIndex: 'shippingCost', className: 'num', width: 110, render: (v) => vnd(v) },
    { title: 'LN ròng', dataIndex: 'netProfit', className: 'num', width: 130, render: (v) => <b className={toNum(v) < 0 ? 'neg' : 'pos'}>{signed(v)}</b> },
    { title: 'Biên', className: 'num', width: 80, render: (_, p) => fmtPct(pctOf(p.netProfit, p.netRevenue)) },
  ];
  const periodTable = t && (
    <Table<ProfitPeriod> className="kv-table" rowKey="period" size="small" dataSource={periods} pagination={false} scroll={{ x: 1400 }} locale={{ emptyText: <Empty description="Không có phát sinh trong kỳ" /> }} columns={periodColumns}
      summary={() => periods.length ? (
        <Table.Summary fixed>
          <Table.Summary.Row>
            <Table.Summary.Cell index={0}><b>Tổng</b></Table.Summary.Cell>
            <Table.Summary.Cell index={1} className="num"><b>{t.invoices}</b></Table.Summary.Cell>
            <Table.Summary.Cell index={2} className="num"><b>{vnd(t.revenue)}</b></Table.Summary.Cell>
            <Table.Summary.Cell index={3} className="num"><b>{vnd(t.refunds)}</b></Table.Summary.Cell>
            <Table.Summary.Cell index={4} className="num"><b>{vnd(t.netRevenue)}</b></Table.Summary.Cell>
            <Table.Summary.Cell index={5} className="num"><b>{vnd(t.cogs)}</b></Table.Summary.Cell>
            <Table.Summary.Cell index={6} className="num"><b>{signed(t.grossProfit)}</b></Table.Summary.Cell>
            <Table.Summary.Cell index={7} className="num"><b>{vnd(t.otherIncome)}</b></Table.Summary.Cell>
            <Table.Summary.Cell index={8} className="num"><b>{vnd(t.otherExpense)}</b></Table.Summary.Cell>
            <Table.Summary.Cell index={9} className="num"><b>{vnd(t.losses)}</b></Table.Summary.Cell>
            <Table.Summary.Cell index={10} className="num"><b>{vnd(t.shippingCost)}</b></Table.Summary.Cell>
            <Table.Summary.Cell index={11} className="num"><b className={toNum(t.netProfit) < 0 ? 'neg' : 'pos'}>{signed(t.netProfit)}</b></Table.Summary.Cell>
            <Table.Summary.Cell index={12} className="num"><b>{fmtPct(netMargin)}</b></Table.Summary.Cell>
          </Table.Summary.Row>
        </Table.Summary>
      ) : null} />
  );

  return (
    <div className="kv-list rp-page">
      <FilterPanel>
        <FilterCard title="Chi nhánh"><BranchSelect size="small" value={branchId} onChange={setBranchId} /></FilterCard>
      </FilterPanel>
      <div className="kv-main">
        <div className="rp-head">
          <h1 className="kv-page-title">Lãi lỗ</h1>
          <div className="rp-actions">
            <Button icon={<ReloadOutlined />} onClick={() => refetch()} loading={isFetching} />
            <ExportButton query={{ type: 'profit', ...filters }} />
          </div>
        </div>
        <div className="rp-toolbar">
          <DateRangeBar value={range} onChange={(r) => { setRange(r); setSelected(undefined); }} />
          <Segmented value={groupBy} onChange={(v) => { setGroupBy(v as 'day' | 'month'); setSelected(undefined); }} options={[{ value: 'day', label: 'Theo ngày' }, { value: 'month', label: 'Theo tháng' }]} />
        </div>
        {error && !data && <Alert type="error" showIcon message={errMsg(error)} style={{ marginBottom: 10 }} />}
        {isLoading && !data ? <Skeleton active paragraph={{ rows: 10 }} /> : data && (
          <>
            {tiles}
            <div className="rp-grid2">
              {statement}
              {chart}
            </div>
            <Card size="small" title="Theo kỳ" className="rp-section">{isMobile ? periodCards : periodTable}</Card>
            <div className="rp-grid2 rp-section">
              <Card size="small" title="Chi phí theo loại"><NamedList rows={data.expenseByCategory} empty="Không có phiếu chi khác trong kỳ" tone="neg" /></Card>
              <Card size="small" title="Thu khác theo loại"><NamedList rows={data.incomeByCategory} empty="Không có phiếu thu khác trong kỳ" tone="pos" /></Card>
            </div>
          </>
        )}
      </div>
    </div>
  );
}
