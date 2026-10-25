# Danh mục module & bảng đối chiếu triển khai

Ký hiệu: ✅ có code chạy + test tương ứng · 🟡 một phần (ghi rõ phần thiếu) · ⬜ chưa làm.
Các cột **DB / BE / API / FE / Test** phản ánh thành phần **thực tế có trong repo** tại thời điểm cập nhật (2026-10-24, cuối phiên 1). FE = màn hình đã nối API thật (xem `progress.md` mục "Frontend" để biết màn hình nào đã được kiểm tra trên trình duyệt).

## MODULE 01 — Quản trị hệ thống
| Chức năng | DB | BE | API | FE | Test | Trạng thái |
|---|---|---|---|---|---|---|
| Multi-tenant (đăng ký tenant, cô lập dữ liệu bằng Prisma extension + tenant_id) | ✅ | ✅ | ✅ | ✅ | ✅ T-001, T-004 | ✅ |
| Multi-branch | ✅ | ✅ | ✅ | ✅ | ✅ T-006 | ✅ |
| Multi-warehouse (kho thuộc chi nhánh, kho mặc định) | ✅ | ✅ | ✅ | ✅ | ✅ T-006 | ✅ |
| Tài khoản nhân viên (CRUD, khóa, reset mật khẩu) | ✅ | ✅ | ✅ | ✅ | ✅ T-005 | ✅ |
| Roles & permissions (catalogue trong `packages/shared`, role tùy chỉnh) | ✅ | ✅ | ✅ | ✅ | ✅ T-005, T-052 | ✅ |
| Phân quyền theo chi nhánh / kho / thao tác | ✅ | ✅ | ✅ | ✅ | ✅ T-006 | ✅ |
| Cấu hình doanh nghiệp (settings key/value có validate) | ✅ | ✅ | ✅ | ✅ | ✅ (rbac spec) | ✅ |
| Lịch sử đăng nhập | ✅ | ✅ | ✅ | ✅ | ✅ T-003 | ✅ |
| Audit log (before/after, lọc theo entity/user/thời gian) | ✅ | ✅ | ✅ | ✅ | ✅ T-040 | ✅ |
| Cấu hình mã chứng từ (prefix, độ dài, reset theo năm/tháng) | ✅ | ✅ | ✅ | ✅ | ✅ T-051 + rbac spec | ✅ |
| Chính sách tồn kho (cho phép âm kho), costing AVG | ✅ | ✅ | ✅ | ✅ | ✅ T-023 | ✅ |
| JWT + refresh token xoay vòng, phát hiện tái sử dụng | ✅ | ✅ | ✅ | ✅ | ✅ T-002 | ✅ |
| Idempotency (header `Idempotency-Key`) | ✅ | ✅ | ✅ | ✅ (FE gửi key) | ✅ T-025, T-026 | ✅ |
| Transactional outbox + publisher | ✅ | ✅ | — | — | ✅ T-041 | 🟡 publisher mới phát event nội bộ (EventEmitter); webhook ở Module 13 |
| Automated backup | — | — | — | — | — | 🟡 `scripts/backup.sh` + service `backup` trong docker-compose; chưa chạy thử vì máy dev không có Docker |
| CI/CD | — | — | — | — | — | 🟡 `.github/workflows/ci.yml` (typecheck, lint, unit, integration với Postgres service, build, docker build); chưa chạy trên GitHub |
| Hướng dẫn sử dụng trong ứng dụng (`/help`, 75 bài theo chức năng, ảnh chụp thật desktop + điện thoại, tìm kiếm không dấu) | — | — | — | ✅ | — | ✅ `scripts/capture-guide.mjs` chụp lại 98 màn × 2 cỡ, `--check` kiểm tra ảnh thiếu |

## MODULE 02 — Hàng hóa
| Chức năng | DB | BE | API | FE | Test | Trạng thái |
|---|---|---|---|---|---|---|
| Danh mục sản phẩm, mã hàng tự động (SP000001), SKU, barcode | ✅ | ✅ | ✅ | ✅ | ✅ T-010, T-011 | ✅ |
| Nhóm hàng (cây, chống vòng lặp), thương hiệu, đơn vị tính | ✅ | ✅ | ✅ | ✅ | ✅ T-014 | ✅ |
| Biến thể theo thuộc tính (tên tự ghép, SKU tự sinh) | ✅ | ✅ | ✅ | ✅ | ✅ T-012 | ✅ |
| Đơn vị quy đổi (hệ số, barcode riêng, tra theo barcode đơn vị) | ✅ | ✅ | ✅ | ✅ | ✅ T-012 | ✅ |
| Hàng dịch vụ (không theo dõi tồn) | ✅ | ✅ | ✅ | ✅ | ✅ (products spec) | ✅ |
| Hàng combo (thành phần, tồn suy ra = min(tồn TP / SL)) | ✅ | ✅ | ✅ | ✅ | ✅ (products spec) | ✅ bung combo khi bán (BR-53, T-153) |
| Hình ảnh sản phẩm (nhiều ảnh, upload thật, ảnh đại diện) | ✅ | ✅ | ✅ | ✅ | ✅ (uploads spec) | ✅ lưu đĩa cục bộ `UPLOAD_DIR`, phục vụ tại `/uploads/...`; chưa có resize/thumbnail và lưu trữ S3 |
| Giá bán / giá vốn (do kho duy trì) / giá nhập gần nhất | ✅ | ✅ | ✅ | ✅ | ✅ T-013, T-020 | ✅ |
| Bảng giá (CRUD, item theo biến thể, theo chi nhánh) | ✅ | ✅ | ✅ | ✅ | ⬜ | ✅ áp dụng khi bán theo nhóm khách / chi nhánh (Module 09, T-196) |
| Tồn min/max, lọc tồn thấp/hết/vượt; ngừng kinh doanh | ✅ | ✅ | ✅ | ✅ | ✅ T-013, T-014 | ✅ |
| Import/Export Excel (+ file mẫu) | — | ✅ | ✅ | ✅ | ✅ (products spec) | ✅ |
| Tìm kiếm & lọc nâng cao, tìm nhanh theo mã/tên/barcode | — | ✅ | ✅ | ✅ | ✅ T-014 | ✅ |
| Lô & hạn sử dụng | ✅ | ✅ | ✅ | ✅ | ✅ T-031 | ✅ |
| Serial | ⬜ | ⬜ | ⬜ | ⬜ | ⬜ | ⬜ |

## MODULE 03 — Kho
| Chức năng | DB | BE | API | FE | Test | Trạng thái |
|---|---|---|---|---|---|---|
| Tồn theo SKU / kho / chi nhánh / lô | ✅ | ✅ | ✅ | ✅ | ✅ T-020 | ✅ |
| Tồn khả dụng, tồn đã giữ (reservation API) | ✅ | ✅ | ✅ | ✅ (hiển thị) | ✅ T-034 | ✅ |
| Stock ledger (movements, balance_after) & stock balances | ✅ | ✅ | ✅ | ✅ | ✅ T-020, T-032 | ✅ |
| Cost ledger, giá vốn bình quân di động | ✅ | ✅ | ✅ | ✅ | ✅ T-020, T-021, T-050 | ✅ |
| Nhập kho khác / Xuất kho (hủy, dùng nội bộ, mất mát) | ✅ | ✅ | ✅ | ✅ | ✅ T-020..T-030 | ✅ |
| Điều chỉnh tồn (theo số đếm thực tế, tính chênh lệch lúc ghi sổ) | ✅ | ✅ | ✅ | ✅ | ✅ T-031 | ✅ |
| Hủy chứng từ = ghi đảo (REVERSAL), chặn khi làm âm kho | ✅ | ✅ | ✅ | ✅ | ✅ T-027, T-028 | ✅ |
| Lịch sử biến động / thẻ kho | ✅ | ✅ | ✅ | ✅ | ✅ T-032 | ✅ |
| Trang chủ mobile-first (`/dashboard/home`): doanh thu hôm nay / 7 ngày / tháng so với kỳ trước, theo giờ & ngày, lối tắt theo quyền, việc cần xử lý, hàng bán chạy, hoạt động gần đây, tồn kho, ca đang mở | — | ✅ | ✅ | ✅ | ✅ T-250 | ✅ |
| Cảnh báo tồn thấp (lọc + đếm trên dashboard) | ✅ | ✅ | ✅ | ✅ | 🟡 gián tiếp (T-014 low) | 🟡 chưa có thông báo đẩy |
| Giá trị tồn kho, đối soát balance ↔ ledger ↔ cost ledger | ✅ | ✅ | ✅ | 🟡 | ✅ T-033 | 🟡 API `POST /inventory/reconcile` có; chưa có job định kỳ & màn hình riêng |
| Kiểm soát tồn âm, chống xuất trùng, nhiều POS đồng thời | ✅ | ✅ | ✅ | — | ✅ T-022, T-024, T-025 | ✅ (row lock + idempotency; 20 request song song) |
| Chuyển kho (xuất → đang chuyển → nhận, chênh lệch thiếu: thất thoát / trả về nguồn, hủy khi đang chuyển, liên chi nhánh) | ✅ | ✅ | ✅ | ✅ | ✅ T-181..T-184 | ✅ |
| Kiểm kho (snapshot theo dòng, nhiều người đếm, giao dịch trong lúc kiểm, cân bằng, hủy) | ✅ | ✅ | ✅ | ✅ | ✅ T-185..T-188 | ✅ |

## MODULE 04 — Mua hàng
| Chức năng | DB | BE | API | FE | Test | Trạng thái |
|---|---|---|---|---|---|---|
| Nhà cung cấp (mã tự sinh, nhóm, công nợ đầu kỳ, lịch sử, sổ công nợ) | ✅ | ✅ | ✅ | ✅ | ✅ T-100 | ✅ |
| Đơn đặt mua (nháp → xác nhận → nhập một phần → đủ, hủy) | ✅ | ✅ | ✅ | ✅ | ✅ T-104 | ✅ |
| Phiếu nhập hàng (từ đơn hoặc trực tiếp, nhập từng phần) | ✅ | ✅ | ✅ | ✅ | ✅ T-101, T-104, T-105 | ✅ |
| Chiết khấu dòng / phiếu, thuế mua hàng | ✅ | ✅ | ✅ | ✅ | ✅ T-090, T-101 | ✅ |
| Chi phí nhập hàng + phân bổ vào giá vốn (theo giá trị / số lượng) | ✅ | ✅ | ✅ | ✅ | ✅ T-090, T-101, T-109 | ✅ |
| Thanh toán NCC (phiếu chi, phân bổ, trả trước, hủy) | ✅ | ✅ | ✅ | ✅ | ✅ T-102, T-103, T-120, T-123 | ✅ |
| Công nợ phải trả (ledger + party_balances + allocations) | ✅ | ✅ | ✅ | ✅ | ✅ T-100, T-103, T-112, T-122 | ✅ |
| Trả hàng nhập (nhiều lần, không vượt SL nhận, đồng thời) | ✅ | ✅ | ✅ | ✅ | ✅ T-107, T-108, T-121 | ✅ |
| Hoàn tiền từ NCC (phiếu thu phân bổ vào phiếu trả) | ✅ | ✅ | ✅ | ✅ | ✅ T-107 | ✅ |
| Hủy / điều chỉnh chứng từ (đảo kho + đảo ledger, chặn khi đã trả/đã thanh toán) | ✅ | ✅ | ✅ | ✅ | ✅ T-106, T-107, T-125 | ✅ |
| Lịch sử mua hàng theo NCC | ✅ | ✅ | ✅ | ✅ | ✅ T-112 | ✅ |
| Báo cáo mua hàng (theo kỳ, theo NCC, top hàng), công nợ NCC | — | ✅ | ✅ | ✅ | ✅ T-112 | ✅ |
| Đồng bộ quyền vai trò mặc định cho tenant cũ (`prisma:sync-roles`) | — | ✅ | — | — | — | ✅ |
## MODULE 05 — Bán hàng POS
| Chức năng | DB | BE | API | FE | Test | Trạng thái |
|---|---|---|---|---|---|---|
| Hóa đơn: tạo, giữ đơn (DRAFT), sửa, xóa, hoàn thành, hủy | ✅ | ✅ | ✅ | ✅ | ✅ T-137, T-139, T-150, T-154 | ✅ |
| Tìm hàng / quét barcode / giỏ hàng nhiều tab / đổi số lượng / phím tắt | — | ✅ (API tìm nhanh, giá niêm yết) | ✅ | ✅ | ✅ T-142 | ✅ |
| Áp dụng bảng giá, đơn vị quy đổi, combo | ✅ | ✅ | ✅ | ✅ | ✅ T-135, T-153, T-155 | ✅ |
| Chiết khấu dòng / hóa đơn (có quyền, trần %), thuế gộp/cộng thêm | ✅ | ✅ | ✅ | ✅ | ✅ T-130, T-135, T-136, T-155 | ✅ |
| Chọn khách hàng (tạo nhanh), chi nhánh, kho, nhân viên bán, ghi chú | ✅ | ✅ | ✅ | ✅ | ✅ T-133, T-141 | ✅ |
| Thanh toán tiền mặt / chuyển khoản / thẻ / ví, kết hợp, một phần, tiền thừa, bán trả sau (hạn mức), thu nợ sau | ✅ | ✅ | ✅ | ✅ | ✅ T-132..T-134 | ✅ |
| Xuất kho theo giá vốn bình quân, COGS tách giá bán | ✅ | ✅ | ✅ | — | ✅ T-132, T-135 | ✅ |
| Hủy giao dịch (hoàn tồn, hủy phiếu thu, đảo công nợ) | ✅ | ✅ | ✅ | ✅ | ✅ T-139, T-150, T-156 | ✅ |
| Nhiều POS đồng thời (đơn vị cuối cùng), idempotent checkout | ✅ | ✅ | ✅ | — | ✅ T-137, T-138 | ✅ |
| Ca bán hàng & đối soát tiền thu | ✅ | ✅ | ✅ | ✅ | ✅ T-140, T-152 | ✅ |
| Theo dõi nhân viên bán, báo cáo doanh thu / lợi nhuận gộp theo NV, SP, phương thức | ✅ | ✅ | ✅ | ✅ | ✅ T-141 | ✅ |
| In hóa đơn (mẫu 80mm, xem trước và in) | — | — | — | ✅ | — | ✅ |
| Trả hàng / đổi hàng | ✅ | ✅ | ✅ | ✅ | ✅ T-160..T-166 | ✅ Module 07: backend xong, |
| Đơn đặt trước | ⬜ | ⬜ | ⬜ | ⬜ | ⬜ | ⬜ Module 06 |
| Khuyến mãi / voucher | ⬜ | ⬜ | ⬜ | ⬜ | ⬜ | ⬜ Module 09 |
## MODULE 06 — Đặt hàng & giao hàng
| Chức năng | DB | BE | API | FE | Test | Trạng thái |
|---|---|---|---|---|---|---|
| Đơn đặt hàng (POS / điện thoại / online), phiếu tạm → xác nhận giữ tồn → hoàn tất → hóa đơn | ✅ | ✅ | ✅ | ✅ | ✅ T-200, T-201, T-205 | ✅ |
| Tiền cọc (phiếu thu phân bổ đơn, công nợ khách), chuyển cọc sang hóa đơn | ✅ | ✅ | ✅ | ✅ | ✅ T-200, T-202 | ✅ |
| Hủy đơn: trả tồn, hoàn cọc / giữ làm số dư có | ✅ | ✅ | ✅ | ✅ | ✅ T-202 | ✅ |
| Vận đơn: người nhận, ĐVVC, phí, COD, trạng thái có lịch sử, chuyển hoàn | ✅ | ✅ | ✅ | ✅ | ✅ T-203, T-204 | ✅ |
| Thu hộ COD về quỹ (phân bổ hóa đơn + phí giao hàng là thu khác), đối soát sau | ✅ | ✅ | ✅ | ✅ | ✅ T-203, T-204 | ✅ |
| Kết nối API đơn vị vận chuyển (GHTK/GHN/Viettel Post), in phiếu gửi | ⬜ | ⬜ | ⬜ | ⬜ | ⬜ | ⬜ Module 13 |
## MODULE 07 — Khách hàng & trả hàng
| Chức năng | DB | BE | API | FE | Test | Trạng thái |
|---|---|---|---|---|---|---|
| Hồ sơ KH, nhóm, hạn mức nợ, công nợ (ledger), lịch sử mua hàng, sổ công nợ, thu nợ | ✅ | ✅ | ✅ | ✅ | ✅ T-131, T-133, T-134 | ✅ |
| Trả hàng tham chiếu hóa đơn gốc; trả một phần, nhiều lần; không vượt SL hợp lệ | ✅ | ✅ | ✅ | ✅ | ✅ T-160, T-161 | ✅ |
| Hàng nhập lại kho vs hàng hỏng; giá hoàn = tiền thực trả; phí trả hàng | ✅ | ✅ | ✅ | ✅ | ✅ T-162, T-163 | ✅ |
| Hoàn tiền (phiếu chi, gắn ca) hoặc cấn trừ công nợ | ✅ | ✅ | ✅ | ✅ | ✅ T-162, T-166 | ✅ |
| Đổi hàng (trả + mua mới, cấn trừ OFFSET, bù chênh lệch) | ✅ | ✅ | ✅ | ✅ | ✅ T-164 | ✅ |
| Hủy phiếu trả (đảo kho, ledger, phiếu chi) | ✅ | ✅ | ✅ | ✅ | ✅ T-165 | ✅ |
| Lịch sử trả hàng (theo KH, theo hóa đơn), hạn trả hàng | ✅ | ✅ | ✅ | ✅ | ✅ T-162, T-166 | ✅ |
| Điểm tích lũy (tích theo tiền, tiêu như thanh toán, đảo khi hủy / trả hàng, điều chỉnh tay), sinh nhật, báo cáo giá trị khách hàng; voucher ở Module 09 | ✅ | ✅ | ✅ | ✅ | ✅ T-230..T-233 | ✅ |
## MODULE 08 — Thanh toán & công nợ
| Chức năng | DB | BE | API | FE | Test | Trạng thái |
|---|---|---|---|---|---|---|
| Phiếu thu/chi, phân bổ vào chứng từ (PN, THN, HD, TH), trả trước, hủy phiếu | ✅ | ✅ | ✅ | ✅ | ✅ T-052, T-134 | ✅ |
| Công nợ NCC/KH: ledger + số dư cache + đối soát, sổ công nợ, báo cáo | ✅ | ✅ | ✅ | ✅ | ✅ T-050, T-133 | ✅ |
| Quỹ tiền / tài khoản (két theo chi nhánh, ngân hàng, ví), quỹ mặc định, số dư theo phiếu | ✅ | ✅ | ✅ | ✅ | ✅ T-170, T-173 | ✅ |
| Sổ quỹ (tồn quỹ chạy theo phiếu), tổng hợp thu chi theo quỹ / loại | ✅ | ✅ | ✅ | ✅ | ✅ T-170 | ✅ |
| Thu / chi khác theo loại thu chi (`payment.other`) | ✅ | ✅ | ✅ | ✅ | ✅ T-172 | ✅ |
| Chuyển quỹ, bàn giao ca khi đóng ca | ✅ | ✅ | ✅ | ✅ | ✅ T-171, T-175, T-176 | ✅ |
| Kiểm quỹ (đếm vs sổ) | ✅ | ✅ | ✅ | ✅ | ✅ T-173 | ✅ |
| Cấn trừ công nợ KH ↔ NCC (và hủy theo cặp) | ✅ | ✅ | ✅ | ✅ | ✅ T-174, T-177 | ✅ |
| Nhắc nợ / hạn thanh toán, lịch sử nhắc | ⬜ | ⬜ | ⬜ | ⬜ | ⬜ | ⬜ (Module 11 CRM) |
## MODULE 09 — Giá & khuyến mãi
| Chức năng | DB | BE | API | FE | Test | Trạng thái |
|---|---|---|---|---|---|---|
| Bảng giá theo chi nhánh, theo số lượng (bậc), ưu tiên, thời hạn | ✅ | ✅ | ✅ | ✅ | ✅ T-135 | ✅ |
| Bảng giá theo nhóm khách hàng + danh sách áp dụng được cho POS | ✅ | ✅ | ✅ | ✅ | ✅ T-196 | ✅ |
| Khuyến mãi giảm giá hóa đơn theo mức, giảm giá hàng hóa (%/tiền/giá cố định) | ✅ | ✅ | ✅ | ✅ | ✅ T-190, unit | ✅ |
| Mua X tặng Y, tặng hàng theo hóa đơn (dòng hàng tặng 0 đ, vẫn ghi kho & giá vốn) | ✅ | ✅ | ✅ | ✅ | ✅ T-191, T-194 | ✅ |
| Voucher / mã giảm giá (phát hành, tra cứu, 1 lượt dưới đồng thời, hoàn lượt khi hủy) | ✅ | ✅ | ✅ | ✅ | ✅ T-192 | ✅ |
| Xung đột: ưu tiên, cộng dồn / không cộng dồn, giới hạn lượt & theo khách, chi nhánh, nhóm khách, ngày/giờ | ✅ | ✅ | ✅ | ✅ | ✅ T-193, T-195 | ✅ |
| Preview giỏ hàng (giá, khuyến mãi, quà tặng, tổng) cho POS | — | ✅ | ✅ | ✅ | ✅ T-190..T-194 | ✅ |
| Báo cáo khuyến mãi (lượt, tiền giảm, doanh thu kèm) | — | ✅ | ✅ | ✅ | ✅ T-190 | ✅ |
## MODULE 10 — Báo cáo
| Chức năng | DB | BE | API | FE | Test | Trạng thái |
|---|---|---|---|---|---|---|
| Dashboard tổng quan (hàng hóa, tồn, giá trị tồn, doanh thu hôm nay) | — | ✅ | ✅ | ✅ | ✅ | ✅ |
| Doanh thu – giá vốn – lợi nhuận gộp theo kỳ / chi nhánh / nhân viên / hàng / phương thức; doanh thu ròng sau trả hàng | — | ✅ | ✅ | ✅ | ✅ T-141 | ✅ |
| Mua hàng, công nợ NCC / KH, sổ quỹ & tổng hợp thu chi, khuyến mãi | — | ✅ | ✅ | ✅ | ✅ | ✅ |
| Nhập – xuất – tồn theo kỳ (từ sổ kho) | — | ✅ | ✅ | ✅ | ✅ T-210 | ✅ |
| Hàng tồn lâu / bán chậm (N ngày) | — | ✅ | ✅ | ✅ | ✅ T-211 | ✅ |
| Hàng bán chạy / bán chậm theo doanh thu, SL, lợi nhuận | — | ✅ | ✅ | ✅ | ✅ T-212 | ✅ |
| Lãi lỗ (doanh thu thuần, giá vốn, thu/chi khác, thất thoát, chi phí giao hàng) | — | ✅ | ✅ | ✅ | ✅ T-213 | ✅ |
| Giá trị tồn kho theo nhóm / kho / thương hiệu | — | ✅ | ✅ | ✅ | ✅ T-214 | ✅ |
| Xuất Excel báo cáo (doanh thu, lãi lỗ, NXT, tồn lâu, giá trị tồn, bán chạy/chậm, công nợ KH/NCC, sổ quỹ; thuế GTGT chưa có) | — | ✅ | ✅ | ✅ | ✅ T-214 | ✅ |
| Xuất PDF, báo cáo theo lịch gửi email | ⬜ | ⬜ | ⬜ | ⬜ | ⬜ | ⬜ |
## MODULE 11 — Nhân viên
| Chức năng | DB | BE | API | FE | Test | Trạng thái |
|---|---|---|---|---|---|---|
| Tài khoản, vai trò, phân quyền chi nhánh/kho, nhật ký thao tác & đăng nhập | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ |
| Ca bán hàng (mở/đóng/đối soát, bàn giao) | ✅ | ✅ | ✅ | ✅ | ✅ T-140, T-175 | ✅ |
| Hồ sơ nhân viên (chức vụ, ngày vào, lương cơ bản) | ✅ | ✅ | ✅ | ✅ | ✅ T-240 | ✅ |
| Quy tắc hoa hồng (nhân viên / nhóm hàng / hàng, doanh thu / LN gộp / số lượng, ngưỡng) + báo cáo hoa hồng | ✅ | ✅ | ✅ | ✅ | ✅ T-240 | ✅ |
| Chấm công vào/ra, sửa & bổ sung, tổng giờ | ✅ | ✅ | ✅ | ✅ | ✅ T-241 | ✅ |
| Hiệu suất nhân viên (doanh thu, LN gộp, ca, lệch tiền, giờ công, hoa hồng) | — | ✅ | ✅ | ✅ | ✅ T-242 | ✅ |
## MODULE 12 — Kế toán & thuế
| Chức năng | DB | BE | API | FE | Test | Trạng thái |
|---|---|---|---|---|---|---|
| Thuế suất trên hàng hóa, giá gồm/không gồm thuế, thuế trên dòng hóa đơn & phiếu nhập | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ |
| Báo cáo thuế GTGT đầu ra / đầu vào theo thuế suất | — | ✅ | ✅ | ✅ | ✅ T-245 | ✅ |
| Xuất dữ liệu kế toán (Excel: doanh thu, lãi lỗ, sổ quỹ, công nợ) | — | ✅ | ✅ | ✅ | ✅ T-214 | ✅ |
| Hóa đơn điện tử (kết nối nhà cung cấp HĐĐT) | ⬜ | ⬜ | ⬜ | ⬜ | ⬜ | ⬜ |
## MODULE 13 — Tích hợp
| Chức năng | DB | BE | API | FE | Test | Trạng thái |
|---|---|---|---|---|---|---|
| OpenAPI/Swagger (~165 endpoint), idempotency, outbox, audit | — | ✅ | ✅ | — | ✅ | ✅ |
| Nhập Excel KiotViet: hàng hóa (nhóm nhiều cấp, thương hiệu, ảnh, đơn vị quy đổi, tồn theo kho), khách hàng & NCC (công nợ), lịch sử hóa đơn — xem trước / ánh xạ cột / xác nhận, idempotent | ✅ | ✅ | ✅ | ✅ | ✅ T-220..T-222, T-224 | ✅ |
| Kết nối KiotViet Public API (người dùng tự nhập thông tin, secret mã hóa), kiểm tra kết nối, kéo dữ liệu | ✅ | ✅ | ✅ | ✅ | ✅ T-223 | ✅ |
| Đối soát sau nhập (số lượng, tồn, công nợ, hóa đơn lịch sử) | — | ✅ | ✅ | ✅ | ✅ T-222 | ✅ |
| Import/export Excel hàng hóa, báo cáo Excel | — | ✅ | ✅ | ✅ | ✅ | ✅ |
| Thanh toán chuyển khoản tự động qua SePay: VietQR theo mã (POS, hóa đơn còn nợ, cọc đơn), webhook khớp mã → phiếu thu BANK_TRANSFER, giao dịch chưa khớp gắn tay / bỏ qua | ✅ | ✅ | ✅ | ✅ | ✅ T-260..T-266 | ✅ |
| API key cho bên thứ ba, webhook từ outbox, đồng bộ sàn TMĐT, máy in nhiệt | ⬜ | ⬜ | ⬜ | ⬜ | ⬜ | ⬜ |
## MODULE 14 — SaaS
| Chức năng | DB | BE | API | FE | Test | Trạng thái |
|---|---|---|---|---|---|---|
| Đăng ký gian hàng, dùng thử 30 ngày, trạng thái TRIAL/ACTIVE/SUSPENDED/CLOSED | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ |
| Gói FREE/BASIC/PRO/ENTERPRISE với hạn mức chi nhánh / kho / người dùng / hàng hóa, chặn khi vượt | ✅ | ✅ | ✅ | ✅ | ✅ T-243 | ✅ |
| Hết hạn dùng thử / gói → chỉ đọc; tạm ngưng chặn đăng nhập | ✅ | ✅ | ✅ | ✅ | ✅ T-244 | ✅ |
| Quản trị nền tảng (danh sách gian hàng, đổi gói / trạng thái) bằng khóa nền tảng | — | ✅ | ✅ | ⬜ | ✅ T-243 | 🟡 API (chưa có màn hình quản trị nền tảng) |
| Thanh toán gói online, dashboard nền tảng | ⬜ | ⬜ | ⬜ | ⬜ | ⬜ | ⬜ |
