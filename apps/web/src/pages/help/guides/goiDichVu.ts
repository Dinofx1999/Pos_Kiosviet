import type { Guide } from './types';

export const GOI_DICH_VU: Guide[] = [
  {
    slug: 'goi-dich-vu',
    title: 'Gói dịch vụ, hạn mức & dùng thử',
    section: 'goi-dich-vu',
    when: 'Muốn biết gian hàng đang ở gói nào, còn bao nhiêu ngày dùng thử, vì sao không thêm được chi nhánh / người dùng / hàng hóa.',
    perms: ['Xem gói dịch vụ & hạn mức (subscription.view)'],
    keywords: ['plan', 'subscription', 'FREE', 'BASIC', 'PRO', 'ENTERPRISE', 'hạn mức', 'dùng thử', 'hết hạn', 'chỉ đọc', 'nâng cấp'],
    steps: [
      { text: 'Vào Thiết lập cửa hàng → Gói dịch vụ. Thẻ "Gói dịch vụ hiện tại" cho biết gói (FREE / BASIC / PRO / ENTERPRISE), trạng thái (Dùng thử, Đang hoạt động, Tạm ngưng), số ngày dùng thử còn lại hoặc ngày hết hạn.', shot: 'settings-subscription' },
      { text: '"Mức sử dụng so với hạn mức" cho thấy Chi nhánh, Kho hàng, Người dùng, Hàng hóa đang dùng bao nhiêu trên hạn mức (chỉ đếm chi nhánh / kho / người dùng đang hoạt động và hàng hóa chưa xóa). "So sánh các gói" liệt kê hạn mức của từng gói.' },
      { text: 'Khi chạm hạn mức, thao tác thêm mới báo lỗi vượt hạn mức: ngừng hoạt động bản ghi không dùng (chi nhánh, kho, người dùng, hàng hóa) hoặc liên hệ nhà cung cấp phần mềm để nâng gói.' },
    ],
    notes: [
      'Đăng ký mới = dùng thử 30 ngày gói FREE. Hết hạn dùng thử, hoặc gói trả phí quá hạn hơn 7 ngày → gian hàng chuyển sang chỉ đọc: vẫn xem được mọi dữ liệu và báo cáo nhưng không tạo / sửa / hủy được chứng từ.',
      'Gian hàng Tạm ngưng / Đã đóng không đăng nhập được – liên hệ nhà cung cấp phần mềm.',
      'Việc đổi gói / gia hạn do quản trị nền tảng thực hiện; mọi thay đổi gói được ghi nhật ký của gian hàng.',
    ],
    related: ['chi-nhanh-kho', 'nguoi-dung', 'them-hang-hoa', 'dang-nhap'],
  },
];
