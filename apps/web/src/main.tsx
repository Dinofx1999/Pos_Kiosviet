// Điểm vào: /shop… là web bán hàng cho khách (gói nhẹ, không tải phần quản trị); còn lại là ứng dụng quản lý.
const path = window.location.pathname;
if (path === '/shop' || path.startsWith('/shop/')) void import('./shop/main');
else void import('./adminMain');
