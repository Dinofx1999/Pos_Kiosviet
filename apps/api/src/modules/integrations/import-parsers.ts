import * as ExcelJS from 'exceljs';
import { Errors } from '../../common/errors/app-error';

/**
 * Parsing helpers for KiotViet exports (BR-130). Headers are matched case/diacritics-insensitively against alias lists so the
 * common export layouts ("Danh sách hàng hóa", "Danh sách khách hàng", "Nhà cung cấp", "Danh sách hóa đơn") map automatically;
 * the user can still override any column in the preview step.
 */
export type ImportEntity = 'PRODUCTS' | 'CUSTOMERS' | 'SUPPLIERS' | 'INVOICES';
export type RawRow = Record<string, string>;
export interface ParsedSheet { sheet: string; headers: string[]; rows: RawRow[]; headerRow: number }
export interface FieldSpec { key: string; label: string; aliases: string[]; required?: boolean }

export const normalizeHeader = (h: string) => h.normalize('NFD').replace(/[̀-ͯ]/g, '').replace(/đ/g, 'd').replace(/Đ/g, 'D').toLowerCase().replace(/\s+/g, ' ').replace(/[()\[\]:*#.]/g, ' ').replace(/\s+/g, ' ').trim();

export const FIELDS: Record<ImportEntity, FieldSpec[]> = {
  PRODUCTS: [
    { key: 'code', label: 'Mã hàng', aliases: ['ma hang', 'ma hang hoa', 'ma sp', 'ma san pham', 'code', 'sku'], required: true },
    { key: 'name', label: 'Tên hàng', aliases: ['ten hang', 'ten hang hoa', 'ten san pham', 'name'], required: true },
    { key: 'type', label: 'Loại hàng', aliases: ['loai hang', 'loai hang hoa', 'loai'] },
    { key: 'category', label: 'Nhóm hàng', aliases: ['nhom hang 3 cap', 'nhom hang', 'nhom hang hoa', 'danh muc', 'category'] },
    { key: 'brand', label: 'Thương hiệu', aliases: ['thuong hieu', 'brand', 'nhan hieu'] },
    { key: 'barcode', label: 'Mã vạch', aliases: ['ma vach', 'barcode', 'ma barcode'] },
    { key: 'unit', label: 'Đơn vị tính', aliases: ['dvt', 'don vi tinh', 'don vi', 'unit'] },
    { key: 'baseUnitCode', label: 'Mã ĐVT cơ bản', aliases: ['ma dvt co ban', 'ma hang co ban', 'ma hang goc'] },
    { key: 'conversion', label: 'Quy đổi', aliases: ['quy doi', 'gia tri quy doi', 'he so quy doi'] },
    { key: 'attributes', label: 'Thuộc tính', aliases: ['thuoc tinh', 'attributes'] },
    { key: 'sellPrice', label: 'Giá bán', aliases: ['gia ban', 'gia ban le', 'gia', 'price'] },
    { key: 'costPrice', label: 'Giá vốn', aliases: ['gia von', 'gia nhap', 'cost'] },
    { key: 'stock', label: 'Tồn kho', aliases: ['ton kho', 'ton', 'so luong ton', 'ton hien tai', 'stock'] },
    { key: 'minStock', label: 'Tồn nhỏ nhất', aliases: ['ton nho nhat', 'ton toi thieu', 'min stock'] },
    { key: 'maxStock', label: 'Tồn lớn nhất', aliases: ['ton lon nhat', 'ton toi da', 'max stock'] },
    { key: 'images', label: 'Hình ảnh', aliases: ['hinh anh url1 url2', 'hinh anh', 'anh', 'images', 'image'] },
    { key: 'weight', label: 'Trọng lượng', aliases: ['trong luong', 'weight'] },
    { key: 'isActive', label: 'Đang kinh doanh', aliases: ['dang kinh doanh', 'trang thai', 'kinh doanh'] },
    { key: 'allowSale', label: 'Được bán trực tiếp', aliases: ['duoc ban truc tiep', 'ban truc tiep'] },
    { key: 'description', label: 'Mô tả', aliases: ['mo ta', 'description', 'ghi chu'] },
    { key: 'taxRate', label: 'Thuế suất', aliases: ['thue suat', 'thue', 'vat', 'tax'] },
  ],
  CUSTOMERS: [
    { key: 'code', label: 'Mã khách hàng', aliases: ['ma khach hang', 'ma kh', 'ma khach', 'code'] },
    { key: 'name', label: 'Tên khách hàng', aliases: ['ten khach hang', 'ten kh', 'ten khach', 'khach hang', 'name'], required: true },
    { key: 'phone', label: 'Điện thoại', aliases: ['dien thoai', 'so dien thoai', 'sdt', 'phone', 'mobile'] },
    { key: 'email', label: 'Email', aliases: ['email'] },
    { key: 'address', label: 'Địa chỉ', aliases: ['dia chi', 'address'] },
    { key: 'ward', label: 'Phường/Xã', aliases: ['phuong xa', 'phuong', 'xa'] },
    { key: 'area', label: 'Khu vực', aliases: ['khu vuc', 'tinh thanh', 'quan huyen'] },
    { key: 'gender', label: 'Giới tính', aliases: ['gioi tinh', 'gender'] },
    { key: 'birthday', label: 'Ngày sinh', aliases: ['ngay sinh', 'sinh nhat', 'birthday'] },
    { key: 'groupName', label: 'Nhóm khách hàng', aliases: ['nhom khach hang', 'nhom kh', 'nhom', 'group'] },
    { key: 'taxCode', label: 'Mã số thuế', aliases: ['ma so thue', 'mst', 'tax code'] },
    { key: 'company', label: 'Công ty', aliases: ['cong ty', 'company'] },
    { key: 'note', label: 'Ghi chú', aliases: ['ghi chu', 'note'] },
    { key: 'debt', label: 'Nợ cần thu', aliases: ['no can thu hien tai', 'no can thu', 'cong no', 'no hien tai', 'debt'] },
    { key: 'points', label: 'Điểm', aliases: ['diem hien tai', 'diem', 'points'] },
    { key: 'isActive', label: 'Trạng thái', aliases: ['trang thai', 'status'] },
  ],
  SUPPLIERS: [
    { key: 'code', label: 'Mã nhà cung cấp', aliases: ['ma nha cung cap', 'ma ncc', 'code'] },
    { key: 'name', label: 'Tên nhà cung cấp', aliases: ['ten nha cung cap', 'ten ncc', 'nha cung cap', 'name'], required: true },
    { key: 'phone', label: 'Điện thoại', aliases: ['dien thoai', 'so dien thoai', 'sdt', 'phone'] },
    { key: 'email', label: 'Email', aliases: ['email'] },
    { key: 'address', label: 'Địa chỉ', aliases: ['dia chi', 'address'] },
    { key: 'taxCode', label: 'Mã số thuế', aliases: ['ma so thue', 'mst'] },
    { key: 'company', label: 'Công ty', aliases: ['cong ty', 'company'] },
    { key: 'groupName', label: 'Nhóm NCC', aliases: ['nhom ncc', 'nhom nha cung cap', 'nhom'] },
    { key: 'note', label: 'Ghi chú', aliases: ['ghi chu', 'note'] },
    { key: 'debt', label: 'Nợ cần trả', aliases: ['no can tra hien tai', 'no can tra', 'cong no', 'debt'] },
    { key: 'isActive', label: 'Trạng thái', aliases: ['trang thai', 'status'] },
  ],
  INVOICES: [
    { key: 'code', label: 'Mã hóa đơn', aliases: ['ma hoa don', 'ma hd', 'hoa don', 'invoice code'], required: true },
    { key: 'date', label: 'Thời gian', aliases: ['thoi gian', 'ngay', 'ngay ban', 'ngay tao', 'date'] },
    { key: 'customerCode', label: 'Mã khách hàng', aliases: ['ma khach hang', 'ma kh'] },
    { key: 'customerName', label: 'Khách hàng', aliases: ['khach hang', 'ten khach hang', 'ten khach'] },
    { key: 'branch', label: 'Chi nhánh', aliases: ['chi nhanh', 'branch'] },
    { key: 'seller', label: 'Người bán', aliases: ['nguoi ban', 'nhan vien ban hang', 'nhan vien'] },
    { key: 'subtotal', label: 'Tổng tiền hàng', aliases: ['tong tien hang', 'tien hang'] },
    { key: 'discount', label: 'Giảm giá', aliases: ['giam gia hoa don', 'giam gia hd', 'giam gia'] },
    { key: 'total', label: 'Khách cần trả', aliases: ['khach can tra', 'tong cong', 'tong thanh toan', 'total'] },
    { key: 'paid', label: 'Khách đã trả', aliases: ['khach da tra', 'da thanh toan', 'paid'] },
    { key: 'status', label: 'Trạng thái', aliases: ['trang thai', 'status'] },
    { key: 'note', label: 'Ghi chú', aliases: ['ghi chu', 'note'] },
    { key: 'lineCode', label: 'Mã hàng (dòng)', aliases: ['ma hang', 'ma hang hoa', 'ma sp'] },
    { key: 'lineName', label: 'Tên hàng (dòng)', aliases: ['ten hang', 'ten hang hoa'] },
    { key: 'lineQty', label: 'Số lượng', aliases: ['so luong', 'sl', 'quantity'] },
    { key: 'linePrice', label: 'Đơn giá', aliases: ['don gia', 'gia ban', 'price'] },
    { key: 'lineDiscount', label: 'Giảm giá (dòng)', aliases: ['giam gia dong', 'ck dong', 'giam gia sp'] },
    { key: 'lineTotal', label: 'Thành tiền', aliases: ['thanh tien', 'line total'] },
  ],
};

/** Reads the first worksheet that has a header row (≥ 3 non-empty cells) followed by data. */
export async function parseXlsx(buffer: Buffer, maxRows = 50000): Promise<ParsedSheet> {
  const wb = new ExcelJS.Workbook();
  try {
    await wb.xlsx.load(buffer as never);
  } catch (e) {
    throw Errors.validation(`Không đọc được file Excel (.xlsx): file hỏng hoặc sai định dạng — hãy xuất lại từ KiotViet dạng .xlsx (${(e as Error).message?.slice(0, 120) ?? 'lỗi không rõ'})`);
  }
  if (!wb.worksheets.length) throw Errors.validation('File Excel không có sheet nào');
  for (const ws of wb.worksheets) {
    let headerRow = 0; let headers: string[] = [];
    for (let r = 1; r <= Math.min(ws.rowCount, 15); r++) {
      const cells = cellValues(ws.getRow(r));
      if (cells.filter((c) => c).length >= 3) { headerRow = r; headers = cells; break; }
    }
    if (!headerRow) continue;
    const rows: RawRow[] = [];
    ws.eachRow((row, rowNo) => {
      if (rowNo <= headerRow || rows.length >= maxRows) return;
      const cells = cellValues(row);
      if (!cells.some((c) => c)) return;
      const obj: RawRow = { __row: String(rowNo) };
      headers.forEach((h, i) => { if (h) obj[h] = cells[i] ?? ''; });
      rows.push(obj);
    });
    if (rows.length) return { sheet: ws.name, headers: headers.filter(Boolean), rows, headerRow };
  }
  throw new Error('File không có dữ liệu (không tìm thấy dòng tiêu đề và dòng dữ liệu)');
}

function cellValues(row: ExcelJS.Row): string[] {
  const out: string[] = [];
  const count = Math.max(row.cellCount, (row.values as unknown[]).length - 1);
  for (let i = 1; i <= count; i++) {
    const v = row.getCell(i).value as unknown;
    out.push(cellToString(v));
  }
  return out;
}

export function cellToString(v: unknown): string {
  if (v === null || v === undefined) return '';
  if (v instanceof Date) return v.toISOString();
  if (typeof v === 'object') {
    const o = v as { richText?: Array<{ text: string }>; text?: string; result?: unknown; hyperlink?: string; formula?: string };
    if (o.richText) return o.richText.map((t) => t.text).join('').trim();
    if (o.text !== undefined) return String(o.text).trim();
    if (o.result !== undefined) return cellToString(o.result);
    if (o.hyperlink) return String(o.hyperlink);
    return '';
  }
  return String(v).trim();
}

/** header → field detection; returns { field: header } plus the headers that stayed unmapped and the required fields missing. */
export function detectMapping(headers: string[], entity: ImportEntity): { mapping: Record<string, string>; unmapped: string[]; missing: string[] } {
  const mapping: Record<string, string> = {};
  const used = new Set<string>();
  const norm = headers.map((h) => ({ h, n: normalizeHeader(h) }));
  for (const f of FIELDS[entity]) {
    // exact alias first, then alias as prefix (e.g. "Tồn kho (Kho chính)")
    let hit = norm.find((x) => !used.has(x.h) && f.aliases.includes(x.n));
    if (!hit) hit = norm.find((x) => !used.has(x.h) && f.aliases.some((a) => x.n.startsWith(a + ' ')));
    if (hit) { mapping[f.key] = hit.h; used.add(hit.h); }
  }
  return { mapping, unmapped: headers.filter((h) => !used.has(h)), missing: FIELDS[entity].filter((f) => f.required && !mapping[f.key]).map((f) => f.key) };
}

/** "1.234.567,89" / "1,234,567.89" / "1234567" / "-5.000" → decimal string; empty → null */
export function parseNumber(v: string | undefined | null): string | null {
  if (v === undefined || v === null) return null;
  let s = String(v).trim().replace(/\s/g, '').replace(/[₫đdVND]+$/i, '');
  if (!s || s === '-') return null;
  const neg = s.startsWith('-') || (s.startsWith('(') && s.endsWith(')'));
  s = s.replace(/[()\-+]/g, '');
  const lastDot = s.lastIndexOf('.'); const lastComma = s.lastIndexOf(',');
  if (lastDot >= 0 && lastComma >= 0) {
    // the later separator is the decimal one
    s = lastComma > lastDot ? s.replace(/\./g, '').replace(',', '.') : s.replace(/,/g, '');
  } else if (lastComma >= 0) {
    const parts = s.split(',');
    s = parts.length === 2 && parts[1].length !== 3 ? `${parts[0]}.${parts[1]}` : parts.join('');
  } else if (lastDot >= 0) {
    const parts = s.split('.');
    s = parts.length === 2 && parts[1].length !== 3 ? s : parts.join(''); // "5.000" is a thousands separator in Vietnamese exports
  }
  if (!/^\d+(\.\d+)?$/.test(s)) return null;
  return (neg ? '-' : '') + s.replace(/^0+(?=\d)/, '');
}

/** dd/MM/yyyy[ HH:mm[:ss]], yyyy-MM-dd, ISO, or an Excel serial number → Date | null */
export function parseDate(v: string | undefined | null): Date | null {
  if (!v) return null;
  const s = String(v).trim();
  let m = s.match(/^(\d{1,2})[/.-](\d{1,2})[/.-](\d{4})(?:[ T](\d{1,2}):(\d{2})(?::(\d{2}))?)?$/);
  if (m) return new Date(+m[3], +m[2] - 1, +m[1], +(m[4] ?? 0), +(m[5] ?? 0), +(m[6] ?? 0));
  m = s.match(/^(\d{4})-(\d{2})-(\d{2})(?:[ T](\d{1,2}):(\d{2})(?::(\d{2}))?)?/);
  if (m && !s.includes('Z') && !/[+-]\d{2}:\d{2}$/.test(s)) return new Date(+m[1], +m[2] - 1, +m[3], +(m[4] ?? 0), +(m[5] ?? 0), +(m[6] ?? 0));
  const d = new Date(s);
  if (!Number.isNaN(d.getTime())) return d;
  if (/^\d+(\.\d+)?$/.test(s)) { const serial = Number(s); if (serial > 20000 && serial < 80000) return new Date(Date.UTC(1899, 11, 30) + serial * 86400_000); }
  return null;
}

export const truthy = (v: string | undefined) => { const n = normalizeHeader(v ?? ''); return !n ? null : ['1', 'true', 'co', 'x', 'yes', 'dang kinh doanh', 'hoat dong', 'dang hoat dong', 'kich hoat'].includes(n) ? true : ['0', 'false', 'khong', 'no', 'ngung kinh doanh', 'ngung hoat dong', 'khoa'].includes(n) ? false : null; };
export const genderOf = (v: string | undefined) => { const n = normalizeHeader(v ?? ''); return n === 'nam' || n === 'male' ? 'MALE' : n === 'nu' || n === 'female' ? 'FEMALE' : n ? 'OTHER' : undefined; };
/** "Mỹ phẩm>>Chăm sóc da>>Serum" → ["Mỹ phẩm", "Chăm sóc da", "Serum"] */
export const categoryPath = (v: string | undefined) => (v ?? '').split(/>>|>|\/|\|/).map((p) => p.trim()).filter(Boolean);
export const splitList = (v: string | undefined) => (v ?? '').split(/[,;\n]/).map((p) => p.trim()).filter(Boolean);
export const safeCode = (v: string | undefined) => { const s = (v ?? '').trim().replace(/\s+/g, '-').replace(/[^A-Za-z0-9._/-]/g, ''); return s.slice(0, 50); };
