import { useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import { Link, useLocation, useNavigate, useParams, useSearchParams } from 'react-router-dom';
import { lsGet, lsSet, ORDER_STATUS, DELIVERY_STATUS, shopApi, ShopError, telLink, uid, vnd, zaloLink, type Category, type FlashSaleData, type OrderSummary, type ProductCard, type ProductDetail, type ProductList, type Variant } from './api';
import { cart, lineEstimate, useCart } from './cart';
import { catName, prettyPhone, splitName } from './format';
import { Countdown, dropCache, FlashBar, Icon, Img, PriceTag, Qty, toast, useAsync, useShop } from './ui';

const useTitle = (t: string) => useEffect(() => { document.title = t; }, [t]);
const scrollToAll = () => setTimeout(() => document.getElementById('all')?.scrollIntoView({ behavior: 'smooth', block: 'start' }), 60);

/** tìm danh mục (cấp 1 hoặc cấp 2) và danh mục cha */
function findCat(list: Category[] | undefined, id: string): { cat: Category; parent: Category | null } | null {
  for (const c of list ?? []) {
    if (c.id === id) return { cat: c, parent: null };
    const ch = c.children?.find((x) => x.id === id);
    if (ch) return { cat: ch, parent: c };
  }
  return null;
}

// ================================================================ trang chủ
export function HomePage() {
  const { cfg } = useShop();
  const [sp, setSp] = useSearchParams();
  const search = sp.get('q') ?? '';
  const categoryId = sp.get('c') ?? '';
  const sort = sp.get('s') ?? 'featured';
  const combo = sp.get('combo') === '1' && !search;
  const comboGroups = cfg.combos?.groups ?? [];
  const comboGroup = combo && categoryId ? comboGroups.find((g) => g.id === categoryId) : undefined;
  const found = categoryId && !combo ? findCat(cfg.categories, categoryId) : null;
  useTitle(search ? `Tìm "${search}" – ${cfg.shopName}` : combo ? `Combo${comboGroup ? ` ${catName(comboGroup.name)}` : ''} – ${cfg.shopName}` : found ? `${catName(found.cat.name)} – ${cfg.shopName}` : cfg.shopName);
  const setParam = (k: string, v: string) => { const n = new URLSearchParams(sp); if (v) n.set(k, v); else n.delete(k); setSp(n, { replace: k === 's' }); };
  const filtering = !!search || !!categoryId || combo;
  /** mục Combo: chip theo nhóm combo, giữ combo=1 */
  const pickComboGroup = (id: string) => { const n = new URLSearchParams({ combo: '1' }); if (id) n.set('c', id); setSp(n); window.scrollTo({ top: 0 }); };
  const cats = cfg.categories ?? [];
  const pickCat = (id: string) => { const n = new URLSearchParams(); if (id) n.set('c', id); setSp(n); window.scrollTo({ top: 0 }); };
  const showAll = (s: string) => { setParam('s', s); scrollToAll(); };
  // chip: trang chủ = danh mục cấp 1; trong danh mục = danh mục con của nhóm đó
  const group = found ? (found.parent ?? found.cat) : null;
  const chips = group ? (group.children ?? []) : cats;

  return (
    <div className="sh-home">
      {!filtering && (
        <>
          <Hero />
          {cfg.flashSaleEnabled && <FlashStrip />}
          {(cfg.combos?.count ?? 0) > 0 && <Rail title="Combo ưu đãi" icon={Icon.bag(16)} query={{ type: 'combo' }} moreTo="/?combo=1" />}
          <TrustRow />
          {cats.length > 0 && <CategoryTiles cats={cats} onPick={pickCat} onCombo={(cfg.combos?.count ?? 0) > 0 ? () => pickComboGroup('') : undefined} />}
          <Rail title="Bán chạy" icon={Icon.sparkle(16)} query={{ sort: 'best', ready: 1 }} onMore={() => showAll('best')} />
          <Rail title="Hàng mới về" query={{ sort: 'new', ready: 1 }} onMore={() => showAll('new')} />
        </>
      )}
      <section className="sh-sec sh-all" id="all">
        {search ? (
          <div className="sh-listhead"><div className="crumb"><Link to="/">Trang chủ</Link>{Icon.chev(14)}<span>Tìm kiếm</span></div><h1>Kết quả cho “{search}”</h1></div>
        ) : combo ? (
          <div className="sh-listhead">
            <div className="crumb"><Link to="/">Trang chủ</Link>{Icon.chev(14)}{comboGroup ? <><button onClick={() => pickComboGroup('')}>Combo</button>{Icon.chev(14)}<span>{catName(comboGroup.name)}</span></> : <span>Combo</span>}</div>
            <h1>{comboGroup ? catName(comboGroup.name) : 'Combo ưu đãi'}</h1>
          </div>
        ) : found ? (
          <div className="sh-listhead">
            <div className="crumb"><Link to="/">Trang chủ</Link>{Icon.chev(14)}{found.parent && <><button onClick={() => pickCat(found.parent!.id)}>{catName(found.parent.name)}</button>{Icon.chev(14)}</>}<span>{catName(found.cat.name)}</span></div>
            <h1>{catName(found.cat.name)}</h1>
          </div>
        ) : (
          <div className="sh-sec-head"><h2>Tất cả sản phẩm</h2></div>
        )}
        {combo && comboGroups.length > 1 && (
          <div className="sh-chips" role="tablist">
            <button className={!categoryId ? 'on' : ''} onClick={() => pickComboGroup('')}>Tất cả</button>
            {comboGroups.map((g) => <button key={g.id} className={categoryId === g.id ? 'on' : ''} onClick={() => pickComboGroup(g.id)}>{catName(g.name)}</button>)}
          </div>
        )}
        {!search && !combo && chips.length > 0 && (
          <div className="sh-chips" role="tablist">
            <button className={!categoryId || (group && categoryId === group.id) ? 'on' : ''} onClick={() => pickCat(group?.id ?? '')}>Tất cả</button>
            {chips.map((c) => <button key={c.id} className={categoryId === c.id ? 'on' : ''} onClick={() => pickCat(c.id)}>{catName(c.name)}</button>)}
          </div>
        )}
        <ProductFeed key={`${search}|${categoryId}|${sort}|${combo}`} search={search} categoryId={categoryId} sort={sort} combo={combo} onSort={(v) => setParam('s', v === 'featured' ? '' : v)} />
      </section>
    </div>
  );
}

function Hero() {
  const { cfg } = useShop();
  const { data } = useAsync<ProductList>('hero', () => shopApi.products({ sort: 'best', ready: 1, pageSize: 3 }));
  const zalo = zaloLink(cfg.zalo);
  if (cfg.bannerUrl) return <div className="sh-banner"><Img src={cfg.bannerUrl} alt={cfg.shopName} eager /></div>;
  const total = (cfg.categories ?? []).reduce((s, c) => s + c.count, 0);
  const pics = (data?.items ?? []).filter((p) => p.imageUrl).slice(0, 3);
  return (
    <section className="sh-hero">
      <div className="txt">
        <span className="eyebrow">{Icon.sparkle(13)} Mỹ phẩm · Chăm sóc da · Nước hoa</span>
        <h1>{cfg.shopName}</h1>
        <p>{cfg.intro || `${total >= 100 ? `Hơn ${(Math.floor(total / 100) * 100).toLocaleString('vi-VN')}` : total.toLocaleString('vi-VN')} sản phẩm làm đẹp. Đặt online dễ dàng, cửa hàng gọi xác nhận rồi giao tận nơi.`}</p>
        <div className="cta">
          <a href="#all" className="sh-btn" onClick={(e) => { e.preventDefault(); scrollToAll(); }}>Mua sắm ngay</a>
          {zalo && <a className="sh-btn soft" href={zalo} target="_blank" rel="noreferrer">{Icon.chat(18)} Tư vấn Zalo</a>}
        </div>
      </div>
      <div className="pics" aria-hidden={!pics.length}>
        {pics.length ? pics.map((p, i) => <Link key={p.id} to={`/p/${p.id}`} className={`pic p${i}`} aria-label={p.name}><Img src={p.imageUrl} alt={p.name} eager /></Link>)
          : [0, 1, 2].map((i) => <span key={i} className={`pic p${i} sk`} />)}
      </div>
    </section>
  );
}

function TrustRow() {
  const { cfg } = useShop();
  const zalo = zaloLink(cfg.zalo);
  const items: Array<{ icon: ReactNode; t: string; s: string }> = [
    { icon: Icon.wallet(20), t: 'Thanh toán khi nhận', s: 'hoặc chuyển khoản' },
    { icon: Icon.shield(20), t: 'Gọi xác nhận đơn', s: 'trước khi giao hàng' },
    { icon: Icon.headset(20), t: zalo ? 'Tư vấn qua Zalo' : 'Tư vấn qua hotline', s: cfg.hotline ? prettyPhone(cfg.hotline) : 'mọi ngày' },
  ];
  return <div className="sh-trust">{items.map((x) => <div key={x.t} className="it"><span className="ic">{x.icon}</span><span><b>{x.t}</b><small>{x.s}</small></span></div>)}</div>;
}

function CategoryTiles({ cats, onPick, onCombo }: { cats: Category[]; onPick: (id: string) => void; onCombo?: () => void }) {
  return (
    <section className="sh-sec">
      <div className="sh-sec-head"><h2>Danh mục</h2></div>
      <div className={`sh-cats ${cats.length + (onCombo ? 1 : 0) <= 8 ? 'few' : ''}`}>
        {onCombo && <button className="sh-cat combo" onClick={onCombo}><span className="ic">{Icon.bag(30)}</span><span className="nm">Combo</span></button>}
        {cats.map((c) => (
          <button key={c.id} className={`sh-cat ${c.ownImage ? 'own' : ''}`} onClick={() => onPick(c.id)}>
            <span className="ic"><Img src={c.imageUrl} alt="" /></span>
            <span className="nm">{catName(c.name)}</span>
          </button>
        ))}
      </div>
    </section>
  );
}

/** Dải hàng cuộn ngang (Bán chạy, Hàng mới về, Cùng danh mục). */
function Rail({ title, icon, query, onMore, moreTo }: { title: string; icon?: ReactNode; query: { sort?: string; ready?: 1; categoryId?: string; exclude?: string; type?: 'combo' }; onMore?: () => void; moreTo?: string }) {
  const key = `rail:${JSON.stringify(query)}`;
  const { data, loading } = useAsync<ProductList>(key, () => shopApi.products({ ...query, pageSize: 12 }));
  if (!loading && !data?.items.length) return null;
  return (
    <section className="sh-sec">
      <div className="sh-sec-head">
        <h2>{icon}{title}</h2>
        {onMore && <button className="sh-morelink" onClick={onMore}>Xem tất cả {Icon.chev(16)}</button>}
        {moreTo && <Link className="sh-morelink" to={moreTo}>Xem tất cả {Icon.chev(16)}</Link>}
      </div>
      <div className="sh-rail">
        {data ? data.items.map((p) => <ProductTile key={p.id} p={p} />) : Array.from({ length: 6 }).map((_, i) => <SkCard key={i} />)}
      </div>
    </section>
  );
}

const SkCard = () => <div className="sh-card sk"><div className="img" /><div className="body"><div className="l1" /><div className="l2" /></div></div>;

function ProductFeed({ search, categoryId, sort, combo, onSort }: { search: string; categoryId: string; sort: string; combo?: boolean; onSort: (v: string) => void }) {
  const { cfg } = useShop();
  const [page, setPage] = useState(1);
  const [items, setItems] = useState<ProductCard[]>([]);
  const [total, setTotal] = useState<number | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  useEffect(() => {
    let alive = true;
    setLoading(true); setErr(null);
    shopApi.products({ search: search || undefined, categoryId: categoryId || undefined, sort, page, pageSize: 24, type: combo ? 'combo' : undefined })
      .then((r) => { if (!alive) return; setItems((cur) => (page === 1 ? r.items : [...cur, ...r.items.filter((x) => !cur.some((c) => c.id === x.id))])); setTotal(r.total); })
      .catch((e: ShopError) => alive && setErr(e.message)).finally(() => alive && setLoading(false));
    return () => { alive = false; };
  }, [page, search, categoryId, sort, combo]);
  const bar = (
    <div className="sh-listbar">
      <span className="cnt">{total !== null ? `${total.toLocaleString('vi-VN')} sản phẩm` : ' '}</span>
      <label className="sh-sort">
        <span>Sắp xếp</span>
        <select value={sort} onChange={(e) => onSort(e.target.value)} aria-label="Sắp xếp">
          <option value="featured">Nổi bật</option>
          <option value="best">Bán chạy</option>
          <option value="new">Mới nhất</option>
          {cfg.showPrice && <option value="price_asc">Giá thấp → cao</option>}
          {cfg.showPrice && <option value="price_desc">Giá cao → thấp</option>}
          <option value="name">Tên A → Z</option>
        </select>
      </label>
    </div>
  );
  if (err && !items.length) return <>{bar}<div className="sh-empty">{err} <button className="sh-link" onClick={() => setPage(1)}>Thử lại</button></div></>;
  if (!loading && total === 0) return <>{bar}<div className="sh-empty">{Icon.search(36)}<div>{search ? 'Không tìm thấy sản phẩm phù hợp.' : 'Chưa có sản phẩm.'}</div>{search && <Link to="/" className="sh-btn soft">Xem tất cả sản phẩm</Link>}</div></>;
  return (
    <>
      {bar}
      <div className="sh-grid">
        {items.map((p) => <ProductTile key={p.id} p={p} />)}
        {loading && Array.from({ length: page === 1 ? 8 : 4 }).map((_, i) => <SkCard key={`sk${i}`} />)}
      </div>
      {total !== null && items.length < total && !loading && <button className="sh-more" onClick={() => setPage((p) => p + 1)}>Xem thêm sản phẩm <span>({(total - items.length).toLocaleString('vi-VN')})</span></button>}
    </>
  );
}

/** % khách tiết kiệm khi mua combo so với mua lẻ (≥ 1%). */
const savePct = (p: ProductCard) => (p.retailPrice && p.price !== null && p.retailPrice > p.price ? Math.max(1, Math.round(((p.retailPrice - p.price) / p.retailPrice) * 100)) : 0);

function ProductTile({ p }: { p: ProductCard }) {
  const { cfg } = useShop();
  const nav = useNavigate();
  const { brand, title } = splitName(p.name, p.brand);
  // hàng không có phiên bản → thêm thẳng vào giỏ; có phiên bản → mở trang chi tiết để chọn
  const quickAdd = (e: React.MouseEvent) => {
    e.preventDefault(); e.stopPropagation();
    if (p.variantId && p.variantCount === 1) { cart.add({ variantId: p.variantId, productId: p.id, name: p.name, variantName: null, imageUrl: p.imageUrl, price: p.price, flash: p.flash, maxQuantity: p.maxQuantity ?? 999 }, 1); toast('Đã thêm vào giỏ'); }
    else nav(`/p/${p.id}`);
  };
  return (
    <Link to={`/p/${p.id}`} className={`sh-card ${p.inStock ? '' : 'oos'}`}>
      <div className="img">
        <Img src={p.imageUrl} alt={p.name} />
        {p.flash ? <span className="sh-badge flash">{Icon.bolt(11)} -{p.flash.discountPercent}%</span>
          : p.type === 'COMBO' && <span className="sh-badge combo">Combo{savePct(p) ? ` -${savePct(p)}%` : ''}</span>}
        {!p.inStock && <span className="sh-oos">Hết hàng</span>}
        {cfg.showStock && p.inStock && p.available !== null && p.available <= 10 && <span className="sh-left">Còn {p.available}</span>}
        {p.variantCount > 1 && <span className="sh-vc">{p.variantCount} loại</span>}
      </div>
      <div className="body">
        <div className="br">{brand ?? ' '}</div>
        <div className="nm">{title}</div>
        <div className="foot">
          <PriceTag price={p.price} priceMax={p.variantCount > 1 ? p.priceMax : null} flash={p.flash} />
          {cfg.allowOrder && <button type="button" className="sh-add" aria-label={p.variantCount > 1 ? 'Chọn phân loại' : 'Thêm vào giỏ'} disabled={!p.inStock} onClick={quickAdd}>{Icon.cartPlus(17)}</button>}
        </div>
      </div>
    </Link>
  );
}

// ---------------------------------------------------------------- Flash Sale
function useFlash() {
  return useAsync<FlashSaleData>('flash', () => shopApi.flashSale());
}

function FlashCard({ it }: { it: FlashSaleData['campaigns'][number]['items'][number] }) {
  const { brand, title } = splitName(it.name);
  return (
    <Link to={`/p/${it.productId}?v=${it.variantId}`} className={`sh-card ${it.soldOut || !it.inStock ? 'oos' : ''}`}>
      <div className="img"><Img src={it.imageUrl} alt={it.name} /><span className="sh-badge flash">{Icon.bolt(11)} -{it.discountPercent}%</span>{(it.soldOut || !it.inStock) && <span className="sh-oos">{it.soldOut ? 'Hết suất' : 'Hết hàng'}</span>}</div>
      <div className="body">
        <div className="br">{brand ?? ' '}</div>
        <div className="nm">{title}</div>
        {it.salePrice !== null ? <div className="sh-price"><span className="now flash">{vnd(it.salePrice)}</span>{it.price !== null && it.price > 0 && <span className="old">{vnd(it.price)}</span>}</div> : <div className="sh-price contact">Giá sốc · Liên hệ</div>}
        <FlashBar sold={it.sold} limit={it.limit} remaining={!it.inStock ? 0 : it.remaining} />
        {it.perOrderLimit && <div className="sh-lim">Tối đa {it.perOrderLimit}/đơn</div>}
      </div>
    </Link>
  );
}

function FlashStrip() {
  const { data, reload } = useFlash();
  if (!data?.enabled) return null;
  const c = data.campaigns[0];
  if (!c) {
    if (!data.upcoming) return null;
    return (
      <div className="sh-flash upcoming">
        <div className="sh-flash-head"><span className="ttl">{Icon.bolt(18)} FLASH SALE</span><span className="sub">{data.upcoming.name} bắt đầu sau</span><Countdown to={data.upcoming.startsAt} onEnd={() => { dropCache('flash'); reload(); }} compact /></div>
      </div>
    );
  }
  const items = data.campaigns.flatMap((x) => x.items);
  return (
    <div className="sh-flash">
      <div className="sh-flash-head">
        <span className="ttl">{Icon.bolt(18)} FLASH SALE</span>
        <span className="sub">Kết thúc sau</span>
        <Countdown to={c.endsAt} onEnd={() => { dropCache('flash'); reload(); }} compact />
        <Link to="/flash-sale" className="all">Xem tất cả {Icon.chev(14)}</Link>
      </div>
      <div className="sh-rail">{items.slice(0, 12).map((it) => <FlashCard key={it.itemId} it={it} />)}</div>
    </div>
  );
}

export function FlashSalePage() {
  const { data, loading, reload } = useFlash();
  const { cfg } = useShop();
  useTitle(`Flash Sale – ${cfg.shopName}`);
  if (loading && !data) return <div className="sh-empty">Đang tải…</div>;
  if (!data?.enabled || (!data.campaigns.length && !data.upcoming)) return <div className="sh-empty">{Icon.bolt(36)}<div>Hiện chưa có chương trình Flash Sale.</div><Link to="/" className="sh-btn soft">Xem sản phẩm</Link></div>;
  return (
    <div className="sh-sec">
      {!data.campaigns.length && data.upcoming && (
        <div className="sh-flash upcoming"><div className="sh-flash-head"><span className="ttl">{Icon.bolt(18)} {data.upcoming.name}</span><span className="sub">bắt đầu sau</span><Countdown to={data.upcoming.startsAt} onEnd={() => { dropCache('flash'); reload(); }} /></div></div>
      )}
      {data.campaigns.map((c) => (
        <div key={c.id} className="sh-flash page">
          <div className="sh-flash-head"><span className="ttl">{Icon.bolt(18)} {c.name}</span><span className="sub">Kết thúc sau</span><Countdown to={c.endsAt} onEnd={() => { dropCache('flash'); reload(); }} /></div>
          <div className="sh-grid">{c.items.map((it) => <FlashCard key={it.itemId} it={it} />)}</div>
        </div>
      ))}
    </div>
  );
}

// ================================================================ chi tiết sản phẩm
const variantLabel = (v: Variant, p: ProductDetail) => {
  if (v.attributes && Object.keys(v.attributes).length) return Object.values(v.attributes).join(' · ');
  const raw = v.name.startsWith(p.name) ? v.name.slice(p.name.length).replace(/^[\s\-–·:]+/, '') || v.sku : v.name;
  return splitName(raw).title;
};

export function ProductPage() {
  const { id = '' } = useParams();
  const [sp] = useSearchParams();
  const nav = useNavigate();
  const { cfg } = useShop();
  const { data: p, error, loading, reload } = useAsync<ProductDetail>(`p:${id}`, () => shopApi.product(id));
  const [vid, setVid] = useState<string | null>(sp.get('v'));
  const [qty, setQty] = useState(1);
  const [imgIdx, setImgIdx] = useState(0);
  const [more, setMore] = useState(false);
  const gallery = useRef<HTMLDivElement>(null);
  useTitle(p ? `${p.name} – ${cfg.shopName}` : cfg.shopName);
  useEffect(() => { if (p && (!vid || !p.variants.some((v) => v.id === vid))) setVid((p.variants.find((v) => v.inStock) ?? p.variants[0]).id); }, [p]);
  useEffect(() => { setMore(false); window.scrollTo({ top: 0 }); }, [id]);
  const v = p?.variants.find((x) => x.id === vid) ?? p?.variants[0];
  const images = useMemo(() => {
    if (!p) return [] as string[];
    const list = v?.imageUrl ? [v.imageUrl, ...p.images.filter((u) => u !== v.imageUrl)] : p.images;
    return list.length ? list : [''];
  }, [p, v?.imageUrl]);
  useEffect(() => { setImgIdx(0); gallery.current?.scrollTo({ left: 0 }); }, [v?.id]);
  useEffect(() => { if (v) setQty((q) => Math.max(1, Math.min(q, v.maxQuantity || 1))); }, [v?.id]);

  if (loading && !p) return <div className="sh-pdp sk"><div className="sh-gallery-wrap"><div className="sk-img" /></div><div className="sh-pdp-info"><div className="l1" /><div className="l2" /></div></div>;
  if (error || !p || !v) return <div className="sh-empty">{Icon.bag(36)}<div>{error?.status === 404 ? 'Sản phẩm không còn bán online.' : error?.message ?? 'Không tải được sản phẩm'}</div><Link className="sh-btn soft" to="/">Về trang chủ</Link></div>;

  const { brand, title } = splitName(p.name, p.brand);
  const canBuy = cfg.allowOrder && v.inStock;
  const add = (go: boolean) => {
    cart.add({ variantId: v.id, productId: p.id, name: p.name, variantName: p.variants.length > 1 ? variantLabel(v, p) : null, imageUrl: v.imageUrl ?? p.images[0] ?? null, price: v.price, flash: v.flash, maxQuantity: v.maxQuantity }, qty);
    if (go) nav('/gio-hang'); else toast('Đã thêm vào giỏ hàng');
  };
  const zalo = zaloLink(cfg.zalo);
  const tel = telLink(cfg.hotline);
  const go = (i: number) => gallery.current?.scrollTo({ left: i * (gallery.current?.clientWidth ?? 0), behavior: 'smooth' });
  const longDesc = (p.description?.length ?? 0) > 420;

  return (
    <>
      <div className="sh-pdp">
        <div className="sh-crumb"><Link to="/">Trang chủ</Link>{p.category && <>{Icon.chev(13)}<Link to={`/?c=${p.category.id}`}>{catName(p.category.name)}</Link></>}</div>
        <div className="sh-gallery-wrap">
          <div className="sh-gallery" ref={gallery} onScroll={(e) => { const el = e.currentTarget; setImgIdx(Math.round(el.scrollLeft / el.clientWidth)); }}>
            {images.map((u, i) => <Img key={u + i} src={u || null} alt={`${p.name} ${i + 1}`} eager={i === 0} />)}
          </div>
          {images.length > 1 && <div className="sh-dots">{images.map((_, i) => <button key={i} aria-label={`Ảnh ${i + 1}`} className={i === imgIdx ? 'on' : ''} onClick={() => go(i)} />)}</div>}
          {images.length > 1 && <div className="sh-thumbs">{images.map((u, i) => <button key={u + i} className={i === imgIdx ? 'on' : ''} onClick={() => go(i)} aria-label={`Ảnh ${i + 1}`}><Img src={u || null} alt="" /></button>)}</div>}
          {v.flash && <span className="sh-badge flash big">{Icon.bolt(14)} -{v.flash.discountPercent}%</span>}
        </div>
        <div className="sh-pdp-info">
          {v.flash && (
            <div className="sh-pdp-flash">
              <span className="ttl">{Icon.bolt(16)} FLASH SALE</span>
              <span className="sub">Kết thúc sau</span>
              <Countdown to={v.flash.endsAt} compact onEnd={() => { dropCache('p:'); reload(); }} />
            </div>
          )}
          {brand && <Link to={`/?q=${encodeURIComponent(brand)}`} className="sh-pdp-brand">{brand}</Link>}
          <h1>{title}</h1>
          <div className="sh-meta">Mã: {v.sku}{p.unit ? ` · ĐVT: ${p.unit}` : ''}</div>
          <div className="sh-pricebox">
            <PriceTag price={v.price} flash={v.flash} big />
            {v.flash && v.flash.remaining !== null && <FlashBar sold={v.flash.sold} limit={v.flash.limit} remaining={v.flash.remaining} />}
            {v.flash?.perOrderLimit ? <div className="kv">Giá Flash Sale tối đa {v.flash.perOrderLimit} sản phẩm/đơn, phần vượt tính giá thường.</div> : null}
          </div>
          {p.variants.length > 1 && (
            <div className="sh-variants">
              <div className="lbl">{p.attributeNames.length ? p.attributeNames.join(' / ') : 'Phân loại'}: <b>{variantLabel(v, p)}</b></div>
              <div className="opts">
                {p.variants.map((x) => (
                  <button key={x.id} className={`${x.id === v.id ? 'on' : ''} ${x.inStock ? '' : 'oos'}`} onClick={() => setVid(x.id)}>
                    {x.imageUrl && <Img src={x.imageUrl} alt="" />}<span>{variantLabel(x, p)}</span>{x.flash && <i>{Icon.bolt(10)}</i>}
                  </button>
                ))}
              </div>
            </div>
          )}
          <div className="sh-stockrow">
            <div className="sh-stock">{v.inStock ? <span className="ok">{Icon.check(16)} {v.available !== null ? `Còn ${v.available}${v.available >= 99 ? '+' : ''} sản phẩm` : 'Còn hàng'}</span> : <span className="no">Tạm hết hàng</span>}</div>
            {canBuy && <Qty value={qty} max={Math.max(1, v.maxQuantity)} onChange={setQty} />}
          </div>
          <div className="sh-buy-desk">
            {cfg.allowOrder ? (
              v.inStock ? <><button className="sh-btn ghost" onClick={() => add(false)}>{Icon.cartPlus(18)} Thêm vào giỏ</button><button className="sh-btn" onClick={() => add(true)}>Mua ngay</button></>
                : <>{tel && <a className="sh-btn ghost" href={tel}>{Icon.phone(18)} Gọi hỏi hàng</a>}<button className="sh-btn" disabled>Tạm hết hàng</button></>
            ) : (
              <>{tel && <a className="sh-btn ghost" href={tel}>{Icon.phone(18)} Gọi đặt hàng</a>}{zalo && <a className="sh-btn" href={zalo} target="_blank" rel="noreferrer">Nhắn Zalo</a>}</>
            )}
          </div>
          <ul className="sh-policy">
            <li>{Icon.wallet(18)}<span><b>Thanh toán khi nhận hàng</b> hoặc chuyển khoản theo hướng dẫn của cửa hàng</span></li>
            <li>{Icon.shield(18)}<span><b>Cửa hàng gọi xác nhận</b> trước khi giao, báo phí giao hàng (nếu có)</span></li>
            {(tel || zalo) && <li>{Icon.headset(18)}<span><b>Cần tư vấn?</b> {tel && <a href={tel}>{prettyPhone(cfg.hotline)}</a>}{tel && zalo && ' · '}{zalo && <a href={zalo} target="_blank" rel="noreferrer">Nhắn Zalo</a>}</span></li>}
          </ul>
        </div>
        {p.combo && p.combo.items.length > 0 && (
          <div className="sh-desc sh-combo">
            <h3>Combo gồm {p.combo.items.length} sản phẩm</h3>
            <ul>{p.combo.items.map((c, i) => <li key={i}>{c.imageUrl ? <Img src={c.imageUrl} alt="" /> : <span className="ph" />}<span className="nm">{splitName(c.name).title}</span><b>× {c.quantity.toLocaleString('vi-VN')}</b></li>)}</ul>
            {p.combo.retailPrice !== null && v.price !== null && p.combo.retailPrice > v.price && <div className="sv">Mua lẻ {vnd(p.combo.retailPrice)} · tiết kiệm <b>{vnd(p.combo.retailPrice - v.price)}</b></div>}
          </div>
        )}
        {p.description && (
          <div className="sh-desc">
            <h3>Mô tả sản phẩm</h3>
            <div className={`txt ${longDesc && !more ? 'clamp' : ''}`}>{p.description}</div>
            {longDesc && <button className="sh-link" onClick={() => setMore((m) => !m)}>{more ? 'Thu gọn' : 'Xem thêm'}</button>}
          </div>
        )}
      </div>
      {p.category && <div className="sh-related"><Rail title="Sản phẩm cùng danh mục" query={{ categoryId: p.category.id, ready: 1, sort: 'best', exclude: p.id }} moreTo={`/?c=${p.category.id}`} /></div>}
      <div className="sh-buybar">
        {zalo && <a className="sh-buybar-ic" href={zalo} target="_blank" rel="noreferrer" aria-label="Nhắn Zalo">{Icon.chat(20)}<small>Zalo</small></a>}
        {cfg.allowOrder ? (
          v.inStock ? <><button className="sh-btn ghost" onClick={() => add(false)}>{Icon.cartPlus(18)} Thêm giỏ</button><button className="sh-btn" onClick={() => add(true)}>Mua ngay</button></>
            : <>{tel && <a className="sh-btn ghost" href={tel}>{Icon.phone(18)} Gọi hỏi</a>}<button className="sh-btn" disabled>Tạm hết hàng</button></>
        ) : (
          <>{tel && <a className="sh-btn ghost" href={tel}>{Icon.phone(18)} Gọi đặt hàng</a>}{zalo && <a className="sh-btn" href={zalo} target="_blank" rel="noreferrer">Nhắn Zalo</a>}</>
        )}
      </div>
    </>
  );
}

// ================================================================ giỏ hàng & đặt hàng
interface Buyer { name: string; phone: string; address: string; note: string }

export function CartPage() {
  const { cfg } = useShop();
  const items = useCart();
  const nav = useNavigate();
  const [buyer, setBuyer] = useState<Buyer>(() => ({ note: '', ...lsGet<Omit<Buyer, 'note'>>('shop.buyer', { name: '', phone: '', address: '' }) }));
  const [hp, setHp] = useState('');
  const [errs, setErrs] = useState<Partial<Record<keyof Buyer, string>>>({});
  const [sending, setSending] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const ref = useRef<string>(uid());
  useTitle(`Giỏ hàng – ${cfg.shopName}`);

  // làm mới giá / tồn / Flash Sale của hàng trong giỏ
  useEffect(() => {
    const ids = Array.from(new Set(items.map((i) => i.productId)));
    ids.forEach((pid) => shopApi.product(pid).then((p) => {
      for (const it of cart.get().filter((x) => x.productId === pid)) {
        const v = p.variants.find((x) => x.id === it.variantId);
        if (!v) { cart.update(it.variantId, { maxQuantity: 0 }); continue; }
        cart.update(it.variantId, { price: v.price, flash: v.flash, maxQuantity: v.maxQuantity, quantity: v.maxQuantity > 0 ? Math.min(it.quantity, v.maxQuantity) : it.quantity });
      }
    }).catch((e: ShopError) => { if (e.status === 404) for (const it of cart.get().filter((x) => x.productId === pid)) cart.update(it.variantId, { maxQuantity: 0 }); }));
  }, []);

  // giá trong giỏ có thể lưu từ trước khi cửa hàng ẩn giá → ẩn theo cấu hình hiện tại
  const est = items.map((i) => ({ i, ...lineEstimate({ ...i, price: cfg.showPrice ? i.price : null, flash: i.flash && { ...i.flash, price: cfg.showFlashPrice === false ? null : i.flash.price } }) }));
  const total = est.every((e) => e.total !== null) ? est.reduce((s, e) => s + (e.total ?? 0), 0) : null;
  const unavailable = items.filter((i) => i.maxQuantity <= 0);
  const set = (k: keyof Buyer, v: string) => { setBuyer((b) => ({ ...b, [k]: v })); setErrs((e) => ({ ...e, [k]: undefined })); };
  const count = items.reduce((s, i) => s + i.quantity, 0);

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    const er: typeof errs = {};
    if (buyer.name.trim().length < 2) er.name = 'Vui lòng nhập họ tên';
    const digits = buyer.phone.replace(/\D/g, '');
    if (!/^(0\d{9,10}|84\d{9,10})$/.test(digits)) er.phone = 'Số điện thoại chưa đúng';
    if (buyer.address.trim().length < 5) er.address = 'Vui lòng nhập địa chỉ nhận hàng';
    setErrs(er);
    if (Object.keys(er).length) return;
    if (unavailable.length) { setErr('Xóa các sản phẩm đã hết hàng khỏi giỏ trước khi đặt'); return; }
    setSending(true); setErr(null);
    try {
      const o = await shopApi.placeOrder({ clientRef: ref.current, name: buyer.name.trim(), phone: buyer.phone.trim(), address: buyer.address.trim(), note: buyer.note.trim() || undefined, website: hp || undefined, lines: items.map((i) => ({ variantId: i.variantId, quantity: i.quantity })) });
      lsSet('shop.buyer', { name: buyer.name.trim(), phone: buyer.phone.trim(), address: buyer.address.trim() });
      lsSet('shop.orders', [{ code: o.code, phone: buyer.phone.trim(), at: o.orderDate }, ...lsGet<any[]>('shop.orders', []).filter((x) => x.code !== o.code)].slice(0, 10));
      cart.clear(); dropCache('flash'); dropCache('p:');
      nav(`/don-hang/${o.code}`, { replace: true, state: { order: o, phone: buyer.phone.trim(), fresh: true } });
    } catch (x) {
      const se = x as ShopError;
      setErr(se.message);
      if (se.code === 'OUT_OF_STOCK' && Array.isArray(se.details?.items)) for (const s of se.details.items) cart.update(s.variantId, { maxQuantity: s.available, quantity: Math.max(1, Math.min(s.available, cart.get().find((i) => i.variantId === s.variantId)?.quantity ?? 1)) });
      if (se.code !== 'OUT_OF_STOCK') ref.current = uid();
    } finally { setSending(false); }
  };

  if (!cfg.allowOrder) return <div className="sh-empty">{Icon.phone(36)}<div>Cửa hàng chưa nhận đặt hàng online.</div>{cfg.hotline && <a className="sh-btn" href={telLink(cfg.hotline)!}>Gọi {prettyPhone(cfg.hotline)}</a>}</div>;
  if (!items.length) return <div className="sh-empty big"><span className="ic">{Icon.bag(40)}</span><div className="t">Giỏ hàng đang trống</div><div>Chọn vài món yêu thích rồi quay lại đây nhé.</div><Link to="/" className="sh-btn">Mua sắm ngay</Link></div>;

  return (
    <div className="sh-cart">
      <div className="sh-sec">
        <h1 className="sh-h1">Giỏ hàng <span>({count})</span></h1>
        <div className="sh-lines">
          {est.map(({ i, total: lt, flashQty }) => {
            const nm = splitName(i.name);
            return (
              <div key={i.variantId} className={`sh-line ${i.maxQuantity <= 0 ? 'bad' : ''}`}>
                <Link to={`/p/${i.productId}?v=${i.variantId}`} className="thumb"><Img src={i.imageUrl} alt={i.name} /></Link>
                <div className="info">
                  {nm.brand && <div className="br">{nm.brand}</div>}
                  <div className="nm">{nm.title}</div>
                  {i.variantName && <div className="vn">{i.variantName}</div>}
                  {i.maxQuantity <= 0 ? <div className="warn">Đã hết hàng – vui lòng xóa</div> : (
                    <>
                      {lt !== null && <div className="pr">{flashQty > 0 ? <><span className="flash">{Icon.bolt(11)} {vnd(i.flash!.price)}</span> × {flashQty}{i.quantity > flashQty ? <span className="muted"> + {vnd(i.price)} × {i.quantity - flashQty}</span> : null}</> : vnd(i.price)}</div>}
                      {lt === null && i.flash && flashQty > 0 && <div className="pr"><span className="flash">{Icon.bolt(11)} Giá sốc -{i.flash.discountPercent}%</span></div>}
                      {i.flash && i.flash.perOrderLimit && i.quantity > i.flash.perOrderLimit && <div className="vn">Giá Flash Sale tối đa {i.flash.perOrderLimit}/đơn</div>}
                    </>
                  )}
                  <div className="row">
                    {i.maxQuantity > 0 && <Qty small value={i.quantity} max={i.maxQuantity} onChange={(q) => cart.setQty(i.variantId, q)} />}
                    {lt !== null && i.maxQuantity > 0 && <b>{vnd(lt)}</b>}
                    <button className="del" aria-label="Xóa" onClick={() => cart.remove(i.variantId)}>{Icon.trash(18)}</button>
                  </div>
                </div>
              </div>
            );
          })}
        </div>
        <Link to="/" className="sh-link back">{Icon.back(16)} Tiếp tục mua sắm</Link>
      </div>
      <form className="sh-checkout" onSubmit={submit} noValidate>
        <h2 className="sh-h2">Thông tin nhận hàng</h2>
        <label className={errs.name ? 'err' : ''}><span>Họ tên *</span><input value={buyer.name} onChange={(e) => set('name', e.target.value)} autoComplete="name" maxLength={200} placeholder="Họ và tên người nhận" />{errs.name && <em>{errs.name}</em>}</label>
        <label className={errs.phone ? 'err' : ''}><span>Số điện thoại *</span><input value={buyer.phone} onChange={(e) => set('phone', e.target.value)} inputMode="tel" autoComplete="tel" maxLength={20} placeholder="09xx xxx xxx" />{errs.phone && <em>{errs.phone}</em>}</label>
        <label className={errs.address ? 'err' : ''}><span>Địa chỉ nhận hàng *</span><textarea rows={2} value={buyer.address} onChange={(e) => set('address', e.target.value)} autoComplete="street-address" maxLength={500} placeholder="Số nhà, đường, phường/xã, quận/huyện, tỉnh" />{errs.address && <em>{errs.address}</em>}</label>
        <label><span>Ghi chú</span><input value={buyer.note} onChange={(e) => set('note', e.target.value)} maxLength={500} placeholder="Thời gian nhận hàng, yêu cầu khác…" /></label>
        <input className="sh-hp" tabIndex={-1} autoComplete="off" value={hp} onChange={(e) => setHp(e.target.value)} aria-hidden="true" name="website" />
        <div className="sh-sum">
          {total !== null ? <><span>Tạm tính ({count} sản phẩm)</span><b>{vnd(total)}</b></> : <span className="muted">Cửa hàng sẽ gọi báo giá và xác nhận đơn.</span>}
        </div>
        {total !== null && <div className="sh-note">{Icon.shield(15)} Phí giao hàng (nếu có) cửa hàng sẽ báo khi gọi xác nhận. Thanh toán khi nhận hàng hoặc chuyển khoản.</div>}
        {err && <div className="sh-error">{err}</div>}
        <button className="sh-btn block" disabled={sending}>{sending ? 'Đang gửi đơn…' : 'Đặt hàng'}</button>
      </form>
    </div>
  );
}

// ================================================================ đơn hàng (đặt thành công / tra cứu)
export function OrderPage() {
  const { code = '' } = useParams();
  const loc = useLocation() as { state?: { order?: OrderSummary; phone?: string; fresh?: boolean } };
  const { cfg } = useShop();
  const remembered = lsGet<Array<{ code: string; phone: string }>>('shop.orders', []).find((x) => x.code === code)?.phone;
  const [phone, setPhone] = useState(loc.state?.phone ?? remembered ?? '');
  const [askPhone, setAskPhone] = useState(!loc.state?.phone && !remembered);
  const { data, error, loading } = useAsync<OrderSummary>(askPhone || !phone ? null : `o:${code}:${phone}`, () => shopApi.order(code, phone));
  const o = data ?? loc.state?.order;
  useTitle(`Đơn hàng ${code} – ${cfg.shopName}`);
  const zalo = zaloLink(cfg.zalo);
  const tel = telLink(cfg.hotline);

  if (askPhone || (error && !o)) {
    return (
      <form className="sh-sec sh-lookup" onSubmit={(e) => { e.preventDefault(); if (phone.replace(/\D/g, '').length >= 9) setAskPhone(false); }}>
        <h1 className="sh-h1">Tra cứu đơn {code}</h1>
        {error && <div className="sh-error">{error.status === 404 ? 'Không tìm thấy đơn với số điện thoại này' : error.message}</div>}
        <div className="box">
          <label><span>Số điện thoại đặt hàng</span><input value={phone} onChange={(e) => setPhone(e.target.value)} inputMode="tel" autoFocus /></label>
          <button className="sh-btn block">Xem đơn hàng</button>
        </div>
      </form>
    );
  }
  if (!o) return <div className="sh-empty">{loading ? 'Đang tải…' : 'Không tìm thấy đơn hàng'}</div>;
  return (
    <div className="sh-sec sh-order">
      {loc.state?.fresh && <div className="sh-success"><span className="ic">{Icon.check(30)}</span><h2>Đặt hàng thành công!</h2><p>Cảm ơn {o.customerName ?? 'bạn'}. Cửa hàng sẽ gọi số {o.phone} để xác nhận đơn.</p></div>}
      <div className="sh-order-head"><div><div className="muted">Mã đơn hàng</div><div className="code">{o.code}</div></div><span className={`sh-status ${o.status.toLowerCase()}`}>{ORDER_STATUS[o.status]}</span></div>
      {o.delivery && <div className="sh-note box">Giao hàng: {DELIVERY_STATUS[o.delivery.status] ?? o.delivery.status}{o.delivery.carrier ? ` · ${o.delivery.carrier}` : ''}{o.delivery.trackingCode ? ` · Mã vận đơn ${o.delivery.trackingCode}` : ''}</div>}
      <div className="sh-lines">
        {o.lines.map((l, idx) => {
          const nm = splitName(l.name);
          return (
            <div key={idx} className="sh-line">
              <span className="thumb"><Img src={l.imageUrl} alt={l.name} /></span>
              <div className="info">
                {nm.brand && <div className="br">{nm.brand}</div>}
                <div className="nm">{l.flash && <span className="flash">{Icon.bolt(11)} </span>}{nm.title}</div>
                <div className="row"><span className="muted">× {l.quantity}{l.unitPrice !== null ? ` · ${vnd(l.unitPrice)}` : ''}</span>{l.lineTotal !== null && <b>{vnd(l.lineTotal)}</b>}</div>
              </div>
            </div>
          );
        })}
      </div>
      <div className="sh-sum box">{o.totalAmount !== null ? <><span>Tổng tiền hàng</span><b>{vnd(o.totalAmount)}</b></> : <span className="muted">Cửa hàng sẽ báo giá khi xác nhận đơn.</span>}</div>
      <div className="sh-order-actions">
        {tel && <a className="sh-btn ghost" href={tel}>{Icon.phone(18)} Gọi cửa hàng</a>}
        {zalo && <a className="sh-btn ghost" href={zalo} target="_blank" rel="noreferrer">{Icon.chat(18)} Nhắn Zalo</a>}
        <Link className="sh-btn" to="/">Tiếp tục mua sắm</Link>
      </div>
    </div>
  );
}

export function LookupPage() {
  const nav = useNavigate();
  const { cfg } = useShop();
  const recent = lsGet<Array<{ code: string; phone: string; at: string }>>('shop.orders', []);
  const [code, setCode] = useState('');
  const [phone, setPhone] = useState(lsGet<{ phone?: string }>('shop.buyer', {}).phone ?? '');
  useTitle(`Tra cứu đơn hàng – ${cfg.shopName}`);
  return (
    <div className="sh-sec sh-lookup">
      <h1 className="sh-h1">Tra cứu đơn hàng</h1>
      <form className="box" onSubmit={(e) => { e.preventDefault(); if (code.trim()) nav(`/don-hang/${code.trim().toUpperCase()}`, { state: { phone } }); }}>
        <label><span>Mã đơn hàng</span><input value={code} onChange={(e) => setCode(e.target.value)} placeholder="VD: DH000123" autoCapitalize="characters" /></label>
        <label><span>Số điện thoại đặt hàng</span><input value={phone} onChange={(e) => setPhone(e.target.value)} inputMode="tel" /></label>
        <button className="sh-btn block">Tra cứu</button>
      </form>
      {recent.length > 0 && (
        <div className="sh-recent box">
          <h3>Đơn đã đặt trên máy này</h3>
          {recent.map((r) => <Link key={r.code} to={`/don-hang/${r.code}`} state={{ phone: r.phone }}>{Icon.doc(16)} {r.code}<span className="muted">{new Date(r.at).toLocaleDateString('vi-VN')}</span>{Icon.chev(16)}</Link>)}
        </div>
      )}
    </div>
  );
}
