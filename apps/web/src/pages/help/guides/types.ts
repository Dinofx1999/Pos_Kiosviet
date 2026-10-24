/** Plain-data model for the in-app user guide ("Hướng dẫn sử dụng"). Content modules live next to this file. */

export type SectionKey =
  | 'bat-dau'
  | 'hang-hoa'
  | 'kho'
  | 'mua-hang'
  | 'ban-hang'
  | 'khach-hang'
  | 'so-quy'
  | 'nhan-vien'
  | 'bao-cao'
  | 'kiotviet'
  | 'goi-dich-vu';

export interface Section {
  key: SectionKey;
  title: string;
  /** One line shown under the section title on the index page. */
  blurb: string;
}

export interface GuideStep {
  /** One clear action sentence. */
  text: string;
  /** Optional extra hint shown under the step. */
  note?: string;
  /** Screenshot base name; files are `/guide/<shot>-desktop.jpg` and `/guide/<shot>-mobile.jpg`. */
  shot?: string;
  /** Optional caption shown under the screenshot. */
  caption?: string;
}

export interface Guide {
  slug: string;
  title: string;
  section: SectionKey;
  /** "Dùng khi nào" – when the shop owner / cashier needs this. */
  when: string;
  /** Required permissions, in words (as shown in Vai trò & phân quyền). */
  perms: string[];
  /** Extra search words (accent-insensitive match is applied automatically). */
  keywords?: string[];
  steps: GuideStep[];
  /** "Lưu ý" callouts drawn from the business rules. */
  notes?: string[];
  /** Slugs of related guides ("Xem thêm"). */
  related?: string[];
}
