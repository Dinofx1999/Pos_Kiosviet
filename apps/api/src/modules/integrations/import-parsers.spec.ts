import { parseDate } from './import-parsers';

/** Ngày giờ theo giờ Việt Nam để so sánh, bất kể múi giờ của máy chạy test. */
const vn = (d: Date | null) => (d ? new Date(d.getTime() + 7 * 3600_000).toISOString().slice(0, 16).replace('T', ' ') : null);

describe('parseDate – ngày trong file KiotViet', () => {
  it('số ngày Excel chỉ có ngày (ngày sinh) → đúng ngày, 12:00 giờ VN, không bị hiểu thành năm', () => {
    expect(vn(parseDate('36027'))).toBe('1998-08-20 12:00');
    expect(vn(parseDate('14611'))).toBe('1940-01-01 12:00');
  });
  it('số ngày Excel có giờ (thời gian hóa đơn) → giờ Việt Nam', () => {
    expect(vn(parseDate('46320.45655092593'))).toBe('2026-10-25 10:57');
    expect(vn(parseDate('46320'))).toBe('2026-10-25 12:00');
  });
  it('dạng chữ dd/mm/yyyy và ISO vẫn đọc như cũ; giá trị vô lý → null', () => {
    expect(parseDate('20/08/1998')?.getFullYear()).toBe(1998);
    expect(parseDate('2026-10-25 10:30')?.getMonth()).toBe(9);
    expect(parseDate('99999999')).toBeNull();
    expect(parseDate('abc')).toBeNull();
    expect(parseDate('')).toBeNull();
  });
});
