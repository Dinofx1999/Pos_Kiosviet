import { App, Button, Card, DatePicker, Input, InputNumber, Select, Space } from 'antd';
import Table from '../../components/ResponsiveTable';
import { CheckOutlined, DeleteOutlined, SaveOutlined } from '@ant-design/icons';
import dayjs, { Dayjs } from 'dayjs';
import { useEffect, useMemo, useRef, useState } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import { useQueryClient } from '@tanstack/react-query';
import { OrderInput, PURCHASING_KEYS, purchasingApi, usePurchaseOrder } from '../../api/purchasing';
import { errMsg } from '../../api/client';
import type { SearchHit } from '../../api/types';
import { MoneyInput, QuantityInput } from '../../components/Inputs';
import { ProductSearch, ProductSearchHandle } from '../../components/ProductSearch';
import { SupplierSelect } from '../../components/SupplierSelect';
import { useAuthStore, useBranchWarehouses, useCan } from '../../store/auth';
import { money, qty, toNum } from '../../utils/format';

interface Line { key: string; variantId: string; sku: string; name: string; unit: string; quantity: number; unitPrice: number; discountAmount: number; taxRate: number; note?: string }
const lineTotal = (l: Line) => Math.max(0, l.quantity * l.unitPrice - l.discountAmount);

export default function PurchaseOrderEditorPage() {
  const { id } = useParams();
  const nav = useNavigate();
  const qc = useQueryClient();
  const { message } = App.useApp();
  const can = useCan();
  const branchId = useAuthStore((s) => s.currentBranchId);
  const me = useAuthStore((s) => s.me);
  const warehouses = useBranchWarehouses();
  const { data: existing, isLoading } = usePurchaseOrder(id);
  const [supplierId, setSupplierId] = useState<string>();
  const [warehouseId, setWarehouseId] = useState<string>();
  const [expectedDate, setExpectedDate] = useState<Dayjs | null>(null);
  const [discount, setDiscount] = useState(0);
  const [note, setNote] = useState('');
  const [lines, setLines] = useState<Line[]>([]);
  const [saving, setSaving] = useState<'draft' | 'confirm' | null>(null);
  const searchRef = useRef<ProductSearchHandle>(null);

  useEffect(() => { if (!warehouseId && warehouses.length) setWarehouseId(warehouses.find((w) => w.isDefault)?.id ?? warehouses[0].id); }, [warehouses, warehouseId]);
  useEffect(() => {
    if (!existing) return;
    if (existing.status !== 'DRAFT') { message.warning('Chỉ sửa được đơn tạm'); nav('/purchase-orders'); return; }
    setSupplierId(existing.supplierId); setWarehouseId(existing.warehouseId); setExpectedDate(existing.expectedDate ? dayjs(existing.expectedDate) : null); setDiscount(toNum(existing.discountAmount)); setNote(existing.note ?? '');
    setLines((existing.lines ?? []).map((l) => ({ key: l.id, variantId: l.variantId, sku: l.variant.sku, name: l.variant.name, unit: l.variant.product.baseUnit ?? '', quantity: toNum(l.quantity), unitPrice: toNum(l.unitPrice), discountAmount: toNum(l.discountAmount), taxRate: toNum(l.taxRate), note: l.note ?? undefined })));
  }, [existing]);
  useEffect(() => {
    const h = (e: KeyboardEvent) => { if (e.key === 'F3') { e.preventDefault(); searchRef.current?.focus(); } if (e.key === 'F9') { e.preventDefault(); void save('draft'); } if (e.key === 'F10') { e.preventDefault(); void save('confirm'); } };
    window.addEventListener('keydown', h); return () => window.removeEventListener('keydown', h);
  });

  const addHit = (h: SearchHit) => {
    if (h.product.type !== 'GOODS') { message.warning('Chỉ hàng hóa mới đặt mua được'); return; }
    const factor = h.unit ? toNum(h.unit.conversionFactor) : 1;
    setLines((prev) => {
      const idx = prev.findIndex((l) => l.variantId === h.id);
      if (idx >= 0) return prev.map((l, i) => (i === idx ? { ...l, quantity: l.quantity + factor } : l));
      return [...prev, { key: `${h.id}-${Date.now()}`, variantId: h.id, sku: h.sku, name: h.name, unit: h.product.baseUnit ?? '', quantity: factor, unitPrice: toNum(h.lastPurchasePrice ?? h.costPrice ?? 0), discountAmount: 0, taxRate: 0 }];
    });
  };
  const upd = (key: string, patch: Partial<Line>) => setLines((p) => p.map((l) => (l.key === key ? { ...l, ...patch } : l)));
  const totals = useMemo(() => { const subtotal = lines.reduce((s, l) => s + lineTotal(l), 0); const tax = lines.reduce((s, l) => s + lineTotal(l) * l.taxRate / 100, 0); return { subtotal, tax, total: subtotal - discount + tax }; }, [lines, discount]);

  const save = async (mode: 'draft' | 'confirm') => {
    if (saving) return;
    if (!branchId || !warehouseId) { message.warning('Chọn chi nhánh và kho'); return; }
    if (!supplierId) { message.warning('Chọn nhà cung cấp'); return; }
    if (!lines.length) { message.warning('Thêm ít nhất một dòng hàng'); return; }
    if (lines.some((l) => !(l.quantity > 0))) { message.warning('Số lượng phải lớn hơn 0'); return; }
    if (discount > totals.subtotal) { message.warning('Chiết khấu đơn vượt quá tổng tiền hàng'); return; }
    if (mode === 'confirm' && !can('purchase.order.confirm')) { message.warning('Bạn không có quyền xác nhận đơn'); return; }
    const payload: OrderInput = { branchId, warehouseId, supplierId, expectedDate: expectedDate?.toISOString(), discountAmount: String(discount), note: note || undefined, lines: lines.map((l) => ({ variantId: l.variantId, quantity: String(l.quantity), unitPrice: String(l.unitPrice), discountAmount: String(l.discountAmount), taxRate: String(l.taxRate), note: l.note })) };
    setSaving(mode);
    try {
      let o = id && existing ? await purchasingApi.updateOrder(id, { ...payload, version: existing.version }) : await purchasingApi.createOrder(payload);
      if (mode === 'confirm') o = await purchasingApi.confirmOrder(o.id);
      message.success(mode === 'confirm' ? `Đã xác nhận đơn ${o.code}` : `Đã lưu đơn tạm ${o.code}`);
      PURCHASING_KEYS.forEach((k) => qc.invalidateQueries({ queryKey: [k] }));
      nav(`/purchase-orders?search=${o.code}`);
    } catch (e) { message.error(errMsg(e)); if ((e as any).code === 'VERSION_CONFLICT') qc.invalidateQueries({ queryKey: ['purchase-order', id] }); } finally { setSaving(null); }
  };

  if (id && isLoading) return <div className="muted">Đang tải đơn…</div>;
  const branch = me?.branches.find((b) => b.id === branchId);
  return (
    <div>
      <div className="kv-editor-head">
        <h1 className="kv-page-title" style={{ margin: 0 }}>{id ? `Sửa đơn ${existing?.code ?? ''}` : 'Đặt hàng nhập'}</h1>
        <span className="kv-hint"><span className="kv-kbd">F3</span>Tìm hàng <span className="kv-kbd">F9</span>Lưu tạm <span className="kv-kbd">F10</span>Lưu & xác nhận</span>
      </div>
      <div className="kv-doc-editor">
        <div className="kv-doc-lines">
          <Card size="small" style={{ marginBottom: 10 }}><ProductSearch scanContinuous ref={searchRef} autoFocus goodsOnly warehouseId={warehouseId} onPick={addHit} placeholder="Tìm hàng hóa theo mã, tên hoặc quét mã vạch (F3)" /></Card>
          <Card size="small" styles={{ body: { padding: 0 } }}>
            <Table size="small" rowKey="key" pagination={false} dataSource={lines} locale={{ emptyText: 'Chưa có hàng hóa. Tìm hoặc quét mã vạch để thêm.' }} scroll={{ x: 1000 }}
              columns={[
                { title: '#', width: 36, render: (_, __, i) => i + 1 },
                { title: 'Mã hàng', dataIndex: 'sku', width: 120 },
                { title: 'Tên hàng', dataIndex: 'name', width: 240 },
                { title: 'ĐVT', dataIndex: 'unit', width: 60 },
                { title: 'Số lượng', width: 100, render: (_, l) => <QuantityInput size="small" min={0} value={l.quantity} onChange={(v) => upd(l.key, { quantity: toNum(v) })} /> },
                { title: 'Đơn giá', width: 130, render: (_, l) => <MoneyInput size="small" value={l.unitPrice} onChange={(v) => upd(l.key, { unitPrice: toNum(v) })} /> },
                { title: 'CK dòng', width: 120, render: (_, l) => <MoneyInput size="small" value={l.discountAmount} onChange={(v) => upd(l.key, { discountAmount: toNum(v) })} /> },
                { title: 'Thuế %', width: 80, render: (_, l) => <InputNumber size="small" min={0} max={100} value={l.taxRate} onChange={(v) => upd(l.key, { taxRate: toNum(v) })} style={{ width: '100%' }} /> },
                { title: 'Thành tiền', className: 'num', width: 120, render: (_, l) => money(lineTotal(l)) },
                { title: 'Ghi chú', width: 120, render: (_, l) => <Input size="small" value={l.note} onChange={(e) => upd(l.key, { note: e.target.value })} /> },
                { title: '', width: 40, render: (_, l) => <Button size="small" type="text" danger icon={<DeleteOutlined />} onClick={() => setLines((p) => p.filter((x) => x.key !== l.key))} /> },
              ]} />
          </Card>
        </div>
        <div className="kv-doc-side">
          <Card size="small" title="Thông tin đơn">
            <div className="kv-kv" style={{ marginBottom: 10 }}><span className="k">Chi nhánh</span><span className="v">{branch?.name ?? <span className="neg">Chưa chọn</span>}</span><span className="k">Người tạo</span><span className="v">{me?.user.fullName}</span></div>
            <div style={{ marginBottom: 8 }}><div className="kv-hint">Nhà cung cấp</div><SupplierSelect value={supplierId} onChange={(v) => setSupplierId(v)} /></div>
            <div style={{ marginBottom: 8 }}><div className="kv-hint">Kho nhận</div><Select style={{ width: '100%' }} value={warehouseId} onChange={setWarehouseId} options={warehouses.map((w) => ({ value: w.id, label: w.name }))} /></div>
            <div style={{ marginBottom: 8 }}><div className="kv-hint">Ngày dự kiến nhận</div><DatePicker style={{ width: '100%' }} format="DD/MM/YYYY" value={expectedDate} onChange={setExpectedDate} /></div>
            <div style={{ marginBottom: 8 }}><div className="kv-hint">Chiết khấu đơn</div><MoneyInput value={discount} onChange={(v) => setDiscount(toNum(v))} /></div>
            <div style={{ marginBottom: 8 }}><div className="kv-hint">Ghi chú</div><Input.TextArea rows={2} value={note} onChange={(e) => setNote(e.target.value)} /></div>
            <div className="kv-kv" style={{ margin: '10px 0' }}>
              <span className="k">Số dòng / SL</span><span className="v">{lines.length} / {qty(lines.reduce((s, l) => s + l.quantity, 0))}</span>
              <span className="k">Tổng tiền hàng</span><span className="v">{money(totals.subtotal)}</span>
              <span className="k">Chiết khấu</span><span className="v">{money(discount)}</span>
              <span className="k">Thuế</span><span className="v">{money(totals.tax)}</span>
              <span className="k"><b>Tổng cộng</b></span><span className="v"><b>{money(totals.total)}</b></span>
            </div>
            <Space direction="vertical" className="kv-doc-actions" style={{ width: '100%' }}>
              <Button block icon={<SaveOutlined />} loading={saving === 'draft'} onClick={() => save('draft')}>Lưu tạm (F9)</Button>
              {can('purchase.order.confirm') && <Button block type="primary" icon={<CheckOutlined />} loading={saving === 'confirm'} onClick={() => save('confirm')}>Lưu & xác nhận (F10)</Button>}
              <Button block type="text" onClick={() => nav('/purchase-orders')}>Quay lại danh sách</Button>
            </Space>
          </Card>
        </div>
      </div>
    </div>
  );
}
