import dayjs from 'dayjs';
import type { BuyXGetYConfig, InvoiceDiscountConfig, InvoiceGiftConfig, ProductDiscountConfig, Promotion, PromotionType, VoucherConfig } from '../../api/promotions';
import { money, qty, toNum } from '../../utils/format';

/** id → display name resolvers (variants from the detail endpoint, categories from the catalog). */
export interface NameLookup { variant?: (id: string) => string | undefined; category?: (id: string) => string | undefined }

export const DAY_LABELS = ['CN', 'T2', 'T3', 'T4', 'T5', 'T6', 'T7'];

const resolveNames = (ids: string[] | undefined, get: ((id: string) => string | undefined) | undefined, unit: string, max = 3): { text: string; resolved: boolean } => {
  if (!ids?.length) return { text: '', resolved: false };
  const names = ids.map((id) => get?.(id)).filter((x): x is string => !!x);
  if (names.length !== ids.length) return { text: `${ids.length} ${unit}`, resolved: false };
  return { text: names.length > max ? `${names.slice(0, max).join(', ')} +${names.length - max}` : names.join(', '), resolved: true };
};
const joinNames = (ids: string[] | undefined, get: ((id: string) => string | undefined) | undefined, unit: string, max = 3): string => resolveNames(ids, get, unit, max).text;
/** "2 Serum X" when the names are known, otherwise "2 SP (3 hàng hóa)". */
const qtyNames = (q: string | undefined, ids: string[] | undefined, get: ((id: string) => string | undefined) | undefined, unit: string): string => {
  const r = resolveNames(ids, get, unit);
  if (!r.text) return `${qty(q)} ${unit}`;
  return r.resolved ? `${qty(q)} ${r.text}` : `${qty(q)} SP (${r.text})`;
};

export function targetsText(t: { variantIds?: string[]; categoryIds?: string[] }, lookup?: NameLookup): string {
  const v = joinNames(t.variantIds, lookup?.variant, 'hàng hóa');
  const c = joinNames(t.categoryIds, lookup?.category, 'nhóm hàng');
  if (v && c) return `${v}; nhóm ${c}`;
  if (c) return `nhóm ${c}`;
  return v;
}

export function rewardText(r: { discountPercent?: string; discountAmount?: string; fixedPrice?: string; maxDiscount?: string }, perUnit = false): string {
  if (r.discountPercent !== undefined) return `giảm ${toNum(r.discountPercent)}%${r.maxDiscount ? ` (tối đa ${money(r.maxDiscount)})` : ''}`;
  if (r.discountAmount !== undefined) return `giảm ${money(r.discountAmount)}${perUnit ? '/SP' : ''}${r.maxDiscount ? ` (tối đa ${money(r.maxDiscount)})` : ''}`;
  if (r.fixedPrice !== undefined) return `đồng giá ${money(r.fixedPrice)}`;
  return '';
}

/** Plain-language summary of a promotion's conditions and reward, e.g. "Mua 2 Serum X tặng 1 Mask Y, tối đa 3 lần". */
export function describePromotion(p: { type: PromotionType; config: unknown }, lookup?: NameLookup): string {
  const c = (p.config ?? {}) as Record<string, unknown>;
  switch (p.type) {
    case 'INVOICE_DISCOUNT': {
      const tiers = [...((c as unknown as InvoiceDiscountConfig).tiers ?? [])].sort((a, b) => toNum(a.minTotal) - toNum(b.minTotal));
      return tiers.map((t) => `Hóa đơn từ ${money(t.minTotal)} ${rewardText(t)}`).join('; ');
    }
    case 'INVOICE_GIFT': {
      const tiers = [...((c as unknown as InvoiceGiftConfig).tiers ?? [])].sort((a, b) => toNum(a.minTotal) - toNum(b.minTotal));
      return tiers.map((t) => `Hóa đơn từ ${money(t.minTotal)} tặng ${t.gifts.map((g) => `${qty(g.quantity)} ${lookup?.variant?.(g.variantId) ?? 'SP (hàng tặng)'}`).join(', ')}`).join('; ');
    }
    case 'PRODUCT_DISCOUNT': {
      const x = c as unknown as ProductDiscountConfig;
      const parts = [`${rewardText(x, x.discountAmount !== undefined).replace(/^./, (ch) => ch.toUpperCase())} cho ${targetsText(x, lookup) || 'hàng áp dụng'}`];
      if (x.minQuantity && toNum(x.minQuantity) > 1) parts.push(`mua từ ${qty(x.minQuantity)}`);
      if (x.maxQuantity) parts.push(`tối đa ${qty(x.maxQuantity)} SP/dòng`);
      return parts.join(', ');
    }
    case 'BUY_X_GET_Y': {
      const x = c as unknown as BuyXGetYConfig;
      const percent = x.get?.discountPercent !== undefined ? toNum(x.get.discountPercent) : 100;
      const buyCats = joinNames(x.buy?.categoryIds, lookup?.category, 'nhóm hàng');
      const buyText = x.buy?.variantIds?.length ? qtyNames(x.buy.quantity, x.buy.variantIds, lookup?.variant, 'hàng hóa') + (buyCats ? ` hoặc nhóm ${buyCats}` : '') : `${qty(x.buy?.quantity)} SP nhóm ${buyCats || 'hàng áp dụng'}`;
      const parts = [`Mua ${buyText} ${percent >= 100 ? 'tặng' : `giảm ${percent}%`} ${qtyNames(x.get?.quantity, x.get?.variantIds, lookup?.variant, 'hàng tặng')}`];
      if (x.maxRepeats) parts.push(`tối đa ${x.maxRepeats} lần`);
      if (x.applyToCart === false) parts.push('chỉ tặng khi thêm quà');
      return parts.join(', ');
    }
    case 'VOUCHER': {
      const x = c as unknown as VoucherConfig;
      const parts = [`Voucher ${rewardText(x)}`];
      if (x.minTotal && toNum(x.minTotal) > 0) parts.push(`cho hóa đơn từ ${money(x.minTotal)}`);
      const t = targetsText(x, lookup);
      if (t) parts.push(`áp dụng cho ${t}`);
      return parts.join(' ');
    }
    default: return '';
  }
}

export type PromoStatusKey = 'RUNNING' | 'UPCOMING' | 'EXPIRED' | 'EXHAUSTED' | 'INACTIVE';
export const PROMO_STATUS_LABEL: Record<PromoStatusKey, string> = { RUNNING: 'Đang chạy', UPCOMING: 'Sắp diễn ra', EXPIRED: 'Hết hạn', EXHAUSTED: 'Hết lượt', INACTIVE: 'Ngừng' };
export const PROMO_STATUS_COLOR: Record<PromoStatusKey, string> = { RUNNING: 'green', UPCOMING: 'blue', EXPIRED: 'volcano', EXHAUSTED: 'orange', INACTIVE: 'default' };

export function promotionStatus(p: Pick<Promotion, 'status' | 'startsAt' | 'endsAt' | 'usageLimit' | 'usageCount'>): PromoStatusKey {
  if (p.status !== 'ACTIVE') return 'INACTIVE';
  const now = Date.now();
  if (p.startsAt && new Date(p.startsAt).getTime() > now) return 'UPCOMING';
  if (p.endsAt && new Date(p.endsAt).getTime() < now) return 'EXPIRED';
  if (p.usageLimit !== null && p.usageLimit !== undefined && p.usageCount >= p.usageLimit) return 'EXHAUSTED';
  return 'RUNNING';
}

/** "01/11/2026 → 30/11/2026 · T2, T4, T6 · 18:00–21:00" (empty = always). */
export function scheduleText(p: Pick<Promotion, 'startsAt' | 'endsAt' | 'daysOfWeek' | 'timeFrom' | 'timeTo'>): string {
  const parts: string[] = [];
  if (p.startsAt || p.endsAt) parts.push(`${p.startsAt ? dayjs(p.startsAt).format('DD/MM/YYYY') : '…'} → ${p.endsAt ? dayjs(p.endsAt).format('DD/MM/YYYY') : '…'}`);
  if (p.daysOfWeek?.length && p.daysOfWeek.length < 7) parts.push([...p.daysOfWeek].sort((a, b) => (a === 0 ? 7 : a) - (b === 0 ? 7 : b)).map((d) => DAY_LABELS[d]).join(', '));
  if (p.timeFrom || p.timeTo) parts.push(`${p.timeFrom ?? '00:00'}–${p.timeTo ?? '23:59'}`);
  return parts.join(' · ') || 'Không giới hạn thời gian';
}

/** Numbers → decimal strings accepted by the API (no exponent notation, ≤ 6 decimals). */
export const dec = (n: number | null | undefined): string | undefined => (n === null || n === undefined || !Number.isFinite(n) ? undefined : String(Math.round(n * 1e6) / 1e6));
