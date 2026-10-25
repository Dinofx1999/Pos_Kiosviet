/**
 * Tự cập nhật bản web mới.
 * Web app thêm vào màn hình chính (nhất là iPhone) được hệ điều hành giữ nguyên trong bộ nhớ: mở lại không tải lại
 * trang, nên bản mới vừa triển khai không tới tay người dùng. Ở đây ta so tên tệp JS chính đang chạy với tệp trong
 * index.html mới nhất trên máy chủ:
 *  - lúc mở ứng dụng và mỗi lần ứng dụng quay lại màn hình: có bản mới → tải lại ngay (trừ khi đang ở màn hình
 *    soạn phiếu chưa lưu, khi đó hiện thanh "Có phiên bản mới" để người dùng tự bấm);
 *  - trong lúc đang dùng: kiểm tra mỗi 5 phút, có bản mới → hiện thanh thông báo, không tự tải lại.
 */
const SCRIPT_RE = /\/assets\/index-[\w-]+\.js/;
const RELOAD_KEY = 'erp-update-reloaded';
// màn hình đang soạn dữ liệu chưa lưu (giỏ POS đã tự lưu nên tải lại được)
const EDITING_RE = /\/(new|edit)(\/|$)|\/(stocktakes|transfers|purchase-receipts|purchase-orders|purchase-returns|sales-returns|orders|inventory\/documents)\/[^/]+$/;

function runningBuild(): string | null {
  const src = document.querySelector<HTMLScriptElement>('script[type="module"][src*="/assets/index-"]')?.getAttribute('src');
  return src ? (SCRIPT_RE.exec(src)?.[0] ?? null) : null;
}

async function latestBuild(): Promise<string | null> {
  try {
    const res = await fetch(`/?_v=${Date.now()}`, { cache: 'no-store', headers: { 'Cache-Control': 'no-cache' } });
    if (!res.ok) return null;
    return SCRIPT_RE.exec(await res.text())?.[0] ?? null;
  } catch {
    return null; // mất mạng: thử lại lần sau
  }
}

function showBar() {
  if (document.getElementById('erp-update-bar')) return;
  const bar = document.createElement('div');
  bar.id = 'erp-update-bar';
  bar.setAttribute('role', 'status');
  bar.style.cssText = 'position:fixed;left:12px;right:12px;top:calc(8px + env(safe-area-inset-top));z-index:2000;display:flex;align-items:center;gap:10px;'
    + 'background:#111827;color:#fff;border-radius:12px;padding:10px 12px;box-shadow:0 8px 24px rgba(0,0,0,.25);font-size:14px;max-width:520px;margin:0 auto';
  const text = document.createElement('span');
  text.style.flex = '1';
  text.textContent = 'Đã có phiên bản mới của ứng dụng.';
  const btn = document.createElement('button');
  btn.type = 'button';
  btn.textContent = 'Cập nhật';
  btn.style.cssText = 'border:0;border-radius:8px;background:#0070f4;color:#fff;font-weight:600;padding:8px 14px;font-size:14px';
  btn.onclick = () => window.location.reload();
  const close = document.createElement('button');
  close.type = 'button';
  close.textContent = '✕';
  close.setAttribute('aria-label', 'Để sau');
  close.style.cssText = 'border:0;background:transparent;color:#9ca3af;font-size:16px;padding:4px 6px';
  close.onclick = () => bar.remove();
  bar.append(text, btn, close);
  document.body.appendChild(bar);
}

export function startUpdateWatcher() {
  if (import.meta.env.DEV) return;
  const mine = runningBuild();
  if (!mine) return;
  let checking = false;

  const check = async (mayReload: boolean) => {
    if (checking) return;
    checking = true;
    try {
      const latest = await latestBuild();
      if (!latest || latest === mine) return;
      // chống vòng lặp: đã tự tải lại cho đúng bản này trong 2 phút qua mà vẫn nhận bản cũ → chỉ hiện thanh thông báo
      let recent: { build?: string; at?: number } = {};
      try { recent = JSON.parse(sessionStorage.getItem(RELOAD_KEY) ?? '{}'); } catch { /* ignore */ }
      const looped = recent.build === latest && Date.now() - (recent.at ?? 0) < 120_000;
      if (mayReload && !looped && !EDITING_RE.test(window.location.pathname)) {
        try { sessionStorage.setItem(RELOAD_KEY, JSON.stringify({ build: latest, at: Date.now() })); } catch { /* ignore */ }
        window.location.reload();
        return;
      }
      showBar();
    } finally {
      checking = false;
    }
  };

  void check(true); // index.html có thể được lấy từ bộ nhớ đệm → kiểm tra ngay khi mở
  document.addEventListener('visibilitychange', () => { if (document.visibilityState === 'visible') void check(true); });
  window.addEventListener('pageshow', (e) => { if (e.persisted) void check(true); });
  window.setInterval(() => { if (document.visibilityState === 'visible') void check(false); }, 5 * 60_000);
}
