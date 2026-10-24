import { Alert, Avatar, Empty, Segmented, Skeleton, Tag } from 'antd';
import {
  ArrowDownOutlined, ArrowUpOutlined, AuditOutlined, BarChartOutlined, CarOutlined, ClockCircleOutlined, DollarOutlined, FileDoneOutlined, GiftOutlined,
  InboxOutlined, PauseCircleOutlined, QuestionCircleOutlined, RightOutlined, RollbackOutlined, ShoppingCartOutlined, SwapOutlined, TagsOutlined, TeamOutlined, WalletOutlined, WarningOutlined,
} from '@ant-design/icons';
import dayjs from 'dayjs';
import { ReactNode, useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import { HomeSales, useDashboardHome } from '../../api/dashboard';
import { errMsg } from '../../api/client';
import { useAuthStore, useCan } from '../../store/auth';
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
const vnd = (v: unknown) => `${money(Math.round(toNum(v)))} ₫`;
const cap = (s: string) => s.charAt(0).toUpperCase() + s.slice(1);
const initials = (name?: string | null) => {
  const parts = (name ?? '').trim().split(/\s+/).filter(Boolean);
  if (!parts.length) return '?';
  return (parts.length === 1 ? parts[0].slice(0, 2) : parts[0][0] + parts[parts.length - 1][0]).toUpperCase();
};
const greeting = () => { const h = dayjs().hour(); return h < 11 ? 'Chào buổi sáng' : h < 14 ? 'Chào buổi trưa' : h < 18 ? 'Chào buổi chiều' : 'Chào buổi tối'; };

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

function RevenueBars({ bars }: { bars: Bar[] }) {
  const lastNonZero = [...bars].reverse().find((b) => b.value > 0)?.key;
  const [picked, setPicked] = useState<string | undefined>(undefined);
  const sel = bars.find((b) => b.key === (picked ?? lastNonZero));
  const max = Math.max(1, ...bars.map((b) => b.value));
  const every = bars.length > 20 ? 5 : bars.length > 12 ? 2 : 1;
  const total = bars.reduce((s, b) => s + b.value, 0);
  return (
    <div className="dh-chart">
      <div className="dh-chart-sel">
        {sel ? <><b>{sel.title}</b><span>{sel.invoices} đơn · {vnd(sel.value)}</span></> : <span className="muted">Chưa có doanh thu trong kỳ này</span>}
      </div>
      <div className="dh-bars" style={{ ['--n' as string]: bars.length }}>
        {bars.map((b, i) => (
          <button type="button" key={b.key} className={`dh-bar ${b.key === sel?.key ? 'on' : ''} ${b.value === 0 ? 'zero' : ''}`} onClick={() => setPicked(b.key)} aria-label={`${b.title}: ${vnd(b.value)}`}>
            <span className="dh-bar-fill" style={{ height: `${Math.max(b.value > 0 ? 6 : 2, (b.value / max) * 100)}%` }} />
            <span className="dh-bar-lbl">{i % every === 0 || bars.length <= 12 ? b.label : ''}</span>
          </button>
        ))}
      </div>
      {total === 0 && <div className="dh-chart-empty">Bán đơn đầu tiên để thấy biểu đồ nhé</div>}
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
  const can = useCan();
  const me = useAuthStore((s) => s.me);
  const branchId = useAuthStore((s) => s.currentBranchId);
  const { data, isLoading, error } = useDashboardHome(branchId);
  const [period, setPeriod] = useState<Period>('today');
  const branchName = me?.branches.find((b) => b.id === branchId)?.name ?? (me?.branches.length ? 'Tất cả chi nhánh' : '');

  const actions = useMemo(() => [
    { key: 'pos', to: '/pos', label: 'Bán hàng', icon: <ShoppingCartOutlined />, tone: 'green', ok: can('invoice.create') },
    { key: 'products', to: '/products', label: 'Hàng hóa', icon: <TagsOutlined />, tone: 'blue', ok: can('product.view') },
    { key: 'receipts', to: '/purchase-receipts', label: 'Nhập hàng', icon: <InboxOutlined />, tone: 'orange', ok: can('purchase.receipt.view') },
    { key: 'customers', to: '/customers', label: 'Khách hàng', icon: <TeamOutlined />, tone: 'pink', ok: can('customer.view') },
    { key: 'orders', to: '/orders', label: 'Đặt hàng', icon: <FileDoneOutlined />, tone: 'indigo', ok: can('order.view') },
    { key: 'returns', to: '/sales-returns', label: 'Trả hàng', icon: <RollbackOutlined />, tone: 'red', ok: can('return.view') },
    { key: 'cash', to: '/cash', label: 'Sổ quỹ', icon: <WalletOutlined />, tone: 'teal', ok: can('cash.view') },
    { key: 'reports', to: '/reports/sales', label: 'Báo cáo', icon: <BarChartOutlined />, tone: 'purple', ok: can('sales.report.view') },
    { key: 'stocktakes', to: '/stocktakes', label: 'Kiểm kho', icon: <AuditOutlined />, tone: 'amber', ok: can('stocktake.view') },
    { key: 'transfers', to: '/transfers', label: 'Chuyển kho', icon: <SwapOutlined />, tone: 'cyan', ok: can('transfer.view') },
    { key: 'deliveries', to: '/deliveries', label: 'Giao hàng', icon: <CarOutlined />, tone: 'lime', ok: can('delivery.view') },
    { key: 'help', to: '/help', label: 'Hướng dẫn', icon: <QuestionCircleOutlined />, tone: 'gray', ok: true },
  ].filter((a) => a.ok).slice(0, 8), [can]);

  if (error) return <Alert type="error" message={errMsg(error)} showIcon />;
  if (isLoading || !data) return <div className="dh"><div className="dh-hero"><Skeleton active paragraph={{ rows: 3 }} /></div><Skeleton active paragraph={{ rows: 8 }} /></div>;

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

  return (
    <div className="dh">
      {/* ---------- hero ---------- */}
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
          <div className="dh-hero-card dh-hero-plain">Chúc một ngày bán hàng thuận lợi! Dùng các lối tắt bên dưới để bắt đầu.</div>
        )}
      </div>

      {/* ---------- lối tắt ---------- */}
      {actions.length > 0 && (
        <div className="dh-actions">
          {actions.map((a) => <Link key={a.key} to={a.to} className={`dh-action tone-${a.tone}`}><span className="ic">{a.icon}</span><span>{a.label}</span></Link>)}
        </div>
      )}

      <div className="dh-grid">
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
          {sales && (
            <Section className="dh-a-chart" title={period === 'today' ? 'Doanh thu theo giờ' : 'Doanh thu theo ngày'} extra={<Link to="/reports/sales" className="dh-more">Báo cáo <RightOutlined /></Link>}>
              <RevenueBars key={period} bars={bars} />
            </Section>
          )}

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
