# Tiến độ dự án

> File này là nguồn sự thật để tiếp tục công việc sau khi context bị làm mới. Cập nhật cuối mỗi phiên.

## Phiên 1 — 2026-10-24 — Foundation + Product Master + Inventory Core

### Môi trường đã dựng
* Repo trống → monorepo pnpm: `apps/api` (NestJS 11, Prisma 6.19, PostgreSQL 16, Redis), `apps/web` (React 18, Vite, AntD 5), `packages/shared` (permission catalogue, enums, build CJS).
* Máy dev: PostgreSQL 16 cài qua Homebrew (role `erp`/`erp`, DB `retail_erp` + `retail_erp_test`), Redis có sẵn, **không có Docker** → `docker-compose.yml`, Dockerfile, nginx, backup service, CI workflow đã viết nhưng **chưa chạy thử**.
* Migration đầu tiên: `apps/api/prisma/migrations/20261024042757_init` (33 bảng). Seed: `pnpm --filter @erp/api prisma:seed` → tenant `demo` (admin/thukho/thungan – `Admin@123`), 5 sản phẩm / 7 biến thể, 2 chi nhánh, 2 kho. Sau seed đã tạo thêm qua API thật: phiếu nhập NK000001 (7 dòng, 43.800.000đ) và phiếu xuất hủy XK000001.

### Đã code (backend)
| Khu vực | Nội dung |
|---|---|
| Infra | Prisma tenant-scope extension (`infra/prisma/tenant-extension.ts`), CLS request context, `AuditService`, `NumberingService` (sequence `FOR UPDATE`, reset NEVER/YEARLY/MONTHLY), `IdempotencyInterceptor` (`Idempotency-Key`, replay + header `Idempotent-Replayed`), `OutboxService` (ghi trong transaction, poller `SKIP LOCKED`, backoff, FAILED sau 10 lần), `AccessService` (chi nhánh/kho), Redis client, global exception filter với mã lỗi nghiệp vụ, Swagger `/api/docs` |
| Auth | `register-tenant` (tenant + settings + chi nhánh + kho + 4 role mặc định + owner), `login` (bcrypt, login_history), `refresh` (xoay vòng, phát hiện tái sử dụng → thu hồi cả họ token), `logout`, `me`, `change-password`; guard JWT + guard permission; throttling (tắt khi NODE_ENV=test) |
| Tổ chức | Branches, Warehouses (kho mặc định, chặn ngừng kho còn tồn), Users (role/chi nhánh/kho, khóa, reset mật khẩu, bảo vệ owner/self), Roles (catalogue permission theo nhóm, role hệ thống read-only), Settings (validate theo key) + Sequences, Audit logs + Login history |
| Hàng hóa | Categories (cây, chống vòng), Brands, Units, **Uploads** (`POST /uploads/images` nhiều ảnh, kiểm tra chữ ký tệp, lưu `UPLOAD_DIR/products/<tenant>/`, phục vụ tĩnh `/uploads`, xóa theo tenant), Products (nhiều ảnh có thứ tự, ảnh đầu là đại diện, mã tự động, biến thể từ thuộc tính, đơn vị quy đổi, combo, lô, tồn đầu kỳ → phiếu nhập OPENING, lọc tồn low/out/in/over bằng field reference, tìm nhanh, tra barcode kể cả barcode đơn vị, ẩn giá vốn theo quyền, xóa cứng chỉ khi chưa dùng), Excel export/import/template (exceljs), Price books (CRUD + items) |
| Kho | `StockEngineService.apply()` – nơi duy nhất đổi tồn: khóa variant → khóa/khởi tạo balance → kiểm tra âm kho → cập nhật balance → movement (balance_after) → cost ledger (AVG) → cập nhật `cost_price`/`on_hand_total`; Documents RECEIPT/ISSUE/ADJUSTMENT (nháp → ghi sổ → hủy bằng REVERSAL; optimistic `version`; ADJUSTMENT tính chênh lệch theo tồn tại thời điểm ghi sổ), balances/summary/movements/reservations/reconcile, dashboard overview |

### Đã test (kết quả thực tế)
Lệnh: `pnpm --filter @erp/api test` (2026-10-24, lần cuối sau khi thêm upload ảnh) → **10 suites, 63 tests pass** (13 unit + 50 integration trên PostgreSQL thật, ~12 giây). Typecheck và ESLint API/web: 0 lỗi.
Các kịch bản bắt buộc trong đề bài đã có test pass:
* Hai nhân viên cùng bán sản phẩm cuối cùng → đúng 1 thành công (T-024, thêm 20 request song song / 10 tồn).
* Nhập hàng gửi request trùng → 1 chứng từ, lần 2 replay (T-025); cùng key khác payload → 409 (T-026).
* Phiếu nhập bị hủy → movements đảo, tồn & giá vốn về cũ, không hủy lần 2, chặn khi hàng đã xuất bớt (T-027, T-028).
* Kiểm kho trong khi vẫn bán → điều chỉnh dùng tồn hệ thống tại lúc ghi sổ (T-031).
* Giới hạn quyền chi nhánh → 403 `BRANCH_ACCESS_DENIED`, danh sách lọc theo chi nhánh (T-006).
* Phục hồi sau transaction thất bại → dòng lỗi làm rollback toàn phiếu, không có balance/movement lẻ (T-022, T-030).
* Cô lập tenant (T-004), RBAC (T-005), refresh token (T-002), đối soát ledger (T-033), giữ tồn (T-034), audit + outbox (T-040/041).
Chưa có test: trả hàng nhiều lần, thanh toán nhiều lần, công nợ, đổi bảng giá sau khi bán (các module chưa triển khai).


### Review độc lập & các lỗi đã vá trong phiên (test hồi quy T-070..T-078)
Một agent review đọc toàn bộ `apps/api` sau khi test xanh và tìm ra các lỗi mà bộ test ban đầu chưa phủ; tất cả đã được sửa và có test:
| Mức | Lỗi | Sửa |
|---|---|---|
| HIGH | Tham số `warehouseId`/`branchId` của người dùng ghi đè điều kiện phạm vi (spread cùng key) → user bị giới hạn chi nhánh xem được tồn/phiếu của chi nhánh khác | Ghép phạm vi bằng `AND` ở mọi API danh sách/tổng hợp; `products?warehouseId` và dashboard cũng kiểm tra quyền |
| HIGH | Phiếu điều chỉnh đọc "tồn hệ thống" trước khi khóa hàng → bán chen ngang làm tồn cuối ≠ số đếm | `lockedOnHand()` đọc sau khi giữ khóa variant → balance, cùng thứ tự với `apply()` |
| MED | Giữ tồn nhận `batchId` bất kỳ (kể cả tenant khác), tạo dòng balance "ma"; giải phóng không kiểm tra quyền kho | Dùng chung `lockAndValidateVariant()` với engine; `release` gọi `assertWarehouse` |
| MED | Ghi sổ/hủy/xóa phiếu chỉ kiểm tra chi nhánh, bỏ qua giới hạn kho của người dùng | `lockDoc` kiểm tra cả kho (trong transaction) |
| MED | Idempotency: lỗi lưu phản hồi sau khi handler đã commit làm xóa khóa → retry ghi sổ 2 lần; khóa không hết hạn; khóa dùng chung giữa người dùng | Chỉ xóa khóa khi handler lỗi; khóa theo (tenant, user, route); dọn khóa hết hạn trước khi chèn |
| MED | Xuất kho/đảo phiếu không xét `reserved` → giữ tồn vô nghĩa | Kiểm tra `on_hand − reserved` (BR-25 cập nhật) |
| MED | Refresh token xoay vòng không nguyên tử (2 request đồng thời đều thành công); tenant bị tạm ngưng vẫn refresh được; chấp nhận token qua query string | `updateMany … WHERE revoked_at IS NULL` phải trả 1 dòng, nếu không thu hồi cả họ; kiểm tra trạng thái tenant; bỏ token qua query |
| MED | Bảng giá nhận `branchIds` của tenant khác (nested create không qua extension) | Đếm chi nhánh trong tenant trước khi ghi |
| LOW | Nhiều trường ngày/enum/số không validate → 500; số âm, `1e5`, thuế 999, combo SL 0, padding 99; Excel import bỏ qua validator; barcode không trim; `localeCompare` khi sắp thứ tự khóa | Decorator `IsDecimalStr` (min/max/positive), `IsISO8601`, `IsIn(MOVEMENT_TYPES)`, trim, validate DTO khi import, so sánh chuỗi thuần |
Chưa sửa (ghi nhận): `apply()` vẫn cho nhập/xuất hàng đã ngừng kinh doanh (chủ ý: để xả tồn); SKU phân biệt hoa/thường; chưa có job dọn `idempotency_keys` hết hạn (hiện dọn theo key khi dùng lại).

### Frontend (`apps/web`, 32 file, ~2.200 dòng) — typecheck ✅ · lint ✅ · build ✅ (antd chunk 1,3 MB / 414 kB gzip)
Giao diện theo bố cục KiotViet: header xanh với menu ngang (Tổng quan · Hàng hóa · Giao dịch · Đối tác · Nhân viên · Sổ quỹ · Báo cáo; mục chưa có hiển thị "Sắp ra mắt"), chọn chi nhánh, nút "Bán hàng" (chờ POS), menu người dùng; trang danh sách có panel lọc bên trái, bảng có checkbox, phân trang, dòng mở rộng với tab chi tiết.
| Màn hình | Route | Đã kiểm tra trên trình duyệt (2026-10-24) |
|---|---|---|
| Đăng nhập + đăng ký gian hàng, đổi mật khẩu | `/login` | ✅ login demo/admin, thungan; refresh token tự động khi 401 |
| Tổng quan | `/` | ✅ số liệu thật từ `/dashboard/overview` (5 hàng, 7/7 SKU, 208 đơn vị, 42,6 triệu), biểu đồ phiếu 7 ngày, phiếu & biến động gần đây |
| Hàng hóa (lọc nhóm/thương hiệu/loại/trạng thái/tồn, tab Thông tin / Thẻ kho / Tồn kho, Cập nhật / Ngừng KD / Xóa, Import/Export Excel) | `/products` | ✅ tạo SP000006 qua modal (barcode, tồn min, tồn đầu kỳ → NK000002), sửa qua PATCH |
| Phiếu kho: danh sách + chi tiết (Ghi sổ / Hủy / Sửa / Xóa / In) | `/inventory/documents` | ✅ NK000003 ghi sổ từ editor, chi tiết hiện dòng + bút toán |
| Editor phiếu nhập/xuất/điều chỉnh (tìm hàng, quét barcode Enter, lô, F3/F9/F10, highlight dòng thiếu tồn) | `/inventory/documents/new` | ✅ luồng RECEIPT end-to-end; ISSUE/ADJUSTMENT và sửa nháp đã code nhưng **chưa bấm thử trên UI** |
| Báo cáo tồn kho (summary + bảng theo kho/lô) | `/inventory/balances` | ✅ SP000006 = 20, giá trị 1,6 triệu |
| Thẻ kho / lịch sử biến động | `/inventory/movements` | ✅ NK000003/NK000002/XK000001/NK000001 với tồn sau GD |
| Thiết lập: chi nhánh, kho, người dùng, vai trò (nhóm quyền), cấu hình + mã chứng từ, nhật ký, lịch sử đăng nhập | `/settings` | ✅ hiển thị dữ liệu thật; chưa thử tạo người dùng mới từ UI |
| Bảng giá | `/price-books` | ✅ trang hiển thị (trạng thái trống) |
| Phân quyền hiển thị | — | ✅ đăng nhập `thungan`: ẩn Thêm mới/Import/Xuất, ẩn cột giá vốn, ẩn tab Thẻ kho, `/settings` báo "Không có quyền" |
Chưa có: unit/E2E test tự động cho FE (Playwright), cảnh báo deprecation của AntD trong console. Upload nhiều ảnh đã có trong modal hàng hóa (component `ImageUploader`: thêm/xóa/xem/đặt ảnh đại diện) và gallery trong tab Thông tin; đã kiểm tra trên trình duyệt: SP000001 gắn 3 ảnh qua API, thumbnail cột đầu bảng + gallery (ảnh đại diện 120px, ảnh phụ 56px) hiển thị đúng; khu vực "Hình ảnh" xuất hiện đầu form Thêm hàng hóa. Việc chọn tệp từ hộp thoại hệ thống chưa tự động hóa được nên đường upload từ UI được xác minh qua integration test của endpoint.


### Rà soát toàn bộ thao tác UI (sau phản hồi "nhiều tính năng chưa sử dụng được")
Một agent đã bấm thử **mọi** màn hình/thao tác trên trình duyệt với API thật (admin, thukho, thungan, tenant mới), đối chiếu phản hồi mạng. Kết quả: tất cả thao tác hoạt động sau khi sửa 6 lỗi giao diện sau (không có lỗi backend):
| # | Lỗi | Sửa |
|---|---|---|
| 1 | Form hàng hóa: thêm một thuộc tính có tên nhưng chưa nhập giá trị → API từ chối mọi biến thể ("thiếu thuộc tính") | `attributeNames` chỉ lấy thuộc tính có giá trị; thêm gợi ý nhập |
| 2 | Tìm hàng trong phiếu kho: sau khi quét mã vạch Enter, dropdown tìm kiếm cũ vẫn bật lại; mã vạch không tồn tại thì im lặng | Hủy debounce khi đã chọn; báo "Không tìm thấy hàng hóa có mã vạch…" |
| 3 | Thêm nhanh thương hiệu: nút OK chiếm focus, gửi tên rỗng → 400 tiếng Anh | Focus vào ô nhập, kiểm tra rỗng, thông báo tiếng Việt |
| 4 | Nút "In" phiếu dùng `window.open` → không làm gì khi trình duyệt chặn pop-up | In qua iframe ẩn |
| 5 | Xóa phiếu nháp xong vẫn gọi lại chi tiết → 404 trong console | Gỡ query thay vì refetch |
| 6 | Modal "Thêm lô mới" không nhận focus (gõ vào ô tìm hàng) | Focus bằng ref sau khi mở |
Các mục menu đang **tắt có chủ đích** ("Sắp ra mắt") vì thuộc module chưa triển khai theo thứ tự phụ thuộc: Giao dịch (Hóa đơn, Đặt hàng, Trả hàng, Nhập hàng, Chuyển hàng), Đối tác (Khách hàng, Nhà cung cấp), Sổ quỹ (Phiếu thu, Phiếu chi), Báo cáo (Doanh thu, Lợi nhuận), Hàng hóa → Kiểm kho, nút "Bán hàng" (POS).
Dữ liệu thử nghiệm agent để lại trong tenant demo: hàng SP000007–SP000012, chi nhánh CN03, kho KHO-AUD, người dùng `audituser` (đã khóa), bảng giá BG-AUDIT; tenant thử `audit-7k2q`.

### Chưa hoàn thành / hạn chế đã biết
* Chuyển kho, kiểm kho (snapshot/duyệt), serial, webhook/API key, job đối soát định kỳ, thông báo tồn thấp, SSE realtime, resize/thumbnail ảnh và lưu trữ S3.
* Docker Compose / CI chưa được chạy thực tế trên máy này (không có Docker). Cần chạy `docker compose up --build` trên máy có Docker và sửa nếu lỗi.
* Bảng giá mới ở mức CRUD; chưa áp dụng khi bán (chưa có bán hàng).
* `OutboxService` phát sự kiện nội bộ; chưa có consumer ngoài (webhook).
* Giả định nghiệp vụ cần xác nhận: xem `business-rules.md` mục G (giá vốn bình quân toàn tenant, mặc định không cho âm kho, hủy = ghi đảo).

### Lỗi chưa xử lý
* Không có lỗi test nào đang mở. Cảnh báo ts-jest `isolatedModules` deprecated và cảnh báo deprecation AntD trong console (vô hại).
* Panel lọc bên trái của trang Hàng hóa thu thành nút "Bộ lọc" khi viewport ≤ 1024px (đúng thiết kế responsive; trên màn hình desktop rộng hơn thì hiển thị cố định).

### Bước tiếp theo (phiên 2)
1. Chạy Docker Compose + CI trên môi trường có Docker; sửa Dockerfile nếu cần.
2. Module 04 Mua hàng: suppliers, PO, phiếu nhập (nhập từng phần, chiết khấu, thuế, chi phí phân bổ → engine `type: PURCHASE` cập nhật `last_purchase_price`), trả hàng nhập, công nợ NCC (ledger + allocations).
3. Module 05 POS: hóa đơn, giữ đơn, thanh toán nhiều phương thức, ca bán hàng, in hóa đơn; dùng `ReservationsService` cho đơn đặt.
4. Bước 8: chuyển kho (in-transit) và kiểm kho (snapshot + duyệt) trên nền `StockEngineService`.
5. Bổ sung test: trả hàng nhiều lần, thanh toán một phần, đổi bảng giá sau khi bán.

## Phiên 2 — 2026-10-24 — Hình ảnh sản phẩm, rà soát UI, Module 04 Mua hàng

### Đã code
| Khu vực | Nội dung |
|---|---|
| Ảnh sản phẩm | `POST /uploads/images` (nhiều ảnh, kiểm tra chữ ký tệp, thư mục theo tenant, phục vụ tĩnh `/uploads`), `images[]` trên hàng hóa, `ImageUploader` + gallery trên UI |
| Rà soát UI | 6 lỗi giao diện được sửa (xem phiên 1, mục rà soát) |
| Finance core (dùng chung cho Module 08) | `LedgerService` (party_ledger_entries + party_balances khóa dòng, reverseDocument, reconcile), `PaymentsService` (phiếu thu PT / phiếu chi PC, allocations, trả trước, hủy), API `/payments` |
| Mua hàng | Suppliers (mã NCC, nhóm, công nợ đầu kỳ, lịch sử, sổ công nợ), Purchase orders (PDN: nháp/xác nhận/nhập một phần/đủ/hủy, `applyReceived` dưới khóa), Purchase receipts (PN: chiết khấu dòng + phiếu, thuế, chi phí nhập phân bổ BY_VALUE/BY_QUANTITY, `payToSupplier`, thuế vào giá vốn theo cấu hình `purchasing.includeTaxInCost`, ghi kho `PURCHASE` theo giá vốn phân bổ, `last_purchase_price`, bút toán công nợ, thanh toán ngay, hủy bằng đảo kho + đảo ledger), Purchase returns (THN: nhiều lần, kiểm tra dưới khóa phiếu nhập, xuất `PURCHASE_RETURN` theo giá vốn BQ, hoàn tiền ngay), báo cáo mua hàng theo kỳ/NCC/top hàng, báo cáo công nợ NCC; script `prisma:sync-roles` đồng bộ quyền mới cho vai trò mặc định của tenant cũ |
| Schema | +12 bảng: suppliers, party_balances, party_ledger_entries, payments, payment_allocations, purchase_orders(+lines), purchase_receipts(+lines, +costs), purchase_returns(+lines); migrations `purchasing`, `purchasing_relations` |
| Permissions | 20 mã quyền mới (nhóm Nhà cung cấp, Mua hàng, Sổ quỹ); vai trò WAREHOUSE được nhập/trả hàng, MANAGER đủ quyền |

### Đã test (kết quả thực tế)
`pnpm --filter @erp/api test` → **13 suites, 86 tests pass** (17 unit + 69 integration, ~18 giây). Mới: T-090 (công thức phiếu nhập), T-100..T-112 (mua hàng, xem `test-matrix.md`), T-080..T-082 (ảnh).
Kịch bản bắt buộc của đề bài đã phủ thêm: nhập hàng request trùng (T-105), phiếu nhập bị hủy (T-106), trả hàng nhiều lần (T-107, T-108 đồng thời), thanh toán nhiều lần / một phần (T-103), công nợ ledger khớp số dư (T-112).


### Review độc lập Module 04 & các lỗi đã vá (test T-120..T-125)
| Mức | Lỗi | Sửa |
|---|---|---|
| HIGH | "Thanh toán ngay"/"hoàn tiền ngay" kèm phiếu nhập/trả tạo phiếu thu/chi mà không cần `payment.create` (thủ kho lập được PT/PC) | Kiểm tra quyền trong `PaymentsService.createInTx`; thiếu quyền → 403 và rollback cả phiếu |
| HIGH | Đơn giá trả hàng không bị chặn trần → có thể tạo công nợ/hoàn tiền tùy ý; giá mặc định chưa trừ CK phiếu và thuế | Giá trả ≤ tiền thực trả/đơn vị (CK phiếu phân bổ + thuế), Σ phiếu trả ≤ tổng phiếu nhập (`RETURN_AMOUNT_EXCEEDED`) |
| MED | Deadlock tiềm ẩn: hủy phiếu nhập khóa kho trước đơn đặt hàng (ngược với ghi sổ); thanh toán ngay lấy mã PC sau khi khóa party_balance (ngược với phiếu chi độc lập); phân bổ khóa theo thứ tự client gửi | Thứ tự khóa thống nhất (chứng từ → đơn → sequence → kho → party_balance); mã PT/PC lấy ngay sau khi khóa chứng từ; phân bổ sắp theo id và gộp trùng |
| MED | Phiếu chi phân bổ được vào chứng từ chi nhánh khác; `branchId` phiếu chi không kiểm tra tồn tại (UUID lạ → 500, chi nhánh tenant khác được lưu) | `assertBranch` cho từng chứng từ phân bổ (tạo và hủy); kiểm tra chi nhánh trong tenant → 404 |
| MED | `orderLineId` nhận mà không có `orderId` → FK 500 / dữ liệu rác | Từ chối 400 ở tạo và sửa |
| LOW | Chi phí nhập mất khỏi giá vốn khi mọi dòng giá 0; raw SQL thiếu `tenant_id`; không khôi phục giá nhập gần nhất khi hủy; mã NCC tự sinh trùng mã nhập tay → 500; lý do hủy rỗng; dòng trùng `orderLineId`; sổ công nợ không lọc chi nhánh; chưa có endpoint đối soát công nợ | Phân bổ theo SL khi tổng giá trị = 0; thêm `tenant_id`; khôi phục từ phiếu nhập gần nhất còn lại; tăng sequence khi trùng + bắt P2002; `MinLength(1)`; cộng dồn; lọc `branchId` cho user giới hạn chi nhánh; `POST /payments/reconcile`; thêm CHECK constraints DB (migration `purchasing_checks`) |
Chưa sửa (ghi nhận): `openingBalance` chỉ cần `supplier.manage`; danh sách `unpaid=true` lọc trong bộ nhớ; thanh toán cho NCC ngừng giao dịch vẫn cho phép (để tất toán nợ).

### Frontend mua hàng (`apps/web`, +13 route) — typecheck ✅ · lint ✅ · build ✅
Màn hình: Nhà cung cấp (lọc, tab Thông tin / Lịch sử mua hàng / Công nợ, thêm/sửa, thanh toán), Đặt hàng nhập (danh sách + editor, xác nhận, "Nhập hàng từ đơn"), Nhập hàng (danh sách + editor kiểu KiotViet với chiết khấu dòng/phiếu, thuế, chi phí nhập, lô, thanh toán ngay; chi tiết với tab Thanh toán / Bút toán kho / Trả hàng), Trả hàng nhập (editor từ phiếu nhập, hoàn tiền ngay), Phiếu thu / Phiếu chi (danh sách, lập phiếu với tự phân bổ vào phiếu nợ cũ nhất), Báo cáo mua hàng, Công nợ NCC, chỉ số "Mua hàng 30 ngày" trên Tổng quan. Menu đã mở: Giao dịch → Nhập hàng / Đặt hàng nhập / Trả hàng nhập; Đối tác → Nhà cung cấp; Sổ quỹ → Phiếu thu / Phiếu chi; Báo cáo → Mua hàng / Công nợ NCC.
Đã kiểm tra trên trình duyệt (admin, 2026-10-24): NCC000001 (nợ đầu kỳ 2.000.000) → PO000001 xác nhận → nhập 6/10 + 4/4 từ đơn với CK dòng 50.000, thuế 10%, chi phí 100.000, trả ngay 1.000.000 → PN000001 (cần trả 1.870.000, còn nợ 870.000; đơn "Nhập một phần") → thanh toán 870.000 từ trang NCC (PC000002) → trả 2 đơn vị kèm hoàn 200.000 (THN000001, PT000001) → báo cáo mua hàng/công nợ, sổ công nợ 6 bút toán, thẻ kho có PURCHASE/PURCHASE_RETURN; nháp PN000002 lưu rồi xóa; `thukho` không thấy công nợ/thanh toán.
Sau review backend, giao diện trả hàng được đồng bộ: đơn giá trả mặc định và mức tối đa lấy từ API (`returnUnitPrice` = số tiền thực trả NCC mỗi đơn vị). Ghi chú: tenant demo đang in mã `PO…` thay vì `PDN…` vì một lần kiểm thử trước đã lưu tiền tố PO trong cấu hình mã chứng từ (tenant mới dùng `PDN`); dev server web đang chạy ở cổng 5174 vì 5173 được dùng cho chương trình khác.


### Giả định mới cần xác nhận
A6 thuế mua hàng tính vào giá vốn (mặc định bật), A7 chi phí nhập mặc định trả cho NCC, A8 trả hàng xuất kho theo giá vốn bình quân — xem `business-rules.md` mục H.

### Bước tiếp theo (sau phiên 3)
1. Module 08 Thanh toán & công nợ: sổ quỹ (thu/chi tổng hợp theo quỹ tiền mặt/ngân hàng), bàn giao ca, cấn trừ công nợ, hoàn tiền khách, nhật ký thanh toán — trên nền `payments` + `party_ledger_entries` đã có.
2. Module 07 Trả hàng / đổi hàng bán (tham chiếu hóa đơn, nhiều lần, hàng hỏng vs nhập lại kho) và điểm tích lũy.
3. Bước 8 Chuyển kho & kiểm kho; Module 06 Đặt hàng & giao hàng (dùng `ReservationsService`).

## Phiên 3 — 2026-10-24 — Module 05 Bán hàng POS (backend)

### Đã code
| Khu vực | Nội dung |
|---|---|
| Schema | +4 bảng: customers, shifts, invoices, invoice_lines; `payments.shift_id`; migration `sales_pos` |
| Khách hàng (nền Module 07) | CRUD, mã KH tự sinh, nhóm, hạn mức nợ, công nợ đầu kỳ qua ledger, tìm nhanh cho POS, lịch sử mua, sổ công nợ, báo cáo công nợ KH |
| Hóa đơn | Giữ đơn (DRAFT, không giữ tồn), sửa có optimistic lock, `checkout` (tạo + hoàn thành) và `complete`; giải giá niêm yết: bảng giá → đơn vị quy đổi → giá hàng; đổi giá / giảm giá / đổi NV bán cần quyền riêng; thuế gộp trong giá hoặc cộng thêm; xuất kho `SALE` theo giá vốn bình quân, bung combo thành thành phần, dịch vụ không xuất kho; COGS theo dòng và hóa đơn; bán nợ với hạn mức; nhiều phương thức thanh toán → mỗi phương thức một phiếu thu `PT` phân bổ vào hóa đơn, gắn ca; hủy hóa đơn hủy luôn phiếu thu riêng, đảo kho và ledger |
| Ca bán hàng | Mở/đóng ca, một ca mở mỗi thu ngân/chi nhánh, tiền mặt dự kiến từ phiếu thu/chi trong ca, chênh lệch, `pos.requireOpenShift` |
| Thanh toán | `PaymentsService` hỗ trợ khách hàng, khách lẻ (không đối tác), phân bổ `INVOICE`, `shiftId`, `cancelInTx` dùng chung cho hủy hóa đơn |
| Báo cáo | `GET /sales/reports/summary`: doanh thu, giá vốn, lợi nhuận gộp, theo kỳ / NV / chi nhánh / sản phẩm / phương thức; dashboard có "doanh thu hôm nay" |
| Quyền | 15 mã mới (Khách hàng, Bán hàng); vai trò CASHIER được bán, giữ đơn, giảm giá, mở/đóng ca; `prisma:sync-roles` đã chạy cho tenant demo |

### Đã test
`pnpm --filter @erp/api test` → **16 suites, 108 tests pass** (20 unit + 88 integration, ~26 giây; một lần chạy bị treo 15 phút do máy tạm dừng, chạy lại xanh). Mới: T-130..T-142 (xem `test-matrix.md`), gồm kịch bản bắt buộc "hai nhân viên cùng bán sản phẩm cuối cùng" (T-138), thanh toán nhiều lần/một phần (T-133), hủy giao dịch (T-139), ca & đối soát (T-140).

### Frontend POS (`apps/web`) — typecheck ✅ · lint ✅ · build ✅
Màn hình: `/pos` toàn màn hình kiểu KiotViet (thanh tìm hàng + quét barcode, nhiều tab hóa đơn lưu cục bộ, chỉ báo ca và mở ca, giỏ hàng với ĐVT/SL/đơn giá/giảm giá, panel phải: NV bán, khách hàng tìm nhanh + tạo nhanh, bảng giá, giảm giá hóa đơn, thuế, thanh toán tiền mặt/chuyển khoản/thẻ/ví/kết hợp với tiền khách đưa và tiền thừa, bán nợ, F2/F3/F4/F6/F7/F9), xem trước và in hóa đơn 80mm, ngăn "Đơn đang giữ"; `/invoices` (lọc, chi tiết, thanh toán, thu nợ, bút toán kho, hủy, in); `/customers` (hồ sơ, lịch sử, công nợ, thu nợ) và `/reports/customer-debt`; `/shifts` (mở/đóng ca, đối soát theo phương thức); `/reports/sales`; dashboard "Doanh thu hôm nay"; Cấu hình có công tắc POS và trần giảm giá.
Đã kiểm tra trên trình duyệt (2026-10-24, tenant demo): HD000003 thanh toán kết hợp 500.000 tiền mặt + 213.000 chuyển khoản (PT000005, PT000006); KH000002 tạo nhanh từ POS, bán nợ HD000004 còn 89.000 rồi thu nợ PT000009; giữ đơn HD000005 → mở lại → hoàn thành → hủy; đóng ca CA000001 chênh lệch −5.000; báo cáo doanh thu 4 hóa đơn; thu ngân `thungan` bán HD000006 ở giá niêm yết, không sửa được giá, không có Hủy/giá vốn/báo cáo. Lỗi giao diện đã sửa trong lúc kiểm tra: gửi `version` khi hoàn thành đơn giữ; thông báo tiếng Việt cho các mã lỗi mới; tab đơn giữ không đóng sau khi hoàn thành; tên khách không điền sẵn khi tạo nhanh; thiếu ô trần giảm giá trong Cấu hình.
Chưa có: test tự động cho FE; `/settings` mặc định mở tab Chi nhánh.


### Review độc lập Module 05 & các lỗi đã vá (test T-150..T-156)
| Mức | Lỗi | Sửa |
|---|---|---|
| HIGH | Hủy hóa đơn hủy luôn phiếu thu có phần trả trước → mất tiền trả trước của khách | Chỉ hủy theo phiếu thu phân bổ trọn vẹn; ngược lại `PAYMENT_SHARED` (kiểm tra trước khi đụng kho) |
| HIGH | Thứ tự khóa hủy hóa đơn (party_balance trước kho) ngược với thanh toán → deadlock 500 | Hủy: kho → phiếu thu → ledger; `P2034` → 409 `TRANSACTION_CONFLICT` |
| HIGH | Đối soát ca: phiếu thu/chi lập ngoài POS không gắn ca; đóng ca có race với thanh toán đang chạy | `POST /payments` gắn ca đang mở; `openShiftId` khóa `FOR SHARE` → đóng ca chờ thanh toán xong |
| HIGH (phát hiện khi test) | Deadlock giữa tạo dòng chứng từ (KEY SHARE khóa ngoại tới hàng hóa) và `FOR UPDATE` của engine kho khi hai giao dịch chen nhau | `lockVariant` dùng `FOR NO KEY UPDATE` (vẫn tuần tự hóa, không xung đột KEY SHARE); stress T-151 xanh |
| MED | `complete` không kiểm tra phiên bản; sửa đơn giữ bắt thu ngân chịu 403 vì giá do quản lý đặt; combo chứa dịch vụ/hàng theo lô; bảng giá & giảm giá không có trần; DTO `customerId`/`priceBookId` null không validate → 500; số quá lớn → 500; thu ngân xem được ca người khác qua `?userId=`; giữ đơn nhận `payments` rồi bỏ qua | `version` tùy chọn khi hoàn thành; giữ nguyên dòng không gửi lại & giá cũ không tính là đổi giá; cấm thành phần không phải GOODS/hàng lô khi tạo combo và khi bán; `pos.maxDiscountPercent` + quyền `invoice.pricebook.select`; `@IsUUID` có điều kiện; giới hạn 13 chữ số nguyên + map `P2020/P2023` → 400; lọc `userId` chỉ cho `shift.manage`; từ chối `payments` khi giữ đơn |
| LOW | `price()` không kiểm tra bảng giá/hàng ngừng bán; báo cáo theo sản phẩm chưa trừ CK hóa đơn; đơn vị `isDirectSale=false` vẫn bán được | Đã sửa cả ba |
Chưa sửa (ghi nhận, quyết định thiết kế): `hasDebt`/`creditLimit` lộ với `customer.view`; `invoiceDate` tự do; quản lý hoàn thành đơn giữ của thu ngân thì hóa đơn gắn ca của quản lý.


### Giả định mới cần xác nhận
A9 giữ đơn không giữ tồn; A10 tiền thừa không ghi nhận; A11 COGS bình quân tại lúc bán — xem `business-rules.md` mục I.

## Phiên 4 — 2026-10-24 — Module 07 Trả hàng / đổi hàng bán (backend) + yêu cầu mới

### Yêu cầu mới của người dùng (đã ghi nhận)
1. **Giao diện mobile là giao diện chính** → một agent đang làm đợt responsive toàn bộ màn hình hiện có (POS, shell, danh sách, editor); mọi màn hình mới phải mobile-first.
2. **Mục "Hướng dẫn sử dụng" trong ứng dụng** theo từng chức năng, có ảnh chụp thật và các bước → sẽ làm ngay sau đợt responsive (route `/help`, ảnh trong `apps/web/public/guide/`, script chụp ảnh lặp lại được).
3. **Di chuyển dữ liệu từ KiotViet** khi hệ thống hoàn thiện → lên kế hoạch ở Module 13: bộ nhập Excel xuất từ KiotViet + client KiotViet Public API (người dùng tự nhập thông tin kết nối trong Thiết lập), báo cáo đối soát sau nhập.
4. Sau Module 07, **tự đi tiếp các module còn lại** không cần hỏi.

### Đã code
| Khu vực | Nội dung |
|---|---|
| Schema | `sales_returns`, `sales_return_lines` (tình trạng RESTOCK/DAMAGED, giá vốn gốc), phương thức thanh toán `OFFSET`, CHECK constraints; migrations `sales_returns`, `sales_returns_checks` |
| Trả hàng | Nháp → hoàn thành → hủy; dòng còn trả được + giá hoàn mặc định (`GET /sales-returns/returnable/:invoiceId`); kiểm tra SL dưới khóa hóa đơn; nhập lại kho theo đúng bút toán bán gốc (combo → thành phần) với giá vốn lúc bán; hàng hỏng ghi `damaged_value`; phí trả hàng; bút toán `SALE_RETURN` ghi có KH; hoàn tiền phiếu chi gắn ca hoặc để lại công nợ; khách lẻ phải hoàn đủ; hạn trả hàng `sales.returnMaxDays` |
| Đổi hàng | `POST /sales-returns/exchange`: trả + hóa đơn mới trong một transaction, cấn trừ bằng cặp phiếu `OFFSET`, khách trả thêm hoặc được hoàn chênh lệch; mọi mã chứng từ lấy trước khi khóa kho |
| Thanh toán | Phân bổ `SALES_RETURN` (phiếu chi), `OFFSET` chỉ hệ thống tạo, hủy phiếu hoàn lại `refunded_amount` |
| Báo cáo | Doanh thu ròng = doanh thu − tiền hoàn; giá trị hàng hỏng; lịch sử KH có phiếu trả; chi tiết hóa đơn liệt kê phiếu trả |

### Đã test
`pnpm --filter @erp/api test` → **17 suites, 115 tests pass** (T-160..T-166 mới). Kịch bản bắt buộc "trả hàng nhiều lần" (T-161), "phục hồi sau transaction thất bại" (đổi hàng lỗi → rollback cả phiếu trả, T-164).

### Frontend trả hàng / đổi hàng
Đang xây ở Phiên 5 (xem bên dưới).

### Review độc lập (đã vá ở Phiên 5)
| Mức | Phát hiện | Cách vá | Test |
|---|---|---|---|
| H1 | Hủy hóa đơn đổi hàng để lại phiếu chi OFFSET → khách mất phần tín dụng đã cấn | `InvoicesService.cancel` hủy luôn OFFSET OUT của các phiếu trả gắn `exchangeInvoiceId` | T-167 |
| H2 | `exchange` lấy sequence trước khi khóa hóa đơn gốc → có thể deadlock với phiếu thu phân bổ | khóa hóa đơn gốc ngay sau khi tạo phiếu trả, trước mọi sequence | T-180 |
| M1 | Khách lẻ đổi hàng có thể hoàn thiếu phần chênh lệch | bắt buộc `refund.amount == refundDue` với khách lẻ | T-168 |
| M2 | Làm tròn nửa lên giá hoàn/đơn vị → trả hết bị `RETURN_AMOUNT_EXCEEDED` | làm tròn xuống + bù tròn dòng trả hết | T-169 |
| M3 | Body đổi hàng thiếu `return`/`newInvoice` → 500 | `@IsDefined @IsNotEmptyObject` | T-168 |
| M4 | Hủy riêng lẻ phiếu OFFSET qua API công khai phá cặp | `PAYMENT_IS_OFFSET` ở đường công khai | T-167 |
| M5 | Hoàn tiền mặt không cần ca dù `pos.requireOpenShift` | kiểm tra `SHIFT_REQUIRED` khi hoàn tiền / đổi hàng | T-179 |
| L1 | Nhập lại kho pro-rata lệch ±0,001 mỗi lần trả | làm tròn lũy kế (telescoping) | T-178 |
| L2 | Danh sách phiếu trả lộ giá vốn cho thu ngân | ẩn `restockValue/damagedValue` khi thiếu `sales.report.view` | T-168 |
| L3 | Dòng trả SL 0 được chấp nhận | chặn SL 0 sau làm tròn | T-168 |
| L5/L6 | Giữ giá theo invoiceLineId; gọi hàm private bằng bracket | giữ giá theo chỉ số dòng; `createInTx/completeInTx` public, bỏ `checkoutInTx` chết | — |

## Phiên 5 — 2026-10-24 — Module 08 Sổ quỹ (backend) · vá review Module 07 · responsive · FE 07/08

### Đã code
| Khu vực | Nội dung |
|---|---|
| Schema | `cash_accounts` (CASH/BANK/EWALLET, theo chi nhánh hoặc dùng chung, số dư), `payment_categories`, `cash_transfers`, `cash_reconciliations`; `payments` thêm `shift_id`, `cash_account_id`, `category_id`, `transfer_id`; phương thức `TRANSFER`; migration `cashbook`; két mặc định khi đăng ký tenant / tạo chi nhánh; `pnpm prisma:sync-roles` tạo két cho chi nhánh cũ |
| Thanh toán | Quỹ suy ra theo phương thức hoặc chọn rõ; số dư quỹ cập nhật trong transaction (khóa `FOR NO KEY UPDATE`); thu/chi khác theo loại (`payment.other`); `OFFSET`/`TRANSFER` chỉ hệ thống tạo và không hủy riêng lẻ |
| Sổ quỹ | `CashbookService`: quỹ (CRUD, mặc định, ngừng), loại thu chi, chuyển quỹ (cặp TRANSFER, khóa quỹ theo id, không âm), hủy chuyển quỹ, kiểm quỹ, sổ quỹ với tồn quỹ chạy (window SUM), tổng hợp theo quỹ/loại, cấn trừ KH ↔ NCC + hủy theo cặp; 13 endpoint `/cash/*` |
| Ca bán hàng | Đóng ca kèm bàn giao (`handoverAmount`, `handoverToAccountId`) → phiếu chuyển quỹ gắn ca; tiền mặt dự kiến loại trừ TRANSFER/OFFSET |
| Hạ tầng | Deadlock Postgres trong khóa thô (`40P01`) → 409 `TRANSACTION_CONFLICT` (trước đây 500) |
| Web shell | Route + menu: Trả hàng, Sổ quỹ tổng hợp, Quỹ tiền, Chuyển quỹ / Bàn giao ca, Hướng dẫn sử dụng (`/help`) |

### Đã test
`pnpm --filter @erp/api test` → **18 suites, 129 tests pass** sau khi vá (T-167..T-180 mới; T-151 chạy lặp 6 lần sau khi sửa khóa quỹ — xem ghi chú). Stress mới: chuyển quỹ đồng thời (T-176), đổi hàng ‖ thu nợ ‖ hoàn thành phiếu trả trên cùng hóa đơn (T-180).

### Responsive mobile (agent, đã kiểm tra trên 375×812 và 768×1024)
Viewport/meta mobile; `useIsMobile/useIsCompact`; shell: menu dạng drawer + thanh tab dưới (Tổng quan · Hàng hóa · Bán hàng · Hóa đơn · Thêm); POS xếp dọc với giỏ dạng thẻ, thanh "Khách cần trả / THANH TOÁN" dính đáy, bảng thanh toán dạng bottom-sheet; danh sách cuộn trong khung, bộ lọc dạng drawer, chi tiết mở rộng xếp nhãn/giá trị; editor nhập kho / nhập hàng dùng thẻ dòng + nút dính đáy; modal toàn màn hình. Sửa lỗi lớp `.pos` trùng tên gây khoảng trắng lớn ở chi tiết hóa đơn desktop. Còn vướng: editor đặt hàng nhập / trả hàng nhập vẫn bảng cuộn ngang; bảng con trong chi tiết cuộn ngang; biểu đồ dashboard hẹp.

### Bước 8 — Chuyển kho & kiểm kho (backend, cùng phiên)
| Khu vực | Nội dung |
|---|---|
| Schema | `stock_transfers(_lines)`, `stocktakes(_lines)`; migrations `stock_transfers_stocktakes`, `transfers_stocktake_checks`; quyền `transfer.*`, `stocktake.*` (Thủ kho có đủ) |
| Chuyển kho | `TransfersService`: nháp/sửa/xóa, xuất (`TRANSFER_OUT` giá bình quân + `incoming` kho đích), nhận (`TRANSFER_IN` giá đã gửi, thiếu → thất thoát hoặc trả về nguồn), hủy khi đang chuyển (REVERSAL), liên chi nhánh với quyền theo chi nhánh gửi/nhận, `direction=in|out` |
| Kiểm kho | `StocktakesService`: snapshot theo dòng, `scope=ALL`, nhập đếm upsert (nhiều người), làm mới snapshot, cân bằng theo `đếm − snapshot` (giao dịch trong lúc kiểm không bị tính hai lần), `uncountedAs`, hủy đảo bút toán, ẩn giá vốn |
| Test | T-181..T-188 (8 test) ✅ — tổng **19 suites, 137 tests** |

### Frontend Module 07 (agent, đã kiểm tra trên trình duyệt 375×812 và desktop)
`/sales-returns` (danh sách, lọc, thẻ/bảng, chi tiết mở rộng, hoàn thành nháp, hoàn tiền còn lại, hủy), `/sales-returns/new` (chọn hóa đơn → dòng trả được, tình trạng, giá hoàn theo quyền, phí, hoàn tiền / ghi có công nợ, **đổi hàng** với bảng quyết toán), `/sales-returns/:id`; hóa đơn có nút "Trả hàng" + tab trả hàng; lịch sử KH; POS có nút "Trả hàng". Đã chạy thật: TH000001–TH000005, HD000009/10, PC000003/4. Sửa kèm: popup ProductSearch tràn màn hình điện thoại.

### Frontend Module 08 (agent, đã kiểm tra trên trình duyệt)
`/cash` (thẻ đầu kỳ/thu/chi/cuối kỳ, chọn quỹ, sổ quỹ tồn chạy, lập phiếu thu/chi khác với loại thu chi tạo nhanh, cấn trừ công nợ, tổng hợp theo quỹ), `/cash/accounts` (quỹ + loại thu chi, kiểm quỹ), `/cash/transfers` (chuyển quỹ, hủy), `/payments` thêm lọc quỹ/loại/phương thức và gợi ý hủy theo chứng từ gốc, `/shifts` đóng ca kèm **bàn giao ca**. Đã chạy thật: QT0001 (ngân hàng), PC000008, CQ000001–CQ000004, PT000019+PC000014 (cấn trừ rồi hủy). Ghi nhận từ agent (đã/đang xử lý ở backend): phiếu chi không chặn âm quỹ → thêm thiết lập `cash.allowNegativeBalance`; `cash_transfers.kind` để nhận diện bàn giao ca; `GET /shifts/:id` trả kèm phiếu bàn giao.

### Bước 9 — Giá & khuyến mãi (backend, cùng phiên)
| Khu vực | Nội dung |
|---|---|
| Schema | `promotions`, `promotion_branches`, `promotion_vouchers`, `invoice_promotions`; `invoices.promotion_discount/voucher_code`; `invoice_lines.promotion_discount/promotion_id/is_gift`; `price_books.customer_groups`; migration `promotions`; quyền `promotion.view/manage` |
| Engine | `promotion-engine.ts` thuần (26 kiểm tra đơn vị): 5 loại khuyến mãi, ưu tiên / cộng dồn, hàng tặng, voucher, điều kiện thời gian/chi nhánh/nhóm/lượt |
| Dịch vụ | `PromotionsService`: CRUD + kiểm tra cấu hình theo loại, phát hành/tra cứu/khóa voucher, `evaluate`, `consume` (trừ lượt dưới khóa khi hoàn thành), `release` (hủy hóa đơn), báo cáo |
| Hóa đơn | Áp dụng ở preview / giữ đơn / checkout / sửa đơn giữ; `POST /invoices/preview`; dòng hàng tặng; trả hàng và báo cáo tính cả `promotion_discount`; bảng giá theo nhóm khách + `GET /invoices/price-books` |
| Test | T-190..T-197 (8 test tích hợp) + U-09 ✅ — tổng **20 suites, 145 test tích hợp + unit** |

### Frontend Module 09
_(agent đang xây: màn hình khuyến mãi, voucher, báo cáo; POS: preview tổng tiền, khối khuyến mãi, voucher, gợi ý quà tặng — cập nhật khi báo cáo)_

### Frontend chuyển kho / kiểm kho (agent, đã kiểm tra trên trình duyệt 375×812 và desktop)
`/transfers` (Gửi đi / Nhận về / Tất cả, thẻ/bảng, chi tiết, xuất/hủy), `/transfers/new` & `/transfers/:id` (lập phiếu với tồn kho nguồn, lô, "Xuất chuyển ngay"; màn nhận hàng với SL nhận, thiếu, xử lý thiếu; xem), `/stocktakes` và màn **đếm kho** trên điện thoại (quét mã, lọc chưa đếm/lệch, "+1 mỗi lần quét", lưu từng dòng tự động, cân bằng kho với SKIP/ZERO, làm mới snapshot). Đã chạy thật: CH000001 (nhận thiếu WRITE_OFF), CH000002 (hủy khi đang chuyển), KK000001 (ALL, cân bằng rồi hủy), KK000002. Backend đã sửa theo ghi nhận của agent: `direction=in|out` dùng chi nhánh được chọn khi người dùng thấy mọi chi nhánh; `GET /warehouses?scope=all` cho kho đích; xóa được ghi chú phiếu chuyển.

### Bước 6 — Đặt hàng & giao hàng (backend, cùng phiên)
| Khu vực | Nội dung |
|---|---|
| Schema | `sales_orders(_lines)`, `deliveries`, `delivery_events`; phân bổ phiếu thu `SALES_ORDER`; quyền `order.*`, `delivery.*` (thu ngân có); mã `DH`, `GH`; migration `sales_orders_delivery` |
| Đơn đặt hàng | `OrdersService`: tạo (xác nhận ngay + cọc + vận đơn), sửa (dòng khi DRAFT), xác nhận/hủy xác nhận (giữ tồn qua `stock_reservations`, combo tách thành phần), nhận cọc, hoàn tất → hóa đơn (giá đã chốt `trustedPrices`, cọc chuyển phân bổ sang hóa đơn, `prepaid`), hủy (REFUND/CREDIT) |
| Vận đơn | `DeliveriesService`: tạo theo đơn/hóa đơn (COD mặc định = còn thu + phí), máy trạng thái có lịch sử, thu hộ khi giao hoặc đối soát sau (phiếu thu hóa đơn + phí giao hàng là thu khác), chặn hủy hóa đơn/đơn khi đang giao |
| Test | T-200..T-206 (7 test) ✅ |

### Frontend đặt hàng / giao hàng (agent, đã kiểm tra trên trình duyệt 375×812 và desktop)
`/orders` (lọc, thẻ/bảng, chi tiết với cọc, giữ tồn, vận đơn, hành động theo trạng thái), `/orders/new` & `/orders/:id` (khách + bảng giá theo nhóm, dòng hàng, cọc, công tắc giao hàng với COD tự tính, lưu tạm / xác nhận), `/deliveries` (lọc COD chưa thu, drawer chi tiết với dòng thời gian và nút chuyển trạng thái theo `allowedNext`, thu COD, tạo vận đơn từ hóa đơn), hóa đơn hiện đơn đặt hàng / vận đơn và nút "Tạo vận đơn". Đã chạy thật: DH000001 → HD000015, GH000001 (giao + thu COD), DH000002 (hủy hoàn cọc), GH000002. Backend bổ sung theo ghi nhận: `cashAccountId` cho từng khoản thanh toán hóa đơn / tiền cọc.

### Bước 10 — Báo cáo (backend, cùng phiên)
| Khu vực | Nội dung |
|---|---|
| `ReportsModule` | NXT từ sổ kho, hàng tồn lâu, hàng bán chạy/chậm, lãi lỗ (P&L) với thu/chi khác, thất thoát, chi phí giao hàng; giá trị tồn theo nhóm/kho/thương hiệu; xuất Excel 9 loại báo cáo (`/reports/export`); quyền `report.profit.view` |
| Test | T-210..T-214 (5 test) ✅ |

### Frontend báo cáo
_(chưa làm — route `/reports/inventory-nxt`, `/reports/slow-movers`, `/reports/products`, `/reports/profit`, `/reports/valuation` đã nối sẵn)_

### Frontend Module 09 (agent, đã kiểm tra trên trình duyệt)
`/promotions` (danh sách, trạng thái Đang chạy/Sắp diễn ra/Hết hạn/Ngừng, báo cáo), trình soạn khuyến mãi toàn màn hình theo 5 loại, phát hành/khóa voucher; **POS**: tổng tiền từ `POST /invoices/preview` (debounce), giảm giá khuyến mãi từng dòng, khối "Khuyến mãi" (bỏ/áp lại/tắt tự động), ô voucher với tra cứu, gợi ý **quà tặng** thêm dòng 0 đ, bảng giá theo nhóm khách tự chọn; hóa đơn & phiếu in hiển thị khuyến mãi/voucher/hàng tặng. Đã chạy thật: KM0001–KM0004, HD000011–HD000014.

### Bước 13 — Chuyển dữ liệu từ KiotViet (backend, cùng phiên)
| Khu vực | Nội dung |
|---|---|
| Schema | `import_jobs`, `integration_connections`; `invoices.external_ref/imported`; quyền `integration.view/manage`; migration `integrations_import` |
| Nhập Excel | `import-parsers.ts` (đọc xlsx, chuẩn hóa tiêu đề tiếng Việt, từ điển cột cho 4 loại dữ liệu, số/ngày kiểu Việt Nam) + `ImportService` (xem trước → xác nhận; hàng hóa + nhóm nhiều cấp + thương hiệu + ảnh + đơn vị quy đổi + tồn kho qua phiếu điều chỉnh; KH/NCC + công nợ đầu kỳ / đồng bộ; lịch sử hóa đơn không ảnh hưởng sổ sách; đối soát) |
| KiotViet API | `KiotVietClient` (OAuth2 client credentials, phân trang, Retailer header, URL ghi đè được) + `IntegrationsService` (lưu kết nối mã hóa AES-GCM, kiểm tra, kéo 4 loại dữ liệu → cùng pipeline với Excel, ánh xạ chi nhánh KiotViet → kho) |
| Test | T-220..T-224 (5 test, gồm mock server KiotViet) ✅ |

### Frontend tích hợp / chuyển dữ liệu (agent, đã kiểm tra trên trình duyệt 375×812 và 1280×800)
`/integrations/:tab` (excel | kiotviet | reconcile | jobs). **Excel**: chọn loại dữ liệu (kèm hướng dẫn xuất từ KiotViet) → tải .xlsx → tùy chọn (kho mặc định, nhập tồn, cập nhật hàng đã có, công nợ, chi nhánh/ngày hóa đơn) → xem trước: ánh xạ cột (chọn lại được), cột tồn kho → kho, mẫu dữ liệu, cảnh báo (tải .csv) → nhập → kết quả (tạo/cập nhật/bỏ qua/lỗi, tải lỗi .csv). **KiotViet**: hướng dẫn lấy Retailer / Client ID / Client Secret (người dùng tự nhập, secret không hiển thị lại), kiểm tra kết nối → danh sách chi nhánh KiotViet ↔ kho, lưu ánh xạ, kéo dữ liệu theo loại với hộp xác nhận và kết quả từng loại. **Đối soát**: thẻ số liệu để so với KiotViet + việc nhập gần đây. **Lịch sử**: danh sách phiên nhập, chi tiết (tổng, ánh xạ đã dùng, lỗi). Đã chạy thật: nhập 3 hàng hóa KVTEST001–003 (2 dòng tồn, 1 phiếu điều chỉnh), 2 khách hàng; kiểm tra kết nối với thông tin giả → 409 `KIOTVIET_AUTH_FAILED` hiển thị đúng. Chưa bấm thử trên UI: file có nhiều cột tồn theo chi nhánh, nhập lịch sử hóa đơn, nhập KiotViet thật (chưa có thông tin đăng nhập). Backend đã sửa theo ghi nhận: `PUT /integrations/kiotviet` cho lưu từng phần (chỉ `branchMap` / chỉ retailer), file Excel hỏng → 400 thay vì 500 (T-224, T-225).

### Bước 11 — Điểm tích lũy & CRM (backend, cùng phiên)
| Khu vực | Nội dung |
|---|---|
| Schema | `customer_point_entries`, `customers.points`, `invoices.points_*`, phương thức `POINTS`; 6 thiết lập `loyalty.*`; quyền `loyalty.manage`; migration `loyalty` |
| Logic | `LoyaltyService`: cấu hình, tích điểm khi hoàn thành hóa đơn (theo tiền trả), tiêu điểm như một khoản thanh toán `POINTS` với trần số dư / % hóa đơn và kiểm tra lại dưới khóa, đảo khi hủy, thu hồi theo tỷ lệ khi trả hàng, điều chỉnh tay, sổ điểm; sinh nhật; báo cáo giá trị khách hàng (`/reports/customers`) |
| Test | T-230..T-233 (4 test) ✅ |

### Frontend báo cáo (agent, đã kiểm tra trên trình duyệt 375×812 và 1366×900)
5 màn hình `/reports/inventory-nxt`, `/reports/slow-movers`, `/reports/products`, `/reports/profit`, `/reports/valuation` (thẻ chỉ số, bộ lọc, thẻ/bảng, biểu đồ HTML/SVG tự vẽ, xuất Excel). Backend bổ sung theo ghi nhận: `/reports/export` nhận thêm `order`, `search`, `hideEmpty`, `groupBy`; tổng SKU của giá trị tồn đếm không trùng.

### Bước 11/12/14 — Nhân viên, thuế, SaaS (backend, cùng phiên)
| Khu vực | Nội dung |
|---|---|
| Nhân viên | `commission_rules`, `attendances`, hồ sơ nhân viên trên `users`; `EmployeesService`: quy tắc hoa hồng (cụ thể nhất thắng, ngưỡng doanh thu, 3 cơ sở tính), báo cáo hoa hồng, chấm công vào/ra + sửa/bổ sung, hiệu suất nhân viên; quyền `employee.manage`, `attendance.view`, `commission.view` |
| Thuế | `GET /reports/tax` (đầu ra theo thuế suất, đầu vào, phải nộp tham khảo) |
| SaaS | `PLANS` (FREE/BASIC/PRO/ENTERPRISE) + `PlanService.assertLimit` khi tạo chi nhánh/kho/người dùng/hàng hóa; `tenants.trial_ends_at/plan_expires_at`; hết hạn → chỉ đọc (guard JWT); `GET /subscription`; `/platform/tenants` với `PLATFORM_ADMIN_KEY`; quyền `subscription.view` |
| Test | T-240..T-245 (6 test) ✅ |

### Việc còn lại của phiên
_(toàn bộ danh sách này đã hoàn thành trong cùng phiên — xem các mục bên dưới)_

### Frontend nhân viên · tích điểm · gói dịch vụ · thuế (agent, đã kiểm tra trên trình duyệt 375×812 và 1366×900)
`/employees` (danh sách, hồ sơ dùng chung ngăn kéo người dùng với chức vụ / ngày vào làm / lương cơ bản / ghi chú), `/employees/attendance` (vào ca – ra ca có đồng hồ, tab quản lý, sửa / bổ sung giờ), `/employees/commissions` (quy tắc hoa hồng, hoa hồng theo kỳ của nhóm và của tôi theo từng quy tắc), `/employees/performance` (xếp hạng doanh thu / LN gộp / ca / chênh lệch tiền mặt / giờ công / hoa hồng, biểu đồ top 5). Thiết lập: tab **Tích điểm** (bật/tắt, tỷ lệ tích, giá trị điểm, trần dùng điểm) và **Gói dịch vụ** (gói hiện tại, thanh mức dùng, thẻ các gói); menu thiết lập trên điện thoại chuyển thành dãy chip cuộn ngang (sửa lỗi cũ). Khách hàng: cột / thẻ điểm, tab **Điểm tích lũy** với sổ điểm và điều chỉnh tay. POS: khối điểm (số dư, dùng tối đa, "Thanh toán bằng điểm −X", "Sẽ tích +N"), tiền khách cần trả trừ điểm, giữ đơn khôi phục điểm, hóa đơn in ghi điểm. `/reports/tax` (đầu ra theo thuế suất, đầu vào, phải nộp tham khảo). `PlanBanner` (hết hạn dùng thử / gói → chỉ đọc; còn ≤ 7 ngày dùng thử) đã gắn dưới header. Đã chạy thật: HD000016 (+17 điểm), HD000017 (dùng 17 điểm, còn trả 28.000), HD000018 (đơn giữ dùng 45 điểm, trả 0), điều chỉnh +50, quy tắc "2% doanh thu", chấm công vào/ra + sửa giờ, hồ sơ "Thủ kho" lương 8.000.000. Backend đã sửa theo ghi nhận: `GET /users` trả hồ sơ nhân viên (lương chỉ khi có `employee.manage`), `PATCH /users` nhận `hiredAt: null`, danh sách quy tắc hoa hồng kèm tên nhóm hàng / SKU; CSS dòng mở rộng trên điện thoại hết tràn 20 px.

### Hướng dẫn sử dụng trong ứng dụng (agent, đã kiểm tra trên trình duyệt 375×812 và 1280×800)
`/help` và `/help/:slug`: 75 bài trong 11 chuyên mục (Bắt đầu 10 · Hàng hóa 10 · Kho 9 · Mua hàng 5 · Bán hàng 11 · Khách hàng 4 · Sổ quỹ 6 · Nhân viên 4 · Báo cáo 10 · Chuyển dữ liệu từ KiotViet 5 · Gói dịch vụ 1). Mỗi bài: dùng khi nào, quyền cần có, các bước đánh số kèm ảnh chụp thật (điện thoại mặc định trên màn hẹp, máy tính trên màn rộng, bấm để phóng to), "Lưu ý" lấy từ quy tắc nghiệp vụ, "Xem thêm", bài trước / sau, mục lục dính bên trái ≥ 992 px; trang danh mục có tìm kiếm không dấu và chip chuyên mục; slug lạ → trang gợi ý. Ảnh: `scripts/capture-guide.mjs` viết lại — 98 màn × 2 cỡ (JPEG q80, ~13 MB), `--check` báo lỗi nếu bài tham chiếu ảnh không tồn tại, `--only` chụp lại từng màn; danh mục slug trong `docs/user-guide.md`. Điểm agent phát hiện trong UI thật và đã sửa ngay: menu Hàng hóa còn mục "Kiểm kho (Sắp ra mắt)" thừa; nút giữ đơn POS ghi "Lưu tạm" lệch với gợi ý "F7 Giữ đơn"; báo cáo Doanh thu, Công nợ KH/NCC và Sổ quỹ tổng hợp chưa có nút Xuất Excel dù API có (đã thêm; Thuế GTGT vẫn chưa có xuất).

### Tổng kết cuối Phiên 5
| Hạng mục | Kết quả |
|---|---|
| Backend | 14/14 module có code chạy; 181 đường dẫn OpenAPI (`docs/openapi.json`) |
| Test API | 20 suite / **154 test tích hợp** + **26 test đơn vị** xanh (2 lần chạy liên tiếp); lint sạch |
| Web | typecheck, lint, build production xanh; mobile-first toàn bộ màn hình; `/help` 75 bài, 196 ảnh |
| Đã vá cuối phiên | Làm mới token hai tab (BR-05b, kể cả bước xoay vòng nguyên tử); `PUT /integrations/kiotviet` lưu từng phần; file Excel hỏng → 400; `/users` trả hồ sơ nhân viên, `hiredAt: null`; quy tắc hoa hồng kèm tên nhóm/SKU; banner gói dịch vụ; dòng mở rộng trên điện thoại |
| Chưa làm (ghi ở modules.md) | Xuất PDF / báo cáo theo lịch; API key, webhook, sàn TMĐT, máy in nhiệt, QR; hóa đơn điện tử; thanh toán gói online + dashboard nền tảng; nhắc nợ; job đối soát định kỳ |
| Chưa chạy | Nhập KiotViet thật (cần người dùng tự nhập Retailer / Client ID / Client Secret ở `/integrations/kiotviet`); CI trên GitHub; backup qua Docker |
| Git | Chưa commit theo yêu cầu người dùng |

## Phiên 6 — 2026-10-24 (tối) — Trang chủ mobile · triển khai Ubuntu

Người dùng đã tự commit toàn bộ mã nguồn (`60e1a78 update`, 537 tệp) và đẩy lên `github.com/Dinofx1999/Pos_Kiosviet` (nhánh `master`); nhận xét giao diện Tổng quan trên điện thoại "trông chán".

### Trang chủ mới (mobile-first, kiểu KiotViet)
| Khu vực | Nội dung |
|---|---|
| API | `GET /dashboard/home?branchId?` (`DashboardHomeService`): kết quả bán hàng hôm nay / hôm qua / 7 ngày / 7 ngày trước / tháng / tháng trước, doanh thu theo giờ (hôm nay) và theo ngày (30 ngày), top 5 hàng bán 7 ngày, 8 hóa đơn gần nhất, chưa thu đủ, trả hàng hôm nay, việc cần xử lý (đơn giữ, đơn đặt đã xác nhận, đang giao, chuyển kho chờ nhận, sinh nhật), tồn kho + 5 phiếu kho, ca đang mở của tôi (số HĐ, doanh thu, tiền mặt ròng). Ngày theo múi giờ gian hàng; mọi truy vấn gắn tenant + phạm vi chi nhánh; không có `sales.report.view` → chỉ số liệu `seller_id = tôi`; lợi nhuận / giá trị tồn theo quyền xem giá vốn. Test T-250 ✅ |
| Web | `DashboardPage` viết lại + `dashboard.css` (`.dh-*`): hero xanh nối liền header với thẻ trắng (chọn kỳ Hôm nay / 7 ngày / Tháng này, doanh thu lớn, % so kỳ trước, Đơn / Khách / LN gộp), 8 lối tắt màu theo quyền, khối Cần xử lý (ẩn mục = 0, liên kết tới màn hình đã lọc: `/invoices?status=DRAFT`, `/invoices?unpaid=1`, `/products?stock=low`, `/transfers?tab=in`…), biểu đồ cột chạm để xem chi tiết, Hàng bán chạy có thanh tỷ lệ, Hoạt động gần đây dạng feed (avatar chữ cái, "x phút trước"), Tồn kho 2×2 + phiếu kho. Desktop: lưới 2 cột (biểu đồ / bán chạy / tồn kho bên trái, cần xử lý / hoạt động bên phải). Đã kiểm tra trên 375×812 và 1280×800 |
| Sửa kèm | `ProductsPage` nhận `?stock=low`, `InvoicesPage` nhận `?unpaid=1`; hướng dẫn mới "Đọc trang Tổng quan" trong `/help` |

### Triển khai lên VPS Ubuntu 22.04 (180.93.241.253, 1 vCPU / 1,25 GB)
`docs/deploy-ubuntu.md` + `scripts/deploy/{setup-ubuntu.sh, deploy.sh, erp-api.service, nginx-erp.conf}`: cài không Docker (swap 2 GB, Node 22 + pnpm qua corepack, PostgreSQL 16, Redis, nginx, user `erp`, `.env` tự sinh khóa, systemd, ufw, pg_dump hằng đêm, deploy key GitHub); `deploy.sh` clone / pull → install → build → migrate + sync-roles → rsync web → restart → kiểm tra API. Chưa chạy thử trên máy chủ thật (cần người dùng đăng nhập SSH).

### Triển khai thật (24/10/2026, 22:40–23:10)
Người dùng cấp quyền SSH bằng khóa (`ssh-copy-id`). `setup-ubuntu.sh` chạy sạch; `deploy.sh` lần 1 lỗi build API vì GitHub thiếu `apps/api/src/modules/uploads` (bị `.gitignore` `uploads/` nuốt) → sửa `.gitignore`, push `f5e0783`, deploy lần 2 thành công: API active, web lên tại http://baoancosmetic.com.vn (tên miền tenten đã trỏ A/CNAME về 180.93.241.253), ảnh hướng dẫn và API đều 200 qua domain. Đã bật `erp-autodeploy.timer`. HTTPS bật 23:15 (người dùng đồng ý điều khoản Let's Encrypt; chứng chỉ tới 22/01/2027, tự gia hạn, HTTP → HTTPS). Gian hàng thật `baoantamky` (Bảo Ân Tam Kỳ) do người dùng đăng ký 23:22, đã nâng ACTIVE / ENTERPRISE không hết hạn qua `/platform/tenants/:id`. Bước kế tiếp khi người dùng sẵn sàng: nhập dữ liệu từ KiotViet vào gian hàng này.
