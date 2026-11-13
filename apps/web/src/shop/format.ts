// Hiển thị tên hàng / danh mục nhập từ KiotViet cho dễ đọc: bỏ VIẾT HOA TOÀN BỘ, tách thương hiệu đứng đầu tên ("COCOON - XÃ BƯỞI 310ML").

const VOWEL = /[aeiouyàáạảãâầấậẩẫăằắặẳẵèéẹẻẽêềếệểễìíịỉĩòóọỏõôồốộổỗơờớợởỡùúụủũưừứựửữỳýỵỷỹ]/i;
/** từ viết tắt giữ nguyên chữ hoa */
const KEEP = new Set(['SPF', 'PA', 'EDP', 'EDT', 'EDC', 'BB', 'CC', 'DD', 'UV', 'AHA', 'BHA', 'PHA', 'NMF', 'OEM', 'USA', 'UK', 'VN', 'DNA', 'PDRN', 'EGF', 'PH', 'HA', 'EX', 'II', 'III', 'IV', 'XL', 'XXL']);
/** viết tắt quen dùng của cửa hàng → chữ đầy đủ (chỉ khi đứng riêng thành một từ) */
const EXPAND: Record<string, string> = { KCN: 'Kem chống nắng', SRM: 'Sữa rửa mặt', TTBC: 'Tẩy tế bào chết', NTT: 'Nước tẩy trang', BTT: 'Bông tẩy trang' };
const UNIT = /^(\d+(?:[.,]\d+)?)(ML|G|GR|KG|L|MG|OZ|CM|MM|GB|V|W|VIÊN|MIẾNG|GÓI|CÁI)$/i;

const lettersOf = (s: string) => s.replace(/[^\p{L}]/gu, '');
const upperRatio = (s: string) => { const l = lettersOf(s); return l.length ? lettersOf(s.replace(/[^\p{Lu}]/gu, '')).length / l.length : 0; };
const cap = (w: string) => { const lower = w.toLocaleLowerCase('vi'); return lower.charAt(0).toLocaleUpperCase('vi') + lower.slice(1); };

/** Tên hàng viết hoa toàn bộ → Viết Hoa Đầu Từ, giữ mã / dung tích / từ viết tắt; tên đã viết thường-hoa thì để nguyên. */
export function smartCase(s: string): string {
  if (upperRatio(s) < 0.6) return s;
  return s.replace(/[\p{L}\p{N}][\p{L}\p{N}'’.+&]*/gu, (w) => {
    if (EXPAND[w]) return EXPAND[w];
    if (/\d/.test(w)) { const m = w.match(UNIT); return m ? `${m[1]}${m[2].toLocaleLowerCase('vi')}` : w; }
    if (w !== w.toLocaleUpperCase('vi')) return w;
    if (KEEP.has(w) || w.includes('.')) return w;
    if (w.length >= 2 && !VOWEL.test(w)) return w; // TFS, SRM, NW…
    return cap(w);
  });
}

/** Tách thương hiệu đứng đầu tên ("INTO YOU - SON SHERO 2g" → INTO YOU / Son Shero 2g); "NH …" ở đầu = nước hoa. */
export function splitName(name: string, brand?: string | null): { brand: string | null; title: string } {
  let b = brand?.trim() || null;
  let t = (name ?? '').trim();
  const m = t.match(/^(.{2,26}?)\s*[-–]\s+(.+)$/) ?? t.match(/^(.{2,26}?)\s+[-–]\s*(.+)$/);
  // "NH YSL LIBRE - EDP" là nước hoa YSL, không phải thương hiệu "NH YSL LIBRE"
  if (m && !/^NH\s/.test(m[1]) && m[1].trim().split(/\s+/).length <= 3 && !/\d{3,}/.test(m[1]) && upperRatio(m[1]) >= 0.6) { b = b ?? m[1].trim(); t = m[2].trim(); }
  // bỏ viết hoa trước rồi mới mở rộng chữ tắt đầu tên (NH / NHC không có nguyên âm nên vẫn giữ nguyên sau smartCase)
  t = smartCase(t).replace(/^\.?NHC\s+/, 'Nước hoa chiết ').replace(/^NH\s+/, 'Nước hoa ');
  return { brand: b, title: t };
}

/** Tên danh mục: "CHĂM SÓC DA MẶT" / "đồng hồ" → "Chăm sóc da mặt" / "Đồng hồ". */
export function catName(name: string): string {
  const n = (name ?? '').trim();
  const r = upperRatio(n);
  if (r >= 0.6 || r === 0) { const lower = n.toLocaleLowerCase('vi'); return lower.charAt(0).toLocaleUpperCase('vi') + lower.slice(1); }
  return n;
}

/** Số điện thoại dễ đọc: 0924888894 → 0924 888 894. */
export const prettyPhone = (p: string | null | undefined) => {
  const d = (p ?? '').replace(/\D/g, '');
  return d.length === 10 ? `${d.slice(0, 4)} ${d.slice(4, 7)} ${d.slice(7)}` : p ?? '';
};
