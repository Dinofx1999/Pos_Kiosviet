# Kế hoạch triển khai

Thứ tự theo phụ thuộc. Mỗi bước chỉ được đánh dấu xong trong `progress.md` khi: migration hợp lệ · business logic · API + validation · UI kết nối dữ liệu thật · authorization · automated tests · tài liệu.

| # | Bước | Nội dung chính | Phụ thuộc | Trạng thái |
|---|---|---|---|---|
| 1 | Foundation | Monorepo, Prisma, tenant context, auth JWT/refresh, RBAC, branch/warehouse, users/roles, settings, sequences, audit, idempotency, outbox, error handling, Swagger, layout FE KiotViet-like, login | — | Phiên 1 |
| 2 | Product Master | Categories/brands/units, products + variants + units + combo + batches, auto code, search/filter, import/export Excel, price books (API) | 1 | Phiên 1 |
| 3 | Inventory Core | Balances, movements, cost ledger (AVG), reservations, documents RECEIPT/ISSUE/ADJUSTMENT với posting engine (lock, idempotent, reversal), thẻ kho, cảnh báo tồn thấp, dashboard | 2 | Phiên 1 |
| 4 | Purchasing | Suppliers, PO, phiếu nhập (nhập từng phần, chiết khấu, thuế, chi phí phân bổ), trả hàng nhập, công nợ NCC (ledger) | 3 | ✅ Phiên 2 (2026-10-24): backend + 20 tests + review + FE đã kiểm tra trên trình duyệt |
| 5 | Sales POS | POS UI (phím tắt, barcode), hóa đơn, giữ đơn, thanh toán nhiều phương thức/một phần, ca bán hàng, in hóa đơn | 3 | ✅ Phiên 3 (2026-10-24): backend + 20 tests + review + FE POS đã kiểm tra trên trình duyệt |
| 6 | Payments & Debt | Sổ quỹ, phiếu thu/chi, payment allocations, công nợ KH/NCC, cấn trừ, bàn giao ca | 4,5 | ✅ Phiên 5 (2026-10-24): backend + 9 tests + FE đã kiểm tra trên trình duyệt |
| 6b | Orders & Delivery | Đặt hàng (giữ tồn, cọc, chuyển hóa đơn), vận đơn, COD | 5,6 | ✅ Phiên 5: backend + 7 tests + FE đã kiểm tra |
| 7 | Returns | Trả hàng bán (tham chiếu HĐ gốc, nhiều lần, hàng hỏng), đổi hàng | 5,6 | ✅ Phiên 4–5 (2026-10-24): backend + 13 tests + review đã vá + FE đã kiểm tra |
| 8 | Transfers & Stocktake | Chuyển kho (in-transit, chênh lệch), kiểm kho (snapshot, đếm, duyệt, giao dịch trong lúc kiểm) | 3 | ✅ Phiên 5: backend + 8 tests + FE đã kiểm tra |
| 9 | Pricing & Promotions | Bảng giá theo chi nhánh/nhóm khách/số lượng, khuyến mãi, voucher, mua X tặng Y, xung đột | 5 | ✅ Phiên 5: engine + 8 tests + unit + FE/POS đã kiểm tra |
| 10 | Reporting | Doanh thu, lợi nhuận gộp, NXT, tồn lâu, bán chạy/chậm, công nợ, thu chi, xuất Excel/PDF | 4–9 | ✅ Phiên 5: 5 báo cáo mới + Excel + FE (PDF chưa) |
| 11 | Customer CRM | Hồ sơ, nhóm, công nợ, hạn mức, điểm, loyalty, voucher | 5,6 | ✅ Phiên 5: điểm tích lũy + sinh nhật + báo cáo khách hàng (FE đang xây) |
| 12 | Employee Ops | Ca làm việc, doanh số, hoa hồng | 5 | ✅ Phiên 5: chấm công, hoa hồng, hiệu suất (FE đang xây) |
| 13 | Integrations | API key, webhook (từ outbox), import/export, máy in, thanh toán, retry/idempotency, nhật ký đồng bộ | 1–10 | 🟡 Phiên 5: chuyển dữ liệu KiotViet (Excel + API) + đối soát, có FE; API key/webhook/máy in chưa |
| 14 | SaaS | Gói, giới hạn, subscription, dashboard nền tảng | 1 | 🟡 Phiên 5: gói & hạn mức, dùng thử/chỉ đọc, API quản trị nền tảng (thanh toán online, dashboard chưa) |

## Quy trình trong mỗi module
1. Migration (Prisma) → 2. Domain logic → 3. Services → 4. Controllers + DTO validation → 5. Tests (unit + integration) → 6. UI → 7. Nối API thật → 8. E2E → 9. Cập nhật `progress.md`, `modules.md`, `test-matrix.md`.

## Lệnh kiểm tra sau mỗi module
```bash
pnpm typecheck && pnpm lint && pnpm --filter @erp/api test:unit && pnpm --filter @erp/api test:int && pnpm build
```
