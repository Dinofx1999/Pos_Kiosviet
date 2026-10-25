/**
 * iPhone web app (Thêm vào màn hình chính) trên iOS 26 – chỉ còn dùng cho các máy đã thêm ứng dụng khi còn bật
 * thanh trạng thái trong suốt (index.html nay dùng `default`; thêm lại vào màn hình chính là hết lỗi):
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
  let translucentSeen = false; // env(safe-area-inset-top) đôi khi đọc ra 0 ngay lúc mở → nhớ lần đọc được > 0

  const apply = () => {
    const landscape = window.matchMedia('(orientation: landscape)').matches;
    const full = landscape ? Math.min(screen.width, screen.height) : Math.max(screen.width, screen.height);
    const inner = window.innerHeight;
    const missing = full - inner;
    const ins = safeInsets();
    // Lỗi khung ngắn chỉ xảy ra khi trang nằm dưới thanh trạng thái trong suốt (safe-area-inset-top > 0) mà vẫn thiếu
    // 20–100pt ở đáy. Ở chế độ thanh trạng thái thường, trang bắt đầu dưới thanh trạng thái nên thiếu đúng chừng đó là
    // bình thường (inset-top = 0) → không gắn cờ. Thiếu nhiều hơn = bàn phím đang mở → không kết luận.
    if (ins.top > 0) translucentSeen = true;
    const shortFrame = !landscape && translucentSeen && missing >= 20 && missing <= 100;
    if (missing <= 100) root.classList.toggle('ios-short-frame', shortFrame);
    root.style.setProperty('--app-h', `${inner}px`);
  };

  apply();
  window.setTimeout(apply, 600);
  let t: number | undefined;
  const later = (ms = 120) => { window.clearTimeout(t); t = window.setTimeout(apply, ms); };
  window.addEventListener('resize', () => later());
  window.visualViewport?.addEventListener('resize', () => later());
  window.addEventListener('orientationchange', () => later(400));
  document.addEventListener('focusout', () => later(400));
  document.addEventListener('visibilitychange', () => { if (document.visibilityState === 'visible') later(200); });
}
