import { DatePicker, Input, Select } from 'antd';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import dayjs, { Dayjs } from 'dayjs';
import { useCallback } from 'react';
import { useSearchParams } from 'react-router-dom';
import { CommissionRule, EMPLOYEE_KEYS, useEmployees } from '../../api/employees';
import { orgApi } from '../../api/org';
import { useIsMobile } from '../../hooks/useMedia';
import { useCan } from '../../store/auth';
import { money, toNum } from '../../utils/format';
import type { Range } from '../reports/ReportShared';

/** Date + time field: the phone keyboard / native picker on phones (antd's showTime panel is wider than a 375px screen), antd DatePicker on desktop. Works inside Form.Item. */
export function DateTimeInput({ value, onChange, placeholder, disabled }: { value?: Dayjs | null; onChange?: (v: Dayjs | null) => void; placeholder?: string; disabled?: boolean }) {
  const isMobile = useIsMobile();
  if (isMobile) return <Input type="datetime-local" disabled={disabled} value={value ? value.format('YYYY-MM-DDTHH:mm') : ''} onChange={(e) => onChange?.(e.target.value ? dayjs(e.target.value) : null)} style={{ width: '100%' }} />;
  return <DatePicker showTime={{ format: 'HH:mm' }} format="DD/MM/YYYY HH:mm" style={{ width: '100%' }} placeholder={placeholder} disabled={disabled} value={value ?? null} onChange={(v) => onChange?.(v)} />;
}

/** Employee picker: /employees for managers (attendance.view), /users as a fallback for user.manage; otherwise nothing to pick. */
export function EmployeeSelect({ value, onChange, size, placeholder = 'Tất cả nhân viên', allowClear = true, style, disabled }: { value?: string; onChange: (v?: string) => void; size?: 'small' | 'middle' | 'large'; placeholder?: string; allowClear?: boolean; style?: React.CSSProperties; disabled?: boolean }) {
  const can = useCan();
  const canEmp = can('attendance.view');
  const emp = useEmployees({ pageSize: 200 }, canEmp);
  const users = useQuery({ queryKey: ['users', { pageSize: 200, forSelect: true }], queryFn: () => orgApi.users({ pageSize: 200 }), enabled: !canEmp && can('user.manage'), staleTime: 60_000 });
  const options = canEmp
    ? (emp.data?.data ?? []).map((e) => ({ value: e.id, label: `${e.fullName}${e.position ? ` · ${e.position}` : ''}${e.status !== 'ACTIVE' ? ' (ngừng)' : ''}` }))
    : (users.data?.data ?? []).map((u) => ({ value: u.id, label: u.fullName }));
  return <Select showSearch optionFilterProp="label" allowClear={allowClear} size={size} disabled={disabled} style={{ width: '100%', ...style }} placeholder={placeholder} value={value} onChange={(v) => onChange(v)} options={options} loading={emp.isLoading || users.isLoading} />;
}

export const useInvalidateEmployees = () => {
  const qc = useQueryClient();
  return useCallback(() => EMPLOYEE_KEYS.forEach((k) => qc.invalidateQueries({ queryKey: [k] })), [qc]);
};

/** `?tab=` kept in the URL (so links from other screens can open a specific tab) together with the other params. */
export function useUrlTab<T extends string>(allowed: readonly T[], fallback: T): [T, (t: T) => void] {
  const [sp, setSp] = useSearchParams();
  const cur = sp.get('tab') as T | null;
  const tab = cur && allowed.includes(cur) ? cur : fallback;
  const set = (t: T) => setSp((prev) => { const n = new URLSearchParams(prev); n.set('tab', t); return n; }, { replace: true });
  return [tab, set];
}
/** `?userId=` from the URL (links from the employee list / performance). */
export function useUrlUserId(): [string | undefined, (id?: string) => void] {
  const [sp, setSp] = useSearchParams();
  const v = sp.get('userId') ?? undefined;
  const set = (id?: string) => setSp((prev) => { const n = new URLSearchParams(prev); if (id) n.set('userId', id); else n.delete('userId'); return n; }, { replace: true });
  return [v, set];
}

export const periodParams = (r: Range) => ({ from: r[0].toISOString(), to: r[1].toISOString() });

/** Rule rate as text: 2 % / 10.000 đ/đv. */
export const rateText = (r: Pick<CommissionRule, 'basis' | 'rate'>) => (r.basis === 'QUANTITY' ? `${money(r.rate)} đ/đv` : `${toNum(r.rate).toLocaleString('vi-VN', { maximumFractionDigits: 2 })} %`);

/** Scope chips of a commission rule (employee / category / product / everyone). */
export function ScopeChips({ rule, categoryName, variantName }: { rule: CommissionRule; categoryName?: string; variantName?: string }) {
  const chips: { cls: string; text: string }[] = [];
  if (rule.userId) chips.push({ cls: 'user', text: rule.user?.fullName ?? 'Nhân viên' });
  if (rule.categoryId) chips.push({ cls: 'cat', text: `Nhóm: ${categoryName ?? '…'}` });
  if (rule.variantId) chips.push({ cls: 'var', text: `Hàng: ${variantName ?? `#${rule.variantId.slice(0, 8)}`}` });
  if (!chips.length) chips.push({ cls: 'all', text: 'Mọi nhân viên · mọi hàng hóa' });
  else if (!rule.userId) chips.unshift({ cls: 'all', text: 'Mọi nhân viên' });
  return <>{chips.map((c, i) => <span key={i} className={`em-chip ${c.cls}`}>{c.text}</span>)}</>;
}

/** Cash difference at shift close: 0 = khớp, < 0 thiếu, > 0 thừa. */
export function CashDiff({ value, shifts }: { value: unknown; shifts: number }) {
  const n = toNum(value);
  if (!shifts) return <span className="em-diff none">Không có ca</span>;
  if (Math.round(n) === 0) return <span className="em-diff zero">Khớp quỹ</span>;
  return <span className={`em-diff ${n < 0 ? 'neg' : 'pos'}`}>{n < 0 ? `Thiếu ${money(-n)}` : `Thừa ${money(n)}`}</span>;
}

export const initials = (name: string) => name.trim().split(/\s+/).slice(-2).map((w) => w[0]?.toUpperCase() ?? '').join('');
