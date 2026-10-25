import { Alert, App, Button, Modal } from 'antd';
import { QrcodeOutlined } from '@ant-design/icons';
import { useEffect, useRef, useState, type ReactNode } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import { bankApi, invalidateBank, markSepayUnavailable, type BankRequest } from '../api/bankTransfers';
import { normalizeError } from '../api/client';
import { money, toNum } from '../utils/format';
import { BankQrModal } from './BankQrModal';
import { MoneyInput } from './Inputs';

export interface DocumentQrButtonProps {
  purpose: 'INVOICE' | 'SALES_ORDER';
  documentId: string;
  documentCode: string;
  /** amount still due on the document (default QR amount, upper bound) */
  due: number;
  customerName?: string | null;
  /** SALES_ORDER deposits: ask for the amount first (default = due) */
  editableAmount?: boolean;
  label?: ReactNode;
  /** extra query keys to refresh when money lands (the bank / invoice / payment keys are always refreshed) */
  refreshKeys?: string[];
  block?: boolean;
  type?: 'primary' | 'default';
  /** Hide only the button (e.g. nothing left to collect) – keep the component mounted so an open QR screen can show "đã nhận đủ". */
  showButton?: boolean;
}

/**
 * "Thu qua QR" (hóa đơn còn nợ) / "Cọc qua QR" (đơn đặt hàng): creates a VietQR code for the document and shows it.
 * When the money arrives the server books the receipt itself – this only refreshes the screens.
 */
export function DocumentQrButton({ purpose, documentId, documentCode, due, customerName, editableAmount, label, refreshKeys, block, type = 'default', showButton = true }: DocumentQrButtonProps) {
  const { message } = App.useApp();
  const qc = useQueryClient();
  const [asking, setAsking] = useState(false);
  const [amount, setAmount] = useState<number>(due);
  const [busy, setBusy] = useState(false);
  const [req, setReq] = useState<BankRequest | null>(null);
  const lastPaid = useRef(0);
  useEffect(() => { if (asking) setAmount(due); }, [asking]);

  const create = async (amt?: number) => {
    setBusy(true);
    try {
      const r = await bankApi.createRequest({ purpose, documentId, amount: amt !== undefined && Math.abs(amt - due) > 0.001 ? String(amt) : undefined });
      lastPaid.current = toNum(r.paidAmount);
      setAsking(false); setReq(r);
    } catch (e) {
      const err = normalizeError(e);
      if (err.code === 'SEPAY_NOT_CONFIGURED') markSepayUnavailable(qc);
      message.error(err.code === 'OVERPAYMENT' && err.details?.due !== undefined ? `${documentCode} chỉ còn phải thu ${money(err.details.due)}` : err.message);
    } finally { setBusy(false); }
  };
  const start = () => { if (editableAmount) setAsking(true); else void create(); };

  const onUpdate = (r: BankRequest) => {
    const paid = toNum(r.paidAmount);
    if (paid > lastPaid.current + 0.001) {
      const got = paid - lastPaid.current;
      lastPaid.current = paid;
      invalidateBank(qc);
      (refreshKeys ?? []).forEach((k) => qc.invalidateQueries({ queryKey: [k] }));
      message.success(`Đã nhận ${money(got)} – phiếu thu chuyển khoản đã được ghi vào ${documentCode}`);
    }
  };

  const what = purpose === 'INVOICE' ? 'hóa đơn' : 'đơn đặt hàng';
  return (
    <>
      {showButton && <Button type={type} block={block} icon={<QrcodeOutlined />} loading={busy && !asking} onClick={start}>{label ?? (purpose === 'INVOICE' ? 'Thu qua QR' : 'Cọc qua QR')}</Button>}
      <Modal open={asking} title={`Cọc qua QR – ${documentCode}`} onCancel={() => setAsking(false)} okText="Tạo mã QR" cancelText="Bỏ qua" confirmLoading={busy} destroyOnClose
        onOk={() => { if (!(amount > 0)) { message.warning('Nhập số tiền'); return; } if (amount > due + 0.001) { message.warning(`Không vượt quá số còn phải thu (${money(due)})`); return; } void create(amount); }}>
        <div className="kv-hint" style={{ marginBottom: 4 }}>Số tiền khách chuyển (còn phải thu {money(due)})</div>
        <MoneyInput size="large" autoFocus value={amount} max={due} onChange={(v) => setAmount(toNum(v))} />
        <div className="kv-hint" style={{ marginTop: 8 }}>Khách quét mã VietQR bằng app ngân hàng; khi tiền về, phiếu thu cọc được ghi tự động vào {documentCode}. Mã có hiệu lực 7 ngày – có thể gửi ảnh mã cho khách.</div>
      </Modal>
      <BankQrModal open={!!req} request={req} onUpdate={onUpdate} onClose={() => setReq(null)}
        title={`${purpose === 'INVOICE' ? 'Thu nợ' : 'Nhận cọc'} qua QR · ${money(req?.amount)}`}
        subtitle={`${purpose === 'INVOICE' ? 'Hóa đơn' : 'Đơn đặt hàng'} ${documentCode}${customerName ? ` · ${customerName}` : ''}`}
        renderPaid={(r) => <Alert type="success" showIcon message="Đã ghi phiếu thu tự động" description={`Tiền chuyển khoản ${money(r.paidAmount)} đã được ghi vào ${what} ${documentCode}${toNum(r.paidAmount) > toNum(r.amount) ? '; phần chuyển thừa ghi có cho khách (hoặc cần hoàn nếu là khách lẻ)' : ''}.`} />} />
    </>
  );
}
