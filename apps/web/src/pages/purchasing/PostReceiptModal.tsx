import { Checkbox, Input, Modal, Select } from 'antd';
import { useEffect, useState } from 'react';
import type { ImmediatePayment } from '../../api/purchasing';
import { MoneyInput } from '../../components/Inputs';
import { useCan } from '../../store/auth';
import { PAYMENT_METHOD_LABEL, money, toNum } from '../../utils/format';

/** "Hoàn thành phiếu nhập" confirmation with an optional immediate payment (phiếu chi) – used by the list detail and the editor. */
export function PostReceiptModal({ open, total, code, onClose, onConfirm, loading }: { open: boolean; total: number; code?: string; onClose: () => void; onConfirm: (payment?: ImmediatePayment) => Promise<void> | void; loading?: boolean }) {
  const can = useCan();
  const [payNow, setPayNow] = useState(false);
  const [amount, setAmount] = useState(0);
  const [method, setMethod] = useState('CASH');
  const [reference, setReference] = useState('');
  const [busy, setBusy] = useState(false);
  useEffect(() => { if (open) { setPayNow(can('payment.create')); setAmount(total); setMethod('CASH'); setReference(''); } }, [open, total]);
  const ok = async () => {
    setBusy(true);
    try { await onConfirm(payNow && amount > 0 ? { amount: String(amount), method, reference: reference || undefined } : undefined); } finally { setBusy(false); }
  };
  return (
    <Modal title={code ? `Hoàn thành phiếu nhập ${code}` : 'Hoàn thành phiếu nhập'} open={open} onCancel={onClose} onOk={ok} okText="Hoàn thành" cancelText="Bỏ qua" confirmLoading={busy || loading} destroyOnClose>
      <p>Tồn kho, giá vốn và công nợ nhà cung cấp sẽ được ghi sổ. Sau khi hoàn thành không thể sửa, chỉ có thể hủy (ghi đảo).</p>
      <div className="kv-kv" style={{ marginBottom: 10 }}><span className="k">Cần trả nhà cung cấp</span><span className="v"><b>{money(total)}</b></span></div>
      {can('payment.create') && (
        <div style={{ background: '#f8fafc', padding: 10, borderRadius: 6 }}>
          <Checkbox checked={payNow} onChange={(e) => setPayNow(e.target.checked)}><b>Thanh toán ngay cho nhà cung cấp</b></Checkbox>
          {payNow && (
            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 8, marginTop: 8 }}>
              <div><div className="kv-hint">Số tiền</div><MoneyInput value={amount} max={total} onChange={(v) => setAmount(Math.min(toNum(v), total))} /></div>
              <div><div className="kv-hint">Phương thức</div><Select style={{ width: '100%' }} value={method} onChange={setMethod} options={Object.entries(PAYMENT_METHOD_LABEL).map(([value, label]) => ({ value, label }))} /></div>
              <div style={{ gridColumn: '1 / span 2' }}><div className="kv-hint">Tham chiếu</div><Input value={reference} onChange={(e) => setReference(e.target.value)} placeholder="Số UNC, mã giao dịch…" /></div>
              <div className="kv-hint" style={{ gridColumn: '1 / span 2' }}>Còn nợ sau thanh toán: <b>{money(Math.max(0, total - amount))}</b></div>
            </div>
          )}
        </div>
      )}
    </Modal>
  );
}
