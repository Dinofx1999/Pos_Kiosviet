import { App, Badge, Button, Drawer, Dropdown, Input, Select, Spin, Tag } from 'antd';
import { CheckOutlined, ClockCircleOutlined, CloseOutlined, DeleteOutlined, DownOutlined, EllipsisOutlined, FileTextOutlined, FilterOutlined, FormOutlined, HistoryOutlined, MinusOutlined, PlusOutlined, RightOutlined, RollbackOutlined, SearchOutlined, ShopOutlined, ShoppingCartOutlined, ShoppingOutlined, TagOutlined, UnorderedListOutlined, UserOutlined } from '@ant-design/icons';
import { ReactNode, useEffect, useMemo, useRef, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { catalogApi, useCategories, useProducts } from '../../api/catalog';
import { errMsg } from '../../api/client';
import type { Category, CustomerHit, Me, Product, SearchHit, Variant, Warehouse } from '../../api/types';
import { BarcodeScanButton } from '../../components/BarcodeScanner';
import { CustomerSelect } from '../../components/CustomerSelect';
import { MoneyInput } from '../../components/Inputs';
import { MobileTabBar } from '../../components/layout/MobileTabBar';
import { ProductSearch } from '../../components/ProductSearch';
import { PRODUCT_TYPE_LABEL, money, qty as fq, toNum } from '../../utils/format';
import { ProductFormModal } from '../products/ProductFormModal';
import type { CartLine, CartTab } from './posStore';
import './pos-mobile.css';

const PAGE = 30;
const MODE_KEY = 'pos.mode';
type Mode = 'SALE' | 'ORDER';
type Sheet = null | 'customer' | 'pricebook' | 'warehouse' | 'category' | 'more' | 'info';

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
  hold: () => Promise<void>; placeOrder: (confirm: boolean) => Promise<void>; openPay: () => void; openHeld: () => void;
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
  const { me, can, tab, tabs, setActive, addTab, warehouses, warehouseId, setWarehouse, addHit, setLine, removeLine, patch, setCustomer, changeUnit, changePriceBook, canPriceBook, priceBookOptions, canPrice, canDiscount, totals, payable, pointsValue, previewing, giftPrompt, batchSelect, giftMax, sellers, busy, hold, placeOrder, openPay, openHeld, shift, openShift, closeShift } = ctx;
  const canOrder = can('order.create');
  const [view, setView] = useState<'catalog' | 'cart'>('catalog');
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
  useEffect(() => { if (!tab.lines.length && view === 'cart') setView('catalog'); }, [tab.lines.length]);
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
          <button type="button" className="ps-ib" aria-label="Đơn tạm" title="Đơn tạm (đơn đang giữ)" onClick={openHeld}><HistoryOutlined /></button>
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
            ? <Button size="large" type="primary" disabled={!can('invoice.complete')} onClick={openPay}>Thanh toán</Button>
            : <Button size="large" type="primary" loading={busy} onClick={() => void placeOrder(true)}>Đặt hàng</Button>}
        </div>
        {tab.draftId && <div className="kv-hint" style={{ textAlign: 'center', marginTop: 6 }}>Đang mở đơn tạm {tab.draftCode}</div>}
      </div>
    </>
  );

  return (
    <div className={`ps ${view === 'cart' ? 'ps-cartview' : ''}`}>
      {view === 'catalog' ? catalog : cart}

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
      <ProductFormModal open={newProduct} product={null} onClose={() => setNewProduct(false)} onSaved={() => { setNewProduct(false); setQ((s) => ({ ...s, page: 1 })); void refetch(); }} />
      {children}
    </div>
  );
}
