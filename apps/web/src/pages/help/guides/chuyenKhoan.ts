import type { Guide } from './types';

/** Thanh toán chuyển khoản tự động qua SePay (VietQR + webhook). Nhãn trùng với giao diện: Tích hợp → "Chuyển khoản tự động (SePay)", POS "QR chuyển khoản", Sổ quỹ → "Giao dịch chuyển khoản". */
export const CHUYEN_KHOAN: Guide[] = [
  {
    slug: 'sepay-cai-dat',
    title: 'Cài đặt nhận tiền chuyển khoản tự động (SePay)',
    section: 'chuyen-khoan',
    when: 'Làm một lần khi muốn khách quét mã VietQR để trả tiền và hệ thống tự ghi nhận tiền về, không cần nhân viên mở app ngân hàng kiểm tra.',
    perms: ['Xem kết nối & lịch sử nhập dữ liệu (integration.view)', 'Nhập dữ liệu từ KiotViet / Excel, cấu hình kết nối (integration.manage) để lưu cấu hình và tạo khóa'],
    keywords: ['SePay', 'VietQR', 'QR', 'chuyển khoản', 'webhook', 'API key', 'khóa API', 'ngân hàng', 'my.sepay.vn', 'tiền tố', 'mã thanh toán', 'tự động'],
    steps: [
      { text: 'Vào Thiết lập cửa hàng → Thanh toán QR (SePay). Cùng màn này cũng mở được từ biểu tượng người dùng góc trên bên phải → Tích hợp → tab Chuyển khoản tự động (SePay).', shot: 'integrations-sepay' },
      { text: 'Ở thẻ Tài khoản nhận tiền: bật "Bật nhận tiền chuyển khoản tự động", chọn Ngân hàng (gõ để tìm, vd "MB" hoặc "quân đội"), nhập Số tài khoản và Chủ tài khoản (viết hoa không dấu như trên app ngân hàng).', note: 'Khung "Xem trước mã QR" hiện mã mẫu 10.000đ – quét thử bằng app ngân hàng để chắc chắn đúng tên chủ tài khoản (không cần chuyển tiền).' },
      { text: 'Chọn Quỹ ghi nhận tiền về (quỹ loại Ngân hàng; chưa có thì tạo ở Sổ quỹ → Quỹ tiền / Tài khoản), giữ Tiền tố mã thanh toán (mặc định BA) và Hiệu lực mã QR tại quầy (phút), rồi bấm Lưu cấu hình.' },
      { text: 'Ở thẻ Webhook & khóa API: bấm Sao chép cạnh URL webhook, rồi bấm Tạo khóa API → Tạo khóa. Hộp "Khóa API mới" hiện khóa MỘT lần duy nhất: bấm Sao chép khóa, dán vào nơi an toàn, bấm Tôi đã lưu khóa.' },
      { text: 'Đăng nhập my.sepay.vn: đăng ký và liên kết đúng tài khoản ngân hàng ở trên.' },
      { text: 'Trên SePay vào Cấu hình công ty → Cấu trúc mã thanh toán: Tiền tố = tiền tố trong phần mềm (vd BA), Hậu tố 8 ký tự, kiểu Chỉ số. Lưu.' },
      { text: 'Trên SePay vào Tích hợp WebHooks → Thêm webhook: Sự kiện "Có tiền vào", chọn tài khoản ngân hàng, dán URL webhook, Kiểu chứng thực "API Key" và dán khóa API; bật "Gọi lại khi lỗi" rồi Lưu.' },
      { text: 'Thử: ở chế độ Test của SePay dùng "Giả lập giao dịch" với nội dung BA00000000 (hoặc chuyển thật 2.000đ). Thẻ Webhook hiện "SePay đã gọi …" và giao dịch xuất hiện ở Sổ quỹ → Giao dịch chuyển khoản (mục Chưa khớp vì mã mẫu không tồn tại – bấm Bỏ qua).', shot: 'bank-transactions' },
    ],
    notes: [
      'Bấm "Tạo khóa API mới" sẽ làm khóa cũ ngừng hoạt động ngay – phải dán khóa mới vào webhook trên SePay, nếu không tiền về sẽ không được ghi nhận.',
      'Webhook phải gọi được tới tên miền thật của cửa hàng (https). Khi mở phần mềm bằng localhost, SePay không gọi tới được.',
      'Mã QR tại quầy hết hạn theo số phút đã cài; mã thu nợ hóa đơn / cọc đơn hiệu lực 7 ngày. Mã hết hạn nhưng khách vẫn chuyển thì tiền vẫn được ghi nhận.',
      'Thẻ "30 ngày gần nhất" thống kê giao dịch Khớp tự động / Gắn tay / Chưa khớp / Bỏ qua – bấm vào để mở danh sách tương ứng.',
    ],
    related: ['thu-tien-qr', 'quy-tien', 'phieu-thu-chi'],
  },
  {
    slug: 'thu-tien-qr',
    title: 'Thu tiền bằng mã QR: bán tại quầy, thu nợ, cọc đơn, giao dịch chưa khớp',
    section: 'chuyen-khoan',
    when: 'Khách muốn chuyển khoản: tại quầy, trả nợ hóa đơn cũ hoặc đặt cọc đơn hàng – và khi có tiền về mà hệ thống chưa tự nhận ra.',
    perms: ['Tạo / giữ đơn bán hàng (invoice.create) cho QR tại quầy', 'Lập phiếu thu / chi (payment.create) cho thu nợ, cọc đơn, gắn / bỏ qua giao dịch', 'Xem sổ quỹ / quỹ tiền (cash.view) để xem Giao dịch chuyển khoản'],
    keywords: ['QR chuyển khoản', 'VietQR', 'SePay', 'Thu qua QR', 'Cọc qua QR', 'chuyển khoản', 'chưa khớp', 'gắn vào chứng từ', 'bỏ qua', 'tiền mặt còn lại', 'nội dung chuyển khoản'],
    steps: [
      { text: 'Tại quầy: thêm hàng vào giỏ, mở bảng thanh toán (điện thoại: bấm THANH TOÁN), chọn QR chuyển khoản rồi bấm TẠO MÃ QR (F9).', shot: 'pos-qr', caption: 'Màn hình mã QR chờ khách chuyển khoản' },
      { text: 'Đưa màn hình cho khách quét bằng app ngân hàng – số tiền và nội dung đã điền sẵn. Khách nhập tay thì phải ghi đúng "Nội dung chuyển khoản bắt buộc" (vd BA12345678); bấm Sao chép để gửi qua Zalo.' },
      { text: 'Màn hình tự cập nhật: khi tiền về hóa đơn được lưu tự động và biên lai hiện ra – không cần bấm gì. Khách đổi ý thì bấm Hủy mã hoặc Đóng & hủy mã.' },
      { text: 'Khách chuyển thiếu: màn hình báo "Đã nhận X / còn thiếu Y", mã QR đổi sang số còn thiếu. Chờ khách chuyển tiếp, hoặc bấm "Thu Y tiền mặt" → Hoàn tất hóa đơn để thu phần còn lại bằng tiền mặt.' },
      { text: 'Thu nợ hóa đơn: Giao dịch → Hóa đơn, mở hóa đơn còn nợ, bấm Thu qua QR. Khi tiền về, phiếu thu chuyển khoản được ghi vào hóa đơn tự động (màn hình báo "Đã ghi phiếu thu tự động"). Có thể đóng màn hình – mã vẫn hiệu lực 7 ngày, bấm lại Thu qua QR sẽ mở đúng mã cũ.' },
      { text: 'Cọc đơn đặt hàng: Giao dịch → Đặt hàng, mở đơn (Phiếu tạm / Đang xử lý), bấm Cọc qua QR, nhập số tiền cọc (mặc định số còn phải thu) → Tạo mã QR. Tiền về được ghi thành tiền cọc của đơn.' },
      { text: 'Tiền về nhưng không khớp mã (khách ghi sai nội dung, mã đã hủy…): vào Sổ quỹ → Giao dịch chuyển khoản, mục Chưa khớp (số đỏ trên menu là số giao dịch đang chờ).', shot: 'bank-transactions' },
      { text: 'Bấm Gắn vào chứng từ → chọn Ghi nhận vào Hóa đơn / Đơn đặt hàng / Khách hàng, tìm chứng từ (mã HD… / DH… ghi trong nội dung được tìm sẵn), bấm Lập phiếu thu. Tiền không liên quan bán hàng (chuyển nội bộ, giao dịch thử) thì bấm Bỏ qua → Bỏ qua giao dịch.' },
    ],
    notes: [
      'Tiền chuyển khoản luôn ghi vào quỹ đã chọn ở cài đặt SePay (phương thức Chuyển khoản), gắn ca bán hàng đang mở như phiếu thu thường.',
      'Đóng màn hình QR khi đã nhận tiền mà hóa đơn chưa lưu (vd lỗi tồn kho): giỏ hàng hiện "Giỏ hàng đang gắn mã chuyển khoản … – Mở lại"; bấm Mở lại để hoàn tất, không tạo mã mới.',
      'Không giữ đơn được khi giỏ hàng đang gắn mã chuyển khoản – hoàn tất hoặc hủy mã trước.',
      'Khách chuyển thừa: tại quầy số thừa không vào hóa đơn – hoàn lại cho khách; thu nợ / cọc của khách có hồ sơ thì phần thừa ghi có (trả trước) cho khách.',
      'Gắn vào Khách hàng: phiếu thu trừ vào công nợ đang có, phần dư thành tiền trả trước của khách.',
    ],
    related: ['sepay-cai-dat', 'pos-thanh-toan', 'hoa-don', 'dat-hang-coc', 'cong-no-khach', 'phieu-thu-chi'],
  },
];
