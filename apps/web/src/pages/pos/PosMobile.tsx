import { App, Badge, Button, Drawer, Dropdown, Input, InputNumber, Select, Spin, Tag } from 'antd';
import Icon, { CheckOutlined, ClockCircleOutlined, CloseOutlined, DeleteOutlined, DownOutlined, EllipsisOutlined, FileTextOutlined, FilterOutlined, FormOutlined, LeftOutlined, MinusOutlined, PlusOutlined, QrcodeOutlined, RightOutlined, RollbackOutlined, SearchOutlined, ShopOutlined, ShoppingCartOutlined, ShoppingOutlined, SwapOutlined, TagOutlined, UnorderedListOutlined, UserOutlined } from '@ant-design/icons';
import { ReactNode, useEffect, useMemo, useRef, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { catalogApi, useCategories, useProducts } from '../../api/catalog';
import { errMsg } from '../../api/client';
import { useInvoices } from '../../api/sales';
import type { Category, CustomerHit, Me, Product, SearchHit, Variant, Warehouse } from '../../api/types';
import { BarcodeScanButton } from '../../components/BarcodeScanner';
import { CustomerSelect } from '../../components/CustomerSelect';
import { MoneyInput } from '../../components/Inputs';
import { MobileTabBar } from '../../components/layout/MobileTabBar';
import { ProductSearch } from '../../components/ProductSearch';
import { useAuthStore } from '../../store/auth';
import { PAYMENT_METHOD_LABEL, PRODUCT_TYPE_LABEL, money, qty as fq, toNum } from '../../utils/format';
import { ProductFormModal } from '../products/ProductFormModal';
import type { CartLine, CartTab, PaymentRow, PosDelivery } from './posStore';
import './pos-mobile.css';

const PAGE = 30;
const MODE_KEY = 'pos.mode';
type Mode = 'SALE' | 'ORDER';
type Sheet = null | 'customer' | 'pricebook' | 'warehouse' | 'category' | 'more' | 'info' | 'items' | 'delivery';
const METHOD_SHORT: Record<string, string> = { CASH: 'Tiền mặt', BANK_TRANSFER: 'Chuyển khoản', CARD: 'Thẻ', EWALLET: 'Ví' };

/** Biểu tượng "Đơn tạm": tờ phiếu có đồng hồ (như app KiotViet). */
const HeldSvg = () => (
  <svg viewBox="0 0 24 24" width="1em" height="1em" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
    <path d="M9 3H7a2 2 0 0 0-2 2v4.5" /><path d="M13 3h.6a2 2 0 0 1 1.4.6l3.4 3.4a2 2 0 0 1 .6 1.4V19a2 2 0 0 1-2 2h-5" />
    <path d="M13 3v6h6" /><circle cx="7" cy="16" r="4.6" /><path d="M7 13.6V16l1.7 1.1" />
  </svg>
);
const HeldIcon = () => <Icon component={HeldSvg} />;

/** Những gì màn điện thoại cần từ PosPage (logic giỏ hàng, khuyến mãi, thanh toán nằm ở đó và dùng chung với máy tính). */
export interface PosMobileCtx {
  me: Me; can: (p: string) => boolean;
  tab: CartTab; tabs: CartTab[]; setActive: (id: string) => void; addTab: () => void;
  warehouses: Warehouse[]; warehouseId?: string; setWarehouse: (id?: string) => void;
  addHit: (hit: SearchHit) => Promise<void>;
  setLine: (key: string, p: Partial<CartLine> | ((l: CartLine) => Partial<CartLine>)) => void;
  removeLine: (key: string) => void;
  patch: (fn: (t: CartTab) => Partial<CartTab>) => void;
  setCustomer: (id?: string, c?: CustomerHit) => void;
  changeUnit: (l: CartLine, productUnitId?: string) => Promise<void>;
  changePriceBook: (id?: string) => Promise<void>;
  canPriceBook: boolean; priceBookOptions: { value: string; label: string }[];
  canPrice: boolean; canDiscount: boolean;
  totals: { subtotal: number; discount: number; promo: number; tax: number; total: number }; payable: number; pointsValue: number; previewing: boolean;
  giftPrompt: ReactNode; batchSelect: (l: CartLine, width?: number | string) => ReactNode; giftMax: (l: CartLine) => number;
  sellers: { id: string; fullName: string }[];
  busy: boolean;
  hold: () => Promise<void>; placeOrder: (confirm: boolean) => Promise<void>; openHeld: () => void;
  /** màn Thanh toán */
  priceIncludesTax: boolean; setDiscountMode: (m: 'AMOUNT' | 'PCT') => void; promoBlock: ReactNode; loyaltyBlock: ReactNode;
  pay: {
    mode: string; setMode: (m: string) => void;
    cashGiven: number | null; setCashGiven: (v: number | null) => void;
    single: { amount: number | null; reference: string }; setSingle: (fn: (s: { amount: number | null; reference: string }) => { amount: number | null; reference: string }) => void;
    mixed: PaymentRow[]; setMixed: (fn: (m: PaymentRow[]) => PaymentRow[]) => void;
    paid: number; due: number; change: number; sepayReady: boolean; qrBusy: boolean;
    checkout: () => Promise<void>; startQr: () => Promise<void>; reopenQr: () => Promise<void>; suggest: (total: number) => number[]; methods: string[];
  };
  shift: { id: string; code: string } | null | undefined; openShift: () => void; closeShift: () => void;
}

const toHit = (p: Product, v: Variant): SearchHit => ({ ...v, product: { id: p.id, code: p.code, name: p.name, type: p.type, baseUnit: p.baseUnit, trackBatch: p.trackBatch, imageUrl: p.imageUrl }, available: v.onHand ?? v.onHandTotal, onHand: v.onHand ?? v.onHandTotal });
const flatCategories = (list: Category[], depth = 0): { id: string; name: string; depth: number }[] => list.flatMap((c) => [{ id: c.id, name: c.name, depth }, ...flatCategories(c.children ?? [], depth + 1)]);
const Img = ({ src, badge }: { src?: string | null; badge?: number }) => (
  <span className="ps-imgw">{src ? <img className="ps-img" src={src} alt="" loading="lazy" /> : <span className="ps-img ph" />}{badge ? <i className="ps-qtybadge">{fq(badge)}</i> : null}</span>
);

/** Bán hàng trên điện thoại – bố cục như app KiotViet: danh mục hàng (tìm / quét, khách, bảng giá, kho, dòng hàng bấm để thêm) và giỏ hàng (dòng hàng với − SL +, Lưu tạm, Thanh toán / Đặt hàng). */
export function PosMobile({ ctx, children }: { ctx: PosMobileCtx; children?: ReactNode }) {
  const { message } = App.useApp();
  const nav = useNavigate();
  const { me, can, tab, tabs, setActive, addTab, warehouses, warehouseId, setWarehouse, addHit, setLine, removeLine, patch, setCustomer, changeUnit, changePriceBook, canPriceBook, priceBookOptions, canPrice, canDiscount, totals, payable, pointsValue, previewing, giftPrompt, batchSelect, giftMax, sellers, busy, hold, placeOrder, openHeld, shift, openShift, closeShift, priceIncludesTax, setDiscountMode, promoBlock, loyaltyBlock, pay } = ctx;
  const canOrder = can('order.create');
  const branchId = useAuthStore((s) => s.currentBranchId);
  const [view, setView] = useState<'catalog' | 'cart' | 'pay'>('catalog');
  const [dlv, setDlv] = useState<PosDelivery>({ receiverName: '', address: '' });
  // số đơn đang giữ (đơn tạm) của chi nhánh – hiện trên nút Đơn tạm
  const { data: heldData } = useInvoices({ status: 'DRAFT', branchId: branchId ?? undefined, pageSize: 1 }, !!branchId);
  const heldCount = heldData?.meta.total ?? 0;
  const [mode, setModeState] = useState<Mode>(() => { try { return localStorage.getItem(MODE_KEY) === 'ORDER' && canOrder ? 'ORDER' : 'SALE'; } catch { return 'SALE'; } });
  const setMode = (m: Mode) => { setModeState(m); try { localStorage.setItem(MODE_KEY, m); } catch { /* ignore */ } };
  const [search, setSearch] = useState('');
  const [q, setQ] = useState<{ search?: string; categoryId?: string; page: number }>({ page: 1 });
  const [items, setItems] = useState<Product[]>([]);
  const [sheet, setSheet] = useState<Sheet>(null);
  const [variantPick, setVariantPick] = useState<Product | null>(null);
  const [lineKey, setLineKey] = useState<string | null>(null);
  const [newProduct, setNewProduct] = useState(false);
  const { data, isFetching, isPlaceholderData, error, refetch } = useProducts({ page: q.page, pageSize: PAGE, search: q.search, categoryId: q.categoryId, warehouseId, isActive: 'true' });
  const { data: categories } = useCategories();
  const sentinel = useRef<HTMLDivElement>(null);
  const total = data?.meta.total ?? 0;
  const lineCount = tab.lines.reduce((s, l) => s + l.quantity, 0);
  const inCart = useMemo(() => { const m = new Map<string, number>(); tab.lines.forEach((l) => { if (!l.isGift) m.set(l.productId, (m.get(l.productId) ?? 0) + l.quantity); }); return m; }, [tab.lines]);
  const editing = lineKey ? tab.lines.find((l) => l.key === lineKey) : undefined;
  const warehouse = warehouses.find((w) => w.id === warehouseId);
  const priceBookLabel = tab.priceBookId ? priceBookOptions.find((o) => o.value === tab.priceBookId)?.label ?? 'Bảng giá riêng' : 'Bảng giá chung';
  const customerName = tab.customerLabel ? tab.customerLabel.split(' · ')[0] : 'Khách lẻ';

  // ô tìm lọc danh mục (300 ms); Enter / quét camera → thêm thẳng hàng có mã trùng
  useEffect(() => { const h = window.setTimeout(() => setQ((s) => (s.search === (search.trim() || undefined) ? s : { ...s, search: search.trim() || undefined, page: 1 })), 300); return () => window.clearTimeout(h); }, [search]);
  useEffect(() => { if (!data || isPlaceholderData) return; setItems((cur) => (q.page === 1 ? data.data : [...cur, ...data.data.filter((x) => !cur.some((c) => c.id === x.id))])); }, [data, isPlaceholderData, q.page]);
  useEffect(() => {
    const el = sentinel.current;
    if (!el || view !== 'catalog') return;
    const io = new IntersectionObserver((es) => { if (es[0].isIntersecting && !isFetching && items.length < total) setQ((s) => ({ ...s, page: s.page + 1 })); }, { rootMargin: '300px' });
    io.observe(el);
    return () => io.disconnect();
  }, [isFetching, items.length, total, view]);
  // giỏ trống (sau thanh toán / lưu tạm / bỏ hết dòng) → về danh mục
  useEffect(() => { if (!tab.lines.length && view !== 'catalog') setView('catalog'); }, [tab.lines.length]);
  useEffect(() => { if (!canOrder && mode === 'ORDER') setMode('SALE'); }, [canOrder]);
  useEffect(() => { if (editing === undefined && lineKey) setLineKey(null); }, [editing, lineKey]);

  const addByCode = async (code: string) => {
    try { const hit = await catalogApi.byBarcode(code); await addHit(hit); navigator.vibrate?.(40); message.success({ content: `Đã thêm ${hit.name}`, duration: 1.2 }); return true; } catch { return false; }
  };
  const onEnter = async () => { const c = search.trim(); if (!c) return; if (await addByCode(c)) setSearch(''); };
  const onScan = async (code: string) => { if (!(await addByCode(code))) { setSearch(code); message.warning(`Không tìm thấy hàng hóa có mã vạch/mã "${code}"`); } };
  const pick = (p: Product) => {
    if (p.allowSale === false) { message.warning('Hàng này không cho phép bán'); return; }
    const vs = p.variants.filter((v) => v.isActive !== false);
    if (vs.length > 1) { setVariantPick(p); return; }
    const v = vs[0] ?? p.variants[0];
    if (!v) { message.warning('Hàng hóa chưa có phiên bản để bán'); return; }
    navigator.vibrate?.(30);
    void addHit(toHit(p, v));
  };
  const dec = (l: CartLine) => { if (l.quantity <= 1) { removeLine(l.key); message.info({ content: `Đã bỏ ${l.name}`, duration: 1.2 }); } else setLine(l.key, { quantity: Math.round((l.quantity - 1) * 1000) / 1000 }); };
  const inc = (l: CartLine) => { const max = l.isGift ? giftMax(l) : Infinity; if (l.quantity + 1 > max) { message.warning(`Chỉ được tặng tối đa ${fq(max)}`); return; } setLine(l.key, { quantity: Math.round((l.quantity + 1) * 1000) / 1000 }); };
  const setQty = (l: CartLine, raw: string) => { const n = toNum(raw.replace(',', '.')); if (!(n > 0)) return; const max = l.isGift ? giftMax(l) : Infinity; setLine(l.key, { quantity: Math.min(n, max) }); };
  const stepper = (l: CartLine) => (
    <span className="ps-step">
      <button type="button" aria-label="Bớt" onClick={() => dec(l)}><MinusOutlined /></button>
      <input key={l.quantity} type="text" inputMode="decimal" defaultValue={fq(l.quantity)} onFocus={(e) => e.target.select()} onBlur={(e) => setQty(l, e.target.value)} onKeyDown={(e) => { if (e.key === 'Enter') (e.target as HTMLInputElement).blur(); }} />
      <button type="button" aria-label="Thêm" onClick={() => inc(l)}><PlusOutlined /></button>
    </span>
  );
  const modeLabel = mode === 'SALE' ? 'Bán hàng' : 'Đặt hàng';
  const modeMenu = { items: [{ key: 'SALE', label: 'Bán hàng', icon: <ShoppingOutlined /> }, { key: 'ORDER', label: 'Đặt hàng', icon: <ShoppingCartOutlined /> }], selectedKeys: [mode], onClick: ({ key }: { key: string }) => setMode(key as Mode) };
  const tabMenu = { items: [...tabs.map((t) => ({ key: t.id, label: `${t.name}${t.lines.length ? ` · ${t.lines.length} dòng` : ''}` })), { type: 'divider' as const }, { key: '__new', label: 'Thêm hóa đơn mới', icon: <PlusOutlined /> }], selectedKeys: [tab.id], onClick: ({ key }: { key: string }) => (key === '__new' ? addTab() : setActive(key)) };
  const gifts = tab.lines.filter((l) => l.isGift).length;

  const optionSheet = (title: string, opts: { value?: string; label: ReactNode; sub?: ReactNode; on: boolean; onPick: () => void }[]) => (
    <Drawer className="ps-sheet" placement="bottom" height="auto" open onClose={() => setSheet(null)} title={title} styles={{ body: { padding: '0 0 calc(8px + env(safe-area-inset-bottom))', maxHeight: '70dvh', overflow: 'auto' } }}>
      {opts.map((o, i) => <button type="button" key={o.value ?? `_${i}`} className={`ps-opt ${o.on ? 'on' : ''}`} onClick={() => { o.onPick(); setSheet(null); }}><span><span className="t">{o.label}</span>{o.sub && <span className="s">{o.sub}</span>}</span>{o.on && <CheckOutlined />}</button>)}
    </Drawer>
  );

  const customerRow = (cls: string) => <button type="button" className={cls} onClick={() => setSheet('customer')}><UserOutlined /><span className="t">{customerName}</span>{cls === 'ps-prow' && <RightOutlined className="chev" />}</button>;
  const priceBookRow = (cls: string) => <button type="button" className={cls} onClick={() => canPriceBook && priceBookOptions.length ? setSheet('pricebook') : message.info(canPriceBook ? 'Chưa có bảng giá nào đang áp dụng' : 'Bạn không có quyền đổi bảng giá')}><TagOutlined /><span className="t">{priceBookLabel}</span>{cls === 'ps-prow' && <RightOutlined className="chev" />}</button>;

  // ---------------------------------------------------------------- danh mục hàng
  const catalog = (
    <>
      <div className="ps-top">
        <div className="ps-head">
          <h1>Bán hàng</h1>
          <button type="button" className="ps-ib ps-held" aria-label="Đơn tạm" title="Đơn tạm (đơn đang giữ)" onClick={openHeld}><Badge count={heldCount} size="small" overflowCount={99}><HeldIcon /></Badge></button>
        </div>
        <div className="ps-search">
          <Input size="large" allowClear prefix={<SearchOutlined />} placeholder="Tên, mã hàng, mã vạch" value={search} onChange={(e) => setSearch(e.target.value)} onPressEnter={() => void onEnter()} />
          {can('product.create') && <button type="button" className="ps-ib box" aria-label="Thêm hàng hóa" onClick={() => setNewProduct(true)}><PlusOutlined /></button>}
          <BarcodeScanButton className="ps-ib box ps-scan" size="large" continuous title="Quét mã vạch – thêm vào giỏ" onScan={(c) => void onScan(c)} />
        </div>
        <div className="ps-chips">
          {customerRow('ps-chip')}
          {priceBookRow('ps-chip')}
          <button type="button" className={`ps-ib ps-filter ${q.categoryId ? 'on' : ''}`} aria-label="Lọc theo nhóm hàng" onClick={() => setSheet('category')}><FilterOutlined /></button>
        </div>
      </div>
      <button type="button" className="ps-wh" onClick={() => (warehouses.length > 1 ? setSheet('warehouse') : undefined)}><ShopOutlined /><span className="t">{warehouse?.name ?? 'Chọn kho'}</span>{warehouses.length > 1 && <RightOutlined className="chev" />}</button>
      <div className="ps-list">
        {q.categoryId && <div className="ps-catbar">Nhóm: <b>{flatCategories(categories ?? []).find((c) => c.id === q.categoryId)?.name}</b><button type="button" onClick={() => setQ((s) => ({ ...s, categoryId: undefined, page: 1 }))}><CloseOutlined /> Bỏ lọc</button></div>}
        {items.map((p) => {
          const n = inCart.get(p.id) ?? 0;
          const onHand = toNum(p.onHand);
          return (
            <div key={p.id} className={`ps-row ${n ? 'in' : ''}`} role="button" onClick={() => pick(p)}>
              <Img src={p.imageUrl ?? p.variants[0]?.imageUrl} badge={n} />
              <div className="ps-main">
                <div className="nm">{p.name}{p.variants.length > 1 && <span className="muted"> ({p.variants.length} phiên bản)</span>}</div>
                <div className="meta">
                  <span>{p.code}</span>
                  {p.type === 'SERVICE' ? <Tag>Dịch vụ</Tag> : <span className={`ps-stock ${onHand <= 0 ? 'zero' : ''}`}>{fq(onHand)}{onHand > 0 && p.baseUnit ? ` ${p.baseUnit}` : ''}</span>}
                  {p.type === 'COMBO' && <Tag color="purple">{PRODUCT_TYPE_LABEL.COMBO}</Tag>}
                  {p.trackBatch && <Tag color="gold">Lô</Tag>}
                </div>
                <div className="price">{p.variants.length > 1 ? `Từ ${money(Math.min(...p.variants.map((x) => Number(x.sellPrice))))}` : money(p.sellPrice ?? p.variants[0]?.sellPrice ?? 0)}</div>
              </div>
            </div>
          );
        })}
        {!isFetching && items.length === 0 && <div className="ps-empty">{error ? errMsg(error) : q.search ? `Không có hàng hóa khớp "${q.search}"` : 'Chưa có hàng hóa'}</div>}
        {isFetching && <div className="ps-loading"><Spin size="small" /> Đang tải…</div>}
        <div ref={sentinel} />
      </div>
      {tab.lines.length === 0 ? (
        <div className="ps-pill">
          {canOrder && <button type="button" className={mode === 'ORDER' ? 'on' : ''} onClick={() => setMode('ORDER')}>Đặt hàng</button>}
          <button type="button" className={mode === 'SALE' ? 'on' : ''} onClick={() => setMode('SALE')}>Bán hàng</button>
          <button type="button" className="dots" aria-label="Thêm thao tác" onClick={() => setSheet('more')}><EllipsisOutlined /></button>
        </div>
      ) : (
        <div className="ps-cartbar">
          <button type="button" className="ps-cart-main" onClick={() => setView('cart')}>
            <span className="ic"><Badge count={fq(lineCount)} size="small" overflowCount={999}><ShoppingCartOutlined /></Badge></span>
            <span className="sum"><span className="l">Tổng tiền hàng</span><b>{money(totals.subtotal)}</b></span>
            <span className="go">{modeLabel} <RightOutlined /></span>
          </button>
          <button type="button" className="ps-ib" aria-label="Thêm thao tác" onClick={() => setSheet('more')}><EllipsisOutlined /></button>
        </div>
      )}
      <MobileTabBar />
    </>
  );

  // ---------------------------------------------------------------- giỏ hàng
  const cart = (
    <>
      <div className="ps-top">
        <div className="ps-head ps-cart-head">
          <button type="button" className="ps-ib" aria-label="Về danh mục" onClick={() => setView('catalog')}><CloseOutlined /></button>
          {canOrder ? <Dropdown trigger={['click']} menu={modeMenu}><h1 className="dd">{modeLabel} <DownOutlined /></h1></Dropdown> : <h1>{modeLabel}</h1>}
          {tabs.length > 1 && <Dropdown trigger={['click']} menu={tabMenu}><button type="button" className="ps-tabchip">{tab.name} <DownOutlined /></button></Dropdown>}
          <button type="button" className="ps-ib" style={{ marginLeft: 'auto' }} aria-label="Thông tin đơn" onClick={() => setSheet('info')}><FileTextOutlined /></button>
        </div>
        <div className="ps-search ps-search-cart"><ProductSearch scanContinuous onPick={addHit} warehouseId={warehouseId} size="large" placeholder="Tên, mã hàng, mã vạch" /></div>
      </div>
      <div className="ps-rows">
        {customerRow('ps-prow')}
        {priceBookRow('ps-prow')}
      </div>
      <div className="ps-lines">
        {mode === 'SALE' && giftPrompt}
        {mode === 'ORDER' && gifts > 0 && <div className="ps-note">Đơn đặt hàng không áp dụng khuyến mãi / hàng tặng – {gifts} dòng hàng tặng sẽ không được đưa vào đơn.</div>}
        {tab.lines.map((l) => (
          <div key={l.key} className={`ps-line ${l.error ? 'error' : ''} ${l.isGift ? 'gift' : ''}`}>
            <span onClick={() => setLineKey(l.key)}><Img src={l.imageUrl} /></span>
            <div className="nm" onClick={() => setLineKey(l.key)}>{l.name}{l.unitName && l.unitName !== l.baseUnit ? <span className="muted"> ({l.unitName})</span> : null}{l.isGift && <Tag color="green" style={{ marginLeft: 6 }}>Hàng tặng</Tag>}{l.productType !== 'GOODS' && <Tag style={{ marginLeft: 6 }}>{l.productType === 'SERVICE' ? 'Dịch vụ' : 'Combo'}</Tag>}</div>
            <div className="price" onClick={() => setLineKey(l.key)}>{l.isGift ? <><s className="muted">{money(l.listPrice)}</s> 0</> : <>{money(l.unitPrice)}{l.discount > 0 && <span className="muted small"> −{money(l.discount)}</span>}</>}</div>
            {stepper(l)}
            {(l.trackBatch || l.error) && <div className="extra">{l.trackBatch && batchSelect(l, '100%')}{l.error && <div className="err">{l.error}</div>}</div>}
          </div>
        ))}
      </div>
      <div className="ps-foot">
        <div className="ps-tot"><span>Tổng tiền hàng <i className="ps-cnt">{fq(lineCount)}</i></span><b>{money(totals.subtotal)}</b></div>
        {mode === 'SALE' && (totals.discount > 0 || totals.promo > 0 || pointsValue > 0) && <div className="ps-tot sub"><span>Giảm giá{totals.promo > 0 ? ' + khuyến mãi' : ''}{pointsValue > 0 ? ' + điểm' : ''}</span><span>−{money(totals.discount + totals.promo + pointsValue)}</span></div>}
        {mode === 'SALE' && Math.abs(payable - totals.subtotal) >= 1 && <div className="ps-tot grand"><span>Khách cần trả</span><b>{previewing && <Spin size="small" style={{ marginRight: 6 }} />}{money(payable)}</b></div>}
        {mode === 'ORDER' && totals.discount > 0 && <div className="ps-tot sub"><span>Giảm giá đơn</span><span>−{money(totals.discount)}</span></div>}
        <div className="ps-btns">
          <Button size="large" loading={busy} onClick={() => void (mode === 'SALE' ? hold() : placeOrder(false))}>Lưu tạm</Button>
          {mode === 'SALE'
            ? <Button size="large" type="primary" disabled={!can('invoice.complete')} onClick={() => setView('pay')}>Thanh toán</Button>
            : <Button size="large" type="primary" loading={busy} onClick={() => void placeOrder(true)}>Đặt hàng</Button>}
        </div>
        {tab.draftId && <div className="kv-hint" style={{ textAlign: 'center', marginTop: 6 }}>Đang mở đơn tạm {tab.draftCode}</div>}
      </div>
    </>
  );

  // ---------------------------------------------------------------- thanh toán
  const payAmountInput = pay.mode === 'CASH' ? (pay.cashGiven ?? payable) : (pay.single.amount ?? payable);
  const setPayAmount = (v: number | string | null) => {
    const n = v === null || v === undefined || v === '' ? null : toNum(v);
    if (pay.mode === 'CASH') pay.setCashGiven(n); else pay.setSingle((s) => ({ ...s, amount: n === null ? null : Math.min(n, payable) }));
  };
  const isQr = pay.mode === 'QR';
  const otherMode = pay.mode === 'MIXED' || pay.mode === 'OTHER';
  const payView = (
    <>
      <div className="ps-top ps-pay-top">
        <div className="ps-head ps-cart-head">
          <button type="button" className="ps-ib" aria-label="Về giỏ hàng" onClick={() => setView('cart')}><LeftOutlined /></button>
          <h1>Thanh toán</h1>
        </div>
      </div>
      <div className="ps-pay-scroll">
        <button type="button" className="ps-pay-card row" onClick={() => setSheet('items')}><span>Xem hàng trong đơn <i className="ps-cnt gray">{fq(lineCount)}</i></span><RightOutlined className="chev" /></button>
        <div className="ps-pay-card">
          <div className="ps-pay-cap">KHÁCH HÀNG</div>
          <button type="button" className={`ps-pay-link ${tab.customerId ? 'set' : ''}`} onClick={() => setSheet('customer')}>{customerName}{tab.customerLabel && tab.customerLabel.includes(' · ') && <small>{tab.customerLabel.split(' · ').slice(1).join(' · ')}</small>}</button>
        </div>
        {can('delivery.manage') && (
          <div className="ps-pay-card">
            <div className="ps-pay-cap">GIAO HÀNG</div>
            {tab.delivery
              ? <button type="button" className="ps-pay-link set" onClick={() => { setDlv(tab.delivery!); setSheet('delivery'); }}>{tab.delivery.receiverName}{tab.delivery.receiverPhone ? ` · ${tab.delivery.receiverPhone}` : ''}<small>{tab.delivery.address}{tab.delivery.carrier ? ` · ${tab.delivery.carrier}` : ''}</small></button>
              : <button type="button" className="ps-pay-link" onClick={() => { setDlv({ receiverName: customerName === 'Khách lẻ' ? '' : customerName, address: '' }); setSheet('delivery'); }}>Nhập thông tin giao hàng</button>}
          </div>
        )}
        <div className="ps-pay-card ps-pay-tot">
          <div className="r"><span>Tổng tiền hàng <i className="ps-cnt gray">{fq(lineCount)}</i></span><b>{money(totals.subtotal)}</b></div>
          {canDiscount && (
            <div className="r in">
              <button type="button" className="lbl" onClick={() => setDiscountMode(tab.discountMode === 'PCT' ? 'AMOUNT' : 'PCT')}>Giảm giá ({tab.discountMode === 'PCT' ? '%' : 'VND'}) <SwapOutlined /></button>
              {tab.discountMode === 'PCT'
                ? <InputNumber className="ps-uline" variant="borderless" style={{ width: 140 }} min={0} max={100} step={1} value={tab.discountPct ?? 0} inputMode="decimal" onChange={(v) => patch(() => ({ discountPct: Math.max(0, Math.min(toNum(v ?? 0), 100)) }))} onFocus={(e) => e.target.select()} suffix="%" />
                : <MoneyInput className="ps-uline" variant="borderless" style={{ width: 140 }} value={tab.discount ?? 0} max={totals.subtotal} onChange={(v) => patch(() => ({ discount: Math.min(toNum(v), totals.subtotal) }))} onFocus={(e) => e.target.select()} />}
            </div>
          )}
          {canDiscount && tab.discountMode === 'PCT' && (tab.discount ?? 0) > 0 && <div className="hint">Giảm {toNum(tab.discountPct ?? 0)}% = −{money(tab.discount ?? 0)}</div>}
          {totals.promo > 0 && <div className="r"><span>Khuyến mãi</span><b className="green">−{money(totals.promo)}</b></div>}
          {totals.tax > 0 && <div className="r sub"><span>{priceIncludesTax ? 'Trong đó thuế' : 'Thuế'}</span><span>{money(totals.tax)}</span></div>}
          {pointsValue > 0 && <div className="r"><span>Thanh toán bằng điểm</span><b className="green">−{money(pointsValue)}</b></div>}
          <div className="r grand"><span>Khách cần trả</span><b className="blue">{previewing && <Spin size="small" style={{ marginRight: 6 }} />}{money(payable)}</b></div>
          {isQr ? <div className="r"><span>Khách chuyển khoản</span><b>{money(payable)}</b></div>
            : pay.mode === 'MIXED' ? <div className="r"><span>Khách thanh toán</span><b>{money(pay.paid)}</b></div>
            : <div className="r in"><span>Khách thanh toán</span><MoneyInput className="ps-uline big" variant="borderless" style={{ width: 160 }} value={payAmountInput} onChange={(v) => setPayAmount(v as number | null)} onFocus={(e) => e.target.select()} /></div>}
          {pay.mode === 'CASH' && payable > 0 && <div className="ps-suggest">{pay.suggest(payable).map((v) => <button type="button" key={v} className={(pay.cashGiven ?? payable) === v ? 'on' : ''} onClick={() => pay.setCashGiven(v)}>{money(v)}</button>)}</div>}
          {pay.change > 0 && <div className="r"><span>Tiền thừa trả khách</span><b className="green">{money(pay.change)}</b></div>}
          {!isQr && pay.mode !== 'CASH' && pay.mode !== 'MIXED' && <Input className="ps-ref" placeholder="Tham chiếu (mã GD, 4 số cuối thẻ…)" value={pay.single.reference} onChange={(e) => pay.setSingle((s) => ({ ...s, reference: e.target.value }))} />}
          {pay.mode === 'MIXED' && (
            <div className="ps-mixed">
              {pay.mixed.map((m, i) => (
                <div key={i} className="row">
                  <Select size="large" value={m.method} onChange={(v) => pay.setMixed((ms) => ms.map((x, j) => (j === i ? { ...x, method: v } : x)))} options={[...pay.methods, 'OTHER'].map((x) => ({ value: x, label: PAYMENT_METHOD_LABEL[x] ?? x }))} />
                  <MoneyInput size="large" value={m.amount} onChange={(v) => pay.setMixed((ms) => ms.map((x, j) => (j === i ? { ...x, amount: toNum(v) } : x)))} onFocus={(e) => e.target.select()} />
                  <button type="button" className="ps-ib" aria-label="Bỏ dòng" disabled={pay.mixed.length <= 1} onClick={() => pay.setMixed((ms) => ms.filter((_, j) => j !== i))}><DeleteOutlined /></button>
                </div>
              ))}
              {pay.mixed.length < 3 && <Button type="dashed" block icon={<PlusOutlined />} onClick={() => pay.setMixed((ms) => [...ms, { method: 'CARD', amount: 0 }])}>Thêm hình thức</Button>}
            </div>
          )}
          {pay.due > 0 && <div className={`r ${tab.customerId ? 'warn' : 'neg'}`}><span>{tab.customerId ? 'Còn nợ (ghi vào công nợ khách)' : 'Còn thiếu – chọn khách hàng để bán nợ'}</span><b>{money(pay.due)}</b></div>}
          <div className="ps-methods">
            <div className="seg">
              {pay.methods.map((m) => {
                const qrMode = m === 'BANK_TRANSFER' && pay.sepayReady;
                const on = qrMode ? pay.mode === 'QR' : pay.mode === m;
                return <button type="button" key={m} className={on ? 'on' : ''} onClick={() => pay.setMode(qrMode ? 'QR' : m)}>{METHOD_SHORT[m] ?? PAYMENT_METHOD_LABEL[m] ?? m}</button>;
              })}
            </div>
            <Dropdown trigger={['click']} menu={{ items: [{ key: 'MIXED', label: 'Kết hợp nhiều hình thức' }, { key: 'OTHER', label: 'Hình thức khác' }], selectedKeys: [pay.mode], onClick: ({ key }) => pay.setMode(key) }}>
              <button type="button" className={`more ${otherMode ? 'on' : ''}`} aria-label="Hình thức khác"><EllipsisOutlined /></button>
            </Dropdown>
          </div>
          {otherMode && <div className="hint right">{pay.mode === 'MIXED' ? 'Kết hợp nhiều hình thức' : 'Hình thức khác'}</div>}
          {isQr && <div className="hint">Bấm <b>Tạo mã QR</b> → khách quét bằng app ngân hàng → hóa đơn <b>tự hoàn tất</b> khi tiền về tài khoản.</div>}
          {pay.mode === 'BANK_TRANSFER' && !pay.sepayReady && <div className="hint">Bấm <b>Thanh toán</b> để hiện mã QR của cửa hàng, xác nhận khi đã nhận tiền.</div>}
          {tab.bankRequest && <div className="ps-qr-pending">Giỏ đang gắn mã chuyển khoản <b>{tab.bankRequest.code}</b> ({money(tab.bankRequest.amount)}) <a onClick={() => void pay.reopenQr()}>Mở lại</a></div>}
        </div>
        <div className="ps-pay-card ps-pay-promo">{promoBlock}</div>
        {loyaltyBlock && <div className="ps-pay-card ps-pay-promo">{loyaltyBlock}</div>}
        <div className="ps-pay-card">
          <div className="ps-pay-cap">GHI CHÚ</div>
          <Input.TextArea autoSize={{ minRows: 1, maxRows: 4 }} variant="borderless" className="ps-pay-note" placeholder="Ghi chú đơn hàng…" value={tab.note} onChange={(e) => patch(() => ({ note: e.target.value }))} />
        </div>
      </div>
      <div className="ps-foot ps-pay-foot">
        {isQr
          ? <Button size="large" type="primary" block icon={<QrcodeOutlined />} loading={busy || pay.qrBusy} disabled={!can('invoice.complete')} onClick={() => void pay.startQr()}>Tạo mã QR · {money(payable)}</Button>
          : <Button size="large" type="primary" block icon={pay.mode === 'BANK_TRANSFER' ? <QrcodeOutlined /> : undefined} loading={busy} disabled={!can('invoice.complete')} onClick={() => void pay.checkout()}>Thanh toán</Button>}
      </div>
    </>
  );

  return (
    <div className={`ps ${view === 'cart' ? 'ps-cartview' : view === 'pay' ? 'ps-payview' : ''}`}>
      {view === 'catalog' ? catalog : view === 'cart' ? cart : payView}

      {sheet === 'customer' && (
        <Drawer className="ps-sheet" placement="bottom" height="auto" open onClose={() => setSheet(null)} title="Khách hàng" styles={{ body: { padding: '12px 14px calc(16px + env(safe-area-inset-bottom))', minHeight: '46dvh' } }}>
          <CustomerSelect size="large" autoFocus value={tab.customerId} placeholder="Tìm theo SĐT / tên / mã khách" onChange={(id, c) => { setCustomer(id, c); if (id) setSheet(null); }} />
          {tab.customerLabel && <div className="kv-hint" style={{ marginTop: 6 }}>{tab.customerLabel}</div>}
          <Button block size="large" style={{ marginTop: 12 }} icon={<UserOutlined />} disabled={!tab.customerId} onClick={() => { setCustomer(undefined); setSheet(null); }}>Bán cho khách lẻ</Button>
        </Drawer>
      )}
      {sheet === 'pricebook' && optionSheet('Bảng giá', [{ value: undefined, label: 'Bảng giá chung', on: !tab.priceBookId, onPick: () => void changePriceBook(undefined) }, ...priceBookOptions.map((o) => ({ value: o.value, label: o.label, on: tab.priceBookId === o.value, onPick: () => void changePriceBook(o.value) }))])}
      {sheet === 'warehouse' && optionSheet('Kho bán hàng', warehouses.map((w) => ({ value: w.id, label: w.name, sub: w.code, on: w.id === warehouseId, onPick: () => setWarehouse(w.id) })))}
      {sheet === 'category' && optionSheet('Nhóm hàng', [{ value: undefined, label: 'Tất cả hàng hóa', on: !q.categoryId, onPick: () => setQ((s) => ({ ...s, categoryId: undefined, page: 1 })) }, ...flatCategories(categories ?? []).map((c) => ({ value: c.id, label: <span style={{ paddingLeft: c.depth * 16 }}>{c.depth > 0 ? '└ ' : ''}{c.name}</span>, on: q.categoryId === c.id, onPick: () => setQ((s) => ({ ...s, categoryId: c.id, page: 1 })) }))])}
      {sheet === 'more' && (
        <Drawer className="ps-sheet" placement="bottom" height="auto" open onClose={() => setSheet(null)} closable={false} styles={{ body: { padding: '8px 10px calc(12px + env(safe-area-inset-bottom))' } }}>
          <div className="ps-more">
            {can('order.view') && <button type="button" onClick={() => nav('/orders')}><span className="ic"><ShoppingOutlined /></span>Xử lý đặt hàng</button>}
            {can('payment.create') && <button type="button" onClick={() => nav('/payments?direction=IN&new=IN')}><span className="ic"><FormOutlined /></span>Lập phiếu thu</button>}
            {can('return.create') && <button type="button" onClick={() => nav('/sales-returns/new')}><span className="ic"><RollbackOutlined /></span>Trả hàng</button>}
            {(shift ? can('shift.close') : can('shift.open')) && <button type="button" onClick={() => { setSheet(null); (shift ? closeShift : openShift)(); }}><span className="ic"><ClockCircleOutlined /></span>{shift ? `Đóng ca ${shift.code}` : 'Mở ca bán hàng'}</button>}
            {can('shift.view') && <button type="button" onClick={() => nav('/shifts')}><span className="ic"><UnorderedListOutlined /></span>Danh sách ca</button>}
            <button type="button" onClick={() => { setSheet(null); addTab(); message.success('Đã mở hóa đơn mới'); }}><span className="ic"><PlusOutlined /></span>Hóa đơn mới</button>
          </div>
        </Drawer>
      )}
      {sheet === 'info' && (
        <Drawer className="ps-sheet" placement="bottom" height="auto" open onClose={() => setSheet(null)} title="Thông tin đơn" styles={{ body: { padding: '12px 14px calc(16px + env(safe-area-inset-bottom))', display: 'grid', gap: 12 } }}>
          <div><div className="kv-hint" style={{ marginBottom: 4 }}>Ghi chú đơn hàng</div><Input.TextArea rows={2} value={tab.note} onChange={(e) => patch(() => ({ note: e.target.value }))} placeholder="Ghi chú cho đơn này" /></div>
          <div><div className="kv-hint" style={{ marginBottom: 4 }}>Nhân viên bán</div>{sellers.length ? <Select size="large" style={{ width: '100%' }} value={tab.sellerId ?? me.user.id} onChange={(v) => patch(() => ({ sellerId: v }))} options={[{ value: me.user.id, label: me.user.fullName }, ...sellers.filter((u) => u.id !== me.user.id).map((u) => ({ value: u.id, label: u.fullName }))]} /> : <b>{me.user.fullName}</b>}</div>
          <div><div className="kv-hint" style={{ marginBottom: 4 }}>Kho xuất hàng</div><Select size="large" style={{ width: '100%' }} value={warehouseId} onChange={(v) => setWarehouse(v)} options={warehouses.map((w) => ({ value: w.id, label: w.name }))} /></div>
          {tabs.length > 1 && <div><div className="kv-hint" style={{ marginBottom: 4 }}>Hóa đơn đang mở</div><Select size="large" style={{ width: '100%' }} value={tab.id} onChange={(v) => setActive(v)} options={tabs.map((t) => ({ value: t.id, label: `${t.name}${t.lines.length ? ` · ${t.lines.length} dòng` : ''}` }))} /></div>}
        </Drawer>
      )}
      {variantPick && (
        <Drawer className="ps-sheet" placement="bottom" height="auto" open onClose={() => setVariantPick(null)} title={variantPick.name} styles={{ body: { padding: '0 0 calc(8px + env(safe-area-inset-bottom))', maxHeight: '70dvh', overflow: 'auto' } }}>
          {variantPick.variants.filter((v) => v.isActive !== false).map((v) => (
            <button type="button" key={v.id} className="ps-opt" onClick={() => { void addHit(toHit(variantPick, v)); setVariantPick(null); }}>
              <span><span className="t">{v.attributes && Object.keys(v.attributes).length ? Object.values(v.attributes).join(' / ') : v.name}</span><span className="s">{v.sku} · tồn {fq(v.onHand ?? v.onHandTotal)}</span></span>
              <b style={{ color: 'var(--kv-blue)' }}>{money(v.sellPrice)}</b>
            </button>
          ))}
        </Drawer>
      )}
      {editing && (
        <Drawer className="ps-sheet" placement="bottom" height="auto" open onClose={() => setLineKey(null)} title={<span style={{ whiteSpace: 'normal', fontSize: 16 }}>{editing.name}</span>} styles={{ body: { padding: '12px 14px calc(16px + env(safe-area-inset-bottom))', display: 'grid', gap: 12 } }}>
          <div className="ps-edit-row"><span>Số lượng</span>{stepper(editing)}</div>
          {editing.units.length > 0 && !editing.isGift && <div className="ps-edit-row"><span>Đơn vị</span><Select size="large" style={{ width: 180 }} value={editing.productUnitId ?? ''} onChange={(v) => void changeUnit(editing, v || undefined)} options={[{ value: '', label: editing.baseUnit ?? 'Đơn vị cơ bản' }, ...editing.units.map((u) => ({ value: u.id!, label: `${u.unitName} (×${toNum(u.conversionFactor)})` }))]} /></div>}
          {editing.trackBatch && <div className="ps-edit-row"><span>Lô hàng</span>{batchSelect(editing, 180)}</div>}
          <div className="ps-edit-row"><span>Đơn giá</span>{editing.isGift ? <b>0 <s className="muted">{money(editing.listPrice)}</s></b> : canPrice ? <MoneyInput size="large" style={{ width: 180 }} value={editing.unitPrice} onChange={(v) => setLine(editing.key, { unitPrice: toNum(v) })} /> : <b>{money(editing.unitPrice)}</b>}</div>
          {canDiscount && !editing.isGift && <div className="ps-edit-row"><span>Giảm giá dòng</span><MoneyInput size="large" style={{ width: 180 }} value={editing.discount} max={editing.quantity * editing.unitPrice} onChange={(v) => setLine(editing.key, { discount: Math.min(toNum(v), editing.quantity * editing.unitPrice) })} /></div>}
          <div className="ps-edit-row"><span>Ghi chú</span><Input size="large" style={{ width: 180 }} value={editing.note ?? ''} onChange={(e) => setLine(editing.key, { note: e.target.value })} placeholder="Ghi chú dòng" /></div>
          <div className="ps-edit-row total"><span>Thành tiền</span><b>{money(editing.isGift ? 0 : Math.max(0, editing.quantity * editing.unitPrice - editing.discount))}</b></div>
          {editing.onHand !== undefined && <div className="kv-hint">Tồn kho: {fq(editing.onHand)} {editing.baseUnit ?? ''}</div>}
          <Button danger size="large" icon={<DeleteOutlined />} onClick={() => { removeLine(editing.key); setLineKey(null); }}>Xóa khỏi giỏ</Button>
        </Drawer>
      )}
      {sheet === 'items' && (
        <Drawer className="ps-sheet" placement="bottom" height="auto" open onClose={() => setSheet(null)} title="Hàng hoá trong đơn" styles={{ body: { padding: '0 14px calc(12px + env(safe-area-inset-bottom))', maxHeight: '70dvh', overflow: 'auto' } }}>
          {tab.lines.map((l) => (
            <div key={l.key} className="ps-item">
              <Img src={l.imageUrl} />
              <div className="main">
                <div className="nm">{l.name}{l.unitName && l.unitName !== l.baseUnit ? <span className="unit"> ({l.unitName})</span> : null}{l.isGift && <Tag color="green" style={{ marginLeft: 6 }}>Hàng tặng</Tag>}</div>
                <div className="qty">{money(l.isGift ? 0 : l.unitPrice)} x{fq(l.quantity)}{l.discount > 0 && <span className="muted"> · giảm {money(l.discount)}</span>}</div>
              </div>
              <b>{money(l.isGift ? 0 : Math.max(0, l.quantity * l.unitPrice - l.discount))}</b>
            </div>
          ))}
        </Drawer>
      )}
      {sheet === 'delivery' && (
        <Drawer className="ps-sheet" placement="bottom" height="auto" open onClose={() => setSheet(null)} title="Thông tin giao hàng" styles={{ body: { padding: '12px 14px calc(16px + env(safe-area-inset-bottom))', display: 'grid', gap: 10 } }}>
          <Input size="large" placeholder="Tên người nhận *" value={dlv.receiverName} onChange={(e) => setDlv({ ...dlv, receiverName: e.target.value })} />
          <Input size="large" placeholder="Số điện thoại" inputMode="tel" value={dlv.receiverPhone ?? ''} onChange={(e) => setDlv({ ...dlv, receiverPhone: e.target.value })} />
          <Input.TextArea autoSize={{ minRows: 2, maxRows: 4 }} placeholder="Địa chỉ giao hàng *" value={dlv.address} onChange={(e) => setDlv({ ...dlv, address: e.target.value })} />
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 10 }}>
            <Input size="large" placeholder="Đơn vị vận chuyển" value={dlv.carrier ?? ''} onChange={(e) => setDlv({ ...dlv, carrier: e.target.value })} />
            <MoneyInput size="large" placeholder="Phí ship thu khách" value={dlv.shippingFee ?? 0} onChange={(v) => setDlv({ ...dlv, shippingFee: toNum(v) })} />
          </div>
          <Input size="large" placeholder="Ghi chú giao hàng" value={dlv.note ?? ''} onChange={(e) => setDlv({ ...dlv, note: e.target.value })} />
          <div className="kv-hint">Vận đơn được tạo ngay sau khi hóa đơn thanh toán xong; theo dõi ở mục Vận đơn (tab Khác → Giao hàng).</div>
          <div style={{ display: 'grid', gridTemplateColumns: tab.delivery ? '1fr 1fr' : '1fr', gap: 10 }}>
            {tab.delivery && <Button size="large" danger onClick={() => { patch(() => ({ delivery: undefined })); setSheet(null); }}>Bỏ giao hàng</Button>}
            <Button size="large" type="primary" disabled={!dlv.receiverName.trim() || !dlv.address.trim()} onClick={() => { patch(() => ({ delivery: { ...dlv, receiverName: dlv.receiverName.trim(), address: dlv.address.trim() } })); setSheet(null); }}>Lưu</Button>
          </div>
        </Drawer>
      )}
      <ProductFormModal open={newProduct} product={null} onClose={() => setNewProduct(false)} onSaved={() => { setNewProduct(false); setQ((s) => ({ ...s, page: 1 })); void refetch(); }} />
      {children}
    </div>
  );
}
