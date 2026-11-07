import type { Guide } from './types';

/** Bán online: web bán hàng cho khách (/shop), bật / tắt hiển thị giá, Flash Sale, xử lý đơn đặt trên web. Nhãn trùng giao diện menu "Bán online". */
export const BAN_ONLINE: Guide[] = [
  {
    slug: 'web-ban-hang',
    title: 'Mở web bán hàng và bật / tắt hiển thị giá',
    section: 'ban-online',
    when: 'Muốn khách xem hàng, xem Flash Sale và đặt hàng qua đường dẫn web (gửi qua Zalo, Facebook, in mã QR tại quầy) – hoặc tạm ẩn giá / tạm đóng web.',
    perms: ['Thiết lập web bán hàng, bật / tắt hiển thị giá và Flash Sale (online.manage)'],
    keywords: ['web', 'website', 'bán online', 'shop', 'cửa hàng online', 'hiển thị giá', 'ẩn giá', 'liên hệ', 'đặt hàng online', 'QR', 'đường dẫn', 'Zalo', 'hotline'],
    steps: [
      { text: 'Vào menu Bán online → Thiết lập web bán hàng.' },
      { text: 'Bật công tắc "Website bán hàng". Đường dẫn web và mã QR hiện ngay bên dưới: bấm Sao chép để gửi cho khách, bấm Mở web để xem thử.', note: 'Trên tên miền của cửa hàng, đường dẫn là https://<tên miền>/shop.' },
      { text: 'Ở thẻ "Bật / tắt trên web": bật hoặc tắt "Hiển thị giá trên web". Thay đổi có hiệu lực ngay, không cần bấm Lưu.', note: 'Tắt giá: khách thấy "Liên hệ" thay cho giá; Flash Sale chỉ hiện mức giảm %. Khách vẫn đặt hàng được, đơn vẫn lưu đúng giá để cửa hàng gọi báo giá.' },
      { text: 'Bật / tắt các mục còn lại theo nhu cầu: Flash Sale, Nhận đặt hàng online (tắt = khách chỉ xem và gọi / nhắn Zalo), Hiện số lượng còn lại, Ẩn hàng đã hết, Chỉ hiện hàng có ảnh.' },
      { text: 'Ở thẻ "Thông tin hiển thị & nhận đơn": nhập tên cửa hàng, hotline, Zalo, địa chỉ, dòng thông báo, logo, ảnh bìa, màu chủ đạo; chọn Chi nhánh nhận đơn web, Kho nhận đơn web và Kho tính còn hàng trên web (để trống = cộng tồn tất cả kho); chọn Nhóm hàng ẩn khỏi web nếu có. Bấm Lưu.' },
    ],
    notes: [
      'Web chỉ hiện hàng đang kinh doanh, cho phép bán, không quản lý theo lô và không phải dịch vụ. Hàng ngừng kinh doanh nhập từ KiotViet nên ẩn bằng "Nhóm hàng ẩn khỏi web".',
      'Giá trên web là giá bán của hàng hóa (Bảng giá chung). Khách không đặt được quá số lượng còn bán được ở kho web.',
    ],
    related: ['flash-sale', 'don-dat-tren-web'],
  },
  {
    slug: 'flash-sale',
    title: 'Tạo Flash Sale và bật / tắt chương trình',
    section: 'ban-online',
    when: 'Chạy giá sốc trong khung giờ ngắn trên web (vd 12h–14h), giới hạn số suất và số lượng mỗi đơn.',
    perms: ['Thiết lập web bán hàng, bật / tắt hiển thị giá và Flash Sale (online.manage)'],
    keywords: ['flash sale', 'giá sốc', 'khung giờ', 'đếm ngược', 'số suất', 'tối đa mỗi đơn', 'giảm giá', 'bật', 'tắt', 'khuyến mãi web'],
    steps: [
      { text: 'Vào menu Bán online → Flash Sale, bấm Tạo Flash Sale.' },
      { text: 'Nhập Tên chương trình và chọn Thời gian diễn ra (giờ bắt đầu → giờ kết thúc). Giữ "Bật chương trình" nếu muốn chạy theo giờ đã chọn.' },
      { text: 'Gõ tên / mã / mã vạch ở ô "Thêm hàng vào Flash Sale" để thêm hàng. Với mỗi hàng nhập Giá Flash Sale (hoặc % Giảm), Số suất và Tối đa / đơn (bỏ trống = không giới hạn).', note: 'Muốn giảm đồng loạt: nhập % ở ô Giảm phía trên rồi bấm Áp dụng tất cả (giá làm tròn nghìn).' },
      { text: 'Bấm Lưu. Trên web, dải FLASH SALE có đồng hồ đếm ngược hiện ở đầu trang khi tới giờ.' },
      { text: 'Tắt / bật nhanh từng chương trình bằng công tắc ở cột Bật trong danh sách. Muốn dừng toàn bộ Flash Sale trên web: tắt "Flash Sale" ở Thiết lập web bán hàng.' },
    ],
    notes: [
      'Giá Flash Sale phải thấp hơn giá bán. Khách đặt quá số suất còn lại hoặc quá tối đa mỗi đơn: phần vượt tính giá bán thường.',
      'Đơn bị hủy hoặc xóa trả lại suất cho chương trình. Sửa chương trình không được hạ số suất xuống dưới số đã bán.',
      'Flash Sale chỉ áp dụng cho đơn đặt trên web, không áp dụng khi bán tại quầy.',
    ],
    related: ['web-ban-hang', 'don-dat-tren-web'],
  },
  {
    slug: 'don-dat-tren-web',
    title: 'Xử lý đơn khách đặt trên web',
    section: 'ban-online',
    when: 'Có đơn mới từ web (số đỏ cạnh menu Bán online → Đơn đặt trên web).',
    perms: ['Xem đơn đặt hàng (order.view)', 'Xác nhận đơn (order.confirm), hoàn tất đơn → hóa đơn (order.complete), hủy đơn (order.cancel)'],
    keywords: ['đơn web', 'đơn online', 'Website', 'xác nhận đơn', 'giao hàng', 'phiếu tạm', 'tra cứu đơn'],
    steps: [
      { text: 'Vào Bán online → Đơn đặt trên web (hoặc Đơn hàng → Đặt hàng, lọc Nguồn đơn "Website"). Đơn mới ở trạng thái Phiếu tạm.' },
      { text: 'Mở đơn: ghi chú có tên người nhận, số điện thoại, địa chỉ giao. Dòng hàng giá Flash Sale ghi chú "Flash Sale: <tên chương trình>". Khách mới được tạo tự động theo số điện thoại.' },
      { text: 'Gọi khách xác nhận, sửa đơn nếu cần, rồi bấm Xác nhận (giữ tồn), tạo vận đơn và Hoàn tất → hóa đơn như đơn đặt hàng thường.' },
      { text: 'Khách hủy: bấm Hủy đơn – suất Flash Sale được trả lại.' },
    ],
    notes: ['Khách tra cứu trạng thái đơn trên web ở mục "Tra cứu đơn hàng" bằng mã đơn + số điện thoại đặt hàng.'],
    related: ['web-ban-hang', 'flash-sale'],
  },
];
