export type ResetPolicy = 'NEVER' | 'YEARLY' | 'MONTHLY';

export function periodKey(policy: ResetPolicy, now: Date): string {
  if (policy === 'YEARLY') return String(now.getFullYear());
  if (policy === 'MONTHLY') return `${now.getFullYear()}${String(now.getMonth() + 1).padStart(2, '0')}`;
  return '';
}

export function formatCode(prefix: string, policy: ResetPolicy, period: string, n: number | bigint, padding: number): string {
  const num = String(n).padStart(padding, '0');
  if (policy === 'NEVER' || !period) return `${prefix}${num}`;
  // YEARLY → NK2026-000001, MONTHLY → NK202610-000001
  return `${prefix}${period}-${num}`;
}
