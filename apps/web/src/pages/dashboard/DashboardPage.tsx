import { Alert, Avatar, Dropdown, Empty, Segmented, Skeleton, Tag } from 'antd';
import {
  ArrowDownOutlined, ArrowUpOutlined, AuditOutlined, BarChartOutlined, CarOutlined, CaretDownOutlined, ClockCircleOutlined, DollarOutlined, ExpandAltOutlined, EyeInvisibleOutlined, EyeOutlined,
  FileDoneOutlined, GiftOutlined, GlobalOutlined, ImportOutlined, LineChartOutlined, PauseCircleOutlined, PieChartOutlined, RightOutlined, RollbackOutlined, ShoppingOutlined, SwapOutlined, TeamOutlined, UserOutlined, WalletOutlined, WarningOutlined,
} from '@ant-design/icons';
import dayjs from 'dayjs';
import { ReactNode, useState } from 'react';
import { Link } from 'react-router-dom';
import { HomeSales, useDashboardHome } from '../../api/dashboard';
import { errMsg } from '../../api/client';
import { useIsMobile } from '../../hooks/useMedia';
import { useAuthStore } from '../../store/auth';
import { DOC_STATUS_COLOR, DOC_STATUS_LABEL, DOC_TYPE_LABEL, money, qty, toNum } from '../../utils/format';
import './dashboard.css';

type Period = 'today' | 'week' | 'month';
const PERIOD_LABEL: Record<Period, string> = { today: 'Hôm nay', week: '7 ngày', month: 'Tháng này' };
const PREV_LABEL: Record<Period, string> = { today: 'so với hôm qua', week: 'so với 7 ngày trước', month: 'so với tháng trước' };

/** 47.864.267 → "47,9 tr"; 1.250.000.000 → "1,25 tỷ"; below a million the full figure. */
export function compactMoney(v: unknown): string {
  const n = toNum(v);
  const abs = Math.abs(n);
  if (abs >= 1e9) return `${(n / 1e9).toLocaleString('vi-VN', { maximumFractionDigits: 2 })} tỷ`;
  if (abs >= 1e6) return `${(n / 1e6).toLocaleString('vi-VN', { maximumFractionDigits: 1 })} tr`;
  return money(Math.round(n));
}
/** Số to kiểu KiotViet: 8.810.000 → { num: "8,81", unit: "triệu" }; 550.000 → { num: "550", unit: "nghìn" }. */
function bigMoney(v: unknown): { num: string; unit: string } {
  const n = toNum(v);
  const abs = Math.abs(n);
  if (abs >= 1e9) return { num: (n / 1e9).toLocaleString('vi-VN', { maximumFractionDigits: 2 }), unit: 'tỷ' };
  if (abs >= 1e6) return { num: (n / 1e6).toLocaleString('vi-VN', { maximumFractionDigits: 2 }), unit: 'triệu' };
  if (abs >= 1e3) return { num: (n / 1e3).toLocaleString('vi-VN', { maximumFractionDigits: 0 }), unit: 'nghìn' };
  return { num: money(Math.round(n)), unit: 'đ' };
}
/** Nhãn trục tiền: 3.000.000 → "3Tr", 500.000 → "500k", 1.500.000.000 → "1,5 tỷ". */
const axisLabel = (n: number) => {
  const f = (x: number) => x.toLocaleString('vi-VN', { maximumFractionDigits: 1 });
  return n >= 1e9 ? `${f(n / 1e9)} tỷ` : n >= 1e6 ? `${f(n / 1e6)}Tr` : n >= 1e3 ? `${f(n / 1e3)}k` : String(n);
};
/** Mốc trục Y đẹp: bước 1/2/2,5/5 × 10^k sao cho ≤ 4 mốc. */
function axisTicks(max: number): { top: number; ticks: number[] } {
  if (max <= 0) return { top: 1, ticks: [] };
  const p = 10 ** Math.floor(Math.log10(max));
  for (const s of [1, 2, 2.5, 5, 10]) {
    const step = s * p; const n = Math.ceil(max / step);
    if (n <= 4) return { top: n * step, ticks: Array.from({ length: n }, (_, i) => (i + 1) * step) };
  }
  return { top: max, ticks: [max] };
}
const vnd = (v: unknown) => `${money(Math.round(toNum(v)))} ₫`;
const cap = (s: string) => s.charAt(0).toUpperCase() + s.slice(1);
const initials = (name?: string | null) => {
  const parts = (name ?? '').trim().split(/\s+/).filter(Boolean);
  if (!parts.length) return '?';
  return (parts.length === 1 ? parts[0].slice(0, 2) : parts[0][0] + parts[parts.length - 1][0]).toUpperCase();
};
const greeting = () => { const h = dayjs().hour(); return h < 11 ? 'Chào buổi sáng' : h < 14 ? 'Chào buổi trưa' : h < 18 ? 'Chào buổi chiều' : 'Chào buổi tối'; };
const PROFIT_KEY = 'dh.showProfit';
const readShowProfit = () => { try { return localStorage.getItem(PROFIT_KEY) === '1'; } catch { return false; } };

/** % change between two amounts; null when there is nothing to compare with. */
function change(cur: number, prev: number): { pct: number | null; dir: 'up' | 'down' | 'flat' } {
  if (prev <= 0) return { pct: null, dir: cur > 0 ? 'up' : 'flat' };
  const pct = ((cur - prev) / prev) * 100;
  return { pct, dir: pct > 0.5 ? 'up' : pct < -0.5 ? 'down' : 'flat' };
}

interface Bar { key: string; label: string; value: number; invoices: number; title: string }

function buildBars(sales: HomeSales, period: Period): Bar[] {
  if (period === 'today') {
    const byHour = new Map(sales.byHour.map((h) => [h.hour, h]));
    const hours = sales.byHour.map((h) => h.hour);
    const start = Math.min(8, ...hours); const end = Math.max(21, ...hours, dayjs().hour());
    return Array.from({ length: end - start + 1 }, (_, i) => {
      const hour = start + i; const h = byHour.get(hour);
      return { key: String(hour), label: `${hour}h`, value: toNum(h?.revenue), invoices: h?.invoices ?? 0, title: `${hour}:00 – ${hour + 1}:00` };
    });
  }
  const byDay = new Map(sales.byDay.map((d) => [d.day, d]));
  const first = period === 'week' ? dayjs().subtract(6, 'day') : dayjs().startOf('month');
  const days = dayjs().diff(first, 'day') + 1;
  return Array.from({ length: days }, (_, i) => {
    const d = first.add(i, 'day'); const key = d.format('YYYY-MM-DD'); const row = byDay.get(key);
    return { key, label: period === 'week' ? cap(d.format('dd DD')) : d.format('DD'), value: toNum(row?.revenue), invoices: row?.invoices ?? 0, title: cap(d.format('dddd, DD/MM/YYYY')) };
  });
}

/** Cột doanh thu có trục tiền bên trái (3Tr / 2Tr / 1Tr) như KiotViet; chạm cột để xem số. */
function RevenueBars({ bars }: { bars: Bar[] }) {
  const lastNonZero = [...bars].reverse().find((b) => b.value > 0)?.key;
  const [picked, setPicked] = useState<string | undefined>(undefined);
  const sel = bars.find((b) => b.key === (picked ?? lastNonZero));
  const { top, ticks } = axisTicks(Math.max(...bars.map((b) => b.value), 0));
  const every = bars.length > 20 ? 5 : bars.length > 12 ? 2 : 1;
  const total = bars.reduce((s, b) => s + b.value, 0);
  return (
    <div className="dh-chart">
      <div className="dh-chart-sel">
        {sel ? <><b>{sel.title}</b><span>{sel.invoices} đơn · {vnd(sel.value)}</span></> : <span className="muted">Chưa có doanh thu trong kỳ này</span>}
      </div>
      <div className="dh-plot">
        <div className="dh-plot-area">
          {ticks.map((t) => <div key={t} className="dh-gridline" style={{ bottom: `${(t / top) * 100}%` }}><span>{axisLabel(t)}</span></div>)}
          <div className="dh-bars" style={{ ['--n' as string]: bars.length }}>
            {bars.map((b) => (
              <button type="button" key={b.key} className={`dh-bar ${b.key === sel?.key ? 'on' : ''} ${b.value === 0 ? 'zero' : ''}`} onClick={() => setPicked(b.key)} aria-label={`${b.title}: ${vnd(b.value)}`}>
                <span className="dh-bar-fill" style={{ height: `${Math.max(b.value > 0 ? 3 : 1, (b.value / top) * 100)}%` }} />
              </button>
            ))}
          </div>
        </div>
        <div className="dh-xlabels" style={{ ['--n' as string]: bars.length }}>
          {bars.map((b, i) => <span key={b.key} className="dh-bar-lbl">{i % every === 0 || bars.length <= 12 ? b.label : ''}</span>)}
        </div>
      </div>
      {total === 0 && <div className="dh-chart-empty">Bán đơn đầu tiên để thấy biểu đồ nhé</div>}
    </div>
  );
}

const PIE_COLORS = ['#0070f4', '#2fb344', '#f59e0b', '#d6336c', '#7c3aed', '#94a3b8'];
/** Biểu đồ tròn: tỷ trọng doanh thu 5 hàng bán chạy nhất 7 ngày. */
function RevenuePie({ products }: { products: HomeSales['topProducts'] }) {
  const sorted = [...products].sort((a, b) => toNum(b.revenue) - toNum(a.revenue));
  const top = sorted.slice(0, 5);
  const other = sorted.slice(5).reduce((s, p) => s + toNum(p.revenue), 0);
  const segs = [...top.map((p) => ({ name: p.name, value: toNum(p.revenue) })), ...(other > 0 ? [{ name: 'Hàng khác', value: other }] : [])];
  const total = segs.reduce((s, x) => s + x.value, 0);
  if (!total) return <div className="dh-chart-empty static">Chưa có hàng bán trong 7 ngày qua</div>;
  let acc = 0;
  const stops = segs.map((s, i) => { const from = (acc / total) * 100; acc += s.value; return `${PIE_COLORS[i]} ${from}% ${(acc / total) * 100}%`; });
  return (
    <div className="dh-pie">
      <div className="dh-donut" style={{ background: `conic-gradient(${stops.join(', ')})` }}><div className="dh-donut-hole"><b>{compactMoney(total)}</b><span>7 ngày</span></div></div>
      <ul className="dh-legend">
        {segs.map((s, i) => <li key={s.name}><i style={{ background: PIE_COLORS[i] }} /><span className="nm">{s.name}</span><b>{Math.round((s.value / total) * 100)}%</b></li>)}
      </ul>
    </div>
  );
}

function Section({ title, extra, children, className = '' }: { title: ReactNode; extra?: ReactNode; children: ReactNode; className?: string }) {
  return (
    <section className={`dh-card ${className}`}>
      <div className="dh-card-head"><h2>{title}</h2>{extra}</div>
      {children}
    </section>
  );
}

export default function DashboardPage() {
  const me = useAuthStore((s) => s.me);
  const can = useAuthStore((s) => s.can);
  const branchId = useAuthStore((s) => s.currentBranchId);
  const setBranch = useAuthStore((s) => s.setBranch);
  const isMobile = useIsMobile();
  const { data, isLoading, error } = useDashboardHome(branchId);
  const [period, setPeriod] = useState<Period>('today');
  const [chart, setChart] = useState<'bar' | 'pie'>('bar');
  const [showProfit, setShowProfit] = useState(readShowProfit);
  const branchName = me?.branches.find((b) => b.id === branchId)?.name ?? (me?.branches.length ? 'Tất cả chi nhánh' : '');
  const toggleProfit = () => { const v = !showProfit; setShowProfit(v); try { localStorage.setItem(PROFIT_KEY, v ? '1' : '0'); } catch { /* riêng tư */ } };

  if (error) return <Alert type="error" message={errMsg(error)} showIcon />;
  if (isLoading || !data) return <div className="dh"><div className={isMobile ? 'dk-card' : 'dh-hero'}><Skeleton active paragraph={{ rows: 3 }} /></div><Skeleton active paragraph={{ rows: 8 }} /></div>;

  const sales = data.sales;
  const cur = sales ? sales[period] : null;
  const prev = sales ? sales[period === 'today' ? 'yesterday' : period === 'week' ? 'lastWeek' : 'lastMonth'] : null;
  const diff = cur && prev ? change(toNum(cur.revenue), toNum(prev.revenue)) : null;
  const avgTicket = cur && cur.invoices ? toNum(cur.revenue) / cur.invoices : 0;
  const bars = sales ? buildBars(sales, period) : [];

  // việc cần xử lý: chỉ hiện mục có số > 0
  const todo = [
    data.shift && { key: 'shift', to: '/shifts', tone: 'blue', icon: <ClockCircleOutlined />, label: 'Ca bán hàng đang mở', value: `${data.shift.invoices} đơn · ${compactMoney(data.shift.revenue)}`, sub: `${data.shift.code} · từ ${dayjs(data.shift.openedAt).format('HH:mm')}` },
    sales && data.todo.heldInvoices ? { key: 'held', to: '/invoices?status=DRAFT', tone: 'amber', icon: <PauseCircleOutlined />, label: 'Đơn đang giữ', value: data.todo.heldInvoices, sub: 'chờ thanh toán' } : null,
    data.todo.pendingOrders ? { key: 'orders', to: '/orders', tone: 'indigo', icon: <FileDoneOutlined />, label: 'Đơn đặt đã xác nhận', value: data.todo.pendingOrders, sub: 'chờ giao / hoàn tất' } : null,
    data.todo.deliveriesInProgress ? { key: 'deliveries', to: '/deliveries', tone: 'lime', icon: <CarOutlined />, label: 'Đang giao hàng', value: data.todo.deliveriesInProgress, sub: 'vận đơn chưa xong' } : null,
    sales && sales.unpaid.count ? { key: 'unpaid', to: '/invoices?unpaid=1', tone: 'red', icon: <DollarOutlined />, label: 'Hóa đơn chưa thu đủ', value: compactMoney(sales.unpaid.amount), sub: `${sales.unpaid.count} hóa đơn` } : null,
    data.inventory?.lowStockCount ? { key: 'low', to: '/products?stock=low', tone: 'orange', icon: <WarningOutlined />, label: 'Hàng dưới định mức', value: data.inventory.lowStockCount, sub: 'cần nhập thêm' } : null,
    data.todo.transfersToReceive ? { key: 'transfers', to: '/transfers?tab=in', tone: 'cyan', icon: <SwapOutlined />, label: 'Chuyển kho chờ nhận', value: data.todo.transfersToReceive, sub: 'đang trên đường' } : null,
    sales && sales.returnsToday.count ? { key: 'returns', to: '/sales-returns', tone: 'red', icon: <RollbackOutlined />, label: 'Trả hàng hôm nay', value: sales.returnsToday.count, sub: compactMoney(sales.returnsToday.amount) } : null,
    data.todo.birthdaysToday ? { key: 'birthday', to: '/customers', tone: 'pink', icon: <GiftOutlined />, label: 'Sinh nhật hôm nay', value: data.todo.birthdaysToday, sub: 'khách hàng' } : null,
  ].filter(Boolean) as { key: string; to: string; tone: string; icon: ReactNode; label: string; value: ReactNode; sub?: string }[];

  const topMax = Math.max(1, ...(sales?.topProducts.map((p) => toNum(p.revenue)) ?? [0]));

  // lối tắt kiểu KiotViet (hàng icon dưới thẻ doanh thu)
  const quick = [
    { key: 'orders', to: '/orders', label: 'Đặt hàng', icon: <ShoppingOutlined />, tone: 'blue', ok: can('order.view') },
    { key: 'deliveries', to: '/deliveries', label: 'Giao hàng', icon: <CarOutlined />, tone: 'blue', ok: can('delivery.view') },
    { key: 'cash', to: '/cash', label: 'Sổ quỹ', icon: <WalletOutlined />, tone: 'green', ok: can('cash.view') },
    { key: 'customers', to: '/customers', label: 'Khách hàng', icon: <UserOutlined />, tone: 'blue', ok: can('customer.view') },
    { key: 'staff', to: '/employees', label: 'Nhân viên', icon: <TeamOutlined />, tone: 'blue', ok: can('attendance.view') },
    { key: 'receipts', to: '/purchase-receipts', label: 'Nhập hàng', icon: <ImportOutlined />, tone: 'green', ok: can('purchase.receipt.view') },
    { key: 'stocktake', to: '/stocktakes', label: 'Kiểm kho', icon: <AuditOutlined />, tone: 'blue', ok: can('stocktake.view') },
    { key: 'reports', to: '/reports/sales', label: 'Báo cáo', icon: <LineChartOutlined />, tone: 'green', ok: can('sales.report.view') },
    { key: 'online', to: '/online/settings', label: 'Bán online', icon: <GlobalOutlined />, tone: 'blue', ok: can('online.manage'), badge: 'Mới' },
  ].filter((x) => x.ok);

  const periodMenu = { items: (Object.keys(PERIOD_LABEL) as Period[]).map((k) => ({ key: k, label: PERIOD_LABEL[k] })), selectedKeys: [period], onClick: ({ key }: { key: string }) => setPeriod(key as Period) };
  const branchMenu = { items: (me?.branches ?? []).map((b) => ({ key: b.id, label: b.name })), selectedKeys: branchId ? [branchId] : [], onClick: ({ key }: { key: string }) => setBranch(key) };
  const rev = cur ? bigMoney(cur.revenue) : null;
  const profit = cur?.grossProfit !== undefined ? bigMoney(cur.grossProfit) : null;

  const chartSection = sales && (
    <Section className="dh-a-chart" title="Doanh thu" extra={<Link to="/reports/sales" className="dh-more" aria-label="Báo cáo doanh thu">{isMobile ? <RightOutlined style={{ fontSize: 14, color: '#6b7280' }} /> : <>Báo cáo <RightOutlined /></>}</Link>}>
      <div className="dh-chart-tools">
        <button type="button" className={chart === 'bar' ? 'on' : ''} onClick={() => setChart('bar')} aria-label="Biểu đồ cột"><BarChartOutlined /></button>
        <button type="button" className={chart === 'pie' ? 'on' : ''} onClick={() => setChart('pie')} aria-label="Biểu đồ tròn"><PieChartOutlined /></button>
        <Link to="/reports/sales" aria-label="Xem báo cáo chi tiết"><ExpandAltOutlined /></Link>
        <span className="dh-chart-cap">{chart === 'bar' ? (period === 'today' ? 'Theo giờ hôm nay' : period === 'week' ? '7 ngày qua' : 'Tháng này') : 'Hàng bán chạy 7 ngày'}</span>
      </div>
      {chart === 'bar' ? <RevenueBars key={period} bars={bars} /> : <RevenuePie products={sales.topProducts} />}
    </Section>
  );

  return (
    <div className={`dh ${isMobile ? 'dh-mobile' : ''}`}>
      {isMobile ? (
        /* ---------- điện thoại: bố cục như app KiotViet ---------- */
        <div className="dk">
          <div className="dk-pills">
            <Dropdown menu={periodMenu} trigger={['click']}><button type="button" className="dk-pill">{PERIOD_LABEL[period]} <CaretDownOutlined /></button></Dropdown>
            {(me?.branches.length ?? 0) > 1
              ? <Dropdown menu={branchMenu} trigger={['click']}><button type="button" className="dk-pill">{branchName} <CaretDownOutlined /></button></Dropdown>
              : branchName && <span className="dk-pill static">{branchName}</span>}
          </div>
          {sales && cur && rev ? (
            <div className="dk-card">
              <div className="dk-row">
                <Link to="/invoices" className="dk-rev">
                  <div className="k">{cur.invoices} hóa đơn</div>
                  <div className="v"><b>{rev.num}</b> <small>{rev.unit}</small></div>
                  {diff && diff.pct !== null && <div className={`dk-cmp ${diff.dir}`}>{diff.dir === 'up' ? <ArrowUpOutlined /> : diff.dir === 'down' ? <ArrowDownOutlined /> : null}{Math.abs(diff.pct).toLocaleString('vi-VN', { maximumFractionDigits: 0 })}% {PREV_LABEL[period]}</div>}
                </Link>
                {profit ? (
                  <div className="dk-profit">
                    <div className="k">Lợi nhuận <button type="button" className="dk-eye" onClick={toggleProfit} aria-label={showProfit ? 'Ẩn lợi nhuận' : 'Hiện lợi nhuận'}>{showProfit ? <EyeOutlined /> : <EyeInvisibleOutlined />}</button></div>
                    <div className="v">{showProfit ? <><b>{profit.num}</b> <small>{profit.unit}</small></> : <span className="dk-masked">*** ***</span>}</div>
                  </div>
                ) : (
                  <div className="dk-profit"><div className="k">Khách mua</div><div className="v"><b>{cur.customers}</b></div><div className="dk-sub">TB {compactMoney(avgTicket)}/đơn</div></div>
                )}
              </div>
              <div className="dk-sep" />
              <div className="dk-extra">
                {period === 'today'
                  ? <Link to="/sales-returns" className="dk-extra-item"><RollbackOutlined /> {sales.returnsToday.count} đơn trả hàng{sales.returnsToday.count ? <> - <b>{bigMoney(sales.returnsToday.amount).num} {bigMoney(sales.returnsToday.amount).unit}</b></> : null}</Link>
                  : <span className="dk-extra-item"><UserOutlined /> {cur.customers} khách mua · TB <b>{compactMoney(avgTicket)}</b>/đơn</span>}
                {sales.unpaid.count > 0 && <Link to="/invoices?unpaid=1" className="dk-extra-item warn"><DollarOutlined /> {sales.unpaid.count} hóa đơn chưa thu đủ - <b>{compactMoney(sales.unpaid.amount)}</b></Link>}
              </div>
            </div>
          ) : (
            <div className="dk-card dk-plain">Chúc một ngày bán hàng thuận lợi!</div>
          )}
          {quick.length > 0 && (
            <div className="dk-quick">
              {quick.map((q) => (
                <Link key={q.key} to={q.to} className="dk-quick-item">
                  <span className={`ic tone-${q.tone}`}>{q.icon}{q.badge && <i className="dk-new">{q.badge}</i>}</span>
                  <span className="lbl">{q.label}</span>
                </Link>
              ))}
            </div>
          )}
        </div>
      ) : (
        /* ---------- máy tính: thẻ hero ---------- */
        <div className="dh-hero">
          <div className="dh-greet">
            <div>
              <div className="dh-hello">{greeting()}, {me?.user.fullName ?? ''} 👋</div>
              <div className="dh-where">{branchName}{branchName ? ' · ' : ''}{cap(dayjs().format('dddd, DD/MM'))}</div>
            </div>
          </div>
          {sales && cur ? (
            <div className="dh-hero-card">
              <Segmented className="dh-seg" block value={period} onChange={(v) => setPeriod(v as Period)} options={(Object.keys(PERIOD_LABEL) as Period[]).map((k) => ({ value: k, label: PERIOD_LABEL[k] }))} />
              <div className="dh-rev">
                <div className="dh-rev-lbl">Doanh thu {PERIOD_LABEL[period].toLowerCase()}</div>
                <div className="dh-rev-val">{vnd(cur.revenue)}</div>
                {diff && (
                  <div className={`dh-rev-cmp ${diff.dir}`}>
                    {diff.dir === 'up' ? <ArrowUpOutlined /> : diff.dir === 'down' ? <ArrowDownOutlined /> : null}
                    {diff.pct === null
                      ? <span className="muted">{period === 'today' ? 'Hôm qua' : period === 'week' ? '7 ngày trước' : 'Tháng trước'} không có doanh thu</span>
                      : <>{`${Math.abs(diff.pct).toLocaleString('vi-VN', { maximumFractionDigits: 0 })}%`}<span className="muted"> {PREV_LABEL[period]} ({compactMoney(prev?.revenue)})</span></>}
                  </div>
                )}
              </div>
              <div className="dh-kpis">
                <Link to="/invoices" className="dh-kpi"><span className="k">Đơn hàng</span><span className="v">{cur.invoices}</span></Link>
                <div className="dh-kpi"><span className="k">Khách mua</span><span className="v">{cur.customers}</span></div>
                {cur.grossProfit !== undefined
                  ? <Link to="/reports/profit" className="dh-kpi"><span className="k">Lợi nhuận gộp</span><span className="v pos">{compactMoney(cur.grossProfit)}</span></Link>
                  : <div className="dh-kpi"><span className="k">TB / đơn</span><span className="v">{compactMoney(avgTicket)}</span></div>}
              </div>
            </div>
          ) : (
            <div className="dh-hero-card dh-hero-plain">Chúc một ngày bán hàng thuận lợi!</div>
          )}
        </div>
      )}

      <div className="dh-grid">
          {isMobile && chartSection}
          {todo.length > 0 && (
            <Section title="Cần xử lý" className="dh-a-todo">
              <div className="dh-todo">
                {todo.map((t) => (
                  <Link key={t.key} to={t.to} className={`dh-todo-item tone-${t.tone}`}>
                    <span className="ic">{t.icon}</span>
                    <span className="dh-todo-body"><span className="dh-todo-lbl">{t.label}</span>{t.sub && <span className="dh-todo-sub">{t.sub}</span>}</span>
                    <span className="dh-todo-val">{t.value}</span>
                    <RightOutlined className="dh-todo-arrow" />
                  </Link>
                ))}
              </div>
            </Section>
          )}
          {!isMobile && chartSection}

          {sales && (
            <Section className="dh-a-top" title="Hàng bán chạy 7 ngày" extra={<Link to="/reports/products" className="dh-more">Xem thêm <RightOutlined /></Link>}>
              {sales.topProducts.length === 0 ? <Empty image={Empty.PRESENTED_IMAGE_SIMPLE} description="Chưa có hàng bán trong 7 ngày qua" /> : (
                <ol className="dh-top">
                  {sales.topProducts.map((p, i) => (
                    <li key={p.variantId}>
                      <span className={`dh-rank r${i + 1}`}>{i + 1}</span>
                      <div className="dh-top-body">
                        <div className="dh-top-name">{p.name}</div>
                        <div className="dh-top-meta">{p.sku} · đã bán {qty(p.quantity)}</div>
                        <div className="dh-top-bar"><span style={{ width: `${(toNum(p.revenue) / topMax) * 100}%` }} /></div>
                      </div>
                      <div className="dh-top-rev">{compactMoney(p.revenue)}</div>
                    </li>
                  ))}
                </ol>
              )}
            </Section>
          )}

          {data.inventory && (
            <Section className="dh-a-inv" title="Tồn kho" extra={<Link to="/inventory/balances" className="dh-more">Chi tiết <RightOutlined /></Link>}>
              <div className="dh-inv">
                <Link to="/products" className="dh-inv-stat"><span className="k">SKU có tồn</span><span className="v">{data.inventory.skuCount}</span></Link>
                <Link to="/inventory/balances" className="dh-inv-stat"><span className="k">Tổng tồn</span><span className="v">{qty(data.inventory.onHandTotal)}</span></Link>
                {data.inventory.stockValue !== undefined && <Link to="/reports/valuation" className="dh-inv-stat"><span className="k">Giá trị tồn</span><span className="v" title={vnd(data.inventory.stockValue)}>{compactMoney(data.inventory.stockValue)}</span></Link>}
                <Link to="/products?stock=low" className={`dh-inv-stat ${data.inventory.lowStockCount ? 'warn' : ''}`}><span className="k">Dưới định mức</span><span className="v">{data.inventory.lowStockCount}</span></Link>
              </div>
              {data.inventory.recentDocuments.length > 0 && (
                <div className="dh-docs">
                  <div className="dh-sub">Phiếu kho gần đây <Link to="/inventory/documents" className="dh-more">Tất cả <RightOutlined /></Link></div>
                  {data.inventory.recentDocuments.map((d) => (
                    <Link key={d.id} to={`/inventory/documents?search=${d.code}`} className="dh-doc">
                      <span className="dh-doc-code">{d.code} <span className="dh-doc-type">{DOC_TYPE_LABEL[d.type] ?? d.type}</span></span>
                      <span className="dh-doc-val">{money(d.totalCost)}</span>
                      <span className="dh-doc-meta">{d.warehouse?.name ?? ''} · {dayjs(d.createdAt).format('DD/MM HH:mm')}</span>
                      <Tag color={DOC_STATUS_COLOR[d.status]} className="dh-doc-tag">{DOC_STATUS_LABEL[d.status] ?? d.status}</Tag>
                    </Link>
                  ))}
                </div>
              )}
            </Section>
          )}
          {sales && (
            <Section className="dh-a-feed" title="Hoạt động gần đây" extra={<Link to="/invoices" className="dh-more">Hóa đơn <RightOutlined /></Link>}>
              {sales.recentInvoices.length === 0 ? <Empty image={Empty.PRESENTED_IMAGE_SIMPLE} description="Chưa có hóa đơn nào" /> : (
                <div className="dh-feed">
                  {sales.recentInvoices.map((inv) => (
                    <Link key={inv.id} to={`/invoices?search=${inv.code}`} className={`dh-feed-item ${inv.status === 'CANCELLED' ? 'cancelled' : ''}`}>
                      <Avatar size={36} className="dh-avatar">{initials(inv.sellerName)}</Avatar>
                      <div className="dh-feed-body">
                        <div className="dh-feed-text"><b>{inv.sellerName ?? 'Hệ thống'}</b> {inv.status === 'CANCELLED' ? 'đã hủy' : 'bán'} <span className="dh-code">{inv.code}</span>{inv.customerName ? <> cho <b>{inv.customerName}</b></> : ' cho khách lẻ'}</div>
                        <div className="dh-feed-meta">{inv.lines} mặt hàng · {dayjs(inv.invoiceDate).fromNow()}{toNum(inv.paidAmount) < toNum(inv.totalAmount) && inv.status === 'COMPLETED' ? ' · còn nợ' : ''}</div>
                      </div>
                      <div className="dh-feed-amt">{money(inv.totalAmount)}</div>
                    </Link>
                  ))}
                </div>
              )}
            </Section>
          )}
      </div>
    </div>
  );
}
