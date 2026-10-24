import { Prisma } from '@prisma/client';
import { D, money, ZERO } from '../../common/utils/decimal';

export interface CalcLineInput { quantity: Prisma.Decimal; unitPrice: Prisma.Decimal; discountAmount: Prisma.Decimal; taxRate: Prisma.Decimal }
export interface CalcCostInput { amount: Prisma.Decimal; allocationMethod: 'BY_VALUE' | 'BY_QUANTITY'; payToSupplier: boolean }
export interface CalcLineResult {
  lineTotal: Prisma.Decimal;
  taxAmount: Prisma.Decimal;
  allocatedCost: Prisma.Decimal;
  unitCost: Prisma.Decimal;
  /** amount payable to the supplier for this line = lineTotal − document-discount share + tax (landed costs excluded) */
  payable: Prisma.Decimal;
}
export interface CalcResult {
  lines: CalcLineResult[];
  subtotal: Prisma.Decimal;
  discountAmount: Prisma.Decimal;
  taxAmount: Prisma.Decimal;
  landedCostTotal: Prisma.Decimal;
  /** amount owed to the supplier = subtotal − document discount + tax + landed costs payable to the supplier */
  totalAmount: Prisma.Decimal;
}

/** Distributes `total` across `weights` proportionally; rounding remainder goes to the last non-zero weight (sums match exactly). */
export function allocate(total: Prisma.Decimal, weights: Prisma.Decimal[]): Prisma.Decimal[] {
  const sum = weights.reduce((s, w) => s.plus(w), ZERO);
  if (sum.isZero() || total.isZero()) return weights.map(() => ZERO);
  const out = weights.map((w) => money(total.times(w).dividedBy(sum)));
  const diff = total.minus(out.reduce((s, v) => s.plus(v), ZERO));
  if (!diff.isZero()) {
    let last = weights.length - 1;
    while (last > 0 && weights[last].isZero()) last--;
    out[last] = out[last].plus(diff);
  }
  return out;
}

/**
 * Purchase receipt totals and effective unit costs (BR-43..BR-45):
 *  lineTotal   = qty × unitPrice − lineDiscount
 *  docDiscount is spread across lines by lineTotal
 *  tax         = (lineTotal − docDiscountShare) × taxRate
 *  landed costs spread BY_VALUE (lineTotal) or BY_QUANTITY
 *  unitCost    = (lineTotal − docDiscountShare + landedShare + (includeTaxInCost ? tax : 0)) / qty
 */
export function computeReceipt(lines: CalcLineInput[], costs: CalcCostInput[], documentDiscount: Prisma.Decimal, includeTaxInCost: boolean): CalcResult {
  const lineTotals = lines.map((l) => {
    const gross = D(l.quantity).times(D(l.unitPrice));
    const net = gross.minus(D(l.discountAmount));
    if (net.lessThan(0)) throw new Error('Chiết khấu dòng vượt quá thành tiền');
    return money(net);
  });
  const subtotal = lineTotals.reduce((s, v) => s.plus(v), ZERO);
  const docDiscount = money(documentDiscount);
  if (docDiscount.greaterThan(subtotal)) throw new Error('Chiết khấu phiếu vượt quá tổng tiền hàng');
  const discountShares = allocate(docDiscount, lineTotals);
  const quantities = lines.map((l) => D(l.quantity));

  const landedShares = lines.map(() => ZERO);
  let landedTotal = ZERO;
  let landedToSupplier = ZERO;
  for (const c of costs) {
    const amt = money(c.amount);
    landedTotal = landedTotal.plus(amt);
    if (c.payToSupplier) landedToSupplier = landedToSupplier.plus(amt);
    // BY_VALUE with all-zero line totals would drop the cost from inventory; fall back to quantity weights
    const weights = c.allocationMethod === 'BY_QUANTITY' || subtotal.isZero() ? quantities : lineTotals;
    const shares = allocate(amt, weights);
    shares.forEach((s, i) => (landedShares[i] = landedShares[i].plus(s)));
  }

  let taxTotal = ZERO;
  const out: CalcLineResult[] = lines.map((l, i) => {
    const netOfDoc = lineTotals[i].minus(discountShares[i]);
    const tax = money(netOfDoc.times(D(l.taxRate)).dividedBy(100));
    taxTotal = taxTotal.plus(tax);
    const allocatedCost = landedShares[i].minus(discountShares[i]).plus(includeTaxInCost ? tax : ZERO);
    const qty = quantities[i];
    const unitCost = qty.isZero() ? ZERO : lineTotals[i].plus(allocatedCost).dividedBy(qty).toDecimalPlaces(4);
    return { lineTotal: lineTotals[i], taxAmount: tax, allocatedCost: money(allocatedCost), unitCost, payable: netOfDoc.plus(tax) };
  });

  return { lines: out, subtotal, discountAmount: docDiscount, taxAmount: taxTotal, landedCostTotal: landedTotal, totalAmount: subtotal.minus(docDiscount).plus(taxTotal).plus(landedToSupplier) };
}

/**
 * Per-unit amount actually paid to the supplier for each stored receipt line (BR-47):
 * (lineTotal − document-discount share + tax) / qty — landed costs are not refundable. Lines must be in lineNo order.
 */
export function unitPayables(documentDiscount: Prisma.Decimal, lines: Array<{ id: string; quantity: Prisma.Decimal; lineTotal: Prisma.Decimal; taxAmount: Prisma.Decimal }>): Map<string, Prisma.Decimal> {
  const shares = allocate(D(documentDiscount), lines.map((l) => D(l.lineTotal)));
  return new Map(lines.map((l, i) => [l.id, D(l.quantity).isZero() ? ZERO : D(l.lineTotal).minus(shares[i]).plus(D(l.taxAmount)).dividedBy(D(l.quantity)).toDecimalPlaces(4)]));
}
