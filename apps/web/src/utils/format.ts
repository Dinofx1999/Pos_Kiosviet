import dayjs from 'dayjs';

const vnd = new Intl.NumberFormat('vi-VN', { maximumFractionDigits: 0 });
const vndDec = new Intl.NumberFormat('vi-VN', { maximumFractionDigits: 2 });
const qtyFmt = new Intl.NumberFormat('vi-VN', { maximumFractionDigits: 3 });

export function toNum(v: unknown): number {
  if (v === null || v === undefined || v === '') return 0;
  const n = typeof v === 'number' ? v : Number(String(v));
  return Number.isFinite(n) ? n : 0;
}
export function money(v: unknown): string {
  const n = toNum(v);
  return Number.isInteger(n) ? vnd.format(n) : vndDec.format(n);
}
export function qty(v: unknown): string {
  return qtyFmt.format(toNum(v));
}
export function signedQty(v: unknown): string {
  const n = toNum(v);
  return (n > 0 ? '+' : '') + qtyFmt.format(n);
}
export function dt(v?: string | Date | null, fmt = 'DD/MM/YYYY HH:mm'): string {
  return v ? dayjs(v).format(fmt) : '';
}
export function d(v?: string | Date | null): string {
  return v ? dayjs(v).format('DD/MM/YYYY') : '';
}
export function pct(v: unknown): string {
  return v === null || v === undefined || v === '' ? '' : `${toNum(v)}%`;
}
/** InputNumber formatter/parser for VND style thousands separators. */
export const moneyFormatter = (value?: string | number) => {
  if (value === undefined || value === null || value === '') return '';
  // thousands separator on the integer part only; decimals (if any) after a comma – e.g. 221666.6667 → 221.666,6667
  const [int, dec] = String(value).split('.');
  const grouped = int.replace(/\B(?=(\d{3})+(?!\d))/g, '.');
  return dec !== undefined ? `${grouped},${dec}` : grouped;
};
export const moneyParser = (value?: string) => (value ? value.replace(/\./g, '').replace(/,/g, '.') : '') as unknown as number;

export const DOC_TYPE_LABEL: Record<string, string> = { RECEIPT: 'Nhập kho', ISSUE: 'Xuất kho', ADJUSTMENT: 'Điều chỉnh' };
export const DOC_STATUS_LABEL: Record<string, string> = { DRAFT: 'Phiếu tạm', POSTED: 'Đã ghi sổ', CANCELLED: 'Đã hủy' };
export const DOC_STATUS_COLOR: Record<string, string> = { DRAFT: 'default', POSTED: 'green', CANCELLED: 'red' };
export const MOVEMENT_LABEL: Record<string, string> = { RECEIPT: 'Nhập kho', ISSUE: 'Xuất kho', ADJUSTMENT: 'Điều chỉnh', REVERSAL: 'Hủy/đảo', PURCHASE: 'Nhập hàng', PURCHASE_RETURN: 'Trả hàng nhập', SALE: 'Bán hàng', SALE_RETURN: 'Trả hàng', TRANSFER_OUT: 'Chuyển đi', TRANSFER_IN: 'Nhận chuyển', STOCKTAKE: 'Kiểm kho' };
export const REASON_LABEL: Record<string, string> = { DAMAGE: 'Hàng hỏng / hủy', INTERNAL_USE: 'Sử dụng nội bộ', LOSS: 'Thất thoát', OTHER: 'Khác', OPENING: 'Tồn đầu kỳ', COUNT: 'Kiểm đếm', RETURN_TO_STOCK: 'Nhập lại kho', CANCEL: 'Hủy phiếu' };
export const PRODUCT_TYPE_LABEL: Record<string, string> = { GOODS: 'Hàng hóa', SERVICE: 'Dịch vụ', COMBO: 'Combo' };
export const USER_STATUS_LABEL: Record<string, string> = { ACTIVE: 'Đang hoạt động', LOCKED: 'Đã khóa', DISABLED: 'Ngừng' };

export function downloadBlob(blob: Blob, filename: string) {
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url; a.download = filename; document.body.appendChild(a); a.click(); a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 2000);
}
export const uuid = () => (typeof crypto !== 'undefined' && 'randomUUID' in crypto ? crypto.randomUUID() : `${Date.now()}-${Math.random().toString(16).slice(2)}`);

export const PO_STATUS_LABEL: Record<string, string> = { DRAFT: 'Phiếu tạm', CONFIRMED: 'Đã xác nhận', PARTIAL: 'Nhập một phần', RECEIVED: 'Đã nhập đủ', CANCELLED: 'Đã hủy' };
export const PO_STATUS_COLOR: Record<string, string> = { DRAFT: 'default', CONFIRMED: 'blue', PARTIAL: 'gold', RECEIVED: 'green', CANCELLED: 'red' };
export const PDOC_STATUS_LABEL: Record<string, string> = { DRAFT: 'Phiếu tạm', POSTED: 'Hoàn thành', CANCELLED: 'Đã hủy' };
export const PAYMENT_METHOD_LABEL: Record<string, string> = { CASH: 'Tiền mặt', BANK_TRANSFER: 'Chuyển khoản', CARD: 'Thẻ', EWALLET: 'Ví điện tử', OTHER: 'Khác' };
export const LEDGER_TYPE_LABEL: Record<string, string> = { PURCHASE: 'Nhập hàng', PURCHASE_RETURN: 'Trả hàng nhập', PAYMENT: 'Thanh toán', REFUND: 'Hoàn tiền', SALE: 'Bán hàng', SALE_RETURN: 'Trả hàng bán', RECEIPT: 'Thu tiền', ADJUSTMENT: 'Điều chỉnh', OPENING: 'Đầu kỳ', REVERSAL: 'Hủy / đảo' };
export const LEDGER_DOC_PATH: Record<string, (id: string, code: string) => string> = {
  PURCHASE_RECEIPT: (_id, code) => `/purchase-receipts?search=${code}`,
  PURCHASE_RETURN: (_id, code) => `/purchase-returns?search=${code}`,
  PAYMENT: (_id, code) => `/payments?search=${code}`,
};

export const INVOICE_STATUS_LABEL: Record<string, string> = { DRAFT: 'Giữ đơn', COMPLETED: 'Hoàn thành', CANCELLED: 'Đã hủy' };
export const INVOICE_STATUS_COLOR: Record<string, string> = { DRAFT: 'gold', COMPLETED: 'green', CANCELLED: 'red' };
export const SHIFT_STATUS_LABEL: Record<string, string> = { OPEN: 'Đang mở', CLOSED: 'Đã đóng' };
export const GENDER_LABEL: Record<string, string> = { MALE: 'Nam', FEMALE: 'Nữ', OTHER: 'Khác' };
LEDGER_DOC_PATH.INVOICE = (_id, code) => `/invoices?search=${code}`;
LEDGER_DOC_PATH.SUPPLIER = () => '/suppliers';
LEDGER_DOC_PATH.CUSTOMER = () => '/customers';
