import { Prisma } from '@prisma/client';
import { D, money, ZERO } from '../../common/utils/decimal';
import { allocate } from '../purchasing/purchase-calc';

export interface SaleLineInput { quantity: Prisma.Decimal; unitPrice: Prisma.Decimal; discountAmount: Prisma.Decimal; taxRate: Prisma.Decimal }
export interface SaleLineResult { lineTotal: Prisma.Decimal; net: Prisma.Decimal; taxAmount: Prisma.Decimal }
export interface SaleResult { lines: SaleLineResult[]; subtotal: Prisma.Decimal; discountAmount: Prisma.Decimal; taxAmount: Prisma.Decimal; totalAmount: Prisma.Decimal }

/**
 * Invoice totals (BR-50..BR-52):
 *  lineTotal = qty × unitPrice − lineDiscount; document discount spread by lineTotal; net = lineTotal − share.
 *  priceIncludesTax: tax = net × r / (100 + r) (extracted, total unchanged); otherwise tax = net × r / 100 and is added to the total.
 */
export function computeInvoice(lines: SaleLineInput[], documentDiscount: Prisma.Decimal, priceIncludesTax: boolean): SaleResult {
  const lineTotals = lines.map((l) => {
    const net = D(l.quantity).times(D(l.unitPrice)).minus(D(l.discountAmount));
    if (net.lessThan(0)) throw new Error('Giảm giá dòng vượt quá thành tiền');
    return money(net);
  });
  const subtotal = lineTotals.reduce((s, v) => s.plus(v), ZERO);
  const docDiscount = money(documentDiscount);
  if (docDiscount.greaterThan(subtotal)) throw new Error('Giảm giá hóa đơn vượt quá tổng tiền hàng');
  const shares = allocate(docDiscount, lineTotals);
  let taxTotal = ZERO;
  let total = ZERO;
  const out: SaleLineResult[] = lines.map((l, i) => {
    const net = lineTotals[i].minus(shares[i]);
    const r = D(l.taxRate);
    const tax = r.isZero() ? ZERO : priceIncludesTax ? money(net.times(r).dividedBy(r.plus(100))) : money(net.times(r).dividedBy(100));
    taxTotal = taxTotal.plus(tax);
    total = total.plus(net).plus(priceIncludesTax ? ZERO : tax);
    return { lineTotal: lineTotals[i], net, taxAmount: tax };
  });
  if (subtotal.greaterThanOrEqualTo(1e14)) throw new Error('Tổng tiền vượt giới hạn hệ thống');
  return { lines: out, subtotal, discountAmount: docDiscount, taxAmount: taxTotal, totalAmount: money(total) };
}
