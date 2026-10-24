import { Alert, App, DatePicker, Input, Modal, Segmented, Select } from 'antd';
import dayjs, { Dayjs } from 'dayjs';
import { useEffect, useMemo, useState } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import { ACCOUNT_TYPE_METHOD, FINANCE_KEYS, METHOD_ACCOUNT_TYPE, PaymentDirection, PaymentEx, financeApi, useCashAccounts } from '../../api/finance';
import { errMsg } from '../../api/client';
import { CustomerSelect } from '../../components/CustomerSelect';
import { MoneyInput } from '../../components/Inputs';
import { SupplierSelect } from '../../components/SupplierSelect';
import { useAuthStore, useCan } from '../../store/auth';
import { PAYMENT_METHOD_LABEL, toNum } from '../../utils/format';
import { CategorySelect, FundSelect, accessibleFunds, branchDrawer } from './FinanceSelects';
import './finance.css';

export type VoucherKind = 'OTHER' | 'CUSTOMER' | 'SUPPLIER';
export interface VoucherModalProps {
  open: boolean;
  direction: PaymentDirection;
  onClose: () => void;
  onSaved?: (p: PaymentEx) => void;
  /** fund pre-selected (e.g. the fund currently shown in the cash book) */
  defaultAccountId?: string;
  defaultKind?: VoucherKind;
  /** show a "Phiếu thu / Phiếu chi" switch at the top (payments list) */
  allowDirectionSwitch?: boolean;
}

const EXTRA_KEYS = ['purchase-summary', 'sales-summary', 'invoices', 'invoice', 'purchase-receipts', 'purchase-receipt', 'purchase-returns', 'purchase-return'];

/**
 * Phiếu thu / chi (KiotViet "Lập phiếu thu/chi"): either an "other income / expense" voucher with a category (no party),
 * or a party voucher (customer / supplier) that is booked against the party's general debt (no document allocation –
 * use the "Thanh toán NCC" / "Thu nợ khách" modal for allocations). Shared by the cash book and the payments list.
 */
export function VoucherModal({ open, direction: direction0, onClose, onSaved, defaultAccountId, defaultKind, allowDirectionSwitch }: VoucherModalProps) {
  const { message } = App.useApp();
  const [direction, setDirection] = useState<PaymentDirection>(direction0);
  useEffect(() => { if (open) setDirection(direction0); }, [open, direction0]);
  const qc = useQueryClient();
  const can = useCan();
  const branchId = useAuthStore((s) => s.currentBranchId);
  const { data: accounts } = useCashAccounts(false, open);
  const funds = useMemo(() => accessibleFunds(accounts, branchId), [accounts, branchId]);
  const canOther = can('payment.other');
  const canParty = can('payment.create');
  const [kind, setKind] = useState<VoucherKind>('OTHER');
  const [partyId, setPartyId] = useState<string | undefined>();
  const [categoryId, setCategoryId] = useState<string | undefined>();
  const [amount, setAmount] = useState(0);
  const [method, setMethod] = useState('CASH');
  const [accountId, setAccountId] = useState<string | undefined>();
  const [date, setDate] = useState<Dayjs>(dayjs());
  const [reference, setReference] = useState('');
  const [note, setNote] = useState('');
  const [saving, setSaving] = useState(false);
  const [touchedFund, setTouchedFund] = useState(false);

  useEffect(() => {
    if (!open) return;
    setKind(defaultKind ?? (canOther ? 'OTHER' : 'CUSTOMER'));
    setPartyId(undefined); setCategoryId(undefined); setAmount(0); setMethod('CASH'); setAccountId(undefined); setDate(dayjs()); setReference(''); setNote(''); setTouchedFund(false);
  }, [open, defaultKind, canOther]);
  // pre-select the fund once the fund list is available (default = fund shown in the cash book, else the branch drawer)
  useEffect(() => {
    if (!open || touchedFund || accountId || !funds.length) return;
    const pick = (defaultAccountId && funds.find((a) => a.id === defaultAccountId)) || branchDrawer(funds, branchId);
    if (pick) { setAccountId(pick.id); setMethod(ACCOUNT_TYPE_METHOD[pick.type]); }
  }, [open, funds, defaultAccountId, branchId, touchedFund, accountId]);

  const onMethod = (m: string) => {
    setMethod(m);
    const t = METHOD_ACCOUNT_TYPE[m];
    const cur = funds.find((a) => a.id === accountId);
    if (t && cur?.type !== t) {
      const same = funds.filter((a) => a.type === t).sort((a, b) => Number(!!b.branchId) - Number(!!a.branchId) || Number(b.isDefault) - Number(a.isDefault));
      const alt = same[0] ?? (t === 'EWALLET' ? funds.find((a) => a.type === 'BANK') : undefined);
      if (alt) setAccountId(alt.id);
    }
  };
  const onAccount = (id?: string) => {
    setTouchedFund(true); setAccountId(id);
    const acc = funds.find((a) => a.id === id);
    if (acc && METHOD_ACCOUNT_TYPE[method] !== acc.type) setMethod(ACCOUNT_TYPE_METHOD[acc.type]);
  };

  const submit = async () => {
    if (!branchId) { message.warning('Chọn chi nhánh'); return; }
    if (!(amount > 0)) { message.warning('Nhập số tiền'); return; }
    if (kind === 'OTHER' && !categoryId) { message.warning(direction === 'IN' ? 'Chọn loại thu' : 'Chọn loại chi'); return; }
    if (kind !== 'OTHER' && !partyId) { message.warning(kind === 'CUSTOMER' ? 'Chọn khách hàng' : 'Chọn nhà cung cấp'); return; }
    setSaving(true);
    try {
      const p = await financeApi.createVoucher({
        branchId, direction, method, amount: String(amount), paymentDate: date.toISOString(), reference: reference.trim() || undefined, note: note.trim() || undefined, cashAccountId: accountId,
        ...(kind === 'OTHER' ? { categoryId } : { partyType: kind, partyId }),
      });
      message.success(`Đã lập ${direction === 'OUT' ? 'phiếu chi' : 'phiếu thu'} ${p.code}`);
      [...FINANCE_KEYS, ...EXTRA_KEYS].forEach((k) => qc.invalidateQueries({ queryKey: [k] }));
      onSaved?.(p); onClose();
    } catch (e) { message.error(errMsg(e)); } finally { setSaving(false); }
  };

  const kindOptions = [
    ...(canOther ? [{ value: 'OTHER', label: direction === 'IN' ? 'Thu khác' : 'Chi khác' }] : []),
    ...(canParty ? [{ value: 'CUSTOMER', label: 'Khách hàng' }, { value: 'SUPPLIER', label: 'Nhà cung cấp' }] : []),
  ];
  const fund = funds.find((a) => a.id === accountId);
  const title = direction === 'IN' ? 'Lập phiếu thu' : 'Lập phiếu chi';
  return (
    <Modal title={title} open={open} onCancel={onClose} onOk={submit} okText="Lưu phiếu" cancelText="Bỏ qua" confirmLoading={saving} okButtonProps={{ disabled: !kindOptions.length }} width={640} destroyOnClose>
      {!kindOptions.length && <Alert type="warning" showIcon message="Bạn không có quyền lập phiếu thu / chi" style={{ marginBottom: 10 }} />}
      <div className="cb-form">
        {allowDirectionSwitch && <div className="full cb-kind"><Segmented block value={direction} options={[{ value: 'IN', label: 'Phiếu thu' }, { value: 'OUT', label: 'Phiếu chi' }]} onChange={(v) => { setDirection(v as PaymentDirection); setCategoryId(undefined); }} /></div>}
        <div className="full cb-kind"><div className="kv-hint">Đối tượng</div>
          <Segmented block value={kind} options={kindOptions} onChange={(v) => { setKind(v as VoucherKind); setPartyId(undefined); setCategoryId(undefined); }} /></div>
        {kind === 'OTHER' ? (
          <div className="full"><div className="kv-hint">{direction === 'IN' ? 'Loại thu' : 'Loại chi'} (có thể thêm loại mới ngay trong danh sách)</div><CategorySelect direction={direction} value={categoryId} onChange={setCategoryId} /></div>
        ) : (
          <div className="full"><div className="kv-hint">{kind === 'CUSTOMER' ? 'Khách hàng' : 'Nhà cung cấp'}</div>
            {kind === 'CUSTOMER' ? <CustomerSelect value={partyId} onChange={(id) => setPartyId(id)} allowCreate={false} /> : <SupplierSelect value={partyId} onChange={(id) => setPartyId(id)} allowCreate={false} />}
            <div className="cb-hint" style={{ marginTop: 4 }}>{kind === 'CUSTOMER' ? (direction === 'IN' ? 'Thu tiền khách – trừ vào công nợ chung của khách.' : 'Chi tiền cho khách (hoàn tiền / trả trước) – ghi tăng số dư khách.') : (direction === 'OUT' ? 'Trả tiền nhà cung cấp – trừ vào công nợ chung.' : 'Nhà cung cấp hoàn tiền – ghi giảm số đã trả.')} Cần phân bổ vào chứng từ cụ thể thì dùng “Thanh toán NCC” / “Thu nợ khách”.</div>
          </div>
        )}
        <div><div className="kv-hint">Số tiền</div><MoneyInput size="large" value={amount || undefined} placeholder="0" onChange={(v) => setAmount(toNum(v))} autoFocus /></div>
        <div><div className="kv-hint">Phương thức</div><Select value={method} onChange={onMethod} options={Object.entries(PAYMENT_METHOD_LABEL).map(([value, label]) => ({ value, label }))} /></div>
        <div className="full"><div className="kv-hint">Quỹ tiền {direction === 'IN' ? 'nhận' : 'chi'}</div>
          <FundSelect value={accountId} onChange={(id) => onAccount(id)} branchId={branchId} placeholder="Mặc định theo phương thức" allowClear />
          {fund && <div className="cb-hint" style={{ marginTop: 4 }}>Số dư hiện tại: <b>{Intl.NumberFormat('vi-VN').format(toNum(fund.balance))}</b>{direction === 'OUT' && amount > 0 && toNum(fund.balance) < amount ? <span className="neg"> · quỹ không đủ tiền</span> : null}</div>}
        </div>
        <div><div className="kv-hint">Thời gian</div><DatePicker style={{ width: '100%' }} format="DD/MM/YYYY HH:mm" showTime value={date} onChange={(v) => v && setDate(v)} /></div>
        <div><div className="kv-hint">Tham chiếu (số UNC, mã GD…)</div><Input value={reference} onChange={(e) => setReference(e.target.value)} /></div>
        <div className="full"><div className="kv-hint">Ghi chú / diễn giải</div><Input.TextArea rows={2} value={note} onChange={(e) => setNote(e.target.value)} placeholder={kind === 'OTHER' ? (direction === 'OUT' ? 'VD: Tiền điện tháng 10' : 'VD: Thu tiền cho thuê mặt bằng') : ''} /></div>
      </div>
    </Modal>
  );
}
