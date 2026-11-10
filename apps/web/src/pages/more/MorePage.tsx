import { App, Badge, Dropdown } from 'antd';
import { AccountBookOutlined, ApiOutlined, AppstoreOutlined, ArrowDownOutlined, ArrowUpOutlined, AuditOutlined, BankOutlined, BarChartOutlined, CalculatorOutlined, CarOutlined, CheckSquareOutlined, ClockCircleOutlined, DatabaseOutlined, DeleteOutlined, DollarOutlined, DownOutlined, EditOutlined, ExportOutlined, FieldTimeOutlined, FileDoneOutlined, FileSearchOutlined, FileTextOutlined, FireOutlined, FundOutlined, GiftOutlined, GlobalOutlined, HourglassOutlined, IdcardOutlined, ImportOutlined, KeyOutlined, LineChartOutlined, LockOutlined, LogoutOutlined, PercentageOutlined, ProfileOutlined, QrcodeOutlined, QuestionCircleOutlined, RightOutlined, RiseOutlined, RollbackOutlined, SafetyCertificateOutlined, SettingOutlined, ShopOutlined, ShoppingCartOutlined, ShoppingOutlined, SwapOutlined, TagsOutlined, TeamOutlined, ThunderboltOutlined, UserOutlined, WalletOutlined } from '@ant-design/icons';
import { ReactNode, useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { authApi } from '../../api/auth';
import { useUnmatchedBankCount } from '../../api/bankTransfers';
import { useOnlineSummary } from '../../api/online';
import { ChangePasswordModal } from '../../components/ChangePasswordModal';
import { useAuthStore } from '../../store/auth';
import './more.css';

interface Item { to: string; label: string; icon: ReactNode; show: boolean; badge?: number }
interface Section { title: string; items: Item[] }

/** Tab Khác trên điện thoại – trang lưới các mục theo nhóm như app KiotViet (thẻ cửa hàng, Giao dịch, Hàng hóa, Bán online, Đối tác, Giao hàng, Nhân viên, Sổ quỹ, Báo cáo, Cài đặt chung). */
export default function MorePage() {
  const me = useAuthStore((s) => s.me);
  const can = useAuthStore((s) => s.can);
  const branchId = useAuthStore((s) => s.currentBranchId);
  const setBranch = useAuthStore((s) => s.setBranch);
  const logout = useAuthStore((s) => s.logout);
  const refreshToken = useAuthStore((s) => s.refreshToken);
  const nav = useNavigate();
  const { modal } = App.useApp();
  const [pwdOpen, setPwdOpen] = useState(false);
  const { data: unmatchedBank = 0 } = useUnmatchedBankCount(!!me && can('cash.view'));
  const { data: onlineSummary } = useOnlineSummary(!!me && can('order.view'));
  const webPending = onlineSummary?.enabled || (onlineSummary?.pendingOrders ?? 0) > 0 ? onlineSummary?.pendingOrders ?? 0 : 0;
  const branches = me?.branches ?? [];
  const branch = branches.find((b) => b.id === branchId) ?? branches[0];
  const canSettings = can('tenant.settings.manage') || can('branch.manage') || can('user.manage');
  const doLogout = () => modal.confirm({ title: 'Đăng xuất?', okText: 'Đăng xuất', cancelText: 'Hủy', onOk: async () => { try { if (refreshToken) await authApi.logout(refreshToken); } catch { /* ignore */ } logout(); nav('/login'); } });

  const sections: Section[] = [
    { title: 'Giao dịch', items: [
      { to: '/pos', label: 'Bán hàng', icon: <ShoppingOutlined />, show: can('invoice.create') },
      { to: '/invoices', label: 'Hóa đơn', icon: <FileTextOutlined />, show: can('invoice.view') },
      { to: '/orders', label: 'Đặt hàng', icon: <ShoppingCartOutlined />, show: can('order.view') },
      { to: '/sales-returns', label: 'Trả hàng', icon: <RollbackOutlined />, show: can('return.view') },
      { to: '/payments?direction=IN', label: 'Phiếu thu', icon: <ArrowDownOutlined />, show: can('payment.view') },
      { to: '/payments?direction=OUT', label: 'Phiếu chi', icon: <ArrowUpOutlined />, show: can('payment.view') },
      { to: '/shifts', label: 'Ca bán hàng', icon: <ClockCircleOutlined />, show: can('shift.view') },
      { to: '/promotions', label: 'Khuyến mại', icon: <GiftOutlined />, show: can('promotion.view') },
    ] },
    { title: 'Hàng hoá', items: [
      { to: '/products', label: 'Hàng hoá', icon: <AppstoreOutlined />, show: can('product.view') },
      { to: '/stocktakes', label: 'Kiểm kho', icon: <CheckSquareOutlined />, show: can('stocktake.view') },
      { to: '/purchase-receipts', label: 'Nhập hàng', icon: <ImportOutlined />, show: can('purchase.receipt.view') },
      { to: '/purchase-returns', label: 'Trả hàng nhập', icon: <ExportOutlined />, show: can('purchase.return.view') },
      { to: '/transfers', label: 'Chuyển hàng', icon: <SwapOutlined />, show: can('transfer.view') },
      { to: '/inventory/documents?type=ISSUE', label: 'Xuất hủy / nội bộ', icon: <DeleteOutlined />, show: can('inventory.document.view') },
      { to: '/purchase-orders', label: 'Đặt hàng nhập', icon: <ProfileOutlined />, show: can('purchase.order.view') },
      { to: '/inventory/documents', label: 'Phiếu kho', icon: <FileDoneOutlined />, show: can('inventory.document.view') },
      { to: '/price-books', label: 'Thiết lập giá', icon: <TagsOutlined />, show: can('pricebook.manage') },
    ] },
    { title: 'Bán online', items: [
      { to: '/online/settings', label: 'Web bán hàng', icon: <GlobalOutlined />, show: can('online.manage') },
      { to: '/online/flash-sales', label: 'Flash Sale', icon: <ThunderboltOutlined />, show: can('online.manage') },
      { to: '/orders?source=ONLINE', label: 'Đơn đặt trên web', icon: <ShoppingCartOutlined />, show: can('order.view'), badge: webPending },
    ] },
    { title: 'Đối tác', items: [
      { to: '/customers', label: 'Khách hàng', icon: <UserOutlined />, show: can('customer.view') },
      { to: '/suppliers', label: 'Nhà cung cấp', icon: <IdcardOutlined />, show: can('supplier.view') },
    ] },
    { title: 'Giao hàng', items: [
      { to: '/deliveries', label: 'Vận đơn', icon: <CarOutlined />, show: can('delivery.view') },
    ] },
    { title: 'Nhân viên', items: [
      { to: '/employees', label: 'Nhân viên', icon: <TeamOutlined />, show: can('attendance.view') },
      { to: '/employees/attendance', label: 'Chấm công', icon: <FieldTimeOutlined />, show: true },
      { to: '/employees/commissions', label: 'Hoa hồng', icon: <PercentageOutlined />, show: true },
      { to: '/employees/performance', label: 'Hiệu suất', icon: <RiseOutlined />, show: can('attendance.view') },
      { to: '/settings/users', label: 'Tài khoản đăng nhập', icon: <KeyOutlined />, show: can('user.manage') },
      { to: '/settings/roles', label: 'Vai trò & phân quyền', icon: <SafetyCertificateOutlined />, show: can('role.manage') },
    ] },
    { title: 'Sổ quỹ', items: [
      { to: '/cash', label: 'Sổ quỹ', icon: <WalletOutlined />, show: can('cash.view') },
      { to: '/cash/accounts', label: 'Quỹ tiền / Tài khoản', icon: <BankOutlined />, show: can('cash.view') },
      { to: '/cash/transfers', label: 'Chuyển quỹ', icon: <SwapOutlined />, show: can('cash.view') },
      { to: '/cash/bank-transactions', label: 'Giao dịch chuyển khoản', icon: <QrcodeOutlined />, show: can('cash.view'), badge: unmatchedBank },
    ] },
    { title: 'Báo cáo', items: [
      { to: '/reports/sales', label: 'Doanh thu bán hàng', icon: <LineChartOutlined />, show: can('sales.report.view') },
      { to: '/reports/profit', label: 'Lãi lỗ', icon: <FundOutlined />, show: can('report.profit.view') },
      { to: '/reports/products', label: 'Hàng bán chạy / chậm', icon: <FireOutlined />, show: can('sales.report.view') },
      { to: '/inventory/balances', label: 'Tồn kho', icon: <DatabaseOutlined />, show: can('inventory.view') },
      { to: '/reports/inventory-nxt', label: 'Nhập xuất tồn', icon: <BarChartOutlined />, show: can('inventory.view') },
      { to: '/inventory/movements', label: 'Thẻ kho', icon: <FileSearchOutlined />, show: can('inventory.movement.view') },
      { to: '/reports/slow-movers', label: 'Hàng tồn lâu', icon: <HourglassOutlined />, show: can('inventory.view') },
      { to: '/reports/valuation', label: 'Giá trị tồn kho', icon: <DollarOutlined />, show: can('inventory.cost.view') },
      { to: '/reports/customer-debt', label: 'Công nợ khách hàng', icon: <AuditOutlined />, show: can('customer.debt.view') },
      { to: '/reports/purchasing', label: 'Mua hàng', icon: <ShoppingOutlined />, show: can('purchase.report.view') },
      { to: '/reports/supplier-debt', label: 'Công nợ nhà cung cấp', icon: <AccountBookOutlined />, show: can('supplier.debt.view') },
      { to: '/reports/tax', label: 'Thuế GTGT', icon: <CalculatorOutlined />, show: can('report.profit.view') },
    ] },
  ];

  return (
    <div className="mr">
      <div className="mr-card mr-store">
        <div className="mr-store-head">
          <span className="mr-logo"><ShopOutlined /></span>
          <div className="mr-store-text">
            <div className="mr-store-name">{me?.tenant.name}</div>
            {branches.length > 1
              ? <Dropdown trigger={['click']} menu={{ items: branches.map((b) => ({ key: b.id, label: b.name })), selectedKeys: branchId ? [branchId] : [], onClick: ({ key }) => setBranch(key) }}><button type="button" className="mr-branch"><span className="bn">{branch?.name ?? 'Chọn chi nhánh'}</span><DownOutlined /></button></Dropdown>
              : <div className="mr-branch static"><span className="bn">{branch?.name ?? me?.tenant.code}</span></div>}
          </div>
          {canSettings && <Link to="/settings" className="mr-edit" aria-label="Thiết lập cửa hàng"><EditOutlined /></Link>}
        </div>
        <Link to={canSettings ? '/settings' : '/help'} className="mr-row"><span>Thông tin cửa hàng</span><RightOutlined /></Link>
      </div>

      {sections.map((s) => {
        const items = s.items.filter((i) => i.show);
        if (!items.length) return null;
        return (
          <div key={s.title} className="mr-card">
            <h2>{s.title}</h2>
            <div className="mr-grid">
              {items.map((i) => (
                <Link key={i.to} to={i.to} className="mr-item">
                  <span className="mr-ic">{i.icon}</span>
                  <span className="mr-label">{i.label}</span>
                  {i.badge ? <Badge count={i.badge} size="small" overflowCount={99} /> : null}
                </Link>
              ))}
            </div>
          </div>
        );
      })}

      <div className="mr-card mr-list">
        <h3>Cài đặt chung</h3>
        {canSettings && <Link to="/settings" className="mr-row"><SettingOutlined /><span>Thiết lập cửa hàng</span><RightOutlined /></Link>}
        {can('integration.view') && <Link to="/integrations" className="mr-row"><ApiOutlined /><span>Tích hợp (KiotViet, chuyển khoản SePay)</span><RightOutlined /></Link>}
        {can('user.manage') && <Link to="/settings/users" className="mr-row"><TeamOutlined /><span>Quản lý người dùng</span><RightOutlined /></Link>}
        <button type="button" className="mr-row" onClick={() => setPwdOpen(true)}><LockOutlined /><span>Đổi mật khẩu</span><RightOutlined /></button>
      </div>
      <div className="mr-card mr-list">
        <Link to="/help" className="mr-row"><QuestionCircleOutlined /><span>Hướng dẫn sử dụng</span><RightOutlined /></Link>
        <button type="button" className="mr-row danger" onClick={doLogout}><LogoutOutlined /><span>Đăng xuất</span><small>{me?.user.fullName}</small></button>
      </div>
      <div className="mr-foot">{me?.tenant.name} · {me?.user.username}</div>
      <ChangePasswordModal open={pwdOpen} onClose={() => setPwdOpen(false)} />
    </div>
  );
}
