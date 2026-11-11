import { Button, DatePicker, Dropdown, Input, Radio, Spin } from 'antd';
import { CaretDownOutlined, CloseOutlined, FilterOutlined, PlusOutlined, SearchOutlined, SwapOutlined } from '@ant-design/icons';
import dayjs, { Dayjs } from 'dayjs';
import { useEffect, useMemo, useRef, useState } from 'react';
import { useNavigate, useSearchParams } from 'react-router-dom';
import { InvoiceQuery, useInvoices } from '../../api/sales';
import { errMsg } from '../../api/client';
import type { Invoice, InvoiceSummary } from '../../api/types';
import { CustomerSelect } from '../../components/CustomerSelect';
import { FilterCard, FilterPanel } from '../../components/FilterPanel';
import { useAuthStore, useCan } from '../../store/auth';
import { money, qty } from '../../utils/format';
import { paymentLabel } from './InvoiceShared';
import './sales-mobile.css';

const PAGE = 30;
export type PeriodKey = 'today' | 'yesterday' | 'week' | 'month' | 'lastMonth' | 'all' | 'custom';
export const PERIOD_LABEL: Record<PeriodKey, string> = { today: 'Hôm nay', yesterday: 'Hôm qua', week: 'Tuần này', month: 'Tháng này', lastMonth: 'Tháng trước', all: 'Toàn thời gian', custom: 'Tùy chọn…' };
export const PERIOD_KEYS: PeriodKey[] = ['today', 'yesterday', 'week', 'month', 'lastMonth', 'all', 'custom'];
/** Khoảng thời gian của chip lọc (tuần bắt đầu thứ Hai). */
export function periodRange(k: PeriodKey, custom: [Dayjs, Dayjs] | null): { from?: string; to?: string } {
  const now = dayjs();
  const day = (d: Dayjs) => ({ from: d.startOf('day').toISOString(), to: d.endOf('day').toISOString() });
  switch (k) {
    case 'today': return day(now);
    case 'yesterday': return day(now.subtract(1, 'day'));
    case 'week': { const start = now.subtract((now.day() + 6) % 7, 'day').startOf('day'); return { from: start.toISOString(), to: start.add(6, 'day').endOf('day').toISOString() }; }
    case 'month': return { from: now.startOf('month').toISOString(), to: now.endOf('month').toISOString() };
    case 'lastMonth': { const m = now.subtract(1, 'month'); return { from: m.startOf('month').toISOString(), to: m.endOf('month').toISOString() }; }
    case 'custom': return custom ? { from: custom[0].startOf('day').toISOString(), to: custom[1].endOf('day').toISOString() } : {};
    default: return {};
  }
}
const SORTS: { key: string; label: string; sortBy?: string; sortDir?: 'asc' | 'desc' }[] = [
  { key: 'new', label: 'Mới nhất' },
  { key: 'old', label: 'Cũ nhất', sortBy: 'invoiceDate', sortDir: 'asc' },
  { key: 'amount_desc', label: 'Giá trị cao → thấp', sortBy: 'totalAmount', sortDir: 'desc' },
  { key: 'amount_asc', label: 'Giá trị thấp → cao', sortBy: 'totalAmount', sortDir: 'asc' },
];
type Metric = 'subtotal' | 'total' | 'paid' | 'due';
const METRIC_LABEL: Record<Metric, string> = { subtotal: 'Tổng tiền hàng', total: 'Khách cần trả', paid: 'Khách đã trả', due: 'Còn nợ' };
const WEEKDAY = ['CHỦ NHẬT', 'THỨ HAI', 'THỨ BA', 'THỨ TƯ', 'THỨ NĂM', 'THỨ SÁU', 'THỨ BẢY'];
/** "HÔM NAY 10/11/2026" · "HÔM QUA 09/11/2026" · "THỨ HAI 03/11/2026" */
export function dayLabel(d: Dayjs) {
  const diff = dayjs().startOf('day').diff(d.startOf('day'), 'day');
  return `${diff === 0 ? 'HÔM NAY' : diff === 1 ? 'HÔM QUA' : WEEKDAY[d.day()]} ${d.format('DD/MM/YYYY')}`;
}

/** Hóa đơn trên điện thoại – bố cục như app KiotViet: tiêu đề + tìm / sắp xếp, chip lọc (bộ lọc, thời gian, chi nhánh), tổng theo kết quả lọc, danh sách nhóm theo ngày, nút + mở Bán hàng. */
export function InvoicesMobile() {
  const nav = useNavigate();
  const can = useCan();
  const me = useAuthStore((s) => s.me);
  const [sp, setSp] = useSearchParams();
  const linked = !!(sp.get('search') || sp.get('unpaid') || sp.get('status') || sp.get('customerId'));
  const [q, setQ] = useState<InvoiceQuery>({ page: 1, pageSize: PAGE, search: sp.get('search') ?? undefined, status: sp.get('status') ?? undefined, unpaid: sp.get('unpaid') ? 'true' : undefined, customerId: sp.get('customerId') ?? undefined });
  // liên kết từ màn khác (tìm mã, còn nợ…) → xem toàn thời gian để chắc chắn thấy hóa đơn
  const [period, setPeriod] = useState<PeriodKey>(linked ? 'all' : 'month');
  const [custom, setCustom] = useState<[Dayjs, Dayjs] | null>(null);
  const [branch, setBranch] = useState<string | undefined>(undefined);
  const [metric, setMetric] = useState<Metric>('subtotal');
  const [searchOpen, setSearchOpen] = useState(!!q.search);
  const [searchText, setSearchText] = useState(q.search ?? '');
  const [filterOpen, setFilterOpen] = useState(false);
  const [items, setItems] = useState<Invoice[]>([]);
  const [summary, setSummary] = useState<InvoiceSummary>();
  const sentinel = useRef<HTMLDivElement>(null);
  const range = useMemo(() => periodRange(period, custom), [period, custom]);
  const { data, isFetching, isPlaceholderData, error } = useInvoices({ ...q, ...range, branchId: branch });
  const total = data?.meta.total ?? 0;
  const set = (patch: Partial<InvoiceQuery>) => setQ((s) => ({ ...s, ...patch, page: patch.page ?? 1 }));
  const resetPage = () => setQ((s) => ({ ...s, page: 1 }));

  useEffect(() => {
    if (!data || isPlaceholderData) return;
    setItems((cur) => (q.page === 1 ? data.data : [...cur, ...data.data.filter((x) => !cur.some((c) => c.id === x.id))]));
    if (data.summary) setSummary(data.summary);
  }, [data, isPlaceholderData, q.page]);
  useEffect(() => {
    const el = sentinel.current;
    if (!el) return;
    const io = new IntersectionObserver((es) => { if (es[0].isIntersecting && !isFetching && items.length < total) set({ page: (q.page ?? 1) + 1 }); }, { rootMargin: '300px' });
    io.observe(el);
    return () => io.disconnect();
  }, [isFetching, items.length, total, q.page]);
  useEffect(() => { const s = sp.get('search'); if (s && s !== q.search) { setSearchText(s); setSearchOpen(true); setPeriod('all'); set({ search: s }); } }, [sp]);

  const branches = me?.branches ?? [];
  const branchName = branch ? branches.find((b) => b.id === branch)?.name ?? 'Chi nhánh' : 'Tất cả chi nhánh';
  const activeFilters = [q.status, q.unpaid, q.customerId].filter(Boolean).length;
  const sortKey = SORTS.find((x) => x.sortBy === q.sortBy && (x.sortDir ?? undefined) === (q.sortDir ?? undefined))?.key ?? 'new';
  const doSearch = (v: string) => { set({ search: v || undefined }); setSp(v ? { search: v } : {}); if (v) setPeriod('all'); };
  const pickPeriod = (k: PeriodKey) => { if (k === 'custom') { setFilterOpen(true); return; } setPeriod(k); setCustom(null); resetPage(); };

  // nhóm theo ngày (HÔM NAY / HÔM QUA / THỨ …)
  const groups = useMemo(() => {
    const out: { key: string; label: string; rows: Invoice[] }[] = [];
    for (const r of items) {
      const d = dayjs(r.invoiceDate);
      const key = d.format('YYYY-MM-DD');
      const g = out[out.length - 1];
      if (g && g.key === key) g.rows.push(r); else out.push({ key, label: dayLabel(d), rows: [r] });
    }
    return out;
  }, [items]);

  return (
    <div className="im">
      <div className="im-head">
        <h1>Hóa đơn</h1>
        <div className="im-icons">
          <button type="button" className={searchOpen ? 'on' : ''} aria-label="Tìm hóa đơn" onClick={() => { if (searchOpen && searchText) { setSearchText(''); doSearch(''); } setSearchOpen(!searchOpen); }}>{searchOpen ? <CloseOutlined /> : <SearchOutlined />}</button>
          <Dropdown trigger={['click']} menu={{ items: SORTS.map((x) => ({ key: x.key, label: x.label })), selectedKeys: [sortKey], onClick: ({ key }) => { const x = SORTS.find((y) => y.key === key)!; set({ sortBy: x.sortBy, sortDir: x.sortDir }); } }}>
            <button type="button" aria-label="Sắp xếp"><SwapOutlined rotate={90} /></button>
          </Dropdown>
        </div>
      </div>
      {searchOpen && (
        <div className="im-search">
          <Input.Search autoFocus allowClear placeholder="Mã hóa đơn, khách hàng, SĐT, hàng hóa" value={searchText} onChange={(e) => setSearchText(e.target.value)} onSearch={doSearch} enterButton={<SearchOutlined />} />
        </div>
      )}
      <div className="im-chips">
        <button type="button" className={`im-chip icon ${activeFilters ? 'on' : ''}`} aria-label="Bộ lọc" onClick={() => setFilterOpen(true)}><FilterOutlined />{activeFilters > 0 && <i className="im-dot">{activeFilters}</i>}</button>
        <Dropdown trigger={['click']} menu={{ items: PERIOD_KEYS.map((k) => ({ key: k, label: PERIOD_LABEL[k] })), selectedKeys: [period], onClick: ({ key }) => pickPeriod(key as PeriodKey) }}>
          <button type="button" className={`im-chip ${period !== 'month' ? 'on' : ''}`}>{period === 'custom' && custom ? `${custom[0].format('DD/MM')} – ${custom[1].format('DD/MM')}` : PERIOD_LABEL[period]} <CaretDownOutlined /></button>
        </Dropdown>
        {branches.length > 1 && (
          <Dropdown trigger={['click']} menu={{ items: [{ key: '', label: 'Tất cả chi nhánh' }, ...branches.map((b) => ({ key: b.id, label: b.name }))], selectedKeys: [branch ?? ''], onClick: ({ key }) => { setBranch(key || undefined); resetPage(); } }}>
            <button type="button" className={`im-chip ${branch ? 'on' : ''}`}><span className="t">{branchName}</span> <CaretDownOutlined /></button>
          </Dropdown>
        )}
      </div>

      <div className="im-sum">
        <div>
          <Dropdown trigger={['click']} menu={{ items: (Object.keys(METRIC_LABEL) as Metric[]).map((k) => ({ key: k, label: METRIC_LABEL[k] })), selectedKeys: [metric], onClick: ({ key }) => setMetric(key as Metric) }}>
            <button type="button" className="im-metric">{METRIC_LABEL[metric]} <CaretDownOutlined /></button>
          </Dropdown>
          <div className="n">{total.toLocaleString('vi-VN')} hóa đơn{q.search ? ` · "${q.search}"` : ''}</div>
        </div>
        <div className={`v ${metric === 'due' && summary && Number(summary.due) > 0 ? 'neg' : ''}`}>{summary ? money(summary[metric]) : '—'}</div>
      </div>

      <div className="im-list">
        {groups.map((g) => (
          <div key={g.key} className="im-group">
            <div className="im-day">{g.label}</div>
            {g.rows.map((r) => {
              const pay = paymentLabel(r);
              const lines = r._count?.lines ?? (r.firstLine ? 1 : 0);
              return (
                <div key={r.id} className={`im-row ${r.status === 'CANCELLED' ? 'off' : ''}`} role="button" onClick={() => nav(`/invoices/${r.id}`)}>
                  <div className="r1"><span className="nm">{r.customer?.name ?? 'Khách lẻ'}</span><span className="amt">{money(r.totalAmount)}</span></div>
                  <div className="r2"><span className="meta">{dayjs(r.invoiceDate).format('DD/MM/YYYY HH:mm')} <i>•</i> {r.code}</span><span className={`pay ${pay.cls}`}>{pay.text}</span></div>
                  {r.firstLine && <div className="r3">{r.firstLine.name} <b>x{qty(r.firstLine.quantity)}</b></div>}
                  {lines > 1 && <div className="r4">+{lines - 1} mặt hàng khác</div>}
                </div>
              );
            })}
          </div>
        ))}
        {!isFetching && items.length === 0 && <div className="im-empty">{error ? errMsg(error) : q.search ? `Không có hóa đơn khớp "${q.search}"` : 'Chưa có hóa đơn trong khoảng thời gian này'}</div>}
        {isFetching && <div className="im-loading"><Spin size="small" /> Đang tải…</div>}
        {!isFetching && items.length > 0 && items.length >= total && <div className="im-end">Đã hiện hết {total.toLocaleString('vi-VN')} hóa đơn</div>}
        <div ref={sentinel} />
      </div>

      {can('invoice.create') && <button type="button" className="im-fab" aria-label="Bán hàng" onClick={() => nav('/pos')}><PlusOutlined /></button>}

      <FilterPanel open={filterOpen} onOpenChange={setFilterOpen} hideToggle>
        <FilterCard title="Trạng thái"><Radio.Group value={q.status ?? ''} onChange={(e) => set({ status: e.target.value || undefined })}><Radio value="">Tất cả</Radio><Radio value="COMPLETED">Hoàn thành</Radio><Radio value="DRAFT">Giữ đơn</Radio><Radio value="CANCELLED">Đã hủy</Radio></Radio.Group></FilterCard>
        <FilterCard title="Công nợ"><Radio.Group value={q.unpaid ?? ''} onChange={(e) => set({ unpaid: e.target.value || undefined })}><Radio value="">Tất cả</Radio><Radio value="true">Còn nợ</Radio></Radio.Group></FilterCard>
        <FilterCard title="Khách hàng"><CustomerSelect size="small" value={q.customerId} onChange={(v) => set({ customerId: v })} allowCreate={false} placeholder="Tất cả" /></FilterCard>
        <FilterCard title="Thời gian tùy chọn">
          <DatePicker.RangePicker size="small" style={{ width: '100%' }} format="DD/MM/YYYY" value={custom} onChange={(r) => { if (r?.[0] && r[1]) { setCustom([r[0], r[1]]); setPeriod('custom'); } else { setCustom(null); setPeriod('month'); } resetPage(); }} />
          <div className="kv-hint" style={{ marginTop: 6 }}>Hoặc chọn nhanh bằng chip “{PERIOD_LABEL[period === 'custom' ? 'month' : period]}” ở đầu trang.</div>
        </FilterCard>
        <Button block onClick={() => { set({ status: undefined, unpaid: undefined, customerId: undefined }); setCustom(null); setPeriod('month'); setFilterOpen(false); }}>Bỏ lọc</Button>
      </FilterPanel>
    </div>
  );
}
