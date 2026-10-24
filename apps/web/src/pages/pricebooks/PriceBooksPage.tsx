import { App, Button, Card, DatePicker, Form, Input, InputNumber, Modal, Select, Table, Tag } from 'antd';
import { DeleteOutlined, EditOutlined, PlusOutlined } from '@ant-design/icons';
import dayjs from 'dayjs';
import { useEffect, useState } from 'react';
import { catalogApi, useInvalidate, usePriceBooks } from '../../api/catalog';
import { useBranches } from '../../api/org';
import { errMsg } from '../../api/client';
import type { PriceBook, SearchHit } from '../../api/types';
import { MoneyInput, QuantityInput } from '../../components/Inputs';
import { ProductSearch } from '../../components/ProductSearch';
import { dt, money, qty, toNum } from '../../utils/format';

export default function PriceBooksPage() {
  const { message } = App.useApp();
  const invalidate = useInvalidate();
  const { data, isLoading } = usePriceBooks();
  const { data: branches } = useBranches();
  const [form] = Form.useForm();
  const [editing, setEditing] = useState<PriceBook | null | undefined>(undefined);
  const [itemsFor, setItemsFor] = useState<PriceBook | null>(null);
  const [items, setItems] = useState<{ variantId: string; sku: string; name: string; basePrice: string; price: number; minQuantity: number }[]>([]);

  useEffect(() => {
    if (editing === undefined) return;
    if (editing) form.setFieldsValue({ code: editing.code, name: editing.name, status: editing.status, priority: editing.priority, branchIds: editing.branches?.map((b) => b.branchId) ?? [], range: editing.startsAt || editing.endsAt ? [editing.startsAt ? dayjs(editing.startsAt) : null, editing.endsAt ? dayjs(editing.endsAt) : null] : undefined });
    else { form.resetFields(); form.setFieldsValue({ status: 'ACTIVE', priority: 0 }); }
  }, [editing]);

  const save = async () => {
    const v = await form.validateFields();
    const body: any = { name: v.name, priority: v.priority, branchIds: v.branchIds ?? [], startsAt: v.range?.[0] ? v.range[0].toISOString() : null, endsAt: v.range?.[1] ? v.range[1].toISOString() : null };
    try {
      if (editing) await catalogApi.updatePriceBook(editing.id, { ...body, status: v.status });
      else await catalogApi.createPriceBook({ ...body, code: v.code, startsAt: body.startsAt ?? undefined, endsAt: body.endsAt ?? undefined });
      message.success('Đã lưu bảng giá'); invalidate('price-books'); setEditing(undefined);
    } catch (e) { message.error(errMsg(e)); }
  };

  const openItems = async (pb: PriceBook) => {
    try {
      const full = await catalogApi.priceBook(pb.id);
      setItems((full.items ?? []).map((i) => ({ variantId: i.variantId, sku: i.variant.sku, name: i.variant.name, basePrice: i.variant.sellPrice, price: toNum(i.price), minQuantity: toNum(i.minQuantity) })));
      setItemsFor(full);
    } catch (e) { message.error(errMsg(e)); }
  };
  const saveItems = async () => {
    if (!itemsFor) return;
    try { await catalogApi.setPriceBookItems(itemsFor.id, items.map((i) => ({ variantId: i.variantId, price: String(i.price), minQuantity: String(i.minQuantity || 1) }))); message.success('Đã lưu giá'); invalidate('price-books'); setItemsFor(null); } catch (e) { message.error(errMsg(e)); }
  };

  return (
    <div>
      <h1 className="kv-page-title">Thiết lập giá (bảng giá)</h1>
      <div className="kv-toolbar"><span className="spacer" /><Button type="primary" icon={<PlusOutlined />} onClick={() => setEditing(null)}>Thêm bảng giá</Button></div>
      <Card size="small" styles={{ body: { padding: 0 } }}>
        <Table rowKey="id" size="small" loading={isLoading} dataSource={data ?? []} pagination={false} locale={{ emptyText: 'Chưa có bảng giá. Giá bán mặc định của hàng hóa luôn được áp dụng.' }}
          columns={[
            { title: 'Mã', dataIndex: 'code', width: 120 }, { title: 'Tên bảng giá', dataIndex: 'name' },
            { title: 'Trạng thái', dataIndex: 'status', width: 110, render: (v) => <Tag color={v === 'ACTIVE' ? 'green' : 'default'}>{v === 'ACTIVE' ? 'Đang áp dụng' : 'Ngừng'}</Tag> },
            { title: 'Ưu tiên', dataIndex: 'priority', width: 80, className: 'num' },
            { title: 'Hiệu lực', width: 220, render: (_, pb) => `${pb.startsAt ? dt(pb.startsAt, 'DD/MM/YYYY') : '…'} → ${pb.endsAt ? dt(pb.endsAt, 'DD/MM/YYYY') : '…'}` },
            { title: 'Chi nhánh', render: (_, pb) => pb.branches?.length ? pb.branches.map((b) => branches?.find((x) => x.id === b.branchId)?.name ?? '').join(', ') : 'Tất cả' },
            { title: 'Số mặt hàng', width: 100, className: 'num', render: (_, pb) => pb._count?.items ?? 0 },
            { title: '', width: 180, render: (_, pb) => <><Button size="small" type="link" icon={<EditOutlined />} onClick={() => setEditing(pb)}>Sửa</Button><Button size="small" type="link" onClick={() => openItems(pb)}>Thiết lập giá</Button></> },
          ]} />
      </Card>
      <Modal title={editing ? 'Sửa bảng giá' : 'Thêm bảng giá'} open={editing !== undefined} onCancel={() => setEditing(undefined)} onOk={save} okText="Lưu" cancelText="Bỏ qua" destroyOnClose>
        <Form form={form} layout="vertical">
          <Form.Item name="code" label="Mã bảng giá" rules={[{ required: true, pattern: /^[A-Za-z0-9_-]{1,50}$/, message: 'Chữ, số, -, _' }]}><Input disabled={!!editing} placeholder="BG-SI" /></Form.Item>
          <Form.Item name="name" label="Tên bảng giá" rules={[{ required: true }]}><Input /></Form.Item>
          {editing && <Form.Item name="status" label="Trạng thái"><Select options={[{ value: 'ACTIVE', label: 'Đang áp dụng' }, { value: 'INACTIVE', label: 'Ngừng' }]} /></Form.Item>}
          <Form.Item name="priority" label="Độ ưu tiên (cao hơn được áp dụng trước)"><InputNumber style={{ width: '100%' }} /></Form.Item>
          <Form.Item name="range" label="Thời gian hiệu lực"><DatePicker.RangePicker style={{ width: '100%' }} format="DD/MM/YYYY" allowEmpty={[true, true]} /></Form.Item>
          <Form.Item name="branchIds" label="Áp dụng cho chi nhánh (trống = tất cả)"><Select mode="multiple" options={(branches ?? []).map((b) => ({ value: b.id, label: b.name }))} /></Form.Item>
        </Form>
      </Modal>
      <Modal title={`Thiết lập giá – ${itemsFor?.name ?? ''}`} open={!!itemsFor} onCancel={() => setItemsFor(null)} onOk={saveItems} okText="Lưu" cancelText="Bỏ qua" width={860} destroyOnClose>
        <ProductSearch size="middle" placeholder="Tìm hàng hóa để thêm vào bảng giá" onPick={(h: SearchHit) => setItems((s) => (s.some((i) => i.variantId === h.id) ? s : [...s, { variantId: h.id, sku: h.sku, name: h.name, basePrice: h.sellPrice, price: toNum(h.sellPrice), minQuantity: 1 }]))} />
        <Table size="small" style={{ marginTop: 8 }} rowKey="variantId" pagination={false} dataSource={items} scroll={{ y: 360 }}
          columns={[
            { title: 'Hàng hóa', render: (_, i) => <span>{i.name}<div className="kv-hint">{i.sku}</div></span> },
            { title: 'Giá chung', className: 'num', width: 120, render: (_, i) => money(i.basePrice) },
            { title: 'Giá theo bảng', width: 150, render: (_, i, idx) => <MoneyInput size="small" value={i.price} onChange={(v) => setItems((s) => s.map((x, j) => (j === idx ? { ...x, price: toNum(v) } : x)))} /> },
            { title: 'SL tối thiểu', width: 110, render: (_, i, idx) => <QuantityInput size="small" min={1} value={i.minQuantity} onChange={(v) => setItems((s) => s.map((x, j) => (j === idx ? { ...x, minQuantity: toNum(v) } : x)))} /> },
            { title: 'Chênh lệch', className: 'num', width: 110, render: (_, i) => { const d = i.price - toNum(i.basePrice); return <span className={d < 0 ? 'neg' : d > 0 ? 'pos' : ''}>{d > 0 ? '+' : ''}{money(d)}</span>; } },
            { title: '', width: 40, render: (_, __, idx) => <Button size="small" type="text" danger icon={<DeleteOutlined />} onClick={() => setItems((s) => s.filter((_, j) => j !== idx))} /> },
          ]} />
        <div className="kv-hint" style={{ marginTop: 6 }}>{items.length} mặt hàng · {qty(items.reduce((s, i) => s + i.minQuantity, 0))} SL tối thiểu tổng</div>
      </Modal>
    </div>
  );
}
