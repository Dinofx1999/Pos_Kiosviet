import { Alert, App, Button, Dropdown, Input, Segmented, Skeleton, Tag } from 'antd';
import { CheckCircleOutlined, DeleteOutlined, EditOutlined, EllipsisOutlined, PlusOutlined, SearchOutlined, StopOutlined } from '@ant-design/icons';
import { useMemo, useState } from 'react';
import { catalogApi, useInvalidate, useProducts } from '../../api/catalog';
import { errMsg } from '../../api/client';
import type { Product } from '../../api/types';
import { useIsMobile } from '../../hooks/useMedia';
import { useCan } from '../../store/auth';
import { money, qty, toNum } from '../../utils/format';
import { ComboFormModal } from './ComboFormModal';
import { comboGroups, comboImage, comboPartsText, comboPrice, fold } from './comboUtils';
import './products.css';

/**
 * Hàng hóa → Combo: danh sách combo theo nhóm (danh mục riêng như "Combo Makeup mùa hè"), tạo / sửa / ngừng bán.
 * Combo bán như một mặt hàng lẻ; khi bán kho trừ từng món thành phần (BR-14, BR-53).
 */
export default function CombosPage() {
  const { message, modal } = App.useApp();
  const can = useCan();
  const isMobile = useIsMobile();
  const invalidate = useInvalidate();
  const [status, setStatus] = useState<'true' | 'false'>('true');
  const [search, setSearch] = useState('');
  const [group, setGroup] = useState<string | null | undefined>(undefined); // undefined = tất cả, null = chưa có nhóm
  const [form, setForm] = useState<{ open: boolean; product?: Product | null }>({ open: false });
  const { data, isLoading, error } = useProducts({ type: 'COMBO', isActive: status, pageSize: 200, sortBy: 'name', sortDir: 'asc' });
  const list = data?.data ?? [];
  const groups = useMemo(() => comboGroups(list), [list]);
  const term = fold(search.trim());
  const shown = list.filter((p) => (group === undefined || (p.category?.id ?? null) === group) && (!term || fold(`${p.name} ${p.code} ${comboPartsText(p)}`).includes(term)));
  const canEdit = can('product.update');

  const act = async (fn: () => Promise<unknown>, ok: string) => { try { await fn(); message.success(ok); invalidate('products', 'product'); } catch (e) { message.error(errMsg(e)); } };
  const menu = (p: Product) => ({
    items: [
      canEdit && { key: 'edit', icon: <EditOutlined />, label: 'Sửa combo', onClick: () => setForm({ open: true, product: p }) },
      canEdit && (p.isActive
        ? { key: 'off', icon: <StopOutlined />, label: 'Ngừng bán', onClick: () => act(() => catalogApi.setActive(p.id, false), `Đã ngừng bán ${p.name}`) }
        : { key: 'on', icon: <CheckCircleOutlined />, label: 'Bán lại', onClick: () => act(() => catalogApi.setActive(p.id, true), `Đã mở bán lại ${p.name}`) }),
      can('product.delete') && { key: 'del', icon: <DeleteOutlined />, danger: true, label: 'Xóa combo', onClick: () => modal.confirm({ title: `Xóa combo "${p.name}"?`, content: 'Combo đã bán thì không xóa được, chỉ ngừng bán. Hàng thành phần không bị ảnh hưởng.', okText: 'Xóa', okButtonProps: { danger: true }, cancelText: 'Hủy', onOk: () => act(() => catalogApi.deleteProduct(p.id), 'Đã xóa combo') }) },
    ].filter(Boolean) as any[],
  });

  return (
    <div className={`cmb-page ${isMobile ? 'm' : ''}`}>
      <div className="cmb-head">
        <h1 className="kv-page-title">Combo</h1>
        {can('product.create') && !isMobile && <Button type="primary" icon={<PlusOutlined />} onClick={() => setForm({ open: true, product: null })}>Tạo combo</Button>}
      </div>
      <div className="kv-hint cmb-intro">Gom nhiều hàng thành một combo và bán như hàng lẻ. Khi bán, kho trừ từng món trong combo. Để trống giá thì combo lấy tổng giá lẻ các món.</div>

      <div className="cmb-tools">
        <Input allowClear prefix={<SearchOutlined />} placeholder="Tìm combo hoặc món trong combo" value={search} onChange={(e) => setSearch(e.target.value)} />
        <Segmented value={status} onChange={(v) => { setStatus(v as 'true' | 'false'); setGroup(undefined); }} options={[{ value: 'true', label: 'Đang bán' }, { value: 'false', label: 'Ngừng bán' }]} />
      </div>
      {groups.length > 0 && (
        <div className="cmb-groups">
          <button type="button" className={group === undefined ? 'on' : ''} onClick={() => setGroup(undefined)}>Tất cả <i>{list.length}</i></button>
          {groups.map((g) => <button type="button" key={g.id ?? '_'} className={group === g.id ? 'on' : ''} onClick={() => setGroup(g.id)}>{g.name} <i>{g.count}</i></button>)}
        </div>
      )}

      {isLoading ? <Skeleton active /> : error ? <Alert type="error" message={errMsg(error)} /> : shown.length === 0 ? (
        <div className="cmb-none">
          {list.length === 0
            ? <>{status === 'true' ? 'Chưa có combo nào.' : 'Không có combo ngừng bán.'}{status === 'true' && can('product.create') && <div><Button type="primary" icon={<PlusOutlined />} onClick={() => setForm({ open: true, product: null })}>Tạo combo đầu tiên</Button></div>}</>
            : 'Không có combo phù hợp'}
        </div>
      ) : (
        <div className="cmb-list">
          {shown.map((p) => {
            const { sell, retail, save } = comboPrice(p);
            const img = comboImage(p);
            const stock = toNum(p.onHand);
            return (
              <div key={p.id} className={`cmb-card ${p.isActive ? '' : 'off'}`} role="button" onClick={() => canEdit && setForm({ open: true, product: p })}>
                {img ? <img className="cmb-img" src={img} alt="" loading="lazy" /> : <div className="cmb-img ph" />}
                <div className="cmb-main">
                  <div className="cmb-name">{p.name}</div>
                  <div className="cmb-meta">{p.code}{p.category && <Tag color="purple">{p.category.name}</Tag>}{!p.allowSale && <Tag>Không cho bán</Tag>}</div>
                  <div className="cmb-parts-line">{p.comboItems.length} món: {comboPartsText(p)}</div>
                  <div className="cmb-price-line">
                    <b>{money(sell)}</b>
                    {p.autoPrice ? <Tag color="blue">Theo giá lẻ</Tag> : save > 0 ? <><s>{money(retail)}</s><Tag color="green">Tiết kiệm {money(save)}</Tag></> : save < 0 ? <Tag color="orange">Cao hơn giá lẻ {money(-save)}</Tag> : null}
                    <span className={`cmb-stock ${stock <= 0 ? 'zero' : ''}`}>{stock > 0 ? `Còn ${qty(stock)} combo` : 'Hết hàng'}</span>
                  </div>
                </div>
                <Dropdown trigger={['click']} menu={menu(p)}><Button type="text" icon={<EllipsisOutlined />} aria-label="Thao tác" onClick={(e) => e.stopPropagation()} /></Dropdown>
              </div>
            );
          })}
        </div>
      )}

      {can('product.create') && isMobile && <button type="button" className="pm-fab" aria-label="Tạo combo" onClick={() => setForm({ open: true, product: null })}><PlusOutlined /></button>}
      <ComboFormModal open={form.open} product={form.product} onClose={() => setForm({ open: false })} onSaved={() => setForm({ open: false })} />
    </div>
  );
}
