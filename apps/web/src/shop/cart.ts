import { useSyncExternalStore } from 'react';
import { lsGet, lsSet, type FlashInfo } from './api';

/** Giỏ hàng lưu trên trình duyệt theo từng cửa hàng; giá chỉ để ước tính, giá chốt do máy chủ tính khi đặt. */
export interface CartItem {
  variantId: string; productId: string; name: string; variantName?: string | null; imageUrl: string | null;
  price: number | null; flash: FlashInfo | null; quantity: number; maxQuantity: number;
}

let items: CartItem[] = lsGet<CartItem[]>('shop.cart', []);
const subs = new Set<() => void>();
const emit = () => { lsSet('shop.cart', items); subs.forEach((f) => f()); };

window.addEventListener('storage', (e) => { if (e.key?.startsWith('shop.cart:')) { items = lsGet<CartItem[]>('shop.cart', []); subs.forEach((f) => f()); } });

export const cart = {
  subscribe: (f: () => void) => { subs.add(f); return () => { subs.delete(f); }; },
  get: () => items,
  add(item: Omit<CartItem, 'quantity'>, quantity: number) {
    const cur = items.find((i) => i.variantId === item.variantId);
    const max = Math.max(1, item.maxQuantity);
    items = cur ? items.map((i) => (i.variantId === item.variantId ? { ...i, ...item, quantity: Math.min(max, i.quantity + quantity) } : i)) : [...items, { ...item, quantity: Math.min(max, quantity) }];
    emit();
  },
  setQty(variantId: string, quantity: number) { items = items.map((i) => (i.variantId === variantId ? { ...i, quantity: Math.max(1, Math.min(i.maxQuantity || 999, quantity)) } : i)); emit(); },
  remove(variantId: string) { items = items.filter((i) => i.variantId !== variantId); emit(); },
  update(variantId: string, patch: Partial<CartItem>) { items = items.map((i) => (i.variantId === variantId ? { ...i, ...patch } : i)); emit(); },
  clear() { items = []; emit(); },
};

export const useCart = () => useSyncExternalStore(cart.subscribe, cart.get);
export const useCartCount = () => useCart().reduce((s, i) => s + i.quantity, 0);

/**
 * Ước tính tiền một dòng: phần trong suất Flash Sale (≤ tối đa / đơn, ≤ suất còn) giá sốc, phần còn lại giá thường.
 * Giá ẩn (giá hàng hóa hoặc giá Flash Sale cửa hàng không hiện) ở phần nào thì cả dòng không ước tính được (null).
 */
export function lineEstimate(i: CartItem): { total: number | null; flashQty: number } {
  const f = i.flash;
  const flashQty = f ? Math.max(0, Math.min(i.quantity, f.perOrderLimit ?? i.quantity, f.remaining ?? i.quantity)) : 0;
  const rest = i.quantity - flashQty;
  if ((flashQty > 0 && f?.price == null) || (rest > 0 && i.price === null)) return { total: null, flashQty };
  return { total: (flashQty > 0 ? f!.price! * flashQty : 0) + (rest > 0 ? i.price! * rest : 0), flashQty };
}
