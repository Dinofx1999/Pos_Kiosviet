import { create } from 'zustand';
import { persist } from 'zustand/middleware';
import type { Batch, ProductUnit } from '../../api/types';

export interface CartLine {
  key: string;
  variantId: string;
  productId: string;
  sku: string;
  barcode?: string | null;
  name: string;
  productType: string;
  trackBatch: boolean;
  baseUnit?: string | null;
  units: ProductUnit[];
  productUnitId?: string;
  unitName?: string | null;
  factor: number;
  quantity: number;
  listPrice: number;
  unitPrice: number;
  discount: number;
  taxRate: number;
  batchId?: string;
  batches?: Batch[];
  onHand?: number;
  note?: string;
  error?: string;
  /** Module 09: gift line granted by a promotion (charged 0, consumes stock) */
  isGift?: boolean;
  promotionId?: string;
}

export interface PaymentRow { method: string; amount: number; reference?: string }

export interface CartTab {
  id: string;
  name: string;
  customerId?: string;
  customerLabel?: string;
  sellerId?: string;
  priceBookId?: string;
  discount: number;
  note: string;
  lines: CartLine[];
  /** server-side held invoice (DRAFT) this tab was loaded from */
  draftId?: string;
  draftCode?: string;
  draftVersion?: number;
  /** Module 09 – promotions: voucher code applied, its label, minimum total (from the lookup) */
  voucherCode?: string;
  voucherLabel?: string;
  voucherMinTotal?: number;
  /** automatic promotions the cashier opted out of (sent as excludePromotionIds) */
  excluded?: { id: string; code: string; name: string }[];
  /** true = applyPromotions:false (no automatic promotions, no voucher, no gifts) */
  promosOff?: boolean;
  /** the current price book was pre-selected from the customer's group (manual picks clear it) */
  priceBookAuto?: boolean;
  /** Module 11 – loyalty: whole points the customer spends on this invoice (sent as redeemPoints, BR-141) */
  redeemPoints?: number;
  /** VietQR / SePay code created for this cart (kept until the sale completes or the code is cancelled – money may already be on it) */
  bankRequest?: { id: string; code: string; amount: number };
}

interface PosState {
  tabs: CartTab[];
  activeId: string;
  warehouseId?: string;
  counter: number;
  addTab: (tab?: Partial<CartTab>) => string;
  closeTab: (id: string) => void;
  setActive: (id: string) => void;
  updateTab: (id: string, patch: Partial<CartTab> | ((t: CartTab) => Partial<CartTab>)) => void;
  resetTab: (id: string) => void;
  setWarehouse: (id?: string) => void;
}

const newTab = (n: number, extra: Partial<CartTab> = {}): CartTab => ({ id: `${Date.now()}-${n}`, name: `Hóa đơn ${n}`, discount: 0, note: '', lines: [], ...extra });

export const usePosStore = create<PosState>()(
  persist(
    (set, get) => ({
      tabs: [newTab(1)],
      activeId: '',
      counter: 1,
      addTab: (extra) => {
        const n = get().counter + 1;
        const t = newTab(n, extra);
        set((s) => ({ tabs: [...s.tabs, t], activeId: t.id, counter: n }));
        return t.id;
      },
      closeTab: (id) => set((s) => {
        const tabs = s.tabs.filter((t) => t.id !== id);
        if (tabs.length === 0) { const n = s.counter + 1; const t = newTab(n); return { tabs: [t], activeId: t.id, counter: n }; }
        return { tabs, activeId: s.activeId === id ? tabs[tabs.length - 1].id : s.activeId };
      }),
      setActive: (activeId) => set({ activeId }),
      updateTab: (id, patch) => set((s) => ({ tabs: s.tabs.map((t) => (t.id === id ? { ...t, ...(typeof patch === 'function' ? patch(t) : patch) } : t)) })),
      resetTab: (id) => set((s) => ({ tabs: s.tabs.map((t) => (t.id === id ? { ...newTab(0), id: t.id, name: t.name } : t)) })),
      setWarehouse: (warehouseId) => set({ warehouseId }),
    }),
    { name: 'erp-pos', partialize: (s) => ({ tabs: s.tabs.map((t) => ({ ...t, lines: t.lines.map(({ batches: _b, error: _e, ...l }) => l) })), activeId: s.activeId, warehouseId: s.warehouseId, counter: s.counter }) },
  ),
);

export const lineTotal = (l: CartLine) => (l.isGift ? 0 : Math.max(0, l.quantity * l.unitPrice - l.discount));

/** Mirrors the API's computeInvoice (BR-52) for the live totals shown at the POS. */
export function cartTotals(lines: CartLine[], docDiscount: number, priceIncludesTax: boolean) {
  const totals = lines.map(lineTotal);
  const subtotal = totals.reduce((s, v) => s + v, 0);
  const disc = Math.min(docDiscount, subtotal);
  let tax = 0;
  let total = 0;
  lines.forEach((l, i) => {
    const share = subtotal > 0 ? (disc * totals[i]) / subtotal : 0;
    const net = totals[i] - share;
    const t = l.taxRate ? (priceIncludesTax ? (net * l.taxRate) / (100 + l.taxRate) : (net * l.taxRate) / 100) : 0;
    tax += t;
    total += net + (priceIncludesTax ? 0 : t);
  });
  return { subtotal, discount: disc, tax: Math.round(tax * 100) / 100, total: Math.round(total * 100) / 100 };
}
