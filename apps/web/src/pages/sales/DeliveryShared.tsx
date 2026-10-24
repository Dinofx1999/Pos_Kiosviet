import { Alert, App, AutoComplete, Button, DatePicker, Descriptions, Empty, Input, InputNumber, Modal, Select, Switch, Tag, Timeline } from 'antd';
import { CarOutlined, DollarOutlined, EditOutlined, FileTextOutlined, ShoppingOutlined } from '@ant-design/icons';
import dayjs, { Dayjs } from 'dayjs';
import { useEffect, useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import { useQueryClient } from '@tanstack/react-query';
import { DELIVERY_STATUS_LABELS } from '@erp/shared';
import { CodCollectInput, Delivery, DeliveryInfoInput, DeliveryStatus, ORDER_KEYS, deliveriesApi, useDelivery } from '../../api/orders';
import { useInvoices } from '../../api/sales';
import { METHOD_ACCOUNT_TYPE, useCashAccounts } from '../../api/finance';
import { normalizeError } from '../../api/client';
import type { Invoice } from '../../api/types';
import { MoneyInput } from '../../components/Inputs';
import { useAuthStore, useCan } from '../../store/auth';
import { PAYMENT_METHOD_LABEL, dt, money, toNum } from '../../utils/format';
import './orders.css';

// ---------------------------------------------------------------- labels
export const DELIVERY_STATUS_LABEL: Record<string, string> = DELIVERY_STATUS_LABELS;
export const DELIVERY_STATUS_COLOR: Record<string, string> = { PENDING: 'default', PICKING: 'gold', DELIVERING: 'blue', DELIVERED: 'green', RETURNING: 'orange', RETURNED: 'volcano', CANCELLED: 'red' };
/** Button label for moving a parcel INTO the given status. */
export const DELIVERY_NEXT_LABEL: Record<string, string> = { PENDING: 'Về chờ xử lý', PICKING: 'Chờ lấy hàng', DELIVERING: 'Bắt đầu giao', DELIVERED: 'Đã giao hàng', RETURNING: 'Chuyển hoàn', RETURNED: 'Đã nhận hàng hoàn', CANCELLED: 'Hủy vận đơn' };
export const DELIVERY_FINAL: DeliveryStatus[] = ['DELIVERED', 'RETURNED', 'CANCELLED'];
export const DELIVERY_ACTIVE: DeliveryStatus[] = ['PICKING', 'DELIVERING', 'RETURNING'];
export const CARRIER_OPTIONS = ['Tự giao', 'GHTK', 'GHN', 'Viettel Post', 'J&T Express', 'Ninja Van', 'Grab', 'Ahamove', 'VNPost', 'Be'].map((v) => ({ value: v }));
export const METHOD_OPTIONS = Object.entries(PAYMENT_METHOD_LABEL).map(([value, label]) => ({ value, label }));

/** Friendly hints for the Module 06 delivery error codes (appended to the server message). */
export function deliveryErrMsg(e: unknown): string {
  const err = normalizeError(e);
  const d = (err.details ?? {}) as Record<string, any>;
  const hints: Record<string, string> = {
    DELIVERY_TRANSITION: d.allowed?.length ? `Từ "${DELIVERY_STATUS_LABEL[d.from] ?? d.from}" chỉ chuyển được sang: ${(d.allowed as string[]).map((s) => DELIVERY_STATUS_LABEL[s] ?? s).join(', ')}.` : 'Tải lại vận đơn để xem trạng thái mới nhất.',
    DELIVERY_EXISTS: 'Mỗi đơn đặt hàng chỉ có một vận đơn – mở vận đơn hiện có trong mục Giao hàng.',
    COD_COLLECTED: 'Tiền thu hộ của vận đơn này đã được ghi nhận trước đó.',
    DELIVERY_NOT_DELIVERED: 'Chuyển vận đơn sang "Đã giao" trước khi ghi nhận thu hộ.',
    DOCUMENT_NOT_EDITABLE: 'Vận đơn đã giao / chuyển hoàn / hủy không sửa được.',
    INVOICE_HAS_DELIVERY: `Hủy vận đơn ${d.deliveryCode ?? ''} trước, sau đó hủy hóa đơn.`,
    ORDER_HAS_DELIVERY: `Hủy vận đơn ${d.deliveryCode ?? ''} trước, sau đó hủy đơn.`,
    DOCUMENT_NOT_POSTED: 'Chứng từ đã hủy, không tạo vận đơn được.',
    SHIFT_REQUIRED: 'Mở ca bán hàng (Bán hàng → Mở ca) rồi thao tác lại.',
  };
  const hint = hints[err.code];
  return hint ? `${err.message} – ${hint}` : err.message;
}

// ---------------------------------------------------------------- fund select (cash accounts, filtered by the payment method)
export function FundSelect({ method, value, onChange, size }: { method: string; value?: string; onChange: (v?: string) => void; size?: 'small' | 'middle' }) {
  const can = useCan();
  const branchId = useAuthStore((s) => s.currentBranchId);
  const { data: accounts } = useCashAccounts(false, can('cash.view'));
  const type = METHOD_ACCOUNT_TYPE[method] ?? null;
  const options = useMemo(() => (accounts ?? []).filter((a) => a.isActive && (!type || a.type === type) && (!a.branchId || a.branchId === branchId)).map((a) => ({ value: a.id, label: `${a.name}${a.isDefault ? ' (mặc định)' : ''}` })), [accounts, type, branchId]);
  useEffect(() => { if (accounts && value && !options.some((o) => o.value === value)) onChange(undefined); }, [method, accounts]);
  if (!can('cash.view')) return null;
  return <Select allowClear size={size} style={{ width: '100%' }} value={value} onChange={(v) => onChange(v || undefined)} options={options} placeholder="Quỹ mặc định theo phương thức" notFoundContent="Không có quỹ phù hợp" />;
}

/** Method + amount + fund + reference block shared by the deposit / COD / completion modals. */
export function PaymentFields({ method, amount, fund, reference, max, onChange, amountLabel = 'Số tiền', amountDisabled, showFund = true }: { method: string; amount: number; fund?: string; reference: string; max?: number; onChange: (p: { method?: string; amount?: number; fund?: string; reference?: string }) => void; amountLabel?: string; amountDisabled?: boolean; showFund?: boolean }) {
  const can = useCan();
  return (
    <div className="od-form">
      <div className="od-field"><div className="kv-hint">{amountLabel}</div><MoneyInput value={amount} max={max} disabled={amountDisabled} onChange={(v) => onChange({ amount: max !== undefined ? Math.min(toNum(v), max) : toNum(v) })} /></div>
      <div className="od-field"><div className="kv-hint">Phương thức</div><Select style={{ width: '100%' }} value={method} onChange={(v) => onChange({ method: v })} options={METHOD_OPTIONS} /></div>
      {showFund && can('cash.view') && <div className="od-field"><div className="kv-hint">Quỹ / tài khoản nhận</div><FundSelect method={method} value={fund} onChange={(v) => onChange({ fund: v })} /></div>}
      <div className="od-field"><div className="kv-hint">Tham chiếu (số UNC, mã GD…)</div><Input value={reference} onChange={(e) => onChange({ reference: e.target.value })} /></div>
    </div>
  );
}

// ---------------------------------------------------------------- delivery form (receiver / carrier / fees)
export interface DeliveryFormValue { receiverName: string; receiverPhone: string; address: string; ward: string; district: string; province: string; carrier: string; trackingCode: string; shippingFee: number; shippingCost: number; codAmount: number | null; weightGram: number | null; expectedAt: Dayjs | null; note: string }
export const emptyDeliveryForm = (init?: Partial<DeliveryFormValue>): DeliveryFormValue => ({ receiverName: '', receiverPhone: '', address: '', ward: '', district: '', province: '', carrier: '', trackingCode: '', shippingFee: 0, shippingCost: 0, codAmount: null, weightGram: null, expectedAt: null, note: '', ...init });
export const deliveryToForm = (d: Delivery): DeliveryFormValue => ({ receiverName: d.receiverName, receiverPhone: d.receiverPhone ?? '', address: d.address, ward: d.ward ?? '', district: d.district ?? '', province: d.province ?? '', carrier: d.carrier ?? '', trackingCode: d.trackingCode ?? '', shippingFee: toNum(d.shippingFee), shippingCost: toNum(d.shippingCost), codAmount: toNum(d.codAmount), weightGram: d.weightGram ?? null, expectedAt: d.expectedAt ? dayjs(d.expectedAt) : null, note: d.note ?? '' });
export function deliveryFormToInput(f: DeliveryFormValue): DeliveryInfoInput {
  const s = (v: string) => v.trim() || undefined;
  return { receiverName: f.receiverName.trim(), receiverPhone: s(f.receiverPhone), address: f.address.trim(), ward: s(f.ward), district: s(f.district), province: s(f.province), carrier: s(f.carrier), trackingCode: s(f.trackingCode), shippingFee: f.shippingFee > 0 ? String(f.shippingFee) : undefined, shippingCost: f.shippingCost > 0 ? String(f.shippingCost) : undefined, codAmount: f.codAmount === null ? undefined : String(f.codAmount), weightGram: f.weightGram ?? undefined, expectedAt: f.expectedAt ? f.expectedAt.toISOString() : undefined, note: s(f.note) };
}
export function validateDeliveryForm(f: DeliveryFormValue): string | null {
  if (!f.receiverName.trim()) return 'Nhập tên người nhận';
  if (!f.address.trim()) return 'Nhập địa chỉ giao hàng';
  if (f.receiverPhone.trim() && !/^[0-9+().\s-]{6,30}$/.test(f.receiverPhone.trim())) return 'Số điện thoại người nhận không hợp lệ';
  return null;
}
/** Default COD (BR-106): amount still due on the document + shipping fee charged to the customer. */
export const defaultCod = (due: number, fee: number) => Math.max(0, due) + Math.max(0, fee);

export function DeliveryFormFields({ value, onChange, due, compact }: { value: DeliveryFormValue; onChange: (v: DeliveryFormValue) => void; due?: number; compact?: boolean }) {
  const set = (p: Partial<DeliveryFormValue>) => onChange({ ...value, ...p });
  const cod = due !== undefined ? defaultCod(due, value.shippingFee) : undefined;
  return (
    <div className="od-form">
      <div className="od-field"><div className="kv-hint">Người nhận *</div><Input value={value.receiverName} onChange={(e) => set({ receiverName: e.target.value })} maxLength={200} /></div>
      <div className="od-field"><div className="kv-hint">Điện thoại</div><Input value={value.receiverPhone} inputMode="tel" onChange={(e) => set({ receiverPhone: e.target.value })} maxLength={30} /></div>
      <div className="od-field od-span"><div className="kv-hint">Địa chỉ giao *</div><Input value={value.address} onChange={(e) => set({ address: e.target.value })} maxLength={500} placeholder="Số nhà, đường" /></div>
      {!compact && (
        <>
          <div className="od-field"><div className="kv-hint">Phường / xã</div><Input value={value.ward} onChange={(e) => set({ ward: e.target.value })} maxLength={100} /></div>
          <div className="od-field"><div className="kv-hint">Quận / huyện</div><Input value={value.district} onChange={(e) => set({ district: e.target.value })} maxLength={100} /></div>
          <div className="od-field"><div className="kv-hint">Tỉnh / thành</div><Input value={value.province} onChange={(e) => set({ province: e.target.value })} maxLength={100} /></div>
        </>
      )}
      <div className="od-field"><div className="kv-hint">Đơn vị vận chuyển</div><AutoComplete style={{ width: '100%' }} value={value.carrier} options={CARRIER_OPTIONS} onChange={(v) => set({ carrier: v })} filterOption={(q, o) => String(o?.value ?? '').toLowerCase().includes(q.toLowerCase())} placeholder="GHTK, GHN, tự giao…" /></div>
      <div className="od-field"><div className="kv-hint">Mã vận đơn ĐVVC</div><Input value={value.trackingCode} onChange={(e) => set({ trackingCode: e.target.value })} maxLength={100} /></div>
      <div className="od-field"><div className="kv-hint">Phí giao hàng thu khách</div><MoneyInput value={value.shippingFee} onChange={(v) => set({ shippingFee: toNum(v) })} /></div>
      <div className="od-field"><div className="kv-hint">Chi phí trả ĐVVC</div><MoneyInput value={value.shippingCost} onChange={(v) => set({ shippingCost: toNum(v) })} /></div>
      <div className="od-field"><div className="kv-hint">Tiền thu hộ (COD){cod !== undefined && <span> · mặc định {money(cod)}</span>}</div><MoneyInput value={value.codAmount ?? undefined} placeholder={cod !== undefined ? money(cod) : 'Còn phải thu + phí'} onChange={(v) => set({ codAmount: v === null || v === undefined || v === '' ? null : toNum(v) })} /></div>
      <div className="od-field"><div className="kv-hint">Hẹn giao</div><DatePicker style={{ width: '100%' }} format="DD/MM/YYYY HH:mm" showTime={{ minuteStep: 15 }} value={value.expectedAt} onChange={(v) => set({ expectedAt: v })} /></div>
      {!compact && <div className="od-field"><div className="kv-hint">Khối lượng (gram)</div><InputNumber style={{ width: '100%' }} min={0} controls={false} value={value.weightGram ?? undefined} onChange={(v) => set({ weightGram: v === null || v === undefined ? null : Number(v) })} /></div>}
      <div className={`od-field${compact ? '' : ' od-span'}`}><div className="kv-hint">Ghi chú giao hàng</div><Input value={value.note} onChange={(e) => set({ note: e.target.value })} maxLength={1000} placeholder="Giao giờ hành chính, gọi trước…" /></div>
    </div>
  );
}

// ---------------------------------------------------------------- create / edit modals
/**
 * Create a delivery for an order or an invoice. Without a target the modal starts with a picker of completed invoices
 * (the "+ Vận đơn" button of the Giao hàng screen).
 */
export function DeliveryFormModal({ open, onClose, onSaved, orderId, invoiceId, prefill, due }: { open: boolean; onClose: () => void; onSaved?: (d: Delivery) => void; orderId?: string; invoiceId?: string; prefill?: Partial<DeliveryFormValue>; due?: number }) {
  const { message } = App.useApp();
  const qc = useQueryClient();
  const [picked, setPicked] = useState<Invoice | null>(null);
  const [form, setForm] = useState<DeliveryFormValue>(emptyDeliveryForm());
  const [saving, setSaving] = useState(false);
  useEffect(() => { if (open) { setPicked(null); setForm(emptyDeliveryForm(prefill)); } }, [open]);
  const target = orderId || invoiceId || picked?.id;
  const dueAmount = picked ? toNum(picked.dueAmount ?? toNum(picked.totalAmount) - toNum(picked.paidAmount)) : due;
  const pick = (inv: Invoice) => { setPicked(inv); setForm((f) => ({ ...f, receiverName: f.receiverName || inv.customer?.name || '', receiverPhone: f.receiverPhone || inv.customer?.phone || '' })); };
  const submit = async () => {
    const bad = validateDeliveryForm(form); if (bad) { message.warning(bad); return; }
    if (!target) { message.warning('Chọn hóa đơn cần giao'); return; }
    setSaving(true);
    try {
      const d = await deliveriesApi.create({ ...deliveryFormToInput(form), orderId: orderId || undefined, invoiceId: orderId ? undefined : invoiceId || picked?.id });
      message.success(`Đã tạo vận đơn ${d.code}`);
      ORDER_KEYS.forEach((k) => qc.invalidateQueries({ queryKey: [k] }));
      onSaved?.(d); onClose();
    } catch (e) { message.error(deliveryErrMsg(e)); } finally { setSaving(false); }
  };
  return (
    <Modal title={picked ? `Vận đơn cho hóa đơn ${picked.code}` : 'Tạo vận đơn'} open={open} onCancel={onClose} onOk={submit} okText="Tạo vận đơn" cancelText="Bỏ qua" confirmLoading={saving} okButtonProps={{ disabled: !target }} width={720} destroyOnClose>
      {!orderId && !invoiceId && !picked && <InvoicePickList onPick={pick} />}
      {target && (
        <>
          {picked && <div className="od-settle" style={{ marginBottom: 10 }}><span className="k">Hóa đơn</span><span className="v">{picked.code} · {picked.customer?.name ?? 'Khách lẻ'}</span><span className="k">Còn phải thu</span><span className={`v${(dueAmount ?? 0) > 0 ? ' neg' : ''}`}>{money(dueAmount ?? 0)}</span><span className="hr" /><Button size="small" type="link" style={{ gridColumn: '1 / -1', justifySelf: 'start', paddingInline: 0 }} onClick={() => setPicked(null)}>Chọn hóa đơn khác</Button></div>}
          <DeliveryFormFields value={form} onChange={setForm} due={dueAmount} />
          <div className="kv-hint" style={{ marginTop: 8 }}>COD mặc định = số còn phải thu của chứng từ + phí giao hàng. Khi giao xong có thể thu tiền ngay hoặc ghi nhận sau khi ĐVVC đối soát.</div>
        </>
      )}
    </Modal>
  );
}

/** Completed-invoice search list used when a delivery is created from the Giao hàng screen. */
function InvoicePickList({ onPick }: { onPick: (inv: Invoice) => void }) {
  const branchId = useAuthStore((s) => s.currentBranchId);
  const [text, setText] = useState('');
  const [search, setSearch] = useState<string | undefined>();
  const { data, isLoading, error } = useInvoices({ search, status: 'COMPLETED', branchId: branchId ?? undefined, pageSize: 10 });
  const rows = data?.data ?? [];
  return (
    <div>
      <Input.Search allowClear autoFocus placeholder="Mã hóa đơn, tên hoặc SĐT khách" value={text} onChange={(e) => setText(e.target.value)} onSearch={(v) => setSearch(v.trim() || undefined)} enterButton="Tìm" />
      <div className="kv-hint" style={{ margin: '8px 0' }}>{search ? `Kết quả cho “${search}”` : 'Hóa đơn hoàn thành gần đây của chi nhánh đang chọn'} · chỉ tạo vận đơn cho hóa đơn đã hoàn thành.</div>
      {isLoading && <div className="muted">Đang tải…</div>}
      {!isLoading && !rows.length && <Empty description={error ? deliveryErrMsg(error) : 'Không có hóa đơn phù hợp'} />}
      <div className="od-pick-list">
        {rows.map((inv) => {
          const due = toNum(inv.dueAmount ?? toNum(inv.totalAmount) - toNum(inv.paidAmount));
          return (
            <div key={inv.id} className="od-pick" onClick={() => onPick(inv)}>
              <div style={{ minWidth: 0 }}><div className="code">{inv.code} <span className="muted" style={{ fontWeight: 400, fontSize: 12 }}>{dt(inv.invoiceDate)}</span></div><div className="meta">{inv.customer ? `${inv.customer.name}${inv.customer.phone ? ` · ${inv.customer.phone}` : ''}` : 'Khách lẻ'} · {inv._count?.lines ?? inv.lines?.length ?? ''} dòng</div></div>
              <div style={{ textAlign: 'right' }}><div className="amt">{money(inv.totalAmount)}</div><div className={`meta${due > 0 ? ' neg' : ''}`}>{due > 0 ? `Còn thu ${money(due)}` : 'Đã thanh toán'}</div></div>
            </div>
          );
        })}
      </div>
    </div>
  );
}

export function DeliveryEditModal({ open, delivery, onClose }: { open: boolean; delivery: Delivery; onClose: () => void }) {
  const { message } = App.useApp();
  const qc = useQueryClient();
  const [form, setForm] = useState<DeliveryFormValue>(deliveryToForm(delivery));
  const [saving, setSaving] = useState(false);
  useEffect(() => { if (open) setForm(deliveryToForm(delivery)); }, [open, delivery]);
  const submit = async () => {
    const bad = validateDeliveryForm(form); if (bad) { message.warning(bad); return; }
    setSaving(true);
    try {
      const input = deliveryFormToInput(form);
      await deliveriesApi.update(delivery.id, { ...input, shippingFee: String(form.shippingFee), shippingCost: String(form.shippingCost), codAmount: String(form.codAmount ?? 0), expectedAt: form.expectedAt ? form.expectedAt.toISOString() : null });
      message.success(`Đã cập nhật vận đơn ${delivery.code}`);
      ORDER_KEYS.forEach((k) => qc.invalidateQueries({ queryKey: [k] }));
      onClose();
    } catch (e) { message.error(deliveryErrMsg(e)); } finally { setSaving(false); }
  };
  return (
    <Modal title={`Sửa vận đơn ${delivery.code}`} open={open} onCancel={onClose} onOk={submit} okText="Lưu" cancelText="Bỏ qua" confirmLoading={saving} width={720} destroyOnClose>
      <DeliveryFormFields value={form} onChange={setForm} />
    </Modal>
  );
}

// ---------------------------------------------------------------- status / COD modals
export function DeliveryStatusModal({ open, delivery, target, onClose, onDone }: { open: boolean; delivery: Delivery; target: DeliveryStatus; onClose: () => void; onDone?: (d: Delivery) => void }) {
  const { message } = App.useApp();
  const qc = useQueryClient();
  const cod = toNum(delivery.codAmount);
  const canCollect = target === 'DELIVERED' && !delivery.codCollected && cod > 0;
  const [note, setNote] = useState('');
  const [collect, setCollect] = useState(true);
  const [pay, setPay] = useState<{ method: string; amount: number; fund?: string; reference: string }>({ method: 'CASH', amount: cod, reference: '' });
  const [saving, setSaving] = useState(false);
  useEffect(() => { if (open) { setNote(''); setCollect(true); setPay({ method: 'CASH', amount: cod, reference: '' }); } }, [open, delivery.id]);
  const submit = async () => {
    setSaving(true);
    try {
      const collectCod: CodCollectInput | undefined = canCollect && collect ? { method: pay.method, amount: String(pay.amount), cashAccountId: pay.fund, reference: pay.reference.trim() || undefined } : undefined;
      const d = await deliveriesApi.setStatus(delivery.id, { status: target, note: note.trim() || undefined, collectCod });
      message.success(`${delivery.code}: ${DELIVERY_STATUS_LABEL[target]}${collectCod ? ` · đã thu ${money(pay.amount)}` : ''}`);
      ORDER_KEYS.forEach((k) => qc.invalidateQueries({ queryKey: [k] }));
      onDone?.(d); onClose();
    } catch (e) { message.error(deliveryErrMsg(e)); } finally { setSaving(false); }
  };
  return (
    <Modal title={`${delivery.code} → ${DELIVERY_STATUS_LABEL[target]}`} open={open} onCancel={onClose} onOk={submit} okText={DELIVERY_NEXT_LABEL[target]} cancelText="Bỏ qua" confirmLoading={saving} okButtonProps={{ danger: target === 'CANCELLED' }} destroyOnClose>
      <div className="od-settle" style={{ marginBottom: 10 }}>
        <span className="k">Người nhận</span><span className="v">{delivery.receiverName}{delivery.receiverPhone ? ` · ${delivery.receiverPhone}` : ''}</span>
        <span className="k">Trạng thái</span><span className="v"><Tag color={DELIVERY_STATUS_COLOR[delivery.status]} style={{ marginInlineEnd: 0 }}>{DELIVERY_STATUS_LABEL[delivery.status]}</Tag> → <Tag color={DELIVERY_STATUS_COLOR[target]} style={{ marginInlineEnd: 0 }}>{DELIVERY_STATUS_LABEL[target]}</Tag></span>
        {cod > 0 && <><span className="k">Tiền thu hộ</span><span className="v">{money(cod)} {delivery.codCollected ? <Tag color="green" style={{ marginInlineEnd: 0 }}>Đã thu</Tag> : <Tag color="orange" style={{ marginInlineEnd: 0 }}>Chưa thu</Tag>}</span></>}
      </div>
      {target === 'CANCELLED' && <Alert type="warning" showIcon style={{ marginBottom: 10 }} message="Hủy vận đơn không đổi trạng thái đơn / hóa đơn. Hàng đã xuất cần lập phiếu trả hàng nếu khách không nhận." />}
      {target === 'RETURNED' && <Alert type="info" showIcon style={{ marginBottom: 10 }} message="Hàng chuyển hoàn không tự nhập kho: lập phiếu trả hàng (Trả hàng) để nhập lại và hoàn tiền / ghi có." />}
      {canCollect && (
        <div style={{ marginBottom: 10 }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: 8 }}><Switch checked={collect} onChange={setCollect} /><span><b>Thu tiền COD ngay</b><div className="kv-hint">Tắt nếu đơn vị vận chuyển sẽ đối soát và chuyển tiền sau (ghi nhận bằng “Ghi nhận thu hộ”).</div></span></div>
          {collect && <PaymentFields method={pay.method} amount={pay.amount} fund={pay.fund} reference={pay.reference} amountLabel="Số tiền thực thu" onChange={(p) => setPay((s) => ({ ...s, ...p }))} />}
          {collect && <div className="kv-hint" style={{ marginTop: 6 }}>Phần ≤ số còn nợ của hóa đơn được thu vào hóa đơn; phần còn lại (phí giao hàng / thu dư) ghi “Phí giao hàng thu hộ”.</div>}
        </div>
      )}
      <div className="od-field"><div className="kv-hint">Ghi chú</div><Input.TextArea rows={2} value={note} onChange={(e) => setNote(e.target.value)} maxLength={500} placeholder={target === 'CANCELLED' ? 'Lý do hủy' : 'Ví dụ: shipper đã lấy hàng lúc 14h'} /></div>
    </Modal>
  );
}

export function CodCollectModal({ open, delivery, onClose }: { open: boolean; delivery: Delivery; onClose: () => void }) {
  const { message } = App.useApp();
  const qc = useQueryClient();
  const cod = toNum(delivery.codAmount);
  const [pay, setPay] = useState<{ method: string; amount: number; fund?: string; reference: string }>({ method: 'BANK_TRANSFER', amount: cod, reference: '' });
  const [saving, setSaving] = useState(false);
  useEffect(() => { if (open) setPay({ method: 'BANK_TRANSFER', amount: cod, reference: '' }); }, [open, delivery.id]);
  const submit = async () => {
    if (!(pay.amount > 0)) { message.warning('Nhập số tiền thu hộ'); return; }
    setSaving(true);
    try {
      await deliveriesApi.collectCod(delivery.id, { method: pay.method, amount: String(pay.amount), cashAccountId: pay.fund, reference: pay.reference.trim() || undefined });
      message.success(`Đã ghi nhận thu hộ ${money(pay.amount)} cho ${delivery.code}`);
      ORDER_KEYS.forEach((k) => qc.invalidateQueries({ queryKey: [k] }));
      onClose();
    } catch (e) { message.error(deliveryErrMsg(e)); } finally { setSaving(false); }
  };
  return (
    <Modal title={`Ghi nhận thu hộ – ${delivery.code}`} open={open} onCancel={onClose} onOk={submit} okText="Ghi nhận" cancelText="Bỏ qua" confirmLoading={saving} destroyOnClose>
      <p className="kv-hint" style={{ marginTop: 0 }}>Dùng khi đơn vị vận chuyển đối soát và chuyển tiền COD sau khi giao. Tiền vào hóa đơn (≤ số còn nợ), phần còn lại ghi “Phí giao hàng thu hộ”. Chỉ ghi nhận được một lần.</p>
      <PaymentFields method={pay.method} amount={pay.amount} fund={pay.fund} reference={pay.reference} amountLabel={`Số tiền thực nhận (COD ${money(cod)})`} onChange={(p) => setPay((s) => ({ ...s, ...p }))} />
    </Modal>
  );
}

// ---------------------------------------------------------------- read-only pieces
export function DeliveryTimeline({ events }: { events?: Delivery['events'] }) {
  if (!events?.length) return <div className="muted">Chưa có lịch sử</div>;
  return (
    <Timeline className="od-timeline" items={events.map((e) => ({ key: e.id, color: e.status === 'CANCELLED' ? 'red' : e.status === 'DELIVERED' ? 'green' : e.status === 'RETURNING' || e.status === 'RETURNED' ? 'orange' : 'blue', children: <div><b>{DELIVERY_STATUS_LABEL[e.status] ?? e.status}</b> <span className="muted">· {dt(e.createdAt)}</span>{e.note && <div className="kv-hint">{e.note}</div>}</div> }))} />
  );
}

export function CodBadge({ d }: { d: Pick<Delivery, 'codAmount' | 'codCollected' | 'status'> }) {
  const cod = toNum(d.codAmount);
  if (cod <= 0) return <span className="muted">Không thu hộ</span>;
  return <span><b>{money(cod)}</b> {d.codCollected ? <Tag color="green" style={{ marginInlineEnd: 0 }}>Đã thu</Tag> : d.status === 'CANCELLED' || d.status === 'RETURNED' ? null : <Tag color="orange" style={{ marginInlineEnd: 0 }}>Chưa thu</Tag>}</span>;
}

/** Compact delivery block (order detail / invoice detail): header, receiver, fees and the event timeline. */
export function DeliverySummary({ d, onOpen }: { d: Delivery; onOpen?: () => void }) {
  return (
    <div className="od-dcard">
      <div className="od-dcard-head"><span><CarOutlined /> <Link to={`/deliveries?search=${d.code}`}><b>{d.code}</b></Link> <Tag color={DELIVERY_STATUS_COLOR[d.status]}>{DELIVERY_STATUS_LABEL[d.status]}</Tag></span>{onOpen && <Button size="small" onClick={onOpen}>Mở vận đơn</Button>}</div>
      <div className="od-kv">
        <span className="k">Người nhận</span><span className="v">{d.receiverName}{d.receiverPhone ? ` · ${d.receiverPhone}` : ''}</span>
        <span className="k">Địa chỉ</span><span className="v">{[d.address, d.ward, d.district, d.province].filter(Boolean).join(', ')}</span>
        <span className="k">Vận chuyển</span><span className="v">{d.carrier || '—'}{d.trackingCode ? ` · ${d.trackingCode}` : ''}</span>
        <span className="k">Phí / COD</span><span className="v">Phí {money(d.shippingFee)} · COD <CodBadge d={d} /></span>
        {(d.expectedAt || d.deliveredAt) && <><span className="k">{d.deliveredAt ? 'Đã giao lúc' : 'Hẹn giao'}</span><span className="v">{dt(d.deliveredAt ?? d.expectedAt)}</span></>}
      </div>
      {d.events && <div style={{ marginTop: 8 }}><DeliveryTimeline events={d.events} /></div>}
    </div>
  );
}

/** Full detail of one delivery (drawer on the Giao hàng screen) with the status actions. */
export function DeliveryDetail({ id }: { id: string }) {
  const { data: d, isLoading, error } = useDelivery(id);
  const can = useCan();
  const [target, setTarget] = useState<DeliveryStatus | null>(null);
  const [collecting, setCollecting] = useState(false);
  const [editing, setEditing] = useState(false);
  if (isLoading) return <div className="muted">Đang tải…</div>;
  if (error || !d) return <Alert type="error" showIcon message={error ? deliveryErrMsg(error) : 'Không tìm thấy vận đơn'} />;
  const manage = can('delivery.manage');
  const cod = toNum(d.codAmount);
  const next = d.allowedNext ?? [];
  return (
    <div className="od-detail">
      <Descriptions size="small" column={{ xs: 1, md: 2 }} colon={false} labelStyle={{ color: '#6b7280' }}>
        <Descriptions.Item label="Mã vận đơn"><b className="od-code">{d.code}</b> <Tag color={DELIVERY_STATUS_COLOR[d.status]}>{DELIVERY_STATUS_LABEL[d.status]}</Tag></Descriptions.Item>
        <Descriptions.Item label="Chi nhánh">{d.branch?.name ?? '—'}</Descriptions.Item>
        <Descriptions.Item label="Người nhận">{d.receiverName}{d.receiverPhone ? ` · ${d.receiverPhone}` : ''}</Descriptions.Item>
        <Descriptions.Item label="Khách hàng">{d.customer ? <Link to={`/customers?search=${d.customer.code ?? d.customer.name}`}>{d.customer.name}</Link> : 'Khách lẻ'}</Descriptions.Item>
        <Descriptions.Item label="Địa chỉ" span={{ xs: 1, md: 2 }}>{[d.address, d.ward, d.district, d.province].filter(Boolean).join(', ')}</Descriptions.Item>
        <Descriptions.Item label="Vận chuyển">{d.carrier || '—'}{d.trackingCode ? ` · ${d.trackingCode}` : ''}</Descriptions.Item>
        <Descriptions.Item label="Khối lượng">{d.weightGram ? `${d.weightGram} g` : '—'}</Descriptions.Item>
        <Descriptions.Item label="Đơn đặt hàng">{d.order ? <Link to={`/orders?search=${d.order.code}`}><ShoppingOutlined /> {d.order.code}</Link> : '—'}</Descriptions.Item>
        <Descriptions.Item label="Hóa đơn">{d.invoice ? <span><Link to={`/invoices?search=${d.invoice.code}`}><FileTextOutlined /> {d.invoice.code}</Link>{d.invoice.totalAmount !== undefined && <span className="muted"> · còn nợ {money(toNum(d.invoice.totalAmount) - toNum(d.invoice.paidAmount))}</span>}</span> : <span className="muted">Chưa có (lập khi hoàn tất đơn)</span>}</Descriptions.Item>
        <Descriptions.Item label="Phí giao (thu khách)">{money(d.shippingFee)}</Descriptions.Item>
        <Descriptions.Item label="Chi phí ĐVVC">{money(d.shippingCost)}</Descriptions.Item>
        <Descriptions.Item label="Tiền thu hộ (COD)"><CodBadge d={d} /></Descriptions.Item>
        <Descriptions.Item label="Hẹn giao">{d.expectedAt ? dt(d.expectedAt) : '—'}</Descriptions.Item>
        {d.deliveredAt && <Descriptions.Item label="Đã giao lúc">{dt(d.deliveredAt)}</Descriptions.Item>}
        <Descriptions.Item label="Tạo lúc">{dt(d.createdAt)}</Descriptions.Item>
        {d.note && <Descriptions.Item label="Ghi chú" span={{ xs: 1, md: 2 }}>{d.note}</Descriptions.Item>}
      </Descriptions>
      <div style={{ marginTop: 10 }}><b>Lịch sử</b><div style={{ marginTop: 8 }}><DeliveryTimeline events={d.events} /></div></div>
      {d.status === 'RETURNED' && <Alert type="info" showIcon style={{ marginTop: 8 }} message="Hàng chuyển hoàn chưa nhập kho – lập phiếu trả hàng để nhập lại và hoàn tiền / ghi có cho khách." action={d.invoice ? <Link to={`/sales-returns/new?invoiceId=${d.invoice.id}`}><Button size="small">Trả hàng</Button></Link> : undefined} />}
      {manage && (
        <div className="kv-detail-actions od-dactions">
          {!DELIVERY_FINAL.includes(d.status) && <Button icon={<EditOutlined />} onClick={() => setEditing(true)}>Sửa</Button>}
          {d.status === 'DELIVERED' && !d.codCollected && cod > 0 && <Button type="primary" icon={<DollarOutlined />} onClick={() => setCollecting(true)}>Ghi nhận thu hộ {money(cod)}</Button>}
          {next.filter((s) => s !== 'CANCELLED').map((s) => <Button key={s} type={s === 'DELIVERED' || s === 'DELIVERING' || s === 'PICKING' ? 'primary' : 'default'} ghost={s === 'PICKING'} onClick={() => setTarget(s)}>{DELIVERY_NEXT_LABEL[s]}</Button>)}
          {next.includes('CANCELLED') && <Button danger onClick={() => setTarget('CANCELLED')}>Hủy vận đơn</Button>}
        </div>
      )}
      {target && <DeliveryStatusModal open delivery={d} target={target} onClose={() => setTarget(null)} />}
      <CodCollectModal open={collecting} delivery={d} onClose={() => setCollecting(false)} />
      <DeliveryEditModal open={editing} delivery={d} onClose={() => setEditing(false)} />
    </div>
  );
}
