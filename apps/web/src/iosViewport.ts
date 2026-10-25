/**
 * iPhone web app (Thêm vào màn hình chính, thanh trạng thái trong suốt) trên iOS 26:
 * vùng hiển thị của trang bắt đầu dưới thanh trạng thái nhưng NGẮN hơn màn hình đúng bằng chiều cao thanh trạng thái
 * (đo thực tế iPhone 440×956: innerHeight 894, thiếu 62). Dải 62pt ở đáy nằm ngoài trang – trang không vẽ được vào đó,
 * iOS tô nó bằng màu nền của trang. Vì vậy:
 *   - khung ứng dụng cao đúng bằng vùng hiển thị thật (--app-h = innerHeight, đo lại khi xoay / bàn phím / quay lại);
 *   - khi phát hiện lỗi (lớp `ios-short-frame`): thanh tab bỏ phần đệm "home indicator" (vạch home đã nằm ngoài trang)
 *     và nền gốc của trang chuyển sang trắng để dải đáy liền màu với thanh tab.
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
    const ins = safeInsets();
    // thiếu 20–100pt ở chế độ dọc = lỗi khung ngắn của iOS (thiếu nhiều hơn là bàn phím đang mở → không kết luận)
    const shortFrame = !landscape && missing >= 20 && missing <= 100;
    if (missing <= 100) root.classList.toggle('ios-short-frame', shortFrame);
    root.style.setProperty('--app-h', `${inner}px`);
    // ghi số đo vào nhật ký truy cập của máy chủ (không chứa dữ liệu cá nhân) để kiểm chứng trên máy thật
    const report = [reason, `ih${inner}`, `sh${full}`, `sw${Math.min(screen.width, screen.height)}`, `vv${Math.round(window.visualViewport?.height ?? 0)}`, `sat${ins.top}`, `sab${ins.bottom}`, `short${shortFrame ? 1 : 0}`].join('_');
    if (report.replace(/^[a-z]+_/, '') !== lastReport.replace(/^[a-z]+_/, '')) {
      lastReport = report;
      void fetch(`/?_diag=${encodeURIComponent(report)}`, { cache: 'no-store' }).catch(() => undefined);
    }
  };

  apply('load');
  window.setTimeout(() => apply('settle'), 600);
  let t: number | undefined;
  const later = (reason: string, ms = 120) => { window.clearTimeout(t); t = window.setTimeout(() => apply(reason), ms); };
  window.addEventListener('resize', () => later('resize'));
  window.visualViewport?.addEventListener('resize', () => later('vv'));
  window.addEventListener('orientationchange', () => later('rotate', 400));
  document.addEventListener('focusout', () => later('blur', 400));
  document.addEventListener('visibilitychange', () => { if (document.visibilityState === 'visible') later('resume', 200); });
}
