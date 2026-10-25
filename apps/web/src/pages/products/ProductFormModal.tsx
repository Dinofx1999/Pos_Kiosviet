import { App, Button, Col, Divider, Form, Input, InputNumber, Modal, Row, Select, Switch, Tabs, Tag } from 'antd';
import Table from '../../components/ResponsiveTable';
import { DeleteOutlined, PlusOutlined } from '@ant-design/icons';
import { useEffect, useState } from 'react';
import { catalogApi, useBrands, useInvalidate, useUnits } from '../../api/catalog';
import { errMsg } from '../../api/client';
import type { Product, SearchHit } from '../../api/types';
import { MoneyInput, QuantityInput } from '../../components/Inputs';
import { ProductSearch } from '../../components/ProductSearch';
import { ScanInput } from '../../components/BarcodeScanner';
import { ImageUploader, type ImageItem } from '../../components/ImageUploader';
import { useAuthStore, useBranchWarehouses } from '../../store/auth';
import { money, toNum } from '../../utils/format';
import { useCategoryOptions } from './CategoryFilter';

interface VariantRow { key: string; id?: string; attributes: Record<string, string>; sku?: string; barcode?: string; sellPrice: number; costPrice?: number; minStock?: number; maxStock?: number; isActive?: boolean }
interface UnitRow { key: string; unitName: string; conversionFactor: number; sku?: string; barcode?: string; sellPrice?: number }
interface ComboRow { componentVariantId: string; name: string; sku: string; sellPrice: string; quantity: number }

const str = (v: number | undefined | null) => (v === undefined || v === null || Number.isNaN(v) ? undefined : String(v));

function cartesian(attrs: { name: string; values: string[] }[]): Record<string, string>[] {
  return attrs.filter((a) => a.values.length).reduce<Record<string, string>[]>((acc, a) => acc.flatMap((row) => a.values.map((v) => ({ ...row, [a.name]: v }))), [{}]);
}

export function ProductFormModal({ open, product, onClose, onSaved }: { open: boolean; product?: Product | null; onClose: () => void; onSaved: (p: Product) => void }) {
  const [form] = Form.useForm();
  const { message } = App.useApp();
  const invalidate = useInvalidate();
  const categories = useCategoryOptions();
  const { data: brands } = useBrands();
  const { data: units } = useUnits();
  const warehouses = useBranchWarehouses();
  const can = useAuthStore((s) => s.can);
  const [saving, setSaving] = useState(false);
  const [type, setType] = useState<'GOODS' | 'SERVICE' | 'COMBO'>('GOODS');
  const [attrs, setAttrs] = useState<{ name: string; values: string[] }[]>([]);
  const [variants, setVariants] = useState<VariantRow[]>([]);
  const [unitRows, setUnitRows] = useState<UnitRow[]>([]);
  const [combo, setCombo] = useState<ComboRow[]>([]);
  const [images, setImages] = useState<ImageItem[]>([]);
  const [quick, setQuick] = useState<{ kind: 'brand' | 'unit' | 'category'; name: string } | null>(null);
  const isEdit = !!product;
  const canSeeCost = can('product.cost.view');

  useEffect(() => {
    if (!open) return;
    if (product) {
      form.setFieldsValue({ code: product.code, name: product.name, categoryId: product.categoryId ?? undefined, brandId: product.brandId ?? undefined, baseUnit: product.baseUnit ?? undefined, taxRate: product.taxRate ? toNum(product.taxRate) : undefined, trackBatch: product.trackBatch, allowSale: product.allowSale, description: product.description ?? '', sellPrice: toNum(product.variants[0]?.sellPrice), costPrice: product.variants[0]?.costPrice !== undefined ? toNum(product.variants[0]?.costPrice) : undefined, minStock: product.variants[0]?.minStock ? toNum(product.variants[0].minStock) : undefined, maxStock: product.variants[0]?.maxStock ? toNum(product.variants[0].maxStock) : undefined, barcode: product.variants[0]?.barcode ?? undefined, sku: product.variants[0]?.sku, weight: product.weight ? toNum(product.weight) : undefined });
      setType(product.type);
      const names = product.attributeNames ?? [];
      setAttrs(names.map((n) => ({ name: n, values: Array.from(new Set(product.variants.map((v) => v.attributes?.[n]).filter(Boolean) as string[])) })));
      setVariants(product.variants.map((v) => ({ key: v.id, id: v.id, attributes: v.attributes ?? {}, sku: v.sku, barcode: v.barcode ?? undefined, sellPrice: toNum(v.sellPrice), costPrice: v.costPrice !== undefined ? toNum(v.costPrice) : undefined, minStock: v.minStock ? toNum(v.minStock) : undefined, maxStock: v.maxStock ? toNum(v.maxStock) : undefined, isActive: v.isActive })));
      setUnitRows(product.units.map((u, i) => ({ key: u.id ?? String(i), unitName: u.unitName, conversionFactor: toNum(u.conversionFactor), sku: u.sku ?? undefined, barcode: u.barcode ?? undefined, sellPrice: u.sellPrice ? toNum(u.sellPrice) : undefined })));
      setCombo(product.comboItems.map((c) => ({ componentVariantId: c.componentVariantId, name: c.componentVariant?.name ?? '', sku: c.componentVariant?.sku ?? '', sellPrice: c.componentVariant?.sellPrice ?? '0', quantity: toNum(c.quantity) })));
      const imgs = (product.images ?? []).slice().sort((a, b) => a.sortOrder - b.sortOrder).map((i) => ({ url: i.url }));
      setImages(imgs.length ? imgs : product.imageUrl ? [{ url: product.imageUrl }] : []);
    } else {
      form.resetFields();
      form.setFieldsValue({ trackBatch: false, allowSale: true, openingWarehouseId: warehouses[0]?.id });
      setType('GOODS'); setAttrs([]); setVariants([]); setUnitRows([]); setCombo([]); setImages([]);
    }
  }, [open, product]);

  // regenerate variant rows when attributes change (keep rows by attribute signature)
  useEffect(() => {
    if (!open) return;
    const active = attrs.filter((a) => a.name && a.values.length);
    if (active.length === 0) { if (!isEdit) setVariants([]); return; }
    const combos = cartesian(active);
    const sig = (o: Record<string, string>) => active.map((a) => `${a.name}=${o[a.name] ?? ''}`).join('|');
    setVariants((prev) => {
      const byKey = new Map(prev.map((v) => [sig(v.attributes), v]));
      const base = form.getFieldValue('sellPrice') ?? prev[0]?.sellPrice ?? 0;
      const baseCost = form.getFieldValue('costPrice') ?? prev[0]?.costPrice;
      const next = combos.map((c) => byKey.get(sig(c)) ?? { key: sig(c), attributes: c, sellPrice: toNum(base), costPrice: baseCost });
      const leftovers = prev.filter((v) => v.id && !combos.some((c) => sig(c) === sig(v.attributes)));
      return [...next, ...leftovers];
    });
  }, [attrs]);

  const hasAttrs = attrs.some((a) => a.name && a.values.length);

  const submit = async () => {
    const v = await form.validateFields();
    setSaving(true);
    try {
      // only attributes that actually have values define variants (a named-but-empty row would make the API reject every variant)
      const attributeNames = attrs.filter((a) => a.name && a.values.length).map((a) => a.name);
      const variantPayload = hasAttrs
        ? variants.map((r) => ({ id: r.id, sku: r.sku || undefined, barcode: r.barcode || undefined, attributes: r.attributes, sellPrice: String(r.sellPrice ?? 0), costPrice: str(r.costPrice), minStock: str(r.minStock), maxStock: str(r.maxStock), isActive: r.isActive }))
        : [{ id: product?.variants[0]?.id, sku: v.sku || undefined, barcode: v.barcode || undefined, sellPrice: String(v.sellPrice ?? 0), costPrice: str(v.costPrice), minStock: str(v.minStock), maxStock: str(v.maxStock) }];
      const unitsPayload = unitRows.filter((u) => u.unitName).map((u) => ({ unitName: u.unitName, conversionFactor: String(u.conversionFactor || 1), sku: u.sku || undefined, barcode: u.barcode || undefined, sellPrice: str(u.sellPrice) }));
      const comboPayload = type === 'COMBO' ? combo.map((c) => ({ componentVariantId: c.componentVariantId, quantity: String(c.quantity || 1) })) : undefined;
      const base: any = { name: v.name, baseUnit: v.baseUnit, description: v.description, taxRate: str(v.taxRate), weight: str(v.weight), trackBatch: type === 'GOODS' ? !!v.trackBatch : false, allowSale: v.allowSale !== false, attributeNames, variants: variantPayload, units: unitsPayload, comboItems: comboPayload, images: images.map((i, sortOrder) => ({ url: i.url, sortOrder })) };
      let saved: Product;
      if (isEdit) {
        saved = await catalogApi.updateProduct(product!.id, { ...base, categoryId: v.categoryId ?? null, brandId: v.brandId ?? null });
      } else {
        const initialStock = type === 'GOODS' && v.openingQty && v.openingWarehouseId ? [{ warehouseId: v.openingWarehouseId, quantity: String(v.openingQty), unitCost: String(v.openingCost ?? v.costPrice ?? 0) }] : undefined;
        saved = await catalogApi.createProduct({ ...base, code: v.code || undefined, type, categoryId: v.categoryId, brandId: v.brandId, initialStock });
      }
      message.success(isEdit ? 'Đã cập nhật hàng hóa' : `Đã thêm hàng hóa ${saved.code}`);
      invalidate('products', 'categories', 'brands', 'dashboard', 'balances');
      onSaved(saved);
    } catch (e) { message.error(errMsg(e)); } finally { setSaving(false); }
  };

  const quickAdd = async () => {
    if (!quick?.name.trim()) return;
    try {
      if (quick.kind === 'brand') { const b = await catalogApi.createBrand(quick.name.trim()); invalidate('brands'); form.setFieldValue('brandId', b.id); }
      if (quick.kind === 'unit') { await catalogApi.createUnit(quick.name.trim()); invalidate('units'); form.setFieldValue('baseUnit', quick.name.trim()); }
      if (quick.kind === 'category') { const c = await catalogApi.createCategory({ name: quick.name.trim() }); invalidate('categories'); form.setFieldValue('categoryId', c.id); }
      setQuick(null);
    } catch (e) { message.error(errMsg(e)); }
  };

  const quickAddDropdown = (kind: 'brand' | 'unit' | 'category') => (menu: React.ReactElement) => (
    <>{menu}<Divider style={{ margin: '6px 0' }} /><Button type="link" icon={<PlusOutlined />} onClick={() => setQuick({ kind, name: '' })}>Thêm mới</Button></>
  );

  const infoTab = (
    <Row gutter={16}>
      <Col span={24}>
        <Form.Item label="Hình ảnh" style={{ marginBottom: 8 }}><ImageUploader value={images} onChange={setImages} /></Form.Item>
      </Col>
      <Col xs={24} md={12}>
        <Form.Item name="code" label="Mã hàng" tooltip="Bỏ trống để hệ thống tự sinh (SP000001); có thể quét mã vạch làm mã hàng"><ScanInput placeholder="Mã hàng tự động" disabled={isEdit} title="Quét mã vạch làm mã hàng" /></Form.Item>
        <Form.Item name="name" label="Tên hàng" rules={[{ required: true, message: 'Nhập tên hàng' }]}><Input autoFocus /></Form.Item>
        <Form.Item label="Loại hàng"><Select value={type} disabled={isEdit} onChange={(t) => setType(t)} options={[{ value: 'GOODS', label: 'Hàng hóa' }, { value: 'SERVICE', label: 'Dịch vụ' }, { value: 'COMBO', label: 'Combo - đóng gói' }]} /></Form.Item>
        <Form.Item name="categoryId" label="Nhóm hàng"><Select allowClear showSearch optionFilterProp="label" options={categories} dropdownRender={can('category.manage') ? quickAddDropdown('category') : undefined} placeholder="Chọn nhóm hàng" /></Form.Item>
        <Form.Item name="brandId" label="Thương hiệu"><Select allowClear showSearch optionFilterProp="label" options={(brands ?? []).map((b) => ({ value: b.id, label: b.name }))} dropdownRender={can('brand.manage') ? quickAddDropdown('brand') : undefined} placeholder="Chọn thương hiệu" /></Form.Item>
        <Form.Item name="baseUnit" label="Đơn vị tính"><Select allowClear showSearch options={(units ?? []).map((u) => ({ value: u.name, label: u.name }))} dropdownRender={can('unit.manage') ? quickAddDropdown('unit') : undefined} placeholder="Cái, Hộp, Chai…" /></Form.Item>
      </Col>
      <Col xs={24} md={12}>
        {!hasAttrs && (
          <>
            <Row gutter={8}>
              <Col span={12}><Form.Item name="sellPrice" label="Giá bán" rules={[{ required: true, message: 'Nhập giá bán' }]}><MoneyInput /></Form.Item></Col>
              <Col span={12}><Form.Item name="costPrice" label="Giá vốn" tooltip="Chỉ áp dụng khi hàng chưa có biến động kho; sau đó giá vốn do hệ thống tính bình quân"><MoneyInput disabled={!canSeeCost} /></Form.Item></Col>
            </Row>
            <Row gutter={8}>
              <Col span={12}><Form.Item name="barcode" label="Mã vạch"><ScanInput placeholder="Quét hoặc nhập mã vạch" /></Form.Item></Col>
              <Col span={12}><Form.Item name="sku" label="SKU" tooltip="Bỏ trống = dùng mã hàng"><Input placeholder="tự sinh" /></Form.Item></Col>
            </Row>
          </>
        )}
        {type === 'GOODS' && !hasAttrs && (
          <Row gutter={8}>
            <Col span={12}><Form.Item name="minStock" label="Tồn tối thiểu"><QuantityInput min={0} /></Form.Item></Col>
            <Col span={12}><Form.Item name="maxStock" label="Tồn tối đa"><QuantityInput min={0} /></Form.Item></Col>
          </Row>
        )}
        <Row gutter={8}>
          <Col span={12}><Form.Item name="taxRate" label="Thuế (%)"><InputNumber min={0} max={100} style={{ width: '100%' }} /></Form.Item></Col>
          <Col span={12}><Form.Item name="weight" label="Trọng lượng (g)"><InputNumber min={0} style={{ width: '100%' }} /></Form.Item></Col>
        </Row>
        <Row gutter={8}>
          {type === 'GOODS' && <Col span={12}><Form.Item name="trackBatch" label="Theo dõi lô / hạn dùng" valuePropName="checked"><Switch disabled={isEdit && toNum(product?.onHand) !== 0} /></Form.Item></Col>}
          <Col span={12}><Form.Item name="allowSale" label="Cho phép bán" valuePropName="checked"><Switch /></Form.Item></Col>
        </Row>
        {!isEdit && type === 'GOODS' && !hasAttrs && (
          <div style={{ background: '#f8fafc', padding: 10, borderRadius: 6 }}>
            <div style={{ fontWeight: 600, marginBottom: 6 }}>Tồn đầu kỳ (tùy chọn)</div>
            <Row gutter={8}>
              <Col span={10}><Form.Item name="openingWarehouseId" label="Kho" style={{ marginBottom: 6 }}><Select options={warehouses.map((w) => ({ value: w.id, label: w.name }))} /></Form.Item></Col>
              <Col span={7}><Form.Item name="openingQty" label="Số lượng" style={{ marginBottom: 6 }}><QuantityInput min={0} /></Form.Item></Col>
              <Col span={7}><Form.Item name="openingCost" label="Giá vốn/đv" style={{ marginBottom: 6 }}><MoneyInput /></Form.Item></Col>
            </Row>
            <div className="kv-hint">Sẽ tạo phiếu nhập kho (lý do: Tồn đầu kỳ) đã ghi sổ.</div>
          </div>
        )}
      </Col>
      {type !== 'COMBO' && (
        <Col span={24}>
          <Divider orientation="left" plain>Thuộc tính (tạo hàng cùng loại: màu sắc, kích thước…)</Divider>
          {attrs.map((a, i) => (
            <Row gutter={8} key={i} style={{ marginBottom: 6 }}>
              <Col span={6}><Input placeholder="Tên thuộc tính (vd: Màu sắc)" value={a.name} onChange={(e) => setAttrs((s) => s.map((x, j) => (j === i ? { ...x, name: e.target.value } : x)))} /></Col>
              <Col span={16}><Select mode="tags" style={{ width: '100%' }} placeholder="Gõ giá trị rồi nhấn Enter hoặc dấu phẩy (vd: Đỏ, Xanh)" value={a.values} onChange={(vals) => setAttrs((s) => s.map((x, j) => (j === i ? { ...x, values: vals } : x)))} tokenSeparators={[',']} /></Col>
              <Col span={2}><Button icon={<DeleteOutlined />} onClick={() => setAttrs((s) => s.filter((_, j) => j !== i))} /></Col>
            </Row>
          ))}
          <Button type="dashed" icon={<PlusOutlined />} onClick={() => setAttrs((s) => [...s, { name: '', values: [] }])} disabled={attrs.length >= 3}>Thêm thuộc tính</Button>
          {hasAttrs && (
            <Table size="small" style={{ marginTop: 10 }} rowKey="key" pagination={false} dataSource={variants} title={() => <b>Danh sách hàng cùng loại ({variants.length})</b>}
              columns={[
                { title: 'Tên', render: (_, r) => <span>{form.getFieldValue('name')} {Object.values(r.attributes).length ? `- ${Object.values(r.attributes).join(' - ')}` : ''} {r.id && <Tag>đã có</Tag>}</span> },
                { title: 'SKU', width: 140, render: (_, r, i) => <Input size="small" value={r.sku} placeholder="tự sinh" onChange={(e) => setVariants((s) => s.map((x, j) => (j === i ? { ...x, sku: e.target.value } : x)))} /> },
                { title: 'Mã vạch', width: 170, render: (_, r, i) => <ScanInput size="small" value={r.barcode} onChange={(v) => setVariants((s) => s.map((x, j) => (j === i ? { ...x, barcode: v } : x)))} /> },
                { title: 'Giá bán', width: 130, render: (_, r, i) => <MoneyInput size="small" value={r.sellPrice} onChange={(v) => setVariants((s) => s.map((x, j) => (j === i ? { ...x, sellPrice: toNum(v) } : x)))} /> },
                { title: 'Giá vốn', width: 130, render: (_, r, i) => <MoneyInput size="small" disabled={!canSeeCost} value={r.costPrice} onChange={(v) => setVariants((s) => s.map((x, j) => (j === i ? { ...x, costPrice: v === null ? undefined : toNum(v) } : x)))} /> },
                { title: 'Tồn min', width: 90, render: (_, r, i) => <QuantityInput size="small" value={r.minStock} onChange={(v) => setVariants((s) => s.map((x, j) => (j === i ? { ...x, minStock: v === null ? undefined : toNum(v) } : x)))} /> },
                { title: '', width: 40, render: (_, r, i) => !r.id && <Button size="small" type="text" danger icon={<DeleteOutlined />} onClick={() => setVariants((s) => s.filter((_, j) => j !== i))} /> },
              ]} />
          )}
        </Col>
      )}
      {type === 'GOODS' && (
        <Col span={24}>
          <Divider orientation="left" plain>Đơn vị quy đổi</Divider>
          <Table size="small" rowKey="key" pagination={false} dataSource={unitRows} locale={{ emptyText: 'Chưa có đơn vị quy đổi' }}
            columns={[
              { title: 'Tên đơn vị', render: (_, r, i) => <Input size="small" value={r.unitName} placeholder="Thùng" onChange={(e) => setUnitRows((s) => s.map((x, j) => (j === i ? { ...x, unitName: e.target.value } : x)))} /> },
              { title: 'Hệ số quy đổi về đơn vị cơ bản', width: 180, render: (_, r, i) => <InputNumber size="small" min={0.0001} value={r.conversionFactor} onChange={(v) => setUnitRows((s) => s.map((x, j) => (j === i ? { ...x, conversionFactor: toNum(v) } : x)))} /> },
              { title: 'SKU', width: 130, render: (_, r, i) => <Input size="small" value={r.sku} onChange={(e) => setUnitRows((s) => s.map((x, j) => (j === i ? { ...x, sku: e.target.value } : x)))} /> },
              { title: 'Mã vạch', width: 160, render: (_, r, i) => <ScanInput size="small" value={r.barcode} onChange={(v) => setUnitRows((s) => s.map((x, j) => (j === i ? { ...x, barcode: v } : x)))} /> },
              { title: 'Giá bán', width: 130, render: (_, r, i) => <MoneyInput size="small" value={r.sellPrice} onChange={(v) => setUnitRows((s) => s.map((x, j) => (j === i ? { ...x, sellPrice: v === null ? undefined : toNum(v) } : x)))} /> },
              { title: '', width: 40, render: (_, __, i) => <Button size="small" type="text" danger icon={<DeleteOutlined />} onClick={() => setUnitRows((s) => s.filter((_, j) => j !== i))} /> },
            ]} />
          <Button type="dashed" size="small" icon={<PlusOutlined />} style={{ marginTop: 6 }} onClick={() => setUnitRows((s) => [...s, { key: String(Date.now()), unitName: '', conversionFactor: 1 }])}>Thêm đơn vị</Button>
        </Col>
      )}
      {type === 'COMBO' && (
        <Col span={24}>
          <Divider orientation="left" plain>Thành phần combo</Divider>
          <ProductSearch size="middle" goodsOnly placeholder="Tìm hàng hóa thành phần" onPick={(h: SearchHit) => setCombo((s) => (s.some((c) => c.componentVariantId === h.id) ? s : [...s, { componentVariantId: h.id, name: h.name, sku: h.sku, sellPrice: h.sellPrice, quantity: 1 }]))} />
          <Table size="small" style={{ marginTop: 8 }} rowKey="componentVariantId" pagination={false} dataSource={combo} locale={{ emptyText: 'Chưa có thành phần' }}
            columns={[
              { title: 'Hàng hóa', render: (_, r) => <span>{r.name}<div className="muted" style={{ fontSize: 11 }}>{r.sku}</div></span> },
              { title: 'Giá bán lẻ', className: 'num', render: (_, r) => money(r.sellPrice) },
              { title: 'Số lượng', width: 120, render: (_, r, i) => <QuantityInput size="small" min={0.001} value={r.quantity} onChange={(v) => setCombo((s) => s.map((x, j) => (j === i ? { ...x, quantity: toNum(v) } : x)))} /> },
              { title: '', width: 40, render: (_, __, i) => <Button size="small" type="text" danger icon={<DeleteOutlined />} onClick={() => setCombo((s) => s.filter((_, j) => j !== i))} /> },
            ]} />
          <div className="kv-hint" style={{ marginTop: 6 }}>Tổng giá thành phần: {money(combo.reduce((s, c) => s + toNum(c.sellPrice) * c.quantity, 0))}</div>
        </Col>
      )}
    </Row>
  );

  return (
    <Modal title={isEdit ? `Cập nhật hàng hóa ${product?.code}` : 'Thêm hàng hóa'} open={open} onCancel={onClose} width={960} destroyOnClose maskClosable={false}
      footer={[<Button key="c" onClick={onClose}>Bỏ qua</Button>, <Button key="s" type="primary" loading={saving} onClick={submit}>Lưu</Button>]}>
      <Form form={form} layout="vertical" size="middle">
        <Tabs items={[{ key: 'info', label: 'Thông tin', children: infoTab }, { key: 'desc', label: 'Mô tả chi tiết', children: <Form.Item name="description" label="Mô tả"><Input.TextArea rows={8} /></Form.Item> }]} />
      </Form>
      <Modal title={quick?.kind === 'brand' ? 'Thêm thương hiệu' : quick?.kind === 'unit' ? 'Thêm đơn vị tính' : 'Thêm nhóm hàng'} open={!!quick} onCancel={() => setQuick(null)} onOk={quickAdd} okText="Thêm" cancelText="Hủy" destroyOnClose>
        <Input autoFocus value={quick?.name} onChange={(e) => setQuick((q) => q && { ...q, name: e.target.value })} onPressEnter={quickAdd} />
      </Modal>
    </Modal>
  );
}
