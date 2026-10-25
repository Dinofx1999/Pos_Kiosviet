import { App, Button, Modal, Skeleton, Spin } from 'antd';
import { CheckCircleFilled, ClockCircleOutlined, CloseCircleOutlined, CopyOutlined, ExclamationCircleFilled, QrcodeOutlined, ReloadOutlined, StopOutlined } from '@ant-design/icons';
import { useEffect, useRef, useState, type ReactNode } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import { bankApi, copyText, isOpenRequest, useBankRequest, type BankRequest } from '../api/bankTransfers';
import { normalizeError } from '../api/client';
import { useIsMobile } from '../hooks/useMedia';
import { dt, money, toNum } from '../utils/format';
import './BankQrModal.css';

export interface BankQrModalProps {
  open: boolean;
  /** The request returned by POST /bank-transfers/requests – shown at once, then polled every 2 s while open. */
  request: BankRequest | null;
  title?: ReactNode;
  /** One line under the title, e.g. "Hóa đơn HD000123 · Nguyễn Văn A". */
  subtitle?: ReactNode;
  /** Called whenever the polled request changes (status / amounts) – the caller completes the sale, refreshes documents… */
  onUpdate?: (r: BankRequest) => void;
  /** POS: closing while still PENDING cancels the code (a late transfer then lands in "Giao dịch chuyển khoản"). */
  cancelOnClose?: boolean;
  /** The caller decides whether the modal really closes (it stays controlled by `open`). */
  onClose: (latest: BankRequest | null) => void;
  /** Replaces the default "đã nhận đủ" panel (POS: completing the invoice…). */
  renderPaid?: (r: BankRequest) => ReactNode;
  /** Extra controls while waiting / partially paid (POS: collect the rest in cash). */
  renderActions?: (r: BankRequest) => ReactNode;
  /** Shown as "Tạo mã mới" when the code expired before any money arrived. */
  onRenew?: () => void;
  renewing?: boolean;
}

const pad = (n: number) => String(n).padStart(2, '0');
const left = (ms: number) => {
  const s = Math.max(0, Math.floor(ms / 1000)); const d = Math.floor(s / 86400); const h = Math.floor((s % 86400) / 3600); const m = Math.floor((s % 3600) / 60);
  return d > 0 ? `${d} ngày ${h} giờ` : h > 0 ? `${h} giờ ${pad(m)} phút` : `${pad(m)}:${pad(s % 60)}`;
};

/** VietQR payment screen (SePay): QR, bank details with copy buttons, the mandatory transfer content, countdown and live status. */
export function BankQrModal({ open, request, title, subtitle, onUpdate, cancelOnClose, onClose, renderPaid, renderActions, onRenew, renewing }: BankQrModalProps) {
  const { message, modal } = App.useApp();
  const qc = useQueryClient();
  const isMobile = useIsMobile();
  const { data, refetch, isError } = useBankRequest(open ? request?.id : null, open);
  const r = data && data.id === request?.id ? data : request;
  const [now, setNow] = useState(() => Date.now());
  const [imgOk, setImgOk] = useState<'loading' | 'ok' | 'error'>('loading');
  const [retry, setRetry] = useState(0);
  const [cancelling, setCancelling] = useState(false);
  useEffect(() => { if (!open) return; const t = window.setInterval(() => setNow(Date.now()), 1000); return () => window.clearInterval(t); }, [open]);
  useEffect(() => { setImgOk('loading'); }, [r?.qrUrl]);
  // seed the cache with the creation result so the first poll does not flash a skeleton
  useEffect(() => { if (open && request) qc.setQueryData(['bank-request', request.id], (cur: BankRequest | undefined) => cur ?? request); }, [open, request?.id]);

  // notify the caller on every meaningful change (status, received amount)
  const sig = r ? `${r.id}|${r.status}|${r.paidAmount}|${r.usedAmount}` : '';
  const lastSig = useRef('');
  useEffect(() => { if (!open || !r || sig === lastSig.current) return; lastSig.current = sig; onUpdate?.(r); }, [open, sig]);
  useEffect(() => { if (!open) lastSig.current = ''; }, [open]);

  if (!r) return null;
  const expiresMs = new Date(r.expiresAt).getTime() - now;
  const expired = r.status === 'PENDING' && (r.expired || expiresMs <= 0);
  const paid = toNum(r.paidAmount);
  const amount = toNum(r.amount);
  const remaining = toNum(r.remaining);
  const over = Math.max(0, paid - amount);
  const waiting = isOpenRequest(r) && !expired;
  const showQr = r.status === 'PENDING' || r.status === 'PARTIAL';

  const copy = async (text: string, what: string) => { if (await copyText(text)) message.success(`Đã sao chép ${what}`); else message.warning('Không sao chép được – hãy đọc cho khách'); };

  const doCancel = async (thenClose: boolean) => {
    setCancelling(true);
    try {
      const v = await bankApi.cancelRequest(r.id);
      qc.setQueryData(['bank-request', r.id], v);
      if (thenClose) onClose(v); else message.success(`Đã hủy mã ${r.code}`);
    } catch (e) {
      const err = normalizeError(e);
      if (err.code === 'REQUEST_NOT_PENDING') { message.warning('Khách vừa chuyển khoản – không hủy được mã này'); void refetch(); }
      else message.error(err.message);
    } finally { setCancelling(false); }
  };
  const askCancel = () => modal.confirm({
    title: `Hủy mã ${r.code}?`, okText: 'Hủy mã', okButtonProps: { danger: true }, cancelText: 'Không',
    content: 'Khách quét mã này sau khi hủy sẽ không được ghi nhận tự động – giao dịch sẽ nằm ở mục Sổ quỹ → Giao dịch chuyển khoản để xử lý tay.',
    onOk: () => doCancel(false),
  });
  const close = () => {
    if (cancelling) return;
    if (cancelOnClose && r.status === 'PENDING') { void doCancel(true); return; }
    onClose(r);
  };

  const status = (() => {
    if (r.status === 'PAID') return (
      <div className="bq-status bq-paid"><CheckCircleFilled /><div><b>Đã nhận đủ {money(paid)}</b>{r.paidAt && <div className="bq-sub">lúc {dt(r.paidAt, 'HH:mm:ss DD/MM')}</div>}{over > 0 && <div className="bq-sub bq-over">Khách chuyển thừa {money(over)} – cần hoàn lại cho khách</div>}</div></div>
    );
    if (r.status === 'CANCELLED') return <div className="bq-status bq-cancelled"><CloseCircleOutlined /><div><b>Mã đã hủy</b><div className="bq-sub">Không dùng mã này để chuyển khoản nữa.</div></div></div>;
    if (expired) return <div className="bq-status bq-expired"><ExclamationCircleFilled /><div><b>Mã QR đã hết hạn</b><div className="bq-sub">Nếu khách đã chuyển, tiền vẫn được ghi nhận khi về tài khoản. Tạo mã mới nếu khách chưa chuyển.</div></div></div>;
    if (r.status === 'PARTIAL') return (
      <div className="bq-status bq-partial"><ExclamationCircleFilled /><div><b>Đã nhận {money(paid)} / còn thiếu {money(remaining)}</b><div className="bq-sub">Mã QR bên dưới đã đổi sang số còn thiếu – khách quét lại để chuyển tiếp.</div></div></div>
    );
    return (
      <div className="bq-status bq-wait"><Spin size="small" /><div><b>Đang chờ khách chuyển khoản…</b><div className="bq-sub"><ClockCircleOutlined /> Mã hết hạn sau <b className="bq-count">{left(expiresMs)}</b></div></div></div>
    );
  })();

  const rows: Array<{ k: string; v: ReactNode; copy?: string; what?: string; cls?: string }> = [
    ...(!showQr ? [{ k: 'Mã thanh toán', v: <b className="bq-mono">{r.code}</b> }] : []),
    { k: 'Ngân hàng', v: <span>{r.bankName}{r.bankName !== r.bankCode && <span className="bq-muted"> ({r.bankCode})</span>}</span> },
    { k: 'Số tài khoản', v: <b className="bq-mono">{r.accountNumber}</b>, copy: r.accountNumber, what: 'số tài khoản' },
    ...(r.accountName ? [{ k: 'Chủ tài khoản', v: <b>{r.accountName}</b>, copy: r.accountName, what: 'tên chủ tài khoản' }] : []),
    { k: r.status === 'PARTIAL' ? 'Số tiền còn thiếu' : 'Số tiền', v: <b className="bq-amount">{money(r.status === 'PARTIAL' ? remaining : amount)} đ</b>, copy: String(Math.round(r.status === 'PARTIAL' ? remaining : amount)), what: 'số tiền', cls: 'bq-row-amount' },
  ];

  const footer = (
    <div className="bq-footer">
      {r.status === 'PENDING' && !expired && <Button danger icon={<StopOutlined />} loading={cancelling} onClick={askCancel}>Hủy mã</Button>}
      {expired && onRenew && <Button type="primary" icon={<ReloadOutlined />} loading={renewing} onClick={onRenew}>Tạo mã mới</Button>}
      {renderActions?.(r)}
      <Button onClick={close} loading={cancelling && cancelOnClose}>{r.status === 'PAID' || r.status === 'CANCELLED' ? 'Đóng' : cancelOnClose && r.status === 'PENDING' ? 'Đóng & hủy mã' : 'Đóng'}</Button>
    </div>
  );

  return (
    <Modal className="bq-modal" open={open} onCancel={close} maskClosable={false} width={760} footer={footer} destroyOnClose centered={!isMobile}
      title={<div className="bq-title"><QrcodeOutlined /> <span>{title ?? 'Thanh toán chuyển khoản (VietQR)'}</span>{subtitle && <div className="bq-subtitle">{subtitle}</div>}</div>}>
      {status}
      {isError && <div className="bq-neterr">Mất kết nối tạm thời – đang thử lại…</div>}
      {r.status === 'PAID' && renderPaid ? <div className="bq-paid-slot">{renderPaid(r)}</div> : null}
      <div className={`bq-body${showQr ? '' : ' bq-body-done'}`}>
        {showQr && (
          <div className="bq-qr">
            <div className={`bq-qr-frame${expired ? ' dim' : ''}`}>
              {imgOk === 'loading' && <Skeleton.Image active className="bq-qr-skel" />}
              {imgOk === 'error' ? (
                <div className="bq-qr-err">Không tải được ảnh QR (cần Internet).<br />Khách chuyển khoản theo thông tin bên cạnh, <b>ghi đúng nội dung</b>.<br /><Button size="small" icon={<ReloadOutlined />} onClick={() => { setImgOk('loading'); setRetry((n) => n + 1); }}>Tải lại</Button></div>
              ) : (
                <img key={`${r.qrUrl}#${retry}`} src={r.qrUrl} alt={`Mã VietQR ${r.code}`} className="bq-qr-img" style={imgOk === 'loading' ? { position: 'absolute', opacity: 0 } : undefined} onLoad={() => setImgOk('ok')} onError={() => setImgOk('error')} />
              )}
            </div>
            <div className="bq-qr-hint">Mở app ngân hàng → <b>Quét mã QR</b>. Số tiền và nội dung đã điền sẵn.</div>
          </div>
        )}
        <div className="bq-info">
          {showQr && <div className="bq-content">
            <div className="bq-content-lbl">Nội dung chuyển khoản <b>bắt buộc</b></div>
            <div className="bq-content-row">
              <span className="bq-code">{r.transferContent}</span>
              <Button icon={<CopyOutlined />} onClick={() => copy(r.transferContent, 'nội dung')}>Sao chép</Button>
            </div>
            <div className="bq-content-hint">Khách tự nhập tay thì phải ghi đúng mã này, hệ thống mới tự nhận ra khoản tiền.</div>
          </div>}
          <div className="bq-rows">
            {rows.map((row) => (
              <div key={row.k} className={`bq-row${row.cls ? ` ${row.cls}` : ''}`}>
                <span className="bq-k">{row.k}</span>
                <span className="bq-v">{row.v}</span>
                {row.copy ? <Button size="small" type="text" className="bq-copy" icon={<CopyOutlined />} aria-label={`Sao chép ${row.what}`} onClick={() => copy(row.copy!, row.what!)} /> : <span />}
              </div>
            ))}
            {paid > 0 && r.status !== 'PAID' && <div className="bq-row"><span className="bq-k">Đã nhận</span><span className="bq-v"><b className="pos">{money(paid)} đ</b> / {money(amount)} đ</span><span /></div>}
          </div>
          {(r.transactions?.length ?? 0) > 0 && (
            <div className="bq-txs">
              <div className="bq-txs-title">Tiền đã về</div>
              {r.transactions!.map((t) => <div key={t.id} className="bq-tx"><span>{dt(t.transactionDate, 'HH:mm DD/MM')}{t.gateway ? ` · ${t.gateway}` : ''}{t.referenceCode ? ` · ${t.referenceCode}` : ''}</span><b className="pos">+{money(t.amount)}</b></div>)}
            </div>
          )}
          {waiting && <div className="bq-auto">Màn hình <b>tự cập nhật</b> khi tiền về tài khoản (thường 5–30 giây) – không cần bấm gì.</div>}
        </div>
      </div>
    </Modal>
  );
}
