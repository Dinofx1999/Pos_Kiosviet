import { hasPermission } from '@erp/shared';

describe('hasPermission (T-052)', () => {
  it('grants everything with *', () => {
    expect(hasPermission(['*'], 'product.create')).toBe(true);
  });
  it('matches exact code', () => {
    expect(hasPermission(['product.view'], 'product.view')).toBe(true);
    expect(hasPermission(['product.view'], 'product.create')).toBe(false);
  });
  it('matches group wildcard', () => {
    expect(hasPermission(['inventory.document.*'], 'inventory.document.post')).toBe(true);
    expect(hasPermission(['inventory.*'], 'inventory.document.post')).toBe(true);
    expect(hasPermission(['product.*'], 'inventory.document.post')).toBe(false);
  });
  it('works with a Set', () => {
    expect(hasPermission(new Set(['role.manage']), 'role.manage')).toBe(true);
  });
});
