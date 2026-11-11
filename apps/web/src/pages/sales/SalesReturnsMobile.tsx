import { Button, DatePicker, Dropdown, Input, Radio, Spin } from 'antd';
import { CaretDownOutlined, CloseOutlined, FilterOutlined, LeftOutlined, PlusOutlined, SearchOutlined, SwapOutlined } from '@ant-design/icons';
import dayjs, { Dayjs } from 'dayjs';
import { useEffect, useMemo, useRef, useState } from 'react';
import { useNavigate, useSearchParams } from 'react-router-dom';
import { SalesReturnQuery, useSalesReturns } from '../../api/sales';
import { errMsg } from '../../api/client';
import type { ReturnSummary, SalesReturn } from '../../api/types';
import { CustomerSelect } from '../../components/CustomerSelect';
import { FilterCard, FilterPanel } from '../../components/FilterPanel';
import { useAuthStore, useCan } from '../../store/auth';
import { money, PAYMENT_METHOD_LABEL, qty } from '../../utils/format';
import { dayLabel, PERIOD_KEYS, PERIOD_LABEL, PeriodKey, periodRange } from './InvoicesMobile';
import './sales-mobile.css';

const PAGE = 30;
const SORTS: { key: string; label: string; sortBy?: string; sortDir?: 'asc' | 'desc' }[] = [
  { key: 'new', label: 'Mới nhất' },
  { key: 'old', label: 'Cũ nhất', sortBy: 'returnDate', sortDir: 'asc' },
  { key: 'amount_desc', label: 'Giá trị cao → thấp', sortBy: 'totalRefund', sortDir: 'desc' },
  { key: 'amount_asc', label: 'Giá trị thấp → cao', sortBy: 'totalRefund', sortDir: 'asc' },
];
type Metric = 'subtotal' | 'refund' | 'refunded' | 'due';
const METRIC_LABEL: Record<Metric, string> = { subtotal: 'Tổng tiền hàng', refund: 'Cần trả khách', refunded: 'Đã trả khách', due: 'Còn phải trả' };

/** Nhãn bên phải dòng: trạng thái / còn phải hoàn / phương thức đã hoàn (trống khi hoàn bằng công nợ hoặc phiếu nhập từ KiotViet). */
function refundLabel(r: SalesReturn): { text: string; cls: string } {
  if (r.status === 'DRAFT') return { text: 'Phiếu tạm', cls: 'draft' };
  if (r.status === 'CANCELLED') return { text: 'Đã hủy', cls: 'cancel' };
  const due = Number(r.dueRefund ?? Number(r.totalRefund) - Number(r.refundedAmount));
  if (due > 0) return { text: `Còn hoàn ${money(due)}`, cls: 'due' };
  const ms = r.paymentMethods ?? [];
  if (!ms.length) return { text: '', cls: '' };
  const label = (m: string) => (m === 'OFFSET' ? 'Cấn trừ' : PAYMENT_METHOD_LABEL[m] ?? m);
  return { text: ms.length > 1 ? 'Kết hợp' : label(ms[0]), cls: '' };
}

/** Trả hàng trên điện thoại – bố cục như app KiotViet: quay lại + tiêu đề + tìm / sắp xếp, chip lọc (bộ lọc, thời gian, chi nhánh), tổng theo kết quả lọc, danh sách nhóm theo ngày, nút + tạo phiếu trả. */
export function SalesReturnsMobile() {
  const nav = useNavigate();
  const can = useCan();
  const me = useAuthStore((s) => s.me);
  const [sp, setSp] = useSearchParams();
  const linked = !!(sp.get('search') || sp.get('status') || sp.get('customerId'));
  const [q, setQ] = useState<SalesReturnQuery>({ page: 1, pageSize: PAGE, search: sp.get('search') ?? undefined, status: sp.get('status') ?? undefined, customerId: sp.get('customerId') ?? undefined });
  const [period, setPeriod] = useState<PeriodKey>(linked ? 'all' : 'month');
  const [custom, setCustom] = useState<[Dayjs, Dayjs] | null>(null);
  const [branch, setBranch] = useState<string | undefined>(undefined);
  const [metric, setMetric] = useState<Metric>('subtotal');
  const [searchOpen, setSearchOpen] = useState(!!q.search);
  const [searchText, setSearchText] = useState(q.search ?? '');
  const [filterOpen, setFilterOpen] = useState(false);
  const [items, setItems] = useState<SalesReturn[]>([]);
  const [summary, setSummary] = useState<ReturnSummary>();
  const sentinel = useRef<HTMLDivElement>(null);
  const range = useMemo(() => periodRange(period, custom), [period, custom]);
  const { data, isFetching, isPlaceholderData, error } = useSalesReturns({ ...q, ...range, branchId: branch });
  const total = data?.meta.total ?? 0;
  const set = (patch: Partial<SalesReturnQuery>) => setQ((s) => ({ ...s, ...patch, page: patch.page ?? 1 }));
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
  const activeFilters = [q.status, q.customerId].filter(Boolean).length;
  const sortKey = SORTS.find((x) => x.sortBy === q.sortBy && (x.sortDir ?? undefined) === (q.sortDir ?? undefined))?.key ?? 'new';
  const doSearch = (v: string) => { set({ search: v || undefined }); setSp(v ? { search: v } : {}); if (v) setPeriod('all'); };
  const pickPeriod = (k: PeriodKey) => { if (k === 'custom') { setFilterOpen(true); return; } setPeriod(k); setCustom(null); resetPage(); };

  const groups = useMemo(() => {
    const out: { key: string; label: string; rows: SalesReturn[] }[] = [];
    for (const r of items) {
      const d = dayjs(r.returnDate);
      const key = d.format('YYYY-MM-DD');
      const g = out[out.length - 1];
      if (g && g.key === key) g.rows.push(r); else out.push({ key, label: dayLabel(d), rows: [r] });
    }
    return out;
  }, [items]);

  return (
    <div className="im">
      <div className="im-head">
        <button type="button" className="im-back" aria-label="Quay lại" onClick={() => nav('/more')}><LeftOutlined /></button>
        <h1>Trả hàng</h1>
        <div className="im-icons">
          <button type="button" className={searchOpen ? 'on' : ''} aria-label="Tìm phiếu trả" onClick={() => { if (searchOpen && searchText) { setSearchText(''); doSearch(''); } setSearchOpen(!searchOpen); }}>{searchOpen ? <CloseOutlined /> : <SearchOutlined />}</button>
          <Dropdown trigger={['click']} menu={{ items: SORTS.map((x) => ({ key: x.key, label: x.label })), selectedKeys: [sortKey], onClick: ({ key }) => { const x = SORTS.find((y) => y.key === key)!; set({ sortBy: x.sortBy, sortDir: x.sortDir }); } }}>
            <button type="button" aria-label="Sắp xếp"><SwapOutlined rotate={90} /></button>
          </Dropdown>
        </div>
      </div>
      {searchOpen && (
        <div className="im-search">
          <Input.Search autoFocus allowClear placeholder="Mã phiếu trả, mã hóa đơn, khách hàng, SĐT" value={searchText} onChange={(e) => setSearchText(e.target.value)} onSearch={doSearch} enterButton={<SearchOutlined />} />
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
          <div className="n">{total.toLocaleString('vi-VN')} phiếu{q.search ? ` · "${q.search}"` : ''}</div>
        </div>
        <div className={`v ${metric === 'due' && summary && Number(summary.due) > 0 ? 'neg' : ''}`}>{summary ? money(summary[metric]) : '—'}</div>
      </div>

      <div className="im-list">
        {groups.map((g) => (
          <div key={g.key} className="im-group">
            <div className="im-day">{g.label}</div>
            {g.rows.map((r) => {
              const pay = refundLabel(r);
              const lines = r._count?.lines ?? (r.firstLine ? 1 : 0);
              return (
                <div key={r.id} className={`im-row ${r.status === 'CANCELLED' ? 'off' : ''}`} role="button" onClick={() => nav(`/sales-returns/${r.id}`)}>
                  <div className="r1"><span className="nm">{r.customer?.name ?? 'Khách lẻ'}</span><span className="amt">{money(r.totalRefund)}</span></div>
                  <div className="r2"><span className="meta">{dayjs(r.returnDate).format('DD/MM/YYYY HH:mm')} <i>•</i> {r.code}</span>{pay.text && <span className={`pay ${pay.cls}`}>{pay.text}</span>}</div>
                  {r.firstLine && <div className="r3">{r.firstLine.name} <b>x{qty(r.firstLine.quantity)}</b></div>}
                  {lines > 1 && <div className="r4">+{lines - 1} mặt hàng khác</div>}
                </div>
              );
            })}
          </div>
        ))}
        {!isFetching && items.length === 0 && <div className="im-empty">{error ? errMsg(error) : q.search ? `Không có phiếu trả khớp "${q.search}"` : 'Chưa có phiếu trả hàng trong khoảng thời gian này'}</div>}
        {isFetching && <div className="im-loading"><Spin size="small" /> Đang tải…</div>}
        {!isFetching && items.length > 0 && items.length >= total && <div className="im-end">Đã hiện hết {total.toLocaleString('vi-VN')} phiếu</div>}
        <div ref={sentinel} />
      </div>

      {can('return.create') && <button type="button" className="im-fab" aria-label="Trả hàng" onClick={() => nav('/sales-returns/new')}><PlusOutlined /></button>}

      <FilterPanel open={filterOpen} onOpenChange={setFilterOpen} hideToggle>
        <FilterCard title="Trạng thái"><Radio.Group value={q.status ?? ''} onChange={(e) => set({ status: e.target.value || undefined })}><Radio value="">Tất cả</Radio><Radio value="COMPLETED">Hoàn thành</Radio><Radio value="DRAFT">Phiếu tạm</Radio><Radio value="CANCELLED">Đã hủy</Radio></Radio.Group></FilterCard>
        <FilterCard title="Khách hàng"><CustomerSelect size="small" value={q.customerId} onChange={(v) => set({ customerId: v })} allowCreate={false} placeholder="Tất cả" /></FilterCard>
        <FilterCard title="Thời gian tùy chọn">
          <DatePicker.RangePicker size="small" style={{ width: '100%' }} format="DD/MM/YYYY" value={custom} onChange={(r) => { if (r?.[0] && r[1]) { setCustom([r[0], r[1]]); setPeriod('custom'); } else { setCustom(null); setPeriod('month'); } resetPage(); }} />
          <div className="kv-hint" style={{ marginTop: 6 }}>Hoặc chọn nhanh bằng chip “{PERIOD_LABEL[period === 'custom' ? 'month' : period]}” ở đầu trang.</div>
        </FilterCard>
        <Button block onClick={() => { set({ status: undefined, customerId: undefined }); setCustom(null); setPeriod('month'); setFilterOpen(false); }}>Bỏ lọc</Button>
      </FilterPanel>
    </div>
  );
}
