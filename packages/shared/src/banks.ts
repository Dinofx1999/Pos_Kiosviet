/**
 * Ngân hàng hỗ trợ tạo VietQR qua qr.sepay.vn (danh sách `supported: true` từ https://qr.sepay.vn/banks.json, 25/10/2026).
 * `shortName` là giá trị tham số `bank` của ảnh QR: https://qr.sepay.vn/img?acc=…&bank=<shortName>&amount=…&des=…
 */
export interface VietQrBank { shortName: string; code: string; bin: string; name: string }
export const VIETQR_BANKS: readonly VietQrBank[] = [
  { shortName: "VietinBank", code: "ICB", bin: "970415", name: "Ngân hàng TMCP Công thương Việt Nam" },
  { shortName: "Vietcombank", code: "VCB", bin: "970436", name: "Ngân hàng TMCP Ngoại Thương Việt Nam" },
  { shortName: "MBBank", code: "MB", bin: "970422", name: "Ngân hàng TMCP Quân đội" },
  { shortName: "ACB", code: "ACB", bin: "970416", name: "Ngân hàng TMCP Á Châu" },
  { shortName: "VPBank", code: "VPB", bin: "970432", name: "Ngân hàng TMCP Việt Nam Thịnh Vượng" },
  { shortName: "TPBank", code: "TPB", bin: "970423", name: "Ngân hàng TMCP Tiên Phong" },
  { shortName: "MSB", code: "MSB", bin: "970426", name: "Ngân hàng TMCP Hàng Hải Việt Nam" },
  { shortName: "LienVietPostBank", code: "LPB", bin: "970449", name: "Ngân hàng TMCP Lộc Phát Việt Nam" },
  { shortName: "VietCapitalBank", code: "VCCB", bin: "970454", name: "Ngân hàng TMCP Bản Việt" },
  { shortName: "BIDV", code: "BIDV", bin: "970418", name: "Ngân hàng TMCP Đầu tư và Phát triển Việt Nam" },
  { shortName: "Sacombank", code: "STB", bin: "970403", name: "Ngân hàng TMCP Sài Gòn Tài Lộc" },
  { shortName: "VIB", code: "VIB", bin: "970441", name: "Ngân hàng TMCP Quốc tế Việt Nam" },
  { shortName: "HDBank", code: "HDB", bin: "970437", name: "Ngân hàng TMCP Phát triển Thành phố Hồ Chí Minh" },
  { shortName: "SeABank", code: "SEAB", bin: "970440", name: "Ngân hàng TMCP Đông Nam Á" },
  { shortName: "ShinhanBank", code: "SHBVN", bin: "970424", name: "Ngân hàng TNHH MTV Shinhan Việt Nam" },
  { shortName: "Agribank", code: "VBA", bin: "970405", name: "Ngân hàng Nông nghiệp và Phát triển Nông thôn Việt Nam" },
  { shortName: "Techcombank", code: "TCB", bin: "970407", name: "Ngân hàng TMCP Kỹ thương Việt Nam" },
  { shortName: "BacABank", code: "BAB", bin: "970409", name: "Ngân hàng TMCP Bắc Á" },
  { shortName: "ABBANK", code: "ABB", bin: "970425", name: "Ngân hàng TMCP An Bình" },
  { shortName: "Eximbank", code: "EIB", bin: "970431", name: "Ngân hàng TMCP Xuất Nhập khẩu Việt Nam" },
  { shortName: "PublicBank", code: "PBVN", bin: "970439", name: "Ngân hàng TNHH MTV Public Việt Nam" },
  { shortName: "OCB", code: "OCB", bin: "970448", name: "Ngân hàng TMCP Phương Đông" },
  { shortName: "KienLongBank", code: "KLB", bin: "970452", name: "Ngân hàng TMCP Kiên Long" },
] as const;

/** Ảnh VietQR (PNG) của SePay cho một khoản chuyển khoản. */
export function sepayQrUrl(p: { bankCode: string; accountNumber: string; amount?: string | number | null; content?: string | null; template?: 'compact' | 'qronly' | '' }) {
  const q = new URLSearchParams({ acc: p.accountNumber, bank: p.bankCode });
  if (p.amount !== undefined && p.amount !== null && Number(p.amount) > 0) q.set('amount', String(Math.round(Number(p.amount))));
  if (p.content) q.set('des', p.content);
  q.set('template', p.template ?? 'compact');
  return `https://qr.sepay.vn/img?${q.toString()}`;
}
