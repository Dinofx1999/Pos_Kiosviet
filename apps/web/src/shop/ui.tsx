import { createContext, useContext, useEffect, useRef, useState, type ReactNode } from 'react';
import { ShopError, vnd, type FlashInfo, type ShopConfig } from './api';

// ---------------------------------------------------------------- ngữ cảnh cửa hàng
export interface ShopCtx { cfg: ShopConfig; offset: number }
export const ShopContext = createContext<ShopCtx | null>(null);
export const useShop = () => useContext(ShopContext)!;

// ---------------------------------------------------------------- tải dữ liệu (có bộ nhớ đệm để quay lại trang không nháy)
const cache = new Map<string, unknown>();
export function useAsync<T>(key: string | null, fn: () => Promise<T>) {
  const [state, setState] = useState<{ data?: T; error?: ShopError; loading: boolean }>(() => ({ data: key ? (cache.get(key) as T | undefined) : undefined, loading: !!key }));
  const [tick, setTick] = useState(0);
  const fnRef = useRef(fn);
  fnRef.current = fn;
  useEffect(() => {
    if (!key) return;
    let alive = true;
    setState({ data: cache.get(key) as T | undefined, loading: true });
    fnRef.current().then((d) => { cache.set(key, d); if (alive) setState({ data: d, loading: false }); })
      .catch((e: ShopError) => { if (alive) setState((s) => ({ data: s.data, error: e, loading: false })); });
    return () => { alive = false; };
  }, [key, tick]);
  return { ...state, reload: () => setTick((t) => t + 1) };
}
export const dropCache = (prefix: string) => { for (const k of Array.from(cache.keys())) if (k.startsWith(prefix)) cache.delete(k); };

// ---------------------------------------------------------------- đồng hồ đếm ngược (theo giờ máy chủ)
export function useNow(offset: number, every = 1000) {
  const [now, setNow] = useState(() => Date.now() + offset);
  useEffect(() => { const t = setInterval(() => setNow(Date.now() + offset), every); return () => clearInterval(t); }, [offset, every]);
  return now;
}
export function Countdown({ to, onEnd, compact }: { to: string; onEnd?: () => void; compact?: boolean }) {
  const { offset } = useShop();
  const now = useNow(offset);
  const ms = Math.max(0, new Date(to).getTime() - now);
  const ended = ms === 0;
  useEffect(() => { if (ended) onEnd?.(); }, [ended]);
  const days = Math.floor(ms / 86400000);
  const parts = [Math.floor(ms / 3600000) % 24, Math.floor(ms / 60000) % 60, Math.floor(ms / 1000) % 60].map((n) => String(n).padStart(2, '0'));
  return (
    <span className={`sh-cd ${compact ? 'compact' : ''}`} aria-label="Thời gian còn lại">
      {days > 0 && <><b>{days}</b><i>ngày</i></>}
      <b>{parts[0]}</b><i>:</i><b>{parts[1]}</b><i>:</i><b>{parts[2]}</b>
    </span>
  );
}

// ---------------------------------------------------------------- ảnh, giá
// ảnh thay thế khi hàng chưa có ảnh: chai mỹ phẩm nét mảnh trên nền hồng nhạt
const PH = 'data:image/svg+xml;utf8,' + encodeURIComponent('<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 100 100"><rect width="100" height="100" fill="#faf5f7"/><g fill="none" stroke="#e7d3db" stroke-width="2.2" stroke-linejoin="round"><rect x="43" y="22" width="14" height="9" rx="2"/><path d="M40 31h20v6l4 5v34a4 4 0 0 1-4 4H40a4 4 0 0 1-4-4V42l4-5z"/><path d="M36 52h28"/></g></svg>');
export function Img({ src, alt, className, eager }: { src: string | null | undefined; alt: string; className?: string; eager?: boolean }) {
  const [err, setErr] = useState(false);
  return <img className={className} src={!src || err ? PH : src} alt={alt} loading={eager ? 'eager' : 'lazy'} decoding="async" onError={() => setErr(true)} />;
}

export function PriceTag({ price, priceMax, flash, big }: { price: number | null; priceMax?: number | null; flash?: FlashInfo | null; big?: boolean }) {
  const { cfg } = useShop();
  // giá hàng hóa và giá Flash Sale bật / tắt riêng; giá 0 (hàng chưa đặt giá ở cửa hàng) → "Liên hệ" thay vì 0đ
  const regular = cfg.showPrice !== false && price !== null && (price > 0 || !!(priceMax && priceMax > 0)) ? price : null;
  if (flash) {
    if (flash.price === null || cfg.showFlashPrice === false) return <div className={`sh-price contact ${big ? 'big' : ''}`}><span className="sh-pct">-{flash.discountPercent}%</span>Giá sốc · Liên hệ</div>;
    return (
      <div className={`sh-price ${big ? 'big' : ''}`}>
        <span className="now flash">{vnd(flash.price)}</span>
        {regular !== null && regular > 0 && <span className="old">{vnd(regular)}</span>}
        {(big || regular === null) && <span className="sh-pct">-{flash.discountPercent}%</span>}
      </div>
    );
  }
  if (regular === null) return <div className={`sh-price contact ${big ? 'big' : ''}`}>Liên hệ</div>;
  price = regular;
  // hàng nhiều phân loại khác giá: thẻ hàng hiện "từ <giá thấp nhất>" cho gọn
  if (priceMax && priceMax > price) return <div className={`sh-price ${big ? 'big' : ''}`}>{big ? <span className="now">{vnd(price)} – {vnd(priceMax)}</span> : <span className="now"><small className="from">từ</small>{vnd(price)}</span>}</div>;
  return <div className={`sh-price ${big ? 'big' : ''}`}><span className="now">{vnd(price)}</span></div>;
}

/** Thanh tiến độ suất Flash Sale. */
export function FlashBar({ sold, limit, remaining }: { sold: number; limit: number | null; remaining: number | null }) {
  const pct = limit ? Math.min(100, Math.round((sold / limit) * 100)) : Math.min(90, 15 + sold * 5);
  const text = remaining === 0 ? 'Hết suất' : remaining !== null && remaining <= 3 ? `Chỉ còn ${remaining} suất` : sold > 0 ? `Đã bán ${sold}` : 'Vừa mở bán';
  return <div className="sh-fbar"><div className="fill" style={{ width: `${Math.max(pct, 8)}%` }} /><span>{text}</span></div>;
}

// ---------------------------------------------------------------- biểu tượng (SVG, không cần thư viện)
const svg = (d: ReactNode, size = 22) => <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">{d}</svg>;
export const Icon = {
  cart: (s?: number) => svg(<><circle cx="9" cy="20" r="1.4" /><circle cx="18" cy="20" r="1.4" /><path d="M2.5 3h2.6l2.4 11.2a1.6 1.6 0 0 0 1.6 1.3h8.6a1.6 1.6 0 0 0 1.6-1.2L21 7H6" /></>, s),
  search: (s?: number) => svg(<><circle cx="11" cy="11" r="7" /><path d="m20 20-3.5-3.5" /></>, s),
  back: (s?: number) => svg(<path d="M15 18l-6-6 6-6" />, s),
  phone: (s?: number) => svg(<path d="M22 16.9v3a2 2 0 0 1-2.2 2 19.8 19.8 0 0 1-8.6-3.1 19.5 19.5 0 0 1-6-6A19.8 19.8 0 0 1 2.1 4.2 2 2 0 0 1 4.1 2h3a2 2 0 0 1 2 1.7c.1.9.4 1.8.7 2.7a2 2 0 0 1-.5 2.1L8 9.8a16 16 0 0 0 6 6l1.3-1.3a2 2 0 0 1 2.1-.4c.9.3 1.8.6 2.7.7a2 2 0 0 1 1.7 2z" />, s),
  bolt: (s?: number) => <svg width={s ?? 18} height={s ?? 18} viewBox="0 0 24 24" fill="currentColor" aria-hidden="true"><path d="M13 2 4 14h6l-1 8 9-12h-6z" /></svg>,
  plus: (s?: number) => svg(<path d="M12 5v14M5 12h14" />, s),
  minus: (s?: number) => svg(<path d="M5 12h14" />, s),
  trash: (s?: number) => svg(<><path d="M3 6h18M8 6V4h8v2M19 6l-1 14H6L5 6" /></>, s),
  check: (s?: number) => svg(<path d="M20 6 9 17l-5-5" />, s),
  bag: (s?: number) => svg(<><path d="M6 7h12l-1 13H7z" /><path d="M9 7a3 3 0 0 1 6 0" /></>, s),
  pin: (s?: number) => svg(<><path d="M12 22s7-6.2 7-12a7 7 0 0 0-14 0c0 5.8 7 12 7 12z" /><circle cx="12" cy="10" r="2.5" /></>, s),
  doc: (s?: number) => svg(<><path d="M14 3H6a1 1 0 0 0-1 1v16a1 1 0 0 0 1 1h12a1 1 0 0 0 1-1V8z" /><path d="M14 3v5h5M8 13h8M8 17h5" /></>, s),
  chev: (s?: number) => svg(<path d="m9 18 6-6-6-6" />, s),
  wallet: (s?: number) => svg(<><rect x="3" y="6" width="18" height="13" rx="2.5" /><path d="M3 10h18M16 14.5h2" /></>, s),
  headset: (s?: number) => svg(<><path d="M4 14v-2a8 8 0 0 1 16 0v2" /><rect x="3" y="14" width="4" height="6" rx="1.5" /><rect x="17" y="14" width="4" height="6" rx="1.5" /></>, s),
  shield: (s?: number) => svg(<><path d="M12 3 4.5 6v5.5c0 4.6 3.2 8.4 7.5 9.5 4.3-1.1 7.5-4.9 7.5-9.5V6z" /><path d="m8.8 12 2.2 2.2 4.2-4.4" /></>, s),
  chat: (s?: number) => svg(<path d="M21 12a8 8 0 0 1-11.8 7L4 20.5l1.5-4.9A8 8 0 1 1 21 12z" />, s),
  sparkle: (s?: number) => <svg width={s ?? 18} height={s ?? 18} viewBox="0 0 24 24" fill="currentColor" aria-hidden="true"><path d="M12 2.5c.5 4.6 2.4 6.9 7 7.5-4.6.6-6.5 2.9-7 7.5-.5-4.6-2.4-6.9-7-7.5 4.6-.6 6.5-2.9 7-7.5zM19 15c.25 2 1 3 3 3.25-2 .25-2.75 1.25-3 3.25-.25-2-1-3-3-3.25 2-.25 2.75-1.25 3-3.25z" /></svg>,
  cartPlus: (s?: number) => svg(<><circle cx="9" cy="20" r="1.4" /><circle cx="18" cy="20" r="1.4" /><path d="M2.5 3h2.6l2.4 11.2a1.6 1.6 0 0 0 1.6 1.3h8.6a1.6 1.6 0 0 0 1.6-1.2L21 7h-4" /><path d="M13 4v6M10 7h6" /></>, s),
  grid: (s?: number) => svg(<><rect x="4" y="4" width="7" height="7" rx="1.5" /><rect x="13" y="4" width="7" height="7" rx="1.5" /><rect x="4" y="13" width="7" height="7" rx="1.5" /><rect x="13" y="13" width="7" height="7" rx="1.5" /></>, s),
};

export function Qty({ value, max, onChange, small }: { value: number; max: number; onChange: (v: number) => void; small?: boolean }) {
  return (
    <div className={`sh-qty ${small ? 'small' : ''}`}>
      <button type="button" aria-label="Giảm" disabled={value <= 1} onClick={() => onChange(value - 1)}>{Icon.minus(16)}</button>
      <input inputMode="numeric" value={value} aria-label="Số lượng" onChange={(e) => { const n = parseInt(e.target.value.replace(/\D/g, ''), 10); if (!Number.isNaN(n)) onChange(Math.max(1, Math.min(max, n))); }} />
      <button type="button" aria-label="Tăng" disabled={value >= max} onClick={() => onChange(value + 1)}>{Icon.plus(16)}</button>
    </div>
  );
}

/** Thông báo nhỏ ở cuối màn hình. */
let toastFn: ((t: string, kind?: 'ok' | 'err') => void) | null = null;
export const toast = (t: string, kind: 'ok' | 'err' = 'ok') => toastFn?.(t, kind);
export function Toaster() {
  const [msg, setMsg] = useState<{ t: string; kind: 'ok' | 'err'; id: number } | null>(null);
  useEffect(() => { toastFn = (t, kind = 'ok') => setMsg({ t, kind, id: Date.now() }); return () => { toastFn = null; }; }, []);
  useEffect(() => { if (!msg) return; const h = setTimeout(() => setMsg(null), 2600); return () => clearTimeout(h); }, [msg]);
  return msg ? <div key={msg.id} className={`sh-toast ${msg.kind}`} role="status">{msg.t}</div> : null;
}
