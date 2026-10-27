/**
 * Thu chuyển khoản tại quầy khi SePay CHƯA bật: hiện VietQR của tài khoản cửa hàng (đúng số tiền + nội dung) để khách quét,
 * thu ngân kiểm tra app ngân hàng rồi bấm "Đã nhận tiền" mới hoàn tất hóa đơn. Bật SePay thì hệ thống tự xác nhận (BankQrModal).
 */
import { Alert, App, Button, Modal } from 'antd';
import { CheckOutlined, CopyOutlined } from '@ant-design/icons';
import { useState } from 'react';
import { Link } from 'react-router-dom';
import { sepayQrUrl } from '@erp/shared';
import { copyText, type BankStatus } from '../api/bankTransfers';
import { useCan } from '../store/auth';
import { money } from '../utils/format';
import './ManualTransferModal.css';

export function ManualTransferModal({ open, amount, content, status, confirming, onConfirm, onCancel }: {
  open: boolean; amount: number; content: string; status?: BankStatus; confirming?: boolean; onConfirm: () => void; onCancel: () => void;
}) {
  const { message } = App.useApp();
  const can = useCan();
  const [imgFailed, setImgFailed] = useState(false);
  const hasAccount = !!(status?.bankCode && status.accountNumber);
  const qr = hasAccount ? sepayQrUrl({ bankCode: status!.bankCode!, accountNumber: status!.accountNumber!, amount: Math.ceil(amount - 0.001), content, template: 'compact' }) : null;
  const copy = async (text: string, what: string) => { if (await copyText(text)) message.success(`Đã sao chép ${what}`); else message.warning('Không sao chép được – hãy đọc cho khách'); };
  return (
    <Modal open={open} onCancel={onCancel} title={<span>Chuyển khoản · {money(amount)}</span>} footer={null} destroyOnHidden width={420} zIndex={1100}>
      {hasAccount ? (
        <div className="mt-body">
          <div className="mt-qr">
            {!imgFailed ? <img src={qr!} alt="Mã VietQR" onError={() => setImgFailed(true)} /> : <Alert type="warning" showIcon message="Không tải được ảnh QR (mất mạng?) – đọc số tài khoản cho khách." />}
          </div>
          <div className="mt-rows">
            <div className="mt-row"><span className="k">Ngân hàng</span><span className="v">{status!.bankName ?? status!.bankCode}</span></div>
            <div className="mt-row"><span className="k">Số tài khoản</span><span className="v"><b>{status!.accountNumber}</b> <Button size="small" type="text" icon={<CopyOutlined />} onClick={() => void copy(status!.accountNumber!, 'số tài khoản')} /></span></div>
            {status!.accountName && <div className="mt-row"><span className="k">Chủ tài khoản</span><span className="v">{status!.accountName}</span></div>}
            <div className="mt-row"><span className="k">Số tiền</span><span className="v"><b>{money(Math.ceil(amount - 0.001))}</b></span></div>
            <div className="mt-row"><span className="k">Nội dung</span><span className="v"><b>{content}</b> <Button size="small" type="text" icon={<CopyOutlined />} onClick={() => void copy(content, 'nội dung')} /></span></div>
          </div>
          <Alert style={{ marginTop: 10 }} type="info" showIcon message="Khách quét mã bằng app ngân hàng. Kiểm tra app ngân hàng của cửa hàng đã nhận đủ tiền rồi bấm “Đã nhận tiền”."
            description={can('integration.view') ? <span>Muốn hệ thống tự xác nhận khi tiền về: bật SePay ở <Link to="/settings/payment-qr" onClick={onCancel}>Thiết lập → Thanh toán QR</Link>.</span> : undefined} />
        </div>
      ) : (
        <Alert type="warning" showIcon message="Chưa cài tài khoản nhận tiền nên chưa có mã QR"
          description={can('integration.view')
            ? <span>Vào <Link to="/settings/payment-qr" onClick={onCancel}>Thiết lập cửa hàng → Thanh toán QR (SePay)</Link>, chọn ngân hàng, nhập số tài khoản, tên chủ tài khoản rồi Lưu (không cần bật SePay). Vẫn có thể bấm “Đã nhận tiền” nếu khách đã chuyển khoản.</span>
            : 'Nhờ quản lý cài tài khoản nhận tiền trong Thiết lập → Thanh toán QR. Vẫn có thể bấm “Đã nhận tiền” nếu khách đã chuyển khoản.'} />
      )}
      <div style={{ display: 'flex', gap: 8, marginTop: 14 }}>
        <Button size="large" onClick={onCancel} style={{ flex: 1 }} disabled={confirming}>Hủy</Button>
        <Button size="large" type="primary" icon={<CheckOutlined />} onClick={onConfirm} loading={confirming} style={{ flex: 2 }} className="pos-pay-btn">Đã nhận tiền – hoàn tất</Button>
      </div>
    </Modal>
  );
}
