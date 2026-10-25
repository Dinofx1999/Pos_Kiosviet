import { Navigate, Outlet, createBrowserRouter, useLocation } from 'react-router-dom';
import { Result, Button } from 'antd';
import AppLayout from './components/layout/AppLayout';
import { useAuthStore } from './store/auth';
import LoginPage from './pages/auth/LoginPage';
import DashboardPage from './pages/dashboard/DashboardPage';
import ProductsPage from './pages/products/ProductsPage';
import DocumentsPage from './pages/inventory/DocumentsPage';
import DocumentEditorPage from './pages/inventory/DocumentEditorPage';
import BalancesPage from './pages/inventory/BalancesPage';
import MovementsPage from './pages/inventory/MovementsPage';
import SettingsPage from './pages/settings/SettingsPage';
import PriceBooksPage from './pages/pricebooks/PriceBooksPage';
import SuppliersPage from './pages/purchasing/SuppliersPage';
import PurchaseOrdersPage from './pages/purchasing/PurchaseOrdersPage';
import PurchaseOrderEditorPage from './pages/purchasing/PurchaseOrderEditorPage';
import PurchaseReceiptsPage from './pages/purchasing/PurchaseReceiptsPage';
import PurchaseReceiptEditorPage from './pages/purchasing/PurchaseReceiptEditorPage';
import PurchaseReturnsPage from './pages/purchasing/PurchaseReturnsPage';
import PurchaseReturnEditorPage from './pages/purchasing/PurchaseReturnEditorPage';
import PaymentsPage from './pages/purchasing/PaymentsPage';
import PurchasingReportPage from './pages/reports/PurchasingReportPage';
import SupplierDebtPage from './pages/reports/SupplierDebtPage';
import PosPage from './pages/pos/PosPage';
import InvoicesPage from './pages/sales/InvoicesPage';
import CustomersPage from './pages/sales/CustomersPage';
import ShiftsPage from './pages/sales/ShiftsPage';
import SalesReportPage from './pages/reports/SalesReportPage';
import CustomerDebtPage from './pages/reports/CustomerDebtPage';
import SalesReturnsPage from './pages/sales/SalesReturnsPage';
import SalesReturnEditorPage from './pages/sales/SalesReturnEditorPage';
import CashbookPage from './pages/finance/CashbookPage';
import CashAccountsPage from './pages/finance/CashAccountsPage';
import CashTransfersPage from './pages/finance/CashTransfersPage';
import BankTransactionsPage from './pages/finance/BankTransactionsPage';
import HelpPage from './pages/help/HelpPage';
import PromotionsPage from './pages/promotions/PromotionsPage';
import IntegrationsPage from './pages/integrations/IntegrationsPage';
import EmployeesPage from './pages/employees/EmployeesPage';
import AttendancePage from './pages/employees/AttendancePage';
import CommissionsPage from './pages/employees/CommissionsPage';
import PerformancePage from './pages/employees/PerformancePage';
import TaxReportPage from './pages/reports/TaxReportPage';
import OrdersPage from './pages/sales/OrdersPage';
import OrderEditorPage from './pages/sales/OrderEditorPage';
import DeliveriesPage from './pages/sales/DeliveriesPage';
import NxtReportPage from './pages/reports/NxtReportPage';
import SlowMoversPage from './pages/reports/SlowMoversPage';
import TopProductsPage from './pages/reports/TopProductsPage';
import ProfitReportPage from './pages/reports/ProfitReportPage';
import ValuationPage from './pages/reports/ValuationPage';
import TransfersPage from './pages/inventory/TransfersPage';
import TransferEditorPage from './pages/inventory/TransferEditorPage';
import StocktakesPage from './pages/inventory/StocktakesPage';
import StocktakeEditorPage from './pages/inventory/StocktakeEditorPage';

function Protected() {
  const token = useAuthStore((s) => s.accessToken);
  const loc = useLocation();
  if (!token) return <Navigate to="/login" replace state={{ from: loc.pathname }} />;
  return <Outlet />;
}

function RequirePerm({ perm, children }: { perm: string; children: React.ReactElement }) {
  const can = useAuthStore((s) => s.can);
  const me = useAuthStore((s) => s.me);
  if (me && !can(perm)) return <Result status="403" title="Không có quyền" subTitle={`Bạn cần quyền "${perm}" để xem trang này.`} extra={<Button type="primary" href="/">Về trang chủ</Button>} />;
  return children;
}

export const router = createBrowserRouter([
  { path: '/login', element: <LoginPage /> },
  {
    element: <Protected />,
    children: [
      { path: '/pos', element: <RequirePerm perm="invoice.create"><PosPage /></RequirePerm> },
      {
        element: <AppLayout />,
        children: [
          { path: '/', element: <RequirePerm perm="dashboard.view"><DashboardPage /></RequirePerm> },
          { path: '/products', element: <RequirePerm perm="product.view"><ProductsPage /></RequirePerm> },
          { path: '/price-books', element: <RequirePerm perm="pricebook.manage"><PriceBooksPage /></RequirePerm> },
          { path: '/promotions', element: <RequirePerm perm="promotion.view"><PromotionsPage /></RequirePerm> },
          { path: '/promotions/:id', element: <RequirePerm perm="promotion.view"><PromotionsPage /></RequirePerm> },
          { path: '/inventory/documents', element: <RequirePerm perm="inventory.document.view"><DocumentsPage /></RequirePerm> },
          { path: '/inventory/documents/new', element: <RequirePerm perm="inventory.document.create"><DocumentEditorPage /></RequirePerm> },
          { path: '/inventory/documents/:id/edit', element: <RequirePerm perm="inventory.document.create"><DocumentEditorPage /></RequirePerm> },
          { path: '/transfers', element: <RequirePerm perm="transfer.view"><TransfersPage /></RequirePerm> },
          { path: '/transfers/new', element: <RequirePerm perm="transfer.create"><TransferEditorPage /></RequirePerm> },
          { path: '/transfers/:id', element: <RequirePerm perm="transfer.view"><TransferEditorPage /></RequirePerm> },
          { path: '/stocktakes', element: <RequirePerm perm="stocktake.view"><StocktakesPage /></RequirePerm> },
          { path: '/stocktakes/new', element: <RequirePerm perm="stocktake.create"><StocktakeEditorPage /></RequirePerm> },
          { path: '/stocktakes/:id', element: <RequirePerm perm="stocktake.view"><StocktakeEditorPage /></RequirePerm> },
          { path: '/inventory/balances', element: <RequirePerm perm="inventory.view"><BalancesPage /></RequirePerm> },
          { path: '/inventory/movements', element: <RequirePerm perm="inventory.movement.view"><MovementsPage /></RequirePerm> },
          { path: '/suppliers', element: <RequirePerm perm="supplier.view"><SuppliersPage /></RequirePerm> },
          { path: '/purchase-orders', element: <RequirePerm perm="purchase.order.view"><PurchaseOrdersPage /></RequirePerm> },
          { path: '/purchase-orders/new', element: <RequirePerm perm="purchase.order.create"><PurchaseOrderEditorPage /></RequirePerm> },
          { path: '/purchase-orders/:id/edit', element: <RequirePerm perm="purchase.order.create"><PurchaseOrderEditorPage /></RequirePerm> },
          { path: '/purchase-receipts', element: <RequirePerm perm="purchase.receipt.view"><PurchaseReceiptsPage /></RequirePerm> },
          { path: '/purchase-receipts/new', element: <RequirePerm perm="purchase.receipt.create"><PurchaseReceiptEditorPage /></RequirePerm> },
          { path: '/purchase-receipts/:id/edit', element: <RequirePerm perm="purchase.receipt.create"><PurchaseReceiptEditorPage /></RequirePerm> },
          { path: '/purchase-returns', element: <RequirePerm perm="purchase.return.view"><PurchaseReturnsPage /></RequirePerm> },
          { path: '/purchase-returns/new', element: <RequirePerm perm="purchase.return.create"><PurchaseReturnEditorPage /></RequirePerm> },
          { path: '/purchase-returns/:id/edit', element: <RequirePerm perm="purchase.return.create"><PurchaseReturnEditorPage /></RequirePerm> },
          { path: '/payments', element: <RequirePerm perm="payment.view"><PaymentsPage /></RequirePerm> },
          { path: '/reports/purchasing', element: <RequirePerm perm="purchase.report.view"><PurchasingReportPage /></RequirePerm> },
          { path: '/reports/supplier-debt', element: <RequirePerm perm="supplier.debt.view"><SupplierDebtPage /></RequirePerm> },
          { path: '/invoices', element: <RequirePerm perm="invoice.view"><InvoicesPage /></RequirePerm> },
          { path: '/customers', element: <RequirePerm perm="customer.view"><CustomersPage /></RequirePerm> },
          { path: '/shifts', element: <RequirePerm perm="shift.view"><ShiftsPage /></RequirePerm> },
          { path: '/reports/sales', element: <RequirePerm perm="sales.report.view"><SalesReportPage /></RequirePerm> },
          { path: '/reports/inventory-nxt', element: <RequirePerm perm="inventory.view"><NxtReportPage /></RequirePerm> },
          { path: '/reports/slow-movers', element: <RequirePerm perm="inventory.view"><SlowMoversPage /></RequirePerm> },
          { path: '/reports/products', element: <RequirePerm perm="sales.report.view"><TopProductsPage /></RequirePerm> },
          { path: '/reports/profit', element: <RequirePerm perm="report.profit.view"><ProfitReportPage /></RequirePerm> },
          { path: '/reports/valuation', element: <RequirePerm perm="inventory.cost.view"><ValuationPage /></RequirePerm> },
          { path: '/reports/customer-debt', element: <RequirePerm perm="customer.debt.view"><CustomerDebtPage /></RequirePerm> },
          { path: '/orders', element: <RequirePerm perm="order.view"><OrdersPage /></RequirePerm> },
          { path: '/orders/new', element: <RequirePerm perm="order.create"><OrderEditorPage /></RequirePerm> },
          { path: '/orders/:id', element: <RequirePerm perm="order.view"><OrderEditorPage /></RequirePerm> },
          { path: '/deliveries', element: <RequirePerm perm="delivery.view"><DeliveriesPage /></RequirePerm> },
          { path: '/sales-returns', element: <RequirePerm perm="return.view"><SalesReturnsPage /></RequirePerm> },
          { path: '/sales-returns/new', element: <RequirePerm perm="return.create"><SalesReturnEditorPage /></RequirePerm> },
          { path: '/sales-returns/:id', element: <RequirePerm perm="return.view"><SalesReturnEditorPage /></RequirePerm> },
          { path: '/cash', element: <RequirePerm perm="cash.view"><CashbookPage /></RequirePerm> },
          { path: '/cash/accounts', element: <RequirePerm perm="cash.view"><CashAccountsPage /></RequirePerm> },
          { path: '/cash/transfers', element: <RequirePerm perm="cash.view"><CashTransfersPage /></RequirePerm> },
          { path: '/cash/bank-transactions', element: <RequirePerm perm="cash.view"><BankTransactionsPage /></RequirePerm> },
          { path: '/integrations', element: <RequirePerm perm="integration.view"><IntegrationsPage /></RequirePerm> },
          { path: '/integrations/:tab', element: <RequirePerm perm="integration.view"><IntegrationsPage /></RequirePerm> },
          { path: '/employees', element: <RequirePerm perm="attendance.view"><EmployeesPage /></RequirePerm> },
          { path: '/employees/attendance', element: <AttendancePage /> },
          { path: '/employees/commissions', element: <CommissionsPage /> },
          { path: '/employees/performance', element: <RequirePerm perm="attendance.view"><PerformancePage /></RequirePerm> },
          { path: '/reports/tax', element: <RequirePerm perm="report.profit.view"><TaxReportPage /></RequirePerm> },
          { path: '/help', element: <HelpPage /> },
          { path: '/help/:slug', element: <HelpPage /> },
          { path: '/settings', element: <SettingsPage /> },
          { path: '/settings/:tab', element: <SettingsPage /> },
          { path: '*', element: <Result status="404" title="Không tìm thấy trang" extra={<Button type="primary" href="/">Về trang chủ</Button>} /> },
        ],
      },
    ],
  },
]);
