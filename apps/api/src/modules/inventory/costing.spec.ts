import { Prisma } from '@prisma/client';
import { applyCost } from './costing';

const d = (v: string | number) => new Prisma.Decimal(v);

describe('applyCost – moving average (T-050)', () => {
  it('first receipt sets avg to unit cost', () => {
    const r = applyCost({ qty: d(0), avgCost: d(0) }, d(10), d(100));
    expect(r.avgAfter.toString()).toBe('100');
    expect(r.qtyAfter.toString()).toBe('10');
    expect(r.valueDelta.toString()).toBe('1000');
  });
  it('second receipt at different price is weighted', () => {
    const r = applyCost({ qty: d(10), avgCost: d(100) }, d(10), d(200));
    expect(r.avgAfter.toString()).toBe('150');
  });
  it('issue uses current avg and keeps avg unchanged', () => {
    const r = applyCost({ qty: d(20), avgCost: d(150) }, d(-5), null);
    expect(r.unitCost.toString()).toBe('150');
    expect(r.avgAfter.toString()).toBe('150');
    expect(r.valueDelta.toString()).toBe('-750');
  });
  it('reversal of a receipt restores the previous avg', () => {
    // 10 @100 then +10 @200 => 20 @150; reverse the second receipt at its original 200
    const r = applyCost({ qty: d(20), avgCost: d(150) }, d(-10), d(200));
    expect(r.qtyAfter.toString()).toBe('10');
    expect(r.avgAfter.toString()).toBe('100');
  });
  it('receipt after negative stock resets avg to unit cost', () => {
    const r = applyCost({ qty: d(-2), avgCost: d(100) }, d(5), d(120));
    expect(r.avgAfter.toString()).toBe('120');
    expect(r.qtyAfter.toString()).toBe('3');
  });
  it('issue down to zero keeps avg for the next issue', () => {
    const r = applyCost({ qty: d(5), avgCost: d(80) }, d(-5), null);
    expect(r.qtyAfter.toString()).toBe('0');
    expect(r.avgAfter.toString()).toBe('80');
  });
  it('rounds avg to 4 decimals', () => {
    const r = applyCost({ qty: d(3), avgCost: d(10) }, d(1), d(11));
    expect(r.avgAfter.toString()).toBe('10.25');
    const r2 = applyCost({ qty: d(3), avgCost: d(10) }, d(4), d(11.3333));
    expect(r2.avgAfter.decimalPlaces()).toBeLessThanOrEqual(4);
  });
});
