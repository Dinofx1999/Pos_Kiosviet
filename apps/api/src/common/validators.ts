import { registerDecorator, ValidationOptions } from 'class-validator';
import { Transform } from 'class-transformer';
import Decimal from 'decimal.js';

const DECIMAL_RE = /^[+-]?\d{1,13}(\.\d{1,6})?$/; // ≤ 13 integer digits: fits DECIMAL(18,4) with headroom for qty × price

export interface DecimalStrOptions { min?: number; max?: number; positive?: boolean }

/** Validates a decimal string: plain digits (no exponent), ≤15 integer digits, ≤6 decimals, optional bounds. */
export function IsDecimalStr(opts: DecimalStrOptions = {}, validationOptions?: ValidationOptions) {
  return function (object: object, propertyName: string) {
    registerDecorator({
      name: 'isDecimalStr', target: object.constructor, propertyName, options: validationOptions,
      validator: {
        validate(value: unknown) {
          if (typeof value !== 'string' || !DECIMAL_RE.test(value)) return false;
          const d = new Decimal(value);
          if (opts.min !== undefined && d.lessThan(opts.min)) return false;
          if (opts.max !== undefined && d.greaterThan(opts.max)) return false;
          if (opts.positive && !d.greaterThan(0)) return false;
          return true;
        },
        defaultMessage() {
          const bounds = [opts.positive ? '> 0' : opts.min !== undefined ? `>= ${opts.min}` : '', opts.max !== undefined ? `<= ${opts.max}` : ''].filter(Boolean).join(' và ');
          return `${propertyName} phải là chuỗi số thập phân hợp lệ${bounds ? ` (${bounds})` : ''}`;
        },
      },
    });
  };
}

/** Trims string input; turns empty strings into undefined (so optional fields are treated as absent). */
export const TrimToUndefined = () => Transform(({ value }) => (typeof value === 'string' ? (value.trim() === '' ? undefined : value.trim()) : value));
export const Trim = () => Transform(({ value }) => (typeof value === 'string' ? value.trim() : value));

export const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
export const isUuid = (v: unknown): v is string => typeof v === 'string' && UUID_RE.test(v);
