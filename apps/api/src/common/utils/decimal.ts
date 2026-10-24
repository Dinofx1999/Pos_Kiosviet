import { Prisma } from '@prisma/client';
import Decimal from 'decimal.js';

export type Dec = Prisma.Decimal;
export const D = (v: Decimal.Value | Prisma.Decimal | null | undefined): Prisma.Decimal =>
  new Prisma.Decimal(v === null || v === undefined ? 0 : (v as any).toString());
export const ZERO = new Prisma.Decimal(0);
export const isPositive = (v: Prisma.Decimal) => v.greaterThan(0);
export const isNegative = (v: Prisma.Decimal) => v.lessThan(0);
/** Quantity precision: 3 decimals. */
export const qty = (v: Decimal.Value | Prisma.Decimal) => D(v).toDecimalPlaces(3);
/** Money precision: 4 decimals. */
export const money = (v: Decimal.Value | Prisma.Decimal) => D(v).toDecimalPlaces(4);
