import { Prisma } from '@prisma/client';
import { D, money, qty as toQty, ZERO } from '../../common/utils/decimal';

/**
 * Pure promotion engine (BR-90..BR-96). No I/O: the caller loads the eligible promotion definitions, the optional voucher and the
 * cart, and persists the result. Deterministic: promotions are evaluated in (priority desc, createdAt asc) order; a non-stackable
 * promotion is applied only when nothing else has been applied yet, and once applied it ends the evaluation.
 */
export type PromoType = 'INVOICE_DISCOUNT' | 'INVOICE_GIFT' | 'PRODUCT_DISCOUNT' | 'BUY_X_GET_Y' | 'VOUCHER';

export interface Targets { variantIds?: string[]; categoryIds?: string[] }
export interface InvoiceDiscountTier { minTotal: string; discountPercent?: string; discountAmount?: string; maxDiscount?: string }
export interface InvoiceGiftTier { minTotal: string; gifts: Array<{ variantId: string; quantity: string }> }
export interface InvoiceDiscountConfig { tiers: InvoiceDiscountTier[] }
export interface InvoiceGiftConfig { tiers: InvoiceGiftTier[] }
export interface ProductDiscountConfig extends Targets { minQuantity?: string; maxQuantity?: string; discountPercent?: string; discountAmount?: string; fixedPrice?: string; maxDiscount?: string }
export interface BuyXGetYConfig { buy: Targets & { quantity: string }; get: { variantIds: string[]; quantity: string; discountPercent?: string }; maxRepeats?: number; applyToCart?: boolean }
export interface VoucherConfig extends Targets { discountPercent?: string; discountAmount?: string; maxDiscount?: string; minTotal?: string }
export type PromoConfig = InvoiceDiscountConfig | InvoiceGiftConfig | ProductDiscountConfig | BuyXGetYConfig | VoucherConfig;

export interface PromoDef {
  id: string; code: string; name: string; type: PromoType; priority: number; stackable: boolean; config: PromoConfig;
  startsAt: Date | null; endsAt: Date | null; daysOfWeek: number[]; timeFrom: string | null; timeTo: string | null;
  customerGroups: string[]; branchIds: string[]; usageLimit: number | null; usageCount: number; perCustomerLimit: number | null; customerUses: number;
  createdAt: Date;
}
export interface PromoVoucher { id: string; code: string; promotionId: string; status: string; maxUses: number; usedCount: number; customerId: string | null; expiresAt: Date | null }
export interface PromoLine { key: string; variantId: string; categoryId: string | null; quantity: Prisma.Decimal; unitPrice: Prisma.Decimal; manualDiscount: Prisma.Decimal; isGift: boolean; giftPromotionId: string | null }
export interface PromoContext { now: Date; branchId: string; customerId: string | null; customerGroup: string | null; voucher: PromoVoucher | null; voucherCode: string | null; excludeIds: Set<string> }

export interface AppliedPromotion { promotionId: string; code: string; name: string; type: PromoType; amount: Prisma.Decimal; giftQuantity: Prisma.Decimal; voucherId: string | null }
export interface GiftOffer { promotionId: string; code: string; name: string; variantIds: string[]; quantity: Prisma.Decimal; claimed: Prisma.Decimal; discountPercent: Prisma.Decimal }
export interface PromoResult {
  lineDiscounts: Map<string, { promotionId: string; amount: Prisma.Decimal }>;
  invoiceDiscount: Prisma.Decimal;
  applied: AppliedPromotion[];
  gifts: GiftOffer[];
  /** validation problems the caller must surface (gift line not granted, voucher invalid) */
  errors: Array<{ code: string; message: string; details?: Record<string, unknown> }>;
}

const pct = (v: string | undefined) => (v === undefined ? null : D(v));
const inTargets = (t: Targets, line: { variantId: string; categoryId: string | null }) => {
  const v = t.variantIds ?? []; const c = t.categoryIds ?? [];
  if (!v.length && !c.length) return true;
  return v.includes(line.variantId) || (!!line.categoryId && c.includes(line.categoryId));
};
const hhmm = (d: Date) => `${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`;

/** Why a promotion is not available right now (null = eligible). */
export function ineligibleReason(def: PromoDef, ctx: PromoContext): string | null {
  if (ctx.excludeIds.has(def.id)) return 'EXCLUDED';
  if (def.startsAt && def.startsAt > ctx.now) return 'NOT_STARTED';
  if (def.endsAt && def.endsAt < ctx.now) return 'EXPIRED';
  if (def.daysOfWeek.length && !def.daysOfWeek.includes(ctx.now.getDay())) return 'DAY';
  if (def.timeFrom || def.timeTo) {
    const t = hhmm(ctx.now);
    const from = def.timeFrom ?? '00:00'; const to = def.timeTo ?? '23:59';
    const ok = from <= to ? t >= from && t <= to : t >= from || t <= to; // overnight windows
    if (!ok) return 'TIME';
  }
  if (def.branchIds.length && !def.branchIds.includes(ctx.branchId)) return 'BRANCH';
  if (def.customerGroups.length && (!ctx.customerGroup || !def.customerGroups.includes(ctx.customerGroup))) return 'CUSTOMER_GROUP';
  if (def.usageLimit !== null && def.usageCount >= def.usageLimit) return 'USAGE_LIMIT';
  if (def.perCustomerLimit !== null && ctx.customerId && def.customerUses >= def.perCustomerLimit) return 'CUSTOMER_LIMIT';
  if (def.type === 'VOUCHER' && (!ctx.voucher || ctx.voucher.promotionId !== def.id)) return 'VOUCHER_REQUIRED';
  return null;
}

export function voucherProblem(v: PromoVoucher, ctx: PromoContext): string | null {
  if (v.status === 'DISABLED') return 'Voucher đã bị khóa';
  if (v.status === 'USED' || v.usedCount >= v.maxUses) return 'Voucher đã được sử dụng hết';
  if (v.expiresAt && v.expiresAt < ctx.now) return 'Voucher đã hết hạn';
  if (v.customerId && v.customerId !== ctx.customerId) return 'Voucher chỉ dành cho một khách hàng khác';
  return null;
}

export function evaluatePromotions(defsIn: PromoDef[], lines: PromoLine[], ctx: PromoContext): PromoResult {
  const result: PromoResult = { lineDiscounts: new Map(), invoiceDiscount: ZERO, applied: [], gifts: [], errors: [] };
  const defs = [...defsIn].sort((a, b) => b.priority - a.priority || a.createdAt.getTime() - b.createdAt.getTime() || (a.id < b.id ? -1 : 1));
  const lineNet = (l: PromoLine) => money(l.quantity.times(l.unitPrice)).minus(l.manualDiscount).minus(result.lineDiscounts.get(l.key)?.amount ?? ZERO);
  const giftClaimed = new Map<string, Prisma.Decimal>(); // line key → claimed qty
  let closed = false; // a non-stackable promotion ended the evaluation

  if (ctx.voucherCode && !ctx.voucher) result.errors.push({ code: 'VOUCHER_INVALID', message: 'Mã voucher không tồn tại', details: { code: ctx.voucherCode } });
  if (ctx.voucher) { const p = voucherProblem(ctx.voucher, ctx); if (p) result.errors.push({ code: 'VOUCHER_INVALID', message: p, details: { code: ctx.voucher.code } }); }

  for (const def of defs) {
    if (closed) break;
    if (ineligibleReason(def, ctx)) continue;
    if (def.type === 'VOUCHER' && result.errors.some((e) => e.code === 'VOUCHER_INVALID')) continue;
    if (!def.stackable && result.applied.length) continue;
    let amount = ZERO; let giftQty = ZERO; let voucherId: string | null = null;

    if (def.type === 'PRODUCT_DISCOUNT') {
      const c = def.config as ProductDiscountConfig;
      const minQ = c.minQuantity ? D(c.minQuantity) : D(0);
      for (const l of lines) {
        if (l.isGift || result.lineDiscounts.has(l.key) || !inTargets(c, l) || l.quantity.lessThan(minQ)) continue;
        const units = c.maxQuantity ? Prisma.Decimal.min(l.quantity, D(c.maxQuantity)) : l.quantity;
        let d = ZERO;
        if (c.discountPercent) d = l.unitPrice.times(units).times(D(c.discountPercent)).dividedBy(100);
        else if (c.discountAmount) d = D(c.discountAmount).times(units);
        else if (c.fixedPrice !== undefined) d = Prisma.Decimal.max(ZERO, l.unitPrice.minus(D(c.fixedPrice))).times(units);
        if (c.maxDiscount) d = Prisma.Decimal.min(d, D(c.maxDiscount));
        d = money(Prisma.Decimal.min(d, lineNet(l)));
        if (d.greaterThan(0)) { result.lineDiscounts.set(l.key, { promotionId: def.id, amount: d }); amount = amount.plus(d); }
      }
    } else if (def.type === 'BUY_X_GET_Y') {
      const c = def.config as BuyXGetYConfig;
      const buyQty = lines.filter((l) => !l.isGift && inTargets(c.buy, l)).reduce((s, l) => s.plus(l.quantity), ZERO);
      let repeats = buyQty.dividedBy(D(c.buy.quantity)).floor();
      if (c.maxRepeats !== undefined && c.maxRepeats !== null) repeats = Prisma.Decimal.min(repeats, D(c.maxRepeats));
      const free = toQty(repeats.times(D(c.get.quantity)));
      if (free.greaterThan(0)) {
        const percent = pct(c.get.discountPercent) ?? D(100);
        let remaining = free;
        // 1) gift lines claiming this promotion
        for (const l of lines.filter((x) => x.isGift && x.giftPromotionId === def.id && c.get.variantIds.includes(x.variantId))) {
          const take = Prisma.Decimal.min(remaining, l.quantity);
          if (take.lessThanOrEqualTo(0)) continue;
          const d = money(l.unitPrice.times(take).times(percent).dividedBy(100));
          result.lineDiscounts.set(l.key, { promotionId: def.id, amount: d }); giftClaimed.set(l.key, take);
          remaining = remaining.minus(take); amount = amount.plus(d); giftQty = giftQty.plus(take);
        }
        // 2) regular cart lines of the gift set (cheapest first), unless disabled
        if (c.applyToCart !== false) {
          for (const l of lines.filter((x) => !x.isGift && !result.lineDiscounts.has(x.key) && c.get.variantIds.includes(x.variantId)).sort((a, b) => a.unitPrice.comparedTo(b.unitPrice))) {
            if (remaining.lessThanOrEqualTo(0)) break;
            const take = Prisma.Decimal.min(remaining, l.quantity);
            const d = money(Prisma.Decimal.min(l.unitPrice.times(take).times(percent).dividedBy(100), lineNet(l)));
            if (d.greaterThan(0)) { result.lineDiscounts.set(l.key, { promotionId: def.id, amount: d }); amount = amount.plus(d); giftQty = giftQty.plus(take); }
            remaining = remaining.minus(take);
          }
        }
        result.gifts.push({ promotionId: def.id, code: def.code, name: def.name, variantIds: c.get.variantIds, quantity: free, claimed: free.minus(remaining), discountPercent: percent });
      }
    } else if (def.type === 'INVOICE_DISCOUNT' || def.type === 'VOUCHER') {
      const c = def.config as InvoiceDiscountConfig & VoucherConfig;
      const baseLines = def.type === 'VOUCHER' ? lines.filter((l) => !l.isGift && inTargets(c, l)) : lines.filter((l) => !l.isGift);
      const base = baseLines.reduce((s, l) => s.plus(lineNet(l)), ZERO).minus(result.invoiceDiscount);
      let tier: InvoiceDiscountTier | undefined;
      if (def.type === 'VOUCHER') tier = base.greaterThanOrEqualTo(D(c.minTotal ?? 0)) ? { minTotal: c.minTotal ?? '0', discountPercent: c.discountPercent, discountAmount: c.discountAmount, maxDiscount: c.maxDiscount } : undefined;
      else tier = [...(c.tiers ?? [])].sort((a, b) => D(b.minTotal).comparedTo(D(a.minTotal))).find((t) => base.greaterThanOrEqualTo(D(t.minTotal)));
      if (tier && base.greaterThan(0)) {
        let d = tier.discountPercent ? base.times(D(tier.discountPercent)).dividedBy(100) : D(tier.discountAmount ?? 0);
        if (tier.maxDiscount) d = Prisma.Decimal.min(d, D(tier.maxDiscount));
        d = money(Prisma.Decimal.min(d, base));
        if (d.greaterThan(0)) { result.invoiceDiscount = result.invoiceDiscount.plus(d); amount = d; if (def.type === 'VOUCHER') voucherId = ctx.voucher!.id; }
      }
    } else if (def.type === 'INVOICE_GIFT') {
      const c = def.config as InvoiceGiftConfig;
      const base = lines.filter((l) => !l.isGift).reduce((s, l) => s.plus(lineNet(l)), ZERO).minus(result.invoiceDiscount);
      const tier = [...(c.tiers ?? [])].sort((a, b) => D(b.minTotal).comparedTo(D(a.minTotal))).find((t) => base.greaterThanOrEqualTo(D(t.minTotal)));
      if (tier) {
        let claimedTotal = ZERO;
        for (const g of tier.gifts) {
          let remaining = toQty(g.quantity);
          for (const l of lines.filter((x) => x.isGift && x.giftPromotionId === def.id && x.variantId === g.variantId)) {
            const take = Prisma.Decimal.min(remaining, l.quantity.minus(giftClaimed.get(l.key) ?? ZERO));
            if (take.lessThanOrEqualTo(0)) continue;
            const d = money(l.unitPrice.times(take));
            result.lineDiscounts.set(l.key, { promotionId: def.id, amount: (result.lineDiscounts.get(l.key)?.amount ?? ZERO).plus(d) });
            giftClaimed.set(l.key, (giftClaimed.get(l.key) ?? ZERO).plus(take));
            remaining = remaining.minus(take); amount = amount.plus(d); claimedTotal = claimedTotal.plus(take);
          }
          result.gifts.push({ promotionId: def.id, code: def.code, name: def.name, variantIds: [g.variantId], quantity: toQty(g.quantity), claimed: toQty(g.quantity).minus(remaining), discountPercent: D(100) });
        }
        giftQty = claimedTotal;
        if (claimedTotal.isZero()) { amount = ZERO; }
      }
    }

    const offered = result.gifts.some((g) => g.promotionId === def.id);
    if (amount.greaterThan(0) || giftQty.greaterThan(0) || offered) {
      result.applied.push({ promotionId: def.id, code: def.code, name: def.name, type: def.type, amount: money(amount), giftQuantity: giftQty, voucherId });
      if (!def.stackable) closed = true;
    }
  }

  // every gift line must be fully granted by its promotion
  for (const l of lines) {
    if (!l.isGift) continue;
    const claimed = giftClaimed.get(l.key) ?? ZERO;
    if (!claimed.equals(l.quantity)) result.errors.push({ code: 'GIFT_NOT_ALLOWED', message: 'Hàng tặng vượt quá số lượng được tặng hoặc chương trình không áp dụng', details: { lineKey: l.key, variantId: l.variantId, promotionId: l.giftPromotionId, allowed: claimed.toString(), requested: l.quantity.toString() } });
  }
  return result;
}
