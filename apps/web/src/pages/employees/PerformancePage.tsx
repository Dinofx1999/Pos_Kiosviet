import { Alert, Button, Card, Empty, Segmented, Skeleton } from 'antd';
import Table from '../../components/ResponsiveTable';
import { ReloadOutlined } from '@ant-design/icons';
import { useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import { errMsg } from '../../api/client';
import { PerformanceRow, fmtHours, usePerformance } from '../../api/employees';
import { useIsMobile } from '../../hooks/useMedia';
import { useCan } from '../../store/auth';
import { qty, toNum } from '../../utils/format';
import { BranchSelect, CardPager, DateRangeBar, HBarChart, RankBadge, Range, Stat, fmtPct, pctOf, presetRange, signed, vnd } from '../reports/ReportShared';
import { CashDiff, EmployeeSelect, periodParams, useUrlUserId } from './EmployeeShared';
import './employees.css';

type Metric = 'netRevenue' | 'grossProfit' | 'invoices' | 'commission';
const METRICS: { value: Metric; label: string; fmt: (r: PerformanceRow) => string }[] = [
  { value: 'netRevenue', label: 'DT thuần', fmt: (r) => vnd(r.netRevenue) },
  { value: 'grossProfit', label: 'LN gộp', fmt: (r) => vnd(r.grossProfit) },
  { value: 'invoices', label: 'Hóa đơn', fmt: (r) => String(r.invoices) },
  { value: 'commission', label: 'Hoa hồng', fmt: (r) => vnd(r.commission) },
];

/** Hiệu suất nhân viên (BR-152): doanh thu, lợi nhuận, hóa đơn, giỏ TB, ca & chênh lệch quỹ, giờ công, hoa hồng. */
export default function PerformancePage() {
  const isMobile = useIsMobile();
  const can = useCan();
  const [range, setRange] = useState<Range>(() => presetRange('month'));
  const [branchId, setBranchId] = useState<string>();
  const [userId, setUserId] = useUrlUserId();
  const [metric, setMetric] = useState<Metric>('netRevenue');
  const [page, setPage] = useState(1);
  const { data, isLoading, isFetching, error, refetch } = usePerformance({ ...periodParams(range), branchId, userId });
  const m = METRICS.find((x) => x.value === metric)!;
  const rows = useMemo(() => [...(data?.data ?? [])].sort((a, b) => toNum(b[metric]) - toNum(a[metric])), [data, metric]);
  const pageRows = isMobile ? rows.slice((page - 1) * 20, page * 20) : rows;
  const t = data?.totals;
  const sumGross = rows.reduce((s, r) => s + toNum(r.grossProfit), 0);
  const sumInvoices = rows.reduce((s, r) => s + r.invoices, 0);
  const links = (r: PerformanceRow) => (
    <div className="em-links">
      <Link to={`/employees/attendance?tab=all&userId=${r.sellerId}`}>Chấm công</Link>
      {can('commission.view') && <Link to={`/employees/commissions?tab=team&userId=${r.sellerId}`}>Hoa hồng</Link>}
      <Link to={`/invoices?sellerId=${r.sellerId}`}>Hóa đơn</Link>
      {can('shift.view') && <Link to={`/shifts?userId=${r.sellerId}`}>Ca bán hàng</Link>}
    </div>
  );
  return (
    <div className="em-page">
      <div className="rp-head"><h1 className="kv-page-title">Hiệu suất nhân viên</h1><Button icon={<ReloadOutlined />} loading={isFetching} onClick={() => refetch()} /></div>
      <div className="em-toolbar">
        <DateRangeBar value={range} onChange={(r) => { setRange(r); setPage(1); }} />
        <div className="em-w"><EmployeeSelect value={userId} onChange={(v) => { setUserId(v); setPage(1); }} /></div>
        <div className="em-w"><BranchSelect value={branchId} onChange={(v) => { setBranchId(v); setPage(1); }} /></div>
      </div>
      {error && !data && <Alert type="error" showIcon message={errMsg(error)} style={{ marginBottom: 10 }} />}
      {isLoading && !data ? <Skeleton active paragraph={{ rows: 10 }} /> : data && t && (
        <>
          <div className="rp-stats">
            <Stat label="Doanh thu thuần" value={vnd(t.netRevenue)} tone="blue" sub={`${sumInvoices} hóa đơn · trả hàng ${vnd(toNum(t.revenue) - toNum(t.netRevenue))}`} />
            <Stat label="Lợi nhuận gộp" value={signed(sumGross)} tone={sumGross < 0 ? 'neg' : 'pos'} sub={`biên ${fmtPct(pctOf(sumGross, t.revenue))}`} />
            <Stat label="Hoa hồng" value={vnd(t.commission)} tone="warn" sub={`${fmtPct(pctOf(t.commission, t.netRevenue))} doanh thu thuần`} />
            <Stat label="Nhân viên có doanh số" value={t.sellers} sub={`${range[0].format('DD/MM')} – ${range[1].format('DD/MM/YYYY')}`} />
          </div>
          <Card size="small" className="rp-chart-card rp-section" title="Top 5 nhân viên" extra={<Segmented size="small" value={metric} onChange={(v) => { setMetric(v as Metric); setPage(1); }} options={METRICS.map((x) => ({ value: x.value, label: x.label }))} />}>
            {rows.length === 0 ? <div className="muted">Không có hóa đơn trong kỳ</div> : <HBarChart rows={rows.slice(0, 5).map((r) => ({ key: r.sellerId, name: r.name, sub: `${r.invoices} HĐ`, value: toNum(r[metric]), display: m.fmt(r) }))} onPick={(k) => setUserId(userId === k ? undefined : k)} />}
          </Card>
          <Card size="small" className="rp-section" title="Bảng xếp hạng">
            {rows.length === 0 ? <Empty description="Không có hóa đơn hoàn thành trong kỳ" /> : isMobile ? (
              <>
                <div className="rp-cards">
                  {pageRows.map((r, i) => (
                    <div key={r.sellerId} className="rp-card ranked">
                      <RankBadge rank={(page - 1) * 20 + i + 1} />
                      <div className="nm">{r.name}</div>
                      <div><div className="amt blue">{m.fmt(r)}</div><div className="sub">{m.label}</div></div>
                      <div className="meta"><span>{r.invoices} hóa đơn</span><span>· {r.customers} khách</span><span>· giỏ TB {vnd(r.avgBasket)}</span></div>
                      <div className="rows">
                        <div className="cell"><span>DT thuần</span><b>{vnd(r.netRevenue)}</b></div>
                        <div className="cell"><span>Trả hàng</span><b>{vnd(r.returned)}</b></div>
                        <div className="cell"><span>LN gộp</span><b className={toNum(r.grossProfit) < 0 ? 'neg' : ''}>{signed(r.grossProfit)}</b></div>
                        <div className="cell"><span>Số món</span><b>{qty(r.items)}</b></div>
                        <div className="cell"><span>Ca bán</span><b>{r.shifts}</b></div>
                        <div className="cell"><span>Quỹ</span><b><CashDiff value={r.cashDifference} shifts={r.shifts} /></b></div>
                        <div className="cell"><span>Giờ công</span><b>{r.attendanceSessions ? `${fmtHours(r.attendanceMinutes)} · ${r.attendanceSessions} lượt` : '—'}</b></div>
                        <div className="cell"><span>Hoa hồng</span><b className="pos">{vnd(r.commission)}</b></div>
                      </div>
                      <div className="row">{links(r)}</div>
                    </div>
                  ))}
                </div>
                <CardPager page={page} pageSize={20} total={rows.length} onChange={(p) => setPage(p)} />
              </>
            ) : (
              <Table<PerformanceRow> className="kv-table" size="small" rowKey="sellerId" dataSource={rows} pagination={false} scroll={{ x: 1400 }}
                expandable={{ expandedRowRender: (r) => links(r), expandRowByClick: true }}
                columns={[
                  { title: '#', width: 44, render: (_, __, i) => <RankBadge rank={i + 1} /> },
                  { title: 'Nhân viên', dataIndex: 'name', width: 170, fixed: 'left', render: (v) => <b>{v}</b> },
                  { title: 'HĐ', dataIndex: 'invoices', className: 'num', width: 60 },
                  { title: 'Doanh thu', dataIndex: 'revenue', className: 'num', width: 120, render: (v) => vnd(v) },
                  { title: 'Trả hàng', dataIndex: 'returned', className: 'num', width: 110, render: (v) => toNum(v) ? vnd(v) : <span className="muted">—</span> },
                  { title: 'DT thuần', dataIndex: 'netRevenue', className: 'num', width: 130, render: (v) => <b>{vnd(v)}</b> },
                  { title: 'LN gộp', dataIndex: 'grossProfit', className: 'num', width: 120, render: (v) => <span className={toNum(v) < 0 ? 'neg' : ''}>{signed(v)}</span> },
                  { title: 'Món', dataIndex: 'items', className: 'num', width: 70, render: (v) => qty(v) },
                  { title: 'Khách', dataIndex: 'customers', className: 'num', width: 70 },
                  { title: 'Giỏ TB', dataIndex: 'avgBasket', className: 'num', width: 110, render: (v) => vnd(v) },
                  { title: 'Ca', dataIndex: 'shifts', className: 'num', width: 50 },
                  { title: 'Chênh lệch quỹ', width: 130, render: (_, r) => <CashDiff value={r.cashDifference} shifts={r.shifts} /> },
                  { title: 'Giờ công', className: 'num', width: 120, render: (_, r) => r.attendanceSessions ? <span>{fmtHours(r.attendanceMinutes)} <span className="muted">· {r.attendanceSessions} lượt</span></span> : <span className="muted">—</span> },
                  { title: 'Hoa hồng', dataIndex: 'commission', className: 'num', width: 120, render: (v) => <b className="pos">{vnd(v)}</b> },
                ]}
                summary={() => (
                  <Table.Summary fixed>
                    <Table.Summary.Row>
                      <Table.Summary.Cell index={0} colSpan={2}><b>Tổng</b></Table.Summary.Cell>
                      <Table.Summary.Cell index={2} className="num"><b>{sumInvoices}</b></Table.Summary.Cell>
                      <Table.Summary.Cell index={3} className="num"><b>{vnd(t.revenue)}</b></Table.Summary.Cell>
                      <Table.Summary.Cell index={4} className="num"><b>{vnd(toNum(t.revenue) - toNum(t.netRevenue))}</b></Table.Summary.Cell>
                      <Table.Summary.Cell index={5} className="num"><b>{vnd(t.netRevenue)}</b></Table.Summary.Cell>
                      <Table.Summary.Cell index={6} className="num"><b>{signed(sumGross)}</b></Table.Summary.Cell>
                      <Table.Summary.Cell index={7} className="num"><b>{qty(rows.reduce((s, r) => s + toNum(r.items), 0))}</b></Table.Summary.Cell>
                      <Table.Summary.Cell index={8} className="num" /><Table.Summary.Cell index={9} className="num" />
                      <Table.Summary.Cell index={10} className="num"><b>{rows.reduce((s, r) => s + r.shifts, 0)}</b></Table.Summary.Cell>
                      <Table.Summary.Cell index={11}><b>{signed(rows.reduce((s, r) => s + toNum(r.cashDifference), 0))}</b></Table.Summary.Cell>
                      <Table.Summary.Cell index={12} className="num"><b>{fmtHours(rows.reduce((s, r) => s + r.attendanceMinutes, 0))}</b></Table.Summary.Cell>
                      <Table.Summary.Cell index={13} className="num"><b className="pos">{vnd(t.commission)}</b></Table.Summary.Cell>
                    </Table.Summary.Row>
                  </Table.Summary>
                )} />
            )}
            <div className="rp-table-note">Doanh thu theo hóa đơn hoàn thành của nhân viên bán (không tính hóa đơn nhập lịch sử); chênh lệch quỹ là tổng chênh lệch tiền mặt khi đóng ca; giờ công từ chấm công.</div>
          </Card>
        </>
      )}
    </div>
  );
}
