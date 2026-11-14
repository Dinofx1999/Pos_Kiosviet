import { Drawer, Input, Spin, Tag } from 'antd';
import { DownOutlined, LoadingOutlined, RightOutlined, SearchOutlined, UpOutlined } from '@ant-design/icons';
import { useQuery } from '@tanstack/react-query';
import { useMemo, useState } from 'react';
import { catalogApi } from '../../api/catalog';
import { errMsg } from '../../api/client';
import type { Product, SearchHit } from '../../api/types';
import { money, qty, toNum } from '../../utils/format';
import { comboGroups, comboImage, comboLineItems, comboPartsText, comboPrice, fold, productToHit } from '../products/comboUtils';
import '../products/products.css';

/** Combo đang bán (tồn theo kho bán hàng), dùng chung cho nút / dải Combo và ngăn chọn combo. */
export function usePosCombos(warehouseId?: string, enabled = true) {
  return useQuery({
    queryKey: ['products', 'pos-combos', warehouseId],
    queryFn: () => catalogApi.products({ type: 'COMBO', isActive: 'true', pageSize: 200, sortBy: 'name', sortDir: 'asc', warehouseId }),
    select: (r) => r.data.filter((p) => p.allowSale && p.variants.length > 0),
    enabled, staleTime: 30_000,
  });
}

/**
 * Bán hàng → Combo: danh mục riêng cho combo (theo nhóm như "Combo Makeup mùa hè"), bấm để thêm vào giỏ như hàng lẻ.
 * Điện thoại: ngăn kéo từ dưới lên; máy tính: ngăn bên phải.
 */
export function PosComboPicker({ open, onClose, warehouseId, onPick, inCart, mobile }: { open: boolean; onClose: () => void; warehouseId?: string; onPick: (hit: SearchHit, p: Product) => void; inCart?: Map<string, number>; mobile?: boolean }) {
  const { data, isLoading, error } = usePosCombos(warehouseId, open);
  const [group, setGroup] = useState<string | null | undefined>(undefined);
  const [search, setSearch] = useState('');
  const list = data ?? [];
  const groups = useMemo(() => comboGroups(list), [list]);
  const term = fold(search.trim());
  const shown = list.filter((p) => (group === undefined || (p.category?.id ?? null) === group) && (!term || fold(`${p.name} ${p.code} ${comboPartsText(p)}`).includes(term)));

  return (
    <Drawer
      className={`pcb ${mobile ? 'm' : ''}`} title="Combo" open={open} onClose={onClose} destroyOnHidden
      placement={mobile ? 'bottom' : 'right'} height={mobile ? '88%' : undefined} width={mobile ? undefined : 460}
      styles={{ body: { padding: 0, display: 'flex', flexDirection: 'column' } }}
    >
      <div className="pcb-top">
        {list.length > 6 && <Input allowClear prefix={<SearchOutlined />} placeholder="Tìm combo" value={search} onChange={(e) => setSearch(e.target.value)} />}
        {groups.length > 1 && (
          <div className="cmb-groups">
            <button type="button" className={group === undefined ? 'on' : ''} onClick={() => setGroup(undefined)}>Tất cả <i>{list.length}</i></button>
            {groups.map((g) => <button type="button" key={g.id ?? '_'} className={group === g.id ? 'on' : ''} onClick={() => setGroup(g.id)}>{g.name} <i>{g.count}</i></button>)}
          </div>
        )}
      </div>
      <div className="pcb-list">
        {isLoading && <div className="pcb-empty"><Spin size="small" /> Đang tải…</div>}
        {error && <div className="pcb-empty">{errMsg(error)}</div>}
        {!isLoading && !error && shown.length === 0 && <div className="pcb-empty">{list.length ? 'Không có combo phù hợp' : 'Chưa có combo nào đang bán. Tạo combo ở Hàng hóa → Combo.'}</div>}
        {shown.map((p) => {
          const { sell, retail, save } = comboPrice(p);
          const img = comboImage(p);
          const stock = toNum(p.onHand);
          const n = inCart?.get(p.id) ?? 0;
          return (
            <button type="button" key={p.id} className={`pcb-row ${n ? 'in' : ''}`} onClick={() => onPick(productToHit(p), p)}>
              <span className={`pcb-img ${img ? '' : 'ph'}`}>{img ? <img src={img} alt="" loading="lazy" /> : null}{n > 0 && <i>{qty(n)}</i>}</span>
              <span className="pcb-main">
                <span className="nm">{p.name}</span>
                <span className="parts">{comboPartsText(p)}</span>
                <span className="pr">
                  <b>{money(sell)}</b>
                  {save > 0 && <s>{money(retail)}</s>}
                  {save > 0 && <Tag color="green">−{money(save)}</Tag>}
                  <span className={`st ${stock <= 0 ? 'zero' : ''}`}>{stock > 0 ? `Còn ${qty(stock)}` : 'Hết hàng'}</span>
                </span>
              </span>
              <RightOutlined className="chev" />
            </button>
          );
        })}
      </div>
    </Drawer>
  );
}

type ComboLineItem = { name: string; quantity: number };

/**
 * Dòng combo trong giỏ: nút "Xem món" → danh sách từng món "tên x số lượng" (số lượng = món / combo × số combo trên dòng).
 * Dòng thêm trước bản này hoặc mở lại từ đơn giữ chưa có danh sách → tải khi bấm.
 */
export function ComboItemsToggle({ productId, items, lineQty }: { productId: string; items?: ComboLineItem[]; lineQty: number }) {
  const [open, setOpen] = useState(false);
  const [loaded, setLoaded] = useState<ComboLineItem[] | undefined>();
  const [busy, setBusy] = useState(false);
  const list = items ?? loaded;
  const toggle = async (e: React.MouseEvent) => {
    e.stopPropagation();
    if (!open && !list && productId) {
      setBusy(true);
      try { setLoaded(comboLineItems(await catalogApi.product(productId))); } catch { /* vẫn mở, báo không tải được */ } finally { setBusy(false); }
    }
    setOpen((o) => !o);
  };
  return (
    <div className="pcb-items" onClick={(e) => e.stopPropagation()}>
      <button type="button" className="pcb-items-btn" onClick={toggle} aria-expanded={open}>
        {busy ? <LoadingOutlined /> : open ? <UpOutlined /> : <DownOutlined />} {open ? 'Ẩn món' : `Xem món${list ? ` (${list.length})` : ''}`}
      </button>
      {open && (list ? (
        <ul>{list.map((it, i) => <li key={i}><span className="pcb-it-nm">{it.name}</span><b className="pcb-it-q">x {qty(it.quantity * lineQty)}</b>{lineQty !== 1 && <span className="pcb-it-per">({qty(it.quantity)}/combo)</span>}</li>)}</ul>
      ) : !busy && <div className="pcb-items-err">Không tải được danh sách món</div>)}
    </div>
  );
}
