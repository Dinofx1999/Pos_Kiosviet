# API Contracts (v1)

Base URL: `/api/v1`. Tài liệu OpenAPI sinh tự động tại `GET /api/docs` (Swagger UI) và `GET /api/docs-json`.

## Quy ước chung
* Auth: `Authorization: Bearer <access_token>`. Tenant lấy từ token.
* Phân trang: `?page=1&pageSize=20&search=&sortBy=createdAt&sortDir=desc`. Phản hồi danh sách:
  ```json
  { "data": [...], "meta": { "page": 1, "pageSize": 20, "total": 123 } }
  ```
* Lỗi:
  ```json
  { "statusCode": 409, "code": "INSUFFICIENT_STOCK", "message": "Không đủ tồn kho", "details": {...}, "path": "...", "timestamp": "..." }
  ```
  Mã lỗi nghiệp vụ: `VALIDATION_ERROR`, `UNAUTHORIZED`, `FORBIDDEN`, `BRANCH_ACCESS_DENIED`, `WAREHOUSE_ACCESS_DENIED`, `NOT_FOUND`, `DUPLICATE_CODE`, `DUPLICATE_SKU`, `DUPLICATE_BARCODE`, `PRODUCT_IN_USE`, `INSUFFICIENT_STOCK`, `DOCUMENT_NOT_DRAFT`, `DOCUMENT_NOT_POSTED`, `DOCUMENT_NOT_EDITABLE`, `BATCH_REQUIRED`, `BATCH_NOT_ALLOWED`, `IDEMPOTENCY_KEY_REUSED`, `IDEMPOTENCY_IN_PROGRESS`, `VERSION_CONFLICT`.
* Idempotency: header `Idempotency-Key: <uuid>` cho `POST` tạo/ghi sổ/hủy chứng từ. Replay trả header `Idempotent-Replayed: true`.
* Số tiền/số lượng trả về dạng **string** decimal (vd `"12500.0000"`) để không mất chính xác; client parse bằng thư viện decimal hoặc Number khi hiển thị.

## Auth
| Method | Path | Body | Trả về |
|---|---|---|---|
| POST | `/auth/register-tenant` | `{tenantCode, tenantName, ownerUsername, ownerPassword, ownerFullName, email?}` | `{tenant, user, tokens}` |
| POST | `/auth/login` | `{tenantCode, username, password}` | `{accessToken, refreshToken, expiresIn, user}` |
| POST | `/auth/refresh` | `{refreshToken}` | tokens mới (token cũ bị thu hồi) |
| POST | `/auth/logout` | `{refreshToken}` | 204 |
| GET | `/auth/me` | | `{user, permissions[], branches[], warehouses[], tenant}` |
| POST | `/auth/change-password` | `{currentPassword, newPassword}` | 204 |

## Tổ chức & hệ thống
| Method | Path | Quyền |
|---|---|---|
| GET/POST | `/branches` · PATCH `/branches/:id` | `branch.manage` (GET: bất kỳ user đã đăng nhập, lọc theo quyền chi nhánh) |
| GET/POST | `/warehouses` · PATCH `/warehouses/:id` | `warehouse.manage` |
| GET/POST | `/users` · GET/PATCH `/users/:id` · POST `/users/:id/reset-password` — kèm hồ sơ nhân viên `position, hiredAt, employeeNote` (`baseSalary` chỉ khi người gọi có `employee.manage`); PATCH `hiredAt: null` xóa ngày vào làm | `user.manage` |
| GET/POST | `/roles` · GET/PATCH/DELETE `/roles/:id` · GET `/roles/permissions` | `role.manage` |
| GET | `/settings` · PUT `/settings` `{key: value,...}` | `tenant.settings.manage` |
| GET/PUT | `/settings/sequences` | `tenant.settings.manage` |
| GET | `/audit-logs?entityType=&entityId=&userId=&from=&to=` | `audit.view` |
| GET | `/login-history` | `audit.view` |

## Hàng hóa
| Method | Path | Quyền |
|---|---|---|
| GET | `/categories` (cây) · POST · PATCH/DELETE `/categories/:id` | `product.view` / `category.manage` |
| GET/POST/PATCH/DELETE | `/brands` | `brand.manage` |
| GET/POST/PATCH/DELETE | `/units` | `unit.manage` |
| GET | `/products?search&categoryId&brandId&type&isActive&stockStatus=low|out|in&warehouseId&page&pageSize` | `product.view` |
| GET | `/products/:id` (kèm variants, units, images, combo, tồn theo kho) | `product.view` |
| POST | `/products` `{name, code?, type, categoryId?, brandId?, baseUnit?, taxRate?, trackBatch?, attributeNames?, images?:[{url, sortOrder?, variantId?}] (ảnh đầu = `imageUrl`), variants:[{sku?, barcode?, attributes?, sellPrice, costPrice?, minStock?, maxStock?}], units?:[{unitName, conversionFactor, sku?, barcode?, sellPrice?}], comboItems?:[{componentVariantId, quantity}], initialStock?:[{warehouseId, variantId?, quantity, unitCost}]}` | `product.create` |
| PATCH | `/products/:id` (thông tin chung + upsert variants/units) | `product.update` |
| DELETE | `/products/:id` (xóa cứng nếu chưa dùng, ngược lại 409) | `product.delete` |
| POST | `/products/:id/deactivate` · `/activate` | `product.update` |
| GET | `/products/search?q=&warehouseId=` (tìm nhanh theo mã/tên/barcode cho POS/phiếu) | `product.view` |
| GET | `/products/by-barcode/:barcode` | `product.view` |
| GET | `/products/export` (xlsx) · POST `/products/import` (multipart xlsx) · GET `/products/import-template` | `product.export` / `product.import` |
| GET/POST/PATCH | `/price-books` · PUT `/price-books/:id/items` | `pricebook.manage` |
| GET | `/variants/:id/batches` · POST `/variants/:id/batches` | `product.update` |
| POST | `/uploads/images` (multipart `files[]`, ≤10 ảnh, ≤5MB/ảnh, JPEG/PNG/GIF/WebP) → `[{url, fileName, size, mimeType}]`; ảnh được phục vụ tĩnh tại `/uploads/products/<tenantId>/<uuid>.<ext>` | `product.create` hoặc `product.update` |
| DELETE | `/uploads/images?url=` (chỉ xóa được tệp trong thư mục tenant của mình) | `product.update` |

## Kho
| Method | Path | Quyền |
|---|---|---|
| GET | `/inventory/balances?warehouseId&variantId&productId&search&lowStock=true&page` | `inventory.view` |
| GET | `/inventory/balances/summary?warehouseId` → `{skuCount, onHandTotal, reservedTotal, stockValue, lowStockCount}` | `inventory.view` (+`inventory.cost.view` để thấy giá trị) |
| GET | `/inventory/movements?variantId&warehouseId&documentType&from&to&page` (thẻ kho) | `inventory.movement.view` |
| GET | `/inventory/documents?type&status&warehouseId&search&from&to&page` | `inventory.document.view` |
| GET | `/inventory/documents/:id` | `inventory.document.view` |
| POST | `/inventory/documents` `{type, branchId, warehouseId, reason?, note?, lines:[{variantId, batchId?, quantity, unitCost?, actualQuantity?, note?}]}` (tạo DRAFT) | `inventory.document.create` |
| PATCH | `/inventory/documents/:id` (chỉ DRAFT, gửi `version`) | `inventory.document.create` |
| DELETE | `/inventory/documents/:id` (chỉ DRAFT) | `inventory.document.create` |
| POST | `/inventory/documents/:id/post` (Idempotency-Key) | `inventory.document.post` |
| POST | `/inventory/documents/:id/cancel` `{reason}` (Idempotency-Key) | `inventory.document.cancel` |
| POST | `/inventory/documents/post-now` (tạo + ghi sổ trong 1 transaction, Idempotency-Key) | `inventory.document.create` + `.post` |
| GET | `/inventory/reservations?variantId&warehouseId&status` | `inventory.view` |
| POST | `/inventory/reconcile` (chạy đối soát balance vs movements, trả danh sách lệch) | `inventory.view` + owner |

## Chuyển kho & kiểm kho (Module 03b)
| Method | Path | Quyền |
|---|---|---|
| GET | `/transfers?status&fromWarehouseId&toWarehouseId&branchId&direction=in|out&from&to&search` · GET `/transfers/:id` (movements, giá vốn ẩn nếu thiếu `inventory.cost.view`) | `transfer.view` |
| POST | `/transfers` `{fromWarehouseId, toWarehouseId, note?, lines:[{variantId, batchId?, quantity, note?}]}` · PATCH `/transfers/:id` `{version, toWarehouseId?, note?, lines?}` · DELETE | `transfer.create` |
| POST | `/transfers/dispatch-now` (tạo + xuất) · POST `/transfers/:id/dispatch` `{version?}` | `transfer.dispatch` (+`transfer.create`) |
| POST | `/transfers/:id/receive` `{version?, lines?:[{lineId, receivedQuantity, note?}], shortageAction?: WRITE_OFF|RETURN_TO_SOURCE, note?}` | `transfer.receive` (chi nhánh đích) |
| POST | `/transfers/:id/cancel` `{reason}` (DRAFT / IN_TRANSIT) | `transfer.cancel` |
| GET | `/stocktakes?status&warehouseId&branchId&from&to&search` · GET `/stocktakes/:id` (dòng kèm `currentOnHand`, `pendingDelta`) | `stocktake.view` |
| POST | `/stocktakes` `{warehouseId, scope?: SELECTED|ALL, categoryId?, note?, lines?:[{variantId, batchId?, countedQuantity?, note?}]}` · PATCH `/stocktakes/:id` `{version, note?}` | `stocktake.create` |
| POST | `/stocktakes/:id/lines` `{lines:[…]}` (thêm dòng / nhập số đếm, upsert theo hàng+lô) · DELETE `/stocktakes/:id/lines/:lineId` · POST `/stocktakes/:id/refresh-snapshot` | `stocktake.create` |
| POST | `/stocktakes/:id/complete` `{version?, uncountedAs?: SKIP|ZERO}` | `stocktake.complete` |
| POST | `/stocktakes/:id/cancel` `{reason}` | `stocktake.cancel` |
Mã lỗi: `TRANSFER_NOT_IN_TRANSIT`, `TRANSFER_RECEIVED`, `INSUFFICIENT_STOCK`, `VERSION_CONFLICT`, `DOCUMENT_NOT_EDITABLE`.

## Mua hàng (Module 04)
| Method | Path | Quyền |
|---|---|---|
| GET/POST | `/suppliers` · GET/PATCH `/suppliers/:id` · GET `/suppliers/groups` · GET `/suppliers/:id/history` · GET `/suppliers/:id/ledger` | `supplier.view` / `supplier.manage` / `supplier.debt.view` |
| GET/POST | `/purchase-orders` · GET/PATCH/DELETE `/purchase-orders/:id` · POST `/purchase-orders/:id/confirm` · POST `/purchase-orders/:id/cancel` | `purchase.order.*` |
| GET/POST | `/purchase-receipts` · POST `/purchase-receipts/post-now` (tạo + hoàn thành, kèm `payment`) · GET/PATCH/DELETE `/purchase-receipts/:id` · POST `/purchase-receipts/:id/post` · POST `/purchase-receipts/:id/cancel` | `purchase.receipt.*` |
| GET/POST | `/purchase-returns` · POST `/purchase-returns/post-now` (kèm `refund`) · GET/PATCH/DELETE `/purchase-returns/:id` · POST `/purchase-returns/:id/post` · POST `/purchase-returns/:id/cancel` | `purchase.return.*` |
| GET/POST | `/payments` · GET `/payments/:id` · POST `/payments/:id/cancel` (phiếu thu `PT` / phiếu chi `PC`, `allocations[]`) | `payment.*` |
| GET | `/purchasing/reports/summary?from&to&supplierId&branchId&groupBy=day|month` · `/purchasing/reports/debt` | `purchase.report.view` / `supplier.debt.view` |
Mã lỗi thêm: `ORDER_NOT_RECEIVABLE`, `ORDER_HAS_DRAFT_RECEIPTS`, `PO_QUANTITY_EXCEEDED`, `RECEIPT_HAS_RETURNS`, `RECEIPT_HAS_PAYMENTS`, `RETURN_QUANTITY_EXCEEDED`, `RETURN_AMOUNT_EXCEEDED`, `RETURN_HAS_REFUNDS`, `OVERPAYMENT`, `PAYMENT_NOT_POSTED`. `POST /payments/reconcile` (owner) đối soát số dư công nợ với ledger.

## Bán hàng POS (Module 05) & khách hàng
| Method | Path | Quyền |
|---|---|---|
| GET/POST | `/customers` · GET/PATCH `/customers/:id` · GET `/customers/search?q=` · GET `/customers/groups` · GET `/customers/:id/history` · GET `/customers/:id/ledger` · GET `/customers/debt` | `customer.view` / `customer.manage` / `customer.debt.view` |
| GET | `/invoices/price?variantId&priceBookId&productUnitId&quantity` → `{listPrice, source, conversionFactor, taxRate}` | `invoice.create` |
| POST | `/invoices` (giữ đơn, DRAFT) · PATCH/DELETE `/invoices/:id` (DRAFT, `version`) | `invoice.create` |
| POST | `/invoices/checkout` `{branchId, warehouseId, customerId?, sellerId?, priceBookId?, discountAmount?, note?, lines:[{variantId, batchId?, productUnitId?, quantity, unitPrice?, discountAmount?}], payments:[{method, amount, reference?}]}` (tạo + hoàn thành, Idempotency-Key) · POST `/invoices/:id/complete` `{payments}` | `invoice.create` + `invoice.complete` |
| POST | `/invoices/:id/cancel` `{reason}` | `invoice.cancel` |
| GET | `/invoices?status&branchId&customerId&sellerId&shiftId&unpaid&from&to&search` · GET `/invoices/:id` (lines, payments, movements) | `invoice.view` |
| GET | `/shifts` · GET `/shifts/current?branchId` · GET `/shifts/:id` · POST `/shifts/open` `{branchId, openingCash}` · POST `/shifts/:id/close` `{countedCash, note}` | `shift.view` / `shift.open` / `shift.close` (`shift.manage` để xem/đóng ca người khác) |
| GET | `/sales/reports/summary?from&to&branchId&sellerId&groupBy` → doanh thu, giá vốn, lợi nhuận gộp, theo kỳ / nhân viên / chi nhánh / sản phẩm / phương thức | `sales.report.view` |
| POST | `/payments` với `partyType: CUSTOMER`, `allocations[].documentType = INVOICE` (thu nợ KH); bỏ `partyType` = phiếu thu khách lẻ | `payment.create` |
Mã lỗi thêm: `PRODUCT_NOT_SELLABLE`, `CREDIT_LIMIT_EXCEEDED`, `CREDIT_NOT_ALLOWED`, `SHIFT_REQUIRED`, `SHIFT_ALREADY_OPEN`, `SHIFT_NOT_OPEN`, `INVOICE_HAS_RETURNS`, `PAYMENT_SHARED`.

## Đặt hàng & giao hàng (Module 06)
| Method | Path | Quyền |
|---|---|---|
| GET | `/orders?status&branchId&customerId&source&unpaid=true&from&to&search` · GET `/orders/:id` (dòng, cọc, giữ tồn, vận đơn, hóa đơn) | `order.view` |
| POST | `/orders` `{branchId, warehouseId, customerId?, sellerId?, priceBookId?, source?, expectedAt?, discountAmount?, note?, lines:[{variantId, quantity, unitPrice?, discountAmount?, productUnitId?, batchId?}], confirm?=true, deposits?:[{method, amount}], delivery?:{receiverName, address, receiverPhone?, carrier?, shippingFee?, codAmount?, …}}` · PATCH `/orders/:id` `{version, …}` (dòng chỉ khi DRAFT) · DELETE (DRAFT, chưa cọc) | `order.create` |
| POST | `/orders/:id/confirm` `{version?}` · POST `/orders/:id/unconfirm` | `order.confirm` |
| POST | `/orders/:id/deposit` `{method, amount, cashAccountId?, reference?}` | `order.create` |
| POST | `/orders/:id/complete` `{version?, payments?:[…], warehouseId?}` → `{order, invoice}` | `order.complete` + `invoice.create` + `invoice.complete` |
| POST | `/orders/:id/cancel` `{reason, depositAction?: REFUND|CREDIT}` | `order.cancel` |
| GET | `/deliveries?status&branchId&carrier&codPending=true&from&to&search` · GET `/deliveries/:id` (`events`, `allowedNext`) | `delivery.view` |
| POST | `/deliveries` `{orderId?|invoiceId, receiverName, address, …}` · PATCH `/deliveries/:id` | `delivery.manage` |
| POST | `/deliveries/:id/status` `{status, note?, collectCod?:{method, amount?, cashAccountId?, reference?}}` · POST `/deliveries/:id/collect-cod` `{method, amount?, cashAccountId?, reference?}` | `delivery.manage` |
| — | Phiếu thu phân bổ `SALES_ORDER` (tiền cọc); hóa đơn trả kèm `salesOrder`, `deliveries[]`; `GET /warehouses?scope=all` (kho đích chuyển kho) | — |
Mã lỗi: `ORDER_HAS_DEPOSIT`, `ORDER_HAS_DELIVERY`, `INVOICE_HAS_DELIVERY`, `DELIVERY_EXISTS`, `DELIVERY_TRANSITION`, `DELIVERY_NOT_DELIVERED`, `COD_COLLECTED`.

## Trả hàng / đổi hàng bán (Module 07)
| Method | Path | Quyền |
|---|---|---|
| GET | `/sales-returns/returnable/:invoiceId` → dòng còn trả được + `refundUnitPrice` + `maxRefund` | `return.view` |
| GET | `/sales-returns?status&branchId&invoiceId&customerId&from&to&search` · GET `/sales-returns/:id` | `return.view` |
| POST | `/sales-returns` (nháp) · PATCH/DELETE `/sales-returns/:id` | `return.create` |
| POST | `/sales-returns/complete-now` `{invoiceId, reason?, feeAmount?, lines:[{invoiceLineId, quantity, unitPrice?, condition: RESTOCK|DAMAGED}], refund?:{method, amount}}` · POST `/sales-returns/:id/complete` `{version?, refund?}` | `return.create` + `return.complete` |
| POST | `/sales-returns/exchange` `{return:{…}, newInvoice:{lines, discountAmount?, priceBookId?}, payments?:[…], refund?:{…}}` → `{return, invoice, settlement:{returnValue, newTotal, offset, customerPays, refundDue}}` | `return.*` + `invoice.create` + `invoice.complete` |
| POST | `/sales-returns/:id/cancel` `{reason}` | `return.cancel` |
| POST | `/payments` với `direction: OUT`, `allocations[].documentType = SALES_RETURN` (hoàn tiền sau) | `payment.create` |
Mã lỗi thêm: `RETURN_WINDOW_EXPIRED`, `RETURN_QUANTITY_EXCEEDED`, `RETURN_AMOUNT_EXCEEDED`, `RETURN_LINKED_EXCHANGE`, `PAYMENT_IS_OFFSET`, `SHIFT_REQUIRED` (hoàn tiền mặt khi bắt buộc mở ca). Phương thức `OFFSET` (cấn trừ) chỉ xuất hiện trong dữ liệu do hệ thống tạo; hủy hóa đơn đổi hàng mở lại phần cấn trừ trên phiếu trả.

## Sổ quỹ (Module 08)
| Method | Path | Quyền |
|---|---|---|
| GET | `/cash/accounts?includeInactive` · GET `/cash/accounts/:id` (kèm `lastReconciliation`) | `cash.view` |
| POST | `/cash/accounts` `{code?, name, type: CASH|BANK|EWALLET, branchId?, bankName?, accountNumber?, accountHolder?, openingBalance?, isDefault?}` · PATCH `/cash/accounts/:id` `{name?, bank…, isDefault?, isActive?}` | `cash.account.manage` |
| POST | `/cash/accounts/:id/reconcile` `{countedBalance, note?}` → `{bookBalance, countedBalance, difference}` · GET `/cash/accounts/:id/reconciliations` | `cash.reconcile` / `cash.view` |
| GET | `/cash/categories?direction&includeInactive` · POST `/cash/categories` `{direction, name}` · PATCH `/cash/categories/:id` | `payment.view` / `cash.account.manage` |
| GET | `/cash/transfers?status&kind=TRANSFER|HANDOVER&branchId&from&to&search` · POST `/cash/transfers` `{branchId, fromAccountId, toAccountId, amount, note?}` (Idempotency-Key) · POST `/cash/transfers/:id/cancel` `{reason}` | `cash.view` / `cash.transfer` |
| GET | `/cash/book?accountId&branchId&direction&from&to&page&pageSize` → `{account, openingBalance, totalIn, totalOut, closingBalance, data:[{…phiếu, partyName, categoryName, balanceAfter}], meta}` | `cash.view` |
| GET | `/cash/summary?from&to&branchId&accountId` → `{totals:{in,out,net}, byAccount[], byKind[]}` | `cash.view` |
| POST | `/cash/debt-offset` `{branchId, customerId, supplierId, amount, note?}` → `{paymentId, vouchers, customer.balanceAfter, supplier.balanceAfter}` · POST `/cash/debt-offset/:paymentId/cancel` `{reason}` | `debt.offset` |
| POST | `/payments` mở rộng: `partyType/partyId` tùy chọn, `cashAccountId?`, `categoryId?` (thu/chi khác, cần `payment.other`); GET `/payments` lọc thêm `cashAccountId`, `categoryId`, `method` | `payment.create` |
| POST | `/shifts/:id/close` mở rộng: `handoverAmount?`, `handoverToAccountId?` → phản hồi (và `GET /shifts/:id`) thêm `handover: {code, amount, toAccount}` | `shift.close` + `cash.transfer` |
| — | Thiết lập `cash.allowNegativeBalance` (bool, mặc định true) qua `PUT /settings` | `tenant.settings.manage` |
Mã lỗi: `CASH_INSUFFICIENT`, `CASH_ACCOUNT_HAS_BALANCE`, `PAYMENT_IS_TRANSFER`, `PAYMENT_IS_OFFSET`, `OFFSET_EXCEEDS_DEBT`, `TRANSACTION_CONFLICT` (deadlock Postgres cũng về 409).

## Khuyến mãi (Module 09)
| Method | Path | Quyền |
|---|---|---|
| GET | `/promotions?status&type&running=true&branchId&search` · GET `/promotions/:id` (kèm `stats`, `variants`) | `promotion.view` |
| POST | `/promotions` `{code?, name, type, status?, startsAt?, endsAt?, daysOfWeek?, timeFrom?, timeTo?, branchIds?, customerGroups?, priority?, stackable?, usageLimit?, perCustomerLimit?, config}` · PATCH `/promotions/:id` · DELETE (409 `PROMOTION_IN_USE`) | `promotion.manage` |
| GET | `/promotions/:id/vouchers?status&search` · POST `/promotions/:id/vouchers` `{count?|codes?, prefix?, maxUses?, customerId?, expiresAt?, note?}` → `{count, codes}` · PATCH `/promotions/vouchers/:voucherId` `{status, expiresAt?, note?}` | `promotion.view` / `promotion.manage` |
| GET | `/promotions/vouchers/lookup?code&branchId&customerId` → `{valid, reason, voucher, promotion}` | `invoice.create` |
| GET | `/promotions/report?from&to&branchId` → `{totals, rows[]}` | `promotion.view` |
| POST | `/invoices/preview` (body như checkout, không lưu) → `{subtotal, discountAmount, promotionDiscount, taxAmount, totalAmount, voucherCode, lines[], promotions[], gifts[]}` | `invoice.create` |
| GET | `/invoices/price-books?branchId&customerId` → bảng giá áp dụng được (`suggested`) | `invoice.create` |
| — | Hóa đơn: thêm `voucherCode?`, `excludePromotionIds?`, `applyPromotions?`; dòng: `isGift?`, `promotionId?`; phản hồi thêm `promotionDiscount`, `voucherCode`, `promotions[]`, dòng `promotionDiscount/promotionId/isGift` | — |
`config` theo loại: `INVOICE_DISCOUNT {tiers:[{minTotal, discountPercent|discountAmount, maxDiscount?}]}` · `INVOICE_GIFT {tiers:[{minTotal, gifts:[{variantId, quantity}]}]}` · `PRODUCT_DISCOUNT {variantIds?, categoryIds?, minQuantity?, maxQuantity?, discountPercent|discountAmount|fixedPrice, maxDiscount?}` · `BUY_X_GET_Y {buy:{variantIds?, categoryIds?, quantity}, get:{variantIds, quantity, discountPercent?}, maxRepeats?, applyToCart?}` · `VOUCHER {discountPercent|discountAmount, maxDiscount?, minTotal?, variantIds?, categoryIds?}`. Mã lỗi: `VOUCHER_INVALID`, `GIFT_NOT_ALLOWED`, `PROMOTION_EXHAUSTED`, `PROMOTION_INACTIVE`, `PROMOTION_IN_USE`.

## Báo cáo (Module 10)
| Method | Path | Quyền |
|---|---|---|
| GET | `/reports/inventory/nxt?from&to&warehouseId&branchId&categoryId&search&hideEmpty&page&pageSize` → `{data:[{sku, name, openingQty, inQty, outQty, closingQty, openingValue?, inValue?, outValue?, closingValue?}], totals, meta}` | `inventory.view` (+`inventory.cost.view` cho giá trị) |
| GET | `/reports/inventory/slow-movers?days=30&warehouseId&branchId&categoryId&search` | `inventory.view` |
| GET | `/reports/inventory/valuation?groupBy=category|warehouse|brand&warehouseId&branchId` | `inventory.cost.view` |
| GET | `/reports/sales/products?from&to&branchId&categoryId&by=revenue|quantity|profit&order=desc|asc` | `sales.report.view` |
| GET | `/reports/profit?from&to&branchId&groupBy=day|month` → `{totals:{revenue, refunds, netRevenue, cogs, grossProfit, otherIncome, otherExpense, losses, shippingCost, netProfit}, byPeriod[], expenseByCategory[], incomeByCategory[]}` | `report.profit.view` |
| GET | `/reports/export?type=nxt|slow-movers|top-products|profit|valuation|sales|cashbook|customer-debt|supplier-debt&…` → file `.xlsx` | theo loại báo cáo |
| GET | `/sales/reports/summary`, `/purchasing/reports/summary`, `/purchasing/reports/debt`, `/customers/debt`, `/cash/summary`, `/promotions/report` (đã có) | — |

## Tích hợp & chuyển dữ liệu KiotViet (Module 13)
| Method | Path | Quyền |
|---|---|---|
| POST | `/integrations/import/preview` (multipart: `file` xlsx, `type` = PRODUCTS|CUSTOMERS|SUPPLIERS|INVOICES, `options` JSON) → `{jobId, headers, mapping, unmapped, missing, stockHeaders, sample, issues, fields}` (file hỏng / không phải .xlsx → 400 `VALIDATION_ERROR` \"Không đọc được file Excel…\") | `integration.manage` |
| POST | `/integrations/import/:jobId/commit` `{mapping?, options?: {stockColumns?, defaultWarehouseId?, syncDebt?, updateExisting?, importStock?, branchMap?, defaultBranchId?, invoicesFrom?}}` → `{created, updated, skipped, failed, stockLines?, units?, debtAdjusted?, errors[]}` | `integration.manage` |
| GET | `/integrations/import-jobs?type` · GET `/integrations/import-jobs/:id` · GET `/integrations/reconcile` | `integration.view` |
| GET/PUT/DELETE | `/integrations/kiotviet` `{retailer?, clientId?, clientSecret?, branchMap?}` — tạo mới cần đủ 3 thông tin; lần lưu sau chỉ cần gửi trường muốn đổi (vd. chỉ `branchMap` sau khi kiểm tra kết nối); đổi thông tin đăng nhập đưa trạng thái về `CONFIGURED`; `branchMap` phải trỏ tới kho có thật; secret không bao giờ trả về, clientId che bớt | `integration.view` / `integration.manage` |
| POST | `/integrations/kiotviet/test` → `{ok, branches[], warehouses[]}` · POST `/integrations/kiotviet/import` `{entities[], branchMap?, defaultWarehouseId?, syncDebt?, updateExisting?, importStock?, invoicesFrom?, invoicesTo?}` → `{results[], reconcile}` | `integration.manage` |
Env: `APP_ENCRYPTION_KEY` (khóa mã hóa secret; mặc định suy từ `JWT_ACCESS_SECRET`), `KIOTVIET_TOKEN_URL`, `KIOTVIET_API_URL` (ghi đè cho môi trường thử). Mã lỗi: `IMPORT_NOT_PREVIEW`, `KIOTVIET_NOT_CONFIGURED`, `KIOTVIET_AUTH_FAILED`, `KIOTVIET_REQUEST_FAILED`.

## Điểm tích lũy & CRM (Module 07 mở rộng)
| Method | Path | Quyền |
|---|---|---|
| GET | `/customers/:id/points?page&pageSize` → `{customer, balance, earned, redeemed, adjusted, config, data[], meta}` | `customer.view` |
| POST | `/customers/:id/points/adjust` `{points (±), note}` | `loyalty.manage` |
| GET | `/customers/birthdays?month&day` | `customer.view` |
| GET | `/reports/customers?from&to&branchId&groupName&by=revenue|invoices|lastPurchase|points|debt&search` → `{data:[{customerId, code, name, invoices, revenue, returned, netRevenue, avgBasket, lastPurchaseAt, firstPurchaseAt, isNew, points, debt}], totals:{customers, invoices, revenue, newCustomers, walkinInvoices, walkinRevenue}, meta}` | `sales.report.view` |
| — | Hóa đơn: `redeemPoints?` (checkout / giữ đơn / sửa đơn giữ); phản hồi `pointsEarned`, `pointsRedeemed`, `pointsValue`; phương thức thanh toán hệ thống `POINTS`; preview trả `loyalty{…}` | — |
| — | Thiết lập: `loyalty.enabled`, `loyalty.earnPoints`, `loyalty.earnPerAmount`, `loyalty.redeemValue`, `loyalty.minRedeemPoints`, `loyalty.maxRedeemPercent` | `tenant.settings.manage` |
Mã lỗi: `POINTS_INSUFFICIENT`, `POINTS_MAX_REDEEM`.

## Nhân viên (Module 11)
| Method | Path | Quyền |
|---|---|---|
| GET | `/employees?status&branchId&search` (hồ sơ + vai trò + chi nhánh; lương chỉ với `employee.manage`) | `attendance.view` |
| GET/POST/PATCH/DELETE | `/employees/commission-rules` `{name, userId?, categoryId?, variantId?, basis: REVENUE|GROSS_PROFIT|QUANTITY, rate, minRevenue?, priority?, startsAt?, endsAt?, isActive?}` — GET trả kèm `user {id, fullName}`, `category {id, name}`, `variant {id, sku, name}` | `commission.view` / `employee.manage` |
| GET | `/employees/commissions?from&to&branchId&userId` · `/employees/commissions/me` | `commission.view` / bất kỳ |
| POST | `/employees/attendance/check-in` `{branchId?, note?, latitude?, longitude?}` · `/employees/attendance/check-out` `{note?}` · GET `/employees/attendance/current` · GET `/employees/attendance/me` | bất kỳ người dùng |
| GET | `/employees/attendance?from&to&userId&branchId&open` (kèm `summary` giờ công) | `attendance.view` |
| POST | `/employees/attendance` (chấm hộ) · PATCH `/employees/attendance/:id` `{checkInAt?, checkOutAt?, note?}` | `employee.manage` |
| GET | `/employees/performance?from&to&branchId&userId` | `attendance.view` |
| — | Người dùng: thêm `position`, `hiredAt`, `baseSalary`, `employeeNote` | `user.manage` |

## Kế toán & thuế (Module 12)
| GET | `/reports/tax?from&to&branchId` → `{output:[{taxRate, invoices, taxable, tax}], input:[…], returns, totals:{outputTax, inputTax, payable}}` | `report.profit.view` |

## SaaS (Module 14)
| Method | Path | Quyền |
|---|---|---|
| GET | `/subscription` → `{tenant, plan, usage, limits, trialDaysLeft, readOnly, plans[]}` | `subscription.view` |
| GET | `/platform/tenants?search&status&page` · PATCH `/platform/tenants/:id` `{status?, planCode?, planExpiresAt?, trialEndsAt?, planNote?}` | header `x-platform-key` = `PLATFORM_ADMIN_KEY` |
Mã lỗi: `PLAN_LIMIT_REACHED`, `TRIAL_EXPIRED`, `PLAN_EXPIRED`, `TENANT_SUSPENDED`, `ATTENDANCE_OPEN`, `ATTENDANCE_NOT_OPEN`.

## Dashboard
| GET `/dashboard/overview` → `{products, variants, lowStock, stockValue, warehouses, salesToday?{invoices, revenue, grossProfit, byMethod}, recentMovements[], recentDocuments[]}` | `dashboard.view` |

## WebSocket/SSE
* `GET /events/stream` (SSE, token qua query) — phát `inventory.document.posted`, `product.updated` cho client làm mới dữ liệu. (Dự kiến bước Integrations; chưa triển khai.)
