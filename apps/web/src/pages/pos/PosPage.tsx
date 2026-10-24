import { App, Badge, Button, Drawer, Dropdown, Input, InputNumber, Select, Space, Spin, Switch, Table, Tag, Tooltip } from 'antd';
import { CloseOutlined, ClockCircleOutlined, DeleteOutlined, FileTextOutlined, GiftOutlined, HomeOutlined, MinusOutlined, PlusOutlined, RollbackOutlined, SaveOutlined, TagOutlined, UserOutlined, WalletOutlined } from '@ant-design/icons';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Link, useNavigate, useSearchParams } from 'react-router-dom';
import { useQueryClient } from '@tanstack/react-query';
import { useMeQuery } from '../../api/auth';
import { catalogApi, usePriceBooks } from '../../api/catalog';
import { errMsg, normalizeError } from '../../api/client';
import { orgApi } from '../../api/org';
import { pts } from '../../api/loyalty';
import { ApplicablePriceBook, PosPreview, PosPreviewGift, VariantLite, promotionsApi } from '../../api/promotions';
import { SALES_KEYS, salesApi, useCurrentShift } from '../../api/sales';
import type { ApiError, Invoice, SearchHit } from '../../api/types';
import { CustomerSelect } from '../../components/CustomerSelect';
import { MoneyInput } from '../../components/Inputs';
import { ProductSearch, ProductSearchHandle } from '../../components/ProductSearch';
import { useIsMobile } from '../../hooks/useMedia';
import { useAuthStore, useBranchWarehouses } from '../../store/auth';
import { PAYMENT_METHOD_LABEL, dt, money, qty as fq, toNum, uuid } from '../../utils/format';
import { rewardText } from '../promotions/promoText';
import { HeldOrdersDrawer, ReceiptModal, ShiftCloseModal, ShiftOpenModal } from './PosModals';
import { CartLine, CartTab, PaymentRow, cartTotals, lineTotal, usePosStore } from './posStore';

const METHODS = ['CASH', 'BANK_TRANSFER', 'CARD', 'EWALLET'] as const;
const suggest = (total: number) => Array.from(new Set([total, ...[10000, 20000, 50000, 100000, 200000, 500000, 1000000].map((u) => Math.ceil(total / u) * u)].filter((v) => v >= total))).slice(0, 5);

export default function PosPage() {
  useMeQuery(true);
  const { message } = App.useApp();
  const qc = useQueryClient();
  const nav = useNavigate();
  const [sp, setSp] = useSearchParams();
  const isMobile = useIsMobile();
  const me = useAuthStore((s) => s.me);
  const can = useAuthStore((s) => s.can);
  const branchId = useAuthStore((s) => s.currentBranchId);
  const warehouses = useBranchWarehouses();
  const { tabs, activeId, addTab, closeTab, setActive, updateTab, resetTab, warehouseId: whStored, setWarehouse } = usePosStore();
  const tab = tabs.find((t) => t.id === activeId) ?? tabs[0];
  const warehouseId = warehouses.some((w) => w.id === whStored) ? whStored! : (warehouses.find((w) => w.isDefault) ?? warehouses[0])?.id;
  const priceIncludesTax = me?.settings?.['pricing.priceIncludesTax'] !== false;
  const { data: shift, refetch: refetchShift } = useCurrentShift(branchId);
  const { data: priceBooks } = usePriceBooks();
  const searchRef = useRef<ProductSearchHandle>(null);
  const discountRef = useRef<any>(null);
  const customerRef = useRef<HTMLDivElement>(null);
  const [sellers, setSellers] = useState<{ id: string; fullName: string }[]>([]);
  const [payMode, setPayMode] = useState<string>('CASH');
  const [cashGiven, setCashGiven] = useState<number | null>(null);
  const [single, setSingle] = useState<{ amount: number | null; reference: string }>({ amount: null, reference: '' });
  const [mixed, setMixed] = useState<PaymentRow[]>([{ method: 'CASH', amount: 0 }, { method: 'BANK_TRANSFER', amount: 0 }]);
  const [busy, setBusy] = useState(false);
  const [shiftOpen, setShiftOpen] = useState(false);
  const [shiftClose, setShiftClose] = useState(false);
  const [held, setHeld] = useState(false);
  const [sheet, setSheet] = useState(false); // mobile: bottom sheet with customer / totals / payment
  const [receipt, setReceipt] = useState<{ inv: Invoice; cashGiven?: number; pointsBalance?: string } | null>(null);
  // Module 09 – live preview (promotions / voucher / gifts) and price-book suggestion
  const [preview, setPreview] = useState<PosPreview | null>(null);
  const [previewErr, setPreviewErr] = useState<ApiError | null>(null);
  const [previewing, setPreviewing] = useState(false);
  const [previewTick, setPreviewTick] = useState(0);
  const previewSeq = useRef(0);
  const [voucherInput, setVoucherInput] = useState('');
  const [voucherErr, setVoucherErr] = useState<string | null>(null);
  const [voucherBusy, setVoucherBusy] = useState(false);
  const [applicable, setApplicable] = useState<ApplicablePriceBook[] | null>(null);
  const canPriceBook = can('invoice.pricebook.select');

  useEffect(() => { if (!tab && tabs[0]) setActive(tabs[0].id); }, [tab, tabs]);
  useEffect(() => { if (can('invoice.seller.change') && can('user.manage')) orgApi.users({ pageSize: 100, status: 'ACTIVE' }).then((r) => setSellers(r.data.map((u) => ({ id: u.id, fullName: u.fullName })))).catch(() => undefined); }, [me?.user.id]);
  const resetPayBox = () => { setCashGiven(null); setSingle({ amount: null, reference: '' }); setMixed([{ method: 'CASH', amount: 0 }, { method: 'BANK_TRANSFER', amount: 0 }]); };
  // reset the payment box when the tab changes
  useEffect(() => { resetPayBox(); setVoucherInput(''); setVoucherErr(null); }, [activeId]);
  // ?draft=<id> → open a held invoice from the management screens
  useEffect(() => { const id = sp.get('draft'); if (!id) return; salesApi.invoice(id).then((inv) => { void loadDraft(inv); setSp({}, { replace: true }); }).catch((e) => message.error(errMsg(e))); }, [sp.get('draft')]);

  const activePriceBooks = useMemo(() => (priceBooks ?? []).filter((pb) => pb.status === 'ACTIVE' && (!pb.startsAt || new Date(pb.startsAt) <= new Date()) && (!pb.endsAt || new Date(pb.endsAt) >= new Date()) && (!pb.branches?.length || pb.branches.some((b) => b.branchId === branchId))), [priceBooks, branchId]);
  const priceBookOptions = useMemo(() => (applicable ?? activePriceBooks).map((pb) => ({ value: pb.id, label: 'suggested' in pb && pb.suggested ? `${pb.name} · nhóm khách` : pb.name })), [applicable, activePriceBooks]);
  const clientTotals = useMemo(() => cartTotals(tab?.lines ?? [], tab?.discount ?? 0, priceIncludesTax), [tab, priceIncludesTax]);
  /** the preview matches the cart as it is now (same lines, same quantities) → its totals are authoritative */
  const fresh = !!preview && !!tab && preview.lines.length === tab.lines.length && preview.lines.every((pl, i) => pl.variantId === tab.lines[i].variantId && Math.abs(toNum(pl.quantity) - tab.lines[i].quantity) < 1e-6);
  const totals = useMemo(() => (fresh && preview ? { subtotal: toNum(preview.subtotal), discount: toNum(preview.discountAmount), promo: toNum(preview.promotionDiscount), tax: toNum(preview.taxAmount), total: toNum(preview.totalAmount) } : { ...clientTotals, promo: 0 }), [fresh, preview, clientTotals]);
  const applied = fresh && preview && !tab?.promosOff ? preview.promotions : [];
  const giftOffers = fresh && preview && !tab?.promosOff ? preview.gifts.filter((g) => toNum(g.remaining) > 0) : [];
  const lineInfo = (i: number) => (fresh && preview ? preview.lines[i] : undefined);
  // Module 11 – loyalty (BR-141): points pay like money → the cash box works on what is left after points
  const loyalty = tab?.customerId && preview?.loyalty?.enabled ? preview.loyalty : null;
  const pointsValue = fresh && loyalty ? toNum(loyalty.redeemValue) : 0;
  const payable = Math.max(0, Math.round((totals.total - pointsValue) * 100) / 100);
  const maxPts = loyalty ? Math.floor(toNum(loyalty.maxRedeemPoints)) : 0;
  const payments: PaymentRow[] = useMemo(() => {
    if (payMode === 'MIXED') return mixed.filter((m) => m.amount > 0);
    if (payMode === 'CASH') { const given = cashGiven ?? payable; return given > 0 ? [{ method: 'CASH', amount: Math.min(given, payable) }] : []; }
    const amt = single.amount ?? payable;
    return amt > 0 ? [{ method: payMode, amount: Math.min(amt, payable), reference: single.reference || undefined }] : [];
  }, [payMode, mixed, cashGiven, single, payable]);
  const paid = payments.reduce((s, p) => s + p.amount, 0);
  const due = Math.max(0, Math.round((payable - paid) * 100) / 100);
  const change = payMode === 'CASH' && cashGiven !== null ? Math.max(0, cashGiven - payable) : 0;

  // ---------------------------------------------------------------- cart
  const patch = (fn: (t: CartTab) => Partial<CartTab>) => tab && updateTab(tab.id, fn);
  const setLine = (key: string, p: Partial<CartLine> | ((l: CartLine) => Partial<CartLine>)) => patch((t) => ({ lines: t.lines.map((l) => (l.key === key ? { ...l, ...(typeof p === 'function' ? p(l) : p), error: undefined } : l)) }));
  const removeLine = (key: string) => patch((t) => ({ lines: t.lines.filter((x) => x.key !== key) }));

  const addHit = useCallback(async (hit: SearchHit) => {
    if (!tab) return;
    if (hit.product.type !== 'GOODS' && hit.product.type !== 'SERVICE' && hit.product.type !== 'COMBO') return;
    const existing = tab.lines.find((l) => l.variantId === hit.id && !l.productUnitId && !hit.unit && !l.isGift);
    if (existing) { setLine(existing.key, { quantity: existing.quantity + 1 }); return; }
    try {
      const product = await catalogApi.product(hit.product.id);
      const units = product.units ?? [];
      const unit = hit.unit ? units.find((u) => u.unitName === hit.unit!.unitName) : undefined;
      const priced = await salesApi.price({ variantId: hit.id, priceBookId: tab.priceBookId, productUnitId: unit?.id, quantity: '1' });
      const batches = product.trackBatch ? await catalogApi.batches(hit.id) : undefined;
      const line: CartLine = {
        key: uuid(), variantId: hit.id, productId: hit.product.id, sku: hit.sku, barcode: hit.barcode, name: hit.name, productType: hit.product.type, trackBatch: !!product.trackBatch, baseUnit: hit.product.baseUnit,
        units, productUnitId: unit?.id, unitName: priced.unitName ?? hit.product.baseUnit, factor: toNum(priced.conversionFactor) || 1, quantity: 1,
        listPrice: toNum(priced.listPrice), unitPrice: toNum(priced.listPrice), discount: 0, taxRate: toNum(priced.taxRate), batches, onHand: toNum(hit.onHand ?? hit.onHandTotal),
      };
      patch((t) => ({ lines: [...t.lines, line] }));
    } catch (e) { message.error(errMsg(e)); }
  }, [tab]);

  /** Gift prompt → add a gift line (charged 0) for the promotion; quantity = what is still free. */
  const addGift = async (g: PosPreviewGift, v: VariantLite) => {
    if (!tab) return;
    const remaining = toNum(g.remaining);
    if (remaining <= 0) return;
    const existing = tab.lines.find((l) => l.isGift && l.promotionId === g.promotionId && l.variantId === v.id);
    if (existing) { setLine(existing.key, { quantity: existing.quantity + remaining }); return; }
    try {
      const hits = await catalogApi.search(v.sku, warehouseId).catch(() => [] as SearchHit[]);
      const hit = hits.find((h) => h.id === v.id);
      let trackBatch = false; let batches: CartLine['batches'];
      if (hit) { try { const product = await catalogApi.product(hit.product.id); trackBatch = !!product.trackBatch; if (trackBatch) batches = await catalogApi.batches(v.id); } catch { /* ignore */ } }
      const line: CartLine = {
        key: uuid(), variantId: v.id, productId: hit?.product.id ?? '', sku: v.sku, barcode: hit?.barcode, name: v.name, productType: hit?.product.type ?? 'GOODS', trackBatch, baseUnit: hit?.product.baseUnit, units: [], unitName: hit?.product.baseUnit, factor: 1,
        quantity: remaining, listPrice: toNum(v.sellPrice), unitPrice: 0, discount: 0, taxRate: 0, batches, onHand: toNum(hit?.onHand ?? hit?.onHandTotal), isGift: true, promotionId: g.promotionId,
      };
      patch((t) => ({ lines: [...t.lines, line] }));
      message.success(`Đã thêm quà tặng ${v.name}`);
    } catch (e) { message.error(errMsg(e)); }
  };
  /** How many more units a gift line may claim (its own quantity + what the promotion still offers). */
  const giftMax = (l: CartLine) => { const g = fresh && preview ? preview.gifts.find((x) => x.promotionId === l.promotionId && x.variantIds.includes(l.variantId)) : undefined; return g ? l.quantity + toNum(g.remaining) : l.quantity; };

  const changeUnit = async (l: CartLine, productUnitId?: string) => {
    try {
      const priced = await salesApi.price({ variantId: l.variantId, priceBookId: tab?.priceBookId, productUnitId, quantity: String(l.quantity) });
      setLine(l.key, { productUnitId, unitName: priced.unitName ?? l.baseUnit, factor: toNum(priced.conversionFactor) || 1, listPrice: toNum(priced.listPrice), unitPrice: toNum(priced.listPrice) });
    } catch (e) { message.error(errMsg(e)); }
  };
  const changePriceBook = async (priceBookId?: string, auto = false) => {
    if (!tab) return;
    patch(() => ({ priceBookId, priceBookAuto: auto && !!priceBookId }));
    for (const l of tab.lines) {
      if (l.isGift) continue;
      try { const priced = await salesApi.price({ variantId: l.variantId, priceBookId, productUnitId: l.productUnitId, quantity: String(l.quantity) }); setLine(l.key, (cur) => ({ listPrice: toNum(priced.listPrice), unitPrice: cur.unitPrice === cur.listPrice ? toNum(priced.listPrice) : cur.unitPrice })); } catch { /* keep */ }
    }
  };

  // price books applicable to the branch / customer; a group-targeted ("suggested") book is pre-selected, manual picks win (BR-97)
  useEffect(() => {
    if (!branchId || !canPriceBook || !tab) { setApplicable(null); return; }
    let alive = true;
    salesApi.applicablePriceBooks({ branchId, customerId: tab.customerId }).then((list) => {
      if (!alive) return;
      setApplicable(list);
      const suggested = list.find((b) => b.suggested);
      if (suggested && (!tab.priceBookId || tab.priceBookAuto) && tab.priceBookId !== suggested.id) { void changePriceBook(suggested.id, true); message.info(`Áp dụng bảng giá "${suggested.name}" theo nhóm khách hàng`); }
      else if (tab.priceBookId && !list.some((b) => b.id === tab.priceBookId)) { void changePriceBook(undefined); if (!tab.priceBookAuto) message.warning('Bảng giá đang chọn không áp dụng cho khách này – đã chuyển về giá chung'); }
    }).catch(() => { if (alive) setApplicable(null); });
    return () => { alive = false; };
  }, [branchId, tab?.customerId, activeId, canPriceBook]);

  const buildInput = (t: CartTab) => ({
    branchId: branchId!, warehouseId: warehouseId!, customerId: t.customerId, sellerId: t.sellerId && t.sellerId !== me?.user.id ? t.sellerId : undefined, priceBookId: t.priceBookId,
    discountAmount: t.discount > 0 ? String(t.discount) : undefined, note: t.note || undefined,
    voucherCode: t.promosOff ? undefined : t.voucherCode || undefined,
    excludePromotionIds: !t.promosOff && t.excluded?.length ? t.excluded.map((x) => x.id) : undefined,
    applyPromotions: t.promosOff ? false : undefined,
    redeemPoints: t.customerId && t.redeemPoints && t.redeemPoints > 0 ? String(Math.floor(t.redeemPoints)) : undefined,
    lines: t.lines.map((l) => (l.isGift
      ? { variantId: l.variantId, batchId: l.batchId, quantity: String(l.quantity), isGift: true, promotionId: l.promotionId, note: l.note }
      : { variantId: l.variantId, batchId: l.batchId, productUnitId: l.productUnitId, quantity: String(l.quantity), unitPrice: l.unitPrice !== l.listPrice ? String(l.unitPrice) : undefined, discountAmount: l.discount > 0 ? String(l.discount) : undefined, note: l.note })),
  });
  /** PATCH body for a held order: promotion fields are explicit so clearing a voucher / re-enabling promotions sticks. */
  const buildUpdate = (t: CartTab) => ({ ...buildInput(t), customerId: t.customerId ?? null, priceBookId: t.priceBookId ?? null, voucherCode: t.promosOff ? null : t.voucherCode ?? null, excludePromotionIds: t.promosOff ? [] : t.excluded?.map((x) => x.id) ?? [], applyPromotions: !t.promosOff, redeemPoints: t.customerId && t.redeemPoints && t.redeemPoints > 0 ? String(Math.floor(t.redeemPoints)) : '0' });

  // ---------------------------------------------------------------- live preview (BR-90): debounced on cart / customer / voucher / price book / points change
  const previewKey = JSON.stringify(tab ? { b: branchId, w: warehouseId, c: tab.customerId, pb: tab.priceBookId, d: tab.discount, v: tab.voucherCode, x: tab.excluded?.map((e) => e.id), off: tab.promosOff, rp: tab.redeemPoints, l: tab.lines.map((l) => [l.variantId, l.batchId, l.productUnitId, l.quantity, l.isGift ? 'g' : l.unitPrice, l.isGift ? l.promotionId : l.discount]) } : null);
  useEffect(() => {
    const my = ++previewSeq.current;
    if (!tab || !branchId || !warehouseId || !tab.lines.length || tab.lines.some((l) => !(l.quantity > 0))) { setPreview(null); setPreviewErr(null); setPreviewing(false); return; }
    setPreviewing(true);
    const h = window.setTimeout(async () => {
      try {
        const r = await salesApi.preview(buildInput(tab));
        if (my !== previewSeq.current) return;
        setPreview(r); setPreviewErr(null);
        if (tab.voucherCode) setVoucherErr(null); // the server accepted the voucher for this cart
      } catch (e) {
        if (my !== previewSeq.current) return;
        const err = normalizeError(e);
        if (err.code === 'GIFT_NOT_ALLOWED') {
          const idx = Number(err.details?.lineKey);
          const allowed = toNum(err.details?.allowed);
          const l = (Number.isInteger(idx) ? tab.lines[idx] : undefined) ?? tab.lines.find((x) => x.isGift && x.variantId === err.details?.variantId && x.promotionId === err.details?.promotionId);
          if (l?.isGift) {
            if (allowed > 0) { setLine(l.key, { quantity: allowed }); message.warning(`Chỉ còn ${fq(allowed)} ${l.name} được tặng – đã điều chỉnh số lượng quà`); }
            else { removeLine(l.key); message.warning(`Đã bỏ hàng tặng ${l.name}: đơn không còn đủ điều kiện khuyến mãi`); }
            return; // the cart change re-runs the preview
          }
        }
        if (err.code === 'VOUCHER_INVALID') setVoucherErr(err.message);
        // loyalty (BR-141): clamp the points to what the server allows and let the cart change re-run the preview
        if (err.code === 'POINTS_MAX_REDEEM' || err.code === 'POINTS_INSUFFICIENT') {
          const max = Math.max(0, Math.floor(toNum(err.code === 'POINTS_MAX_REDEEM' ? err.details?.maxPoints : err.details?.balance)));
          patch(() => ({ redeemPoints: max > 0 ? max : undefined }));
          message.warning(max > 0 ? `Chỉ dùng được tối đa ${pts(max)} điểm cho đơn này – đã điều chỉnh` : 'Khách không đủ điểm – đã bỏ dùng điểm');
          return;
        }
        if (tab.redeemPoints && err.details?.minRedeem !== undefined) { patch(() => ({ redeemPoints: undefined })); message.warning(err.message); return; }
        setPreviewErr(err);
      } finally { if (my === previewSeq.current) setPreviewing(false); }
    }, 300);
    return () => window.clearTimeout(h);
  }, [previewKey, previewTick]);

  const validate = (t: CartTab) => {
    if (!branchId || !warehouseId) return 'Chọn chi nhánh / kho';
    if (t.lines.length === 0) return 'Chưa có hàng hóa trong giỏ';
    const bad = t.lines.find((l) => !(l.quantity > 0));
    if (bad) return `Số lượng của ${bad.name} phải lớn hơn 0`;
    const noBatch = t.lines.find((l) => l.trackBatch && !l.batchId);
    if (noBatch) return `Chọn lô cho ${noBatch.name}`;
    return null;
  };

  const handleApiError = (e: unknown) => {
    const err = normalizeError(e);
    if (err.code === 'INSUFFICIENT_STOCK' && err.details?.variantId) {
      patch((t) => ({ lines: t.lines.map((l) => (l.variantId === err.details!.variantId ? { ...l, error: `Không đủ tồn (khả dụng ${fq(err.details!.available ?? err.details!.onHand)})` } : l)) }));
      message.error(`Không đủ tồn kho (khả dụng ${fq(err.details.available ?? err.details.onHand)})`);
      setSheet(false);
    } else if (err.code === 'SHIFT_REQUIRED') { message.warning('Bạn cần mở ca bán hàng trước khi thanh toán'); setShiftOpen(true); }
    else if (err.code === 'CREDIT_LIMIT_EXCEEDED') message.error(`Vượt hạn mức nợ của khách (hạn mức ${money(err.details?.creditLimit)}, dư nợ dự kiến ${money(err.details?.projectedBalance)})`);
    else if (err.code === 'CREDIT_NOT_ALLOWED') message.error('Cửa hàng không cho phép bán nợ – khách cần thanh toán đủ');
    else if (err.code === 'DISCOUNT_LIMIT_EXCEEDED') message.error(`${err.message} (trần ${err.details?.maxDiscountPercent ?? ''}%)`);
    else if (err.code === 'PRODUCT_NOT_SELLABLE') {
      if (err.details?.variantId) patch((t) => ({ lines: t.lines.map((l) => (l.variantId === err.details!.variantId ? { ...l, error: 'Hàng không bán được (ngừng kinh doanh / không cho phép bán)' } : l)) }));
      message.error(err.message);
      setSheet(false);
    }
    else if (err.code === 'VOUCHER_INVALID') { setVoucherErr(err.message); message.error(`Voucher không dùng được: ${err.message}. Đơn đã được tính lại – hãy bỏ voucher hoặc dùng mã khác.`); setPreviewTick((t) => t + 1); }
    else if (err.code === 'GIFT_NOT_ALLOWED') { message.error('Hàng tặng vượt quá số lượng được tặng hoặc chương trình không còn áp dụng – đơn đã được tính lại, kiểm tra lại quà tặng'); setPreviewTick((t) => t + 1); }
    else if (err.code === 'PROMOTION_EXHAUSTED' || err.code === 'PROMOTION_INACTIVE') { message.error(`${err.message} – đơn đã được tính lại, kiểm tra số tiền trước khi thanh toán`); setPreviewTick((t) => t + 1); }
    else if (err.code === 'POINTS_INSUFFICIENT') { message.error(`Khách không đủ điểm (còn ${pts(err.details?.balance)} điểm) – đã bỏ dùng điểm, kiểm tra lại số tiền trước khi thanh toán`); patch(() => ({ redeemPoints: undefined })); setPreviewTick((t) => t + 1); }
    else if (err.code === 'POINTS_MAX_REDEEM') { const max = Math.max(0, Math.floor(toNum(err.details?.maxPoints))); message.error(`Chỉ được dùng tối đa ${pts(max)} điểm cho hóa đơn này – đã điều chỉnh, kiểm tra lại số tiền trước khi thanh toán`); patch(() => ({ redeemPoints: max > 0 ? max : undefined })); setPreviewTick((t) => t + 1); }
    else if (err.code === 'PAYMENT_SHARED') message.error('Phiếu thu của hóa đơn này còn phân bổ cho chứng từ khác hoặc có phần trả trước – hãy hủy phiếu thu trước');
    else if (err.code === 'VERSION_CONFLICT') message.error('Đơn giữ đã được thay đổi ở nơi khác – mở lại đơn từ danh sách "Đơn giữ"');
    else message.error(err.message);
  };

  const checkout = async () => {
    if (!tab || busy) return;
    const v = validate(tab); if (v) { message.warning(v); return; }
    if (due > 0 && !tab.customerId) { message.warning('Thanh toán thiếu (bán nợ) phải chọn khách hàng'); setSheet(true); setTimeout(() => customerRef.current?.querySelector('input')?.focus(), 150); return; }
    if (paid > payable + 0.01) { message.warning('Tổng thanh toán vượt quá số tiền cần trả'); return; }
    setBusy(true);
    try {
      const pays = payments.map((p) => ({ method: p.method, amount: String(p.amount), reference: p.reference }));
      let inv: Invoice;
      if (tab.draftId) {
        const updated = await salesApi.updateInvoice(tab.draftId, { version: tab.draftVersion ?? 1, ...buildUpdate(tab) });
        inv = await salesApi.complete(updated.id, pays, updated.version);
      } else inv = await salesApi.checkout({ ...buildInput(tab), payments: pays });
      SALES_KEYS.forEach((k) => qc.invalidateQueries({ queryKey: [k] }));
      ['promotions', 'promotion', 'vouchers', 'promotion-report', 'customer-points'].forEach((k) => qc.invalidateQueries({ queryKey: [k] }));
      // loyalty: the receipt prints the balance left after this sale
      let pointsBalance: string | undefined;
      if (inv.customerId && (toNum(inv.pointsEarned) > 0 || toNum(inv.pointsRedeemed) > 0)) { try { pointsBalance = (await salesApi.customer(inv.customerId)).points; } catch { /* receipt without the balance */ } }
      setSheet(false);
      setReceipt({ inv, cashGiven: payMode === 'CASH' ? (cashGiven ?? payable) : undefined, pointsBalance });
      if (tab.draftId) closeTab(tab.id); else resetTab(tab.id); // a completed held order leaves the POS tab bar
      resetPayBox(); setVoucherInput(''); setVoucherErr(null);
      message.success(`Đã thanh toán ${inv.code}`);
    } catch (e) { handleApiError(e); } finally { setBusy(false); }
  };

  const hold = async () => {
    if (!tab || busy) return;
    const v = validate(tab); if (v) { message.warning(v); return; }
    setBusy(true);
    try {
      let inv: Invoice;
      if (tab.draftId) inv = await salesApi.updateInvoice(tab.draftId, { version: tab.draftVersion ?? 1, ...buildUpdate(tab) });
      else inv = await salesApi.hold(buildInput(tab));
      qc.invalidateQueries({ queryKey: ['invoices'] });
      message.success(`Đã giữ đơn ${inv.code}`);
      setSheet(false);
      closeTab(tab.id);
    } catch (e) { handleApiError(e); } finally { setBusy(false); }
  };

  const loadDraft = async (inv: Invoice) => {
    const existing = tabs.find((t) => t.draftId === inv.id);
    if (existing) { setActive(existing.id); return; }
    const lines: CartLine[] = await Promise.all((inv.lines ?? []).map(async (l) => {
      let units: CartLine['units'] = []; let batches: CartLine['batches'];
      try { const p = await catalogApi.product(l.variant.product.id); units = p.units ?? []; if (p.trackBatch) batches = await catalogApi.batches(l.variantId); } catch { /* ignore */ }
      return { key: uuid(), variantId: l.variantId, productId: l.variant.product.id, sku: l.variant.sku, barcode: l.variant.barcode, name: l.variant.name, productType: l.variant.product.type ?? 'GOODS', trackBatch: !!l.variant.product.trackBatch, baseUnit: l.variant.product.baseUnit, units, productUnitId: l.productUnitId ?? undefined, unitName: l.unitName, factor: toNum(l.conversionFactor) || 1, quantity: toNum(l.quantity), listPrice: toNum(l.listPrice), unitPrice: l.isGift ? 0 : toNum(l.unitPrice), discount: toNum(l.discountAmount), taxRate: toNum(l.taxRate), batchId: l.batchId ?? undefined, batches, note: l.note ?? undefined, isGift: !!l.isGift, promotionId: l.isGift ? l.promotionId ?? undefined : undefined };
    }));
    const voucherRow = inv.promotions?.find((p) => p.voucher || p.type === 'VOUCHER');
    addTab({ name: inv.code, draftId: inv.id, draftCode: inv.code, draftVersion: inv.version, customerId: inv.customerId ?? undefined, customerLabel: inv.customer?.name, sellerId: inv.sellerId ?? undefined, priceBookId: inv.priceBookId ?? undefined, discount: toNum(inv.discountAmount), note: inv.note ?? '', lines, voucherCode: inv.voucherCode ?? undefined, voucherLabel: voucherRow?.promotion?.name, redeemPoints: Math.floor(toNum(inv.pointsRedeemed)) || undefined });
  };

  // ---------------------------------------------------------------- promotions block actions
  const applyVoucher = async () => {
    const code = voucherInput.trim().toUpperCase();
    if (!code || !tab || !branchId) return;
    setVoucherBusy(true); setVoucherErr(null);
    try {
      const r = await promotionsApi.lookupVoucher({ code, branchId, customerId: tab.customerId });
      if (!r.valid) { setVoucherErr(r.reason ?? 'Mã voucher không hợp lệ'); return; }
      const benefit = r.promotion ? rewardText(r.promotion.config) : '';
      patch(() => ({ voucherCode: r.voucher?.code ?? code, voucherLabel: r.promotion ? `${r.promotion.name}${benefit ? ` · ${benefit}` : ''}` : undefined, voucherMinTotal: r.promotion?.config?.minTotal ? toNum(r.promotion.config.minTotal) : undefined, promosOff: false }));
      setVoucherInput('');
      message.success(`Đã áp dụng voucher ${r.voucher?.code ?? code}`);
    } catch (e) { setVoucherErr(errMsg(e)); } finally { setVoucherBusy(false); }
  };
  const clearVoucher = () => { patch(() => ({ voucherCode: undefined, voucherLabel: undefined, voucherMinTotal: undefined })); setVoucherErr(null); };
  const excludePromo = (p: { promotionId: string; code: string; name: string }) => patch((t) => ({ excluded: [...(t.excluded ?? []).filter((x) => x.id !== p.promotionId), { id: p.promotionId, code: p.code, name: p.name }], lines: t.lines.filter((l) => !(l.isGift && l.promotionId === p.promotionId)) }));
  const includePromo = (id: string) => patch((t) => ({ excluded: (t.excluded ?? []).filter((x) => x.id !== id) }));
  const togglePromos = (on: boolean) => {
    if (!tab) return;
    const gifts = tab.lines.filter((l) => l.isGift).length;
    patch((t) => ({ promosOff: !on, ...(on ? {} : { lines: t.lines.filter((l) => !l.isGift), voucherCode: undefined, voucherLabel: undefined, voucherMinTotal: undefined }) }));
    if (!on) { setVoucherErr(null); if (gifts || tab.voucherCode) message.info(`Đã tắt khuyến mãi tự động${gifts ? `, bỏ ${gifts} dòng hàng tặng` : ''}${tab.voucherCode ? ' và voucher' : ''}`); }
  };

  // ---------------------------------------------------------------- keyboard (desktop)
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const map: Record<string, () => void> = {
        F2: () => addTab(), F3: () => searchRef.current?.focus(), F4: () => customerRef.current?.querySelector('input')?.focus(), F6: () => discountRef.current?.focus?.(),
        F7: () => void hold(), F9: () => void checkout(), Escape: () => { if (receipt) setReceipt(null); else if (sheet) setSheet(false); },
      };
      const fn = map[e.key];
      if (fn) { e.preventDefault(); fn(); }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  });

  if (!me) return <div style={{ display: 'flex', justifyContent: 'center', padding: 80 }}><Spin size="large" /></div>;
  const canDiscount = can('invoice.discount');
  const canPrice = can('invoice.price.edit');
  const shiftMenu = { items: [shift ? { key: 'close', label: 'Đóng ca & đối soát', onClick: () => setShiftClose(true), disabled: !can('shift.close') } : { key: 'open', label: 'Mở ca bán hàng', onClick: () => setShiftOpen(true), disabled: !can('shift.open') }, { key: 'list', label: <Link to="/shifts">Danh sách ca</Link> }] };
  const voucherApplied = applied.some((a) => a.type === 'VOUCHER');
  const voucherPending = !!tab?.voucherCode && !tab.promosOff && fresh && !voucherApplied && !voucherErr;

  const batchSelect = (l: CartLine, width: number | string = 130) => (
    <Select size={isMobile ? 'middle' : 'small'} style={{ minWidth: width }} placeholder="Chọn lô" value={l.batchId} status={l.batchId ? undefined : 'error'} onChange={(batchId) => setLine(l.key, { batchId })} options={(l.batches ?? []).map((b) => ({ value: b.id, label: `${b.batchNo}${b.expiryDate ? ` · HSD ${dt(b.expiryDate, 'DD/MM/YY')}` : ''}` }))} onDropdownVisibleChange={async (o) => { if (o && !l.batches) try { const bs = await catalogApi.batches(l.variantId); setLine(l.key, { batches: bs }); } catch { /* ignore */ } }} />
  );
  const unitSelect = (l: CartLine) => l.units.length && !l.isGift ? <Select size={isMobile ? 'middle' : 'small'} style={{ width: 110 }} value={l.productUnitId ?? ''} onChange={(v) => changeUnit(l, v || undefined)} options={[{ value: '', label: l.baseUnit ?? 'Cơ bản' }, ...l.units.map((u) => ({ value: u.id!, label: u.unitName }))]} /> : <span>{l.unitName ?? l.baseUnit ?? ''}</span>;
  const qtyBox = (l: CartLine) => {
    const max = l.isGift ? giftMax(l) : undefined;
    const setQ = (q: number) => setLine(l.key, { quantity: max !== undefined ? Math.min(Math.max(0.001, q), max) : Math.max(0.001, q) });
    return (
      <span className="pos-qty">
        <Button size={isMobile ? 'middle' : 'small'} icon={<MinusOutlined />} onClick={() => setQ(l.quantity - 1)} />
        <InputNumber size={isMobile ? 'middle' : 'small'} min={0.001} max={max} controls={false} value={l.quantity} onChange={(v) => setQ(toNum(v))} style={{ width: isMobile ? 64 : 56 }} inputMode="decimal" />
        <Button size={isMobile ? 'middle' : 'small'} icon={<PlusOutlined />} disabled={max !== undefined && l.quantity >= max} title={max !== undefined && l.quantity >= max ? 'Đã hết số lượng được tặng' : undefined} onClick={() => setQ(l.quantity + 1)} />
      </span>
    );
  };
  /** line total with the promotion discount (gross struck through → net) */
  const totalCell = (l: CartLine, i: number) => {
    if (l.isGift) return <span className="tot">0 <span className="pos-km-badge gift">Hàng tặng</span></span>;
    const pl = lineInfo(i); const promo = pl ? toNum(pl.promotionDiscount) : 0;
    if (promo > 0 && pl) return <span className="tot"><span className="pos-km-strike">{money(lineTotal(l))}</span>{money(pl.lineTotal)}<span className="pos-km-badge">KM −{money(promo)}</span></span>;
    return <span className="tot">{money(lineTotal(l))}</span>;
  };
  const priceCell = (l: CartLine, size: 'small' | 'middle', width?: number) => {
    if (l.isGift) return <span><span className="pos-km-strike">{money(l.listPrice)}</span>0</span>;
    return canPrice ? <MoneyInput size={size} style={width ? { width } : undefined} value={l.unitPrice} onChange={(v) => setLine(l.key, { unitPrice: toNum(v) })} /> : <span>{money(l.unitPrice)}{l.unitPrice !== l.listPrice && <span className="muted" style={{ fontSize: 11, textDecoration: 'line-through', marginLeft: 4 }}>{money(l.listPrice)}</span>}</span>;
  };
  const tabChips = (
    <>
      {tabs.map((t) => (
        <span key={t.id} className={`pos-tab${t.id === tab?.id ? ' active' : ''}`} onClick={() => setActive(t.id)}>
          {t.name}{t.lines.length > 0 && <Badge count={t.lines.length} size="small" style={{ marginLeft: 6, background: t.id === tab?.id ? '#fff' : '#9ca3af', color: '#0f3d8a' }} />}
          <CloseOutlined className="pos-tab-close" onClick={(e) => { e.stopPropagation(); closeTab(t.id); }} />
        </span>
      ))}
      <Tooltip title="Thêm hóa đơn (F2)"><span className="pos-tab add" onClick={() => addTab()}><PlusOutlined /></span></Tooltip>
    </>
  );

  /** "Quà tặng" prompt: gifts the cart has earned but not yet claimed. */
  const giftPrompt = giftOffers.length > 0 && (
    <div className="pos-km-gifts">
      <div className="ttl"><GiftOutlined /> Quà tặng cho đơn này</div>
      {giftOffers.map((g) => (
        <div key={g.promotionId} className="pos-km-gift">
          <span className="nm">{g.name} <span className="muted">· còn {fq(g.remaining)} {toNum(g.discountPercent) < 100 ? `(giảm ${toNum(g.discountPercent)}%)` : ''}</span></span>
          <span className="btns">{g.variants.map((v) => <Button key={v.id} size="small" type="primary" ghost icon={<PlusOutlined />} onClick={() => addGift(g, v)}>Thêm quà: {v.name}</Button>)}</span>
        </div>
      ))}
    </div>
  );

  /** "Khuyến mãi" block: applied programmes (with opt-out), excluded ones, voucher input, auto switch. */
  const promoBlock = (
    <div className="pos-km">
      <div className="pos-row"><b><TagOutlined /> Khuyến mãi</b><span className="pos-km-auto"><span className="muted">Tự động</span><Switch size="small" checked={!tab?.promosOff} onChange={togglePromos} /></span></div>
      {tab?.promosOff ? <div className="kv-hint">Đã tắt khuyến mãi tự động cho đơn này (không áp dụng voucher / quà tặng).</div> : (
        <>
          {applied.map((a) => (
            <div key={a.promotionId} className="pos-km-item">
              <span className="nm">{a.type === 'VOUCHER' ? `Voucher ${tab?.voucherCode ?? ''} · ` : ''}{a.name}<span className="kv-hint"> · {a.code}</span></span>
              <span className="amt">{toNum(a.amount) > 0 ? `−${money(a.amount)}` : ''}{toNum(a.giftQuantity) > 0 ? `${toNum(a.amount) > 0 ? ' · ' : ''}${fq(a.giftQuantity)} quà` : ''}</span>
              {a.type !== 'VOUCHER' && <Button size="small" type="text" icon={<CloseOutlined />} title="Không áp dụng khuyến mãi này" onClick={() => excludePromo(a)} />}
            </div>
          ))}
          {(tab?.excluded ?? []).map((x) => (
            <div key={x.id} className="pos-km-item off"><span className="nm"><s>{x.name}</s><span className="kv-hint"> · {x.code}</span></span><Button size="small" type="link" onClick={() => includePromo(x.id)}>Áp dụng lại</Button></div>
          ))}
          {!applied.length && !tab?.excluded?.length && tab?.lines.length ? <div className="kv-hint">{previewing ? 'Đang tính khuyến mãi…' : previewErr && previewErr.code !== 'VOUCHER_INVALID' ? `Chưa tính được khuyến mãi: ${previewErr.message}` : 'Không có khuyến mãi tự động cho đơn này'}</div> : null}
          <div className="pos-km-voucher">
            {tab?.voucherCode ? (
              <div className="pos-km-item voucher"><span className="nm"><b className="code">{tab.voucherCode}</b>{tab.voucherLabel ? <span className="kv-hint"> · {tab.voucherLabel}</span> : null}</span><Button size="small" type="text" icon={<CloseOutlined />} title="Bỏ voucher" onClick={clearVoucher} /></div>
            ) : (
              <Space.Compact style={{ width: '100%' }}>
                <Input placeholder="Mã voucher / mã giảm giá" value={voucherInput} onChange={(e) => { setVoucherInput(e.target.value.toUpperCase()); if (voucherErr) setVoucherErr(null); }} onPressEnter={applyVoucher} allowClear style={{ textTransform: 'uppercase' }} />
                <Button onClick={applyVoucher} loading={voucherBusy} disabled={!voucherInput.trim()}>Áp dụng</Button>
              </Space.Compact>
            )}
            {voucherErr && <div className="neg" style={{ fontSize: 12 }}>{voucherErr}</div>}
            {voucherPending && <div className="pos-km-hint">Voucher chưa đủ điều kiện{tab?.voucherMinTotal ? ` (hóa đơn tối thiểu ${money(tab.voucherMinTotal)})` : ''}</div>}
          </div>
        </>
      )}
    </div>
  );

  /** "Điểm tích lũy" block (BR-141): balance, max redeemable, points input + "Dùng tối đa", value paid with points, points to be earned. */
  const loyaltyBlock = loyalty && tab?.customerId ? (
    <div className="pos-lp">
      <div className="pos-row"><b><GiftOutlined /> Điểm tích lũy</b><span className="pos-lp-bal">{previewing && <Spin size="small" style={{ marginRight: 6 }} />}Điểm: <b>{pts(loyalty.balance)}</b>{maxPts > 0 ? <> · dùng tối đa <b>{pts(maxPts)}</b></> : null}</span></div>
      {maxPts > 0 ? (
        <div className="pos-row pos-lp-input">
          <span className="muted">Dùng điểm</span>
          <Space.Compact>
            <InputNumber min={0} max={maxPts} step={1} precision={0} value={tab.redeemPoints ?? 0} inputMode="numeric" style={{ width: 110 }} onFocus={(e) => e.target.select()} onChange={(v) => { const n = Math.min(maxPts, Math.max(0, Math.floor(toNum(v)))); patch(() => ({ redeemPoints: n > 0 ? n : undefined })); }} />
            <Button disabled={(tab.redeemPoints ?? 0) >= maxPts} onClick={() => patch(() => ({ redeemPoints: maxPts }))}>Dùng tối đa</Button>
            {tab.redeemPoints ? <Button icon={<CloseOutlined />} title="Bỏ dùng điểm" onClick={() => patch(() => ({ redeemPoints: undefined }))} /> : null}
          </Space.Compact>
        </div>
      ) : <div className="kv-hint">{toNum(loyalty.balance) <= 0 ? 'Khách chưa có điểm để dùng' : loyalty.minRedeem > toNum(loyalty.balance) ? `Cần tối thiểu ${pts(loyalty.minRedeem)} điểm mới được dùng` : 'Chưa dùng được điểm cho đơn này'}</div>}
      {pointsValue > 0 && <div className="pos-row"><span>Thanh toán bằng điểm <span className="muted">({pts(loyalty.redeemPoints)} điểm × {money(loyalty.pointValue)})</span></span><b className="pos">−{money(pointsValue)}</b></div>}
      <div className="pos-lp-earn">Sẽ tích <b>+{pts(loyalty.earnPreview)} điểm</b> cho khách khi thanh toán{loyalty.pointValue ? <span className="muted"> · 1 điểm = {money(loyalty.pointValue)} đ</span> : null}</div>
    </div>
  ) : null;

  /** Customer / seller / warehouse / price book / totals / payment / actions – the desktop right column and the phone bottom sheet. */
  const sidePanel = (
    <aside className="pos-side">
      <div className="pos-row"><span className="muted">Nhân viên bán</span>
        {sellers.length ? <Select size="small" style={{ width: 200 }} value={tab?.sellerId ?? me.user.id} onChange={(v) => patch(() => ({ sellerId: v }))} options={[{ value: me.user.id, label: me.user.fullName }, ...sellers.filter((u) => u.id !== me.user.id).map((u) => ({ value: u.id, label: u.fullName }))]} /> : <b>{me.user.fullName}</b>}
      </div>
      <div className="pos-row"><span className="muted">Kho</span>
        <Select size="small" style={{ width: 200 }} value={warehouseId} onChange={(v) => setWarehouse(v)} options={warehouses.map((w) => ({ value: w.id, label: w.name }))} />
      </div>
      <div ref={customerRef} style={{ marginTop: 6 }}>
        <CustomerSelect value={tab?.customerId} placeholder="Khách lẻ – tìm theo SĐT / tên (F4)" onChange={(id, c) => patch((t) => ({ customerId: id, customerLabel: c ? `${c.name}${c.groupName ? ` · ${c.groupName}` : ''}${c.balance !== undefined && Number(c.balance) !== 0 ? ` · nợ ${money(c.balance)}` : ''}` : undefined, redeemPoints: id === t.customerId ? t.redeemPoints : undefined }))} />
        {tab?.customerLabel && <div className="kv-hint" style={{ marginTop: 2 }}>{tab.customerLabel}</div>}
      </div>
      {canPriceBook && priceBookOptions.length > 0 && <div className="pos-row"><span className="muted">Bảng giá</span><Select size="small" allowClear style={{ width: 200 }} placeholder="Giá chung" value={tab?.priceBookId} onChange={(v) => void changePriceBook(v)} options={priceBookOptions} /></div>}
      {tab?.priceBookAuto && tab.priceBookId && <div className="kv-hint" style={{ textAlign: 'right' }}>Bảng giá chọn tự động theo nhóm khách – có thể đổi</div>}

      <div className="pos-totals">
        <div className="pos-row"><span>Tổng tiền hàng <span className="muted">({tab?.lines.reduce((s, l) => s + l.quantity, 0) ?? 0} SL)</span></span><b>{money(totals.subtotal)}</b></div>
        {canDiscount && <div className="pos-row"><span>Giảm giá hóa đơn</span><MoneyInput ref={discountRef} size="small" style={{ width: 140 }} value={tab?.discount ?? 0} max={totals.subtotal} onChange={(v) => patch(() => ({ discount: Math.min(toNum(v), totals.subtotal) }))} /></div>}
        {totals.promo > 0 && <div className="pos-row"><span>Khuyến mãi{voucherApplied ? ' + voucher' : ''}</span><b className="pos">−{money(totals.promo)}</b></div>}
        {totals.tax > 0 && <div className="pos-row muted"><span>{priceIncludesTax ? 'Trong đó thuế' : 'Thuế'}</span><span>{money(totals.tax)}</span></div>}
        {pointsValue > 0 && <><div className="pos-row pos-lp-total"><span>Tổng hóa đơn</span><span>{money(totals.total)}</span></div><div className="pos-row"><span>Thanh toán bằng điểm</span><b className="pos">−{money(pointsValue)}</b></div></>}
        <div className="pos-row pos-grand"><span>Khách cần trả</span><span>{previewing && <Spin size="small" style={{ marginRight: 8 }} />}{money(payable)}</span></div>
        {previewErr && previewErr.code !== 'VOUCHER_INVALID' && !previewing && <div className="pos-km-hint">Chưa tính được khuyến mãi: {previewErr.message}</div>}
      </div>

      {promoBlock}
      {loyaltyBlock}

      <div className="pos-pay">
        <div className="pos-chips">
          {METHODS.map((m) => <span key={m} className={`pos-chip${payMode === m ? ' on' : ''}`} onClick={() => setPayMode(m)}>{PAYMENT_METHOD_LABEL[m]}</span>)}
          <span className={`pos-chip${payMode === 'MIXED' ? ' on' : ''}`} onClick={() => setPayMode('MIXED')}>Kết hợp</span>
        </div>
        {payMode === 'CASH' && (
          <>
            <div className="pos-row"><span>Tiền khách đưa</span><MoneyInput size="large" style={{ width: 170 }} value={cashGiven ?? payable} onChange={(v) => setCashGiven(v === null || v === undefined ? null : toNum(v))} onFocus={(e) => e.target.select()} /></div>
            {payable > 0 && <div className="pos-suggest">{suggest(payable).map((v) => <span key={v} className="pos-chip small" onClick={() => setCashGiven(v)}>{money(v)}</span>)}</div>}
            {change > 0 && <div className="pos-row"><span>Tiền thừa trả khách</span><b className="pos">{money(change)}</b></div>}
          </>
        )}
        {payMode !== 'CASH' && payMode !== 'MIXED' && (
          <>
            <div className="pos-row"><span>Số tiền</span><MoneyInput size="large" style={{ width: 170 }} value={single.amount ?? payable} max={payable} onChange={(v) => setSingle((s) => ({ ...s, amount: v === null || v === undefined ? null : Math.min(toNum(v), payable) }))} /></div>
            <Input size="small" placeholder="Tham chiếu (mã GD, 4 số cuối thẻ…)" value={single.reference} onChange={(e) => setSingle((s) => ({ ...s, reference: e.target.value }))} />
          </>
        )}
        {payMode === 'MIXED' && (
          <div style={{ display: 'grid', gap: 6 }}>
            {mixed.map((m, i) => (
              <div key={i} className="pos-row" style={{ gap: 6 }}>
                <Select size="small" style={{ width: 130 }} value={m.method} onChange={(v) => setMixed((ms) => ms.map((x, j) => (j === i ? { ...x, method: v } : x)))} options={METHODS.map((x) => ({ value: x, label: PAYMENT_METHOD_LABEL[x] }))} />
                <MoneyInput size="small" style={{ flex: 1 }} value={m.amount} onChange={(v) => setMixed((ms) => ms.map((x, j) => (j === i ? { ...x, amount: toNum(v) } : x)))} />
                <Button size="small" type="text" danger icon={<DeleteOutlined />} disabled={mixed.length <= 1} onClick={() => setMixed((ms) => ms.filter((_, j) => j !== i))} />
              </div>
            ))}
            {mixed.length < 3 && <Button size="small" type="dashed" icon={<PlusOutlined />} onClick={() => setMixed((ms) => [...ms, { method: 'CARD', amount: 0 }])}>Thêm phương thức</Button>}
            <div className="pos-row muted"><span>Đã nhập</span><span>{money(paid)}</span></div>
          </div>
        )}
        {due > 0 && <div className={`pos-row ${tab?.customerId ? 'pos-due' : 'neg'}`}><span>{tab?.customerId ? 'Còn nợ (ghi vào công nợ khách)' : 'Còn thiếu – chọn khách hàng để bán nợ'}</span><b>{money(due)}</b></div>}
      </div>

      <div className="pos-actions">
        {can('invoice.create') && <Button size="large" icon={<SaveOutlined />} onClick={hold} loading={busy} disabled={!tab?.lines.length}>{isMobile ? 'Giữ đơn' : 'Giữ đơn (F7)'}</Button>}
        <Button size="large" type="primary" className="pos-pay-btn" onClick={checkout} loading={busy} disabled={!tab?.lines.length || !can('invoice.complete')}>{isMobile ? 'THANH TOÁN' : 'THANH TOÁN (F9)'}</Button>
      </div>
      {tab?.draftId && <div className="kv-hint" style={{ textAlign: 'center' }}>Đang mở đơn giữ {tab.draftCode}</div>}
    </aside>
  );

  return (
    <div className="pos-app">
      <header className="pos-header">
        <Link to="/" className="pos-brand"><HomeOutlined /> Quản lý</Link>
        <div className="pos-search"><ProductSearch ref={searchRef} onPick={addHit} warehouseId={warehouseId} autoFocus={!isMobile} size="middle" placeholder="Tìm hàng (F3) hoặc quét mã vạch rồi Enter" /></div>
        <div className="pos-tabs">{tabChips}</div>
        <div className="pos-header-right">
          <Dropdown menu={shiftMenu} trigger={['click']}><span className="pos-shift"><ClockCircleOutlined /> {shift ? (isMobile ? `Ca ${shift.code}` : `Ca ${shift.code} · mở ${dt(shift.openedAt, 'HH:mm')}`) : 'Chưa mở ca'}</span></Dropdown>
          <Button size="small" icon={<FileTextOutlined />} onClick={() => setHeld(true)}>{isMobile ? '' : 'Đơn giữ'}</Button>
          {can('return.create') && <Button size="small" icon={<RollbackOutlined />} title="Trả hàng / Đổi hàng" onClick={() => nav('/sales-returns/new')}>{isMobile ? '' : 'Trả hàng'}</Button>}
          <span className="pos-user"><UserOutlined /> {me.user.fullName}</span>
        </div>
      </header>
      {isMobile && (
        <>
          <div className="pos-mtabs">{tabChips}</div>
          <div className="pos-msearch"><ProductSearch ref={searchRef} onPick={addHit} warehouseId={warehouseId} size="large" placeholder="Tìm hàng hoặc quét mã vạch" /></div>
        </>
      )}

      <div className="pos-body">
        <div className="pos-cart">
          {isMobile ? (
            <div className="pos-mcart">
              {giftPrompt}
              {!tab?.lines.length && <div className="muted" style={{ textAlign: 'center', padding: '40px 12px', background: '#fff', borderRadius: 8 }}>Giỏ hàng trống – tìm hàng hoặc quét mã vạch để bắt đầu</div>}
              {(tab?.lines ?? []).map((l, i) => (
                <div key={l.key} className={`pos-mline${l.error ? ' error' : ''}${l.isGift ? ' gift' : ''}`}>
                  <div>
                    <div className="nm">{i + 1}. {l.name}{l.isGift && <Tag color="green" style={{ marginLeft: 6 }}>Hàng tặng</Tag>}{l.productType !== 'GOODS' && <Tag style={{ marginLeft: 6 }}>{l.productType === 'SERVICE' ? 'Dịch vụ' : 'Combo'}</Tag>}</div>
                    <div className="meta"><span>{l.sku}</span>{unitSelect(l)}{l.trackBatch && batchSelect(l, 120)}</div>
                  </div>
                  <DeleteOutlined className="del" onClick={() => removeLine(l.key)} />
                  <div className="row">
                    {qtyBox(l)}
                    <div style={{ textAlign: 'right' }}>{priceCell(l, 'middle', 130)}</div>
                  </div>
                  <div className="row">
                    {canDiscount && !l.isGift ? <span className="meta">Giảm <MoneyInput size="small" style={{ width: 110 }} value={l.discount} max={l.quantity * l.unitPrice} onChange={(v) => setLine(l.key, { discount: Math.min(toNum(v), l.quantity * l.unitPrice) })} /></span> : <span />}
                    {totalCell(l, i)}
                  </div>
                  {l.error && <div className="err">{l.error}</div>}
                </div>
              ))}
            </div>
          ) : (
            <>
              {giftPrompt}
              <Table size="small" rowKey="key" pagination={false} dataSource={tab?.lines ?? []} locale={{ emptyText: <div style={{ padding: 40 }} className="muted">Giỏ hàng trống – tìm hàng hoặc quét mã vạch để bắt đầu</div> }} rowClassName={(l) => `${l.error ? 'pos-line-error' : ''}${l.isGift ? ' pos-km-giftrow' : ''}`}
                columns={[
                  { title: '#', width: 36, render: (_, __, i) => i + 1 },
                  { title: 'Mã hàng', dataIndex: 'sku', width: 110, render: (v, l) => <><div style={{ fontWeight: 500 }}>{v}</div>{l.error && <div className="neg" style={{ fontSize: 11 }}>{l.error}</div>}</> },
                  { title: 'Tên hàng', dataIndex: 'name', render: (v, l) => <div>{v}{l.isGift && <Tag color="green" style={{ marginLeft: 6 }}><GiftOutlined /> Hàng tặng</Tag>}{l.productType !== 'GOODS' && <Tag style={{ marginLeft: 6 }}>{l.productType === 'SERVICE' ? 'Dịch vụ' : 'Combo'}</Tag>}{l.trackBatch && <span style={{ marginLeft: 6 }}>{batchSelect(l)}</span>}</div> },
                  { title: 'ĐVT', width: 110, render: (_, l) => unitSelect(l) },
                  { title: 'SL', width: 130, render: (_, l) => qtyBox(l) },
                  { title: 'Đơn giá', width: 120, className: 'num', render: (_, l) => priceCell(l, 'small') },
                  ...(canDiscount ? [{ title: 'Giảm giá', width: 110, className: 'num', render: (_: unknown, l: CartLine) => l.isGift ? '' : <MoneyInput size="small" value={l.discount} max={l.quantity * l.unitPrice} onChange={(v) => setLine(l.key, { discount: Math.min(toNum(v), l.quantity * l.unitPrice) })} /> }] : []),
                  { title: 'Thành tiền', width: 150, className: 'num', render: (_, l, i) => <b>{totalCell(l, i)}</b> },
                  { title: '', width: 36, render: (_, l) => <Button size="small" type="text" danger icon={<DeleteOutlined />} onClick={() => removeLine(l.key)} /> },
                ]} />
            </>
          )}
          <div className="pos-cart-foot">
            <Input.TextArea rows={1} placeholder="Ghi chú đơn hàng" value={tab?.note ?? ''} onChange={(e) => patch(() => ({ note: e.target.value }))} style={{ flex: 1 }} autoSize />
            <span className="kv-hint"><span className="kv-kbd">F2</span>Thêm HĐ <span className="kv-kbd">F3</span>Tìm hàng <span className="kv-kbd">F4</span>Khách <span className="kv-kbd">F6</span>Giảm giá <span className="kv-kbd">F7</span>Giữ đơn <span className="kv-kbd">F9</span>Thanh toán</span>
          </div>
        </div>

        {!isMobile && sidePanel}
      </div>

      {isMobile && (
        <>
          <div className="pos-mbar">
            <Button icon={<UserOutlined />} onClick={() => { setSheet(true); setTimeout(() => customerRef.current?.querySelector('input')?.focus(), 200); }} aria-label="Khách hàng" />
            <div className="sum" onClick={() => setSheet(true)}>
              <div className="lbl">{tab?.customerLabel ? tab.customerLabel : 'Khách lẻ'} · {tab?.lines.reduce((s, l) => s + l.quantity, 0) ?? 0} SL{totals.promo > 0 ? ` · KM −${money(totals.promo)}` : ''}{pointsValue > 0 ? ` · điểm −${money(pointsValue)}` : ''}</div>
              <div className="amt">{previewing && <Spin size="small" style={{ marginRight: 6 }} />}{money(payable)}</div>
            </div>
            <Button type="primary" className="pos-pay-btn" icon={<WalletOutlined />} disabled={!tab?.lines.length || !can('invoice.complete')} onClick={() => setSheet(true)}>THANH TOÁN</Button>
          </div>
          <Drawer className="pos-sheet" placement="bottom" height="92%" open={sheet} onClose={() => setSheet(false)} title={`Thanh toán · ${money(payable)}`} destroyOnClose={false}>
            {sidePanel}
          </Drawer>
        </>
      )}

      <ShiftOpenModal open={shiftOpen} branchId={branchId} onClose={() => setShiftOpen(false)} onOpened={() => refetchShift()} />
      <ShiftCloseModal open={shiftClose} shiftId={shift?.id} onClose={() => setShiftClose(false)} onClosed={() => refetchShift()} />
      <HeldOrdersDrawer open={held} branchId={branchId} onClose={() => setHeld(false)} onReopen={(inv) => void loadDraft(inv)} />
      <ReceiptModal invoice={receipt?.inv ?? null} cashGiven={receipt?.cashGiven} pointsBalance={receipt?.pointsBalance} onClose={() => { setReceipt(null); if (!isMobile) searchRef.current?.focus(); }} />
      {!branchId && <div className="pos-blocker">Chưa có chi nhánh · <a onClick={() => nav('/')}>về trang quản lý</a></div>}
    </div>
  );
}
