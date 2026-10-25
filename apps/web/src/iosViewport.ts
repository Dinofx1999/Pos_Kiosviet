/**
 * iPhone web app (Thêm vào màn hình chính, thanh trạng thái trong suốt):
 * từ iOS 26, window.innerHeight / 100vh / 100dvh và vùng của `position: fixed` ngắn hơn màn hình đúng bằng chiều cao
 * thanh trạng thái → thanh tab dưới và các thanh nút bị "đẩy lên", để hở một dải trống ở đáy.
 * Ta đo chiều cao màn hình thật (screen) và ghi ra hai biến CSS:
 *   --app-h   chiều cao khung ứng dụng đúng bằng màn hình
 *   --ios-gap phần bị thiếu (0 khi iOS không mắc lỗi) – các phần tử ghim đáy trừ đi giá trị này
 * Chỉ bật trong chế độ standalone của iOS (navigator.standalone); trình duyệt thường và Android không đổi gì.
 */
type IOSNavigator = Navigator & { standalone?: boolean };

function safeInsets() {
  const probe = document.createElement('div');
  probe.style.cssText = 'position:fixed;top:0;left:0;width:0;visibility:hidden;pointer-events:none;padding-top:env(safe-area-inset-top);padding-bottom:env(safe-area-inset-bottom)';
  document.body.appendChild(probe);
  const cs = getComputedStyle(probe);
  const res = { top: parseFloat(cs.paddingTop) || 0, bottom: parseFloat(cs.paddingBottom) || 0 };
  probe.remove();
  return res;
}

export function startIosViewportFix() {
  if ((navigator as IOSNavigator).standalone !== true) return;
  const root = document.documentElement;
  root.classList.add('ios-standalone');
  let lastReport = '';

  const apply = (reason: string) => {
    const landscape = window.matchMedia('(orientation: landscape)').matches;
    const full = landscape ? Math.min(screen.width, screen.height) : Math.max(screen.width, screen.height);
    const inner = window.innerHeight;
    const missing = full - inner;
    // thiếu hụt nhỏ (thanh trạng thái 20–62px) = lỗi iOS; thiếu nhiều hơn là bàn phím đang mở → để nguyên
    const gap = missing > 0 && missing <= 100 ? missing : 0;
    root.style.setProperty('--app-h', `${inner + gap}px`);
    root.style.setProperty('--ios-gap', `${gap}px`);
    // ghi số đo vào nhật ký truy cập của máy chủ (không chứa dữ liệu cá nhân) để kiểm chứng trên máy thật
    const ins = safeInsets();
    const report = [reason, `ih${inner}`, `sh${full}`, `sw${Math.min(screen.width, screen.height)}`, `vv${Math.round(window.visualViewport?.height ?? 0)}`, `sat${ins.top}`, `sab${ins.bottom}`, `gap${gap}`].join('_');
    if (report.replace(/^[a-z]+_/, '') !== lastReport.replace(/^[a-z]+_/, '')) {
      lastReport = report;
      void fetch(`/?_diag=${encodeURIComponent(report)}`, { cache: 'no-store' }).catch(() => undefined);
    }
  };

  apply('load');
  let t: number | undefined;
  const later = (reason: string, ms = 120) => { window.clearTimeout(t); t = window.setTimeout(() => apply(reason), ms); };
  window.addEventListener('resize', () => later('resize'));
  window.visualViewport?.addEventListener('resize', () => later('vv'));
  window.addEventListener('orientationchange', () => later('rotate', 400));
  document.addEventListener('focusout', () => later('blur', 400));
  document.addEventListener('visibilitychange', () => { if (document.visibilityState === 'visible') later('resume', 200); });
}
