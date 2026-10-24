# Hướng dẫn sử dụng trong ứng dụng (`/help`)

Mục "Hướng dẫn sử dụng" (menu tài khoản → Hướng dẫn sử dụng, hoặc biểu tượng ? trên thanh tiêu đề) là trang `/help` của web app, viết cho chủ cửa hàng / thu ngân, ưu tiên điện thoại.

* **Mã nguồn**: `apps/web/src/pages/help/HelpPage.tsx` (trang danh mục + trang bài), `help.css` (tiền tố `.hp-`), nội dung là dữ liệu thuần TypeScript trong `apps/web/src/pages/help/guides/*.ts` (một file mỗi chuyên mục, kiểu `Guide` trong `types.ts`, gom ở `index.ts`).
* **Ảnh màn hình**: `apps/web/public/guide/<tên>-{desktop|mobile}.jpg`, sinh bằng `node scripts/capture-guide.mjs` (Playwright, đăng nhập `demo/admin`, desktop 1280×800 cả trang, mobile 390×844 đúng khung máy, JPEG 80). `--only a,b` chụp một vài ảnh; `--check` chỉ kiểm tra các ảnh mà bài hướng dẫn tham chiếu có đủ trên đĩa. Chạy lại mỗi khi giao diện đổi.
* **Thêm bài mới**: thêm một object vào file chuyên mục tương ứng (slug duy nhất, `steps[].shot` trùng tên trong `SHOTS` của script), rồi chạy script.
* Tìm kiếm không phân biệt dấu (`hoa don` ⇒ "Hóa đơn"); `/help?q=…&section=…` giữ trạng thái lọc; `/help/<slug>` là liên kết sâu; slug lạ ⇒ "Không tìm thấy hướng dẫn".

## Danh mục bài (slug → tiêu đề → ảnh)

### Bắt đầu
| Slug | Tiêu đề | Ảnh |
|---|---|---|
| `dang-nhap` | Đăng nhập & đăng ký gian hàng | login, dashboard |
| `trang-tong-quan` | Đọc trang Tổng quan (trang chủ) | dashboard |
| `chon-chi-nhanh` | Chọn chi nhánh làm việc | dashboard |
| `giao-dien-dien-thoai` | Dùng phần mềm trên điện thoại | dashboard, menu-drawer |
| `doi-mat-khau` | Đổi mật khẩu | change-password |
| `thiet-lap-cua-hang` | Thiết lập cửa hàng: chính sách bán hàng & kho | settings-config |
| `chi-nhanh-kho` | Chi nhánh & kho hàng | settings-branches, settings-warehouses |
| `nguoi-dung` | Thêm người dùng & phân chi nhánh | settings-users |
| `vai-tro-phan-quyen` | Vai trò & phân quyền | settings-roles |
| `ma-chung-tu` | Cấu hình mã chứng từ | settings-config |
| `nhat-ky-he-thong` | Nhật ký hệ thống & lịch sử đăng nhập | settings-audit, settings-logins |

### Hàng hóa
| Slug | Tiêu đề | Ảnh |
|---|---|---|
| `them-hang-hoa` | Thêm hàng hóa mới (kèm nhiều ảnh) | products, product-new, product-detail |
| `nhom-hang-thuong-hieu` | Nhóm hàng & thương hiệu | products, product-new |
| `don-vi-quy-doi` | Đơn vị quy đổi (thùng, lốc, hộp) | product-new |
| `bien-the` | Hàng có biến thể (màu sắc, kích thước) | product-new |
| `ma-vach` | Mã vạch & quét mã | product-new, pos-cart |
| `gia-ban-gia-von` | Giá bán, giá vốn & giá nhập gần nhất | product-detail |
| `bang-gia` | Thiết lập bảng giá | price-books, price-book-new |
| `khuyen-mai` | Tạo chương trình khuyến mãi | promotions, promotion-new |
| `voucher` | Phát hành & dùng mã voucher | promotion-new, pos-cart |
| `nhap-excel-hang-hoa` | Nhập / xuất hàng hóa bằng Excel | products-import |

### Kho
| Slug | Tiêu đề | Ảnh |
|---|---|---|
| `nhap-kho-khac` | Nhập kho khác | inventory-receipt-new, inventory-documents |
| `xuat-kho-xuat-huy` | Xuất kho / xuất hủy | inventory-issue-new |
| `dieu-chinh-ton` | Điều chỉnh tồn theo số đếm thực tế | inventory-adjust-new |
| `ton-kho` | Xem tồn kho, tồn khả dụng & cảnh báo tồn thấp | inventory-balances |
| `the-kho` | Thẻ kho / lịch sử biến động | inventory-movements |
| `chuyen-kho-gui` | Chuyển kho: lập phiếu & xuất chuyển | transfers, transfer-new |
| `chuyen-kho-nhan` | Nhận hàng chuyển kho & xử lý thiếu | transfers, transfer-detail |
| `kiem-kho` | Kiểm kho bằng điện thoại & cân bằng kho | stocktake-new, stocktake-detail, stocktakes |
| `huy-phieu-kho` | Hủy phiếu kho đã ghi sổ | inventory-document-detail |

### Mua hàng
| Slug | Tiêu đề | Ảnh |
|---|---|---|
| `nha-cung-cap` | Thêm nhà cung cấp & công nợ đầu kỳ | suppliers, supplier-new |
| `dat-hang-nhap` | Đặt hàng nhập & nhận hàng từ đơn | purchase-orders, purchase-order-new |
| `nhap-hang` | Nhập hàng từ NCC & thanh toán ngay | purchase-receipts, purchase-receipt-new, purchase-receipt-detail |
| `tra-hang-nhap` | Trả hàng nhập cho nhà cung cấp | purchase-returns, purchase-return-new |
| `cong-no-ncc` | Công nợ nhà cung cấp & thanh toán | reports-supplier-debt, payments-out |

### Bán hàng
| Slug | Tiêu đề | Ảnh |
|---|---|---|
| `mo-ca` | Mở ca bán hàng | pos, shift-open |
| `ban-hang-pos` | Bán hàng tại quầy (POS) | pos, pos-cart |
| `pos-khach-hang` | Chọn khách hàng & thêm nhanh khách tại POS | pos-customer |
| `pos-giam-gia-khuyen-mai` | Giảm giá, khuyến mãi & voucher tại POS | pos-cart |
| `pos-thanh-toan` | Thanh toán: nhiều phương thức, bán nợ, in hóa đơn | pos-cart, pos-mixed |
| `giu-don` | Giữ đơn (lưu tạm) & mở lại đơn giữ | pos-cart, pos-held |
| `hoa-don` | Hóa đơn: xem chi tiết, in, thu nợ, hủy | invoices, invoice-detail |
| `dat-hang-coc` | Đặt hàng, nhận cọc & chuyển thành hóa đơn | order-new, orders, order-detail |
| `giao-hang-cod` | Giao hàng & thu hộ (COD) | deliveries, delivery-detail |
| `tra-hang-doi-hang` | Trả hàng / đổi hàng cho khách | sales-returns, sales-return-new, sales-return-detail |
| `dong-ca` | Đóng ca, đối soát tiền & bàn giao ca | shifts, shift-detail |

### Khách hàng
| Slug | Tiêu đề | Ảnh |
|---|---|---|
| `them-khach-hang` | Thêm khách hàng & nhóm khách | customers, customer-new, customer-detail |
| `cong-no-khach` | Công nợ khách hàng & thu nợ | reports-customer-debt, customer-detail |
| `diem-tich-luy` | Điểm tích lũy: bật, tích điểm, dùng điểm | settings-loyalty, customer-detail |
| `sinh-nhat-khach` | Chăm sóc khách: sinh nhật & khuyến mãi theo nhóm | customer-new, promotion-new |

### Sổ quỹ
| Slug | Tiêu đề | Ảnh |
|---|---|---|
| `quy-tien` | Quỹ tiền / tài khoản | cash-accounts, cash-account-new |
| `phieu-thu-chi` | Lập phiếu thu / phiếu chi & loại thu chi | payments-in, voucher-new, cash-categories |
| `so-quy-tong-hop` | Sổ quỹ tổng hợp & tồn quỹ theo phiếu | cash |
| `chuyen-quy` | Chuyển quỹ | cash-transfers, cash-transfer-new |
| `can-tru-cong-no` | Cấn trừ công nợ KH ↔ NCC | debt-offset |
| `kiem-quy` | Kiểm quỹ | cash-accounts, cash-reconcile |

### Nhân viên
| Slug | Tiêu đề | Ảnh |
|---|---|---|
| `danh-sach-nhan-vien` | Danh sách & hồ sơ nhân viên | employees |
| `cham-cong` | Chấm công vào / ra bằng điện thoại | attendance |
| `hoa-hong` | Quy tắc hoa hồng & báo cáo hoa hồng | commissions, commission-rule-new |
| `hieu-suat` | Hiệu suất nhân viên | performance |

### Báo cáo
| Slug | Tiêu đề | Ảnh |
|---|---|---|
| `bao-cao-doanh-thu` | Báo cáo doanh thu | reports-sales |
| `bao-cao-lai-lo` | Báo cáo lãi lỗ | reports-profit |
| `hang-ban-chay` | Hàng bán chạy / bán chậm | reports-products |
| `nhap-xuat-ton` | Báo cáo nhập – xuất – tồn | reports-nxt |
| `hang-ton-lau` | Hàng tồn lâu | reports-slow-movers |
| `gia-tri-ton` | Giá trị tồn kho | reports-valuation |
| `bao-cao-cong-no` | Báo cáo công nợ KH & NCC | reports-customer-debt, reports-supplier-debt |
| `bao-cao-mua-hang` | Báo cáo mua hàng | reports-purchasing |
| `thue-gtgt` | Báo cáo thuế GTGT | reports-tax |
| `xuat-excel-bao-cao` | Xuất báo cáo ra Excel | reports-profit |

### Chuyển dữ liệu từ KiotViet
| Slug | Tiêu đề | Ảnh |
|---|---|---|
| `kiotviet-lo-trinh` | Lộ trình chuyển từ KiotViet (thứ tự khuyến nghị) | integrations-excel, integrations-reconcile |
| `kiotviet-xuat-file` | Xuất file Excel từ KiotViet | integrations-excel |
| `kiotviet-nhap-excel` | Nhập Excel KiotViet từng loại dữ liệu | integrations-excel |
| `kiotviet-ket-noi-api` | Kết nối KiotViet qua API & kéo dữ liệu | integrations-kiotviet |
| `kiotviet-doi-soat` | Đối soát số liệu sau khi nhập & lịch sử nhập | integrations-reconcile, integrations-jobs |

### Gói dịch vụ
| Slug | Tiêu đề | Ảnh |
|---|---|---|
| `goi-dich-vu` | Gói dịch vụ, hạn mức & dùng thử | settings-subscription |
