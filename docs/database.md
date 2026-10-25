# Thiết kế cơ sở dữ liệu

Nguồn chuẩn: `apps/api/prisma/schema.prisma` (Prisma 6, PostgreSQL 16). Tài liệu này giải thích ý đồ thiết kế; cột chi tiết xem schema.

## Quy ước chung
* Khóa chính `uuid` (`gen_random_uuid()`), tenant-scoped bảng nào cũng có `tenant_id` và index/unique bắt đầu bằng `tenant_id`.
* Tiền: `Decimal(18,4)`. Số lượng: `Decimal(18,3)`. Hệ số quy đổi: `Decimal(18,6)`. Không dùng float.
* Thời gian: `timestamptz`. Audit fields: `created_at`, `updated_at`, `created_by_id`, (`posted_by_id`, `cancelled_by_id` cho chứng từ).
* Soft delete chỉ cho danh mục (`deleted_at`); chứng từ không xóa.
* Enum trạng thái là Postgres enum (`InventoryDocStatus`, `MovementType`, …).

## Nhóm bảng

### 1. Tenancy & tổ chức
| Bảng | Vai trò | Ràng buộc chính |
|---|---|---|
| `tenants` | Gian hàng/doanh nghiệp | `code` unique, `status`, `plan_code` |
| `tenant_settings` | Cấu hình key/value theo tenant | PK `(tenant_id, key)` |
| `branches` | Chi nhánh | unique `(tenant_id, code)` |
| `warehouses` | Kho thuộc chi nhánh | unique `(tenant_id, code)`, FK `branch_id` |

### 2. Người dùng & phân quyền
| Bảng | Vai trò | Ràng buộc chính |
|---|---|---|
| `users` | Tài khoản | unique `(tenant_id, username)`, `is_owner`, `all_branches` |
| `roles`, `role_permissions` | Vai trò và permission codes | unique `(tenant_id, code)`; PK `(role_id, permission)` |
| `user_roles` | N-N user–role | |
| `user_branch_access`, `user_warehouse_access` | Giới hạn chi nhánh / kho | |
| `refresh_tokens` | Refresh token (hash) có xoay vòng/thu hồi | `token_hash` unique |
| `login_history` | Lịch sử đăng nhập | index `(tenant_id, created_at)` |

### 3. Cross-cutting
| Bảng | Vai trò |
|---|---|
| `audit_logs` | Nhật ký thao tác (before/after JSON) |
| `document_sequences` | Bộ đếm mã chứng từ theo tenant/doc_type, `FOR UPDATE` khi lấy số |
| `idempotency_keys` | Khóa idempotency `(tenant_id, scope, key)` + response cache |
| `outbox_events` | Transactional outbox; index `(status, available_at)` |

### 4. Hàng hóa
| Bảng | Vai trò | Ghi chú |
|---|---|---|
| `product_categories` | Nhóm hàng dạng cây (`parent_id`) | |
| `brands`, `units` | Thương hiệu, đơn vị tính | unique theo tên trong tenant |
| `products` | Thông tin chung | `type` GOODS/SERVICE/COMBO, `track_batch`, `attribute_names[]`, `is_active` |
| `product_variants` | Đơn vị bán/tồn thực tế | unique `(tenant_id, sku)`, `(tenant_id, barcode)`; `cost_price`, `on_hand_total` do kho duy trì |
| `product_units` | Đơn vị quy đổi | `conversion_factor` về đơn vị cơ bản |
| `product_images`, `combo_items`, `product_batches` | Ảnh, thành phần combo, lô/hạn | |
| `price_books`, `price_book_items`, `price_book_branches` | Bảng giá (nền tảng Module 09) | |

### 5. Kho
| Bảng | Vai trò | Ghi chú |
|---|---|---|
| `stock_balances` | Số dư (kho, biến thể, lô) | unique `(tenant_id, warehouse_id, variant_id, batch_key)`; `on_hand`, `reserved`, `incoming` |
| `stock_movements` | Sổ kho append-only | `quantity` có dấu, `unit_cost`, `balance_after`, tham chiếu chứng từ |
| `cost_ledger_entries` | Sổ giá vốn bình quân | 1-1 với movement (`movement_id` unique) |
| `stock_reservations` | Giữ tồn cho đơn hàng | `status` ACTIVE/RELEASED/CONSUMED |
| `inventory_documents`, `inventory_document_lines` | Phiếu nhập khác / xuất / điều chỉnh | `status` DRAFT→POSTED→CANCELLED, `version` |
| `stock_transfers`, `stock_transfer_lines` | Phiếu chuyển kho | `status` DRAFT→IN_TRANSIT→RECEIVED/CANCELLED; `received_quantity`, `shortage_quantity/value`, `shortage_action`; CHECK nhận ≤ gửi, kho nguồn ≠ kho đích |
| `stocktakes`, `stocktake_lines` | Phiếu kiểm kho | dòng unique `(stocktake_id, variant_id, batch_key)`, `system_quantity` snapshot, `counted_quantity`, `delta_*`; `status` DRAFT→COMPLETED/CANCELLED |

### 6. Đối tác, bán hàng & tài chính (Module 04–08)
| Bảng | Vai trò | Ghi chú |
|---|---|---|
| `suppliers`, `customers` | Đối tác | mã tự sinh NCC…/KH…, nợ đầu kỳ qua ledger |
| `party_ledger_entries`, `party_balances` | Sổ công nợ append-only + số dư cache | khóa `party_balances` khi ghi; đối soát `POST /payments/reconcile` |
| `purchase_orders(_lines)`, `purchase_receipts(_lines,_costs)`, `purchase_returns(_lines)` | Mua hàng | CHECK số lượng/tiền; `paid_amount`, `refunded_amount` |
| `shifts`, `invoices`, `invoice_lines` | POS | `returned_quantity`, `returned_amount`, `version` |
| `sales_returns`, `sales_return_lines` | Trả hàng / đổi hàng | `exchange_invoice_id`, tình trạng RESTOCK/DAMAGED, `refunded_amount` |
| `payments`, `payment_allocations` | Phiếu thu/chi + phân bổ | `method` gồm OFFSET/TRANSFER hệ thống; `cash_account_id`, `category_id`, `transfer_id`, `shift_id` |
| `cash_accounts`, `payment_categories`, `cash_transfers`, `cash_reconciliations` | Sổ quỹ | số dư quỹ cập nhật dưới khóa `FOR NO KEY UPDATE`; chuyển quỹ = cặp phiếu TRANSFER |
| `promotions`, `promotion_branches`, `promotion_vouchers`, `invoice_promotions` | Khuyến mãi | `config` JSON theo loại; `usage_count`/`used_count` trừ khi hoàn thành hóa đơn dưới khóa; `invoices.promotion_discount`, `voucher_code`; `invoice_lines.promotion_discount/promotion_id/is_gift`; `price_books.customer_groups` |
| `sales_orders`, `sales_order_lines`, `deliveries`, `delivery_events` | Đặt hàng & giao hàng | `deposit_amount` theo phân bổ phiếu thu; `invoice_id` khi hoàn tất; giữ tồn qua `stock_reservations` (`SALES_ORDER`); vận đơn 1-1 với đơn, n-1 với hóa đơn; `cod_amount`, `cod_collected` |
| `import_jobs`, `integration_connections` | Nhập dữ liệu & kết nối KiotViet | job lưu `headers/mapping/options/payload` (xóa payload khi xong), `totals`, `errors`; kết nối lưu `secret_enc` AES-GCM; `invoices.external_ref/imported` cho hóa đơn lịch sử |
| `customer_point_entries` | Sổ điểm tích lũy | append-only, `balance_after`; số dư cache `customers.points`; `invoices.points_earned/points_redeemed/points_value`; phương thức `POINTS` |
| `commission_rules`, `attendances` | Nhân viên | hoa hồng theo nhân viên / nhóm / hàng; chấm công vào/ra với `minutes`, `source`, `edited_by_id`; `users.position/hired_at/base_salary/employee_note` |
| `tenants.plan_code/trial_ends_at/plan_expires_at` | SaaS | hạn mức theo `PLANS`; chỉ đọc khi quá hạn |

## Quan hệ chính
```
tenants 1─n branches 1─n warehouses
tenants 1─n users n─n roles n─n permissions
products 1─n product_variants 1─n stock_balances (per warehouse/batch)
product_variants 1─n stock_movements 1─1 cost_ledger_entries
inventory_documents 1─n inventory_document_lines ─▶ product_variants
```

## Chiến lược index
* Danh sách/tìm kiếm: `(tenant_id, name)`, `(tenant_id, category_id)`, `(tenant_id, is_active, deleted_at)`.
* Thẻ kho: `(tenant_id, warehouse_id, variant_id, created_at)` và `(tenant_id, variant_id, created_at)`.
* Truy vết chứng từ: `(tenant_id, document_type, document_id)`.
* Outbox publisher: `(status, available_at)`.

## Migration
* Dùng `prisma migrate dev` (dev) / `prisma migrate deploy` (prod). Không dùng `db push` và không reset DB để xử lý lỗi migration.
* Migration đầu tiên: `apps/api/prisma/migrations/*_init`.

### import_code_aliases (25/10/2026)
Mã hàng phụ của hệ thống cũ (`source` = KIOTVIET, `code` viết thường, duy nhất theo gian hàng) → `variant_id` + `product_unit_id` / `unit_name` / `factor`. Ghi khi nhập dòng ĐVT quy đổi của file hàng hóa KiotViet; đọc khi nhập lịch sử hóa đơn. Xóa theo biến thể / gian hàng (cascade).
