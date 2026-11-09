import { FileTextOutlined, HomeOutlined, MenuOutlined, ShoppingOutlined, TagsOutlined } from '@ant-design/icons';
import { Link, useLocation } from 'react-router-dom';
import { useAuthStore } from '../../store/auth';

/** Thanh tab dưới cùng trên điện thoại (như app KiotViet): Tổng quan · Hàng hóa · Bán hàng · Hóa đơn · Khác. Dùng trong khung quản lý và màn Bán hàng. */
export function MobileTabBar() {
  const can = useAuthStore((s) => s.can);
  const loc = useLocation();
  const on = (path: string) => (loc.pathname === path || (path !== '/' && loc.pathname.startsWith(path)) ? 'on' : '');
  return (
    <nav className="kv-tabbar">
      {can('dashboard.view') && <Link to="/" className={on('/')}><HomeOutlined /><span>Tổng quan</span></Link>}
      {can('product.view') && <Link to="/products" className={on('/products')}><TagsOutlined /><span>Hàng hóa</span></Link>}
      {can('invoice.create') && <Link to="/pos" className={`kv-tab-pos ${on('/pos')}`}><ShoppingOutlined /><span>Bán hàng</span></Link>}
      {can('invoice.view') && <Link to="/invoices" className={on('/invoices')}><FileTextOutlined /><span>Hóa đơn</span></Link>}
      <Link to="/more" className={on('/more')}><MenuOutlined /><span>Khác</span></Link>
    </nav>
  );
}
