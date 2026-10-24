import { App, Button, Descriptions, Input, Table, Tag } from 'antd';
import { StopOutlined } from '@ant-design/icons';
import { ReactNode } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { useQueryClient } from '@tanstack/react-query';
import { FINANCE_KEYS, PaymentEx, financeApi, useVoucher } from '../../api/finance';
import { normalizeError } from '../../api/client';
import { PURCHASING_KEYS } from '../../api/purchasing';
import { SALES_KEYS } from '../../api/sales';
import { useCan } from '../../store/auth';
import { LEDGER_DOC_PATH, PAYMENT_METHOD_LABEL, dt, money } from '../../utils/format';
import './finance.css';

/** Method labels incl. the system-only ones (OFFSET / TRANSFER). */
export const METHOD_LABEL: Record<string, string> = { ...PAYMENT_METHOD_LABEL, OFFSET: 'Cấn trừ', TRANSFER: 'Chuyển quỹ' };
const ALLOC_DOC_LABEL: Record<string, string> = { PURCHASE_RECEIPT: 'Phiếu nhập hàng', PURCHASE_RETURN: 'Phiếu trả hàng nhập', INVOICE: 'Hóa đơn', SALES_RETURN: 'Phiếu trả hàng bán' };
const docPath = (type: string, id: string, code: string) => (type === 'SALES_RETURN' ? `/sales-returns?search=${code}` : LEDGER_DOC_PATH[type]?.(id, code));

type Describable = { direction: 'IN' | 'OUT'; method: string; note?: string | null; transferId?: string | null; partyType?: string | null; partyName?: string | null; party?: { name: string; code?: string } | null; categoryName?: string | null; category?: { name: string } | null; reference?: string | null };
/** What a voucher is about: "Chuyển quỹ", a party, a category or a walk-in invoice payment. */
export function describeVoucher(p: Describable): { label: string; who: string; color: string } {
  const partyName = p.partyName ?? p.party?.name ?? '';
  const catName = p.categoryName ?? p.category?.name ?? '';
  if (p.method === 'TRANSFER' || p.transferId) return { label: 'Chuyển quỹ', who: p.note ?? '', color: 'geekblue' };
  if (p.method === 'OFFSET') return { label: p.reference?.startsWith('CT:') ? 'Cấn trừ công nợ' : 'Cấn trừ', who: partyName || p.note || '', color: 'purple' };
  if (p.partyType === 'CUSTOMER') return { label: 'Khách hàng', who: partyName, color: 'cyan' };
  if (p.partyType === 'SUPPLIER') return { label: 'Nhà cung cấp', who: partyName, color: 'orange' };
  if (catName) return { label: p.direction === 'IN' ? 'Thu khác' : 'Chi khác', who: catName, color: 'gold' };
  return { label: 'Khách lẻ', who: p.note ?? '', color: 'default' };
}

const cancelHint = (e: unknown) => {
  const err = normalizeError(e);
  if (err.code === 'PAYMENT_IS_OFFSET') return 'Phiếu cấn trừ không hủy trực tiếp được: hủy theo hóa đơn đổi hàng gốc, hoặc dùng “Hủy cấn trừ” với phiếu cấn trừ công nợ.';
  if (err.code === 'PAYMENT_IS_TRANSFER') return 'Phiếu này thuộc một lần chuyển quỹ: hãy hủy phiếu chuyển quỹ (Sổ quỹ → Chuyển quỹ / Bàn giao ca).';
  return err.message;
};

type Cancellable = Pick<PaymentEx, 'id' | 'code' | 'method'> & { transferId?: string | null; reference?: string | null };
/** Which cancel action applies to a voucher and whether the user may do it. */
export function cancelAction(p: Cancellable, can: (perm: string) => boolean): { label: string; allowed: boolean } {
  if (p.method === 'TRANSFER' || p.transferId) return { label: 'Hủy chuyển quỹ', allowed: !!p.transferId && can('cash.transfer') };
  if (p.method === 'OFFSET') return { label: 'Hủy cấn trừ', allowed: !!p.reference?.startsWith('CT:') && can('debt.offset') };
  return { label: 'Hủy phiếu', allowed: can('payment.cancel') };
}

/** Cancel flow shared by the cash book and the payments list: asks for a reason; system legs (transfer / debt offset) are cancelled through their parent. */
export function useVoucherCancel() {
  const { message, modal } = App.useApp();
  const qc = useQueryClient();
  const can = useCan();
  const navigate = useNavigate();
  const invalidate = () => [...new Set([...FINANCE_KEYS, ...PURCHASING_KEYS, ...SALES_KEYS])].forEach((k) => qc.invalidateQueries({ queryKey: [k] }));
  const askReason = (title: string, content: ReactNode, okText: string, run: (reason: string) => Promise<void>) => {
    let reason = '';
    modal.confirm({
      title, okText, okButtonProps: { danger: true }, cancelText: 'Bỏ qua',
      content: <div>{content}<Input.TextArea style={{ marginTop: 8 }} placeholder="Lý do hủy (bắt buộc)" onChange={(e) => (reason = e.target.value)} /></div>,
      onOk: async () => {
        if (!reason.trim()) { message.warning('Nhập lý do'); throw new Error('reason'); }
        try { await run(reason.trim()); invalidate(); } catch (e) { message.error(cancelHint(e)); throw e; }
      },
    });
  };
  return (p: Cancellable) => {
    if (p.method === 'TRANSFER' || p.transferId) {
      if (p.transferId && can('cash.transfer')) askReason('Hủy phiếu chuyển quỹ?', 'Phiếu này là một vế của lần chuyển quỹ; cả hai phiếu thu / chi của lần chuyển sẽ bị hủy cùng lúc.', 'Hủy chuyển quỹ', async (r) => { await financeApi.cancelTransfer(p.transferId!, r); message.success('Đã hủy chuyển quỹ'); });
      else modal.info({ title: 'Phiếu thuộc một lần chuyển quỹ', content: 'Phiếu thu / chi chuyển quỹ không hủy riêng lẻ được. Hãy hủy phiếu chuyển quỹ tương ứng trong màn hình Chuyển quỹ / Bàn giao ca.', okText: 'Mở Chuyển quỹ', onOk: () => navigate('/cash/transfers') });
      return;
    }
    if (p.method === 'OFFSET') {
      if (p.reference?.startsWith('CT:') && can('debt.offset')) askReason('Hủy cấn trừ công nợ?', 'Cả hai phiếu cấn trừ (khách hàng và nhà cung cấp) sẽ bị hủy, công nợ hai bên được hoàn lại.', 'Hủy cấn trừ', async (r) => { const res = await financeApi.cancelDebtOffset(p.id, r); message.success(`Đã hủy cấn trừ: ${res.cancelled.join(' + ')}`); });
      else modal.info({ title: 'Phiếu cấn trừ do hệ thống tạo', content: 'Phiếu cấn trừ từ hóa đơn đổi hàng chỉ hủy được theo hóa đơn gốc. Phiếu cấn trừ công nợ hủy bằng “Hủy cấn trừ” (cần quyền cấn trừ công nợ).' });
      return;
    }
    askReason(`Hủy phiếu ${p.code}?`, 'Công nợ và các phân bổ vào chứng từ sẽ được hoàn lại; số dư quỹ được điều chỉnh.', 'Hủy phiếu', async (r) => { await financeApi.cancelVoucher(p.id, r); message.success('Đã hủy phiếu'); });
  };
}

/** Voucher detail (expanded row on desktop, full-screen modal on phones) with fund / category and the proper cancel action. */
export function VoucherDetail({ id, onDone }: { id: string; onDone?: () => void }) {
  const { data: p, isLoading } = useVoucher(id);
  const can = useCan();
  const cancel = useVoucherCancel();
  if (isLoading || !p) return <div className="muted">Đang tải…</div>;
  const d = describeVoucher(p);
  const act = cancelAction(p, can);
  const partyLink = p.party ? (p.partyType === 'CUSTOMER' ? `/customers?search=${p.party.code}` : `/suppliers?search=${p.party.code}`) : undefined;
  return (
    <div className="kv-expanded">
      <Descriptions size="small" column={{ xs: 1, md: 3 }} colon={false} labelStyle={{ color: '#6b7280' }}>
        <Descriptions.Item label="Mã phiếu"><b>{p.code}</b> <Tag color={p.status === 'POSTED' ? 'green' : 'red'} style={{ marginLeft: 6 }}>{p.status === 'POSTED' ? 'Hoàn thành' : 'Đã hủy'}</Tag></Descriptions.Item>
        <Descriptions.Item label="Loại"><Tag color={p.direction === 'OUT' ? 'orange' : 'green'}>{p.direction === 'OUT' ? 'Phiếu chi' : 'Phiếu thu'}</Tag><Tag color={d.color}>{d.label}</Tag></Descriptions.Item>
        <Descriptions.Item label={p.party ? (p.partyType === 'CUSTOMER' ? 'Khách hàng' : 'Nhà cung cấp') : p.category ? (p.direction === 'IN' ? 'Loại thu' : 'Loại chi') : 'Diễn giải'}>{p.party && partyLink ? <Link to={partyLink}>{p.party.name}</Link> : p.category?.name ?? d.who ?? '—'}</Descriptions.Item>
        <Descriptions.Item label="Số tiền"><b className={p.direction === 'OUT' ? 'neg' : 'pos'}>{money(p.amount)}</b></Descriptions.Item>
        <Descriptions.Item label="Phương thức">{METHOD_LABEL[p.method] ?? p.method}</Descriptions.Item>
        <Descriptions.Item label="Quỹ tiền">{p.cashAccount ? <Link to={`/cash?accountId=${p.cashAccount.id}`}>{p.cashAccount.name}</Link> : <span className="muted">Không gắn quỹ</span>}</Descriptions.Item>
        <Descriptions.Item label="Thời gian">{dt(p.paymentDate)}</Descriptions.Item>
        <Descriptions.Item label="Tham chiếu">{p.reference || '—'}</Descriptions.Item>
        <Descriptions.Item label="Chi nhánh / ca">{p.branch?.name ?? '—'}{p.shift ? <> · <Link to={`/shifts?search=${p.shift.code}`}>{p.shift.code}</Link></> : null}</Descriptions.Item>
        <Descriptions.Item label="Ghi chú" span={{ xs: 1, md: 3 }}>{p.note || '—'}</Descriptions.Item>
        {p.cancelledAt && <Descriptions.Item label="Hủy lúc" span={{ xs: 1, md: 3 }}>{dt(p.cancelledAt)} · {p.cancelReason}</Descriptions.Item>}
      </Descriptions>
      {(p.allocations?.length > 0 || (p.party && !p.transferId && p.method !== 'OFFSET')) && (
        <Table size="small" rowKey="id" pagination={false} dataSource={p.allocations} style={{ marginTop: 8 }} title={() => <b>Phân bổ vào chứng từ</b>} locale={{ emptyText: 'Không phân bổ (trả trước / trừ công nợ chung)' }}
          columns={[
            { title: 'Chứng từ', render: (_, a) => { const code = a.document?.code ?? a.documentId; const to = docPath(a.documentType, a.documentId, code); return to ? <Link to={to}>{code}</Link> : code; } },
            { title: 'Loại', dataIndex: 'documentType', render: (v) => ALLOC_DOC_LABEL[v] ?? v },
            { title: 'Tổng chứng từ', className: 'num', render: (_, a) => money(a.document?.totalAmount ?? (a.document as any)?.totalRefund) },
            { title: 'Số tiền phân bổ', dataIndex: 'amount', className: 'num', render: (v) => <b>{money(v)}</b> },
          ]} />
      )}
      <div className="kv-detail-actions">
        {p.status === 'POSTED' && (act.allowed || p.method === 'OFFSET' || p.transferId) && <Button danger={act.allowed} icon={<StopOutlined />} onClick={() => { cancel(p); onDone?.(); }}>{act.allowed ? act.label : 'Hủy phiếu…'}</Button>}
      </div>
    </div>
  );
}

/** Phone card for a voucher row (cash book / payments list). */
export function VoucherCard({ p, balanceAfter, fundName, onClick, extra }: { p: Describable & { id: string; code: string; amount: string; paymentDate: string; status?: string }; balanceAfter?: string; fundName?: string | null; onClick?: () => void; extra?: ReactNode }) {
  const d = describeVoucher(p);
  const cancelled = p.status === 'CANCELLED';
  return (
    <div className={`cb-vcard${cancelled ? ' cancelled' : ''}`} onClick={onClick} role="button">
      <div className="code">{p.code}<Tag color={d.color} style={{ marginInlineEnd: 0 }}>{d.label}</Tag>{cancelled && <Tag color="red" style={{ marginInlineEnd: 0 }}>Đã hủy</Tag>}</div>
      <div className="time">{dt(p.paymentDate, 'DD/MM HH:mm')}</div>
      {d.who && <div className="desc">{d.who}</div>}
      <div className="row">
        <span className="meta"><span>{METHOD_LABEL[p.method] ?? p.method}</span>{fundName && <span>· {fundName}</span>}</span>
        <span className={`amt ${p.direction === 'IN' ? 'in' : 'out'}`}>{p.direction === 'IN' ? '+' : '−'}{money(p.amount)}</span>
      </div>
      {balanceAfter !== undefined && <div className="row"><span className="meta">Tồn quỹ sau phiếu</span><span className="bal"><b>{money(balanceAfter)}</b></span></div>}
      {extra}
    </div>
  );
}
