import { App, Button, Divider, Form, Input, Modal, Select, Switch, Tag } from 'antd';
import { DeleteOutlined, MinusOutlined, PlusOutlined } from '@ant-design/icons';
import { useEffect, useMemo, useState } from 'react';
import { catalogApi, useInvalidate } from '../../api/catalog';
import { errMsg } from '../../api/client';
import type { Product, SearchHit } from '../../api/types';
import { MoneyInput, QuantityInput } from '../../components/Inputs';
import { ProductSearch } from '../../components/ProductSearch';
import { ScanInput } from '../../components/BarcodeScanner';
import { ImageUploader, type ImageItem } from '../../components/ImageUploader';
import { useAuthStore } from '../../store/auth';
import { money, qty, toNum } from '../../utils/format';
import { useCategoryOptions } from './CategoryFilter';
import './products.css';

interface Part { componentVariantId: string; name: string; sku: string; sellPrice: number; costPrice?: number; imageUrl?: string | null; quantity: number; inactive?: boolean }

/** Tổng giá lẻ / giá vốn của các món trong combo. */
export const comboTotals = (parts: { sellPrice: number; costPrice?: number; quantity: number }[]) => ({
  retail: Math.round(parts.reduce((s, p) => s + p.sellPrice * p.quantity, 0) * 100) / 100,
  cost: parts.some((p) => p.costPrice === undefined) ? undefined : parts.reduce((s, p) => s + (p.costPrice ?? 0) * p.quantity, 0),
});

/**
 * Tạo / sửa combo (BR-189): gom nhiều hàng thành một mặt hàng bán như hàng lẻ.
 * Ô "Giá combo" để trống = giá theo tổng giá lẻ các món (tự cập nhật khi giá lẻ đổi); nhập số = giá combo riêng.
 * Nhóm hàng của combo (vd "Combo Makeup mùa hè") là danh mục riêng hiện ở mục Combo màn Bán hàng và trên web.
 */
export function ComboFormModal({ open, product, onClose, onSaved }: { open: boolean; product?: Product | null; onClose: () => void; onSaved: (p: Product) => void }) {
  const [form] = Form.useForm();
  const { message } = App.useApp();
  const invalidate = useInvalidate();
  const categories = useCategoryOptions();
  const can = useAuthStore((s) => s.can);
  const canSeeCost = can('product.cost.view');
  const [parts, setParts] = useState<Part[]>([]);
  const [images, setImages] = useState<ImageItem[]>([]);
  const [price, setPrice] = useState<number | null>(null);
  const [saving, setSaving] = useState(false);
  const [newCat, setNewCat] = useState<string | null>(null);
  const [catOpen, setCatOpen] = useState(false);
  const isEdit = !!product;

  useEffect(() => {
    if (!open) return;
    if (product) {
      const v = product.variants[0];
      form.setFieldsValue({ code: product.code, name: product.name, categoryId: product.categoryId ?? undefined, barcode: v?.barcode ?? undefined, allowSale: product.allowSale });
      setParts(product.comboItems.map((c) => ({
        componentVariantId: c.componentVariantId, name: c.componentVariant?.name ?? '', sku: c.componentVariant?.sku ?? '', sellPrice: toNum(c.componentVariant?.sellPrice),
        costPrice: c.componentVariant?.costPrice !== undefined ? toNum(c.componentVariant.costPrice) : undefined, imageUrl: c.componentVariant?.imageUrl ?? c.componentVariant?.product?.imageUrl,
        quantity: toNum(c.quantity), inactive: c.componentVariant?.isActive === false || c.componentVariant?.product?.isActive === false,
      })));
      setPrice(product.autoPrice ? null : toNum(v?.sellPrice));
      const imgs = (product.images ?? []).slice().sort((a, b) => a.sortOrder - b.sortOrder).map((i) => ({ url: i.url }));
      setImages(imgs.length ? imgs : product.imageUrl ? [{ url: product.imageUrl }] : []);
    } else {
      form.resetFields();
      form.setFieldsValue({ allowSale: true });
      setParts([]); setImages([]); setPrice(null);
    }
    setNewCat(null);
  }, [open, product]);

  const { retail, cost } = useMemo(() => comboTotals(parts), [parts]);
  const sell = price ?? retail;
  const save = retail - sell;

  const add = (h: SearchHit) => {
    if (h.product.type !== 'GOODS') { message.warning('Combo chỉ gồm hàng hóa (không gồm dịch vụ hay combo khác)'); return; }
    if (h.product.trackBatch) { message.warning('Hàng theo dõi lô / hạn dùng không đưa vào combo được'); return; }
    setParts((s) => (s.some((p) => p.componentVariantId === h.id)
      ? s.map((p) => (p.componentVariantId === h.id ? { ...p, quantity: p.quantity + 1 } : p))
      : [...s, { componentVariantId: h.id, name: h.name, sku: h.sku, sellPrice: toNum(h.sellPrice), costPrice: h.costPrice !== undefined ? toNum(h.costPrice) : undefined, imageUrl: h.imageUrl ?? h.product.imageUrl, quantity: 1 }]));
  };
  const setQty = (i: number, q: number) => setParts((s) => s.map((p, j) => (j === i ? { ...p, quantity: Math.max(1, q) } : p)));

  const addCategory = async () => {
    const name = newCat?.trim();
    if (!name) return;
    try { const c = await catalogApi.createCategory({ name }); invalidate('categories'); form.setFieldValue('categoryId', c.id); setNewCat(null); setCatOpen(false); message.success(`Đã thêm nhóm "${name}"`); } catch (e) { message.error(errMsg(e)); }
  };

  const submit = async () => {
    const v = await form.validateFields();
    if (!parts.length) { message.warning('Thêm ít nhất 1 món vào combo'); return; }
    setSaving(true);
    try {
      const autoPrice = price === null;
      const common = {
        name: v.name.trim(), allowSale: v.allowSale !== false, autoPrice, images: images.map((i, sortOrder) => ({ url: i.url, sortOrder })),
        comboItems: parts.map((p) => ({ componentVariantId: p.componentVariantId, quantity: String(p.quantity) })),
      };
      const variant = { barcode: v.barcode?.trim() || undefined, sellPrice: String(sell) };
      const saved = isEdit
        ? await catalogApi.updateProduct(product!.id, { ...common, categoryId: v.categoryId ?? null, variants: [{ id: product!.variants[0]?.id, ...variant }] })
        : await catalogApi.createProduct({ ...common, type: 'COMBO', code: v.code?.trim() || undefined, categoryId: v.categoryId, variants: [variant] });
      message.success(isEdit ? 'Đã cập nhật combo' : `Đã tạo combo ${saved.code}`);
      invalidate('products', 'product', 'categories', 'dashboard');
      onSaved(saved);
    } catch (e) { message.error(errMsg(e)); } finally { setSaving(false); }
  };

  return (
    <Modal
      title={isEdit ? `Sửa combo ${product?.code}` : 'Tạo combo'} open={open} onCancel={onClose} width={760} destroyOnHidden maskClosable={false} className="cmb-modal"
      footer={[<Button key="c" onClick={onClose}>Bỏ qua</Button>, <Button key="s" type="primary" loading={saving} onClick={submit}>{isEdit ? 'Lưu' : 'Tạo combo'}</Button>]}
    >
      <Form form={form} layout="vertical" size="middle" className="cmb-form">
        <Form.Item name="name" label="Tên combo" rules={[{ required: true, whitespace: true, message: 'Nhập tên combo' }]}><Input autoFocus={!isEdit} placeholder="Vd: Combo makeup mùa hè – kem chống nắng + son + phấn" maxLength={300} /></Form.Item>
        <Form.Item
          name="categoryId" label="Nhóm combo"
          extra="Vd: Combo Makeup mùa hè. Nhóm này hiện thành mục riêng ở Bán hàng → Combo và trên web."
        >
          <Select
            allowClear showSearch optionFilterProp="label" options={categories} placeholder="Chọn nhóm (tùy chọn)"
            open={catOpen} onOpenChange={setCatOpen}
            popupRender={(menu) => (
              <>
                {menu}
                {can('category.manage') && (
                  <>
                    <Divider style={{ margin: '6px 0' }} />
                    {newCat === null
                      ? <Button type="link" icon={<PlusOutlined />} onClick={() => setNewCat('')}>Thêm nhóm mới</Button>
                      : <div className="cmb-newcat" onMouseDown={(e) => e.stopPropagation()}><Input size="small" autoFocus placeholder="Tên nhóm, vd: Combo Makeup mùa hè" value={newCat} onChange={(e) => setNewCat(e.target.value)} onKeyDown={(e) => { e.stopPropagation(); if (e.key === 'Enter') void addCategory(); }} /><Button size="small" type="primary" onClick={addCategory}>Thêm</Button></div>}
                  </>
                )}
              </>
            )}
          />
        </Form.Item>

        <div className="cmb-sec">Các món trong combo</div>
        <ProductSearch size="middle" placeholder="Tìm hàng để thêm vào combo (tên, mã, mã vạch)" onPick={add} />
        <div className="cmb-parts">
          {parts.length === 0 && <div className="cmb-empty">Chưa có món nào. Tìm và chọn hàng ở ô trên.</div>}
          {parts.map((p, i) => (
            <div key={p.componentVariantId} className="cmb-part">
              {p.imageUrl ? <img src={p.imageUrl} alt="" /> : <span className="ph" />}
              <div className="nm">
                <div className="t">{p.name}{p.inactive && <Tag color="red" style={{ marginLeft: 6 }}>Ngừng KD</Tag>}</div>
                <div className="s">{p.sku} · {money(p.sellPrice)}{p.quantity > 1 ? ` × ${qty(p.quantity)} = ${money(p.sellPrice * p.quantity)}` : ''}</div>
              </div>
              <div className="cmb-qty">
                <Button size="small" icon={<MinusOutlined />} disabled={p.quantity <= 1} onClick={() => setQty(i, p.quantity - 1)} aria-label="Bớt" />
                <QuantityInput size="small" min={1} controls={false} style={{ width: 52 }} value={p.quantity} onChange={(v) => setQty(i, toNum(v) || 1)} />
                <Button size="small" icon={<PlusOutlined />} onClick={() => setQty(i, p.quantity + 1)} aria-label="Thêm" />
              </div>
              <Button size="small" type="text" danger icon={<DeleteOutlined />} aria-label="Bỏ món" onClick={() => setParts((s) => s.filter((_, j) => j !== i))} />
            </div>
          ))}
        </div>

        <div className="cmb-price">
          <div className="cmb-price-row"><span>Tổng giá lẻ {parts.length ? `(${parts.length} món)` : ''}</span><b>{money(retail)}</b></div>
          <Form.Item label="Giá combo" style={{ margin: '8px 0 0' }}>
            <MoneyInput value={price ?? undefined} onChange={(v) => setPrice(v === null || v === undefined || v === '' ? null : toNum(v))} placeholder={`Để trống = theo giá lẻ (${money(retail)})`} style={{ width: '100%' }} />
          </Form.Item>
          {price === null
            ? <div className="cmb-note auto">Đang bán theo giá lẻ: <b>{money(retail)}</b>. Giá combo tự cập nhật khi giá lẻ các món thay đổi.</div>
            : save > 0 ? <div className="cmb-note save">Khách tiết kiệm <b>{money(save)}</b>{retail > 0 ? ` (${Math.round((save / retail) * 100)}%)` : ''} so với mua lẻ. <a onClick={() => setPrice(null)}>Dùng giá lẻ</a></div>
            : save < 0 ? <div className="cmb-note up">Giá combo cao hơn mua lẻ {money(-save)}. <a onClick={() => setPrice(null)}>Dùng giá lẻ</a></div>
            : <div className="cmb-note">Bằng tổng giá lẻ. <a onClick={() => setPrice(null)}>Dùng giá lẻ (tự cập nhật)</a></div>}
          {canSeeCost && cost !== undefined && parts.length > 0 && <div className="cmb-note">Giá vốn ≈ {money(cost)} · Lãi ≈ <b className={sell - cost < 0 ? 'neg' : ''}>{money(sell - cost)}</b></div>}
        </div>

        <Divider style={{ margin: '14px 0 10px' }} />
        <Form.Item label="Hình ảnh" style={{ marginBottom: 8 }} extra="Chưa có ảnh riêng thì màn bán hàng và web dùng ảnh món đầu tiên."><ImageUploader value={images} onChange={setImages} max={8} /></Form.Item>
        <div className="cmb-grid">
          <Form.Item name="code" label="Mã combo" tooltip="Bỏ trống để tự sinh"><Input placeholder="Mã tự động" disabled={isEdit} /></Form.Item>
          <Form.Item name="barcode" label="Mã vạch (tùy chọn)"><ScanInput placeholder="Quét hoặc nhập" /></Form.Item>
        </div>
        <Form.Item name="allowSale" label="Cho phép bán" valuePropName="checked" style={{ marginBottom: 0 }}><Switch /></Form.Item>
      </Form>
    </Modal>
  );
}
