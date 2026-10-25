import { Alert, App, Button, Descriptions, Input, Modal, Select, Switch, Tag } from 'antd';
import Table from '../../components/ResponsiveTable';
import { CheckOutlined, DeleteOutlined, DollarOutlined, EditOutlined, FileTextOutlined, StopOutlined, SwapOutlined } from '@ant-design/icons';
import { useEffect, useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { useQueryClient } from '@tanstack/react-query';
import { RefundInput, SALES_KEYS, salesApi, useSalesReturn } from '../../api/sales';
import { normalizeError } from '../../api/client';
import type { SalesReturn, SalesReturnLine } from '../../api/types';
import { MoneyInput } from '../../components/Inputs';
import { useIsMobile } from '../../hooks/useMedia';
import { useCan } from '../../store/auth';
import { MOVEMENT_LABEL, PAYMENT_METHOD_LABEL, dt, money, qty, signedQty, toNum } from '../../utils/format';

export const RETURN_STATUS_LABEL: Record<string, string> = { DRAFT: 'Phiếu tạm', COMPLETED: 'Hoàn thành', CANCELLED: 'Đã hủy' };
export const RETURN_STATUS_COLOR: Record<string, string> = { DRAFT: 'gold', COMPLETED: 'green', CANCELLED: 'red' };
export const CONDITION_LABEL: Record<string, string> = { RESTOCK: 'Nhập lại kho', DAMAGED: 'Hàng hỏng' };
export const CONDITION_COLOR: Record<string, string> = { RESTOCK: 'green', DAMAGED: 'volcano' };
export const METHOD_LABEL: Record<string, string> = { ...PAYMENT_METHOD_LABEL, OFFSET: 'Cấn trừ đổi hàng' };
export const METHOD_OPTIONS = Object.entries(PAYMENT_METHOD_LABEL).map(([value, label]) => ({ value, label }));

/** Friendly hints for the Module 07 error codes (appended to the server message). */
export function returnErrMsg(e: unknown): string {
  const err = normalizeError(e);
  const d = (err.details ?? {}) as Record<string, any>;
  const hints: Record<string, string> = {
    RETURN_QUANTITY_EXCEEDED: d.returnable !== undefined ? `Còn có thể trả ${qty(d.returnable)}, bạn nhập ${qty(d.requested)}. Hãy giảm số lượng.` : 'Giảm số lượng trả của dòng vượt mức.',
    RETURN_AMOUNT_EXCEEDED: d.invoiceTotal !== undefined ? `Hóa đơn ${money(d.invoiceTotal)}, đã trả ${money(d.alreadyReturned)}, phiếu này ${money(d.requested)}.` : 'Tổng tiền hoàn của các phiếu trả không được vượt giá trị hóa đơn.',
    OVERPAYMENT: d.totalRefund !== undefined ? `Tối đa ${money(d.totalRefund)}.` : d.remainder !== undefined ? `Phần chênh lệch chỉ còn ${money(d.remainder)}.` : 'Giảm số tiền hoàn.',
    SHIFT_REQUIRED: 'Mở ca bán hàng (màn hình Bán hàng → Mở ca) rồi thao tác lại.',
    RETURN_WINDOW_EXPIRED: 'Hóa đơn đã quá thời hạn trả hàng theo cấu hình cửa hàng.',
    RETURN_LINKED_EXCHANGE: 'Hủy hóa đơn đổi hàng trước, sau đó hủy phiếu trả này.',
    INVOICE_HAS_RETURNS: 'Hủy các phiếu trả hàng của hóa đơn trước khi hủy hóa đơn.',
    VERSION_CONFLICT: 'Dữ liệu đã được tải lại, kiểm tra rồi thao tác lại.',
    PAYMENT_IS_OFFSET: 'Phiếu cấn trừ do hệ thống tạo khi đổi hàng, không hủy riêng được.',
    PAYMENT_SHARED: 'Phiếu chi hoàn tiền còn phân bổ cho chứng từ khác, hủy phiếu chi trước.',
    DOCUMENT_NOT_POSTED: 'Chỉ trả hàng cho hóa đơn đã hoàn thành.',
    INSUFFICIENT_STOCK: d.available !== undefined || d.onHand !== undefined ? `Tồn khả dụng ${qty(d.available ?? d.onHand)}, cần ${qty(d.requested)}.` : 'Hàng đổi không đủ tồn kho.',
  };
  const hint = hints[err.code];
  return hint ? `${err.message} – ${hint}` : err.message;
}

/**
 * "Hoàn thành phiếu trả" confirmation: refund now (phiếu chi) or, for a customer invoice, keep the amount as customer credit.
 * Walk-in invoices must be refunded in full (BR-64).
 */
export function ReturnCompleteModal({ open, total, code, hasCustomer, customerName, loading, onClose, onConfirm }: { open: boolean; total: number; code?: string; hasCustomer: boolean; customerName?: string | null; loading?: boolean; onClose: () => void; onConfirm: (refund?: RefundInput) => Promise<void> | void }) {
  const [credit, setCredit] = useState(false);
  const [method, setMethod] = useState('CASH');
  const [amount, setAmount] = useState(0);
  const [reference, setReference] = useState('');
  const [busy, setBusy] = useState(false);
  useEffect(() => { if (open) { setCredit(false); setMethod('CASH'); setAmount(total); setReference(''); } }, [open, total]);
  const refundAmount = credit ? 0 : hasCustomer ? Math.min(amount, total) : total;
  const creditAmount = Math.max(0, total - refundAmount);
  const ok = async () => {
    setBusy(true);
    try { await onConfirm(refundAmount > 0 ? { method, amount: String(refundAmount), reference: reference.trim() || undefined } : undefined); } finally { setBusy(false); }
  };
  return (
    <Modal title={code ? `Hoàn thành phiếu trả hàng ${code}` : 'Hoàn thành phiếu trả hàng'} open={open} onCancel={onClose} onOk={ok} okText="Hoàn thành" cancelText="Bỏ qua" confirmLoading={busy || loading} destroyOnClose>
      <p className="kv-hint" style={{ marginTop: 0 }}>Hàng “nhập lại kho” sẽ được cộng tồn theo giá vốn lúc bán; hàng hỏng ghi nhận lỗ. {hasCustomer ? 'Khách có hồ sơ: có thể hoàn tiền ngay hoặc ghi có công nợ.' : 'Khách lẻ không có công nợ nên phải hoàn đủ tiền ngay.'}</p>
      <div className="sr-settle" style={{ marginBottom: 10 }}>
        <span className="k">Khách hàng</span><span className="v">{hasCustomer ? customerName ?? 'Khách có hồ sơ' : 'Khách lẻ'}</span>
        <span className="k">Tiền hoàn của phiếu</span><span className="v big">{money(total)}</span>
      </div>
      {hasCustomer && (
        <div className="sr-field" style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
          <Switch checked={credit} onChange={setCredit} /><span><b>Ghi có công nợ, không hoàn tiền</b><div className="kv-hint">Khách giữ số dư {money(total)} để trừ vào hóa đơn sau hoặc hoàn sau bằng phiếu chi.</div></span>
        </div>
      )}
      {!credit && (
        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 8 }}>
          <div><div className="kv-hint">Số tiền hoàn ngay</div><MoneyInput value={refundAmount} max={total} disabled={!hasCustomer} onChange={(v) => setAmount(Math.min(toNum(v), total))} /></div>
          <div><div className="kv-hint">Phương thức</div><Select style={{ width: '100%' }} value={method} onChange={setMethod} options={METHOD_OPTIONS} /></div>
          <div style={{ gridColumn: '1 / span 2' }}><div className="kv-hint">Tham chiếu (số UNC, mã GD…)</div><Input value={reference} onChange={(e) => setReference(e.target.value)} /></div>
        </div>
      )}
      {hasCustomer && creditAmount > 0 && <Alert type="info" showIcon style={{ marginTop: 10 }} message={<span>Ghi có công nợ khách: <b>{money(creditAmount)}</b>{refundAmount > 0 ? ` (hoàn ngay ${money(refundAmount)})` : ''}</span>} />}
      {!hasCustomer && <div className="kv-hint" style={{ marginTop: 8 }}>Khách lẻ: hoàn đủ <b>{money(total)}</b>. Cần có ca bán hàng đang mở.</div>}
    </Modal>
  );
}

/** Pay the remaining refund of a COMPLETED return (dueRefund &gt; 0) with a new phiếu chi allocated to the return. */
export function RemainingRefundModal({ open, ret, onClose, onSaved }: { open: boolean; ret: SalesReturn; onClose: () => void; onSaved?: () => void }) {
  const { message } = App.useApp();
  const qc = useQueryClient();
  const due = toNum(ret.dueRefund);
  const [method, setMethod] = useState('CASH');
  const [amount, setAmount] = useState(due);
  const [reference, setReference] = useState('');
  const [saving, setSaving] = useState(false);
  useEffect(() => { if (open) { setMethod('CASH'); setAmount(due); setReference(''); } }, [open, due]);
  const submit = async () => {
    const a = ret.customerId ? Math.min(amount, due) : due;
    if (!(a > 0)) { message.warning('Nhập số tiền hoàn'); return; }
    setSaving(true);
    try {
      const p = await salesApi.refundReturn({ branchId: ret.branchId, method, amount: String(a), reference: reference.trim() || undefined, note: `Hoàn tiền trả hàng ${ret.code}`, partyId: ret.customerId, returnId: ret.id });
      message.success(`Đã lập phiếu chi ${p.code} hoàn ${money(a)}`);
      SALES_KEYS.forEach((k) => qc.invalidateQueries({ queryKey: [k] }));
      onSaved?.(); onClose();
    } catch (e) { message.error(returnErrMsg(e)); } finally { setSaving(false); }
  };
  return (
    <Modal title={`Hoàn tiền còn lại – ${ret.code}`} open={open} onCancel={onClose} onOk={submit} okText="Lập phiếu chi" cancelText="Bỏ qua" confirmLoading={saving} destroyOnClose>
      <div className="sr-settle" style={{ marginBottom: 10 }}>
        <span className="k">Khách hàng</span><span className="v">{ret.customer?.name ?? 'Khách lẻ'}</span>
        <span className="k">Tiền hoàn của phiếu</span><span className="v">{money(ret.totalRefund)}</span>
        <span className="k">Đã hoàn</span><span className="v">{money(ret.refundedAmount)}</span>
        <span className="k">Còn phải hoàn</span><span className="v big neg">{money(due)}</span>
      </div>
      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 8 }}>
        <div><div className="kv-hint">Số tiền hoàn</div><MoneyInput value={ret.customerId ? amount : due} max={due} disabled={!ret.customerId} onChange={(v) => setAmount(Math.min(toNum(v), due))} /></div>
        <div><div className="kv-hint">Phương thức</div><Select style={{ width: '100%' }} value={method} onChange={setMethod} options={METHOD_OPTIONS} /></div>
        <div style={{ gridColumn: '1 / span 2' }}><div className="kv-hint">Tham chiếu</div><Input value={reference} onChange={(e) => setReference(e.target.value)} /></div>
      </div>
      <div className="kv-hint" style={{ marginTop: 8 }}>Phiếu chi được phân bổ vào phiếu trả này{ret.customerId ? ' và trừ vào số dư có của khách.' : '.'} Cần có ca bán hàng đang mở nếu cửa hàng yêu cầu ca.</div>
    </Modal>
  );
}

/** Read-only return lines: cards on phones, table on desktop. */
export function ReturnLinesView({ lines, canCost }: { lines: SalesReturnLine[]; canCost?: boolean }) {
  const isMobile = useIsMobile();
  if (isMobile) {
    return (
      <div className="sr-lines">
        {lines.map((l) => (
          <div key={l.id} className="sr-line">
            <div className="nm">{l.lineNo}. {l.variant.name}</div>
            <div className="meta"><span>{l.variant.sku}</span><span>ĐVT: {l.unitName ?? l.variant.product.baseUnit ?? '—'}</span>{l.invoiceLine && <span>Đã mua: {qty(l.invoiceLine.quantity)}</span>}<Tag color={CONDITION_COLOR[l.condition]} style={{ marginInlineEnd: 0 }}>{CONDITION_LABEL[l.condition]}</Tag></div>
            <div className="row"><span className="lbl">SL trả</span><b>{qty(l.quantity)}</b></div>
            <div className="row"><span className="lbl">Giá hoàn</span><span>{money(l.unitPrice)}</span></div>
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
        { title: 'Tên hàng', render: (_, l) => l.variant.name },
        { title: 'ĐVT', width: 70, render: (_, l) => l.unitName ?? l.variant.product.baseUnit },
        { title: 'Đã mua', className: 'num', width: 80, render: (_, l) => l.invoiceLine ? qty(l.invoiceLine.quantity) : '' },
        { title: 'SL trả', dataIndex: 'quantity', className: 'num', width: 80, render: (v) => <b>{qty(v)}</b> },
        { title: 'Tình trạng', dataIndex: 'condition', width: 120, render: (v) => <Tag color={CONDITION_COLOR[v]}>{CONDITION_LABEL[v]}</Tag> },
        { title: 'Giá hoàn', dataIndex: 'unitPrice', className: 'num', width: 110, render: (v) => money(v) },
        { title: 'Thành tiền', dataIndex: 'lineTotal', className: 'num', width: 120, render: (v) => <b>{money(v)}</b> },
        ...(canCost ? [{ title: 'Giá vốn', className: 'num', width: 110, render: (_: unknown, l: SalesReturnLine) => l.costTotal !== undefined ? money(l.costTotal) : '' }] : []),
        { title: 'Ghi chú', dataIndex: 'note' },
      ]} />
  );
}

/** Expandable / standalone detail of one sales return with the status-dependent actions. */
export function SalesReturnDetail({ id, onDeleted }: { id: string; onDeleted?: () => void }) {
  const { data: r, isLoading, error } = useSalesReturn(id);
  const can = useCan();
  const nav = useNavigate();
  const qc = useQueryClient();
  const { message, modal } = App.useApp();
  const [completing, setCompleting] = useState(false);
  const [refunding, setRefunding] = useState(false);
  const [busy, setBusy] = useState(false);
  if (isLoading) return <div className="muted">Đang tải…</div>;
  if (error || !r) return <Alert type="error" showIcon message={error ? returnErrMsg(error) : 'Không tìm thấy phiếu trả hàng'} />;
  const refresh = () => SALES_KEYS.forEach((k) => qc.invalidateQueries({ queryKey: [k] }));
  const due = toNum(r.dueRefund);
  const canCost = r.movements !== undefined;
  const complete = async (refund?: RefundInput) => {
    setBusy(true);
    try { const done = await salesApi.completeReturn(r.id, { version: r.version, refund }); message.success(`Đã hoàn thành phiếu trả ${done.code}`); setCompleting(false); refresh(); }
    catch (e) { message.error(returnErrMsg(e)); if (normalizeError(e).code === 'VERSION_CONFLICT') qc.invalidateQueries({ queryKey: ['sales-return', r.id] }); }
    finally { setBusy(false); }
  };
  const cancel = () => {
    let reason = '';
    modal.confirm({
      title: `Hủy phiếu trả hàng ${r.code}?`, okText: 'Hủy phiếu', okButtonProps: { danger: true }, cancelText: 'Bỏ qua',
      content: <div><div className="kv-hint" style={{ marginBottom: 6 }}>Hàng đã nhập lại sẽ được xuất kho trở lại, công nợ ghi đảo và phiếu chi hoàn tiền (nếu có) bị hủy theo. Phiếu thuộc giao dịch đổi hàng chỉ hủy được sau khi hủy hóa đơn đổi.</div><Input.TextArea placeholder="Lý do hủy (bắt buộc)" onChange={(e) => (reason = e.target.value)} /></div>,
      onOk: async () => { if (!reason.trim()) { message.warning('Nhập lý do hủy'); throw new Error('reason'); } try { await salesApi.cancelReturn(r.id, reason.trim()); message.success('Đã hủy phiếu trả hàng'); refresh(); } catch (e) { message.error(returnErrMsg(e)); throw e; } },
    });
  };
  const remove = () => modal.confirm({ title: `Xóa phiếu tạm ${r.code}?`, okText: 'Xóa', okButtonProps: { danger: true }, cancelText: 'Bỏ qua', onOk: async () => { try { await salesApi.deleteReturn(r.id); message.success('Đã xóa phiếu tạm'); qc.removeQueries({ queryKey: ['sales-return', r.id] }); qc.invalidateQueries({ queryKey: ['sales-returns'] }); onDeleted?.(); } catch (e) { message.error(returnErrMsg(e)); } } });
  return (
    <div className="kv-expanded sr-detail">
      <Descriptions className="sr-desc" size="small" column={{ xs: 1, md: 3 }} colon={false} labelStyle={{ color: '#6b7280' }}>
        <Descriptions.Item label="Mã phiếu"><b>{r.code}</b> <Tag color={RETURN_STATUS_COLOR[r.status]}>{RETURN_STATUS_LABEL[r.status]}</Tag></Descriptions.Item>
        <Descriptions.Item label="Hóa đơn gốc">{r.invoice ? <Link to={`/invoices?search=${r.invoice.code}`}>{r.invoice.code}</Link> : '—'}</Descriptions.Item>
        <Descriptions.Item label="Hóa đơn đổi">{r.exchangeInvoice ? <Link to={`/invoices?search=${r.exchangeInvoice.code}`}><SwapOutlined /> {r.exchangeInvoice.code}</Link> : <span className="muted">Không (chỉ trả hàng)</span>}</Descriptions.Item>
        <Descriptions.Item label="Khách hàng">{r.customer ? <Link to={`/customers?search=${r.customer.code}`}>{r.customer.name}{r.customer.phone ? ` · ${r.customer.phone}` : ''}</Link> : 'Khách lẻ'}</Descriptions.Item>
        <Descriptions.Item label="Chi nhánh / kho">{r.branch?.name}{r.warehouse ? ` · ${r.warehouse.name}` : ''}</Descriptions.Item>
        <Descriptions.Item label="Ngày trả">{dt(r.returnDate)}</Descriptions.Item>
        <Descriptions.Item label="Lý do">{r.reason || '—'}</Descriptions.Item>
        <Descriptions.Item label="Ghi chú">{r.note || '—'}</Descriptions.Item>
        {r.completedAt && <Descriptions.Item label="Hoàn thành lúc">{dt(r.completedAt)}</Descriptions.Item>}
        {r.cancelledAt && <Descriptions.Item label="Đã hủy">{dt(r.cancelledAt)} · {r.cancelReason}</Descriptions.Item>}
      </Descriptions>
      <div style={{ marginTop: 8 }}><ReturnLinesView lines={r.lines ?? []} canCost={canCost} /></div>
      <div style={{ display: 'flex', justifyContent: 'flex-end', marginTop: 8 }}>
        <div className="sr-settle" style={{ minWidth: 'min(100%, 320px)' }}>
          <span className="k">Giá trị hàng trả</span><span className="v">{money(r.subtotal)}</span>
          {toNum(r.feeAmount) > 0 && <><span className="k">Phí trả hàng</span><span className="v">− {money(r.feeAmount)}</span></>}
          <span className="k">Tiền hoàn khách</span><span className="v big">{money(r.totalRefund)}</span>
          <span className="k">Đã hoàn / cấn trừ</span><span className="v">{money(r.refundedAmount)}</span>
          {r.status === 'COMPLETED' && <><span className="k">{r.customerId ? 'Còn lại (ghi có công nợ)' : 'Còn phải hoàn'}</span><span className={`v${due > 0 ? ' neg' : ''}`}>{money(due)}</span></>}
          {r.restockValue !== undefined && r.status !== 'DRAFT' && <><span className="hr" /><span className="k">Giá vốn nhập lại</span><span className="v">{money(r.restockValue)}</span><span className="k">Lỗ hàng hỏng</span><span className="v">{money(r.damagedValue)}</span></>}
        </div>
      </div>
      {(r.refunds?.length ?? 0) > 0 && (
        <Table size="small" rowKey="id" pagination={false} dataSource={r.refunds} style={{ marginTop: 8 }} title={() => <b>Phiếu chi hoàn tiền / cấn trừ</b>}
          columns={[{ title: 'Phiếu chi', render: (_, a) => <Link to={`/payments?search=${a.payment.code}`}>{a.payment.code}</Link> }, { title: 'Thời gian', render: (_, a) => dt(a.payment.paymentDate) }, { title: 'Phương thức', render: (_, a) => METHOD_LABEL[a.payment.method] ?? a.payment.method }, { title: 'Tham chiếu', render: (_, a) => a.payment.reference }, { title: 'Số tiền', dataIndex: 'amount', className: 'num', render: (v) => <b>{money(v)}</b> }]} />
      )}
      {(r.movements?.length ?? 0) > 0 && (
        <Table size="small" rowKey="id" pagination={false} dataSource={r.movements} style={{ marginTop: 8 }} title={() => <b>Bút toán kho</b>}
          columns={[{ title: 'Thời gian', dataIndex: 'createdAt', render: (v) => dt(v, 'DD/MM/YYYY HH:mm:ss') }, { title: 'Loại', dataIndex: 'type', render: (v) => <Tag color={v === 'REVERSAL' ? 'red' : 'green'}>{MOVEMENT_LABEL[v] ?? v}</Tag> }, { title: 'Hàng hóa', render: (_, m) => r.lines?.find((l) => l.variantId === m.variantId)?.variant.sku ?? m.variantId }, { title: 'SL', dataIndex: 'quantity', className: 'num', render: (v) => <span className={Number(v) >= 0 ? 'pos' : 'neg'}>{signedQty(v)}</span> }, { title: 'Giá vốn', dataIndex: 'unitCost', className: 'num', render: (v) => money(v) }, { title: 'Tồn sau', dataIndex: 'balanceAfter', className: 'num', render: (v) => qty(v) }]} />
      )}
      <div className="kv-detail-actions">
        {r.invoice && <Button icon={<FileTextOutlined />} onClick={() => nav(`/invoices?search=${r.invoice!.code}`)}>Hóa đơn gốc</Button>}
        {r.exchangeInvoice && <Button icon={<SwapOutlined />} onClick={() => nav(`/invoices?search=${r.exchangeInvoice!.code}`)}>Hóa đơn đổi</Button>}
        {r.status === 'DRAFT' && can('return.create') && <Button icon={<EditOutlined />} onClick={() => nav(`/sales-returns/${r.id}`)}>Sửa</Button>}
        {r.status === 'DRAFT' && can('return.create') && <Button danger icon={<DeleteOutlined />} onClick={remove}>Xóa</Button>}
        {r.status === 'DRAFT' && can('return.complete') && <Button type="primary" icon={<CheckOutlined />} onClick={() => setCompleting(true)}>Hoàn thành</Button>}
        {r.status === 'COMPLETED' && due > 0 && can('payment.create') && <Button type="primary" icon={<DollarOutlined />} onClick={() => setRefunding(true)}>Hoàn tiền còn lại {money(due)}</Button>}
        {r.status === 'COMPLETED' && can('return.cancel') && <Button danger icon={<StopOutlined />} onClick={cancel}>Hủy phiếu</Button>}
      </div>
      <ReturnCompleteModal open={completing} total={toNum(r.totalRefund)} code={r.code} hasCustomer={!!r.customerId} customerName={r.customer?.name} loading={busy} onClose={() => setCompleting(false)} onConfirm={complete} />
      <RemainingRefundModal open={refunding} ret={r} onClose={() => setRefunding(false)} />
    </div>
  );
}
