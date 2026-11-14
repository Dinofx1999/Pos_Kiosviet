import React, { useEffect, useState } from 'react';
import ReactDOM from 'react-dom/client';
import { createBrowserRouter, Link, Navigate, Outlet, RouterProvider, ScrollRestoration, useLocation, useNavigate, useSearchParams } from 'react-router-dom';
import { shopApi, ShopError, STORE, telLink, zaloLink, type ShopConfig } from './api';
import { useCartCount } from './cart';
import { catName, prettyPhone } from './format';
import { CartPage, FlashSalePage, HomePage, LookupPage, OrderPage, ProductPage } from './pages';
import { Icon, Img, ShopContext, Toaster, useShop } from './ui';
import './shop.css';

// web bán hàng không phải web app quản lý: bỏ manifest để "Thêm vào màn hình chính" không mở trang quản lý
document.querySelector('link[rel="manifest"]')?.remove();
document.querySelectorAll('meta[name="apple-mobile-web-app-capable"],meta[name="mobile-web-app-capable"]').forEach((m) => m.remove());
// phông chữ có đủ dấu tiếng Việt cho web bán hàng (trang quản lý không tải)
for (const [rel, href, cross] of [['preconnect', 'https://fonts.googleapis.com', false], ['preconnect', 'https://fonts.gstatic.com', true], ['stylesheet', 'https://fonts.googleapis.com/css2?family=Be+Vietnam+Pro:wght@400;500;600;700;800&display=swap', false]] as const) {
  const l = document.createElement('link'); l.rel = rel; l.href = href; if (cross) l.crossOrigin = ''; document.head.appendChild(l);
}

function TopBar() {
  const { cfg } = useShop();
  const tel = telLink(cfg.hotline);
  return (
    <div className="sh-topbar">
      <div className="in">
        <span>{Icon.wallet(14)} Thanh toán khi nhận hàng</span>
        <span className="opt">{Icon.shield(14)} Cửa hàng gọi xác nhận trước khi giao</span>
        {tel && <a href={tel}>{Icon.phone(13)} {prettyPhone(cfg.hotline)}</a>}
      </div>
    </div>
  );
}

function Header() {
  const { cfg } = useShop();
  const loc = useLocation();
  const nav = useNavigate();
  const [sp] = useSearchParams();
  const [q, setQ] = useState(sp.get('q') ?? '');
  const count = useCartCount();
  useEffect(() => { setQ(sp.get('q') ?? ''); }, [sp.get('q')]);
  const home = loc.pathname === '/';
  const tel = telLink(cfg.hotline);
  const topCats = (cfg.categories ?? []).slice(0, 8);
  const curCat = sp.get('c');
  const combo = sp.get('combo') === '1';
  const comboCount = cfg.combos?.count ?? 0;
  return (
    <header className="sh-header">
      <div className="sh-header-in">
        {!home && <button className="sh-icon-btn back" aria-label="Quay lại" onClick={() => (window.history.length > 1 ? nav(-1) : nav('/'))}>{Icon.back()}</button>}
        <Link to="/" className="sh-brand">{cfg.logoUrl ? <Img src={cfg.logoUrl} alt={cfg.shopName} eager /> : <span className="mono">{cfg.shopName.slice(0, 1)}</span>}<span className="nm">{cfg.shopName}</span></Link>
        <form className="sh-search" role="search" onSubmit={(e) => { e.preventDefault(); nav(q.trim() ? `/?q=${encodeURIComponent(q.trim())}` : '/'); (document.activeElement as HTMLElement)?.blur(); }}>
          {Icon.search(18)}<input type="search" value={q} onChange={(e) => setQ(e.target.value)} placeholder="Tìm son, kem chống nắng, nước hoa…" enterKeyHint="search" aria-label="Tìm sản phẩm" />
          {q && <button type="button" className="clr" aria-label="Xóa" onClick={() => { setQ(''); if (sp.get('q')) nav('/'); }}>×</button>}
        </form>
        {tel && <a className="sh-hotline" href={tel}>{Icon.phone(18)}<span><small>Hotline</small><b>{prettyPhone(cfg.hotline)}</b></span></a>}
        {cfg.allowOrder && <Link to="/gio-hang" className="sh-icon-btn cart" aria-label="Giỏ hàng">{Icon.cart()}{count > 0 && <span className="cnt">{count > 99 ? '99+' : count}</span>}</Link>}
      </div>
      {(topCats.length > 0 || comboCount > 0) && (
        <nav className="sh-catnav" aria-label="Danh mục">
          <div className="in">
            <Link to="/" className={home && !curCat && !combo && !sp.get('q') ? 'on' : ''}>Trang chủ</Link>
            {comboCount > 0 && <Link to="/?combo=1" className={`combo ${combo ? 'on' : ''}`}>Combo</Link>}
            {topCats.map((c) => <Link key={c.id} to={`/?c=${c.id}`} className={curCat === c.id && !combo ? 'on' : ''}>{catName(c.name)}</Link>)}
          </div>
        </nav>
      )}
    </header>
  );
}

function Footer() {
  const { cfg } = useShop();
  const zalo = zaloLink(cfg.zalo);
  const tel = telLink(cfg.hotline);
  return (
    <footer className="sh-footer">
      <div className="sh-footer-in">
        <div className="col brand">
          <div className="logo">{cfg.logoUrl ? <Img src={cfg.logoUrl} alt={cfg.shopName} /> : <span className="mono">{cfg.shopName.slice(0, 1)}</span>}<b>{cfg.shopName}</b></div>
          {cfg.intro && <p>{cfg.intro}</p>}
          {cfg.address && <div className="li">{Icon.pin(16)} <span>{cfg.address}</span></div>}
          {tel && <div className="li">{Icon.phone(16)} <a href={tel}>{prettyPhone(cfg.hotline)}</a></div>}
        </div>
        <div className="col">
          <h4>Hỗ trợ khách hàng</h4>
          <Link to="/tra-cuu">Tra cứu đơn hàng</Link>
          {cfg.allowOrder && <Link to="/gio-hang">Giỏ hàng</Link>}
          {zalo && <a href={zalo} target="_blank" rel="noreferrer">Nhắn Zalo</a>}
          {cfg.facebook && <a href={cfg.facebook} target="_blank" rel="noreferrer">Facebook</a>}
        </div>
        <div className="col">
          <h4>Mua hàng online</h4>
          <span>Đặt hàng trên web, cửa hàng gọi xác nhận đơn</span>
          <span>Thanh toán khi nhận hàng hoặc chuyển khoản</span>
          <span>Phí giao hàng (nếu có) báo khi xác nhận</span>
        </div>
      </div>
      <div className="sh-copy">© {new Date().getFullYear()} {cfg.shopName}</div>
    </footer>
  );
}

function FloatContact() {
  const { cfg } = useShop();
  const loc = useLocation();
  if (['/p/', '/gio-hang', '/don-hang'].some((x) => loc.pathname.startsWith(x))) return null;
  const zalo = zaloLink(cfg.zalo);
  const tel = telLink(cfg.hotline);
  if (!zalo && !tel) return null;
  return (
    <div className="sh-float">
      {zalo && <a href={zalo} target="_blank" rel="noreferrer" className="zalo" aria-label="Nhắn Zalo">Zalo</a>}
      {tel && <a href={tel} className="call" aria-label="Gọi cửa hàng">{Icon.phone(20)}</a>}
    </div>
  );
}

function Shell() {
  return (
    <>
      <TopBar />
      <Header />
      <main className="sh-main"><Outlet /></main>
      <Footer />
      <FloatContact />
      <Toaster />
      <ScrollRestoration getKey={(l) => l.pathname + l.search} />
    </>
  );
}

function Closed({ cfg }: { cfg: ShopConfig }) {
  const zalo = zaloLink(cfg.zalo);
  return (
    <div className="sh-closed">
      {cfg.logoUrl ? <Img src={cfg.logoUrl} alt={cfg.shopName} eager className="logo" /> : <div className="mono">{cfg.shopName.slice(0, 1)}</div>}
      <h1>{cfg.shopName}</h1>
      <p>Cửa hàng online đang tạm nghỉ. Vui lòng liên hệ trực tiếp để mua hàng.</p>
      {cfg.address && <p className="muted">{cfg.address}</p>}
      <div className="row">{cfg.hotline && <a className="sh-btn" href={telLink(cfg.hotline)!}>{Icon.phone(18)} {cfg.hotline}</a>}{zalo && <a className="sh-btn ghost" href={zalo}>Zalo</a>}</div>
    </div>
  );
}

const router = createBrowserRouter([
  {
    element: <Shell />,
    children: [
      { path: '/', element: <HomePage /> },
      { path: '/p/:id', element: <ProductPage /> },
      { path: '/flash-sale', element: <FlashSalePage /> },
      { path: '/gio-hang', element: <CartPage /> },
      { path: '/don-hang/:code', element: <OrderPage /> },
      { path: '/tra-cuu', element: <LookupPage /> },
      { path: '*', element: <Navigate to="/" replace /> },
    ],
  },
], { basename: '/shop' });

function ShopRoot() {
  const [state, setState] = useState<{ cfg?: ShopConfig; offset: number; error?: ShopError }>({ offset: 0 });
  useEffect(() => {
    const t0 = Date.now();
    shopApi.config().then((cfg) => {
      const offset = new Date(cfg.serverTime).getTime() - Math.round((t0 + Date.now()) / 2);
      document.title = cfg.shopName;
      document.documentElement.style.setProperty('--c', cfg.themeColor || '#d6336c');
      document.querySelector('meta[name="theme-color"]')?.setAttribute('content', cfg.themeColor || '#d6336c');
      if (cfg.logoUrl) document.querySelectorAll('link[rel="icon"],link[rel="apple-touch-icon"]').forEach((l) => l.setAttribute('href', cfg.logoUrl!));
      setState({ cfg, offset });
    }).catch((error: ShopError) => setState({ offset: 0, error }));
  }, []);
  if (state.error) {
    return <div className="sh-closed"><h1>{state.error.status === 404 ? 'Không tìm thấy cửa hàng' : 'Không tải được cửa hàng'}</h1><p>{state.error.status === 404 ? `Đường dẫn cửa hàng${STORE !== 'default' ? ` "${STORE}"` : ''} không đúng hoặc cửa hàng chưa mở web bán hàng.` : state.error.message}</p>{state.error.status !== 404 && <button className="sh-btn" onClick={() => window.location.reload()}>Thử lại</button>}</div>;
  }
  if (!state.cfg) return <div className="sh-boot"><div className="spin" /></div>;
  if (!state.cfg.enabled) return <Closed cfg={state.cfg} />;
  return <ShopContext.Provider value={{ cfg: state.cfg, offset: state.offset }}><RouterProvider router={router} /></ShopContext.Provider>;
}

ReactDOM.createRoot(document.getElementById('root')!).render(<React.StrictMode><ShopRoot /></React.StrictMode>);
