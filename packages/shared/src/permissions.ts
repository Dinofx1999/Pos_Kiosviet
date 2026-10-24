/**
 * Permission catalogue. Codes are stable strings stored in role_permissions.
 * Group → label is used by the role editor UI. "*" grants everything (owner/admin).
 */
export const PERMISSIONS = {
  // Module 01 – System administration
  'dashboard.view': { group: 'Tổng quan', label: 'Xem tổng quan' },
  'tenant.settings.manage': { group: 'Hệ thống', label: 'Cấu hình doanh nghiệp' },
  'branch.manage': { group: 'Hệ thống', label: 'Quản lý chi nhánh' },
  'warehouse.manage': { group: 'Hệ thống', label: 'Quản lý kho' },
  'user.manage': { group: 'Hệ thống', label: 'Quản lý người dùng' },
  'role.manage': { group: 'Hệ thống', label: 'Quản lý vai trò & phân quyền' },
  'audit.view': { group: 'Hệ thống', label: 'Xem nhật ký hệ thống' },
  'employee.manage': { group: 'Nhân viên', label: 'Hồ sơ nhân viên, quy tắc hoa hồng, sửa chấm công' },
  'attendance.view': { group: 'Nhân viên', label: 'Xem chấm công & hiệu suất của mọi nhân viên' },
  'commission.view': { group: 'Nhân viên', label: 'Xem hoa hồng' },
  'subscription.view': { group: 'Hệ thống', label: 'Xem gói dịch vụ & hạn mức' },
  // Module 02 – Products
  'product.view': { group: 'Hàng hóa', label: 'Xem hàng hóa' },
  'product.create': { group: 'Hàng hóa', label: 'Thêm hàng hóa' },
  'product.update': { group: 'Hàng hóa', label: 'Sửa hàng hóa' },
  'product.delete': { group: 'Hàng hóa', label: 'Xóa / ngừng kinh doanh' },
  'product.import': { group: 'Hàng hóa', label: 'Nhập Excel' },
  'product.export': { group: 'Hàng hóa', label: 'Xuất Excel' },
  'product.cost.view': { group: 'Hàng hóa', label: 'Xem giá vốn' },
  'category.manage': { group: 'Hàng hóa', label: 'Quản lý nhóm hàng' },
  'brand.manage': { group: 'Hàng hóa', label: 'Quản lý thương hiệu' },
  'unit.manage': { group: 'Hàng hóa', label: 'Quản lý đơn vị tính' },
  'pricebook.manage': { group: 'Hàng hóa', label: 'Quản lý bảng giá' },
  'promotion.view': { group: 'Khuyến mãi', label: 'Xem chương trình khuyến mãi' },
  'promotion.manage': { group: 'Khuyến mãi', label: 'Tạo / sửa khuyến mãi, phát hành voucher' },
  // Module 03 – Inventory
  'inventory.view': { group: 'Kho hàng', label: 'Xem tồn kho' },
  'inventory.movement.view': { group: 'Kho hàng', label: 'Xem thẻ kho / lịch sử' },
  'inventory.document.view': { group: 'Kho hàng', label: 'Xem phiếu kho' },
  'inventory.document.create': { group: 'Kho hàng', label: 'Tạo / sửa phiếu kho' },
  'inventory.document.post': { group: 'Kho hàng', label: 'Ghi sổ phiếu kho' },
  'inventory.document.cancel': { group: 'Kho hàng', label: 'Hủy phiếu kho' },
  'transfer.view': { group: 'Kho hàng', label: 'Xem phiếu chuyển kho' },
  'transfer.create': { group: 'Kho hàng', label: 'Tạo / sửa phiếu chuyển kho' },
  'transfer.dispatch': { group: 'Kho hàng', label: 'Xuất chuyển kho (đang chuyển)' },
  'transfer.receive': { group: 'Kho hàng', label: 'Nhận hàng chuyển kho' },
  'transfer.cancel': { group: 'Kho hàng', label: 'Hủy phiếu chuyển kho' },
  'stocktake.view': { group: 'Kho hàng', label: 'Xem phiếu kiểm kho' },
  'stocktake.create': { group: 'Kho hàng', label: 'Tạo phiếu kiểm kho / nhập số đếm' },
  'stocktake.complete': { group: 'Kho hàng', label: 'Cân bằng kho (duyệt kiểm kho)' },
  'stocktake.cancel': { group: 'Kho hàng', label: 'Hủy phiếu kiểm kho' },
  'inventory.cost.view': { group: 'Kho hàng', label: 'Xem giá trị tồn kho' },
  // Module 04 – Purchasing
  'supplier.view': { group: 'Nhà cung cấp', label: 'Xem nhà cung cấp' },
  'supplier.manage': { group: 'Nhà cung cấp', label: 'Thêm / sửa nhà cung cấp' },
  'supplier.debt.view': { group: 'Nhà cung cấp', label: 'Xem công nợ nhà cung cấp' },
  'purchase.order.view': { group: 'Mua hàng', label: 'Xem đơn đặt hàng nhập' },
  'purchase.order.create': { group: 'Mua hàng', label: 'Tạo / sửa đơn đặt hàng nhập' },
  'purchase.order.confirm': { group: 'Mua hàng', label: 'Xác nhận đơn đặt hàng nhập' },
  'purchase.order.cancel': { group: 'Mua hàng', label: 'Hủy đơn đặt hàng nhập' },
  'purchase.receipt.view': { group: 'Mua hàng', label: 'Xem phiếu nhập hàng' },
  'purchase.receipt.create': { group: 'Mua hàng', label: 'Tạo / sửa phiếu nhập hàng' },
  'purchase.receipt.post': { group: 'Mua hàng', label: 'Hoàn thành (ghi sổ) phiếu nhập hàng' },
  'purchase.receipt.cancel': { group: 'Mua hàng', label: 'Hủy phiếu nhập hàng' },
  'purchase.return.view': { group: 'Mua hàng', label: 'Xem phiếu trả hàng nhập' },
  'purchase.return.create': { group: 'Mua hàng', label: 'Tạo / sửa phiếu trả hàng nhập' },
  'purchase.return.post': { group: 'Mua hàng', label: 'Hoàn thành phiếu trả hàng nhập' },
  'purchase.return.cancel': { group: 'Mua hàng', label: 'Hủy phiếu trả hàng nhập' },
  'purchase.report.view': { group: 'Mua hàng', label: 'Xem báo cáo mua hàng' },
  // Module 05 – POS / sales, Module 07 foundation – customers
  'customer.view': { group: 'Khách hàng', label: 'Xem khách hàng' },
  'customer.manage': { group: 'Khách hàng', label: 'Thêm / sửa khách hàng' },
  'loyalty.manage': { group: 'Khách hàng', label: 'Điều chỉnh điểm tích lũy thủ công' },
  'customer.debt.view': { group: 'Khách hàng', label: 'Xem công nợ khách hàng' },
  'invoice.view': { group: 'Bán hàng', label: 'Xem hóa đơn' },
  'invoice.create': { group: 'Bán hàng', label: 'Tạo / giữ đơn bán hàng' },
  'invoice.complete': { group: 'Bán hàng', label: 'Thanh toán / hoàn thành hóa đơn' },
  'invoice.cancel': { group: 'Bán hàng', label: 'Hủy hóa đơn' },
  'invoice.discount': { group: 'Bán hàng', label: 'Giảm giá dòng / hóa đơn' },
  'invoice.price.edit': { group: 'Bán hàng', label: 'Sửa giá bán trên hóa đơn' },
  'invoice.seller.change': { group: 'Bán hàng', label: 'Chọn nhân viên bán khác' },
  'invoice.pricebook.select': { group: 'Bán hàng', label: 'Chọn bảng giá khi bán' },
  'order.view': { group: 'Đặt hàng & giao hàng', label: 'Xem đơn đặt hàng' },
  'order.create': { group: 'Đặt hàng & giao hàng', label: 'Tạo / sửa đơn đặt hàng, nhận cọc' },
  'order.confirm': { group: 'Đặt hàng & giao hàng', label: 'Xác nhận đơn (giữ tồn)' },
  'order.complete': { group: 'Đặt hàng & giao hàng', label: 'Hoàn tất đơn → hóa đơn' },
  'order.cancel': { group: 'Đặt hàng & giao hàng', label: 'Hủy đơn đặt hàng' },
  'delivery.view': { group: 'Đặt hàng & giao hàng', label: 'Xem vận đơn' },
  'delivery.manage': { group: 'Đặt hàng & giao hàng', label: 'Tạo / cập nhật vận đơn, thu COD' },
  'shift.view': { group: 'Bán hàng', label: 'Xem ca bán hàng' },
  'shift.open': { group: 'Bán hàng', label: 'Mở ca bán hàng' },
  'shift.close': { group: 'Bán hàng', label: 'Đóng ca & đối soát tiền' },
  'shift.manage': { group: 'Bán hàng', label: 'Quản lý ca của mọi nhân viên' },
  'sales.report.view': { group: 'Bán hàng', label: 'Xem báo cáo doanh thu' },
  'report.profit.view': { group: 'Báo cáo', label: 'Xem báo cáo lãi lỗ (chi phí, thất thoát)' },
  'integration.view': { group: 'Tích hợp', label: 'Xem kết nối & lịch sử nhập dữ liệu' },
  'integration.manage': { group: 'Tích hợp', label: 'Nhập dữ liệu từ KiotViet / Excel, cấu hình kết nối' },
  // Module 07 – returns / exchange
  'return.view': { group: 'Trả hàng', label: 'Xem phiếu trả hàng' },
  'return.create': { group: 'Trả hàng', label: 'Tạo phiếu trả hàng / đổi hàng' },
  'return.complete': { group: 'Trả hàng', label: 'Hoàn thành phiếu trả hàng' },
  'return.cancel': { group: 'Trả hàng', label: 'Hủy phiếu trả hàng' },
  'return.price.edit': { group: 'Trả hàng', label: 'Sửa giá hoàn trả' },
  // Module 08 – cash book & funds
  'cash.view': { group: 'Sổ quỹ', label: 'Xem sổ quỹ / quỹ tiền' },
  'cash.account.manage': { group: 'Sổ quỹ', label: 'Quản lý quỹ tiền / tài khoản ngân hàng' },
  'cash.transfer': { group: 'Sổ quỹ', label: 'Chuyển quỹ / bàn giao ca' },
  'cash.reconcile': { group: 'Sổ quỹ', label: 'Kiểm quỹ' },
  'payment.other': { group: 'Sổ quỹ', label: 'Lập phiếu thu / chi khác (không gắn đối tác)' },
  'debt.offset': { group: 'Sổ quỹ', label: 'Cấn trừ công nợ khách hàng ↔ nhà cung cấp' },
  // Module 08 foundation – payments
  'payment.view': { group: 'Sổ quỹ', label: 'Xem phiếu thu / chi' },
  'payment.create': { group: 'Sổ quỹ', label: 'Lập phiếu thu / chi' },
  'payment.cancel': { group: 'Sổ quỹ', label: 'Hủy phiếu thu / chi' },
} as const;

export type PermissionCode = keyof typeof PERMISSIONS | '*';
export const ALL_PERMISSION_CODES = Object.keys(PERMISSIONS) as Array<keyof typeof PERMISSIONS>;

/** Returns true if the granted set satisfies the required code ("*" = everything, "group.*" = group wildcard). */
export function hasPermission(granted: ReadonlySet<string> | string[], required: string): boolean {
  const set = granted instanceof Set ? granted : new Set(granted);
  if (set.has('*')) return true;
  if (set.has(required)) return true;
  const parts = required.split('.');
  for (let i = parts.length - 1; i > 0; i--) {
    if (set.has(parts.slice(0, i).join('.') + '.*')) return true;
  }
  return false;
}
