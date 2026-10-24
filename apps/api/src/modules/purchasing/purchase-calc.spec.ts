import { Prisma } from '@prisma/client';
import { allocate, computeReceipt } from './purchase-calc';

const d = (v: string | number) => new Prisma.Decimal(v);

describe('purchase-calc (T-090)', () => {
  it('allocate spreads proportionally and keeps the exact sum', () => {
    const parts = allocate(d(100), [d(1), d(1), d(1)]);
    expect(parts.map(String)).toEqual(['33.3333', '33.3333', '33.3334']);
    expect(parts.reduce((s, p) => s.plus(p), d(0)).toString()).toBe('100');
    expect(allocate(d(50), [d(0), d(0)]).map(String)).toEqual(['0', '0']);
  });

  it('computes line totals, document discount, tax and landed cost into unit cost', () => {
    const r = computeReceipt(
      [
        { quantity: d(10), unitPrice: d(100), discountAmount: d(0), taxRate: d(10) },   // 1000
        { quantity: d(5), unitPrice: d(200), discountAmount: d(100), taxRate: d(0) },  // 900
      ],
      [{ amount: d(190), allocationMethod: 'BY_VALUE', payToSupplier: true }],
      d(95),   // 5% doc discount → 50 / 45
      true,
    );
    expect(r.subtotal.toString()).toBe('1900');
    expect(r.discountAmount.toString()).toBe('95');
    // tax on line 1 net of doc discount: (1000 − 50) × 10% = 95
    expect(r.taxAmount.toString()).toBe('95');
    expect(r.landedCostTotal.toString()).toBe('190');
    expect(r.totalAmount.toString()).toBe('2090'); // 1900 − 95 + 95 + 190
    // line 1: (1000 − 50 + 100 landed + 95 tax) / 10 = 114.5
    expect(r.lines[0].unitCost.toString()).toBe('114.5');
    // line 2: (900 − 45 + 90) / 5 = 189
    expect(r.lines[1].unitCost.toString()).toBe('189');
  });

  it('excludes tax from cost when includeTaxInCost = false and BY_QUANTITY allocation', () => {
    const r = computeReceipt(
      [{ quantity: d(1), unitPrice: d(1000), discountAmount: d(0), taxRate: d(8) }, { quantity: d(3), unitPrice: d(100), discountAmount: d(0), taxRate: d(8) }],
      [{ amount: d(40), allocationMethod: 'BY_QUANTITY', payToSupplier: false }],
      d(0), false,
    );
    expect(r.lines[0].unitCost.toString()).toBe('1010'); // 1000 + 40/4
    expect(r.lines[1].unitCost.toString()).toBe('110');  // 100 + 10
    expect(r.totalAmount.toString()).toBe('1404'); // 1300 + 104 tax, landed cost not payable to supplier
  });

  it('rejects discounts larger than the amount', () => {
    expect(() => computeReceipt([{ quantity: d(1), unitPrice: d(10), discountAmount: d(20), taxRate: d(0) }], [], d(0), true)).toThrow();
    expect(() => computeReceipt([{ quantity: d(1), unitPrice: d(10), discountAmount: d(0), taxRate: d(0) }], [], d(11), true)).toThrow();
  });
});
