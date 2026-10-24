import { D } from '../../common/utils/decimal';
import { evaluatePromotions, PromoContext, PromoDef, PromoLine } from './promotion-engine';

const def = (over: Partial<PromoDef> & Pick<PromoDef, 'id' | 'type' | 'config'>): PromoDef => ({
  code: over.id, name: over.id, priority: 0, stackable: false, startsAt: null, endsAt: null, daysOfWeek: [], timeFrom: null, timeTo: null,
  customerGroups: [], branchIds: [], usageLimit: null, usageCount: 0, perCustomerLimit: null, customerUses: 0, createdAt: new Date('2026-01-01'), ...over,
});
const line = (key: string, variantId: string, quantity: string, unitPrice: string, extra: Partial<PromoLine> = {}): PromoLine => ({ key, variantId, categoryId: null, quantity: D(quantity), unitPrice: D(unitPrice), manualDiscount: D(0), isGift: false, giftPromotionId: null, ...extra });
const ctx = (over: Partial<PromoContext> = {}): PromoContext => ({ now: new Date('2026-10-24T10:00:00'), branchId: 'b1', customerId: null, customerGroup: null, voucher: null, voucherCode: null, excludeIds: new Set(), ...over });

describe('promotion engine (BR-90..BR-96)', () => {
  it('product discount: percent / amount / fixed price, min & max quantity, capped at the line net', () => {
    const defs = [def({ id: 'P', type: 'PRODUCT_DISCOUNT', config: { variantIds: ['v1'], discountPercent: '10', minQuantity: '2' } })];
    const r = evaluatePromotions(defs, [line('a', 'v1', '3', '10000'), line('b', 'v1', '1', '10000'), line('c', 'v2', '5', '10000')], ctx());
    expect(r.lineDiscounts.get('a')?.amount.toString()).toBe('3000');
    expect(r.lineDiscounts.has('b')).toBe(false);
    expect(r.lineDiscounts.has('c')).toBe(false);
    expect(r.applied[0].amount.toString()).toBe('3000');
    const fixed = evaluatePromotions([def({ id: 'F', type: 'PRODUCT_DISCOUNT', config: { variantIds: ['v1'], fixedPrice: '8000', maxQuantity: '2' } })], [line('a', 'v1', '5', '10000')], ctx());
    expect(fixed.lineDiscounts.get('a')?.amount.toString()).toBe('4000'); // 2 units × 2 000
    const capped = evaluatePromotions([def({ id: 'A', type: 'PRODUCT_DISCOUNT', config: { variantIds: ['v1'], discountAmount: '9000' } })], [line('a', 'v1', '1', '10000', { manualDiscount: D(5000) })], ctx());
    expect(capped.lineDiscounts.get('a')?.amount.toString()).toBe('5000'); // never below zero net
  });

  it('invoice discount tiers pick the highest reached tier after product discounts; stacking rules', () => {
    const inv = def({ id: 'I', type: 'INVOICE_DISCOUNT', stackable: true, priority: 1, config: { tiers: [{ minTotal: '100000', discountPercent: '5' }, { minTotal: '200000', discountPercent: '10', maxDiscount: '15000' }] } });
    const prod = def({ id: 'P', type: 'PRODUCT_DISCOUNT', stackable: true, priority: 5, config: { variantIds: ['v1'], discountPercent: '50' } });
    const r = evaluatePromotions([inv, prod], [line('a', 'v1', '2', '100000'), line('b', 'v2', '1', '50000')], ctx());
    // product first (priority 5): −100 000 → base 150 000 → tier 5 % = 7 500
    expect(r.lineDiscounts.get('a')?.amount.toString()).toBe('100000');
    expect(r.invoiceDiscount.toString()).toBe('7500');
    expect(r.applied.map((a) => a.promotionId)).toEqual(['P', 'I']);
    const big = evaluatePromotions([inv], [line('a', 'v1', '3', '100000')], ctx());
    expect(big.invoiceDiscount.toString()).toBe('15000'); // 10 % capped
    // non-stackable: first applied closes the evaluation
    const ns = evaluatePromotions([def({ ...prod, stackable: false }), inv], [line('a', 'v1', '3', '100000')], ctx());
    expect(ns.applied.map((a) => a.promotionId)).toEqual(['P']);
    // non-stackable after a stackable one is skipped
    const skip = evaluatePromotions([prod, def({ ...inv, stackable: false, priority: 0 })], [line('a', 'v1', '3', '100000')], ctx());
    expect(skip.applied.map((a) => a.promotionId)).toEqual(['P']);
  });

  it('buy X get Y: repeats, gift lines claimed first then cheapest cart lines; over-claimed gifts are errors', () => {
    const bxgy = def({ id: 'B', type: 'BUY_X_GET_Y', config: { buy: { variantIds: ['v1'], quantity: '2' }, get: { variantIds: ['v2', 'v3'], quantity: '1' }, maxRepeats: 2 } });
    const r = evaluatePromotions([bxgy], [line('a', 'v1', '5', '10000'), line('g', 'v2', '1', '3000', { isGift: true, giftPromotionId: 'B' }), line('c', 'v3', '2', '2000')], ctx());
    expect(r.gifts[0].quantity.toString()).toBe('2'); // floor(5/2)=2 capped at 2
    expect(r.lineDiscounts.get('g')?.amount.toString()).toBe('3000');
    expect(r.lineDiscounts.get('c')?.amount.toString()).toBe('2000'); // one more free unit on the cart line
    expect(r.applied[0].giftQuantity.toString()).toBe('2');
    expect(r.errors).toHaveLength(0);
    const over = evaluatePromotions([bxgy], [line('a', 'v1', '2', '10000'), line('g', 'v2', '2', '3000', { isGift: true, giftPromotionId: 'B' })], ctx());
    expect(over.errors[0].code).toBe('GIFT_NOT_ALLOWED');
    const none = evaluatePromotions([bxgy], [line('a', 'v1', '1', '10000')], ctx());
    expect(none.applied).toHaveLength(0);
  });

  it('invoice gift tiers grant listed gifts only up to the tier quantity', () => {
    const g = def({ id: 'G', type: 'INVOICE_GIFT', config: { tiers: [{ minTotal: '500000', gifts: [{ variantId: 'gift', quantity: '1' }] }] } });
    const ok = evaluatePromotions([g], [line('a', 'v1', '1', '600000'), line('x', 'gift', '1', '20000', { isGift: true, giftPromotionId: 'G' })], ctx());
    expect(ok.lineDiscounts.get('x')?.amount.toString()).toBe('20000');
    expect(ok.errors).toHaveLength(0);
    const tooMany = evaluatePromotions([g], [line('a', 'v1', '1', '600000'), line('x', 'gift', '2', '20000', { isGift: true, giftPromotionId: 'G' })], ctx());
    expect(tooMany.errors[0].code).toBe('GIFT_NOT_ALLOWED');
    const notReached = evaluatePromotions([g], [line('a', 'v1', '1', '100000'), line('x', 'gift', '1', '20000', { isGift: true, giftPromotionId: 'G' })], ctx());
    expect(notReached.errors[0].code).toBe('GIFT_NOT_ALLOWED');
    const offered = evaluatePromotions([g], [line('a', 'v1', '1', '600000')], ctx());
    expect(offered.gifts[0].claimed.toString()).toBe('0');
    expect(offered.applied[0].promotionId).toBe('G'); // offered → POS can propose the gift
  });

  it('vouchers: need the matching code, respect status/uses/expiry/customer, restrict to targets and minTotal', () => {
    const v = def({ id: 'V', type: 'VOUCHER', stackable: true, config: { discountAmount: '30000', minTotal: '100000', variantIds: ['v1'] } });
    const voucher = { id: 'vc', code: 'SALE30', promotionId: 'V', status: 'ACTIVE', maxUses: 1, usedCount: 0, customerId: null, expiresAt: null };
    const r = evaluatePromotions([v], [line('a', 'v1', '1', '150000'), line('b', 'v2', '1', '900000')], ctx({ voucher, voucherCode: 'SALE30' }));
    expect(r.invoiceDiscount.toString()).toBe('30000');
    expect(r.applied[0].voucherId).toBe('vc');
    expect(evaluatePromotions([v], [line('a', 'v1', '1', '150000')], ctx()).applied).toHaveLength(0);
    const bad = evaluatePromotions([v], [line('a', 'v1', '1', '150000')], ctx({ voucherCode: 'NOPE' }));
    expect(bad.errors[0].code).toBe('VOUCHER_INVALID');
    const used = evaluatePromotions([v], [line('a', 'v1', '1', '150000')], ctx({ voucher: { ...voucher, usedCount: 1 }, voucherCode: 'SALE30' }));
    expect(used.errors[0].code).toBe('VOUCHER_INVALID');
    const below = evaluatePromotions([v], [line('a', 'v1', '1', '50000'), line('b', 'v2', '1', '900000')], ctx({ voucher, voucherCode: 'SALE30' }));
    expect(below.applied).toHaveLength(0); // v1 base 50 000 < minTotal
  });

  it('eligibility: dates, weekdays, time window, branch, customer group, usage limits, exclusions', () => {
    const base = def({ id: 'E', type: 'INVOICE_DISCOUNT', config: { tiers: [{ minTotal: '0', discountPercent: '10' }] } });
    const cart = [line('a', 'v1', '1', '100000')];
    const run = (over: Partial<PromoDef>, c: Partial<PromoContext> = {}) => evaluatePromotions([def({ ...base, ...over })], cart, ctx(c)).applied.length;
    expect(run({})).toBe(1);
    expect(run({ endsAt: new Date('2026-10-23') })).toBe(0);
    expect(run({ startsAt: new Date('2026-10-25') })).toBe(0);
    expect(run({ daysOfWeek: [0] })).toBe(0); // 2026-10-24 is a Saturday (6)
    expect(run({ daysOfWeek: [6] })).toBe(1);
    expect(run({ timeFrom: '18:00', timeTo: '21:00' })).toBe(0);
    expect(run({ timeFrom: '22:00', timeTo: '11:00' })).toBe(1); // overnight window includes 10:00
    expect(run({ branchIds: ['b2'] })).toBe(0);
    expect(run({ customerGroups: ['VIP'] })).toBe(0);
    expect(run({ customerGroups: ['VIP'] }, { customerGroup: 'VIP', customerId: 'c1' })).toBe(1);
    expect(run({ usageLimit: 5, usageCount: 5 })).toBe(0);
    expect(run({ perCustomerLimit: 1, customerUses: 1 }, { customerId: 'c1' })).toBe(0);
    expect(run({}, { excludeIds: new Set(['E']) })).toBe(0);
  });
});
