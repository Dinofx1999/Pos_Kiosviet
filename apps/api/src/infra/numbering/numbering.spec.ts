import { formatCode, periodKey } from './numbering';

describe('numbering (T-051)', () => {
  it('formats with padding and no period', () => {
    expect(formatCode('SP', 'NEVER', '', 1, 6)).toBe('SP000001');
    expect(formatCode('NK', 'NEVER', '', 12345678, 6)).toBe('NK12345678');
  });
  it('formats yearly/monthly', () => {
    const d = new Date(2026, 9, 24);
    expect(periodKey('YEARLY', d)).toBe('2026');
    expect(periodKey('MONTHLY', d)).toBe('202610');
    expect(periodKey('NEVER', d)).toBe('');
    expect(formatCode('HD', 'MONTHLY', '202610', 7, 4)).toBe('HD202610-0007');
  });
});
