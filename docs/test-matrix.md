# Test Matrix

Loại: U = unit (jest, không DB) · I = integration (jest + supertest + PostgreSQL thật) · E = end-to-end UI (thủ công / Playwright sau này).
Trạng thái cập nhật theo kết quả chạy thực tế (lần chạy gần nhất: 2026-10-24, lệnh `pnpm --filter @erp/api test` → 17 suites, 115 tests pass; chi tiết trong `progress.md`).

Bổ sung ngoài kế hoạch ban đầu (đã có test, đều pass): refresh-token reuse detection, change-password thu hồi token, opening stock khi tạo hàng, SERVICE không nhập kho, tồn COMBO suy ra từ thành phần, export/import Excel, cấu hình sequence theo tháng, 20 request xuất song song / 10 tồn, nhập song song thứ tự dòng ngược nhau không deadlock, sinh mã hàng song song không trùng.

| ID | Kịch bản | BR | Loại | File | Trạng thái |
|---|---|---|---|---|---|
| T-001 | Đăng ký tenant tạo chi nhánh/kho mặc định, role Admin `*`, login trả token | BR-02, BR-04 | I | test/auth.e2e-spec.ts | ✅ pass 2026-10-24 |
| T-002 | Làm mới token xoay vòng; dùng lại ngay trong cửa sổ 60 s (tab thứ hai) được cấp cặp mới; dùng lại sau cửa sổ → `REFRESH_TOKEN_REUSED` và thu hồi cả chuỗi; đăng xuất thu hồi | BR-05, BR-05b | I | test/auth.e2e-spec.ts | ✅ pass 2026-10-24 |
| T-003 | Sai mật khẩu ghi `login_history` thất bại; đúng ghi thành công | — | I | test/auth.e2e-spec.ts | ✅ pass 2026-10-24 |
| T-004 | Tenant B không thấy/không sửa được dữ liệu tenant A | BR-01 | I | test/tenant-isolation.e2e-spec.ts | ✅ pass 2026-10-24 |
| T-005 | User không có permission bị 403; role được cấp thì 200 | BR-04 | I | test/rbac.e2e-spec.ts | ✅ pass 2026-10-24 |
| T-006 | User chỉ có chi nhánh A không ghi sổ được phiếu ở chi nhánh B (403 BRANCH_ACCESS_DENIED) | BR-03 | I | test/rbac.e2e-spec.ts | ✅ pass 2026-10-24 |
| T-010 | Tạo hàng không mã → mã tự sinh SP000001, SP000002 liên tiếp | BR-10, BR-40 | I | test/products.e2e-spec.ts | ✅ pass 2026-10-24 |
| T-011 | Trùng SKU / barcode trong tenant → 409 | BR-11 | I | test/products.e2e-spec.ts | ✅ pass 2026-10-24 |
| T-012 | Hàng có biến thể: tạo N variant, cập nhật giá, tìm theo barcode | BR-11 | I | test/products.e2e-spec.ts | ✅ pass 2026-10-24 |
| T-013 | Xóa hàng đã có movement → 409 PRODUCT_IN_USE; ngừng kinh doanh OK | BR-15 | I | test/products.e2e-spec.ts | ✅ pass 2026-10-24 |
| T-014 | Tìm kiếm/lọc theo nhóm, thương hiệu, trạng thái, phân trang | — | I | test/products.e2e-spec.ts | ✅ pass 2026-10-24 |
| T-020 | Ghi sổ phiếu nhập: balance, movement, cost ledger, avg cost đúng công thức | BR-23, BR-31 | I | test/inventory.e2e-spec.ts | ✅ pass 2026-10-24 |
| T-021 | Nhập lần 2 giá khác → avg cost gia quyền; xuất dùng avg | BR-31, BR-32 | I | test/inventory.e2e-spec.ts | ✅ pass 2026-10-24 |
| T-022 | Xuất quá tồn → 409 INSUFFICIENT_STOCK; không có movement nào được ghi | BR-25, BR-23 | I | test/inventory.e2e-spec.ts | ✅ pass 2026-10-24 |
| T-023 | Bật allowNegativeStock → xuất quá tồn thành công, on_hand âm | BR-25 | I | test/inventory.e2e-spec.ts | ✅ pass 2026-10-24 |
| T-024 | **Hai request đồng thời xuất đơn vị cuối cùng → đúng 1 thành công** | BR-24 | I | test/inventory-concurrency.e2e-spec.ts | ✅ pass 2026-10-24 |
| T-025 | **Idempotency-Key trùng khi tạo+ghi sổ → chỉ 1 chứng từ, lần 2 replay** | BR-29 | I | test/inventory.e2e-spec.ts | ✅ pass 2026-10-24 |
| T-026 | Cùng key khác payload → 409 IDEMPOTENCY_KEY_REUSED | BR-29 | I | test/inventory.e2e-spec.ts | ✅ pass 2026-10-24 |
| T-027 | **Hủy phiếu nhập đã ghi sổ → movements REVERSAL, balance về cũ, hủy lần 2 bị từ chối** | BR-26 | I | test/inventory.e2e-spec.ts | ✅ pass 2026-10-24 |
| T-028 | Hủy phiếu nhập khi hàng đã xuất bớt → 409 INSUFFICIENT_STOCK | BR-26 | I | test/inventory.e2e-spec.ts | ✅ pass 2026-10-24 |
| T-029 | Sửa/xóa phiếu đã POSTED → 409 DOCUMENT_NOT_EDITABLE | BR-27 | I | test/inventory.e2e-spec.ts | ✅ pass 2026-10-24 |
| T-030 | **Transaction thất bại giữa chừng (dòng 2 lỗi) → không có balance/movement nào của dòng 1** | BR-23 | I | test/inventory.e2e-spec.ts | ✅ pass 2026-10-24 |
| T-031 | Điều chỉnh tồn (actual − system), hàng theo lô bắt buộc lô | BR-33, BR-16 | I | test/inventory.e2e-spec.ts | ✅ pass 2026-10-24 |
| T-032 | Thẻ kho: balance_after khớp, lọc theo kho/biến thể | BR-28 | I | test/inventory.e2e-spec.ts | ✅ pass 2026-10-24 |
| T-033 | Đối soát: Σ movements = balances sau chuỗi thao tác | BR-20 | I | test/inventory.e2e-spec.ts | ✅ pass 2026-10-24 |
| T-034 | Reservation làm giảm available, không đổi on_hand | BR-21 | I | test/inventory.e2e-spec.ts | ✅ pass 2026-10-24 |
| T-040 | Audit log ghi cho create/post/cancel | BR-50 | I | test/inventory.e2e-spec.ts | ✅ pass 2026-10-24 |
| T-041 | Outbox có event sau post; publisher đánh dấu PUBLISHED | BR-51 | I | test/inventory.e2e-spec.ts | ✅ pass 2026-10-24 |
| T-070 | Tham số `warehouseId`/`branchId` không mở rộng được phạm vi truy cập (balances, movements, documents, reservations, summary, products, dashboard) | BR-03 | I | test/hardening.e2e-spec.ts | ✅ pass 2026-10-24 |
| T-071 | Người dùng giới hạn kho không ghi sổ/xóa được phiếu của kho khác cùng chi nhánh | BR-03 | I | test/hardening.e2e-spec.ts | ✅ pass 2026-10-24 |
| T-072 | Điều chỉnh tồn tính chênh lệch dưới khóa hàng khi có phiếu xuất chen ngang (giữ khóa bằng transaction thô) | BR-24 | I | test/hardening.e2e-spec.ts | ✅ pass 2026-10-24 |
| T-073 | Xuất kho không được vượt tồn khả dụng (đã trừ giữ tồn); giải phóng giữ tồn thì xuất được | BR-21, BR-25 | I | test/hardening.e2e-spec.ts | ✅ pass 2026-10-24 |
| T-074 | Giữ tồn kiểm tra lô/biến thể/tenant; giải phóng cần quyền kho | BR-16, BR-03 | I | test/hardening.e2e-spec.ts | ✅ pass 2026-10-24 |
| T-075 | 4 request trùng key đồng thời → 1 chứng từ; key riêng theo người dùng; key hết hạn được dùng lại | BR-29 | I | test/hardening.e2e-spec.ts | ✅ pass 2026-10-24 |
| T-076 | Hai refresh đồng thời cùng token → đúng 1 thành công; token qua query string bị từ chối | — | I | test/hardening.e2e-spec.ts | ✅ pass 2026-10-24 |
| T-077 | Bảng giá từ chối chi nhánh của tenant khác | BR-01 | I | test/hardening.e2e-spec.ts | ✅ pass 2026-10-24 |
| T-078 | Enum/ngày/số âm/số mũ/thuế > 100/combo SL 0/padding > 12 → 400 (không 500); barcode được trim | — | I | test/hardening.e2e-spec.ts | ✅ pass 2026-10-24 |
| T-080 | Upload nhiều ảnh (PNG/JPEG) → URL theo thư mục tenant, phục vụ tĩnh 200; tệp không phải ảnh / không có tệp → 400 | — | I | test/uploads.e2e-spec.ts | ✅ pass 2026-10-24 |
| T-081 | Tạo hàng với nhiều ảnh (ảnh đầu = đại diện), sắp xếp lại, xóa hết; URL tenant khác / đường dẫn lạ → 400 | BR-01 | I | test/uploads.e2e-spec.ts | ✅ pass 2026-10-24 |
| T-082 | Xóa ảnh chỉ trong thư mục tenant của mình và cần `product.update`; sau xóa URL trả 404 | BR-01, BR-04 | I | test/uploads.e2e-spec.ts | ✅ pass 2026-10-24 |
| T-090 | Công thức phiếu nhập: phân bổ CK phiếu, thuế, chi phí theo giá trị/số lượng, làm tròn dồn dòng cuối (unit) | BR-44, BR-45 | U | src/modules/purchasing/purchase-calc.spec.ts | ✅ pass 2026-10-24 |
| T-100 | NCC mã tự sinh, công nợ đầu kỳ qua ledger, trùng mã → 409 | BR-40, BR-41 | I | test/purchasing.e2e-spec.ts | ✅ pass 2026-10-24 |
| T-101 | Ghi sổ phiếu nhập: tồn + giá vốn phân bổ (114.500), giá nhập gần nhất, công nợ +1.145.000 | BR-43..45 | I | test/purchasing.e2e-spec.ts | ✅ pass 2026-10-24 |
| T-102 | Thanh toán ngay khi hoàn thành → phiếu chi PC phân bổ; vượt tổng → 409 | BR-48 | I | test/purchasing.e2e-spec.ts | ✅ pass 2026-10-24 |
| T-103 | Thanh toán một phần, vượt nợ → OVERPAYMENT, trả trước, hủy phiếu chi hoàn lại nợ + ledger | BR-48 | I | test/purchasing.e2e-spec.ts | ✅ pass 2026-10-24 |
| T-104 | Đơn đặt hàng: nhập khi DRAFT bị chặn, nhập từng phần → PARTIAL/RECEIVED, vượt → 409, hủy phiếu nhập mở lại đơn, hủy đơn khi còn nháp bị chặn | BR-42 | I | test/purchasing.e2e-spec.ts | ✅ pass 2026-10-24 |
| T-105 | 3 request post-now trùng key → 1 phiếu nhập | BR-29 | I | test/purchasing.e2e-spec.ts | ✅ pass 2026-10-24 |
| T-106 | Hủy phiếu nhập: đảo kho + đảo ledger; chặn khi đã thanh toán, đã trả hàng, hoặc hàng đã xuất bớt | BR-46 | I | test/purchasing.e2e-spec.ts | ✅ pass 2026-10-24 |
| T-107 | Trả hàng nhiều lần không vượt SL nhận, giá trả mặc định = giá ròng, hoàn tiền → PT, hủy phiếu trả, trả khi hết tồn bị chặn | BR-47 | I | test/purchasing.e2e-spec.ts | ✅ pass 2026-10-24 |
| T-108 | 4 phiếu trả đồng thời cùng dòng → đúng 1 thành công | BR-47, BR-24 | I | test/purchasing.e2e-spec.ts | ✅ pass 2026-10-24 |
| T-109 | Giá vốn bình quân sau nhập hàng (có/không tính thuế vào giá vốn); đối soát ledger kho khớp | BR-31, BR-45 | I | test/purchasing.e2e-spec.ts | ✅ pass 2026-10-24 |
| T-110 | Phân quyền mua hàng: thủ kho nhập được nhưng không xem công nợ/lập phiếu chi; thu ngân bị 403; giới hạn chi nhánh | BR-03, BR-04 | I | test/purchasing.e2e-spec.ts | ✅ pass 2026-10-24 |
| T-111 | Tenant khác không dùng được NCC/phiếu nhập của tenant này | BR-01 | I | test/purchasing.e2e-spec.ts | ✅ pass 2026-10-24 |
| T-112 | Báo cáo mua hàng, công nợ NCC, lịch sử NCC; Σ ledger = số dư cache | BR-41 | I | test/purchasing.e2e-spec.ts | ✅ pass 2026-10-24 |
| T-120 | Thanh toán/hoàn tiền kèm phiếu cần `payment.create`: thủ kho → 403, không tạo phiếu và rollback toàn bộ | BR-48 | I | test/purchasing-hardening.e2e-spec.ts | ✅ pass 2026-10-24 |
| T-121 | Giá trả mặc định = tiền thực trả/đơn vị (gồm CK phiếu, thuế); giá vượt → 400; hoàn vượt → 409; CHECK constraint DB | BR-47 | I | test/purchasing-hardening.e2e-spec.ts | ✅ pass 2026-10-24 |
| T-122 | Stress thứ tự khóa: hủy ↔ ghi sổ cùng đơn/hàng, thanh toán ngay ↔ phiếu chi, phân bổ ngược thứ tự → không có 500; đối soát kho + công nợ khớp | BR-48, BR-24 | I | test/purchasing-hardening.e2e-spec.ts | ✅ pass 2026-10-24 |
| T-123 | Phiếu chi phân bổ chéo chi nhánh → 403; chi nhánh không tồn tại/tenant khác → 404; sổ công nợ lọc theo chi nhánh | BR-03, BR-48 | I | test/purchasing-hardening.e2e-spec.ts | ✅ pass 2026-10-24 |
| T-124 | `orderLineId` không có đơn → 400; giá 0 + chi phí nhập vẫn vào giá vốn; mã NCC tự sinh tránh trùng mã nhập tay; lý do hủy rỗng → 400; dòng trùng orderLineId cộng dồn | BR-42, BR-45 | I | test/purchasing-hardening.e2e-spec.ts | ✅ pass 2026-10-24 |
| T-125 | Hủy phiếu nhập khôi phục giá nhập gần nhất trước đó | BR-46 | I | test/purchasing-hardening.e2e-spec.ts | ✅ pass 2026-10-24 |
| T-130 | Công thức hóa đơn: giảm dòng + giảm phiếu, thuế gộp trong giá / cộng thêm (unit) | BR-52 | U | src/modules/sales/sales-calc.spec.ts | ✅ pass 2026-10-24 |
| T-131 | Khách hàng: mã KH tự sinh, công nợ đầu kỳ qua ledger, tìm nhanh theo SĐT | BR-50 | I | test/sales.e2e-spec.ts | ✅ pass 2026-10-24 |
| T-132 | Bán tiền mặt: xuất kho SALE theo giá vốn BQ, COGS tách khỏi giá bán, phiếu thu PT, khách lẻ không ghi ledger | BR-53, BR-54 | I | test/sales.e2e-spec.ts | ✅ pass 2026-10-24 |
| T-133 | Thanh toán kết hợp + một phần (bán nợ): ledger KH +tổng −đã thu; thu nợ sau bằng phiếu thu; thu vượt → OVERPAYMENT | BR-55 | I | test/sales.e2e-spec.ts | ✅ pass 2026-10-24 |
| T-134 | Bán nợ không KH → 400; vượt hạn mức → 409 và rollback tồn; tắt `pos.allowCreditSales` → 409 | BR-55 | I | test/sales.e2e-spec.ts | ✅ pass 2026-10-24 |
| T-135 | Bảng giá, đơn vị quy đổi (hệ số 6), giảm giá dòng/phiếu, thuế gộp, combo bung thành phần (COGS, tồn), combo thiếu tồn → 409 | BR-51, BR-52, BR-53 | I | test/sales.e2e-spec.ts | ✅ pass 2026-10-24 |
| T-136 | Thu ngân: đổi giá → 403, giảm giá OK, bán giá niêm yết OK, giá vốn bị ẩn, không hủy/không xem báo cáo | BR-52, BR-54 | I | test/sales.e2e-spec.ts | ✅ pass 2026-10-24 |
| T-137 | Giữ đơn không trừ tồn; sửa (optimistic lock) rồi hoàn thành; 3 checkout trùng key → 1 hóa đơn | BR-51, BR-29 | I | test/sales.e2e-spec.ts | ✅ pass 2026-10-24 |
| T-138 | **Hai thu ngân bán đơn vị cuối cùng → đúng 1 hóa đơn** | BR-24 | I | test/sales.e2e-spec.ts | ✅ pass 2026-10-24 |
| T-139 | Hủy hóa đơn: hoàn tồn, hủy phiếu thu đi kèm, đảo ledger; phiếu thu dùng chung → PAYMENT_SHARED; đối soát kho + công nợ khớp | BR-57 | I | test/sales.e2e-spec.ts | ✅ pass 2026-10-24 |
| T-140 | Ca bán hàng: mở (một ca/thu ngân), hóa đơn gắn ca, đóng ca tính tiền mặt dự kiến (loại hóa đơn hủy), chênh lệch, `pos.requireOpenShift` | BR-56 | I | test/sales.e2e-spec.ts | ✅ pass 2026-10-24 |
| T-141 | Báo cáo doanh thu/giá vốn/lợi nhuận theo nhân viên, sản phẩm, phương thức; dashboard; giới hạn chi nhánh | BR-54, BR-03 | I | test/sales.e2e-spec.ts | ✅ pass 2026-10-24 |
| T-142 | Cô lập tenant POS; validation (SL 0, phương thức lạ) → 400; hàng ngừng bán → 409; API giá niêm yết | BR-01 | I | test/sales.e2e-spec.ts | ✅ pass 2026-10-24 |
| T-150 | Hủy hóa đơn khi phiếu thu có phần trả trước → PAYMENT_SHARED, không đụng kho/công nợ; hủy phiếu thu tay rồi hủy được | BR-57 | I | test/sales-hardening.e2e-spec.ts | ✅ pass 2026-10-24 |
| T-151 | Stress hủy ↔ thanh toán ↔ bán nợ ↔ phiếu thu cùng KH/hàng (4 vòng) → không có 500; đối soát kho + công nợ khớp (phát hiện deadlock KEY SHARE/FOR UPDATE, đã sửa) | BR-24, BR-48 | I | test/sales-hardening.e2e-spec.ts | ✅ pass 2026-10-24 |
| T-152 | Ca: phiếu thu nợ / phiếu chi ngoài POS gắn ca, tiền mặt dự kiến đúng; đóng ca đồng thời 5 thanh toán → số lưu khớp phiếu thực tế | BR-56 | I | test/sales-hardening.e2e-spec.ts | ✅ pass 2026-10-24 |
| T-153 | Combo có dịch vụ / hàng theo lô → 400 khi tạo; thành phần ngừng kinh doanh → 409 kèm số dòng | BR-53 | I | test/sales-hardening.e2e-spec.ts | ✅ pass 2026-10-24 |
| T-154 | Đơn giữ: `version` khi hoàn thành, thu ngân sửa ghi chú/SL trên đơn có giá quản lý duyệt không bị 403, giảm giá tay → 403, id sai → 400, giá 1e14 → 400, giữ đơn kèm thanh toán → 400, thu ngân không xem ca người khác | BR-58, BR-03 | I | test/sales-hardening.e2e-spec.ts | ✅ pass 2026-10-24 |
| T-155 | Trần giảm giá `pos.maxDiscountPercent` (dòng + hóa đơn); bảng giá cần `invoice.pricebook.select` | BR-58 | I | test/sales-hardening.e2e-spec.ts | ✅ pass 2026-10-24 |
| T-156 | Hủy hóa đơn trùng Idempotency-Key 3 lần → 1 bút toán đảo, không có 500 | BR-29 | I | test/sales-hardening.e2e-spec.ts | ✅ pass 2026-10-24 |
| T-160 | Trả hàng khách lẻ hoàn đủ: nhập lại kho đúng giá vốn lúc bán (dù giá vốn BQ đã đổi), phiếu chi PC, hóa đơn ghi SL/giá trị đã trả; hoàn thiếu → 400 | BR-62..64 | I | test/sales-returns.e2e-spec.ts | ✅ pass 2026-10-24 |
| T-161 | Trả nhiều lần không vượt SL bán; hóa đơn có trả hàng không hủy được; 3 phiếu trả đồng thời → 1 thành công | BR-61 | I | test/sales-returns.e2e-spec.ts | ✅ pass 2026-10-24 |
| T-162 | Không hoàn ngay → ghi có công nợ KH; hàng hỏng không nhập kho, phí trả hàng; hoàn sau bằng phiếu chi; lịch sử KH | BR-63, BR-64 | I | test/sales-returns.e2e-spec.ts | ✅ pass 2026-10-24 |
| T-163 | Giá hoàn mặc định = tiền thực trả/đơn vị (CK dòng + CK hóa đơn, thuế gộp); cao hơn → 400; thu ngân đổi giá → 403, giá vốn bị ẩn | BR-62 | I | test/sales-returns.e2e-spec.ts | ✅ pass 2026-10-24 |
| T-164 | Đổi hàng: hàng mới rẻ hơn → cặp OFFSET + hoàn chênh lệch; đắt hơn → khách trả thêm; thanh toán quá → OVERPAYMENT; OFFSET qua API công khai → 400; đối soát kho + công nợ khớp | BR-65 | I | test/sales-returns.e2e-spec.ts | ✅ pass 2026-10-24 |
| T-165 | Hủy phiếu trả: đảo kho, mở lại SL trả được, hủy phiếu chi; phiếu trả của đổi hàng chỉ hủy sau khi hủy hóa đơn đổi | BR-66 | I | test/sales-returns.e2e-spec.ts | ✅ pass 2026-10-24 |
| T-166 | Phiếu nháp (sửa, phí), hoàn thành trùng Idempotency-Key, phiếu chi gắn ca và tiền mặt ca, hạn trả hàng, cô lập tenant, báo cáo doanh thu ròng | BR-60, BR-29, BR-56 | I | test/sales-returns.e2e-spec.ts | ✅ pass 2026-10-24 |
| T-050 | Công thức avg cost (unit) | BR-31..34 | U | src/modules/inventory/costing.spec.ts | ✅ pass 2026-10-24 |
| T-051 | Định dạng mã chứng từ, reset theo kỳ (unit) | BR-41 | U | src/infra/numbering/numbering.spec.ts | ✅ pass 2026-10-24 |
| T-052 | hasPermission với `*`, wildcard nhóm (unit) | BR-04 | U | src/common/permissions.spec.ts | ✅ pass 2026-10-24 |
| T-060 | UI: login → danh sách hàng → tạo hàng → tạo phiếu nhập → ghi sổ → tồn kho cập nhật | — | E | thủ công (ghi trong progress.md) | ✅ 2026-10-24 |
| T-062 | UI POS: mở ca → quét barcode + tìm hàng → giảm giá dòng/hóa đơn → thanh toán kết hợp (HD000003, PT000005/6) → bán nợ KH tạo nhanh (HD000004) → thu nợ (PT000009) → giữ đơn/mở lại/hoàn thành/hủy (HD000005) → đóng ca chênh lệch −5.000 → báo cáo; thu ngân bị giới hạn đúng | — | E | thủ công (agent, ghi trong progress.md) | ✅ 2026-10-24 |
| T-061 | UI mua hàng: NCC có nợ đầu kỳ → PDN xác nhận → nhập từng phần từ đơn (CK, thuế, chi phí, trả ngay) → thanh toán phần còn lại → trả hàng + hoàn tiền → báo cáo, sổ công nợ; thủ kho bị ẩn công nợ/thanh toán | — | E | thủ công (agent, ghi trong progress.md) | ✅ 2026-10-24 |
| T-167 | Hủy hóa đơn đổi hàng: phiếu chi OFFSET bị hủy theo, khách được ghi có lại phần cấn trừ, phiếu trả còn `dueRefund`; OFFSET không hủy riêng (`PAYMENT_IS_OFFSET`); sau đó hủy phiếu trả phục hồi toàn bộ | BR-65, BR-66 | I | test/sales-returns.e2e-spec.ts | ✅ pass 2026-10-24 |
| T-168 | Đổi hàng khách lẻ: không hoàn / hoàn thiếu → 400, hoàn đúng → 201; hàng mới đắt hơn trả thiếu → 400 (rollback kho); body đổi hàng thiếu `return`/`newInvoice` → 400 không 500; SL 0 → 400; thu ngân không thấy giá vốn ở danh sách | BR-65, BR-62 | I | test/sales-returns.e2e-spec.ts | ✅ pass 2026-10-24 |
| T-169 | Giá hoàn làm tròn xuống (29 000/3 = 9 666,6666) nhưng trả hết đúng 29 000; trả nhiều lần với CK hóa đơn + giá chưa gồm thuế Σ = tổng hóa đơn | BR-62 | I | test/sales-returns.e2e-spec.ts | ✅ pass 2026-10-24 |
| T-170 | Két `QT0001` mặc định; bán tiền mặt vào két, thẻ vào quỹ ngân hàng mặc định; quỹ chi nhánh khác → 400; sổ quỹ có tồn quỹ chạy, tổng hợp theo quỹ | BR-70, BR-71 | I | test/cashbook.e2e-spec.ts | ✅ pass 2026-10-24 |
| T-171 | Chuyển quỹ: 2 phiếu TRANSFER, rút quá → `CASH_INSUFFICIENT`, cùng quỹ → 400, trùng Idempotency-Key trả cùng phiếu, phiếu lẻ không hủy (`PAYMENT_IS_TRANSFER`), hủy phiếu chuyển phục hồi số dư, không tính vào thu/chi | BR-72 | I | test/cashbook.e2e-spec.ts | ✅ pass 2026-10-24 |
| T-172 | Thu/chi khác: cần loại đúng chiều, không đối tác & không loại → 400, số dư két theo phiếu và hủy phiếu; thu ngân thiếu `payment.other`/`cash.view` → 403 | BR-71 | I | test/cashbook.e2e-spec.ts | ✅ pass 2026-10-24 |
| T-173 | Kiểm quỹ ghi chênh lệch; quỹ còn số dư không ngừng được; đổi quỹ mặc định; trùng mã quỹ → 409 | BR-70, BR-73 | I | test/cashbook.e2e-spec.ts | ✅ pass 2026-10-24 |
| T-174 | Cấn trừ KH ↔ NCC: hai ledger giảm, quỹ không đổi, vượt nợ → `OFFSET_EXCEEDS_DEBT`, OFFSET không vào sổ quỹ | BR-74 | I | test/cashbook.e2e-spec.ts | ✅ pass 2026-10-24 |
| T-175 | Đóng ca có bàn giao: chuyển két → ngân hàng trong thao tác đóng ca (mã CQ, `kind=HANDOVER`, gắn ca, hiện trong chi tiết ca), không vượt tiền đếm, thiếu quỹ đích → 400, tiền mặt dự kiến không méo | BR-72 | I | test/cashbook.e2e-spec.ts | ✅ pass 2026-10-24 |
| T-176 | 3 lệnh chuyển quỹ đồng thời từ một két chỉ 1 thành công, không âm quỹ; đối soát công nợ | BR-72 | I | test/cashbook.e2e-spec.ts | ✅ pass 2026-10-24 |
| T-177 | Hủy cấn trừ công nợ theo cặp (phục hồi hai ledger); phiếu không phải cấn trừ → 400; hủy lần 2 → 409 | BR-74 | I | test/cashbook.e2e-spec.ts | ✅ pass 2026-10-24 |
| T-178 | Nhập lại kho lũy kế chính xác: combo thành phần 0,125 trả 0,5 + 0,5 → tồn về đúng; đơn vị ×12 trả 0,333/0,333/0,334 → 12 | BR-63 | I | test/sales-returns.e2e-spec.ts | ✅ pass 2026-10-24 |
| T-179 | `pos.requireOpenShift`: hoàn tiền mặt / đổi hàng không ca → `SHIFT_REQUIRED`, ghi có công nợ vẫn được; có ca → gắn ca, tiền mặt ca trừ tiền hoàn | BR-64 | I | test/sales-returns.e2e-spec.ts | ✅ pass 2026-10-24 |
| T-180 | 3 vòng × (đổi hàng ‖ thu nợ phân bổ ‖ hoàn thành phiếu nháp có hoàn tiền ‖ thu nợ) trên cùng hóa đơn: không 5xx, không `TRANSACTION_CONFLICT` | BR-65 | I | test/sales-returns.e2e-spec.ts | ✅ pass 2026-10-24 |
| T-181 | Chuyển kho: nháp → sửa (version) → xuất (TRANSFER_OUT giá bình quân, `incoming` kho đích, on_hand_total giảm) → nhận đủ (TRANSFER_IN cùng giá vốn); giá vốn không đổi; đã nhận không hủy | BR-80..BR-82 | I | test/transfers-stocktake.e2e-spec.ts | ✅ pass 2026-10-24 |
| T-182 | Nhận thiếu: WRITE_OFF ghi `shortage_value`, RETURN_TO_SOURCE trả về kho nguồn; nhận > gửi → 400; đối soát kho | BR-82 | I | test/transfers-stocktake.e2e-spec.ts | ✅ pass 2026-10-24 |
| T-183 | Hủy phiếu đang chuyển đảo về kho nguồn đúng giá vốn, giải phóng incoming; thiếu tồn → `INSUFFICIENT_STOCK`; dispatch-now trùng Idempotency-Key; 3 lệnh xuất đồng thời chỉ 1 thành công | BR-83 | I | test/transfers-stocktake.e2e-spec.ts | ✅ pass 2026-10-24 |
| T-184 | Liên chi nhánh: thủ kho CN2 không xuất từ CN1 (403), thủ kho CN1 không nhận vào CN2 (403), hộp thư `direction=in`; hàng theo lô phải chọn lô và lô đi theo hàng; tenant khác 404 | BR-80 | I | test/transfers-stocktake.e2e-spec.ts | ✅ pass 2026-10-24 |
| T-185 | Kiểm kho: snapshot theo dòng, nhập đếm nhiều lần, xuất kho trong lúc kiểm → cân bằng theo `đếm − snapshot` (tồn 45 → 43, không phải 48), tổng tăng/giảm & giá trị, không đếm thêm sau khi chốt | BR-84..BR-86 | I | test/transfers-stocktake.e2e-spec.ts | ✅ pass 2026-10-24 |
| T-186 | scope=ALL chụp toàn kho; dòng chưa đếm SKIP/ZERO; làm mới snapshot; hủy phiếu đã cân bằng đảo bút toán; phiếu trống không cân bằng | BR-84, BR-85, BR-87 | I | test/transfers-stocktake.e2e-spec.ts | ✅ pass 2026-10-24 |
| T-187 | 4 người đếm song song trên một phiếu; cân bằng đua với xuất kho cùng mặt hàng: không 5xx, sổ kho khớp số dư | BR-84, BR-86 | I | test/transfers-stocktake.e2e-spec.ts | ✅ pass 2026-10-24 |
| T-188 | Thu ngân 403; vai trò chỉ `transfer.view` thấy phiếu nhưng không thấy giá vốn; không tạo được phiếu | BR-87 | I | test/transfers-stocktake.e2e-spec.ts | ✅ pass 2026-10-24 |
| T-190 | Giảm giá hàng 10 % + mức hóa đơn 5 % tự áp ở preview và checkout; lưu tách `promotionDiscount` dòng/hóa đơn; bỏ một khuyến mãi; tắt khuyến mãi; thống kê & báo cáo; giá hoàn trả hàng theo tiền thực trả | BR-90..BR-92 | I | test/promotions.e2e-spec.ts | ✅ pass 2026-10-24 |
| T-191 | Mua 2 X tặng 1 Y: gợi ý quà, dòng tặng 0 đ vẫn xuất kho & COGS, tặng quá → 400, thiếu promotionId → 400, Y trong giỏ được miễn phí, điều kiện không đạt → 400 | BR-93 | I | test/promotions.e2e-spec.ts | ✅ pass 2026-10-24 |
| T-192 | Voucher: phát hành (mã tự đặt / tự sinh), tra cứu, dưới minTotal không áp, mã sai → 409, 2 thu ngân tranh 1 mã chỉ 1 thành công, hủy hóa đơn trả mã, mã gắn khách, hết hạn, khóa | BR-94, BR-95 | I | test/promotions.e2e-spec.ts | ✅ pass 2026-10-24 |
| T-193 | Giới hạn lượt dưới 4 checkout đồng thời đúng 2; giới hạn mỗi khách; không cộng dồn ưu tiên cao chặn phần còn lại; nhắm chi nhánh + nhóm khách | BR-91, BR-95 | I | test/promotions.e2e-spec.ts | ✅ pass 2026-10-24 |
| T-194 | Tặng hàng theo hóa đơn; đơn giữ lưu khuyến mãi, sửa đơn giữ tính lại (quà không còn điều kiện → 400); không xóa chương trình đã dùng | BR-93, BR-96 | I | test/promotions.e2e-spec.ts | ✅ pass 2026-10-24 |
| T-195 | Thứ trong tuần, khung giờ, khoảng ngày quyết định hiệu lực; ngày/giờ không hợp lệ → 400 | BR-90 | I | test/promotions.e2e-spec.ts | ✅ pass 2026-10-24 |
| T-196 | Bảng giá theo nhóm khách: danh sách áp dụng theo khách, khách sai nhóm → 400, đúng nhóm lấy giá bảng | BR-97 | I | test/promotions.e2e-spec.ts | ✅ pass 2026-10-24 |
| T-197 | Thu ngân xem được, không tạo được khuyến mãi; tenant khác 404 | BR-90 | I | test/promotions.e2e-spec.ts | ✅ pass 2026-10-24 |
| T-198 | `cash.allowNegativeBalance`: mặc định phiếu chi được làm âm quỹ; tắt → `CASH_INSUFFICIENT`, nộp thêm rồi chi tiếp được | BR-70 | I | test/cashbook.e2e-spec.ts | ✅ pass 2026-10-24 |
| T-200 | Đơn đặt hàng: xác nhận giữ tồn (POS không bán được phần giữ), cọc là phiếu thu ghi có khách, cọc quá → OVERPAYMENT, hoàn tất → hóa đơn trả đủ (cọc + phần còn lại), giữ tồn tiêu thụ, đối soát | BR-100..BR-104 | I | test/orders.e2e-spec.ts | ✅ pass 2026-10-24 |
| T-201 | Phiếu tạm không giữ tồn; sửa dòng; xác nhận / hủy xác nhận; 3 đơn đồng thời trên 4 đơn vị chỉ 2 được xác nhận | BR-101 | I | test/orders.e2e-spec.ts | ✅ pass 2026-10-24 |
| T-202 | Hủy đơn: trả tồn; khách lẻ bắt buộc hoàn cọc; khách có hồ sơ giữ cọc làm số dư có (phiếu thu gỡ phân bổ) hoặc hoàn; hủy lần 2 → 409 | BR-105 | I | test/orders.e2e-spec.ts | ✅ pass 2026-10-24 |
| T-203 | Vận đơn tạo cùng đơn (COD = còn thu + phí), theo hóa đơn sau hoàn tất, máy trạng thái + lịch sử, hóa đơn không hủy khi đang giao, giao xong thu hộ → phiếu thu hóa đơn + phí giao hàng thu khác, quỹ tăng đúng | BR-106, BR-107 | I | test/orders.e2e-spec.ts | ✅ pass 2026-10-24 |
| T-204 | Vận đơn theo hóa đơn; chuyển hoàn; đã giao chưa thu → đối soát thu hộ sau; vận đơn hủy không chặn hủy hóa đơn | BR-106..BR-108 | I | test/orders.e2e-spec.ts | ✅ pass 2026-10-24 |
| T-205 | Giá tự nhập / giảm giá trên đơn được giữ nguyên khi thu ngân (không có quyền sửa giá) hoàn tất; combo giữ tồn thành phần | BR-104 | I | test/orders.e2e-spec.ts | ✅ pass 2026-10-24 |
| T-206 | Dòng tặng / rỗng → 400; thủ kho 403; tenant khác 404; lọc đơn chưa thu đủ | BR-100 | I | test/orders.e2e-spec.ts | ✅ pass 2026-10-24 |
| T-210 | NXT: tồn đầu/nhập/xuất/tồn cuối khớp sổ kho (bút toán lùi ngày), tổng, ẩn hàng không biến động, lọc nhóm hàng, thu ngân không thấy giá trị, valuation 403 | BR-110, BR-114 | I | test/reports.e2e-spec.ts | ✅ pass 2026-10-24 |
| T-211 | Hàng tồn lâu: còn tồn & không bán trong N ngày, hàng vừa bán không xuất hiện, số ngày chưa bán | BR-111 | I | test/reports.e2e-spec.ts | ✅ pass 2026-10-24 |
| T-212 | Hàng bán chạy theo doanh thu / SL / lợi nhuận, tăng dần = bán chậm, lọc nhóm | BR-112 | I | test/reports.e2e-spec.ts | ✅ pass 2026-10-24 |
| T-213 | Lãi lỗ: trả hàng, chi phí/thu khác theo loại, phí & chi phí giao hàng → lợi nhuận ròng đúng; thu ngân 403 | BR-113 | I | test/reports.e2e-spec.ts | ✅ pass 2026-10-24 |
| T-214 | Giá trị tồn theo nhóm / kho; xuất Excel 9 loại báo cáo (file xlsx hợp lệ), sổ quỹ thiếu quỹ → 400 | BR-114, BR-115 | I | test/reports.e2e-spec.ts | ✅ pass 2026-10-24 |
| T-220 | Excel hàng hóa KiotViet: nhận diện cột, nhóm hàng 3 cấp, thương hiệu, ảnh URL, dòng đơn vị quy đổi, tồn kho điều chỉnh về đúng số; chạy lại = cập nhật giá/tồn không trùng; job chỉ xác nhận một lần | BR-130..BR-132 | I | test/integrations.e2e-spec.ts | ✅ pass 2026-10-24 |
| T-221 | Excel khách hàng / NCC: nợ đầu kỳ (dương/âm), nhóm, giới tính, ngày sinh không lệch múi giờ, khớp theo SĐT khi không mã, `syncDebt` điều chỉnh công nợ bằng bút toán ADJUSTMENT | BR-131, BR-132 | I | test/integrations.e2e-spec.ts | ✅ pass 2026-10-24 |
| T-222 | Lịch sử hóa đơn: gộp theo mã, dòng khớp mã hàng (không khớp → lỗi dòng), đã hủy giữ nguyên, không đổi tồn/công nợ, chạy lại bỏ qua; đối soát | BR-133 | I | test/integrations.e2e-spec.ts | ✅ pass 2026-10-24 |
| T-223 | KiotViet API (mock server): lưu kết nối mã hóa, Client ID che bớt, sai secret → `KIOTVIET_AUTH_FAILED`, kiểm tra kết nối liệt kê chi nhánh, nhập 4 loại dữ liệu với tồn theo 2 kho, đơn vị quy đổi, công nợ, hóa đơn; xóa kết nối | BR-134 | I | test/integrations.e2e-spec.ts | ✅ pass 2026-10-24 |
| T-224 | Thu ngân 403; thiếu file → 400; file hỏng / không phải xlsx → 400 kèm thông báo rõ; thiếu cột bắt buộc → ánh xạ lại rồi nhập; tenant khác 404 | BR-130 | I | test/integrations.e2e-spec.ts | ✅ pass 2026-10-24 |
| T-225 | Kết nối KiotViet: tạo mới thiếu secret → 400; lưu riêng `branchMap` (kho lạ → 400) giữ nguyên thông tin đăng nhập; đổi riêng retailer giữ client id/secret và ánh xạ | BR-134 | I | test/integrations.e2e-spec.ts | ✅ pass 2026-10-24 |
| T-230 | Tích điểm tắt mặc định; bật → tích theo tiền trả (làm tròn xuống), khách lẻ không tích; hủy hóa đơn đảo điểm | BR-140, BR-142 | I | test/loyalty.e2e-spec.ts | ✅ pass 2026-10-24 |
| T-231 | Tiêu điểm = phiếu thu POINTS (không quỹ, không sổ quỹ, không hủy riêng), trần theo số dư và % hóa đơn, preview trả số điểm tối đa; 2 quầy tiêu cùng điểm chỉ 1 thành công; hủy trả điểm | BR-141, BR-142 | I | test/loyalty.e2e-spec.ts | ✅ pass 2026-10-24 |
| T-232 | Trả hàng thu hồi điểm theo tỷ lệ, hủy phiếu trả hoàn lại; đơn giữ có điểm bị kiểm tra lại khi hoàn thành (`POINTS_INSUFFICIENT`), sửa đơn giữ bỏ điểm; điều chỉnh tay cần `loyalty.manage` | BR-143, BR-144 | I | test/loyalty.e2e-spec.ts | ✅ pass 2026-10-24 |
| T-233 | Danh sách sinh nhật theo tháng/ngày; thiết lập sai → 400; báo cáo giá trị khách hàng | BR-144 | I | test/loyalty.e2e-spec.ts | ✅ pass 2026-10-24 |
| T-240 | Hồ sơ nhân viên; quy tắc hoa hồng (chung 2 % DT, NV+nhóm 5 % LN gộp, hàng 10k/đv): quy tắc cụ thể nhất thắng, ngưỡng doanh thu, trả hàng giảm cơ sở; thu ngân chỉ xem của mình; `/users` trả hồ sơ + lương theo quyền, `hiredAt: null` xóa; danh sách quy tắc kèm tên nhóm/SKU | BR-150, BR-153 | I | test/employees-saas.e2e-spec.ts | ✅ pass 2026-10-24 |
| T-241 | Chấm công vào/ra, không chấm vào hai lần, lịch sử của tôi, quản lý xem tổng giờ, sửa giờ (giờ ra < giờ vào → 400), bổ sung thủ công | BR-151 | I | test/employees-saas.e2e-spec.ts | ✅ pass 2026-10-24 |
| T-242 | Hiệu suất: hóa đơn, trả hàng, DT thuần, số ca, chênh lệch tiền mặt, giờ công, hoa hồng; thu ngân 403 | BR-152 | I | test/employees-saas.e2e-spec.ts | ✅ pass 2026-10-24 |
| T-243 | Gói FREE: người dùng thứ 4 / chi nhánh thứ 2 → `PLAN_LIMIT_REACHED`; `/subscription`; khóa nền tảng sai → 403, nâng lên PRO → tạo được; chưa cấu hình khóa → 403 | BR-160, BR-162 | I | test/employees-saas.e2e-spec.ts | ✅ pass 2026-10-24 |
| T-244 | Hết hạn dùng thử: GET chạy, POST → `TRIAL_EXPIRED`, đăng nhập vẫn được; SUSPENDED chặn mọi thứ | BR-161 | I | test/employees-saas.e2e-spec.ts | ✅ pass 2026-10-24 |
| T-250 | Trang chủ `/dashboard/home`: hôm nay 3 HĐ / 400.000 / LN gộp 160.000, hôm qua 0, chuỗi theo giờ & ngày, top hàng, 8 hoạt động gần nhất (không gồm nháp), chưa thu đủ, đơn giữ, tồn thấp, ca đang mở (2 HĐ, tiền mặt ròng); thu ngân chỉ thấy của mình, không có lợi nhuận; chi nhánh ngoài phạm vi → rỗng | — | I | test/dashboard.e2e-spec.ts | ✅ pass 2026-10-24 |
| T-251 | Hóa đơn nhập từ KiotViet còn "nợ" theo file (500.000, đã trả 100.000) vẫn xem được (còn nợ 400.000) nhưng không vào thẻ "chưa thu đủ" (vẫn 1 HĐ / 60.000) và không vào `/invoices?unpaid=true` (tổng 1, trang 2 rỗng) | BR-178 | I | test/dashboard.e2e-spec.ts | ✅ pass 2026-10-25 |
| T-260 | Cấu hình SePay: bật cần ngân hàng + số TK, ngân hàng ngoài danh sách VietQR → 400, quỹ không phải BANK → 400, thu ngân 403; khóa webhook `sp_…` chỉ trả một lần, GET chỉ còn 4 ký tự cuối | BR-170, BR-171 | I | test/sepay.e2e-spec.ts | ✅ pass 2026-10-25 |
| T-261 | Webhook: thiếu / sai khóa → 401 `success:false`; tiền ra, khác tài khoản → IGNORED; không có mã → UNMATCHED; cùng id gửi lặp → `duplicate`, chỉ một bản ghi | BR-171, BR-173 | I | test/sepay.e2e-spec.ts | ✅ pass 2026-10-25 |
| T-262 | POS: tạo mã BA + 8 số, qrUrl đúng acc/bank/amount/des; thanh toán trước khi có tiền → 409; webhook (nội dung viết thường, có gạch) khớp → PAID; hoàn tất hóa đơn với `bankRequestId` → phiếu BANK_TRANSFER vào quỹ ngân hàng (+200.000), mã dùng hết không dùng lại | BR-172..BR-175 | I | test/sepay.e2e-spec.ts | ✅ pass 2026-10-25 |
| T-263 | POS nhận thiếu → PARTIAL, QR còn lại = phần thiếu; dùng vượt số đã nhận → 409 `BANK_PAYMENT_INSUFFICIENT`; chuyển khoản phần đã nhận + tiền mặt phần còn lại → hoàn tất | BR-175 | I | test/sepay.e2e-spec.ts | ✅ pass 2026-10-25 |
| T-264 | Hóa đơn còn nợ: QR theo số còn nợ, tạo lại dùng lại mã, vượt số nợ → 409, thu ngân 403; tiền về tự lập phiếu thu, hóa đơn đủ, công nợ 0; khách chuyển thừa → hóa đơn đủ, khách dư có −50.000 | BR-172, BR-174 | I | test/sepay.e2e-spec.ts | ✅ pass 2026-10-25 |
| T-265 | Đơn đặt hàng: QR tiền cọc → tiền về cộng tiền cọc; hủy mã chưa có tiền → tiền về sau đó UNMATCHED "đã hủy"; hủy mã đã nhận tiền → 409 | BR-172, BR-174, BR-175 | I | test/sepay.e2e-spec.ts | ✅ pass 2026-10-25 |
| T-266 | Giao dịch chưa khớp: thu ngân không gắn được (403), gắn tay vào hóa đơn → APPLIED + phiếu PT, gắn lần hai → `TRANSACTION_HANDLED`, bỏ qua → IGNORED; gian hàng khác không thấy giao dịch, không đọc được yêu cầu, khóa của gian hàng khác không khớp được mã | BR-173, BR-176 | I | test/sepay.e2e-spec.ts | ✅ pass 2026-10-25 |
| T-267 | Bật SePay ở gian hàng chưa có quỹ ngân hàng → tự tạo quỹ `Vietcombank - 1029384756` (Ngân hàng, mặc định, chủ TK viết hoa), lưu lại không tạo thêm; gian hàng đã có quỹ ngân hàng khác số TK → không tạo quỹ mới | BR-170 | I | test/sepay.e2e-spec.ts | ✅ pass 2026-10-25 |
| T-245 | Báo cáo thuế: đầu ra theo thuế suất 10 %, hoàn trả, thu ngân 403 | BR-155 | I | test/employees-saas.e2e-spec.ts | ✅ pass 2026-10-24 |
| U-09 | Engine khuyến mãi thuần: giảm hàng (%, tiền, giá cố định, SL min/max, trần dòng), mức hóa đơn sau giảm hàng, cộng dồn/không cộng dồn, mua X tặng Y (lặp, dòng tặng, giỏ, tặng quá), tặng theo hóa đơn, voucher (mã, trạng thái, khách, hạn, minTotal, phạm vi), điều kiện ngày/thứ/giờ/chi nhánh/nhóm/lượt | BR-90..BR-95 | U | src/modules/sales/promotion-engine.spec.ts | ✅ pass 2026-10-24 |
| U-10 | `parseDate`: số ngày Excel chỉ có ngày (ngày sinh 36027 → 20/08/1998 12:00) và có giờ (46320.4565 → 25/10/2026 10:57 giờ VN), dd/mm/yyyy / ISO như cũ, giá trị vô lý → null | BR-177 | U | src/modules/integrations/import-parsers.spec.ts | ✅ pass 2026-10-25 |

Các kịch bản của module sau (chuyển kho, kiểm kho, khuyến mãi, …) sẽ được bổ sung khi triển khai các bước 8–14.
