import { App, Button, Divider, Select, Tag } from 'antd';
import { PlusOutlined } from '@ant-design/icons';
import { useMemo, useState } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import { CASH_ACCOUNT_TYPE_COLOR, CASH_ACCOUNT_TYPE_LABEL, CashAccount, CashAccountType, PaymentDirection, financeApi, useCashAccounts, useCashCategories } from '../../api/finance';
import { errMsg } from '../../api/client';
import { useCan } from '../../store/auth';
import { money } from '../../utils/format';

/** Funds a voucher of `branchId` may use: the branch's own funds + tenant-wide (branchId null) funds. */
export function accessibleFunds(all: CashAccount[] | undefined, branchId?: string | null, opts: { types?: CashAccountType[]; exclude?: string[]; includeInactive?: boolean } = {}) {
  return (all ?? []).filter((a) => (opts.includeInactive || a.isActive) && (!branchId || !a.branchId || a.branchId === branchId) && (!opts.types || opts.types.includes(a.type)) && !(opts.exclude ?? []).includes(a.id));
}
/** The branch's default cash drawer (CASH fund of the branch, default first). */
export function branchDrawer(all: CashAccount[] | undefined, branchId?: string | null) {
  const own = (all ?? []).filter((a) => a.isActive && a.type === 'CASH' && a.branchId === branchId);
  return own.find((a) => a.isDefault) ?? own[0] ?? (all ?? []).find((a) => a.isActive && a.type === 'CASH' && !a.branchId) ?? (all ?? []).find((a) => a.isActive);
}

export interface FundSelectProps { value?: string; onChange: (id: string | undefined, acc?: CashAccount) => void; branchId?: string | null; types?: CashAccountType[]; exclude?: string[]; includeInactive?: boolean; size?: 'small' | 'middle' | 'large'; allowClear?: boolean; placeholder?: string; disabled?: boolean; showBalance?: boolean; style?: React.CSSProperties; className?: string }

/** Select of cash funds (két / ngân hàng / ví) with type tag and current balance. */
export function FundSelect({ value, onChange, branchId, types, exclude, includeInactive, size = 'middle', allowClear = false, placeholder = 'Chọn quỹ tiền', disabled, showBalance = true, style, className }: FundSelectProps) {
  const { data, isLoading } = useCashAccounts(!!includeInactive);
  const list = useMemo(() => accessibleFunds(data, branchId, { types, exclude, includeInactive }), [data, branchId, types, exclude, includeInactive]);
  const options = list.map((a) => ({ value: a.id, label: a.name, data: a }));
  return (
    <Select className={className} style={{ width: '100%', ...style }} size={size} showSearch allowClear={allowClear} disabled={disabled} loading={isLoading} value={value && list.some((a) => a.id === value) ? value : undefined} placeholder={placeholder}
      optionFilterProp="label" optionLabelProp="label" options={options} onChange={(v) => onChange(v, list.find((a) => a.id === v))}
      optionRender={(o) => { const a = (o.data as any).data as CashAccount; return (
        <div style={{ display: 'flex', justifyContent: 'space-between', gap: 8, alignItems: 'center' }}>
          <span style={{ minWidth: 0, overflow: 'hidden', textOverflow: 'ellipsis' }}><Tag color={CASH_ACCOUNT_TYPE_COLOR[a.type]} style={{ marginRight: 6 }}>{CASH_ACCOUNT_TYPE_LABEL[a.type]}</Tag>{a.name}{!a.isActive && <span className="muted"> · ngừng</span>}</span>
          {showBalance && <span className="muted" style={{ whiteSpace: 'nowrap', fontVariantNumeric: 'tabular-nums' }}>{money(a.balance)}</span>}
        </div>
      ); }} />
  );
}

export interface CategorySelectProps { value?: string; onChange: (id: string | undefined) => void; direction: PaymentDirection; size?: 'small' | 'middle' | 'large'; allowClear?: boolean; placeholder?: string; disabled?: boolean; allowCreate?: boolean; includeInactive?: boolean }

/** Select of other income / expense categories with an inline "+ thêm loại" quick-create. */
export function CategorySelect({ value, onChange, direction, size = 'middle', allowClear = false, placeholder, disabled, allowCreate = true, includeInactive }: CategorySelectProps) {
  const { data, isLoading } = useCashCategories({ direction, includeInactive: !!includeInactive });
  const can = useCan();
  const qc = useQueryClient();
  const { message } = App.useApp();
  // the typed search text becomes the new category's name (same pattern as CustomerSelect's quick-create)
  const [typed, setTyped] = useState('');
  const [adding, setAdding] = useState(false);
  const list = data ?? [];
  const exists = (n: string) => list.some((c) => c.name.trim().toLowerCase() === n.toLowerCase());
  const add = async (n: string) => {
    n = n.trim();
    if (!n) { message.warning(`Gõ tên loại ${direction === 'IN' ? 'thu' : 'chi'} mới vào ô tìm kiếm rồi bấm “Thêm loại”`); return; }
    setAdding(true);
    try {
      const c = await financeApi.createCategory({ direction, name: n });
      await qc.invalidateQueries({ queryKey: ['cash-categories'] });
      message.success(`Đã thêm loại "${c.name}"`);
      setTyped(''); onChange(c.id);
    } catch (e) { message.error(errMsg(e)); } finally { setAdding(false); }
  };
  return (
    <Select style={{ width: '100%' }} size={size} showSearch allowClear={allowClear} disabled={disabled} loading={isLoading} value={value && list.some((c) => c.id === value) ? value : undefined} onChange={(v) => onChange(v)} onSearch={setTyped}
      placeholder={placeholder ?? (direction === 'IN' ? 'Chọn loại thu (gõ để tìm hoặc thêm mới)' : 'Chọn loại chi (gõ để tìm hoặc thêm mới)')} optionFilterProp="label"
      options={list.map((c) => ({ value: c.id, label: c.isActive ? c.name : `${c.name} (ngừng)` }))}
      notFoundContent={<span className="muted">{typed ? `Chưa có loại “${typed}”` : `Chưa có loại ${direction === 'IN' ? 'thu' : 'chi'} nào`}</span>}
      dropdownRender={(menu) => (<>{menu}{allowCreate && can('cash.account.manage') && (<><Divider style={{ margin: '6px 0' }} />
        <Button type="link" size="small" icon={<PlusOutlined />} loading={adding} disabled={!typed.trim() || exists(typed)} onMouseDown={(e) => e.preventDefault()} onClick={() => add(typed)}>
          {typed.trim() ? (exists(typed) ? `“${typed.trim()}” đã có` : `Thêm loại “${typed.trim()}”`) : `Gõ tên để thêm loại ${direction === 'IN' ? 'thu' : 'chi'} mới`}
        </Button></>)}</>)} />
  );
}
