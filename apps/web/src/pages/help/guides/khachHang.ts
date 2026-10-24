import type { Guide } from './types';

export const KHACH_HANG: Guide[] = [
  {
    slug: 'them-khach-hang',
    title: 'Thêm khách hàng & nhóm khách',
    section: 'khach-hang',
    when: 'Lưu hồ sơ khách để tích điểm, bán nợ, áp giá theo nhóm và xem lịch sử mua.',
    perms: ['Thêm / sửa khách hàng (customer.manage)'],
    keywords: ['customer', 'KH', 'khách', 'nhóm khách', 'VIP', 'hạn mức nợ', 'sinh nhật'],
    steps: [
      { text: 'Vào Đối tác → Khách hàng và bấm Thêm mới (hoặc thêm nhanh ngay tại POS).', shot: 'customers' },
      { text: 'Nhập Tên, Điện thoại, Email, Địa chỉ, Giới tính / Sinh nhật, Mã số thuế, Nhóm (chọn có sẵn hoặc gõ tên nhóm mới), Hạn mức nợ (trống = không giới hạn), Ghi chú. Mã khách hàng để trống sẽ tự sinh (KH000001).', shot: 'customer-new' },
      { text: 'Nếu khách đang nợ từ trước, nhập công nợ đầu kỳ. Bấm Lưu.' },
      { text: 'Bấm vào khách để xem Thông tin, Lịch sử mua hàng (hóa đơn, trả / đổi hàng), Công nợ; các nút Cập nhật, Ngừng giao dịch, Thu nợ.', shot: 'customer-detail' },
    ],
    notes: [
      'Nhóm khách hàng dùng để gắn bảng giá riêng và giới hạn khuyến mãi theo nhóm.',
      'Khách nhập từ KiotViet khớp theo mã (hoặc số điện thoại) – không tạo trùng khi nhập lại.',
    ],
    related: ['pos-khach-hang', 'cong-no-khach', 'bang-gia', 'sinh-nhat-khach', 'kiotviet-nhap-excel'],
  },
  {
    slug: 'cong-no-khach',
    title: 'Công nợ khách hàng & thu nợ',
    section: 'khach-hang',
    when: 'Khách mua chịu; cần xem ai đang nợ bao nhiêu và thu nợ (toàn bộ hoặc một phần).',
    perms: ['Xem công nợ khách hàng (customer.debt.view)', 'Lập phiếu thu / chi (payment.create)'],
    keywords: ['debt', 'công nợ', 'thu nợ', 'phải thu', 'hạn mức', 'phiếu thu', 'số dư có'],
    steps: [
      { text: 'Vào Báo cáo → Công nợ khách hàng: Tổng khách đang nợ, từng khách với Đã mua, Đã trả, Nợ hiện tại, Hạn mức.', shot: 'reports-customer-debt' },
      { text: 'Bấm Thu nợ ở dòng khách (hoặc mở hồ sơ khách → Thu nợ, hoặc Đối tác → Khách hàng → Thu nợ khách). Trong phiếu thu: chọn Phương thức, Quỹ tiền, Số tiền, Tham chiếu, Ghi chú.', shot: 'customer-detail' },
      { text: 'Phân bổ số tiền vào các hóa đơn còn nợ; phần chưa phân bổ là trả trước (số dư có). Bấm Lưu phiếu.' },
      { text: 'Tab Công nợ của khách là sổ công nợ: từng chứng từ (hóa đơn, phiếu thu, trả hàng, cọc) với Phát sinh và Dư nợ sau.' },
    ],
    notes: [
      'Công nợ dương = khách đang nợ; âm = khách có số dư có (do trả trước, trả hàng không hoàn tiền, cọc). Số dư có được cấn vào hóa đơn sau hoặc hoàn bằng phiếu chi.',
      'Bán nợ bị chặn khi vượt Hạn mức nợ. Phiếu thu đang phân bổ cho nhiều hóa đơn chỉ hủy được ở Sổ quỹ.',
    ],
    related: ['pos-thanh-toan', 'phieu-thu-chi', 'can-tru-cong-no', 'bao-cao-cong-no'],
  },
  {
    slug: 'diem-tich-luy',
    title: 'Điểm tích lũy: bật, tích điểm, dùng điểm',
    section: 'khach-hang',
    when: 'Muốn thưởng điểm cho khách thành viên theo số tiền mua và cho khách dùng điểm để thanh toán.',
    perms: ['Cấu hình doanh nghiệp (tenant.settings.manage) để bật', 'Điều chỉnh điểm tích lũy thủ công (loyalty.manage)'],
    keywords: ['loyalty', 'points', 'điểm thưởng', 'tích điểm', 'dùng điểm', 'thành viên'],
    steps: [
      { text: 'Vào Thiết lập cửa hàng → Tích điểm. Bật "Tích điểm khách hàng" và đặt: Cho mỗi số tiền thanh toán bằng tiền (vd 10.000 đ) → Số điểm tích được (vd 1), Giá trị 1 điểm khi sử dụng (vd 1.000 đ), Số điểm tối thiểu mỗi lần dùng, Tối đa % giá trị hóa đơn được trả bằng điểm (0 = chỉ tích, không cho dùng). Bấm Lưu.', shot: 'settings-loyalty' },
      { text: 'Tại POS, chọn khách hàng – khối Điểm tích lũy hiện số điểm đang có, số điểm được dùng tối đa và "Sẽ tích +… điểm cho khách khi thanh toán". Hóa đơn hoàn thành tự cộng điểm theo số tiền khách trả bằng tiền.' },
      { text: 'Dùng điểm: nhập số điểm vào ô Dùng điểm (hoặc bấm Dùng tối đa); dòng "Thanh toán bằng điểm" trừ vào Khách cần trả như một khoản thanh toán, phần còn lại thu bằng phương thức khác. Bấm Bỏ dùng điểm để hủy.' },
      { text: 'Trong hồ sơ khách (Đối tác → Khách hàng) tab Điểm tích lũy hiện Số dư hiện tại, Đã tích, Đã dùng và sổ điểm (Tích điểm, Dùng điểm, Điều chỉnh, Hủy / đảo). Người có quyền bấm Điều chỉnh điểm: chọn Cộng điểm / Trừ điểm, Số điểm, Lý do rồi Lưu điều chỉnh.', shot: 'customer-detail' },
    ],
    notes: [
      'Chỉ hóa đơn có khách hàng mới tích điểm. Điểm làm tròn xuống số nguyên.',
      'Trả bằng điểm là một phương thức thanh toán (không phải giảm giá): doanh thu giữ nguyên, không vào sổ quỹ / tiền mặt ca.',
      'Hủy hóa đơn đảo toàn bộ điểm của hóa đơn; trả hàng thu hồi điểm đã tích theo tỷ lệ tiền hoàn (số dư có thể âm nếu khách đã dùng).',
    ],
    related: ['pos-khach-hang', 'pos-thanh-toan', 'them-khach-hang', 'thiet-lap-cua-hang'],
  },
  {
    slug: 'sinh-nhat-khach',
    title: 'Chăm sóc khách: sinh nhật & khuyến mãi theo nhóm',
    section: 'khach-hang',
    when: 'Chúc mừng / tặng ưu đãi sinh nhật, ưu đãi riêng cho nhóm VIP.',
    perms: ['Xem khách hàng (customer.view)', 'Tạo / sửa khuyến mãi, phát hành voucher (promotion.manage)'],
    keywords: ['birthday', 'sinh nhật', 'CRM', 'chăm sóc', 'VIP', 'nhóm khách', 'voucher sinh nhật'],
    steps: [
      { text: 'Ghi Giới tính / Sinh nhật trong hồ sơ khách (Đối tác → Khách hàng → Cập nhật) để lọc được khách có sinh nhật trong tháng.', shot: 'customer-new' },
      { text: 'Tạo khuyến mãi dành riêng: Hàng hóa → Khuyến mãi → Thêm khuyến mãi, chọn Nhóm khách hàng (vd VIP) trong "Thời gian & phạm vi áp dụng", đặt Lượt / khách hàng = 1 nếu chỉ tặng một lần.', shot: 'promotion-new' },
      { text: 'Hoặc phát hành voucher "Dành riêng cho khách" (mục Voucher của chương trình loại Voucher) và gửi mã cho khách.' },
      { text: 'Khi khách đến mua, chọn đúng khách tại POS để khuyến mãi / voucher / điểm được áp dụng.' },
    ],
    notes: ['Khuyến mãi theo nhóm khách chỉ áp dụng khi hóa đơn có chọn khách thuộc nhóm; khách lẻ chỉ nhận khuyến mãi không giới hạn nhóm.'],
    related: ['them-khach-hang', 'khuyen-mai', 'voucher', 'diem-tich-luy'],
  },
];
