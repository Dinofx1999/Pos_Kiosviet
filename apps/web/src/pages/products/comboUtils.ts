import type { Product, SearchHit } from '../../api/types';
import { qty, toNum } from '../../utils/format';

/** Ảnh combo: ảnh riêng → ảnh món đầu tiên có ảnh. */
export const comboImage = (p: Product): string | null =>
  p.imageUrl ?? p.images?.[0]?.url ?? p.comboItems.map((c) => c.componentVariant?.imageUrl ?? c.componentVariant?.product?.imageUrl).find(Boolean) ?? null;

/** "Kem chống nắng · Son ×2 · Phấn phủ" */
export const comboPartsText = (p: Pick<Product, 'comboItems'>) =>
  p.comboItems.map((c) => `${c.componentVariant?.name ?? ''}${toNum(c.quantity) !== 1 ? ` ×${qty(c.quantity)}` : ''}`).join(' · ');

/** Danh sách món của combo cho dòng giỏ hàng (tên đầy đủ + số lượng mỗi combo). */
export const comboLineItems = (p: Pick<Product, 'comboItems'>) => p.comboItems.map((c) => ({ name: c.componentVariant?.name ?? '', quantity: toNum(c.quantity) }));

/** Giá combo, tổng giá lẻ các món, số tiền khách tiết kiệm. */
export function comboPrice(p: Product) {
  const sell = toNum(p.sellPrice ?? p.variants[0]?.sellPrice);
  const retail = p.comboRetailPrice !== undefined ? toNum(p.comboRetailPrice) : p.comboItems.reduce((s, c) => s + toNum(c.componentVariant?.sellPrice) * toNum(c.quantity), 0);
  return { sell, retail, save: Math.round((retail - sell) * 100) / 100 };
}

/** Nhóm combo theo nhóm hàng (danh mục riêng như "Combo Makeup mùa hè"); combo chưa có nhóm xếp cuối. */
export function comboGroups(list: Product[]) {
  const map = new Map<string, { id: string | null; name: string; count: number }>();
  for (const p of list) {
    const key = p.category?.id ?? '';
    const g = map.get(key) ?? { id: p.category?.id ?? null, name: p.category?.name ?? 'Chưa có nhóm', count: 0 };
    g.count++;
    map.set(key, g);
  }
  return Array.from(map.values()).sort((a, b) => (a.id === null ? 1 : b.id === null ? -1 : a.name.localeCompare(b.name, 'vi')));
}

/** Tìm không dấu: "son moi" khớp "Son môi". */
export const fold = (s: string) => s.normalize('NFD').replace(/[̀-ͯ]/g, '').replace(/đ/gi, 'd').toLowerCase();

/** Hàng (combo) → dòng tìm kiếm để thêm vào giỏ bán hàng. */
export const productToHit = (p: Product): SearchHit => {
  const v = p.variants[0];
  return { ...v, product: { id: p.id, code: p.code, name: p.name, type: p.type, baseUnit: p.baseUnit, trackBatch: p.trackBatch, imageUrl: p.imageUrl ?? comboImage(p) }, available: v.onHand ?? v.onHandTotal, onHand: v.onHand ?? v.onHandTotal };
};
