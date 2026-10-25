import { App, Button, Descriptions, Drawer, Empty, Modal, Tag } from 'antd';
import Table from '../../components/ResponsiveTable';
import { PrinterOutlined } from '@ant-design/icons';
import { useEffect, useRef, useState } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import { SALES_KEYS, salesApi, useInvoices, useShift } from '../../api/sales';
import { errMsg } from '../../api/client';
import type { Invoice, Shift } from '../../api/types';
import { MoneyInput } from '../../components/Inputs';
import { useAuthStore } from '../../store/auth';
import { PAYMENT_METHOD_LABEL, dt, money, toNum } from '../../utils/format';
import { printHtml, receiptHtml } from './receipt';

export function ShiftOpenModal({ open, branchId, onClose, onOpened }: { open: boolean; branchId?: string | null; onClose: () => void; onOpened: (s: Shift) => void }) {
  const { message } = App.useApp();
  const qc = useQueryClient();
  const [cash, setCash] = useState(0);
  const [saving, setSaving] = useState(false);
  const inputRef = useRef<any>(null);
  useEffect(() => { if (open) setCash(0); }, [open]);
  const submit = async () => {
    if (!branchId) { message.warning('Chọn chi nhánh'); return; }
    setSaving(true);
    try {
      const s = await salesApi.openShift({ branchId, openingCash: String(cash) });
      message.success(`Đã mở ca ${s.code}`);
      ['shift-current', 'shifts'].forEach((k) => qc.invalidateQueries({ queryKey: [k] }));
      onOpened(s); onClose();
    } catch (e) { message.error(errMsg(e)); } finally { setSaving(false); }
  };
  return (
    <Modal title="Mở ca bán hàng" open={open} onCancel={onClose} onOk={submit} okText="Mở ca" cancelText="Bỏ qua" confirmLoading={saving} destroyOnClose afterOpenChange={(v) => { if (v) setTimeout(() => inputRef.current?.focus?.(), 50); }}>
      <div className="kv-hint" style={{ marginBottom: 4 }}>Tiền mặt đầu ca (tiền trong két lúc bắt đầu)</div>
      <MoneyInput ref={inputRef} autoFocus size="large" value={cash} onChange={(v) => setCash(toNum(v))} onPressEnter={submit} />
    </Modal>
  );
}

/** Close-shift modal with the reconciliation summary (expected cash, by method) and the counted amount. */
export function ShiftCloseModal({ open, shiftId, onClose, onClosed }: { open: boolean; shiftId?: string; onClose: () => void; onClosed?: (s: Shift) => void }) {
  const { message } = App.useApp();
  const qc = useQueryClient();
  const { data: s, isLoading } = useShift(open ? shiftId : undefined);
  const [counted, setCounted] = useState<number | null>(null);
  const [note, setNote] = useState('');
  const [saving, setSaving] = useState(false);
  useEffect(() => { if (open) { setCounted(null); setNote(''); } }, [open, shiftId]);
  const expected = toNum(s?.expectedCash);
  const diff = counted === null ? null : counted - expected;
  const submit = async () => {
    if (!shiftId || counted === null) { message.warning('Nhập số tiền mặt đếm được'); return; }
    setSaving(true);
    try {
      const closed = await salesApi.closeShift(shiftId, { countedCash: String(counted), note: note || undefined });
      message.success(`Đã đóng ca ${closed.code} · chênh lệch ${money(closed.difference)}`);
      SALES_KEYS.forEach((k) => qc.invalidateQueries({ queryKey: [k] }));
      onClosed?.(closed); onClose();
    } catch (e) { message.error(errMsg(e)); } finally { setSaving(false); }
  };
  return (
    <Modal title={`Đóng ca ${s?.code ?? ''}`} open={open} onCancel={onClose} onOk={submit} okText="Đóng ca" okButtonProps={{ danger: true, disabled: !s || s.status !== 'OPEN' }} cancelText="Bỏ qua" confirmLoading={saving} destroyOnClose width={560}>
      {isLoading || !s ? <div className="muted">Đang tải…</div> : (
        <>
          <Descriptions size="small" column={2} colon={false} labelStyle={{ color: '#6b7280' }}>
            <Descriptions.Item label="Nhân viên">{s.user?.fullName}</Descriptions.Item>
            <Descriptions.Item label="Mở lúc">{dt(s.openedAt)}</Descriptions.Item>
            <Descriptions.Item label="Số hóa đơn">{s.invoices ?? 0}</Descriptions.Item>
            <Descriptions.Item label="Doanh thu">{money(s.revenue)}</Descriptions.Item>
            <Descriptions.Item label="Tiền đầu ca">{money(s.openingCash)}</Descriptions.Item>
            <Descriptions.Item label="Tiền mặt dự kiến"><b>{money(expected)}</b></Descriptions.Item>
          </Descriptions>
          <Table size="small" rowKey="method" pagination={false} dataSource={s.byMethod ?? []} style={{ margin: '8px 0' }} locale={{ emptyText: 'Chưa có thu / chi trong ca' }}
            columns={[{ title: 'Phương thức', dataIndex: 'method', render: (v) => PAYMENT_METHOD_LABEL[v] ?? v }, { title: 'Thu', dataIndex: 'in', className: 'num', render: (v) => money(v) }, { title: 'Chi', dataIndex: 'out', className: 'num', render: (v) => money(v) }, { title: 'Ròng', dataIndex: 'net', className: 'num', render: (v) => <b>{money(v)}</b> }]} />
          <div className="kv-hint" style={{ marginBottom: 4 }}>Tiền mặt thực đếm trong két</div>
          <MoneyInput autoFocus size="large" value={counted ?? undefined} placeholder={money(expected)} onChange={(v) => setCounted(v === null || v === undefined ? null : toNum(v))} />
          {diff !== null && <div style={{ marginTop: 6 }}>Chênh lệch: <b className={diff < 0 ? 'neg' : diff > 0 ? 'pos' : ''}>{diff > 0 ? '+' : ''}{money(diff)}</b></div>}
          <div className="kv-hint" style={{ margin: '8px 0 4px' }}>Ghi chú</div>
          <input className="ant-input" style={{ width: '100%' }} value={note} onChange={(e) => setNote(e.target.value)} placeholder="Lý do chênh lệch, bàn giao…" />
        </>
      )}
    </Modal>
  );
}

/** Drawer listing server-side held orders (DRAFT invoices) of the branch. */
export function HeldOrdersDrawer({ open, branchId, onClose, onReopen }: { open: boolean; branchId?: string | null; onClose: () => void; onReopen: (inv: Invoice) => void }) {
  const { message, modal } = App.useApp();
  const qc = useQueryClient();
  const { data, isLoading } = useInvoices({ status: 'DRAFT', branchId: branchId ?? undefined, pageSize: 50 }, open && !!branchId);
  const remove = (inv: Invoice) => modal.confirm({ title: `Xóa đơn ${inv.code}?`, okText: 'Xóa', okButtonProps: { danger: true }, cancelText: 'Bỏ qua', onOk: async () => { try { await salesApi.deleteInvoice(inv.id); message.success('Đã xóa đơn giữ'); qc.invalidateQueries({ queryKey: ['invoices'] }); } catch (e) { message.error(errMsg(e)); } } });
  return (
    <Drawer title="Đơn đang giữ" open={open} onClose={onClose} width={560}>
      <Table size="small" rowKey="id" loading={isLoading} dataSource={data?.data ?? []} pagination={false} locale={{ emptyText: <Empty description="Không có đơn đang giữ" /> }}
        columns={[
          { title: 'Mã', dataIndex: 'code', width: 110, render: (v) => <b>{v}</b> },
          { title: 'Thời gian', dataIndex: 'createdAt', width: 130, render: (v) => dt(v) },
          { title: 'Khách', render: (_, r) => r.customer?.name ?? 'Khách lẻ' },
          { title: 'Tổng', dataIndex: 'totalAmount', className: 'num', render: (v) => money(v) },
          { title: '', width: 130, render: (_, r) => <><Button size="small" type="link" onClick={async () => { try { onReopen(await salesApi.invoice(r.id)); onClose(); } catch (e) { message.error(errMsg(e)); } }}>Mở lại</Button><Button size="small" type="link" danger onClick={() => remove(r)}>Xóa</Button></> },
        ]} />
    </Drawer>
  );
}

/** Receipt preview after checkout with print. */
export function ReceiptModal({ invoice, cashGiven, pointsBalance, onClose }: { invoice: Invoice | null; cashGiven?: number; pointsBalance?: string; onClose: () => void }) {
  const me = useAuthStore((s) => s.me);
  const { message } = App.useApp();
  if (!invoice) return null;
  // the part paid with points (BR-141) is not cash → change is computed on what was left to pay
  const payable = Math.max(0, toNum(invoice.totalAmount) - toNum(invoice.pointsValue));
  const change = cashGiven !== undefined ? Math.max(0, cashGiven - payable) : 0;
  const html = receiptHtml(invoice, { storeName: me?.tenant.name, cashGiven, change, pointsBalance });
  return (
    <Modal className="pos-receipt" open onCancel={onClose} width={420} title={<span>Đã thanh toán <Tag color="green">{invoice.code}</Tag></span>}
      footer={[<Button key="p" icon={<PrinterOutlined />} type="primary" onClick={() => { if (!printHtml(html)) message.error('Trình duyệt không cho phép in'); }}>In hóa đơn</Button>, <Button key="c" onClick={onClose}>Đóng (Esc)</Button>]}>
      <iframe title="receipt" srcDoc={html} className="pos-receipt-frame" style={{ width: '100%', height: 420, border: '1px solid #e5e7eb', background: '#fff' }} />
    </Modal>
  );
}
