import { Prisma } from '@prisma/client';
import { computeInvoice } from './sales-calc';

const d = (v: string | number) => new Prisma.Decimal(v);

describe('sales-calc (T-130)', () => {
  it('computes totals with line + document discount, tax included in price', () => {
    const r = computeInvoice(
      [{ quantity: d(2), unitPrice: d(110000), discountAmount: d(20000), taxRate: d(10) }, { quantity: d(1), unitPrice: d(50000), discountAmount: d(0), taxRate: d(0) }],
      d(25000), true,
    );
    expect(r.subtotal.toString()).toBe('250000');          // 200,000 + 50,000
    expect(r.discountAmount.toString()).toBe('25000');      // shares 20,000 / 5,000
    expect(r.lines[0].net.toString()).toBe('180000');
    expect(r.lines[0].taxAmount.toString()).toBe('16363.6364'); // 180,000 × 10/110
    expect(r.totalAmount.toString()).toBe('225000');        // tax extracted, total unchanged
  });
  it('adds tax on top when prices exclude tax', () => {
    const r = computeInvoice([{ quantity: d(1), unitPrice: d(100), discountAmount: d(0), taxRate: d(8) }], d(0), false);
    expect(r.taxAmount.toString()).toBe('8');
    expect(r.totalAmount.toString()).toBe('108');
  });
  it('rejects discounts beyond the amount', () => {
    expect(() => computeInvoice([{ quantity: d(1), unitPrice: d(10), discountAmount: d(11), taxRate: d(0) }], d(0), true)).toThrow();
    expect(() => computeInvoice([{ quantity: d(1), unitPrice: d(10), discountAmount: d(0), taxRate: d(0) }], d(11), true)).toThrow();
  });
});
