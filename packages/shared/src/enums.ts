export const PRODUCT_TYPES = ['GOODS', 'SERVICE', 'COMBO'] as const;
export type ProductType = (typeof PRODUCT_TYPES)[number];

export const INVENTORY_DOC_TYPES = ['RECEIPT', 'ISSUE', 'ADJUSTMENT'] as const;
export type InventoryDocType = (typeof INVENTORY_DOC_TYPES)[number];

export const INVENTORY_DOC_STATUSES = ['DRAFT', 'POSTED', 'CANCELLED'] as const;
export type InventoryDocStatus = (typeof INVENTORY_DOC_STATUSES)[number];

export const ISSUE_REASONS = ['DAMAGE', 'INTERNAL_USE', 'LOSS', 'OTHER'] as const;
export type IssueReason = (typeof ISSUE_REASONS)[number];

export const MOVEMENT_TYPES = [
  'RECEIPT', 'ISSUE', 'ADJUSTMENT', 'REVERSAL',
  'PURCHASE', 'PURCHASE_RETURN', 'SALE', 'SALE_RETURN',
  'TRANSFER_OUT', 'TRANSFER_IN', 'STOCKTAKE',
] as const;
export type MovementType = (typeof MOVEMENT_TYPES)[number];

/** Document-number prefixes (editable per tenant in document_sequences). */
export const DOC_SEQUENCE_DEFAULTS: Record<string, { prefix: string; padding: number }> = {
  PRODUCT: { prefix: 'SP', padding: 6 },
  INVENTORY_RECEIPT: { prefix: 'NK', padding: 6 },
  INVENTORY_ISSUE: { prefix: 'XK', padding: 6 },
  INVENTORY_ADJUSTMENT: { prefix: 'DC', padding: 6 },
  SUPPLIER: { prefix: 'NCC', padding: 6 },
  CUSTOMER: { prefix: 'KH', padding: 6 },
  SHIFT: { prefix: 'CA', padding: 6 },
  PURCHASE_ORDER: { prefix: 'PDN', padding: 6 },
  PURCHASE_RECEIPT: { prefix: 'PN', padding: 6 },
  PURCHASE_RETURN: { prefix: 'THN', padding: 6 },
  SALES_ORDER: { prefix: 'DH', padding: 6 },
  INVOICE: { prefix: 'HD', padding: 6 },
  SALES_RETURN: { prefix: 'TH', padding: 6 },
  TRANSFER: { prefix: 'CH', padding: 6 },
  STOCKTAKE: { prefix: 'KK', padding: 6 },
  CASH_RECEIPT: { prefix: 'PT', padding: 6 },
  CASH_PAYMENT: { prefix: 'PC', padding: 6 },
  CASH_ACCOUNT: { prefix: 'QT', padding: 4 },
  CASH_TRANSFER: { prefix: 'CQ', padding: 6 },
  PROMOTION: { prefix: 'KM', padding: 4 },
  DELIVERY: { prefix: 'GH', padding: 6 },
};

export const TENANT_SETTING_KEYS = {
  ALLOW_NEGATIVE_STOCK: 'inventory.allowNegativeStock',
  COSTING_METHOD: 'inventory.costingMethod', // AVG only for now
  CURRENCY: 'general.currency',
  PRICE_INCLUDES_TAX: 'pricing.priceIncludesTax',
  PURCHASE_TAX_IN_COST: 'purchasing.includeTaxInCost',
  POS_REQUIRE_SHIFT: 'pos.requireOpenShift', // bắt buộc mở ca trước khi bán
  POS_ALLOW_CREDIT: 'pos.allowCreditSales', // cho phép bán nợ (khách trả sau)
  CASH_ALLOW_NEGATIVE: 'cash.allowNegativeBalance', // cho phép quỹ tiền âm (phiếu chi vượt tồn quỹ)
  LOYALTY_ENABLED: 'loyalty.enabled', // tích điểm
  LOYALTY_EARN_POINTS: 'loyalty.earnPoints', // số điểm nhận được cho mỗi loyalty.earnPerAmount đồng
  LOYALTY_EARN_PER_AMOUNT: 'loyalty.earnPerAmount', // số tiền (đ) để nhận earnPoints điểm
  LOYALTY_REDEEM_VALUE: 'loyalty.redeemValue', // giá trị (đ) của 1 điểm khi tiêu
  LOYALTY_MIN_REDEEM: 'loyalty.minRedeemPoints', // số điểm tối thiểu mỗi lần tiêu
  LOYALTY_MAX_REDEEM_PERCENT: 'loyalty.maxRedeemPercent', // tối đa % giá trị hóa đơn được thanh toán bằng điểm
  POS_MAX_DISCOUNT_PERCENT: 'pos.maxDiscountPercent', // trần giảm giá dòng/hóa đơn (%) cho người có invoice.discount
  RETURN_MAX_DAYS: 'sales.returnMaxDays', // số ngày tối đa được trả hàng kể từ ngày bán (0 = không giới hạn) // thuế mua hàng tính vào giá vốn (mặc định true: không khấu trừ VAT)
} as const;

export const PAYMENT_METHODS = ['CASH', 'BANK_TRANSFER', 'CARD', 'EWALLET', 'OTHER', 'OFFSET', 'TRANSFER', 'POINTS'] as const;
export type PaymentMethod = (typeof PAYMENT_METHODS)[number];
export const PAYMENT_METHOD_LABELS: Record<PaymentMethod, string> = { CASH: 'Tiền mặt', BANK_TRANSFER: 'Chuyển khoản', CARD: 'Thẻ', EWALLET: 'Ví điện tử', OTHER: 'Khác', OFFSET: 'Cấn trừ', TRANSFER: 'Chuyển quỹ', POINTS: 'Điểm tích lũy' };
export const CASH_ACCOUNT_TYPES = ['CASH', 'BANK', 'EWALLET'] as const;
/** Methods a cashier may pick at the counter (OFFSET is system-generated for exchanges / debt netting). */
export const CASH_PAYMENT_METHODS = ['CASH', 'BANK_TRANSFER', 'CARD', 'EWALLET', 'OTHER'] as const;
export const RETURN_CONDITIONS = ['RESTOCK', 'DAMAGED'] as const;
export const PURCHASE_ORDER_STATUSES = ['DRAFT', 'CONFIRMED', 'PARTIAL', 'RECEIVED', 'CANCELLED'] as const;
export const PURCHASE_DOC_STATUSES = ['DRAFT', 'POSTED', 'CANCELLED'] as const;
export const COST_ALLOCATION_METHODS = ['BY_VALUE', 'BY_QUANTITY'] as const;

export const INVOICE_STATUSES = ['DRAFT', 'COMPLETED', 'CANCELLED'] as const;
export const SHIFT_STATUSES = ['OPEN', 'CLOSED'] as const;
export const POS_SHORTCUTS = { search: 'F3', customer: 'F4', discount: 'F6', hold: 'F7', pay: 'F9', newTab: 'F2' } as const;

export const PROMOTION_TYPES = ['INVOICE_DISCOUNT', 'INVOICE_GIFT', 'PRODUCT_DISCOUNT', 'BUY_X_GET_Y', 'VOUCHER'] as const;
export type PromotionType = (typeof PROMOTION_TYPES)[number];
export const PROMOTION_TYPE_LABELS: Record<PromotionType, string> = { INVOICE_DISCOUNT: 'Giảm giá hóa đơn', INVOICE_GIFT: 'Tặng hàng theo hóa đơn', PRODUCT_DISCOUNT: 'Giảm giá hàng hóa', BUY_X_GET_Y: 'Mua X tặng Y', VOUCHER: 'Voucher / mã giảm giá' };

export const SALES_ORDER_STATUSES = ['DRAFT', 'CONFIRMED', 'COMPLETED', 'CANCELLED'] as const;
export const DELIVERY_STATUSES = ['PENDING', 'PICKING', 'DELIVERING', 'DELIVERED', 'RETURNING', 'RETURNED', 'CANCELLED'] as const;
export const DELIVERY_STATUS_LABELS: Record<(typeof DELIVERY_STATUSES)[number], string> = { PENDING: 'Chờ xử lý', PICKING: 'Chờ lấy hàng', DELIVERING: 'Đang giao', DELIVERED: 'Đã giao', RETURNING: 'Đang chuyển hoàn', RETURNED: 'Đã chuyển hoàn', CANCELLED: 'Đã hủy' };

/** Gói dịch vụ SaaS (Module 14): hạn mức theo gói; null = không giới hạn. */
export const PLANS = {
  FREE: { name: 'Dùng thử', branches: 1, warehouses: 2, users: 3, products: 500, trialDays: 30 },
  BASIC: { name: 'Cơ bản', branches: 1, warehouses: 3, users: 5, products: 5000, trialDays: 0 },
  PRO: { name: 'Chuyên nghiệp', branches: 5, warehouses: 20, users: 30, products: 50000, trialDays: 0 },
  ENTERPRISE: { name: 'Doanh nghiệp', branches: null, warehouses: null, users: null, products: null, trialDays: 0 },
} as const;
export type PlanCode = keyof typeof PLANS;
