import { App, Avatar, Badge, Button, Drawer, Dropdown, Menu, Select, Spin, Tooltip } from 'antd';
import { AppstoreOutlined, BellOutlined, DownOutlined, FileTextOutlined, HomeOutlined, LockOutlined, LogoutOutlined, MenuOutlined, QuestionCircleOutlined, SettingOutlined, ShopOutlined, ShoppingCartOutlined, TagsOutlined, UserOutlined } from '@ant-design/icons';
import { useEffect, useMemo, useRef, useState } from 'react';
import { Link, Outlet, useLocation, useNavigate } from 'react-router-dom';
import { PlanBanner } from '../PlanBanner';
import { useMeQuery, authApi } from '../../api/auth';
import { useUnmatchedBankCount } from '../../api/bankTransfers';
import { useIsMobile } from '../../hooks/useMedia';
import { useAuthStore } from '../../store/auth';
import { ChangePasswordModal } from '../ChangePasswordModal';

const soon = (label: string) => ({ label: <Tooltip title="Sắp ra mắt" placement="right"><span style={{ opacity: .55 }}>{label}</span></Tooltip>, key: `soon-${label}`, disabled: true });

export default function AppLayout() {
  const { isLoading, isError, refetch } = useMeQuery(true);
  const me = useAuthStore((s) => s.me);
  const can = useAuthStore((s) => s.can);
  const branchId = useAuthStore((s) => s.currentBranchId);
  const setBranch = useAuthStore((s) => s.setBranch);
  const logout = useAuthStore((s) => s.logout);
  const refreshToken = useAuthStore((s) => s.refreshToken);
  const nav = useNavigate();
  const loc = useLocation();
  const isMobile = useIsMobile();
  const mainRef = useRef<HTMLElement>(null);
  // phone shell: the page body is the scroll container → reset it on navigation (desktop: the window)
  useEffect(() => { mainRef.current?.scrollTo({ top: 0 }); window.scrollTo({ top: 0 }); }, [loc.pathname]);
  // iPhone web app: after the keyboard closes iOS may leave the layout viewport shifted up (fixed bars float);
  // the window itself never scrolls in the phone shell, so snapping it back to 0 is always safe
  useEffect(() => {
    if (!isMobile) return;
    let t: number | undefined;
    const snap = () => { window.clearTimeout(t); t = window.setTimeout(() => { if (!(document.activeElement instanceof HTMLInputElement || document.activeElement instanceof HTMLTextAreaElement)) window.scrollTo(0, 0); }, 80); };
    document.addEventListener('focusout', snap);
    window.visualViewport?.addEventListener('resize', snap);
    return () => { document.removeEventListener('focusout', snap); window.visualViewport?.removeEventListener('resize', snap); window.clearTimeout(t); };
  }, [isMobile]);
  const { modal } = App.useApp();
  const [pwdOpen, setPwdOpen] = useState(false);
  const [menuOpen, setMenuOpen] = useState(false);
  // SePay: transfers that matched no payment code wait in Sổ quỹ → Giao dịch chuyển khoản
  const { data: unmatchedBank = 0 } = useUnmatchedBankCount(!!me && can('cash.view'));

  // close the mobile menu after navigation
  useEffect(() => { setMenuOpen(false); }, [loc.pathname, loc.search]);

  // Menu theo đúng bố cục KiotViet: Tổng quan · Hàng hóa · Mua hàng · Đơn hàng · Khách hàng · Nhân viên · Sổ quỹ · Phân tích
  const items = useMemo(() => {
    const L = (to: string, text: string) => ({ key: to, label: <Link to={to}>{text}</Link> });
    const grp = (label: string, children: any[]) => { const c = children.filter(Boolean); return c.length ? { type: 'group', label, children: c } : null; };
    const sub = (key: string, label: React.ReactNode, children: any[]) => { const c = children.filter(Boolean); return c.length ? { key, label, children: c } : null; };
    const list: any[] = [];
    if (can('dashboard.view')) list.push({ key: '/', label: <Link to="/">Tổng quan</Link> });
    list.push(sub('goods', 'Hàng hóa', [
      grp('Hàng hóa', [can('product.view') && L('/products', 'Danh sách hàng hóa'), can('pricebook.manage') && L('/price-books', 'Thiết lập giá')]),
      grp('Kho hàng', [
        can('transfer.view') && L('/transfers', 'Chuyển hàng'),
        can('stocktake.view') && L('/stocktakes', 'Kiểm kho'),
        can('inventory.document.view') && L('/inventory/documents?type=ISSUE', 'Xuất hủy / Xuất dùng nội bộ'),
        can('inventory.document.view') && L('/inventory/documents', 'Phiếu kho (nhập khác, điều chỉnh)'),
      ]),
    ]));
    list.push(sub('buy', 'Mua hàng', [
      grp('Nhà cung cấp', [can('supplier.view') ? L('/suppliers', 'Nhà cung cấp') : soon('Nhà cung cấp')]),
      grp('Mua hàng', [
        can('purchase.receipt.view') ? L('/purchase-receipts', 'Nhập hàng') : soon('Nhập hàng'),
        can('purchase.order.view') && L('/purchase-orders', 'Đặt hàng nhập'),
        can('purchase.return.view') ? L('/purchase-returns', 'Trả hàng nhập') : soon('Trả hàng nhập'),
      ]),
    ]));
    list.push(sub('trans', 'Đơn hàng', [
      grp('Đơn hàng', [
        can('order.view') ? L('/orders', 'Đặt hàng') : soon('Đặt hàng'),
        can('invoice.view') ? L('/invoices', 'Hóa đơn') : soon('Hóa đơn'),
        can('return.view') ? L('/sales-returns', 'Trả hàng') : soon('Trả hàng'),
      ]),
      grp('Giao hàng', [can('delivery.view') && L('/deliveries', 'Vận đơn')]),
    ]));
    list.push(sub('partners', 'Khách hàng', [
      grp('Khách hàng', [can('customer.view') ? L('/customers', 'Khách hàng') : soon('Khách hàng')]),
      grp('Ưu đãi', [can('promotion.view') && L('/promotions', 'Khuyến mại / Voucher')]),
    ]));
    list.push(sub('staff', 'Nhân viên', [
      grp('Nhân viên', [
        can('attendance.view') && L('/employees', 'Danh sách nhân viên'),
        L('/employees/attendance', 'Bảng chấm công'),
        L('/employees/commissions', 'Bảng hoa hồng'),
        can('attendance.view') && L('/employees/performance', 'Hiệu suất'),
        can('shift.view') && L('/shifts', 'Ca bán hàng'),
      ]),
      grp('Thiết lập nhân viên', [can('user.manage') && L('/settings/users', 'Tài khoản đăng nhập'), can('role.manage') && L('/settings/roles', 'Vai trò & phân quyền')]),
    ]));
    list.push(sub('cash', unmatchedBank > 0 ? <Badge dot offset={[4, 0]} className="kv-menu-dotted">Sổ quỹ</Badge> : 'Sổ quỹ', [
      can('cash.view') ? L('/cash', 'Sổ quỹ') : soon('Sổ quỹ'),
      can('payment.view') ? L('/payments?direction=IN', 'Phiếu thu') : soon('Phiếu thu'),
      can('payment.view') ? L('/payments?direction=OUT', 'Phiếu chi') : soon('Phiếu chi'),
      can('cash.view') && L('/cash/accounts', 'Quỹ tiền / Tài khoản'),
      can('cash.view') && L('/cash/transfers', 'Chuyển quỹ / Bàn giao ca'),
      can('cash.view') && { key: '/cash/bank-transactions', label: <Link to="/cash/bank-transactions" className="kv-menu-badge">Giao dịch chuyển khoản{unmatchedBank > 0 && <Badge count={unmatchedBank} size="small" overflowCount={99} />}</Link> },
    ]));
    list.push(sub('reports', 'Phân tích', [
      grp('Bán hàng', [can('sales.report.view') && L('/reports/sales', 'Doanh thu bán hàng'), can('report.profit.view') ? L('/reports/profit', 'Lãi lỗ') : null, can('sales.report.view') && L('/reports/products', 'Hàng bán chạy / chậm')]),
      grp('Hàng hóa', [can('inventory.view') && L('/inventory/balances', 'Tồn kho'), can('inventory.view') && L('/reports/inventory-nxt', 'Nhập xuất tồn'), can('inventory.movement.view') && L('/inventory/movements', 'Thẻ kho'), can('inventory.view') && L('/reports/slow-movers', 'Hàng tồn lâu'), can('inventory.cost.view') && L('/reports/valuation', 'Giá trị tồn kho')]),
      grp('Khách hàng', [can('customer.debt.view') && L('/reports/customer-debt', 'Công nợ khách hàng')]),
      grp('Nhà cung cấp', [can('purchase.report.view') && L('/reports/purchasing', 'Mua hàng'), can('supplier.debt.view') && L('/reports/supplier-debt', 'Công nợ nhà cung cấp')]),
      grp('Tài chính', [can('report.profit.view') && L('/reports/tax', 'Thuế GTGT')]),
    ]));
    return list.filter(Boolean);
  }, [can, me, unmatchedBank]);

  const selected = useMemo(() => {
    const p = loc.pathname;
    if (p === '/') return ['/'];
    if (p.startsWith('/inventory/documents')) return [loc.search.includes('type=ISSUE') ? '/inventory/documents?type=ISSUE' : '/inventory/documents'];
    if (p.startsWith('/payments')) return [`/payments${loc.search.includes('direction=IN') ? '?direction=IN' : loc.search.includes('direction=OUT') ? '?direction=OUT' : ''}`];
    const hit = ['/products', '/price-books', '/inventory/balances', '/inventory/movements', '/settings/users', '/settings/roles', '/suppliers', '/purchase-orders', '/purchase-receipts', '/purchase-returns', '/reports/purchasing', '/reports/supplier-debt', '/reports/sales', '/reports/customer-debt', '/invoices', '/customers', '/shifts', '/sales-returns', '/cash/accounts', '/cash/transfers', '/cash/bank-transactions', '/cash', '/help', '/transfers', '/stocktakes', '/promotions', '/orders', '/deliveries', '/reports/inventory-nxt', '/reports/slow-movers', '/reports/products', '/reports/profit', '/reports/valuation', '/reports/tax', '/integrations', '/employees/attendance', '/employees/commissions', '/employees/performance', '/employees'].find((k) => p.startsWith(k));
    return hit ? [hit] : [];
  }, [loc.pathname, loc.search]);

  if (isLoading && !me) return <div style={{ display: 'flex', justifyContent: 'center', padding: 80 }}><Spin size="large" /></div>;
  if (isError && !me) return <div style={{ padding: 40, textAlign: 'center' }}>Không tải được thông tin người dùng. <Button onClick={() => refetch()}>Thử lại</Button> <Button type="link" onClick={() => { logout(); nav('/login'); }}>Đăng nhập lại</Button></div>;

  const doLogout = () => modal.confirm({ title: 'Đăng xuất?', okText: 'Đăng xuất', cancelText: 'Hủy', onOk: async () => { try { if (refreshToken) await authApi.logout(refreshToken); } catch { /* ignore */ } logout(); nav('/login'); } });
  const openPos = () => (isMobile ? nav('/pos') : window.open('/pos', '_blank'));
  const userMenu = { items: [
    can('tenant.settings.manage') || can('branch.manage') || can('user.manage') ? { key: 'settings', icon: <SettingOutlined />, label: 'Thiết lập cửa hàng', onClick: () => nav('/settings') } : null,
    { key: 'pwd', icon: <LockOutlined />, label: 'Đổi mật khẩu', onClick: () => setPwdOpen(true) },
    can('integration.view') ? { key: 'integrations', icon: <AppstoreOutlined />, label: 'Tích hợp (KiotViet, chuyển khoản SePay)', onClick: () => nav('/integrations') } : null,
    { key: 'help', icon: <QuestionCircleOutlined />, label: 'Hướng dẫn sử dụng', onClick: () => nav('/help') },
    { type: 'divider' },
    { key: 'logout', icon: <LogoutOutlined />, label: 'Đăng xuất', onClick: doLogout },
  ].filter(Boolean) as any };
  const tab = (path: string) => (loc.pathname === path || (path !== '/' && loc.pathname.startsWith(path)) ? 'on' : '');

  return (
    <div className="kv-shell">
      <header className="kv-header">
        <span className="kv-burger" role="button" aria-label="Menu" onClick={() => setMenuOpen(true)}><MenuOutlined /></span>
        <Link to="/" className="kv-logo"><span className="dot"><ShopOutlined /></span><span className="kv-logo-name" title={me?.tenant.name}>{me?.tenant.name ?? 'Retail ERP'}</span></Link>
        <div className="kv-menu"><Menu mode="horizontal" items={items} selectedKeys={selected} disabledOverflow={false} /></div>
        <div className="kv-header-right">
          {(!isMobile || (me?.branches.length ?? 0) > 1) && <Select size="small" className="kv-branch-select" style={{ minWidth: 170 }} value={branchId ?? undefined} onChange={setBranch} options={(me?.branches ?? []).map((b) => ({ value: b.id, label: b.name }))} placeholder="Chi nhánh" suffixIcon={<DownOutlined style={{ color: '#fff' }} />} />}
          {!isMobile && (can('invoice.create') ? <Button className="kv-pos-btn" size="small" onClick={openPos}>Bán hàng</Button> : <Tooltip title="Bạn không có quyền bán hàng"><Button className="kv-pos-btn" size="small" disabled>Bán hàng</Button></Tooltip>)}
          <Tooltip title="Hướng dẫn sử dụng"><Link to="/help" aria-label="Hướng dẫn sử dụng" style={{ color: '#fff', fontSize: 16, display: 'inline-flex' }}><QuestionCircleOutlined /></Link></Tooltip>
          <Badge count={0} size="small"><BellOutlined style={{ color: '#fff', fontSize: 16 }} /></Badge>
          <Dropdown menu={userMenu} trigger={['click']}>
            <span className="kv-user"><Avatar size={26} icon={<UserOutlined />} style={{ background: 'rgba(255,255,255,.25)' }} /><span style={{ maxWidth: 140, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{me?.user.fullName}</span><DownOutlined style={{ fontSize: 10 }} /></span>
          </Dropdown>
        </div>
      </header>
      <PlanBanner />
      <main className="kv-page" ref={mainRef}><Outlet /></main>

      {/* ---- phone: hamburger drawer with the full grouped menu + bottom tab bar ---- */}
      <Drawer className="kv-menu-drawer" placement="left" open={menuOpen} onClose={() => setMenuOpen(false)} width="86vw" title={<span><ShopOutlined /> {me?.tenant.name}</span>} styles={{ body: { padding: 0 } }}>
        <div style={{ padding: '10px 14px', borderBottom: '1px solid #f0f0f0', display: 'flex', alignItems: 'center', gap: 10 }}>
          <Avatar icon={<UserOutlined />} /><div style={{ flex: 1, minWidth: 0 }}><div style={{ fontWeight: 600 }}>{me?.user.fullName}</div><div className="kv-hint">{me?.user.username}</div></div>
        </div>
        <Menu mode="inline" items={items} selectedKeys={selected} defaultOpenKeys={['goods', 'buy', 'trans', 'partners']} onClick={() => setMenuOpen(false)} />
        <div style={{ padding: 12, display: 'grid', gap: 8 }}>
          {(can('tenant.settings.manage') || can('branch.manage') || can('user.manage')) && <Button block icon={<SettingOutlined />} onClick={() => { setMenuOpen(false); nav('/settings'); }}>Thiết lập cửa hàng</Button>}
          <Button block icon={<LockOutlined />} onClick={() => { setMenuOpen(false); setPwdOpen(true); }}>Đổi mật khẩu</Button>
          <Button block icon={<QuestionCircleOutlined />} onClick={() => { setMenuOpen(false); nav('/help'); }}>Hướng dẫn sử dụng</Button>
          <Button block danger icon={<LogoutOutlined />} onClick={doLogout}>Đăng xuất</Button>
        </div>
      </Drawer>
      {isMobile && (
        <nav className="kv-tabbar">
          {can('dashboard.view') && <Link to="/" className={tab('/')}><HomeOutlined /><span>Tổng quan</span></Link>}
          {can('product.view') && <Link to="/products" className={tab('/products')}><TagsOutlined /><span>Hàng hóa</span></Link>}
          {can('invoice.create') && <a className="kv-tab-pos" onClick={openPos}><ShoppingCartOutlined /><span>Bán hàng</span></a>}
          {can('invoice.view') && <Link to="/invoices" className={tab('/invoices')}><FileTextOutlined /><span>Hóa đơn</span></Link>}
          <a className="kv-tab" onClick={() => setMenuOpen(true)}><AppstoreOutlined /><span>Thêm</span></a>
        </nav>
      )}
      <ChangePasswordModal open={pwdOpen} onClose={() => setPwdOpen(false)} />
    </div>
  );
}
