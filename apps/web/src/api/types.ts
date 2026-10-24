export interface Paginated<T> { data: T[]; meta: { page: number; pageSize: number; total: number } }
export interface ApiError { code: string; message: string; statusCode?: number; details?: Record<string, any> }

export interface Tenant { id: string; code: string; name: string; status: string; planCode: string; currency: string; timezone: string }
export interface UserBrief { id: string; username: string; fullName: string; email?: string | null; phone?: string | null; isOwner: boolean; allBranches: boolean; status: string; lastLoginAt?: string | null }
export interface Branch { id: string; code: string; name: string; address?: string | null; phone?: string | null; email?: string | null; isDefault: boolean; isActive: boolean; _count?: { warehouses: number }; warehouses?: Warehouse[] }
export interface Warehouse { id: string; branchId: string; code: string; name: string; address?: string | null; isDefault: boolean; isActive: boolean; branchName?: string; branch?: { id: string; name: string; code: string } }
export interface Me { user: UserBrief & { roles: { id: string; code: string; name: string }[] }; tenant: Tenant; permissions: string[]; branches: Branch[]; warehouses: Warehouse[]; settings: Record<string, unknown> }
export interface Tokens { accessToken: string; refreshToken: string; expiresIn: number }

export interface Category { id: string; parentId?: string | null; name: string; sortOrder: number; isActive: boolean; productCount?: number; children?: Category[] }
export interface Brand { id: string; name: string; isActive: boolean; _count?: { products: number } }
export interface Unit { id: string; name: string }

export interface Variant {
  id: string; productId: string; sku: string; barcode?: string | null; name: string; attributes?: Record<string, string> | null;
  sellPrice: string; costPrice?: string; lastPurchasePrice?: string | null; onHandTotal: string; onHand?: string; minStock?: string | null; maxStock?: string | null;
  imageUrl?: string | null; isDefault: boolean; isActive: boolean;
}
export interface ProductImage { id?: string; url: string; sortOrder: number; variantId?: string | null }
export interface UploadedImage { url: string; fileName: string; size: number; mimeType: string }
export interface ProductUnit { id?: string; unitName: string; conversionFactor: string; sku?: string | null; barcode?: string | null; sellPrice?: string | null }
export interface ComboItem { id?: string; componentVariantId: string; quantity: string; componentVariant?: { id: string; sku: string; name: string; sellPrice: string; costPrice?: string; onHandTotal: string } }
export interface Product {
  id: string; code: string; name: string; type: 'GOODS' | 'SERVICE' | 'COMBO'; categoryId?: string | null; brandId?: string | null; baseUnit?: string | null; description?: string | null;
  taxRate?: string | null; weight?: string | null; trackBatch: boolean; trackSerial: boolean; allowSale: boolean; isActive: boolean; hasVariants: boolean; attributeNames: string[]; imageUrl?: string | null;
  createdAt: string; updatedAt: string; category?: { id: string; name: string } | null; brand?: { id: string; name: string } | null;
  variants: Variant[]; units: ProductUnit[]; images: ProductImage[]; comboItems: ComboItem[]; onHand: string; sellPrice?: string; costPrice?: string;
  balances?: Balance[];
}
export interface SearchHit extends Variant { product: { id: string; code: string; name: string; type: string; baseUnit?: string | null; trackBatch: boolean; imageUrl?: string | null }; available: string; unit?: { unitName: string; conversionFactor: string; sellPrice?: string | null } }
export interface Batch { id: string; variantId: string; batchNo: string; mfgDate?: string | null; expiryDate?: string | null; balances?: { warehouseId: string; onHand: string; reserved: string }[] }

export interface Balance {
  id: string; warehouseId: string; variantId: string; batchId?: string | null; onHand: string; reserved: string; incoming: string; available?: string; value?: string;
  variant?: { id: string; sku: string; barcode?: string | null; name: string; costPrice: string; sellPrice: string; minStock?: string | null; maxStock?: string | null; onHandTotal: string; product: { id: string; code: string; name: string; baseUnit?: string | null } };
  warehouse?: { id: string; code: string; name: string }; batch?: { id: string; batchNo: string; expiryDate?: string | null } | null;
}
export interface BalanceSummary { skuCount: number; onHandTotal: string; reservedTotal: string; stockValue?: string; lowStockCount: number }
export interface Movement {
  id: string; warehouseId: string; variantId: string; type: string; quantity: string; unitCost: string; totalCost: string; balanceAfter: string; documentType: string; documentId: string; documentCode: string; reason?: string | null; note?: string | null; createdAt: string;
  variant?: { id: string; sku: string; name: string; product: { code: string; name: string; baseUnit?: string | null } }; warehouse?: { id: string; name: string }; batch?: { batchNo: string } | null;
}
export interface DocLine { id: string; lineNo: number; variantId: string; batchId?: string | null; quantity: string; systemQuantity?: string | null; actualQuantity?: string | null; unitCost: string; totalCost: string; note?: string | null; variant: { id: string; sku: string; barcode?: string | null; name: string; product: { id: string; code: string; name: string; baseUnit?: string | null; trackBatch: boolean } }; batch?: { id: string; batchNo: string; expiryDate?: string | null } | null }
export interface InventoryDocument {
  id: string; code: string; type: 'RECEIPT' | 'ISSUE' | 'ADJUSTMENT'; status: 'DRAFT' | 'POSTED' | 'CANCELLED'; branchId: string; warehouseId: string; reason?: string | null; note?: string | null;
  totalQuantity: string; totalCost: string; postedAt?: string | null; cancelledAt?: string | null; cancelReason?: string | null; version: number; createdById?: string | null; createdAt: string;
  warehouse?: { id: string; name: string; code?: string }; branch?: { id: string; name: string; code?: string }; _count?: { lines: number }; lines?: DocLine[]; movements?: Movement[];
}
export interface Reservation { id: string; warehouseId: string; variantId: string; quantity: string; status: string; documentType: string; documentId: string; createdAt: string; variant?: { sku: string; name: string }; warehouse?: { name: string } }

export interface Role { id: string; code: string; name: string; description?: string | null; isSystem: boolean; permissions: string[]; userCount: number }
export interface PermissionGroup { group: string; permissions: { code: string; label: string }[] }
export interface UserRow extends UserBrief { createdAt: string; roles: { id: string; code: string; name: string }[]; branchIds: string[]; warehouseIds: string[] }
export interface AuditLog { id: string; userId?: string | null; username?: string | null; action: string; entityType: string; entityId?: string | null; entityCode?: string | null; before?: unknown; after?: unknown; metadata?: unknown; ip?: string | null; createdAt: string }
export interface LoginHistory { id: string; username: string; success: boolean; reason?: string | null; ip?: string | null; userAgent?: string | null; createdAt: string }
export interface SequenceRow { docType: string; prefix: string; padding: number; resetPolicy: 'NEVER' | 'YEARLY' | 'MONTHLY'; nextNumber: number }
export interface PriceBook { id: string; code: string; name: string; status: 'ACTIVE' | 'INACTIVE'; isDefault: boolean; priority: number; startsAt?: string | null; endsAt?: string | null; branches?: { branchId: string }[]; _count?: { items: number }; items?: { variantId: string; price: string; minQuantity: string; variant: { id: string; sku: string; name: string; sellPrice: string } }[] }

export interface DashboardOverview {
  products: number; variants: number; warehouses: number; skuCount: number; onHandTotal: string; reservedTotal: string; stockValue?: string; lowStockCount: number;
  salesToday?: { invoices: number; revenue: string; grossProfit: string; byMethod: { method: string; amount: string; count: number }[] };
  recentMovements: Movement[]; recentDocuments: InventoryDocument[]; documentsByDay: { day: string; type: string; count: number; totalCost: string }[]; productsByCategory: { categoryId: string | null; name: string; count: number }[];
}

// ---------------- Module 04 – purchasing / finance
export interface Supplier { id: string; code: string; name: string; phone?: string | null; email?: string | null; address?: string | null; taxCode?: string | null; contactName?: string | null; groupName?: string | null; note?: string | null; isActive: boolean; createdAt: string; balance?: string; stats?: { receipts: number; purchased: string; returns: number; returned: string; lastReceipt?: { code: string; receiptDate: string; totalAmount: string } | null } }
export interface LedgerEntry { id: string; partyType: string; partyId: string; type: string; amount: string; balanceAfter: string; documentType: string; documentId: string; documentCode: string; note?: string | null; createdAt: string }
export interface SupplierHistory {
  receipts: { id: string; code: string; status: string; receiptDate: string; totalAmount: string; paidAmount: string; returnedAmount: string; warehouse?: { name: string } }[];
  returns: { id: string; code: string; status: string; returnDate: string; totalAmount: string; refundedAmount: string; receipt?: { code: string } }[];
  payments: { id: string; code: string; status: string; direction: 'IN' | 'OUT'; method: string; paymentDate: string; amount: string; allocated: string }[];
}
export interface VariantBrief { id: string; sku: string; barcode?: string | null; name: string; product: { id: string; code: string; name: string; baseUnit?: string | null; trackBatch?: boolean } }
export type PurchaseOrderStatus = 'DRAFT' | 'CONFIRMED' | 'PARTIAL' | 'RECEIVED' | 'CANCELLED';
export type PurchaseDocStatus = 'DRAFT' | 'POSTED' | 'CANCELLED';
export interface PurchaseOrderLine { id: string; lineNo: number; variantId: string; quantity: string; receivedQuantity: string; remainingQuantity?: string; unitPrice: string; discountAmount: string; taxRate: string; lineTotal: string; note?: string | null; variant: VariantBrief }
export interface PurchaseOrder {
  id: string; code: string; status: PurchaseOrderStatus; branchId: string; warehouseId: string; supplierId: string; orderDate: string; expectedDate?: string | null; note?: string | null;
  subtotal: string; discountAmount: string; taxAmount: string; totalAmount: string; version: number; confirmedAt?: string | null; cancelledAt?: string | null; cancelReason?: string | null; createdAt: string;
  supplier?: { id: string; code: string; name: string; phone?: string | null }; warehouse?: { id: string; name: string; code?: string }; branch?: { id: string; name: string };
  lines?: PurchaseOrderLine[]; receipts?: { id: string; code: string; status: string; receiptDate: string; totalAmount: string }[]; _count?: { lines: number; receipts: number };
}
export interface PurchaseReceiptLine { id: string; lineNo: number; orderLineId?: string | null; variantId: string; batchId?: string | null; quantity: string; returnedQuantity: string; returnableQuantity?: string; returnUnitPrice?: string | null; unitPrice: string; discountAmount: string; taxRate: string; taxAmount: string; lineTotal: string; allocatedCost: string; unitCost: string; note?: string | null; variant: VariantBrief; batch?: { id: string; batchNo: string; expiryDate?: string | null } | null }
export interface PurchaseReceiptCost { id?: string; name: string; amount: string; allocationMethod: 'BY_VALUE' | 'BY_QUANTITY'; payToSupplier: boolean }
export interface PurchaseReceipt {
  id: string; code: string; status: PurchaseDocStatus; branchId: string; warehouseId: string; supplierId: string; orderId?: string | null; receiptDate: string; supplierInvoiceNo?: string | null; note?: string | null;
  subtotal: string; discountAmount: string; taxAmount: string; landedCostTotal: string; totalAmount: string; paidAmount: string; returnedAmount: string; dueAmount?: string; version: number;
  postedAt?: string | null; cancelledAt?: string | null; cancelReason?: string | null; createdAt: string;
  supplier?: { id: string; code: string; name: string; phone?: string | null }; order?: { id: string; code: string; status: string } | null; warehouse?: { id: string; name: string; code?: string }; branch?: { id: string; name: string };
  lines?: PurchaseReceiptLine[]; costs?: PurchaseReceiptCost[]; returns?: { id: string; code: string; status: string; totalAmount: string; returnDate: string }[]; movements?: Movement[];
  payments?: { id: string; amount: string; payment: { id: string; code: string; status: string; method: string; paymentDate: string; amount: string } }[]; _count?: { lines: number };
}
export interface PurchaseReturnLine { id: string; lineNo: number; receiptLineId: string; variantId: string; batchId?: string | null; quantity: string; unitPrice: string; lineTotal: string; note?: string | null; variant: VariantBrief; receiptLine?: { id: string; quantity: string; returnedQuantity: string; unitPrice: string; batch?: { batchNo: string } | null } }
export interface PurchaseReturn {
  id: string; code: string; status: PurchaseDocStatus; branchId: string; warehouseId: string; supplierId: string; receiptId: string; returnDate: string; reason?: string | null; note?: string | null;
  totalAmount: string; refundedAmount: string; version: number; postedAt?: string | null; cancelledAt?: string | null; cancelReason?: string | null; createdAt: string;
  supplier?: { id: string; code: string; name: string }; receipt?: { id: string; code: string; receiptDate?: string; totalAmount?: string }; warehouse?: { id: string; name: string }; branch?: { id: string; name: string };
  lines?: PurchaseReturnLine[]; movements?: Movement[]; refunds?: { id: string; amount: string; payment: { id: string; code: string; status: string; method: string; paymentDate: string; amount: string } }[]; _count?: { lines: number };
}
export interface PaymentAllocation { id: string; documentType: string; documentId: string; amount: string; document?: { id: string; code: string; totalAmount: string; paidAmount?: string; refundedAmount?: string } | null }
export interface Payment {
  id: string; code: string; branchId: string; direction: 'IN' | 'OUT'; method: string; partyType?: string | null; partyId?: string | null; amount: string; allocated: string; paymentDate: string; reference?: string | null; note?: string | null;
  status: 'POSTED' | 'CANCELLED'; cancelledAt?: string | null; cancelReason?: string | null; createdAt: string; allocations: PaymentAllocation[]; party?: { id: string; code: string; name: string } | null;
}
export interface PurchaseSummary {
  from: string | null; to: string | null; groupBy: string;
  totals: { receipts: number; purchased: string; returned: string; paidOut: string; refundedIn: string };
  byPeriod: { period: string; receipts: number; purchased: string; returned: string; paidOut: string }[];
  bySupplier: { supplierId: string; code: string; name: string; receipts: number; purchased: string; returned: string; paid: string }[];
  topProducts: { variantId: string; sku: string; name: string; quantity: string; amount: string }[];
}
export interface SupplierDebt { total: string; suppliers: { id: string; code: string; name: string; phone?: string | null; balance: string; receipts: number; purchased: string; paid: string }[] }

// ---------------- Module 05 – sales / POS, Module 07 foundation – customers
export interface Customer { id: string; code: string; name: string; phone?: string | null; email?: string | null; address?: string | null; gender?: string | null; birthday?: string | null; taxCode?: string | null; groupName?: string | null; note?: string | null; creditLimit?: string | null; isActive: boolean; createdAt: string; balance?: string; stats?: { invoices: number; revenue: string; lastInvoice?: { code: string; invoiceDate: string; totalAmount: string } | null } }
export interface CustomerHit { id: string; code: string; name: string; phone?: string | null; groupName?: string | null; creditLimit?: string | null; balance?: string }
export interface CustomerHistory { invoices: { id: string; code: string; status: string; invoiceDate: string; totalAmount: string; paidAmount: string; branch?: { name: string } }[]; payments: { id: string; code: string; status: string; direction: 'IN' | 'OUT'; method: string; paymentDate: string; amount: string; allocated: string }[] }
export interface CustomerDebt { total: string; customers: { id: string; code: string; name: string; phone?: string | null; creditLimit?: string | null; balance: string; invoices: number; revenue: string; paid: string }[] }
export type ShiftStatus = 'OPEN' | 'CLOSED';
export interface Shift {
  id: string; code: string; status: ShiftStatus; branchId: string; userId: string; openedAt: string; closedAt?: string | null; openingCash: string; expectedCash?: string | null; countedCash?: string | null; difference?: string | null; note?: string | null; createdAt: string;
  user?: { id: string; username: string; fullName: string }; branch?: { id: string; name: string }; _count?: { invoices: number; payments: number };
  invoices?: number; revenue?: string; collected?: string; byMethod?: { method: string; in: string; out: string; net: string }[];
}
export type InvoiceStatus = 'DRAFT' | 'COMPLETED' | 'CANCELLED';
export interface InvoiceLine { id: string; lineNo: number; variantId: string; batchId?: string | null; productUnitId?: string | null; unitName?: string | null; conversionFactor: string; quantity: string; baseQuantity: string; returnedQuantity: string; listPrice: string; unitPrice: string; discountAmount: string; taxRate: string; taxAmount: string; lineTotal: string; unitCost?: string; costTotal?: string; note?: string | null; variant: VariantBrief & { product: { type?: string } }; batch?: { id: string; batchNo: string } | null }
export interface Invoice {
  id: string; code: string; status: InvoiceStatus; branchId: string; warehouseId: string; customerId?: string | null; shiftId?: string | null; sellerId?: string | null; priceBookId?: string | null; invoiceDate: string;
  subtotal: string; discountAmount: string; taxAmount: string; totalAmount: string; paidAmount: string; costTotal?: string; returnedAmount: string; dueAmount?: string; note?: string | null; version: number;
  completedAt?: string | null; cancelledAt?: string | null; cancelReason?: string | null; createdAt: string;
  customer?: { id: string; code: string; name: string; phone?: string | null } | null; seller?: { id: string; username?: string; fullName: string } | null; branch?: { id: string; code?: string; name: string; address?: string | null; phone?: string | null }; warehouse?: { id: string; code?: string; name: string }; shift?: { id: string; code: string } | null;
  lines?: InvoiceLine[]; payments?: { id: string; amount: string; payment: { id: string; code: string; status: string; method: string; paymentDate: string; amount: string; reference?: string | null } }[]; movements?: Movement[]; _count?: { lines: number };
}
export interface PosPrice { variantId: string; productUnitId: string | null; unitName?: string | null; conversionFactor: string; listPrice: string; source: 'PRODUCT' | 'UNIT' | 'PRICE_BOOK'; taxRate: string }
export interface SalesSummary {
  from: string | null; to: string | null; groupBy: string;
  totals: { invoices: number; cancelled: number; revenue: string; cost: string; grossProfit: string; discount: string; paid: string; debt: string };
  byPeriod: { period: string; invoices: number; revenue: string; cost: string; grossProfit: string; discount: string; paid: string }[];
  bySeller: { sellerId: string | null; name: string; invoices: number; revenue: string; grossProfit: string }[];
  byBranch: { branchId: string; name: string; invoices: number; revenue: string; grossProfit: string }[];
  byProduct: { variantId: string; sku: string; name: string; quantity: string; revenue: string; grossProfit: string }[];
  byMethod: { method: string; amount: string; count: number }[];
}

// ---------------- Module 07 – sales returns / exchanges (BR-60..BR-66)
export type ReturnCondition = 'RESTOCK' | 'DAMAGED';
export interface SalesReturnBrief { id: string; code: string; status: InvoiceStatus; returnDate: string; totalRefund: string; refundedAmount: string; exchangeInvoiceId?: string | null; invoice?: { code: string } | null; exchangeInvoice?: { code: string } | null }
export interface SalesReturnLine {
  id: string; lineNo: number; invoiceLineId: string; variantId: string; batchId?: string | null; unitName?: string | null; conversionFactor: string; quantity: string; baseQuantity: string; unitPrice: string; lineTotal: string; condition: ReturnCondition; unitCost?: string; costTotal?: string; note?: string | null;
  variant: VariantBrief & { product: { type?: string } }; invoiceLine?: { id: string; quantity: string; returnedQuantity: string; unitPrice: string; unitName?: string | null; conversionFactor: string } | null;
}
export interface SalesReturnRefund { id: string; documentType: string; documentId: string; amount: string; payment: { id: string; code: string; status: string; method: string; paymentDate: string; amount: string; reference?: string | null } }
export interface SalesReturn {
  id: string; code: string; status: InvoiceStatus; branchId: string; warehouseId: string; invoiceId: string; customerId?: string | null; shiftId?: string | null; exchangeInvoiceId?: string | null;
  returnDate: string; reason?: string | null; note?: string | null; subtotal: string; feeAmount: string; totalRefund: string; refundedAmount: string; dueRefund: string; restockValue?: string; damagedValue?: string; version: number;
  completedAt?: string | null; cancelledAt?: string | null; cancelReason?: string | null; createdAt: string;
  customer?: { id: string; code: string; name: string; phone?: string | null } | null; invoice?: { id: string; code: string; invoiceDate?: string; totalAmount?: string; customerId?: string | null } | null;
  exchangeInvoice?: { id: string; code: string; totalAmount?: string; paidAmount?: string; status?: string } | null; branch?: { id: string; code?: string; name: string }; warehouse?: { id: string; code?: string; name: string };
  lines?: SalesReturnLine[]; refunds?: SalesReturnRefund[]; movements?: Movement[]; _count?: { lines: number };
}
export interface ReturnableLine extends InvoiceLine { returnableQuantity: string; refundUnitPrice: string }
export interface Returnable { invoice: { id: string; code: string; invoiceDate: string; totalAmount: string; returnedAmount: string; customer?: { id: string; code: string; name: string; phone?: string | null } | null; branchId: string; warehouseId: string }; lines: ReturnableLine[]; maxRefund: string }
export interface ExchangeSettlement { returnValue: string; newTotal: string; offset: string; customerPays: string; refundDue: string }
export interface ExchangeResult { return: SalesReturn; invoice: Invoice; settlement: ExchangeSettlement }
// declaration merging: fields the Module 07 backend added to existing responses
export interface Invoice { returns?: SalesReturnBrief[] }
export interface CustomerHistory { returns?: SalesReturnBrief[] }

// ---------------- Module 09 – promotions on persisted invoices (BR-90..BR-96)
export interface InvoicePromotionRow { id: string; promotionId: string; voucherId?: string | null; type: string; amount: string; giftQuantity: string; promotion?: { id: string; code: string; name: string; type: string } | null; voucher?: { id: string; code: string } | null }
export interface Invoice { promotionDiscount?: string; voucherCode?: string | null; promotions?: InvoicePromotionRow[] }
export interface InvoiceLine { promotionDiscount?: string; promotionId?: string | null; isGift?: boolean }
