import { useEffect, useMemo, useRef, useState } from 'react';
import { Link, useLocation, useNavigate, useParams, useSearchParams } from 'react-router-dom';
import { lsGet, lsSet, ORDER_STATUS, DELIVERY_STATUS, shopApi, ShopError, telLink, uid, vnd, zaloLink, type FlashSaleData, type OrderSummary, type ProductCard, type ProductDetail, type Variant } from './api';
import { cart, lineEstimate, useCart } from './cart';
import { Countdown, dropCache, FlashBar, Icon, Img, PriceTag, Qty, toast, useAsync, useShop } from './ui';

const useTitle = (t: string) => useEffect(() => { document.title = t; }, [t]);

// ================================================================ trang chủ
export function HomePage() {
  const { cfg } = useShop();
  const [sp, setSp] = useSearchParams();
  const search = sp.get('q') ?? '';
  const categoryId = sp.get('c') ?? '';
  const sort = sp.get('s') ?? 'featured';
  useTitle(search ? `Tìm "${search}" – ${cfg.shopName}` : cfg.shopName);
  const setParam = (k: string, v: string) => { const n = new URLSearchParams(sp); if (v) n.set(k, v); else n.delete(k); setSp(n, { replace: k !== 'c' }); };
  const filtering = !!search || !!categoryId;

  return (
    <div className="sh-home">
      {!filtering && cfg.bannerUrl && <div className="sh-banner"><Img src={cfg.bannerUrl} alt={cfg.shopName} eager /></div>}
      {!filtering && cfg.flashSaleEnabled && <FlashStrip />}
      <div className="sh-section">
        {!!cfg.categories?.length && (
          <div className="sh-chips" role="tablist">
            <button className={!categoryId ? 'on' : ''} onClick={() => setParam('c', '')}>Tất cả</button>
            {cfg.categories.map((c) => <button key={c.id} className={categoryId === c.id ? 'on' : ''} onClick={() => setParam('c', c.id)}>{c.name}</button>)}
          </div>
        )}
        <div className="sh-listbar">
          <h2>{search ? <>Kết quả cho “{search}” <button className="sh-link" onClick={() => setParam('q', '')}>Xóa</button></> : categoryId ? cfg.categories?.find((c) => c.id === categoryId)?.name ?? 'Sản phẩm' : 'Sản phẩm'}</h2>
          <select value={sort} onChange={(e) => setParam('s', e.target.value === 'featured' ? '' : e.target.value)} aria-label="Sắp xếp">
            <option value="featured">Nổi bật</option>
            <option value="new">Mới nhất</option>
            {cfg.showPrice && <option value="price_asc">Giá thấp → cao</option>}
            {cfg.showPrice && <option value="price_desc">Giá cao → thấp</option>}
            <option value="name">Tên A → Z</option>
          </select>
        </div>
        <ProductFeed key={`${search}|${categoryId}|${sort}`} search={search} categoryId={categoryId} sort={sort} />
      </div>
    </div>
  );
}

function ProductFeed({ search, categoryId, sort }: { search: string; categoryId: string; sort: string }) {
  const [page, setPage] = useState(1);
  const [items, setItems] = useState<ProductCard[]>([]);
  const [total, setTotal] = useState<number | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  useEffect(() => {
    let alive = true;
    setLoading(true); setErr(null);
    shopApi.products({ search: search || undefined, categoryId: categoryId || undefined, sort, page, pageSize: 24 })
      .then((r) => { if (!alive) return; setItems((cur) => (page === 1 ? r.items : [...cur, ...r.items.filter((x) => !cur.some((c) => c.id === x.id))])); setTotal(r.total); })
      .catch((e: ShopError) => alive && setErr(e.message)).finally(() => alive && setLoading(false));
    return () => { alive = false; };
  }, [page, search, categoryId, sort]);
  if (err && !items.length) return <div className="sh-empty">{err} <button className="sh-link" onClick={() => setPage(1)}>Thử lại</button></div>;
  if (!loading && total === 0) return <div className="sh-empty">{search ? 'Không tìm thấy sản phẩm phù hợp.' : 'Chưa có sản phẩm.'}</div>;
  return (
    <>
      {total !== null && total > 0 && <div className="sh-count">{total.toLocaleString('vi-VN')} sản phẩm</div>}
      <div className="sh-grid">
        {items.map((p) => <ProductTile key={p.id} p={p} />)}
        {loading && Array.from({ length: page === 1 ? 8 : 4 }).map((_, i) => <div key={`sk${i}`} className="sh-card sk"><div className="img" /><div className="l1" /><div className="l2" /></div>)}
      </div>
      {total !== null && items.length < total && !loading && <button className="sh-more" onClick={() => setPage((p) => p + 1)}>Xem thêm {Math.min(24, total - items.length)} sản phẩm</button>}
    </>
  );
}

function ProductTile({ p }: { p: ProductCard }) {
  const { cfg } = useShop();
  const nav = useNavigate();
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
        {p.flash && <span className="sh-badge flash">{Icon.bolt(12)} -{p.flash.discountPercent}%</span>}
        {!p.inStock && <span className="sh-oos">Hết hàng</span>}
        {cfg.showStock && p.inStock && p.available !== null && p.available <= 10 && <span className="sh-left">Còn {p.available}</span>}
      </div>
      <div className="nm">{p.name}</div>
      <div className="foot">
        <PriceTag price={p.price} priceMax={p.variantCount > 1 ? p.priceMax : null} flash={p.flash} />
        {cfg.allowOrder && <button type="button" className="sh-add" aria-label={p.variantCount > 1 ? 'Chọn phiên bản' : 'Thêm vào giỏ'} disabled={!p.inStock} onClick={quickAdd}>{Icon.plus(16)}</button>}
      </div>
    </Link>
  );
}

// ---------------------------------------------------------------- Flash Sale
function useFlash() {
  const r = useAsync<FlashSaleData>('flash', () => shopApi.flashSale());
  return r;
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
        <Link to="/flash-sale" className="all">Xem tất cả ›</Link>
      </div>
      <div className="sh-flash-row">
        {items.slice(0, 12).map((it) => (
          <Link key={it.itemId} to={`/p/${it.productId}?v=${it.variantId}`} className={`sh-fcard ${it.soldOut || !it.inStock ? 'out' : ''}`}>
            <div className="img"><Img src={it.imageUrl} alt={it.name} /><span className="sh-badge flash">-{it.discountPercent}%</span></div>
            <div className="nm">{it.name}</div>
            {it.salePrice !== null ? <div className="sh-price"><span className="now flash">{vnd(it.salePrice)}</span><span className="old">{vnd(it.price)}</span></div> : <div className="sh-price contact">Giá sốc · Liên hệ</div>}
            <FlashBar sold={it.sold} limit={it.limit} remaining={!it.inStock ? 0 : it.remaining} />
          </Link>
        ))}
      </div>
    </div>
  );
}

export function FlashSalePage() {
  const { data, loading, reload } = useFlash();
  const { cfg } = useShop();
  useTitle(`Flash Sale – ${cfg.shopName}`);
  if (loading && !data) return <div className="sh-empty">Đang tải…</div>;
  if (!data?.enabled || (!data.campaigns.length && !data.upcoming)) return <div className="sh-empty">Hiện chưa có chương trình Flash Sale. <Link to="/" className="sh-link">Xem sản phẩm</Link></div>;
  return (
    <div className="sh-section">
      {!data.campaigns.length && data.upcoming && (
        <div className="sh-flash upcoming"><div className="sh-flash-head"><span className="ttl">{Icon.bolt(18)} {data.upcoming.name}</span><span className="sub">bắt đầu sau</span><Countdown to={data.upcoming.startsAt} onEnd={() => { dropCache('flash'); reload(); }} /></div></div>
      )}
      {data.campaigns.map((c) => (
        <div key={c.id} className="sh-flash page">
          <div className="sh-flash-head"><span className="ttl">{Icon.bolt(18)} {c.name}</span><span className="sub">Kết thúc sau</span><Countdown to={c.endsAt} onEnd={() => { dropCache('flash'); reload(); }} /></div>
          <div className="sh-grid">
            {c.items.map((it) => (
              <Link key={it.itemId} to={`/p/${it.productId}?v=${it.variantId}`} className={`sh-card ${it.soldOut || !it.inStock ? 'oos' : ''}`}>
                <div className="img"><Img src={it.imageUrl} alt={it.name} /><span className="sh-badge flash">{Icon.bolt(12)} -{it.discountPercent}%</span>{(it.soldOut || !it.inStock) && <span className="sh-oos">{it.soldOut ? 'Hết suất' : 'Hết hàng'}</span>}</div>
                <div className="nm">{it.name}</div>
                {it.salePrice !== null ? <div className="sh-price"><span className="now flash">{vnd(it.salePrice)}</span><span className="old">{vnd(it.price)}</span></div> : <div className="sh-price contact">Giá sốc · Liên hệ</div>}
                <FlashBar sold={it.sold} limit={it.limit} remaining={!it.inStock ? 0 : it.remaining} />
                {it.perOrderLimit && <div className="sh-left">Tối đa {it.perOrderLimit}/đơn</div>}
              </Link>
            ))}
          </div>
        </div>
      ))}
    </div>
  );
}

// ================================================================ chi tiết sản phẩm
const variantLabel = (v: Variant, p: ProductDetail) => {
  if (v.attributes && Object.keys(v.attributes).length) return Object.values(v.attributes).join(' · ');
  return v.name.startsWith(p.name) ? v.name.slice(p.name.length).replace(/^[\s\-–·:]+/, '') || v.sku : v.name;
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
  const gallery = useRef<HTMLDivElement>(null);
  useTitle(p ? `${p.name} – ${cfg.shopName}` : cfg.shopName);
  useEffect(() => { if (p && (!vid || !p.variants.some((v) => v.id === vid))) setVid((p.variants.find((v) => v.inStock) ?? p.variants[0]).id); }, [p]);
  const v = p?.variants.find((x) => x.id === vid) ?? p?.variants[0];
  const images = useMemo(() => {
    if (!p) return [] as string[];
    const list = v?.imageUrl ? [v.imageUrl, ...p.images.filter((u) => u !== v.imageUrl)] : p.images;
    return list.length ? list : [''];
  }, [p, v?.imageUrl]);
  useEffect(() => { setImgIdx(0); gallery.current?.scrollTo({ left: 0 }); }, [v?.id]);
  useEffect(() => { if (v) setQty((q) => Math.max(1, Math.min(q, v.maxQuantity || 1))); }, [v?.id]);

  if (loading && !p) return <div className="sh-pdp sk"><div className="sh-gallery"><div className="sk-img" /></div><div className="sh-pdp-info"><div className="l1" /><div className="l2" /></div></div>;
  if (error || !p || !v) return <div className="sh-empty">{error?.status === 404 ? 'Sản phẩm không còn bán online.' : error?.message ?? 'Không tải được sản phẩm'} <Link className="sh-link" to="/">Về trang chủ</Link></div>;

  const canBuy = cfg.allowOrder && v.inStock;
  const add = (go: boolean) => {
    cart.add({ variantId: v.id, productId: p.id, name: p.name, variantName: p.variants.length > 1 ? variantLabel(v, p) : null, imageUrl: v.imageUrl ?? p.images[0] ?? null, price: v.price, flash: v.flash, maxQuantity: v.maxQuantity }, qty);
    if (go) nav('/gio-hang'); else toast('Đã thêm vào giỏ hàng');
  };
  const zalo = zaloLink(cfg.zalo);
  const tel = telLink(cfg.hotline);

  return (
    <div className="sh-pdp">
      <div className="sh-gallery-wrap">
        <div className="sh-gallery" ref={gallery} onScroll={(e) => { const el = e.currentTarget; setImgIdx(Math.round(el.scrollLeft / el.clientWidth)); }}>
          {images.map((u, i) => <Img key={u + i} src={u || null} alt={`${p.name} ${i + 1}`} eager={i === 0} />)}
        </div>
        {images.length > 1 && <div className="sh-dots">{images.map((_, i) => <button key={i} aria-label={`Ảnh ${i + 1}`} className={i === imgIdx ? 'on' : ''} onClick={() => gallery.current?.scrollTo({ left: i * (gallery.current?.clientWidth ?? 0), behavior: 'smooth' })} />)}</div>}
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
        <h1>{p.name}</h1>
        <div className="sh-meta">{[p.brand, p.category?.name, `Mã: ${v.sku}`].filter(Boolean).join(' · ')}</div>
        <PriceTag price={v.price} flash={v.flash} big />
        {v.flash && (
          <div className="sh-flash-note">
            {v.flash.remaining !== null && <FlashBar sold={v.flash.sold} limit={v.flash.limit} remaining={v.flash.remaining} />}
            {v.flash.perOrderLimit ? <div className="kv">Giá Flash Sale tối đa {v.flash.perOrderLimit} sản phẩm/đơn, phần vượt tính giá thường.</div> : null}
          </div>
        )}
        {p.variants.length > 1 && (
          <div className="sh-variants">
            <div className="lbl">{p.attributeNames.length ? p.attributeNames.join(' / ') : 'Phân loại'}</div>
            <div className="opts">
              {p.variants.map((x) => <button key={x.id} className={`${x.id === v.id ? 'on' : ''} ${x.inStock ? '' : 'oos'}`} onClick={() => setVid(x.id)}>{variantLabel(x, p)}{x.flash && <i>{Icon.bolt(10)}</i>}</button>)}
            </div>
          </div>
        )}
        <div className="sh-stock">{v.inStock ? <span className="ok">{Icon.check(16)} {v.available !== null ? `Còn ${v.available}${v.available >= 99 ? '+' : ''} sản phẩm` : 'Còn hàng'}</span> : <span className="no">Tạm hết hàng</span>}</div>
        {canBuy && <div className="sh-qty-row"><span>Số lượng</span><Qty value={qty} max={Math.max(1, v.maxQuantity)} onChange={setQty} /></div>}
        {(cfg.hotline || zalo) && <div className="sh-contact-inline">{tel && <a href={tel}>{Icon.phone(16)} {cfg.hotline}</a>}{zalo && <a href={zalo} target="_blank" rel="noreferrer" className="zalo">Zalo</a>}</div>}
        {p.description && <div className="sh-desc"><h3>Mô tả sản phẩm</h3><div className="txt">{p.description}</div></div>}
      </div>
      <div className="sh-buybar">
        {cfg.allowOrder ? (
          v.inStock ? <><button className="sh-btn ghost" onClick={() => add(false)}>{Icon.cart(18)} Thêm vào giỏ</button><button className="sh-btn" onClick={() => add(true)}>Mua ngay</button></>
            : <>{tel && <a className="sh-btn ghost" href={tel}>{Icon.phone(18)} Gọi hỏi hàng</a>}<button className="sh-btn" disabled>Tạm hết hàng</button></>
        ) : (
          <>{tel && <a className="sh-btn ghost" href={tel}>{Icon.phone(18)} Gọi đặt hàng</a>}{zalo && <a className="sh-btn" href={zalo} target="_blank" rel="noreferrer">Nhắn Zalo</a>}</>
        )}
      </div>
    </div>
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

  const est = items.map((i) => ({ i, ...lineEstimate(i) }));
  const total = cfg.showPrice && est.every((e) => e.total !== null) ? est.reduce((s, e) => s + (e.total ?? 0), 0) : null;
  const unavailable = items.filter((i) => i.maxQuantity <= 0);
  const set = (k: keyof Buyer, v: string) => { setBuyer((b) => ({ ...b, [k]: v })); setErrs((e) => ({ ...e, [k]: undefined })); };

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

  if (!cfg.allowOrder) return <div className="sh-empty">Cửa hàng chưa nhận đặt hàng online. {cfg.hotline && <a className="sh-link" href={telLink(cfg.hotline)!}>Gọi {cfg.hotline}</a>}</div>;
  if (!items.length) return <div className="sh-empty big">{Icon.bag(48)}<div>Giỏ hàng đang trống</div><Link to="/" className="sh-btn">Mua sắm ngay</Link></div>;

  return (
    <div className="sh-cart">
      <div className="sh-section">
        <h2 className="sh-h2">Giỏ hàng ({items.reduce((s, i) => s + i.quantity, 0)})</h2>
        <div className="sh-lines">
          {est.map(({ i, total: lt, flashQty }) => (
            <div key={i.variantId} className={`sh-line ${i.maxQuantity <= 0 ? 'bad' : ''}`}>
              <Link to={`/p/${i.productId}?v=${i.variantId}`}><Img src={i.imageUrl} alt={i.name} className="thumb" /></Link>
              <div className="info">
                <div className="nm">{i.name}</div>
                {i.variantName && <div className="vn">{i.variantName}</div>}
                {i.maxQuantity <= 0 ? <div className="warn">Đã hết hàng – vui lòng xóa</div> : (
                  <>
                    {cfg.showPrice && i.price !== null && <div className="pr">{flashQty > 0 ? <><span className="flash">{Icon.bolt(11)} {vnd(i.flash!.price)}</span> × {flashQty}{i.quantity > flashQty ? <span className="muted"> + {vnd(i.price)} × {i.quantity - flashQty}</span> : null}</> : vnd(i.price)}</div>}
                    {i.flash && i.flash.perOrderLimit && i.quantity > i.flash.perOrderLimit && <div className="vn">Giá Flash Sale tối đa {i.flash.perOrderLimit}/đơn</div>}
                  </>
                )}
                <div className="row">
                  {i.maxQuantity > 0 && <Qty small value={i.quantity} max={i.maxQuantity} onChange={(q) => cart.setQty(i.variantId, q)} />}
                  {cfg.showPrice && lt !== null && i.maxQuantity > 0 && <b>{vnd(lt)}</b>}
                  <button className="del" aria-label="Xóa" onClick={() => cart.remove(i.variantId)}>{Icon.trash(18)}</button>
                </div>
              </div>
            </div>
          ))}
        </div>
      </div>
      <form className="sh-section sh-checkout" onSubmit={submit} noValidate>
        <h2 className="sh-h2">Thông tin nhận hàng</h2>
        <label className={errs.name ? 'err' : ''}><span>Họ tên *</span><input value={buyer.name} onChange={(e) => set('name', e.target.value)} autoComplete="name" maxLength={200} />{errs.name && <em>{errs.name}</em>}</label>
        <label className={errs.phone ? 'err' : ''}><span>Số điện thoại *</span><input value={buyer.phone} onChange={(e) => set('phone', e.target.value)} inputMode="tel" autoComplete="tel" maxLength={20} />{errs.phone && <em>{errs.phone}</em>}</label>
        <label className={errs.address ? 'err' : ''}><span>Địa chỉ nhận hàng *</span><textarea rows={2} value={buyer.address} onChange={(e) => set('address', e.target.value)} autoComplete="street-address" maxLength={500} placeholder="Số nhà, đường, phường/xã, quận/huyện, tỉnh" />{errs.address && <em>{errs.address}</em>}</label>
        <label><span>Ghi chú</span><input value={buyer.note} onChange={(e) => set('note', e.target.value)} maxLength={500} placeholder="Thời gian nhận hàng, yêu cầu khác…" /></label>
        <input className="sh-hp" tabIndex={-1} autoComplete="off" value={hp} onChange={(e) => setHp(e.target.value)} aria-hidden="true" name="website" />
        <div className="sh-sum">
          {total !== null ? <><span>Tạm tính</span><b>{vnd(total)}</b></> : <span className="muted">Cửa hàng sẽ gọi báo giá và xác nhận đơn.</span>}
        </div>
        {total !== null && <div className="sh-note">Phí giao hàng (nếu có) cửa hàng sẽ báo khi xác nhận đơn. Thanh toán khi nhận hàng hoặc chuyển khoản theo hướng dẫn của cửa hàng.</div>}
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
      <form className="sh-section sh-lookup" onSubmit={(e) => { e.preventDefault(); if (phone.replace(/\D/g, '').length >= 9) setAskPhone(false); }}>
        <h2 className="sh-h2">Tra cứu đơn {code}</h2>
        {error && <div className="sh-error">{error.status === 404 ? 'Không tìm thấy đơn với số điện thoại này' : error.message}</div>}
        <label><span>Số điện thoại đặt hàng</span><input value={phone} onChange={(e) => setPhone(e.target.value)} inputMode="tel" autoFocus /></label>
        <button className="sh-btn block">Xem đơn hàng</button>
      </form>
    );
  }
  if (!o) return <div className="sh-empty">{loading ? 'Đang tải…' : 'Không tìm thấy đơn hàng'}</div>;
  return (
    <div className="sh-section sh-order">
      {loc.state?.fresh && <div className="sh-success">{Icon.check(36)}<h2>Đặt hàng thành công!</h2><p>Cảm ơn {o.customerName ?? 'bạn'}. Cửa hàng sẽ gọi số {o.phone} để xác nhận đơn.</p></div>}
      <div className="sh-order-head"><div><div className="muted">Mã đơn hàng</div><div className="code">{o.code}</div></div><span className={`sh-status ${o.status.toLowerCase()}`}>{ORDER_STATUS[o.status]}</span></div>
      {o.delivery && <div className="sh-note">Giao hàng: {DELIVERY_STATUS[o.delivery.status] ?? o.delivery.status}{o.delivery.carrier ? ` · ${o.delivery.carrier}` : ''}{o.delivery.trackingCode ? ` · Mã vận đơn ${o.delivery.trackingCode}` : ''}</div>}
      <div className="sh-lines">
        {o.lines.map((l, idx) => (
          <div key={idx} className="sh-line">
            <Img src={l.imageUrl} alt={l.name} className="thumb" />
            <div className="info">
              <div className="nm">{l.flash && <span className="flash">{Icon.bolt(11)} </span>}{l.name}</div>
              <div className="row"><span className="muted">× {l.quantity}{l.unitPrice !== null ? ` · ${vnd(l.unitPrice)}` : ''}</span>{l.lineTotal !== null && <b>{vnd(l.lineTotal)}</b>}</div>
            </div>
          </div>
        ))}
      </div>
      <div className="sh-sum">{o.totalAmount !== null ? <><span>Tổng tiền hàng</span><b>{vnd(o.totalAmount)}</b></> : <span className="muted">Cửa hàng sẽ báo giá khi xác nhận đơn.</span>}</div>
      <div className="sh-order-actions">
        {tel && <a className="sh-btn ghost" href={tel}>{Icon.phone(18)} Gọi cửa hàng</a>}
        {zalo && <a className="sh-btn ghost" href={zalo} target="_blank" rel="noreferrer">Nhắn Zalo</a>}
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
    <div className="sh-section sh-lookup">
      <h2 className="sh-h2">Tra cứu đơn hàng</h2>
      <form onSubmit={(e) => { e.preventDefault(); if (code.trim()) nav(`/don-hang/${code.trim().toUpperCase()}`, { state: { phone } }); }}>
        <label><span>Mã đơn hàng</span><input value={code} onChange={(e) => setCode(e.target.value)} placeholder="VD: DH000123" autoCapitalize="characters" /></label>
        <label><span>Số điện thoại đặt hàng</span><input value={phone} onChange={(e) => setPhone(e.target.value)} inputMode="tel" /></label>
        <button className="sh-btn block">Tra cứu</button>
      </form>
      {recent.length > 0 && (
        <div className="sh-recent">
          <h3>Đơn đã đặt trên máy này</h3>
          {recent.map((r) => <Link key={r.code} to={`/don-hang/${r.code}`} state={{ phone: r.phone }}>{Icon.doc(16)} {r.code}<span className="muted">{new Date(r.at).toLocaleDateString('vi-VN')}</span></Link>)}
        </div>
      )}
    </div>
  );
}
