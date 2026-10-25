/**
 * Quét mã vạch bằng camera điện thoại / máy tính bảng (iPhone Safari không có BarcodeDetector → dùng ZXing, nạp khi mở camera).
 * - <BarcodeScanButton onScan={…} />: nút biểu tượng mở khung quét toàn màn hình;
 * - continuous: quét liên tục (bán hàng) – camera giữ mở, cùng một mã chỉ nhận lại sau 1,5 giây.
 * Chỉ hiện trên thiết bị cảm ứng có camera; máy tính dùng súng quét USB gõ thẳng vào ô tìm kiếm như cũ.
 */
import { Alert, Button, Input, Modal, Tooltip } from 'antd';
import { CloseOutlined, ScanOutlined, ThunderboltOutlined } from '@ant-design/icons';
import { useEffect, useRef, useState, type CSSProperties } from 'react';
import './BarcodeScanner.css';

type Controls = { stop: () => void; switchTorch?: (on: boolean) => Promise<void> };

/** Thiết bị cảm ứng có API camera (HTTPS hoặc localhost). */
export const canScanWithCamera = () =>
  typeof window !== 'undefined' && !!navigator.mediaDevices?.getUserMedia && window.isSecureContext && window.matchMedia('(pointer: coarse)').matches;

const cameraError = (e: unknown) => {
  const name = (e as { name?: string })?.name;
  if (name === 'NotAllowedError' || name === 'SecurityError') return 'Chưa cho phép dùng camera. Trên iPhone: Cài đặt → Safari → Camera → Cho phép (hoặc bấm "Aa" trên thanh địa chỉ → Cài đặt trang web → Camera), rồi mở lại.';
  if (name === 'NotFoundError' || name === 'OverconstrainedError') return 'Không tìm thấy camera trên thiết bị này.';
  if (name === 'NotReadableError') return 'Camera đang được ứng dụng khác dùng. Đóng ứng dụng đó rồi thử lại.';
  return `Không mở được camera${e instanceof Error && e.message ? `: ${e.message}` : ''}.`;
};

export function BarcodeScannerModal({ open, onClose, onScan, continuous, title = 'Quét mã vạch' }: { open: boolean; onClose: () => void; onScan: (code: string) => void; continuous?: boolean; title?: string }) {
  const videoRef = useRef<HTMLVideoElement>(null);
  const controlsRef = useRef<Controls | null>(null);
  const last = useRef<{ code: string; at: number }>({ code: '', at: 0 });
  const onScanRef = useRef(onScan);
  onScanRef.current = onScan;
  const onCloseRef = useRef(onClose);
  onCloseRef.current = onClose;
  const [error, setError] = useState<string | null>(null);
  const [starting, setStarting] = useState(false);
  const [torch, setTorch] = useState<boolean | null>(null); // null = máy không hỗ trợ đèn
  const [lastCode, setLastCode] = useState<string | null>(null);

  useEffect(() => {
    if (!open) return;
    let cancelled = false;
    setError(null); setLastCode(null); setTorch(null); setStarting(true);
    (async () => {
      try {
        const [{ BrowserMultiFormatReader }, { BarcodeFormat, DecodeHintType }] = await Promise.all([import('@zxing/browser'), import('@zxing/library')]);
        if (cancelled || !videoRef.current) return;
        const hints = new Map();
        hints.set(DecodeHintType.POSSIBLE_FORMATS, [BarcodeFormat.EAN_13, BarcodeFormat.EAN_8, BarcodeFormat.UPC_A, BarcodeFormat.UPC_E, BarcodeFormat.CODE_128, BarcodeFormat.CODE_39, BarcodeFormat.ITF, BarcodeFormat.QR_CODE]);
        hints.set(DecodeHintType.TRY_HARDER, true);
        const reader = new BrowserMultiFormatReader(hints, { delayBetweenScanAttempts: 120, delayBetweenScanSuccess: 400 });
        const controls = await reader.decodeFromConstraints(
          { audio: false, video: { facingMode: { ideal: 'environment' }, width: { ideal: 1280 }, height: { ideal: 720 } } },
          videoRef.current,
          (result) => {
            if (!result || cancelled) return;
            const code = result.getText().trim();
            const now = Date.now();
            if (!code || (code === last.current.code && now - last.current.at < 1500)) return;
            last.current = { code, at: now };
            navigator.vibrate?.(60);
            setLastCode(code);
            onScanRef.current(code);
            if (!continuous) { controlsRef.current?.stop(); onCloseRef.current(); }
          },
        );
        if (cancelled) { controls.stop(); return; }
        controlsRef.current = controls as Controls;
        if (controls.switchTorch) setTorch(false);
      } catch (e) {
        if (!cancelled) setError(cameraError(e));
      } finally {
        if (!cancelled) setStarting(false);
      }
    })();
    return () => { cancelled = true; controlsRef.current?.stop(); controlsRef.current = null; };
  }, [open, continuous]); // onClose / onScan đọc qua ref – không mở lại camera mỗi lần cha vẽ lại

  const toggleTorch = async () => {
    if (torch === null || !controlsRef.current?.switchTorch) return;
    try { await controlsRef.current.switchTorch(!torch); setTorch(!torch); } catch { setTorch(null); }
  };

  return (
    <Modal open={open} onCancel={onClose} footer={null} closable={false} destroyOnClose className="bc-modal" width="100%" style={{ top: 0, maxWidth: 'none', padding: 0, margin: 0 }} styles={{ body: { padding: 0 } }}>
      <div className="bc-wrap">
        <div className="bc-top">
          <span className="bc-title">{title}</span>
          {torch !== null && <Tooltip title="Đèn flash"><Button shape="circle" className={`bc-btn${torch ? ' on' : ''}`} icon={<ThunderboltOutlined />} onClick={toggleTorch} aria-label="Bật/tắt đèn" /></Tooltip>}
          <Button shape="circle" className="bc-btn" icon={<CloseOutlined />} onClick={onClose} aria-label="Đóng" />
        </div>
        <video ref={videoRef} className="bc-video" playsInline muted autoPlay />
        <div className="bc-frame" aria-hidden><span /></div>
        <div className="bc-bottom">
          {error ? <Alert type="error" showIcon message={error} />
            : <div className="bc-hint">{starting ? 'Đang mở camera…' : lastCode ? <>Đã quét: <b>{lastCode}</b>{continuous ? ' – quét tiếp hoặc bấm Xong' : ''}</> : 'Đưa mã vạch vào giữa khung, giữ máy cách 10–20 cm'}</div>}
          {continuous && <Button type="primary" size="large" block onClick={onClose} style={{ marginTop: 10 }}>Xong</Button>}
        </div>
      </div>
    </Modal>
  );
}

/** Nút mở camera quét mã vạch; ẩn trên máy không có camera cảm ứng (trừ khi always). */
export function BarcodeScanButton({ onScan, continuous, title, size, style, className, always }: { onScan: (code: string) => void; continuous?: boolean; title?: string; size?: 'small' | 'middle' | 'large'; style?: CSSProperties; className?: string; always?: boolean }) {
  const [open, setOpen] = useState(false);
  if (!always && !canScanWithCamera()) return null;
  return (
    <>
      <Button size={size} icon={<ScanOutlined />} onClick={() => setOpen(true)} aria-label="Quét mã vạch bằng camera" title="Quét mã vạch bằng camera" style={style} className={className} />
      <BarcodeScannerModal open={open} onClose={() => setOpen(false)} onScan={onScan} continuous={continuous} title={title} />
    </>
  );
}

/** Ô nhập kèm nút camera (dùng được trong Form.Item: value / onChange); quét xong điền mã vào ô. */
export function ScanInput({ value, onChange, placeholder, size, disabled, title = 'Quét mã vạch' }: { value?: string; onChange?: (v: string) => void; placeholder?: string; size?: 'small' | 'middle' | 'large'; disabled?: boolean; title?: string }) {
  return (
    <div className="input-with-scan">
      <Input value={value} onChange={(e) => onChange?.(e.target.value)} placeholder={placeholder} size={size} disabled={disabled} allowClear />
      {!disabled && <BarcodeScanButton size={size} title={title} onScan={(c) => onChange?.(c)} />}
    </div>
  );
}
