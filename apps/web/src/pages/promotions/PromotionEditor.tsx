import { Alert, App, Button, Checkbox, DatePicker, Form, Input, InputNumber, Modal, Select, Switch, Tabs, TimePicker, TreeSelect } from 'antd';
import { DeleteOutlined, PlusOutlined } from '@ant-design/icons';
import dayjs, { Dayjs } from 'dayjs';
import { useEffect, useMemo, useState } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import { useCategories } from '../../api/catalog';
import { errMsg } from '../../api/client';
import { useBranches } from '../../api/org';
import { BuyXGetYConfig, InvoiceDiscountConfig, InvoiceGiftConfig, PROMOTION_KEYS, PROMOTION_TYPE_LABEL, PROMOTION_TYPES, ProductDiscountConfig, PromotionConfig, PromotionDetail, PromotionInput, PromotionType, VariantLite, VoucherConfig, promotionsApi } from '../../api/promotions';
import { useCustomerGroups } from '../../api/sales';
import type { Category, SearchHit } from '../../api/types';
import { MoneyInput, QuantityInput } from '../../components/Inputs';
import { ProductSearch } from '../../components/ProductSearch';
import { useIsMobile } from '../../hooks/useMedia';
import { money, toNum } from '../../utils/format';
import { DAY_LABELS, dec } from './promoText';
import { VouchersPanel } from './VouchersPanel';

// ---------------------------------------------------------------- building blocks
type Mode = 'percent' | 'amount' | 'fixed';
interface TierRow { minTotal: number; mode: Mode; value: number | null; maxDiscount: number | null }
interface GiftRow { variant: VariantLite; quantity: number }
interface GiftTierRow { minTotal: number; gifts: GiftRow[] }
interface ConfigState {
  tiers: TierRow[]; giftTiers: GiftTierRow[];
  variants: VariantLite[]; categoryIds: string[]; minQuantity: number | null; maxQuantity: number | null;
  rewardMode: Mode; rewardValue: number | null; maxDiscount: number | null; minTotal: number | null;
  buyVariants: VariantLite[]; buyCategoryIds: string[]; buyQuantity: number; getVariants: VariantLite[]; getQuantity: number; getPercent: number; maxRepeats: number | null; applyToCart: boolean;
}
const emptyConfig = (): ConfigState => ({
  tiers: [{ minTotal: 0, mode: 'percent', value: null, maxDiscount: null }], giftTiers: [{ minTotal: 0, gifts: [] }],
  variants: [], categoryIds: [], minQuantity: null, maxQuantity: null, rewardMode: 'percent', rewardValue: null, maxDiscount: null, minTotal: null,
  buyVariants: [], buyCategoryIds: [], buyQuantity: 2, getVariants: [], getQuantity: 1, getPercent: 100, maxRepeats: null, applyToCart: true,
});
const modeOf = (r: { discountPercent?: string; discountAmount?: string; fixedPrice?: string }): Mode => (r.fixedPrice !== undefined ? 'fixed' : r.discountAmount !== undefined ? 'amount' : 'percent');
const valueOf = (r: { discountPercent?: string; discountAmount?: string; fixedPrice?: string }): number | null => (r.fixedPrice !== undefined ? toNum(r.fixedPrice) : r.discountAmount !== undefined ? toNum(r.discountAmount) : r.discountPercent !== undefined ? toNum(r.discountPercent) : null);
const optNum = (v?: string | null) => (v === undefined || v === null || v === '' ? null : toNum(v));

/** Load the editor state from a saved promotion (variant names come from `variants` of the detail endpoint). */
function fromPromotion(p: PromotionDetail): ConfigState {
  const s = emptyConfig();
  const v = (id: string): VariantLite => p.variants.find((x) => x.id === id) ?? { id, sku: '', name: `Hàng hóa ${id.slice(0, 8)}`, sellPrice: '0' };
  const c = p.config as unknown as Record<string, unknown>;
  if (p.type === 'INVOICE_DISCOUNT') s.tiers = ((c as unknown as InvoiceDiscountConfig).tiers ?? []).map((t) => ({ minTotal: toNum(t.minTotal), mode: modeOf(t), value: valueOf(t), maxDiscount: optNum(t.maxDiscount) }));
  if (p.type === 'INVOICE_GIFT') s.giftTiers = ((c as unknown as InvoiceGiftConfig).tiers ?? []).map((t) => ({ minTotal: toNum(t.minTotal), gifts: (t.gifts ?? []).map((g) => ({ variant: v(g.variantId), quantity: toNum(g.quantity) })) }));
  if (p.type === 'PRODUCT_DISCOUNT' || p.type === 'VOUCHER') {
    const x = c as unknown as ProductDiscountConfig & VoucherConfig;
    s.variants = (x.variantIds ?? []).map(v); s.categoryIds = x.categoryIds ?? []; s.minQuantity = optNum(x.minQuantity); s.maxQuantity = optNum(x.maxQuantity);
    s.rewardMode = modeOf(x); s.rewardValue = valueOf(x); s.maxDiscount = optNum(x.maxDiscount); s.minTotal = optNum(x.minTotal);
  }
  if (p.type === 'BUY_X_GET_Y') {
    const x = c as unknown as BuyXGetYConfig;
    s.buyVariants = (x.buy?.variantIds ?? []).map(v); s.buyCategoryIds = x.buy?.categoryIds ?? []; s.buyQuantity = toNum(x.buy?.quantity) || 1;
    s.getVariants = (x.get?.variantIds ?? []).map(v); s.getQuantity = toNum(x.get?.quantity) || 1; s.getPercent = x.get?.discountPercent !== undefined ? toNum(x.get.discountPercent) : 100;
    s.maxRepeats = x.maxRepeats ?? null; s.applyToCart = x.applyToCart !== false;
  }
  return s;
}

const rewardOf = (mode: Mode, value: number | null, maxDiscount: number | null, allowFixed: boolean, where: string) => {
  if (value === null || !(value > 0) && mode !== 'fixed') throw new Error(`${where}: nhập mức giảm`);
  if (mode === 'percent' && value > 100) throw new Error(`${where}: % giảm tối đa 100`);
  if (mode === 'fixed' && !allowFixed) throw new Error(`${where}: không hỗ trợ giá cố định`);
  return { ...(mode === 'percent' ? { discountPercent: dec(value) } : mode === 'amount' ? { discountAmount: dec(value) } : { fixedPrice: dec(value ?? 0) }), ...(maxDiscount && mode !== 'fixed' ? { maxDiscount: dec(maxDiscount) } : {}) };
};

/** Editor state → API config; throws a Vietnamese message when something is missing. */
function toConfig(type: PromotionType, s: ConfigState): PromotionConfig {
  if (type === 'INVOICE_DISCOUNT') {
    if (!s.tiers.length) throw new Error('Thêm ít nhất một mức hóa đơn');
    return { tiers: s.tiers.map((t, i) => ({ minTotal: dec(t.minTotal) ?? '0', ...rewardOf(t.mode, t.value, t.maxDiscount, false, `Mức ${i + 1}`) })) };
  }
  if (type === 'INVOICE_GIFT') {
    if (!s.giftTiers.length) throw new Error('Thêm ít nhất một mức hóa đơn');
    return { tiers: s.giftTiers.map((t, i) => { if (!t.gifts.length) throw new Error(`Mức ${i + 1}: chọn hàng tặng`); if (t.gifts.some((g) => !(g.quantity > 0))) throw new Error(`Mức ${i + 1}: số lượng tặng phải > 0`); return { minTotal: dec(t.minTotal) ?? '0', gifts: t.gifts.map((g) => ({ variantId: g.variant.id, quantity: dec(g.quantity)! })) }; }) };
  }
  if (type === 'PRODUCT_DISCOUNT') {
    if (!s.variants.length && !s.categoryIds.length) throw new Error('Chọn hàng hóa hoặc nhóm hàng được giảm giá');
    return { ...(s.variants.length ? { variantIds: s.variants.map((v) => v.id) } : {}), ...(s.categoryIds.length ? { categoryIds: s.categoryIds } : {}), ...(s.minQuantity ? { minQuantity: dec(s.minQuantity) } : {}), ...(s.maxQuantity ? { maxQuantity: dec(s.maxQuantity) } : {}), ...rewardOf(s.rewardMode, s.rewardValue, s.maxDiscount, true, 'Giảm giá') };
  }
  if (type === 'BUY_X_GET_Y') {
    if (!s.buyVariants.length && !s.buyCategoryIds.length) throw new Error('Chọn hàng hóa / nhóm hàng phải mua');
    if (!(s.buyQuantity > 0)) throw new Error('Số lượng mua phải > 0');
    if (!s.getVariants.length) throw new Error('Chọn hàng tặng');
    if (!(s.getQuantity > 0)) throw new Error('Số lượng tặng phải > 0');
    if (!(s.getPercent > 0 && s.getPercent <= 100)) throw new Error('% giảm hàng tặng phải trong 1–100');
    return { buy: { ...(s.buyVariants.length ? { variantIds: s.buyVariants.map((v) => v.id) } : {}), ...(s.buyCategoryIds.length ? { categoryIds: s.buyCategoryIds } : {}), quantity: dec(s.buyQuantity)! }, get: { variantIds: s.getVariants.map((v) => v.id), quantity: dec(s.getQuantity)!, ...(s.getPercent < 100 ? { discountPercent: dec(s.getPercent) } : {}) }, ...(s.maxRepeats ? { maxRepeats: Math.floor(s.maxRepeats) } : {}), applyToCart: s.applyToCart };
  }
  // VOUCHER
  return { ...rewardOf(s.rewardMode, s.rewardValue, s.maxDiscount, false, 'Voucher'), ...(s.minTotal ? { minTotal: dec(s.minTotal) } : {}), ...(s.variants.length ? { variantIds: s.variants.map((v) => v.id) } : {}), ...(s.categoryIds.length ? { categoryIds: s.categoryIds } : {}) };
}

/** Product multi-pick: search box + removable rows. */
export function ProductPickList({ value, onChange, placeholder = 'Tìm hàng hóa để thêm', goodsOnly }: { value: VariantLite[]; onChange: (v: VariantLite[]) => void; placeholder?: string; goodsOnly?: boolean }) {
  return (
    <div className="km-picklist">
      <ProductSearch size="middle" placeholder={placeholder} goodsOnly={goodsOnly} onPick={(h: SearchHit) => { if (!value.some((v) => v.id === h.id)) onChange([...value, { id: h.id, sku: h.sku, name: h.name, sellPrice: h.sellPrice }]); }} />
      {value.length > 0 && (
        <div className="km-picked">
          {value.map((v) => (
            <div key={v.id} className="km-picked-row">
              <div className="nm">{v.name}<div className="kv-hint">{v.sku}{v.sellPrice ? ` · ${money(v.sellPrice)}` : ''}</div></div>
              <Button type="text" size="small" danger icon={<DeleteOutlined />} onClick={() => onChange(value.filter((x) => x.id !== v.id))} />
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

const toTree = (list: Category[]): any[] => list.map((c) => ({ title: c.name, value: c.id, key: c.id, children: toTree(c.children ?? []) }));
export function CategoryTreeSelect({ value, onChange, placeholder = 'Chọn nhóm hàng (tùy chọn)' }: { value: string[]; onChange: (v: string[]) => void; placeholder?: string }) {
  const { data } = useCategories();
  const tree = useMemo(() => toTree(data ?? []), [data]);
  return <TreeSelect multiple treeDefaultExpandAll allowClear showSearch treeNodeFilterProp="title" style={{ width: '100%' }} placeholder={placeholder} value={value} onChange={(v) => onChange(v as string[])} treeData={tree} />;
}

const MODE_OPTIONS = (allowFixed: boolean) => [{ value: 'percent', label: 'Giảm %' }, { value: 'amount', label: 'Giảm tiền' }, ...(allowFixed ? [{ value: 'fixed', label: 'Giá cố định' }] : [])];
function RewardInputs({ mode, value, maxDiscount, allowFixed, perUnit, onChange }: { mode: Mode; value: number | null; maxDiscount: number | null; allowFixed?: boolean; perUnit?: boolean; onChange: (p: { mode?: Mode; value?: number | null; maxDiscount?: number | null }) => void }) {
  return (
    <div className="km-reward">
      <Select value={mode} onChange={(m) => onChange({ mode: m, value: null })} options={MODE_OPTIONS(!!allowFixed)} style={{ width: 130 }} />
      {mode === 'percent'
        ? <InputNumber min={0} max={100} value={value} onChange={(v) => onChange({ value: v === null || v === undefined ? null : toNum(v) })} suffix="%" style={{ width: 130 }} inputMode="decimal" />
        : <MoneyInput value={value ?? undefined} onChange={(v) => onChange({ value: v === null || v === undefined ? null : toNum(v) })} suffix={mode === 'amount' && perUnit ? 'đ/SP' : 'đ'} style={{ width: 170 }} />}
      {mode !== 'fixed' && <span className="km-inline"><span className="muted">Giảm tối đa</span><MoneyInput placeholder="Không giới hạn" value={maxDiscount ?? undefined} onChange={(v) => onChange({ maxDiscount: v === null || v === undefined ? null : toNum(v) })} style={{ width: 150 }} /></span>}
    </div>
  );
}

// ---------------------------------------------------------------- type-specific sections
function InvoiceDiscountEditor({ s, set }: { s: ConfigState; set: (p: Partial<ConfigState>) => void }) {
  const upd = (i: number, p: Partial<TierRow>) => set({ tiers: s.tiers.map((t, j) => (j === i ? { ...t, ...p } : t)) });
  return (
    <div className="km-tiers">
      <div className="kv-hint">Mức cao nhất mà hóa đơn đạt được sẽ áp dụng (tính trên tổng tiền hàng sau giảm giá dòng).</div>
      {s.tiers.map((t, i) => (
        <div key={i} className="km-tier">
          <div className="km-tier-head"><b>Mức {i + 1}</b>{s.tiers.length > 1 && <Button type="text" size="small" danger icon={<DeleteOutlined />} onClick={() => set({ tiers: s.tiers.filter((_, j) => j !== i) })}>Xóa</Button>}</div>
          <div className="km-field"><span className="lbl">Hóa đơn từ</span><MoneyInput value={t.minTotal} onChange={(v) => upd(i, { minTotal: toNum(v) })} style={{ width: 170 }} /></div>
          <div className="km-field"><span className="lbl">Phần thưởng</span><RewardInputs mode={t.mode} value={t.value} maxDiscount={t.maxDiscount} onChange={(p) => upd(i, p as Partial<TierRow>)} /></div>
        </div>
      ))}
      <Button type="dashed" icon={<PlusOutlined />} onClick={() => set({ tiers: [...s.tiers, { minTotal: (s.tiers[s.tiers.length - 1]?.minTotal ?? 0) + 500000, mode: 'percent', value: null, maxDiscount: null }] })}>Thêm mức</Button>
    </div>
  );
}

function InvoiceGiftEditor({ s, set }: { s: ConfigState; set: (p: Partial<ConfigState>) => void }) {
  const upd = (i: number, p: Partial<GiftTierRow>) => set({ giftTiers: s.giftTiers.map((t, j) => (j === i ? { ...t, ...p } : t)) });
  return (
    <div className="km-tiers">
      <div className="kv-hint">Khi hóa đơn đạt mức, thu ngân được nhắc thêm quà vào đơn (hàng tặng tính 0 đ, vẫn trừ tồn kho).</div>
      {s.giftTiers.map((t, i) => (
        <div key={i} className="km-tier">
          <div className="km-tier-head"><b>Mức {i + 1}</b>{s.giftTiers.length > 1 && <Button type="text" size="small" danger icon={<DeleteOutlined />} onClick={() => set({ giftTiers: s.giftTiers.filter((_, j) => j !== i) })}>Xóa</Button>}</div>
          <div className="km-field"><span className="lbl">Hóa đơn từ</span><MoneyInput value={t.minTotal} onChange={(v) => upd(i, { minTotal: toNum(v) })} style={{ width: 170 }} /></div>
          <div className="km-field col"><span className="lbl">Hàng tặng</span>
            <ProductSearch size="middle" goodsOnly placeholder="Tìm hàng tặng để thêm" onPick={(h) => { if (!t.gifts.some((g) => g.variant.id === h.id)) upd(i, { gifts: [...t.gifts, { variant: { id: h.id, sku: h.sku, name: h.name, sellPrice: h.sellPrice }, quantity: 1 }] }); }} />
            {t.gifts.map((g) => (
              <div key={g.variant.id} className="km-picked-row">
                <div className="nm">{g.variant.name}<div className="kv-hint">{g.variant.sku} · {money(g.variant.sellPrice)}</div></div>
                <span className="km-inline"><span className="muted">SL</span><QuantityInput min={0.001} value={g.quantity} onChange={(v) => upd(i, { gifts: t.gifts.map((x) => (x.variant.id === g.variant.id ? { ...x, quantity: toNum(v) } : x)) })} style={{ width: 80 }} /></span>
                <Button type="text" size="small" danger icon={<DeleteOutlined />} onClick={() => upd(i, { gifts: t.gifts.filter((x) => x.variant.id !== g.variant.id) })} />
              </div>
            ))}
          </div>
        </div>
      ))}
      <Button type="dashed" icon={<PlusOutlined />} onClick={() => set({ giftTiers: [...s.giftTiers, { minTotal: (s.giftTiers[s.giftTiers.length - 1]?.minTotal ?? 0) + 500000, gifts: [] }] })}>Thêm mức</Button>
    </div>
  );
}

function ProductDiscountEditor({ s, set }: { s: ConfigState; set: (p: Partial<ConfigState>) => void }) {
  return (
    <div className="km-stack">
      <div className="km-field col"><span className="lbl">Hàng hóa được giảm</span><ProductPickList value={s.variants} onChange={(variants) => set({ variants })} /></div>
      <div className="km-field col"><span className="lbl">Hoặc cả nhóm hàng</span><CategoryTreeSelect value={s.categoryIds} onChange={(categoryIds) => set({ categoryIds })} /></div>
      <div className="km-field"><span className="lbl">Số lượng / dòng</span>
        <span className="km-inline"><span className="muted">từ</span><QuantityInput min={0} placeholder="1" value={s.minQuantity ?? undefined} onChange={(v) => set({ minQuantity: v === null || v === undefined ? null : toNum(v) })} style={{ width: 80 }} /><span className="muted">tối đa</span><QuantityInput min={0} placeholder="∞" value={s.maxQuantity ?? undefined} onChange={(v) => set({ maxQuantity: v === null || v === undefined ? null : toNum(v) })} style={{ width: 80 }} /></span>
      </div>
      <div className="km-field"><span className="lbl">Phần thưởng</span><RewardInputs allowFixed perUnit mode={s.rewardMode} value={s.rewardValue} maxDiscount={s.maxDiscount} onChange={(p) => set({ rewardMode: p.mode ?? s.rewardMode, rewardValue: p.value === undefined ? (p.mode ? null : s.rewardValue) : p.value, maxDiscount: p.maxDiscount === undefined ? s.maxDiscount : p.maxDiscount })} /></div>
      <div className="kv-hint">Giảm % / giảm tiền tính trên từng đơn vị; "Giảm tối đa" chặn tổng tiền giảm của mỗi dòng.</div>
    </div>
  );
}

function BuyXGetYEditor({ s, set }: { s: ConfigState; set: (p: Partial<ConfigState>) => void }) {
  return (
    <div className="km-stack">
      <div className="km-sub">Điều kiện mua</div>
      <div className="km-field col"><span className="lbl">Hàng phải mua</span><ProductPickList value={s.buyVariants} onChange={(buyVariants) => set({ buyVariants })} placeholder="Tìm hàng hóa X" /></div>
      <div className="km-field col"><span className="lbl">Hoặc cả nhóm hàng</span><CategoryTreeSelect value={s.buyCategoryIds} onChange={(buyCategoryIds) => set({ buyCategoryIds })} /></div>
      <div className="km-field"><span className="lbl">Số lượng mua</span><QuantityInput min={0.001} value={s.buyQuantity} onChange={(v) => set({ buyQuantity: toNum(v) })} style={{ width: 100 }} /></div>
      <div className="km-sub">Phần tặng</div>
      <div className="km-field col"><span className="lbl">Hàng tặng Y</span><ProductPickList value={s.getVariants} onChange={(getVariants) => set({ getVariants })} placeholder="Tìm hàng tặng Y" goodsOnly /></div>
      <div className="km-field"><span className="lbl">Số lượng tặng</span><span className="km-inline"><QuantityInput min={0.001} value={s.getQuantity} onChange={(v) => set({ getQuantity: toNum(v) })} style={{ width: 90 }} /><span className="muted">giảm</span><InputNumber min={1} max={100} value={s.getPercent} onChange={(v) => set({ getPercent: toNum(v) || 100 })} suffix="%" style={{ width: 110 }} /><span className="kv-hint">(100% = tặng miễn phí)</span></span></div>
      <div className="km-field"><span className="lbl">Lặp tối đa</span><span className="km-inline"><InputNumber min={1} placeholder="Không giới hạn" value={s.maxRepeats ?? undefined} onChange={(v) => set({ maxRepeats: v === null || v === undefined ? null : Math.floor(toNum(v)) })} style={{ width: 150 }} /><span className="kv-hint">lần / hóa đơn</span></span></div>
      <div className="km-field"><span className="lbl">Hàng Y đã có trong giỏ</span><span className="km-inline"><Switch checked={s.applyToCart} onChange={(applyToCart) => set({ applyToCart })} /><span className="kv-hint">{s.applyToCart ? 'Cũng được giảm (không cần thêm dòng quà)' : 'Chỉ giảm khi thu ngân thêm dòng quà tặng'}</span></span></div>
    </div>
  );
}

function VoucherEditor({ s, set }: { s: ConfigState; set: (p: Partial<ConfigState>) => void }) {
  return (
    <div className="km-stack">
      <div className="km-field"><span className="lbl">Phần thưởng</span><RewardInputs mode={s.rewardMode} value={s.rewardValue} maxDiscount={s.maxDiscount} onChange={(p) => set({ rewardMode: p.mode ?? s.rewardMode, rewardValue: p.value === undefined ? (p.mode ? null : s.rewardValue) : p.value, maxDiscount: p.maxDiscount === undefined ? s.maxDiscount : p.maxDiscount })} /></div>
      <div className="km-field"><span className="lbl">Hóa đơn tối thiểu</span><MoneyInput placeholder="Không yêu cầu" value={s.minTotal ?? undefined} onChange={(v) => set({ minTotal: v === null || v === undefined ? null : toNum(v) })} style={{ width: 170 }} /></div>
      <div className="km-field col"><span className="lbl">Chỉ áp dụng cho hàng hóa (tùy chọn)</span><ProductPickList value={s.variants} onChange={(variants) => set({ variants })} /></div>
      <div className="km-field col"><span className="lbl">Hoặc nhóm hàng (tùy chọn)</span><CategoryTreeSelect value={s.categoryIds} onChange={(categoryIds) => set({ categoryIds })} /></div>
      <div className="kv-hint">Khách đưa mã tại quầy; mỗi mã có số lượt dùng riêng. Phát hành mã ở tab "Voucher" sau khi lưu.</div>
    </div>
  );
}

// ---------------------------------------------------------------- the modal
export function PromotionEditor({ open, promotion, onClose, onSaved, initialTab }: { open: boolean; promotion?: PromotionDetail | null; onClose: () => void; onSaved: (p: PromotionDetail) => void; initialTab?: 'info' | 'vouchers' }) {
  const { message } = App.useApp();
  const qc = useQueryClient();
  const isMobile = useIsMobile();
  const [form] = Form.useForm();
  const { data: branches } = useBranches();
  const { data: groups } = useCustomerGroups();
  const [type, setType] = useState<PromotionType>('INVOICE_DISCOUNT');
  const [cfg, setCfg] = useState<ConfigState>(emptyConfig);
  const [tab, setTab] = useState<'info' | 'vouchers'>('info');
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const isEdit = !!promotion;
  const set = (p: Partial<ConfigState>) => setCfg((s) => ({ ...s, ...p }));

  const applyValues = () => {
    setError(null);
    if (promotion) {
      setType(promotion.type); setCfg(fromPromotion(promotion));
      form.setFieldsValue({
        name: promotion.name, type: promotion.type, description: promotion.description ?? undefined, status: promotion.status,
        range: promotion.startsAt || promotion.endsAt ? [promotion.startsAt ? dayjs(promotion.startsAt) : null, promotion.endsAt ? dayjs(promotion.endsAt) : null] : undefined,
        daysOfWeek: promotion.daysOfWeek ?? [], timeFrom: promotion.timeFrom ? dayjs(promotion.timeFrom, 'HH:mm') : undefined, timeTo: promotion.timeTo ? dayjs(promotion.timeTo, 'HH:mm') : undefined,
        branchIds: promotion.branchIds ?? [], customerGroups: promotion.customerGroups ?? [], priority: promotion.priority, stackable: promotion.stackable, usageLimit: promotion.usageLimit ?? undefined, perCustomerLimit: promotion.perCustomerLimit ?? undefined,
      });
    } else {
      setType('INVOICE_DISCOUNT'); setCfg(emptyConfig());
      form.resetFields(); form.setFieldsValue({ type: 'INVOICE_DISCOUNT', status: 'ACTIVE', priority: 0, stackable: false, daysOfWeek: [], branchIds: [], customerGroups: [] });
    }
  };
  useEffect(() => { if (open) { applyValues(); setTab(initialTab ?? 'info'); } }, [open, promotion?.id]);

  const save = async () => {
    let v: any;
    try { v = await form.validateFields(); } catch { setTab('info'); return; }
    let config: PromotionConfig;
    try { config = toConfig(type, cfg); } catch (e) { setError((e as Error).message); setTab('info'); return; }
    const range = v.range as [Dayjs | null, Dayjs | null] | undefined;
    const body: PromotionInput = {
      name: v.name, type, description: v.description || undefined, status: v.status ?? 'ACTIVE',
      startsAt: range?.[0] ? range[0].toISOString() : null, endsAt: range?.[1] ? range[1].toISOString() : null,
      daysOfWeek: v.daysOfWeek ?? [], timeFrom: v.timeFrom ? (v.timeFrom as Dayjs).format('HH:mm') : null, timeTo: v.timeTo ? (v.timeTo as Dayjs).format('HH:mm') : null,
      branchIds: v.branchIds ?? [], customerGroups: (v.customerGroups ?? []).map((g: string) => g.trim()).filter(Boolean), priority: v.priority ?? 0, stackable: !!v.stackable,
      usageLimit: v.usageLimit ? Math.floor(v.usageLimit) : null, perCustomerLimit: v.perCustomerLimit ? Math.floor(v.perCustomerLimit) : null, config,
    };
    if (body.startsAt && body.endsAt && body.startsAt > body.endsAt) { setError('Ngày bắt đầu phải trước ngày kết thúc'); return; }
    setSaving(true); setError(null);
    try {
      let saved: PromotionDetail;
      if (promotion) saved = await promotionsApi.update(promotion.id, { ...body });
      else { const { startsAt, endsAt, timeFrom, timeTo, ...rest } = body; saved = await promotionsApi.create({ ...rest, startsAt: startsAt ?? undefined, endsAt: endsAt ?? undefined, timeFrom: timeFrom ?? undefined, timeTo: timeTo ?? undefined } as PromotionInput); }
      PROMOTION_KEYS.forEach((k) => qc.invalidateQueries({ queryKey: [k] }));
      message.success(promotion ? 'Đã cập nhật khuyến mãi' : `Đã tạo khuyến mãi ${saved.code}`);
      onSaved(saved);
    } catch (e) { setError(errMsg(e)); message.error(errMsg(e)); } finally { setSaving(false); }
  };

  const infoTab = (
    <Form form={form} layout="vertical" size="middle" className="km-form">
      {error && <Alert type="error" showIcon message={error} style={{ marginBottom: 10 }} />}
      <div className="km-section">
        <div className="km-section-title">Thông tin chung</div>
        <div className="km-grid">
          <Form.Item name="name" label="Tên chương trình" rules={[{ required: true, message: 'Nhập tên chương trình' }]} className="span2"><Input placeholder="VD: Giảm 10% toàn bộ serum tháng 11" autoFocus={!isMobile} /></Form.Item>
          <Form.Item name="type" label="Loại khuyến mãi" rules={[{ required: true }]} tooltip={isEdit ? 'Không đổi loại sau khi tạo' : undefined}>
            <Select disabled={isEdit} options={PROMOTION_TYPES.map((t) => ({ value: t, label: PROMOTION_TYPE_LABEL[t] }))} onChange={(t) => { setType(t); setError(null); }} />
          </Form.Item>
          <Form.Item name="status" label="Trạng thái"><Select options={[{ value: 'ACTIVE', label: 'Kích hoạt' }, { value: 'INACTIVE', label: 'Ngừng' }]} /></Form.Item>
          <Form.Item name="description" label="Mô tả" className="span2"><Input.TextArea rows={2} autoSize={{ minRows: 1, maxRows: 4 }} placeholder="Ghi chú nội bộ / nội dung in trên hóa đơn" /></Form.Item>
        </div>
      </div>
      <div className="km-section">
        <div className="km-section-title">Thời gian & phạm vi áp dụng</div>
        <div className="km-grid">
          <Form.Item name="range" label="Thời gian hiệu lực" className="span2" tooltip="Bỏ trống = không giới hạn"><DatePicker.RangePicker style={{ width: '100%' }} format="DD/MM/YYYY HH:mm" showTime={{ format: 'HH:mm', defaultValue: [dayjs().startOf('day'), dayjs().endOf('day')] }} allowEmpty={[true, true]} placeholder={['Bắt đầu', 'Kết thúc']} /></Form.Item>
          <Form.Item name="daysOfWeek" label="Ngày trong tuần" className="span2" tooltip="Bỏ trống = mọi ngày"><Checkbox.Group className="km-days" options={[1, 2, 3, 4, 5, 6, 0].map((d) => ({ value: d, label: DAY_LABELS[d] }))} /></Form.Item>
          <Form.Item label="Khung giờ" tooltip="Bỏ trống = cả ngày">
            <div className="km-inline"><Form.Item name="timeFrom" noStyle><TimePicker format="HH:mm" minuteStep={5} placeholder="Từ" style={{ width: 110 }} /></Form.Item><span className="muted">→</span><Form.Item name="timeTo" noStyle><TimePicker format="HH:mm" minuteStep={5} placeholder="Đến" style={{ width: 110 }} /></Form.Item></div>
          </Form.Item>
          <Form.Item name="branchIds" label="Chi nhánh (trống = tất cả)"><Select mode="multiple" allowClear placeholder="Tất cả chi nhánh" options={(branches ?? []).filter((b) => b.isActive).map((b) => ({ value: b.id, label: b.name }))} /></Form.Item>
          <Form.Item name="customerGroups" label="Nhóm khách hàng (trống = mọi khách)" tooltip="Chọn nhóm có sẵn hoặc gõ tên nhóm mới"><Select mode="tags" allowClear placeholder="VD: VIP, Thành viên" tokenSeparators={[',']} options={(groups ?? []).map((g) => ({ value: g.name, label: `${g.name} (${g.count})` }))} /></Form.Item>
        </div>
      </div>
      <div className="km-section">
        <div className="km-section-title">Điều kiện & phần thưởng <span className="kv-hint">· {PROMOTION_TYPE_LABEL[type]}</span></div>
        {type === 'INVOICE_DISCOUNT' && <InvoiceDiscountEditor s={cfg} set={set} />}
        {type === 'INVOICE_GIFT' && <InvoiceGiftEditor s={cfg} set={set} />}
        {type === 'PRODUCT_DISCOUNT' && <ProductDiscountEditor s={cfg} set={set} />}
        {type === 'BUY_X_GET_Y' && <BuyXGetYEditor s={cfg} set={set} />}
        {type === 'VOUCHER' && <VoucherEditor s={cfg} set={set} />}
      </div>
      <div className="km-section">
        <div className="km-section-title">Ưu tiên & giới hạn</div>
        <div className="km-grid four">
          <Form.Item name="priority" label="Độ ưu tiên" tooltip="Cao hơn được xét trước"><InputNumber style={{ width: '100%' }} min={-1000} max={1000} /></Form.Item>
          <Form.Item name="stackable" label="Cộng dồn KM khác" valuePropName="checked" tooltip="Tắt = khi áp dụng chương trình này thì không xét các chương trình khác"><Switch /></Form.Item>
          <Form.Item name="usageLimit" label="Tổng lượt tối đa" tooltip="Bỏ trống = không giới hạn"><InputNumber style={{ width: '100%' }} min={1} placeholder="∞" /></Form.Item>
          <Form.Item name="perCustomerLimit" label="Lượt / khách hàng" tooltip="Bỏ trống = không giới hạn"><InputNumber style={{ width: '100%' }} min={1} placeholder="∞" /></Form.Item>
        </div>
      </div>
    </Form>
  );

  return (
    <Modal className="km-editor" title={isEdit ? `Sửa khuyến mãi ${promotion?.code ?? ''}` : 'Thêm khuyến mãi'} open={open} onCancel={onClose} width={920} destroyOnHidden afterOpenChange={(v) => { if (v) applyValues(); }}
      footer={tab === 'vouchers' ? [<Button key="c" onClick={onClose}>Đóng</Button>] : [<Button key="c" onClick={onClose}>Bỏ qua</Button>, <Button key="s" type="primary" loading={saving} onClick={save}>{isEdit ? 'Lưu' : 'Tạo khuyến mãi'}</Button>]}>
      {isEdit && promotion?.type === 'VOUCHER'
        ? <Tabs activeKey={tab} onChange={(k) => setTab(k as 'info' | 'vouchers')} items={[{ key: 'info', label: 'Thông tin', children: infoTab }, { key: 'vouchers', label: `Voucher (${promotion._count?.vouchers ?? 0})`, children: <VouchersPanel promotionId={promotion.id} /> }]} />
        : infoTab}
    </Modal>
  );
}
