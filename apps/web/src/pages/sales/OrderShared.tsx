import { Alert, App, Button, Descriptions, Input, Modal, Radio, Switch, Table, Tag } from 'antd';
import { CarOutlined, CheckCircleOutlined, CheckOutlined, DeleteOutlined, DollarOutlined, EditOutlined, FileTextOutlined, RollbackOutlined, StopOutlined } from '@ant-design/icons';
import { useEffect, useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { useQueryClient } from '@tanstack/react-query';
import { CompleteOrderResult, ORDER_KEYS, OrderLine, SalesOrder, ordersApi, useOrder } from '../../api/orders';
import { useCurrentShift } from '../../api/sales';
import { useSepayReady } from '../../api/bankTransfers';
import { DocumentQrButton } from '../../components/DocumentQrButton';
import { normalizeError } from '../../api/client';
import { useIsMobile } from '../../hooks/useMedia';
import { useAuthStore, useCan } from '../../store/auth';
import { PAYMENT_METHOD_LABEL, dt, money, qty, toNum } from '../../utils/format';
import { DELIVERY_ACTIVE, DeliveryFormModal, DeliverySummary, PaymentFields } from './DeliveryShared';
import './orders.css';

// ---------------------------------------------------------------- labels
export const ORDER_STATUS_LABEL: Record<string, string> = { DRAFT: 'Phiếu tạm', CONFIRMED: 'Đang xử lý', COMPLETED: 'Hoàn thành', CANCELLED: 'Đã hủy' };
export const ORDER_STATUS_HINT: Record<string, string> = { DRAFT: 'chưa giữ hàng', CONFIRMED: 'đã giữ hàng', COMPLETED: 'đã lập hóa đơn', CANCELLED: '' };
export const ORDER_STATUS_COLOR: Record<string, string> = { DRAFT: 'default', CONFIRMED: 'blue', COMPLETED: 'green', CANCELLED: 'red' };
export const ORDER_SOURCE_LABEL: Record<string, string> = { POS: 'Tại quầy', PHONE: 'Điện thoại', ONLINE: 'Website', FACEBOOK: 'Facebook', ZALO: 'Zalo', SHOPEE: 'Shopee', OTHER: 'Khác' };
export const SOURCE_OPTIONS = Object.entries(ORDER_SOURCE_LABEL).map(([value, label]) => ({ value, label }));

/** Friendly hints for the Module 06 order error codes (appended to the server message). `names` maps variantId → product name for stock errors. */
export function orderErrMsg(e: unknown, names?: Record<string, string>): string {
  const err = normalizeError(e);
  const d = (err.details ?? {}) as Record<string, any>;
  const name = d.variantId && names?.[d.variantId];
  const hints: Record<string, string> = {
    INSUFFICIENT_STOCK: `${name ? `${name}: ` : ''}tồn khả dụng ${qty(d.available ?? d.onHand ?? 0)}, cần ${qty(d.requested ?? 0)}. Giảm số lượng, chọn kho khác hoặc lưu phiếu tạm (không giữ hàng).`,
    VERSION_CONFLICT: 'Đơn vừa được thay đổi ở nơi khác – dữ liệu đã được tải lại, kiểm tra rồi thao tác lại.',
    OVERPAYMENT: d.due !== undefined ? `Chỉ còn ${money(d.due)} có thể cọc / thanh toán (bạn nhập ${money(d.requested)}).` : 'Giảm số tiền.',
    ORDER_HAS_DEPOSIT: 'Đơn đã nhận cọc: không đổi khách hàng và tổng đơn không được thấp hơn tiền cọc. Hủy đơn để hoàn cọc.',
    ORDER_HAS_DELIVERY: `Hủy vận đơn ${d.deliveryCode ?? ''} trước, sau đó hủy đơn.`,
    DELIVERY_EXISTS: 'Mỗi đơn chỉ có một vận đơn.',
    DOCUMENT_NOT_EDITABLE: 'Tải lại để xem trạng thái mới nhất của đơn.',
    DOCUMENT_NOT_DRAFT: 'Đơn không còn là phiếu tạm – tải lại danh sách.',
    DOCUMENT_NOT_POSTED: 'Đơn đã hoàn tất hoặc đã hủy – tải lại danh sách.',
    SHIFT_REQUIRED: 'Mở ca bán hàng (Bán hàng → Mở ca) rồi thao tác lại.',
    FORBIDDEN: 'Liên hệ quản trị để được cấp quyền.',
  };
  const hint = hints[err.code];
  return hint ? `${err.message} – ${hint}` : err.message;
}
export const lineNames = (lines?: OrderLine[] | { variantId: string; name: string }[]) => Object.fromEntries((lines ?? []).map((l: any) => [l.variantId, l.name ?? l.variant?.name])) as Record<string, string>;

export const invalidateOrders = (qc: ReturnType<typeof useQueryClient>) => ORDER_KEYS.forEach((k) => qc.invalidateQueries({ queryKey: [k] }));

// ---------------------------------------------------------------- modals
/** Nhận cọc: a receipt voucher allocated to the order (BR-103); capped at the amount still due. */
export function OrderDepositModal({ open, order, onClose }: { open: boolean; order: SalesOrder; onClose: () => void }) {
  const { message } = App.useApp();
  const qc = useQueryClient();
  const due = toNum(order.dueAmount);
  const [pay, setPay] = useState<{ method: string; amount: number; fund?: string; reference: string }>({ method: 'CASH', amount: due, reference: '' });
  const [note, setNote] = useState('');
  const [saving, setSaving] = useState(false);
  useEffect(() => { if (open) { setPay({ method: 'CASH', amount: due, reference: '' }); setNote(''); } }, [open]);
  const submit = async () => {
    if (!(pay.amount > 0)) { message.warning('Nhập số tiền cọc'); return; }
    if (pay.amount > due + 0.001) { message.warning(`Tiền cọc không được vượt số còn phải thu (${money(due)})`); return; }
    setSaving(true);
    try {
      const o = await ordersApi.deposit(order.id, { method: pay.method, amount: String(pay.amount), cashAccountId: pay.fund, reference: pay.reference.trim() || undefined, note: note.trim() || undefined });
      const last = [...(o.deposits ?? [])].sort((a, b) => +new Date(b.payment.paymentDate) - +new Date(a.payment.paymentDate))[0];
      message.success(`Đã nhận cọc ${money(pay.amount)}${last ? ` – phiếu thu ${last.payment.code}` : ''}`);
      invalidateOrders(qc); onClose();
    } catch (e) { message.error(orderErrMsg(e)); } finally { setSaving(false); }
  };
  return (
    <Modal title={`Nhận cọc – ${order.code}`} open={open} onCancel={onClose} onOk={submit} okText="Nhận cọc" cancelText="Bỏ qua" confirmLoading={saving} destroyOnClose>
      <div className="od-settle" style={{ marginBottom: 10 }}>
        <span className="k">Khách hàng</span><span className="v">{order.customer?.name ?? 'Khách lẻ'}</span>
        <span className="k">Tổng đơn</span><span className="v">{money(order.totalAmount)}</span>
        <span className="k">Đã cọc</span><span className="v">{money(order.depositAmount)}</span>
        <span className="k">Còn phải thu</span><span className="v big">{money(due)}</span>
      </div>
      <PaymentFields method={pay.method} amount={pay.amount} fund={pay.fund} reference={pay.reference} max={due} amountLabel="Tiền cọc" onChange={(p) => setPay((s) => ({ ...s, ...p }))} />
      <div className="od-field" style={{ marginTop: 8 }}><div className="kv-hint">Ghi chú phiếu thu</div><Input value={note} onChange={(e) => setNote(e.target.value)} placeholder={`Tiền cọc đơn ${order.code}`} /></div>
      <div className="kv-hint" style={{ marginTop: 8 }}>Phiếu thu được gắn vào ca đang mở (nếu có) và quỹ theo phương thức. {order.customer ? 'Khách có hồ sơ: tiền cọc ghi vào sổ công nợ (số dư có) cho đến khi lập hóa đơn.' : 'Khách lẻ: hủy đơn bắt buộc hoàn cọc.'}</div>
    </Modal>
  );
}

/** Hoàn tất đơn → hóa đơn (BR-104): deposit moves onto the invoice, the remainder is paid now or (customer only) becomes debt. */
export function OrderCompleteModal({ open, order, onClose, onDone }: { open: boolean; order: SalesOrder; onClose: () => void; onDone?: (r: CompleteOrderResult) => void }) {
  const { message } = App.useApp();
  const qc = useQueryClient();
  const nav = useNavigate();
  const me = useAuthStore((s) => s.me);
  const requireShift = me?.settings?.['pos.requireOpenShift'] === true;
  const { data: shift } = useCurrentShift(open ? order.branchId : undefined);
  const due = toNum(order.dueAmount);
  const hasCustomer = !!order.customerId;
  const [credit, setCredit] = useState(false);
  const [pay, setPay] = useState<{ method: string; amount: number; fund?: string; reference: string }>({ method: 'CASH', amount: due, reference: '' });
  const [saving, setSaving] = useState(false);
  const [result, setResult] = useState<CompleteOrderResult | null>(null);
  // reset only when (re)opened – the order refetches after completion (due changes) and the result view must survive that
  useEffect(() => { if (open) { setCredit(false); setPay({ method: 'CASH', amount: due, reference: '' }); setResult(null); } }, [open]);
  const payNow = due <= 0 ? 0 : credit ? 0 : hasCustomer ? Math.min(pay.amount, due) : due;
  const debt = Math.max(0, due - payNow);
  const submit = async () => {
    if (!hasCustomer && debt > 0.001) { message.warning(`Khách lẻ phải trả đủ ${money(due)}`); return; }
    setSaving(true);
    try {
      const r = await ordersApi.complete(order.id, { version: order.version, payments: payNow > 0 ? [{ method: pay.method, amount: String(payNow), reference: pay.reference.trim() || undefined }] : undefined });
      message.success(`Đã hoàn tất ${order.code} → hóa đơn ${r.invoice.code}`);
      invalidateOrders(qc); setResult(r); onDone?.(r);
    } catch (e) { message.error(orderErrMsg(e)); if (normalizeError(e).code === 'VERSION_CONFLICT') qc.invalidateQueries({ queryKey: ['order', order.id] }); } finally { setSaving(false); }
  };
  if (result) {
    const inv = result.invoice;
    const invDue = toNum(inv.dueAmount ?? toNum(inv.totalAmount) - toNum(inv.paidAmount));
    return (
      <Modal title="Đã hoàn tất đơn đặt hàng" open={open} onCancel={onClose} footer={<div style={{ display: 'flex', gap: 8, justifyContent: 'flex-end' }}><Button onClick={onClose}>Đóng</Button><Button type="primary" icon={<FileTextOutlined />} onClick={() => { onClose(); nav(`/invoices?search=${inv.code}`); }}>Xem hóa đơn</Button></div>} destroyOnClose>
        <div className="od-result">
          <CheckCircleOutlined style={{ fontSize: 28, color: '#15803d' }} />
          <div><div style={{ fontSize: 16, fontWeight: 700 }}>Hóa đơn <Link to={`/invoices?search=${inv.code}`}>{inv.code}</Link></div><div className="kv-hint">Hàng đã xuất kho, tiền cọc chuyển sang hóa đơn{order.delivery ? `, vận đơn ${order.delivery.code} gắn theo hóa đơn` : ''}.</div></div>
        </div>
        <div className="od-settle" style={{ marginTop: 10 }}>
          <span className="k">Tổng hóa đơn</span><span className="v">{money(inv.totalAmount)}</span>
          <span className="k">Đã thanh toán (gồm cọc)</span><span className="v">{money(inv.paidAmount)}</span>
          <span className="k">Còn nợ</span><span className={`v big${invDue > 0 ? ' neg' : ''}`}>{money(invDue)}</span>
        </div>
      </Modal>
    );
  }
  return (
    <Modal title={`Hoàn tất đơn ${order.code} → lập hóa đơn`} open={open} onCancel={onClose} onOk={submit} okText="Hoàn tất & lập hóa đơn" cancelText="Bỏ qua" confirmLoading={saving} destroyOnClose>
      <p className="kv-hint" style={{ marginTop: 0 }}>Hóa đơn được lập với giá đã chốt trên đơn, hàng xuất kho tại <b>{order.warehouse?.name ?? 'kho của đơn'}</b>{order.status === 'CONFIRMED' ? ' (từ phần đã giữ)' : ''}. Tiền cọc chuyển sang hóa đơn; phần còn lại thu ngay{hasCustomer ? ' hoặc ghi nợ cho khách' : ' (khách lẻ phải trả đủ)'}.</p>
      {requireShift && shift === null && <Alert type="warning" showIcon style={{ marginBottom: 10 }} message="Chưa có ca bán hàng đang mở" description="Cửa hàng yêu cầu mở ca trước khi lập hóa đơn – mở ca ở màn hình Bán hàng rồi quay lại." />}
      <div className="od-settle" style={{ marginBottom: 10 }}>
        <span className="k">Khách hàng</span><span className="v">{order.customer?.name ?? 'Khách lẻ'}</span>
        <span className="k">Tổng đơn</span><span className="v">{money(order.totalAmount)}</span>
        <span className="k">Đã cọc</span><span className="v">− {money(order.depositAmount)}</span>
        <span className="hr" />
        <span className="k">Còn phải thu</span><span className="v big">{money(due)}</span>
      </div>
      {due > 0 && hasCustomer && <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: 8 }}><Switch checked={credit} onChange={setCredit} /><span><b>Khách trả sau (ghi nợ toàn bộ)</b><div className="kv-hint">Thường dùng khi giao hàng thu hộ – tiền COD sẽ được thu vào hóa đơn khi giao xong.</div></span></div>}
      {due > 0 && !credit && (
        <>
          <PaymentFields method={pay.method} amount={payNow} fund={pay.fund} reference={pay.reference} max={due} amountLabel="Khách trả ngay" amountDisabled={!hasCustomer} showFund={false} onChange={(p) => setPay((s) => ({ ...s, ...p }))} />
          {hasCustomer && debt > 0 && <Alert type="info" showIcon style={{ marginTop: 8 }} message={<span>Phần còn lại <b className="neg">{money(debt)}</b> ghi nợ cho khách.</span>} />}
        </>
      )}
      {due > 0 && credit && <Alert type="info" showIcon message={<span>Ghi nợ <b>{money(due)}</b> cho {order.customer?.name}.</span>} />}
      {due <= 0 && <Alert type="success" showIcon message="Đơn đã được cọc đủ – hóa đơn sẽ ở trạng thái đã thanh toán." />}
    </Modal>
  );
}

/** Hủy đơn (BR-105): releases reservations; a deposit is refunded (voucher cancelled) or kept as customer credit. */
export function OrderCancelModal({ open, order, onClose }: { open: boolean; order: SalesOrder; onClose: () => void }) {
  const { message } = App.useApp();
  const qc = useQueryClient();
  const deposit = toNum(order.depositAmount);
  const [reason, setReason] = useState('');
  const [action, setAction] = useState<'REFUND' | 'CREDIT'>('REFUND');
  const [saving, setSaving] = useState(false);
  useEffect(() => { if (open) { setReason(''); setAction('REFUND'); } }, [open]);
  const activeDelivery = order.delivery && DELIVERY_ACTIVE.includes(order.delivery.status);
  const submit = async () => {
    if (!reason.trim()) { message.warning('Nhập lý do hủy'); return; }
    setSaving(true);
    try {
      await ordersApi.cancel(order.id, { reason: reason.trim(), depositAction: deposit > 0 ? action : undefined });
      message.success(`Đã hủy đơn ${order.code}${deposit > 0 ? (action === 'REFUND' ? ` · hoàn cọc ${money(deposit)}` : ` · giữ ${money(deposit)} làm số dư có`) : ''}`);
      invalidateOrders(qc); onClose();
    } catch (e) { message.error(orderErrMsg(e)); } finally { setSaving(false); }
  };
  return (
    <Modal title={`Hủy đơn ${order.code}?`} open={open} onCancel={onClose} onOk={submit} okText="Hủy đơn" okButtonProps={{ danger: true, disabled: !!activeDelivery }} cancelText="Bỏ qua" confirmLoading={saving} destroyOnClose>
      {activeDelivery && <Alert type="error" showIcon style={{ marginBottom: 10 }} message={`Vận đơn ${order.delivery!.code} đang giao`} description="Hủy vận đơn (mục Giao hàng) trước, sau đó hủy đơn." />}
      <div className="kv-hint" style={{ marginBottom: 8 }}>{order.status === 'CONFIRMED' ? 'Hàng đang giữ sẽ được trả lại tồn khả dụng. ' : ''}{order.delivery?.status === 'PENDING' ? `Vận đơn ${order.delivery.code} (chờ xử lý) bị hủy theo. ` : ''}</div>
      <div className="od-field"><div className="kv-hint">Lý do hủy *</div><Input.TextArea rows={2} value={reason} onChange={(e) => setReason(e.target.value)} maxLength={500} placeholder="Khách đổi ý, hết hàng…" autoFocus /></div>
      {deposit > 0 && (
        <div style={{ marginTop: 10 }}>
          <div className="kv-hint" style={{ marginBottom: 4 }}>Tiền cọc đã nhận <b>{money(deposit)}</b></div>
          <Radio.Group value={action} onChange={(e) => setAction(e.target.value)} style={{ display: 'grid', gap: 6 }}>
            <Radio value="REFUND"><b>Hoàn cọc</b><div className="kv-hint">Hủy phiếu thu cọc – tiền ra khỏi quỹ{order.customerId ? ', sổ công nợ ghi đảo' : ''}.</div></Radio>
            <Radio value="CREDIT" disabled={!order.customerId}><b>Giữ làm số dư có của khách</b><div className="kv-hint">{order.customerId ? 'Phiếu thu ở lại, khách dùng số dư cho lần mua sau hoặc hoàn sau bằng phiếu chi.' : 'Khách lẻ không có công nợ – phải hoàn cọc.'}</div></Radio>
          </Radio.Group>
        </div>
      )}
    </Modal>
  );
}

/** Small inline form for the fields a CONFIRMED order may still change (BR-101): note and expected date. */
export function OrderNoteModal({ open, order, onClose }: { open: boolean; order: SalesOrder; onClose: () => void }) {
  const { message } = App.useApp();
  const qc = useQueryClient();
  const [note, setNote] = useState(order.note ?? '');
  const [expected, setExpected] = useState<string>(order.expectedAt ? order.expectedAt.slice(0, 16) : '');
  const [saving, setSaving] = useState(false);
  useEffect(() => { if (open) { setNote(order.note ?? ''); setExpected(order.expectedAt ? new Date(order.expectedAt).toISOString().slice(0, 16) : ''); } }, [open, order.version]);
  const submit = async () => {
    setSaving(true);
    try { await ordersApi.update(order.id, { version: order.version, note: note.trim() || undefined, expectedAt: expected ? new Date(expected).toISOString() : null }); message.success('Đã cập nhật đơn'); invalidateOrders(qc); onClose(); }
    catch (e) { message.error(orderErrMsg(e)); if (normalizeError(e).code === 'VERSION_CONFLICT') qc.invalidateQueries({ queryKey: ['order', order.id] }); } finally { setSaving(false); }
  };
  return (
    <Modal title={`Ghi chú / hẹn giao – ${order.code}`} open={open} onCancel={onClose} onOk={submit} okText="Lưu" cancelText="Bỏ qua" confirmLoading={saving} destroyOnClose>
      <div className="od-field"><div className="kv-hint">Ngày hẹn giao / lấy hàng</div><Input type="datetime-local" value={expected} onChange={(e) => setExpected(e.target.value)} /></div>
      <div className="od-field"><div className="kv-hint">Ghi chú</div><Input.TextArea rows={3} value={note} onChange={(e) => setNote(e.target.value)} maxLength={1000} /></div>
      <div className="kv-hint">Đơn đã xác nhận đang giữ hàng: để đổi dòng hàng hãy “Hủy xác nhận” rồi sửa.</div>
    </Modal>
  );
}

// ---------------------------------------------------------------- read-only lines
export function OrderLinesView({ lines }: { lines: OrderLine[] }) {
  const isMobile = useIsMobile();
  if (isMobile) {
    return (
      <div className="od-lines">
        {lines.map((l) => (
          <div key={l.id} className="od-line">
            <div className="nm">{l.lineNo}. {l.variant.name}</div>
            <div className="meta"><span>{l.variant.sku}</span><span>ĐVT: {l.unitName ?? l.variant.product.baseUnit ?? '—'}</span>{l.batch && <span>Lô {l.batch.batchNo}</span>}{l.variant.product.type !== 'GOODS' && <Tag style={{ marginInlineEnd: 0 }}>{l.variant.product.type === 'SERVICE' ? 'Dịch vụ' : 'Combo'}</Tag>}</div>
            <div className="row"><span className="lbl">SL × Đơn giá</span><span>{qty(l.quantity)} × {money(l.unitPrice)}{toNum(l.listPrice) !== toNum(l.unitPrice) && <span className="muted" style={{ textDecoration: 'line-through', marginLeft: 4, fontSize: 12 }}>{money(l.listPrice)}</span>}</span></div>
            {toNum(l.discountAmount) > 0 && <div className="row"><span className="lbl">Giảm giá</span><span>− {money(l.discountAmount)}</span></div>}
            <div className="row"><span className="lbl">Thành tiền</span><b className="tot">{money(l.lineTotal)}</b></div>
            {l.note && <div className="meta">Ghi chú: {l.note}</div>}
          </div>
        ))}
      </div>
    );
  }
  return (
    <Table size="small" rowKey="id" pagination={false} dataSource={lines}
      columns={[
        { title: '#', dataIndex: 'lineNo', width: 40 },
        { title: 'Mã hàng', width: 120, render: (_, l) => l.variant.sku },
        { title: 'Tên hàng', render: (_, l) => <span>{l.variant.name}{l.batch ? <Tag style={{ marginLeft: 6 }}>Lô {l.batch.batchNo}</Tag> : null}{l.variant.product.type !== 'GOODS' && <Tag style={{ marginLeft: 6 }}>{l.variant.product.type === 'SERVICE' ? 'Dịch vụ' : 'Combo'}</Tag>}</span> },
        { title: 'ĐVT', width: 80, render: (_, l) => l.unitName ?? l.variant.product.baseUnit },
        { title: 'SL', dataIndex: 'quantity', className: 'num', width: 70, render: (v) => qty(v) },
        { title: 'Đơn giá', dataIndex: 'unitPrice', className: 'num', width: 120, render: (v, l) => <span>{money(v)}{toNum(l.listPrice) !== toNum(v) && <div className="muted" style={{ fontSize: 11, textDecoration: 'line-through' }}>{money(l.listPrice)}</div>}</span> },
        { title: 'Giảm giá', dataIndex: 'discountAmount', className: 'num', width: 100, render: (v) => (toNum(v) ? money(v) : '') },
        { title: 'Thành tiền', dataIndex: 'lineTotal', className: 'num', width: 120, render: (v) => <b>{money(v)}</b> },
        { title: 'Ghi chú', dataIndex: 'note' },
      ]} />
  );
}

/** Delivery chip for list rows: status + carrier. */
export function DeliveryChip({ d }: { d?: SalesOrder['delivery'] | null }) {
  if (!d) return <span className="muted">—</span>;
  return <Link to={`/deliveries?search=${d.code}`} onClick={(e) => e.stopPropagation()} className={`od-chip od-chip-${d.status}`}><CarOutlined /> {d.carrier || d.code}{d.trackingCode ? ` · ${d.trackingCode}` : ''}</Link>;
}

// ---------------------------------------------------------------- detail with actions
export function OrderDetail({ id, onDeleted }: { id: string; onDeleted?: () => void }) {
  const { data: o, isLoading, error } = useOrder(id);
  const can = useCan();
  const nav = useNavigate();
  const qc = useQueryClient();
  const { message, modal } = App.useApp();
  const [depositing, setDepositing] = useState(false);
  const [completing, setCompleting] = useState(false);
  const [cancelling, setCancelling] = useState(false);
  const [shipping, setShipping] = useState(false);
  const [noting, setNoting] = useState(false);
  const [busy, setBusy] = useState<string | null>(null);
  const sepayReady = useSepayReady();
  if (isLoading) return <div className="muted">Đang tải…</div>;
  if (error || !o) return <Alert type="error" showIcon message={error ? orderErrMsg(error) : 'Không tìm thấy đơn đặt hàng'} />;
  const due = toNum(o.dueAmount);
  const deposit = toNum(o.depositAmount);
  const names = lineNames(o.lines);
  const canComplete = can('order.complete') && can('invoice.create') && can('invoice.complete');
  const run = async (key: string, fn: () => Promise<unknown>, ok: string) => {
    setBusy(key);
    try { await fn(); message.success(ok); invalidateOrders(qc); }
    catch (e) { message.error(orderErrMsg(e, names)); if (normalizeError(e).code === 'VERSION_CONFLICT') qc.invalidateQueries({ queryKey: ['order', o.id] }); }
    finally { setBusy(null); }
  };
  const confirm = () => run('confirm', () => ordersApi.confirm(o.id, o.version), `Đã xác nhận ${o.code} – hàng đã được giữ`);
  const unconfirm = () => modal.confirm({ title: `Hủy xác nhận ${o.code}?`, content: 'Hàng đang giữ được trả lại tồn khả dụng; đơn trở về phiếu tạm và có thể sửa dòng hàng.', okText: 'Hủy xác nhận', cancelText: 'Bỏ qua', onOk: () => run('unconfirm', () => ordersApi.unconfirm(o.id), 'Đã hủy xác nhận – đơn về phiếu tạm') });
  const remove = () => modal.confirm({ title: `Xóa phiếu tạm ${o.code}?`, okText: 'Xóa', okButtonProps: { danger: true }, cancelText: 'Bỏ qua', onOk: async () => { try { await ordersApi.remove(o.id); message.success('Đã xóa phiếu tạm'); qc.removeQueries({ queryKey: ['order', o.id] }); invalidateOrders(qc); onDeleted?.(); } catch (e) { message.error(orderErrMsg(e)); } } });
  return (
    <div className="kv-expanded od-detail">
      <Descriptions size="small" column={{ xs: 1, md: 3 }} colon={false} labelStyle={{ color: '#6b7280' }}>
        <Descriptions.Item label="Mã đơn"><b className="od-code">{o.code}</b> <Tag color={ORDER_STATUS_COLOR[o.status]}>{ORDER_STATUS_LABEL[o.status]}</Tag>{ORDER_STATUS_HINT[o.status] && <span className="kv-hint od-code">({ORDER_STATUS_HINT[o.status]})</span>}</Descriptions.Item>
        <Descriptions.Item label="Nguồn">{ORDER_SOURCE_LABEL[o.source] ?? o.source}</Descriptions.Item>
        <Descriptions.Item label="Ngày đặt">{dt(o.orderDate)}</Descriptions.Item>
        <Descriptions.Item label="Khách hàng">{o.customer ? <Link to={`/customers?search=${o.customer.code}`}>{o.customer.name}{o.customer.phone ? ` · ${o.customer.phone}` : ''}</Link> : 'Khách lẻ'}</Descriptions.Item>
        <Descriptions.Item label="Chi nhánh / kho">{o.branch?.name}{o.warehouse ? ` · ${o.warehouse.name}` : ''}</Descriptions.Item>
        <Descriptions.Item label="Hẹn giao">{o.expectedAt ? dt(o.expectedAt) : '—'}</Descriptions.Item>
        <Descriptions.Item label="Hóa đơn">{o.invoice ? <Link to={`/invoices?search=${o.invoice.code}`}><FileTextOutlined /> {o.invoice.code}</Link> : <span className="muted">Chưa lập</span>}</Descriptions.Item>
        <Descriptions.Item label="Vận đơn">{o.delivery ? <Link to={`/deliveries?search=${o.delivery.code}`}><CarOutlined /> {o.delivery.code}</Link> : <span className="muted">Không</span>}</Descriptions.Item>
        <Descriptions.Item label="Ghi chú">{o.note || '—'}</Descriptions.Item>
        {o.confirmedAt && <Descriptions.Item label="Xác nhận lúc">{dt(o.confirmedAt)}</Descriptions.Item>}
        {o.completedAt && <Descriptions.Item label="Hoàn tất lúc">{dt(o.completedAt)}</Descriptions.Item>}
        {o.cancelledAt && <Descriptions.Item label="Đã hủy">{dt(o.cancelledAt)} · {o.cancelReason}</Descriptions.Item>}
      </Descriptions>
      <div style={{ marginTop: 8 }}><OrderLinesView lines={o.lines ?? []} /></div>
      <div className="od-detail-grid">
        {(o.deposits?.length ?? 0) > 0 && (
          <div className="od-block">
            <div className="od-block-title"><DollarOutlined /> Tiền cọc</div>
            {o.deposits!.map((a) => <div key={a.id} className="od-row"><span><Link to={`/payments?search=${a.payment.code}`}>{a.payment.code}</Link> <span className="muted">· {PAYMENT_METHOD_LABEL[a.payment.method] ?? a.payment.method} · {dt(a.payment.paymentDate)}</span>{a.payment.reference && <span className="muted"> · {a.payment.reference}</span>}</span><b>{money(a.amount)}</b></div>)}
          </div>
        )}
        {o.delivery && <div className="od-block"><DeliverySummary d={o.delivery} /></div>}
        <div className="od-settle od-totals">
          <span className="k">Tiền hàng</span><span className="v">{money(o.subtotal)}</span>
          {toNum(o.discountAmount) > 0 && <><span className="k">Giảm giá đơn</span><span className="v">− {money(o.discountAmount)}</span></>}
          {toNum(o.taxAmount) > 0 && <><span className="k">Thuế</span><span className="v">{money(o.taxAmount)}</span></>}
          <span className="k">Tổng đơn</span><span className="v big">{money(o.totalAmount)}</span>
          <span className="k">Đã cọc</span><span className="v">{money(deposit)}</span>
          {o.status !== 'COMPLETED' && o.status !== 'CANCELLED' && <><span className="k">Còn phải thu</span><span className={`v${due > 0 ? ' neg' : ' pos'}`}>{money(due)}</span></>}
          {o.status === 'COMPLETED' && o.invoice && <><span className="k">Hóa đơn còn nợ</span><span className={`v${toNum(o.invoice.totalAmount) - toNum(o.invoice.paidAmount) > 0 ? ' neg' : ''}`}>{money(toNum(o.invoice.totalAmount) - toNum(o.invoice.paidAmount))}</span></>}
        </div>
      </div>
      <div className="kv-detail-actions od-dactions">
        {o.invoice && <Button icon={<FileTextOutlined />} onClick={() => nav(`/invoices?search=${o.invoice!.code}`)}>Hóa đơn</Button>}
        {o.delivery && <Button icon={<CarOutlined />} onClick={() => nav(`/deliveries?search=${o.delivery!.code}`)}>Vận đơn</Button>}
        {o.status === 'DRAFT' && can('order.create') && <Button icon={<EditOutlined />} onClick={() => nav(`/orders/${o.id}`)}>Sửa</Button>}
        {o.status === 'DRAFT' && can('order.create') && deposit <= 0 && <Button danger icon={<DeleteOutlined />} onClick={remove}>Xóa</Button>}
        {o.status === 'CONFIRMED' && can('order.create') && <Button icon={<EditOutlined />} onClick={() => setNoting(true)}>Ghi chú / hẹn giao</Button>}
        {(o.status === 'DRAFT' || o.status === 'CONFIRMED') && can('order.create') && due > 0 && <Button icon={<DollarOutlined />} onClick={() => setDepositing(true)}>Nhận cọc</Button>}
        {can('payment.create') && sepayReady && <DocumentQrButton purpose="SALES_ORDER" documentId={o.id} documentCode={o.code} due={due} customerName={o.customer?.name} editableAmount refreshKeys={ORDER_KEYS} showButton={(o.status === 'DRAFT' || o.status === 'CONFIRMED') && due > 0} />}
        {(o.status === 'DRAFT' || o.status === 'CONFIRMED') && !o.delivery && can('delivery.manage') && <Button icon={<CarOutlined />} onClick={() => setShipping(true)}>Tạo vận đơn</Button>}
        {o.status === 'CONFIRMED' && can('order.confirm') && <Button icon={<RollbackOutlined />} loading={busy === 'unconfirm'} onClick={unconfirm}>Hủy xác nhận</Button>}
        {(o.status === 'DRAFT' || o.status === 'CONFIRMED') && can('order.cancel') && (o.status === 'CONFIRMED' || deposit > 0) && <Button danger icon={<StopOutlined />} onClick={() => setCancelling(true)}>Hủy đơn</Button>}
        {o.status === 'DRAFT' && can('order.confirm') && <Button type="primary" icon={<CheckOutlined />} loading={busy === 'confirm'} onClick={confirm}>Xác nhận (giữ hàng)</Button>}
        {o.status === 'CONFIRMED' && canComplete && <Button type="primary" icon={<CheckCircleOutlined />} onClick={() => setCompleting(true)}>Hoàn tất → hóa đơn</Button>}
      </div>
      <OrderDepositModal open={depositing} order={o} onClose={() => setDepositing(false)} />
      <OrderCompleteModal open={completing} order={o} onClose={() => setCompleting(false)} />
      <OrderCancelModal open={cancelling} order={o} onClose={() => setCancelling(false)} />
      <OrderNoteModal open={noting} order={o} onClose={() => setNoting(false)} />
      <DeliveryFormModal open={shipping} orderId={o.id} due={due} prefill={{ receiverName: o.customer?.name ?? '', receiverPhone: o.customer?.phone ?? '', address: o.customer?.address ?? '' }} onClose={() => setShipping(false)} />
    </div>
  );
}
