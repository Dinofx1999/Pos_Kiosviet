import { Prisma } from '@prisma/client';
import { D, ZERO } from '../../common/utils/decimal';

export interface CostState { qty: Prisma.Decimal; avgCost: Prisma.Decimal }
export interface CostResult {
  unitCost: Prisma.Decimal;      // cost applied to this movement
  qtyAfter: Prisma.Decimal;
  avgAfter: Prisma.Decimal;
  valueDelta: Prisma.Decimal;    // signed change of inventory value
}

/**
 * Moving-average costing (BR-30..BR-34), tenant-wide per variant.
 *  - inbound  (qtyDelta > 0): unitCost required (null → current avg). If qtyBefore <= 0 the new avg is unitCost.
 *  - outbound (qtyDelta < 0): unitCost defaults to current avg (explicit value only for reversals).
 */
export function applyCost(state: CostState, qtyDelta: Prisma.Decimal, explicitUnitCost: Prisma.Decimal | null): CostResult {
  const qtyBefore = D(state.qty);
  const avgBefore = D(state.avgCost);
  const delta = D(qtyDelta);
  const unitCost = (explicitUnitCost === null || explicitUnitCost === undefined ? avgBefore : D(explicitUnitCost)).toDecimalPlaces(4);
  const qtyAfter = qtyBefore.plus(delta);
  const valueDelta = delta.times(unitCost).toDecimalPlaces(4);

  let avgAfter: Prisma.Decimal;
  if (delta.greaterThan(0)) {
    if (qtyBefore.lessThanOrEqualTo(0)) avgAfter = unitCost;
    else avgAfter = qtyBefore.times(avgBefore).plus(valueDelta).dividedBy(qtyAfter).toDecimalPlaces(4);
  } else {
    const valueAfter = qtyBefore.times(avgBefore).plus(valueDelta);
    avgAfter = qtyAfter.greaterThan(0) ? valueAfter.dividedBy(qtyAfter).toDecimalPlaces(4) : avgBefore;
  }
  if (avgAfter.lessThan(0)) avgAfter = ZERO;
  return { unitCost, qtyAfter, avgAfter, valueDelta };
}
