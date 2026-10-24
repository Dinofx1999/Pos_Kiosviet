import { App, Button, DatePicker, Pagination, Select, Tag } from 'antd';
import { DownloadOutlined } from '@ant-design/icons';
import dayjs, { Dayjs } from 'dayjs';
import { ReactNode, useMemo, useState } from 'react';
import { errMsg } from '../../api/client';
import { ReportExportQuery, reportsApi } from '../../api/reports';
import { useMe } from '../../store/auth';
import { downloadBlob, money, toNum } from '../../utils/format';
import { useCategoryOptions } from '../products/CategoryFilter';
import './reports.css';

export type Range = [Dayjs, Dayjs];

// ---------------------------------------------------------------- date range presets
const quarterStart = () => { const now = dayjs(); return now.month(Math.floor(now.month() / 3) * 3).startOf('month'); };
export const RANGE_PRESETS: { key: string; label: string; range: () => Range }[] = [
  { key: 'today', label: 'Hôm nay', range: () => [dayjs().startOf('day'), dayjs().endOf('day')] },
  { key: 'week', label: 'Tuần này', range: () => [dayjs().startOf('week'), dayjs().endOf('day')] },
  { key: 'month', label: 'Tháng này', range: () => [dayjs().startOf('month'), dayjs().endOf('day')] },
  { key: 'lastMonth', label: 'Tháng trước', range: () => [dayjs().subtract(1, 'month').startOf('month'), dayjs().subtract(1, 'month').endOf('month')] },
  { key: 'quarter', label: 'Quý này', range: () => [quarterStart(), dayjs().endOf('day')] },
  { key: 'year', label: 'Năm nay', range: () => [dayjs().startOf('year'), dayjs().endOf('day')] },
];
export const presetRange = (key: string): Range => (RANGE_PRESETS.find((p) => p.key === key) ?? RANGE_PRESETS[2]).range();
const sameRange = (a: Range, b: Range) => a[0].isSame(b[0], 'day') && a[1].isSame(b[1], 'day');

/** Preset chips (scrollable on phones) + a range picker for custom dates. */
export function DateRangeBar({ value, onChange, presets = RANGE_PRESETS }: { value: Range; onChange: (r: Range) => void; presets?: typeof RANGE_PRESETS }) {
  const active = presets.find((p) => sameRange(p.range(), value))?.key;
  return (
    <>
      <div className="rp-presets" role="tablist">
        {presets.map((p) => <Tag.CheckableTag key={p.key} checked={active === p.key} onChange={() => onChange(p.range())}>{p.label}</Tag.CheckableTag>)}
      </div>
      <DatePicker.RangePicker className="rp-grow" value={value} format="DD/MM/YYYY" allowClear={false} inputReadOnly
        onChange={(r) => { if (r?.[0] && r?.[1]) onChange([r[0].startOf('day'), r[1].endOf('day')]); }} />
    </>
  );
}

// ---------------------------------------------------------------- excel export
export function ExportButton({ query, disabled, children = 'Xuất Excel' }: { query: ReportExportQuery; disabled?: boolean; children?: ReactNode }) {
  const { message } = App.useApp();
  const [busy, setBusy] = useState(false);
  const run = async () => {
    setBusy(true);
    try { const { blob, filename } = await reportsApi.download(query); downloadBlob(blob, filename); message.success(`Đã tải ${filename}`); }
    catch (e) { message.error(errMsg(e)); }
    finally { setBusy(false); }
  };
  return <Button icon={<DownloadOutlined />} onClick={run} loading={busy} disabled={disabled}>{children}</Button>;
}

// ---------------------------------------------------------------- stat tile
export function Stat({ label, value, sub, tone }: { label: ReactNode; value: ReactNode; sub?: ReactNode; tone?: 'pos' | 'neg' | 'blue' | 'warn' }) {
  return (
    <div className="rp-stat">
      <div className="lbl">{label}</div>
      <div className={`val${tone ? ` ${tone}` : ''}`}>{value}</div>
      {sub !== undefined && sub !== null && sub !== '' && <div className="sub">{sub}</div>}
    </div>
  );
}

// ---------------------------------------------------------------- filter selects (branch / warehouse / category)
export function BranchSelect({ value, onChange, size }: { value?: string; onChange: (v?: string) => void; size?: 'small' | 'middle' }) {
  const me = useMe();
  return <Select allowClear size={size} style={{ width: '100%' }} placeholder="Tất cả chi nhánh" value={value} onChange={(v) => onChange(v)} options={(me?.branches ?? []).map((b) => ({ value: b.id, label: b.name }))} />;
}
export function WarehouseSelect({ value, onChange, branchId, size }: { value?: string; onChange: (v?: string) => void; branchId?: string; size?: 'small' | 'middle' }) {
  const me = useMe();
  const list = useMemo(() => (me?.warehouses ?? []).filter((w) => !branchId || w.branchId === branchId), [me, branchId]);
  return <Select allowClear showSearch optionFilterProp="label" size={size} style={{ width: '100%' }} placeholder="Tất cả kho" value={value} onChange={(v) => onChange(v)} options={list.map((w) => ({ value: w.id, label: w.name }))} />;
}
export function CategorySelect({ value, onChange, size }: { value?: string; onChange: (v?: string) => void; size?: 'small' | 'middle' }) {
  const categories = useCategoryOptions();
  return <Select allowClear showSearch optionFilterProp="label" size={size} style={{ width: '100%' }} placeholder="Tất cả nhóm hàng" value={value} onChange={(v) => onChange(v)} options={categories} />;
}

// ---------------------------------------------------------------- numbers
export const pctOf = (part: unknown, whole: unknown): number | null => { const w = toNum(whole); return w ? (toNum(part) / w) * 100 : null; };
export const fmtPct = (p: number | null, digits = 1) => (p === null || !Number.isFinite(p) ? '—' : `${p.toLocaleString('vi-VN', { maximumFractionDigits: digits })}%`);
/** Compact VND for chart labels: 1.234.567 → 1,23tr; 12.345 → 12,3k */
export function compactMoney(v: unknown): string {
  const n = toNum(v); const a = Math.abs(n); const s = n < 0 ? '−' : '';
  if (a >= 1e9) return `${s}${(a / 1e9).toLocaleString('vi-VN', { maximumFractionDigits: 2 })} tỷ`;
  if (a >= 1e6) return `${s}${(a / 1e6).toLocaleString('vi-VN', { maximumFractionDigits: a >= 1e8 ? 0 : 1 })}tr`;
  if (a >= 1e3) return `${s}${(a / 1e3).toLocaleString('vi-VN', { maximumFractionDigits: 0 })}k`;
  return `${s}${vnd(a)}`;
}
export const periodLabel = (period: string, groupBy: 'day' | 'month') => dayjs(period).format(groupBy === 'month' ? 'MM/YYYY' : 'DD/MM');
/** Whole-VND formatting for report figures (cost totals carry fractional đồng that only add noise). */
export const vnd = (v: unknown) => money(Math.round(toNum(v)));
export const signed = (v: unknown) => { const n = Math.round(toNum(v)); return n < 0 ? `−${vnd(-n)}` : vnd(n); };

// ---------------------------------------------------------------- charts (plain HTML/SVG, no library, shrink to the container)
/** Validated categorical palette (brand blue first) + neutral gray for "Khác". */
export const SERIES_COLORS = ['#0070f4', '#eb6834', '#1baf7a', '#eda100', '#e87ba4', '#008300', '#6250d6', '#e34948'];
export const OTHER_COLOR = '#9ca3af';

export interface HBarRow { key: string; name: string; sub?: string; value: number; display: string }
export function HBarChart({ rows, tone = 'blue', onPick }: { rows: HBarRow[]; tone?: 'blue' | 'asc'; onPick?: (key: string) => void }) {
  const max = Math.max(1, ...rows.map((r) => Math.abs(r.value)));
  return (
    <div className="rp-hbars">
      {rows.map((r, i) => (
        <div className="rp-hbar" key={r.key} onClick={onPick ? () => onPick(r.key) : undefined} title={`${r.name}${r.sub ? ` · ${r.sub}` : ''}: ${r.display}`}>
          <span className="rk">{i + 1}</span>
          <div className="lbl"><span className="nm">{r.name}</span><span className="v">{r.display}</span></div>
          <div className="track"><div className={`fill${r.value < 0 ? ' neg' : tone === 'asc' ? ' asc' : ''}`} style={{ width: `${Math.max(1, (Math.abs(r.value) / max) * 100)}%` }} /></div>
        </div>
      ))}
    </div>
  );
}

export interface PeriodBar { key: string; label: string; value: number }
/** Vertical bars that always fit the container: positive above / negative below a zero line, x labels thinned to what fits. */
export function PeriodBars({ rows, selected, onSelect, maxLabels = 8 }: { rows: PeriodBar[]; selected?: string; onSelect?: (key?: string) => void; maxLabels?: number }) {
  const maxPos = Math.max(0, ...rows.map((r) => r.value));
  const maxNeg = Math.max(0, ...rows.map((r) => -r.value));
  const span = Math.max(1, maxPos + maxNeg);
  const zeroPct = maxNeg === 0 ? 100 : maxPos === 0 ? 0 : (maxPos / span) * 100;
  const every = Math.max(1, Math.ceil(rows.length / maxLabels));
  return (
    <div className="rp-pbars">
      {rows.map((r, i) => {
        const h = (Math.abs(r.value) / span) * 100;
        const neg = r.value < 0;
        return (
          <div key={r.key} className={`rp-pbar${selected === r.key ? ' on' : ''}`} onClick={() => onSelect?.(selected === r.key ? undefined : r.key)} title={`${r.label}: ${signed(r.value)}`}>
            <div className="col">
              <div className="zero" style={{ top: `${zeroPct}%` }} />
              <div className={`b${neg ? ' neg' : ''}`} style={neg ? { top: `${zeroPct}%`, height: `${h}%` } : { bottom: `${100 - zeroPct}%`, height: `${h}%` }} />
            </div>
            <div className={`x${i % every === 0 || rows.length <= maxLabels ? '' : ' hide'}`}>{r.label}</div>
          </div>
        );
      })}
    </div>
  );
}

export interface DonutSlice { key: string; name: string; value: number; color: string }
/** SVG donut with legend; `slices` are already bucketed (top-N + Khác). */
export function Donut({ slices, centerLabel, centerValue, format = compactMoney }: { slices: DonutSlice[]; centerLabel: string; centerValue: string; format?: (v: number) => string }) {
  const [on, setOn] = useState<string | undefined>();
  const total = slices.reduce((s, x) => s + Math.max(0, x.value), 0) || 1;
  const R = 44; const C = 2 * Math.PI * R;
  let offset = 0;
  const arcs = slices.map((s) => { const frac = Math.max(0, s.value) / total; const a = { ...s, frac, dash: frac * C, off: offset }; offset += frac * C; return a; });
  const act = arcs.find((a) => a.key === on);
  return (
    <div className="rp-donut">
      <svg viewBox="0 0 120 120" role="img" aria-label={centerLabel}>
        <circle cx={60} cy={60} r={R} fill="none" stroke="#f1f5f9" strokeWidth={16} />
        {arcs.map((a) => a.frac > 0 && (
          <circle key={a.key} cx={60} cy={60} r={R} fill="none" stroke={a.color} strokeWidth={on && on !== a.key ? 12 : 16} strokeDasharray={`${Math.max(0, a.dash - 0.8)} ${C - Math.max(0, a.dash - 0.8)}`} strokeDashoffset={-a.off} transform="rotate(-90 60 60)" style={{ transition: 'stroke-width .15s', cursor: 'pointer' }}
            onMouseEnter={() => setOn(a.key)} onMouseLeave={() => setOn(undefined)} onClick={() => setOn(on === a.key ? undefined : a.key)}>
            <title>{`${a.name}: ${format(a.value)} (${fmtPct(a.frac * 100)})`}</title>
          </circle>
        ))}
        <text x={60} y={56} textAnchor="middle" className="center">{act ? act.name.slice(0, 16) : centerLabel}</text>
        <text x={60} y={72} textAnchor="middle" className="center big">{act ? fmtPct(act.frac * 100) : centerValue}</text>
      </svg>
      <div className="rp-donut-legend">
        {arcs.map((a) => (
          <div key={a.key} className={`it${on === a.key ? ' on' : ''}`} onMouseEnter={() => setOn(a.key)} onMouseLeave={() => setOn(undefined)} onClick={() => setOn(on === a.key ? undefined : a.key)}>
            <span className="sw" style={{ background: a.color }} /><span className="nm">{a.name}</span><span className="pc">{fmtPct(a.frac * 100)}</span><span className="v">{format(a.value)}</span>
          </div>
        ))}
      </div>
    </div>
  );
}

export function ShareBar({ pct }: { pct: number | null }) {
  return <span className="rp-share"><span className="track"><span className="fill" style={{ width: `${Math.min(100, Math.max(0, pct ?? 0))}%` }} /></span>{fmtPct(pct)}</span>;
}

export function CardPager({ page, pageSize, total, onChange }: { page: number; pageSize: number; total: number; onChange: (page: number, pageSize: number) => void }) {
  if (!total) return null;
  return <div className="rp-pager"><Pagination simple current={page} pageSize={pageSize} total={total} onChange={onChange} showSizeChanger={false} /></div>;
}

export function RankBadge({ rank }: { rank: number }) {
  return <span className={`rp-rank${rank === 1 ? ' gold' : rank === 2 ? ' silver' : rank === 3 ? ' bronze' : ''}`}>{rank}</span>;
}
