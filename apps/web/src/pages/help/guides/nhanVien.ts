import type { Guide } from './types';

export const NHAN_VIEN: Guide[] = [
  {
    slug: 'danh-sach-nhan-vien',
    title: 'Danh sách & hồ sơ nhân viên',
    section: 'nhan-vien',
    when: 'Quản lý chức vụ, ngày vào làm, lương cơ bản của nhân viên; xem nhanh chấm công và doanh số.',
    perms: ['Xem chấm công & hiệu suất của mọi nhân viên (attendance.view)', 'Hồ sơ nhân viên, quy tắc hoa hồng, sửa chấm công (employee.manage)'],
    keywords: ['employee', 'nhân sự', 'hồ sơ', 'chức vụ', 'lương cơ bản', 'ngày vào làm'],
    steps: [
      { text: 'Vào Nhân viên → Danh sách nhân viên. Mỗi nhân viên là một tài khoản người dùng kèm hồ sơ: Chức vụ, Vai trò, Chi nhánh, Liên hệ, Vào làm, Lương cơ bản, Đăng nhập cuối, Trạng thái (Đang làm việc / Đã khóa / Đã nghỉ).', shot: 'employees' },
      { text: 'Bấm Thêm nhân viên để tạo tài khoản + hồ sơ cùng lúc (tên đăng nhập, mật khẩu, vai trò, chi nhánh được phép, chức vụ, ngày vào làm, lương cơ bản, ghi chú).' },
      { text: 'Bấm Hồ sơ trên một dòng để xem / sửa; các nút Chấm công, Hoa hồng, Hiệu suất mở thẳng số liệu của nhân viên đó.' },
    ],
    notes: [
      'Sửa hồ sơ cần quyền Quản lý người dùng; Lương cơ bản chỉ người có quyền quản lý nhân viên thấy.',
      'Nhân viên bán được chọn trên từng hóa đơn (POS → Nhân viên bán); báo cáo doanh thu, hoa hồng, hiệu suất đều dựa trên nhân viên bán của hóa đơn.',
    ],
    related: ['nguoi-dung', 'cham-cong', 'hoa-hong', 'hieu-suat'],
  },
  {
    slug: 'cham-cong',
    title: 'Chấm công vào / ra bằng điện thoại',
    section: 'nhan-vien',
    when: 'Mỗi nhân viên tự chấm công đầu và cuối ca; quản lý sửa hoặc bổ sung lượt khi quên.',
    perms: ['Mọi nhân viên tự chấm công của mình', 'Hồ sơ nhân viên, quy tắc hoa hồng, sửa chấm công (employee.manage) để sửa giờ / thêm lượt'],
    keywords: ['attendance', 'timesheet', 'giờ công', 'GPS', 'check in', 'check out'],
    steps: [
      { text: 'Vào Nhân viên → Chấm công (điện thoại: Thêm → Chấm công). Chọn Chi nhánh, bật "Gửi kèm vị trí (GPS) khi chấm công" nếu cửa hàng yêu cầu.', shot: 'attendance' },
      { text: 'Bấm CHẤM CÔNG VÀO khi bắt đầu; màn hình hiện "Đang trong ca · vào lúc …". Cuối ca bấm CHẤM CÔNG RA (có thể ghi chú).' },
      { text: 'Tab Của tôi hiện Giờ công tháng này, Lượt tháng này, Trung bình / lượt và Lịch sử chấm công. Quản lý xem tab Toàn bộ nhân viên, biểu đồ Giờ công theo nhân viên.' },
      { text: 'Quản lý bấm Sửa giờ trên một lượt hoặc Thêm lượt (Nhân viên, Chi nhánh, Giờ vào, Giờ ra, Ghi chú) để bổ sung lượt quên chấm.' },
    ],
    notes: [
      'Mỗi người chỉ có một lượt đang mở tại một thời điểm; giờ ra phải sau giờ vào.',
      'Lượt do quản lý nhập có nguồn "Quản lý nhập" và được ghi nhật ký.',
    ],
    related: ['danh-sach-nhan-vien', 'hieu-suat', 'giao-dien-dien-thoai'],
  },
  {
    slug: 'hoa-hong',
    title: 'Quy tắc hoa hồng & báo cáo hoa hồng',
    section: 'nhan-vien',
    when: 'Trả hoa hồng theo doanh thu, lợi nhuận gộp hoặc số lượng bán – chung hoặc riêng từng nhân viên / nhóm hàng / mặt hàng.',
    perms: ['Hồ sơ nhân viên, quy tắc hoa hồng, sửa chấm công (employee.manage) để tạo quy tắc', 'Xem hoa hồng (commission.view)'],
    keywords: ['commission', 'hoa hồng', 'doanh số', 'thưởng', 'ngưỡng doanh thu'],
    steps: [
      { text: 'Vào Nhân viên → Hoa hồng → tab Quy tắc hoa hồng và bấm Thêm quy tắc.', shot: 'commissions' },
      { text: 'Nhập Tên quy tắc, Cơ sở tính (Doanh thu thuần %, Lợi nhuận gộp %, Số lượng bán – tiền / đơn vị), Mức; Phạm vi áp dụng – bỏ trống = tất cả (Nhân viên, Nhóm hàng, Hàng hóa cụ thể); Doanh thu tối thiểu (chỉ hưởng khi đạt ngưỡng trong kỳ), Ưu tiên, Thời gian hiệu lực, Đang áp dụng. Bấm Lưu.', shot: 'commission-rule-new' },
      { text: 'Tab Theo nhân viên: chọn kỳ để xem Hoa hồng kỳ này, Tổng hoa hồng, chi tiết theo nhân viên / theo quy tắc. Nhân viên xem tab Hoa hồng của tôi.' },
      { text: 'Chi trả hoa hồng bằng phiếu chi khác (loại "Lương / hoa hồng") ở Sổ quỹ.' },
    ],
    notes: [
      'Mỗi dòng bán gắn với quy tắc cụ thể nhất đang hiệu lực: nhân viên + hàng > nhân viên + nhóm hàng > nhân viên > hàng > nhóm hàng > chung; cùng mức thì Ưu tiên cao hơn thắng.',
      'Tính trên hóa đơn hoàn thành, trừ phần đã trả hàng; không tính hóa đơn lịch sử nhập từ KiotViet. Báo cáo không ghi sổ.',
    ],
    related: ['hieu-suat', 'phieu-thu-chi', 'bao-cao-doanh-thu'],
  },
  {
    slug: 'hieu-suat',
    title: 'Hiệu suất nhân viên',
    section: 'nhan-vien',
    when: 'Đánh giá nhân viên bán hàng theo kỳ: doanh thu, lợi nhuận, số ca, lệch tiền, giờ công, hoa hồng.',
    perms: ['Xem chấm công & hiệu suất của mọi nhân viên (attendance.view)'],
    keywords: ['performance', 'KPI', 'xếp hạng', 'doanh thu nhân viên', 'top nhân viên'],
    steps: [
      { text: 'Vào Nhân viên → Hiệu suất, chọn kỳ và chi nhánh.', shot: 'performance' },
      { text: 'Đọc các thẻ tổng: Nhân viên có doanh số, Doanh thu thuần, Lợi nhuận gộp, Hoa hồng; biểu đồ Top 5 nhân viên.' },
      { text: 'Bảng xếp hạng theo nhân viên: HĐ, Doanh thu, Trả hàng, DT thuần, LN gộp, Món, Khách, Giỏ TB, Ca, Chênh lệch quỹ, Giờ công, Hoa hồng. Chạm tiêu đề cột để sắp xếp.' },
    ],
    notes: ['Số liệu lấy theo nhân viên bán trên hóa đơn hoàn thành trong kỳ; giờ công từ chấm công; lệch tiền từ các ca đã đóng.'],
    related: ['hoa-hong', 'cham-cong', 'dong-ca', 'bao-cao-doanh-thu'],
  },
];
