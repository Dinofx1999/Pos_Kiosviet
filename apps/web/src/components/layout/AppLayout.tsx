import { App, Avatar, Badge, Button, Drawer, Dropdown, Menu, Select, Spin, Tooltip } from 'antd';
import { AppstoreOutlined, BellOutlined, DownOutlined, FileTextOutlined, HomeOutlined, LockOutlined, LogoutOutlined, MenuOutlined, QuestionCircleOutlined, SettingOutlined, ShopOutlined, ShoppingCartOutlined, TagsOutlined, UserOutlined } from '@ant-design/icons';
import { useEffect, useMemo, useRef, useState } from 'react';
import { Link, Outlet, useLocation, useNavigate } from 'react-router-dom';
import { PlanBanner } from '../PlanBanner';
import { useMeQuery, authApi } from '../../api/auth';
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

  // close the mobile menu after navigation
  useEffect(() => { setMenuOpen(false); }, [loc.pathname, loc.search]);

  const items = useMemo(() => {
    const list: any[] = [];
    if (can('dashboard.view')) list.push({ key: '/', label: <Link to="/">Tổng quan</Link> });
    if (can('product.view') || can('inventory.document.view')) list.push({
      key: 'goods', label: 'Hàng hóa',
      children: [
        can('product.view') && { key: '/products', label: <Link to="/products">Danh mục</Link> },
        can('pricebook.manage') && { key: '/price-books', label: <Link to="/price-books">Thiết lập giá</Link> },
        can('promotion.view') && { key: '/promotions', label: <Link to="/promotions">Khuyến mãi</Link> },
        { type: 'divider' },
        can('inventory.document.view') && { key: '/inventory/documents', label: <Link to="/inventory/documents">Nhập / Xuất / Điều chỉnh kho</Link> },
        can('inventory.document.create') && { key: '/inventory/documents/new?type=RECEIPT', label: <Link to="/inventory/documents/new?type=RECEIPT">+ Nhập kho khác</Link> },
        can('inventory.document.create') && { key: '/inventory/documents/new?type=ISSUE', label: <Link to="/inventory/documents/new?type=ISSUE">+ Xuất kho / Xuất hủy</Link> },
        can('inventory.document.create') && { key: '/inventory/documents/new?type=ADJUSTMENT', label: <Link to="/inventory/documents/new?type=ADJUSTMENT">+ Điều chỉnh tồn</Link> },
        can('transfer.view') && { key: '/transfers', label: <Link to="/transfers">Chuyển kho</Link> },
        can('stocktake.view') && { key: '/stocktakes', label: <Link to="/stocktakes">Kiểm kho</Link> },
      ].filter(Boolean),
    });
    list.push({
      key: 'trans', label: 'Giao dịch',
      children: [
        can('invoice.view') ? { key: '/invoices', label: <Link to="/invoices">Hóa đơn</Link> } : soon('Hóa đơn'), can('order.view') ? { key: '/orders', label: <Link to="/orders">Đặt hàng</Link> } : soon('Đặt hàng'), can('delivery.view') && { key: '/deliveries', label: <Link to="/deliveries">Giao hàng</Link> }, can('return.view') ? { key: '/sales-returns', label: <Link to="/sales-returns">Trả hàng</Link> } : soon('Trả hàng'),
        { type: 'divider' },
        can('purchase.receipt.view') ? { key: '/purchase-receipts', label: <Link to="/purchase-receipts">Nhập hàng</Link> } : soon('Nhập hàng'),
        can('purchase.order.view') ? { key: '/purchase-orders', label: <Link to="/purchase-orders">Đặt hàng nhập</Link> } : null,
        can('purchase.return.view') ? { key: '/purchase-returns', label: <Link to="/purchase-returns">Trả hàng nhập</Link> } : soon('Trả hàng nhập'),
        can('transfer.view') ? { key: '/transfers?tab=out', label: <Link to="/transfers">Chuyển hàng</Link> } : soon('Chuyển hàng'),
      ].filter(Boolean),
    });
    list.push({ key: 'partners', label: 'Đối tác', children: [can('customer.view') ? { key: '/customers', label: <Link to="/customers">Khách hàng</Link> } : soon('Khách hàng'), can('supplier.view') ? { key: '/suppliers', label: <Link to="/suppliers">Nhà cung cấp</Link> } : soon('Nhà cung cấp')] });
    list.push({ key: 'staff', label: 'Nhân viên', children: [
      can('attendance.view') && { key: '/employees', label: <Link to="/employees">Danh sách nhân viên</Link> },
      { key: '/employees/attendance', label: <Link to="/employees/attendance">Chấm công</Link> },
      { key: '/employees/commissions', label: <Link to="/employees/commissions">Hoa hồng</Link> },
      can('attendance.view') && { key: '/employees/performance', label: <Link to="/employees/performance">Hiệu suất</Link> },
      can('shift.view') && { key: '/shifts', label: <Link to="/shifts">Ca bán hàng</Link> },
      can('user.manage') && { key: '/settings/users', label: <Link to="/settings/users">Người dùng</Link> },
      can('role.manage') && { key: '/settings/roles', label: <Link to="/settings/roles">Vai trò</Link> },
    ].filter(Boolean) });
    list.push({ key: 'cash', label: 'Sổ quỹ', children: [
      can('cash.view') ? { key: '/cash', label: <Link to="/cash">Sổ quỹ tổng hợp</Link> } : soon('Sổ quỹ tổng hợp'),
      can('payment.view') ? { key: '/payments?direction=IN', label: <Link to="/payments?direction=IN">Phiếu thu</Link> } : soon('Phiếu thu'),
      can('payment.view') ? { key: '/payments?direction=OUT', label: <Link to="/payments?direction=OUT">Phiếu chi</Link> } : soon('Phiếu chi'),
      can('cash.view') && { key: '/cash/accounts', label: <Link to="/cash/accounts">Quỹ tiền / Tài khoản</Link> },
      can('cash.view') && { key: '/cash/transfers', label: <Link to="/cash/transfers">Chuyển quỹ / Bàn giao ca</Link> },
    ].filter(Boolean) });
    if (can('inventory.view') || can('purchase.report.view') || can('supplier.debt.view') || can('sales.report.view') || can('customer.debt.view') || can('report.profit.view')) list.push({ key: 'reports', label: 'Báo cáo', children: [
      can('sales.report.view') && { key: '/reports/sales', label: <Link to="/reports/sales">Doanh thu</Link> },
      can('customer.debt.view') && { key: '/reports/customer-debt', label: <Link to="/reports/customer-debt">Công nợ khách hàng</Link> },
      can('inventory.view') && { key: '/inventory/balances', label: <Link to="/inventory/balances">Tồn kho</Link> },
      can('inventory.movement.view') && { key: '/inventory/movements', label: <Link to="/inventory/movements">Thẻ kho / Lịch sử</Link> },
      can('purchase.report.view') && { key: '/reports/purchasing', label: <Link to="/reports/purchasing">Mua hàng</Link> },
      can('supplier.debt.view') && { key: '/reports/supplier-debt', label: <Link to="/reports/supplier-debt">Công nợ NCC</Link> },
      can('report.profit.view') ? { key: '/reports/profit', label: <Link to="/reports/profit">Lãi lỗ</Link> } : soon('Lợi nhuận'),
      can('sales.report.view') && { key: '/reports/products', label: <Link to="/reports/products">Hàng bán chạy / chậm</Link> },
      can('inventory.view') && { key: '/reports/inventory-nxt', label: <Link to="/reports/inventory-nxt">Nhập xuất tồn</Link> },
      can('inventory.view') && { key: '/reports/slow-movers', label: <Link to="/reports/slow-movers">Hàng tồn lâu</Link> },
      can('inventory.cost.view') && { key: '/reports/valuation', label: <Link to="/reports/valuation">Giá trị tồn kho</Link> },
      can('report.profit.view') && { key: '/reports/tax', label: <Link to="/reports/tax">Thuế GTGT</Link> },
    ].filter(Boolean) });
    return list;
  }, [can, me]);

  const selected = useMemo(() => {
    const p = loc.pathname;
    if (p === '/') return ['/'];
    if (p.startsWith('/inventory/documents')) return ['/inventory/documents'];
    if (p.startsWith('/payments')) return [`/payments${loc.search.includes('direction=IN') ? '?direction=IN' : loc.search.includes('direction=OUT') ? '?direction=OUT' : ''}`];
    const hit = ['/products', '/price-books', '/inventory/balances', '/inventory/movements', '/settings/users', '/settings/roles', '/suppliers', '/purchase-orders', '/purchase-receipts', '/purchase-returns', '/reports/purchasing', '/reports/supplier-debt', '/reports/sales', '/reports/customer-debt', '/invoices', '/customers', '/shifts', '/sales-returns', '/cash/accounts', '/cash/transfers', '/cash', '/help', '/transfers', '/stocktakes', '/promotions', '/orders', '/deliveries', '/reports/inventory-nxt', '/reports/slow-movers', '/reports/products', '/reports/profit', '/reports/valuation', '/reports/tax', '/integrations', '/employees/attendance', '/employees/commissions', '/employees/performance', '/employees'].find((k) => p.startsWith(k));
    return hit ? [hit] : [];
  }, [loc.pathname, loc.search]);

  if (isLoading && !me) return <div style={{ display: 'flex', justifyContent: 'center', padding: 80 }}><Spin size="large" /></div>;
  if (isError && !me) return <div style={{ padding: 40, textAlign: 'center' }}>Không tải được thông tin người dùng. <Button onClick={() => refetch()}>Thử lại</Button> <Button type="link" onClick={() => { logout(); nav('/login'); }}>Đăng nhập lại</Button></div>;

  const doLogout = () => modal.confirm({ title: 'Đăng xuất?', okText: 'Đăng xuất', cancelText: 'Hủy', onOk: async () => { try { if (refreshToken) await authApi.logout(refreshToken); } catch { /* ignore */ } logout(); nav('/login'); } });
  const openPos = () => (isMobile ? nav('/pos') : window.open('/pos', '_blank'));
  const userMenu = { items: [
    can('tenant.settings.manage') || can('branch.manage') || can('user.manage') ? { key: 'settings', icon: <SettingOutlined />, label: 'Thiết lập cửa hàng', onClick: () => nav('/settings') } : null,
    { key: 'pwd', icon: <LockOutlined />, label: 'Đổi mật khẩu', onClick: () => setPwdOpen(true) },
    can('integration.view') ? { key: 'integrations', icon: <AppstoreOutlined />, label: 'Tích hợp & chuyển dữ liệu (KiotViet)', onClick: () => nav('/integrations') } : null,
    { key: 'help', icon: <QuestionCircleOutlined />, label: 'Hướng dẫn sử dụng', onClick: () => nav('/help') },
    { type: 'divider' },
    { key: 'logout', icon: <LogoutOutlined />, label: 'Đăng xuất', onClick: doLogout },
  ].filter(Boolean) as any };
  const tab = (path: string) => (loc.pathname === path || (path !== '/' && loc.pathname.startsWith(path)) ? 'on' : '');

  return (
    <div className="kv-shell">
      <header className="kv-header">
        <span className="kv-burger" role="button" aria-label="Menu" onClick={() => setMenuOpen(true)}><MenuOutlined /></span>
        <Link to="/" className="kv-logo"><span className="dot"><ShopOutlined /></span><span>{me?.tenant.name ?? 'Retail ERP'}</span></Link>
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
        <Menu mode="inline" items={items} selectedKeys={selected} defaultOpenKeys={['goods', 'trans', 'partners']} onClick={() => setMenuOpen(false)} />
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
