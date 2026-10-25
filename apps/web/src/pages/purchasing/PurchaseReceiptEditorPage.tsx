import { Alert, App, Button, Card, Checkbox, DatePicker, Input, InputNumber, Modal, Select, Space, Tag } from 'antd';
import Table from '../../components/ResponsiveTable';
import { CheckOutlined, DeleteOutlined, MinusOutlined, PlusOutlined, SaveOutlined } from '@ant-design/icons';
import dayjs, { Dayjs } from 'dayjs';
import { useEffect, useMemo, useRef, useState } from 'react';
import { useNavigate, useParams, useSearchParams } from 'react-router-dom';
import { useQueryClient } from '@tanstack/react-query';
import { catalogApi } from '../../api/catalog';
import { ImmediatePayment, PURCHASING_KEYS, ReceiptInput, purchasingApi, usePurchaseOrder, usePurchaseReceipt } from '../../api/purchasing';
import { errMsg } from '../../api/client';
import type { Batch, SearchHit } from '../../api/types';
import { MoneyInput, QuantityInput } from '../../components/Inputs';
import { ProductSearch, ProductSearchHandle } from '../../components/ProductSearch';
import { useIsMobile } from '../../hooks/useMedia';
import { SupplierSelect } from '../../components/SupplierSelect';
import { useAuthStore, useBranchWarehouses, useCan } from '../../store/auth';
import { money, qty, toNum } from '../../utils/format';
import { PostReceiptModal } from './PostReceiptModal';

interface Line { key: string; variantId: string; sku: string; name: string; unit: string; trackBatch: boolean; onHand: number; quantity: number; unitPrice: number; discountAmount: number; taxRate: number; batchId?: string; batches?: Batch[]; orderLineId?: string; maxQty?: number; note?: string; error?: string }
interface Cost { key: string; name: string; amount: number; allocationMethod: 'BY_VALUE' | 'BY_QUANTITY'; payToSupplier: boolean }
const lineTotal = (l: Line) => Math.max(0, l.quantity * l.unitPrice - l.discountAmount);

export default function PurchaseReceiptEditorPage() {
  const { id } = useParams();
  const [sp] = useSearchParams();
  const nav = useNavigate();
  const qc = useQueryClient();
  const { message } = App.useApp();
  const can = useCan();
  const branchId = useAuthStore((s) => s.currentBranchId);
  const me = useAuthStore((s) => s.me);
  const warehouses = useBranchWarehouses();
  const orderIdParam = sp.get('orderId') ?? undefined;
  const { data: existing, isLoading } = usePurchaseReceipt(id);
  const { data: order } = usePurchaseOrder(orderIdParam);
  const [orderId, setOrderId] = useState<string | undefined>(orderIdParam);
  const [orderCode, setOrderCode] = useState<string>();
  const [supplierId, setSupplierId] = useState<string | undefined>(sp.get('supplierId') ?? undefined);
  const [warehouseId, setWarehouseId] = useState<string>();
  const [receiptDate, setReceiptDate] = useState<Dayjs>(dayjs());
  const [invoiceNo, setInvoiceNo] = useState('');
  const [discount, setDiscount] = useState(0);
  const [note, setNote] = useState('');
  const [lines, setLines] = useState<Line[]>([]);
  const [costs, setCosts] = useState<Cost[]>([]);
  const [saving, setSaving] = useState<'draft' | 'post' | null>(null);
  const [posting, setPosting] = useState(false);
  const [batchModal, setBatchModal] = useState<{ lineKey: string; variantId: string; batchNo: string; expiryDate?: string } | null>(null);
  const searchRef = useRef<ProductSearchHandle>(null);
  const isMobile = useIsMobile();
  const batchInputRef = useRef<any>(null);
  const canCost = can('product.cost.view') || can('inventory.cost.view');

  useEffect(() => { if (!warehouseId && warehouses.length) setWarehouseId(warehouses.find((w) => w.isDefault)?.id ?? warehouses[0].id); }, [warehouses, warehouseId]);

  // prefill from a purchase order
  useEffect(() => {
    if (!order || id) return;
    if (!(order.status === 'CONFIRMED' || order.status === 'PARTIAL')) { message.warning('Đơn đặt hàng chưa được xác nhận hoặc đã đóng'); return; }
    setSupplierId(order.supplierId); setWarehouseId(order.warehouseId); setOrderCode(order.code); setDiscount(0);
    (async () => {
      const ls: Line[] = [];
      for (const l of order.lines ?? []) {
        const remaining = toNum(l.remainingQuantity);
        if (remaining <= 0) continue;
        ls.push({ key: l.id, variantId: l.variantId, sku: l.variant.sku, name: l.variant.name, unit: l.variant.product.baseUnit ?? '', trackBatch: !!l.variant.product.trackBatch, onHand: 0, quantity: remaining, maxQty: remaining, unitPrice: toNum(l.unitPrice), discountAmount: 0, taxRate: toNum(l.taxRate), orderLineId: l.id, batches: l.variant.product.trackBatch ? await catalogApi.batches(l.variantId).catch(() => []) : undefined });
      }
      setLines(ls);
    })();
  }, [order, id]);

  // load existing draft
  useEffect(() => {
    if (!existing) return;
    if (existing.status !== 'DRAFT') { message.warning('Chỉ sửa được phiếu tạm'); nav('/purchase-receipts'); return; }
    setSupplierId(existing.supplierId); setWarehouseId(existing.warehouseId); setOrderId(existing.orderId ?? undefined); setOrderCode(existing.order?.code); setReceiptDate(dayjs(existing.receiptDate)); setInvoiceNo(existing.supplierInvoiceNo ?? ''); setDiscount(toNum(existing.discountAmount)); setNote(existing.note ?? '');
    setCosts((existing.costs ?? []).map((c, i) => ({ key: c.id ?? String(i), name: c.name, amount: toNum(c.amount), allocationMethod: c.allocationMethod, payToSupplier: c.payToSupplier })));
    (async () => {
      const ls: Line[] = [];
      for (const l of existing.lines ?? []) ls.push({ key: l.id, variantId: l.variantId, sku: l.variant.sku, name: l.variant.name, unit: l.variant.product.baseUnit ?? '', trackBatch: !!l.variant.product.trackBatch, onHand: 0, quantity: toNum(l.quantity), unitPrice: toNum(l.unitPrice), discountAmount: toNum(l.discountAmount), taxRate: toNum(l.taxRate), batchId: l.batchId ?? undefined, orderLineId: l.orderLineId ?? undefined, note: l.note ?? undefined, batches: l.variant.product.trackBatch ? await catalogApi.batches(l.variantId).catch(() => []) : undefined });
      setLines(ls);
    })();
  }, [existing]);

  useEffect(() => {
    const h = (e: KeyboardEvent) => { if (e.key === 'F3') { e.preventDefault(); searchRef.current?.focus(); } if (e.key === 'F9') { e.preventDefault(); void save('draft'); } if (e.key === 'F10') { e.preventDefault(); openPost(); } };
    window.addEventListener('keydown', h); return () => window.removeEventListener('keydown', h);
  });

  const addHit = async (h: SearchHit) => {
    if (h.product.type !== 'GOODS') { message.warning('Chỉ hàng hóa mới nhập kho được'); return; }
    const factor = h.unit ? toNum(h.unit.conversionFactor) : 1;
    setLines((prev) => {
      const idx = prev.findIndex((l) => l.variantId === h.id && !l.trackBatch && !l.orderLineId);
      if (idx >= 0) return prev.map((l, i) => (i === idx ? { ...l, quantity: l.quantity + factor } : l));
      return [...prev, { key: `${h.id}-${Date.now()}`, variantId: h.id, sku: h.sku, name: h.name, unit: h.product.baseUnit ?? '', trackBatch: h.product.trackBatch, onHand: toNum(h.onHand ?? h.onHandTotal), quantity: factor, unitPrice: toNum(h.lastPurchasePrice ?? h.costPrice ?? 0), discountAmount: 0, taxRate: 0 }];
    });
    if (h.product.trackBatch) { const batches = await catalogApi.batches(h.id).catch(() => []); setLines((prev) => prev.map((l) => (l.variantId === h.id && !l.batches ? { ...l, batches } : l))); }
  };
  const upd = (key: string, patch: Partial<Line>) => setLines((p) => p.map((l) => (l.key === key ? { ...l, ...patch, error: undefined } : l)));

  const totals = useMemo(() => {
    const subtotal = lines.reduce((s, l) => s + lineTotal(l), 0);
    const docDisc = Math.min(discount, subtotal);
    const tax = subtotal > 0 ? lines.reduce((s, l) => s + (lineTotal(l) - docDisc * (lineTotal(l) / subtotal)) * l.taxRate / 100, 0) : 0;
    const landed = costs.reduce((s, c) => s + c.amount, 0);
    const landedSupplier = costs.filter((c) => c.payToSupplier).reduce((s, c) => s + c.amount, 0);
    return { subtotal, docDisc, tax, landed, total: subtotal - docDisc + tax + landedSupplier, qty: lines.reduce((s, l) => s + l.quantity, 0) };
  }, [lines, discount, costs]);

  const buildPayload = (): ReceiptInput | null => {
    if (!branchId || !warehouseId) { message.warning('Chọn chi nhánh và kho'); return null; }
    if (!supplierId) { message.warning('Chọn nhà cung cấp'); return null; }
    if (!lines.length) { message.warning('Thêm ít nhất một dòng hàng'); return null; }
    for (const l of lines) {
      if (l.trackBatch && !l.batchId) { upd(l.key, { error: 'Chọn lô' }); message.warning(`Chọn lô cho ${l.sku}`); return null; }
      if (!(l.quantity > 0)) { upd(l.key, { error: 'Số lượng > 0' }); message.warning(`Số lượng của ${l.sku} phải lớn hơn 0`); return null; }
      if (l.maxQty !== undefined && l.quantity > l.maxQty) { upd(l.key, { error: `Tối đa ${qty(l.maxQty)} theo đơn` }); message.warning(`${l.sku}: vượt số lượng còn lại của đơn đặt hàng`); return null; }
      if (l.discountAmount > l.quantity * l.unitPrice) { upd(l.key, { error: 'CK vượt thành tiền' }); message.warning(`${l.sku}: chiết khấu vượt thành tiền`); return null; }
    }
    if (discount > totals.subtotal) { message.warning('Chiết khấu phiếu vượt quá tổng tiền hàng'); return null; }
    if (costs.some((c) => !c.name.trim())) { message.warning('Nhập tên khoản chi phí'); return null; }
    return {
      branchId, warehouseId, supplierId, orderId, receiptDate: receiptDate.toISOString(), supplierInvoiceNo: invoiceNo || undefined, discountAmount: String(discount), note: note || undefined,
      lines: lines.map((l) => ({ variantId: l.variantId, batchId: l.batchId, orderLineId: l.orderLineId, quantity: String(l.quantity), unitPrice: String(l.unitPrice), discountAmount: String(l.discountAmount), taxRate: String(l.taxRate), note: l.note })),
      costs: costs.filter((c) => c.amount > 0).map((c) => ({ name: c.name.trim(), amount: String(c.amount), allocationMethod: c.allocationMethod, payToSupplier: c.payToSupplier })),
    };
  };

  const openPost = () => { if (!can('purchase.receipt.post')) { message.warning('Bạn không có quyền hoàn thành phiếu'); return; } if (buildPayload()) setPosting(true); };

  const save = async (mode: 'draft' | 'post', payment?: ImmediatePayment) => {
    if (saving) return;
    const payload = buildPayload();
    if (!payload) return;
    setSaving(mode);
    try {
      let r;
      if (id && existing) {
        r = await purchasingApi.updateReceipt(id, { ...payload, version: existing.version });
        if (mode === 'post') r = await purchasingApi.postReceipt(id, payment);
      } else {
        r = mode === 'post' ? await purchasingApi.createAndPostReceipt({ ...payload, payment }) : await purchasingApi.createReceipt(payload);
      }
      message.success(mode === 'post' ? `Đã hoàn thành phiếu nhập ${r.code}` : `Đã lưu phiếu tạm ${r.code}`);
      PURCHASING_KEYS.forEach((k) => qc.invalidateQueries({ queryKey: [k] }));
      setPosting(false);
      nav(`/purchase-receipts?search=${r.code}`);
    } catch (e) {
      const err = e as { code?: string; message: string; details?: any };
      if (err.code === 'PO_QUANTITY_EXCEEDED' && err.details?.orderLineId) setLines((p) => p.map((l) => (l.orderLineId === err.details.orderLineId ? { ...l, error: `Còn lại theo đơn: ${qty(err.details.remaining ?? '')}` } : l)));
      if (err.code === 'VERSION_CONFLICT') qc.invalidateQueries({ queryKey: ['purchase-receipt', id] });
      message.error(err.message);
    } finally { setSaving(null); }
  };

  const createBatch = async () => {
    if (!batchModal?.batchNo.trim()) return;
    try {
      const b = await catalogApi.createBatch(batchModal.variantId, { batchNo: batchModal.batchNo.trim(), expiryDate: batchModal.expiryDate });
      setLines((prev) => prev.map((l) => (l.key === batchModal.lineKey ? { ...l, batchId: b.id, batches: [...(l.batches ?? []), b] } : l)));
      setBatchModal(null);
    } catch (e) { message.error(errMsg(e)); }
  };

  if (id && isLoading) return <div className="muted">Đang tải phiếu…</div>;
  const branch = me?.branches.find((b) => b.id === branchId);
  return (
    <div>
      <div className="kv-editor-head">
        <h1 className="kv-page-title" style={{ margin: 0 }}>{id ? `Sửa phiếu nhập ${existing?.code ?? ''}` : 'Nhập hàng'}</h1>
        {orderCode && <Tag color="blue">Từ đơn {orderCode}</Tag>}
        <span className="kv-hint"><span className="kv-kbd">F3</span>Tìm hàng <span className="kv-kbd">F9</span>Lưu tạm <span className="kv-kbd">F10</span>Hoàn thành</span>
      </div>
      <div className="kv-doc-editor">
        <div className="kv-doc-lines">
          <Card size="small" style={{ marginBottom: 10 }}><ProductSearch scanContinuous ref={searchRef} autoFocus goodsOnly warehouseId={warehouseId} onPick={addHit} /></Card>
          <Card size="small" styles={{ body: { padding: 0 } }}>
            {isMobile ? (
              <div className="kv-mlines">
                {!lines.length && <div className="muted" style={{ padding: 8 }}>Chưa có hàng hóa. Tìm hoặc quét mã vạch để thêm.</div>}
                {lines.map((l, i) => (
                  <div key={l.key} className={`kv-mline${l.error ? ' error' : ''}`}>
                    <div className="nm">{i + 1}. {l.name}{l.orderLineId && <Tag style={{ marginLeft: 6 }}>PDN</Tag>}</div>
                    <DeleteOutlined className="del" onClick={() => setLines((p) => p.filter((x) => x.key !== l.key))} />
                    <div className="meta">{l.sku} · {l.unit} · Tồn: {qty(l.onHand)}{l.maxQty !== undefined ? ` · Còn nhận: ${qty(l.maxQty)}` : ''}</div>
                    {l.trackBatch && (
                      <div className="row"><span className="lbl">Lô</span>
                        <Space.Compact style={{ flex: 1 }}><Select style={{ flex: 1 }} placeholder="Chọn lô" value={l.batchId} onChange={(v) => upd(l.key, { batchId: v })} options={(l.batches ?? []).map((b) => ({ value: b.id, label: `${b.batchNo}${b.expiryDate ? ` (HSD ${b.expiryDate.slice(0, 10)})` : ''}` }))} /><Button icon={<PlusOutlined />} onClick={() => setBatchModal({ lineKey: l.key, variantId: l.variantId, batchNo: '' })} /></Space.Compact>
                      </div>
                    )}
                    <div className="row"><span className="lbl">Số lượng</span>
                      <div className="kv-qty"><Button icon={<MinusOutlined />} onClick={() => upd(l.key, { quantity: Math.max(0, l.quantity - 1) })} /><QuantityInput min={0} max={l.maxQty} inputMode="decimal" value={l.quantity} onChange={(v) => upd(l.key, { quantity: toNum(v) })} /><Button icon={<PlusOutlined />} onClick={() => upd(l.key, { quantity: l.maxQty !== undefined ? Math.min(l.maxQty, l.quantity + 1) : l.quantity + 1 })} /></div>
                    </div>
                    <div className="row"><span className="lbl">Đơn giá</span><MoneyInput inputMode="decimal" value={l.unitPrice} onChange={(v) => upd(l.key, { unitPrice: toNum(v) })} /></div>
                    <div className="row"><span className="lbl">CK dòng</span><MoneyInput inputMode="decimal" value={l.discountAmount} onChange={(v) => upd(l.key, { discountAmount: toNum(v) })} /></div>
                    <div className="row"><span className="lbl">Thuế %</span><InputNumber min={0} max={100} inputMode="decimal" value={l.taxRate} onChange={(v) => upd(l.key, { taxRate: toNum(v) })} style={{ width: 100 }} /></div>
                    <div className="row"><span className="lbl">Thành tiền</span><b className="tot">{money(lineTotal(l))}</b></div>
                    <div className="row"><span className="lbl">Ghi chú</span><Input placeholder="Ghi chú dòng" value={l.note} onChange={(e) => upd(l.key, { note: e.target.value })} /></div>
                    {l.error && <div className="err">{l.error}</div>}
                  </div>
                ))}
              </div>
            ) : (
              <Table size="small" rowKey="key" pagination={false} dataSource={lines} locale={{ emptyText: 'Chưa có hàng hóa. Tìm hoặc quét mã vạch để thêm.' }} rowClassName={(l) => (l.error ? 'kv-line-error' : '')} scroll={{ x: 1250 }}
              columns={[
                { title: '#', width: 36, render: (_, __, i) => i + 1 },
                { title: 'Mã hàng', dataIndex: 'sku', width: 120 },
                { title: 'Tên hàng', dataIndex: 'name', width: 230, render: (v, l) => <span>{v}{l.orderLineId && <Tag style={{ marginLeft: 6 }}>PDN</Tag>}{l.error && <div className="neg" style={{ fontSize: 12 }}>{l.error}</div>}</span> },
                { title: 'ĐVT', dataIndex: 'unit', width: 60 },
                { title: 'Lô', width: 150, render: (_, l) => l.trackBatch ? <Space.Compact style={{ width: '100%' }}><Select size="small" style={{ flex: 1 }} placeholder="Chọn lô" value={l.batchId} onChange={(v) => upd(l.key, { batchId: v })} options={(l.batches ?? []).map((b) => ({ value: b.id, label: `${b.batchNo}${b.expiryDate ? ` (HSD ${b.expiryDate.slice(0, 10)})` : ''}` }))} /><Button size="small" icon={<PlusOutlined />} onClick={() => setBatchModal({ lineKey: l.key, variantId: l.variantId, batchNo: '' })} /></Space.Compact> : <span className="muted">—</span> },
                { title: 'Số lượng', width: 100, render: (_, l) => <QuantityInput size="small" min={0} max={l.maxQty} value={l.quantity} onChange={(v) => upd(l.key, { quantity: toNum(v) })} /> },
                { title: 'Đơn giá', width: 130, render: (_, l) => <MoneyInput size="small" value={l.unitPrice} onChange={(v) => upd(l.key, { unitPrice: toNum(v) })} /> },
                { title: 'CK dòng', width: 110, render: (_, l) => <MoneyInput size="small" value={l.discountAmount} onChange={(v) => upd(l.key, { discountAmount: toNum(v) })} /> },
                { title: 'Thuế %', width: 75, render: (_, l) => <InputNumber size="small" min={0} max={100} value={l.taxRate} onChange={(v) => upd(l.key, { taxRate: toNum(v) })} style={{ width: '100%' }} /> },
                { title: 'Thành tiền', className: 'num', width: 120, render: (_, l) => money(lineTotal(l)) },
                { title: 'Ghi chú', width: 110, render: (_, l) => <Input size="small" value={l.note} onChange={(e) => upd(l.key, { note: e.target.value })} /> },
                { title: '', width: 40, render: (_, l) => <Button size="small" type="text" danger icon={<DeleteOutlined />} onClick={() => setLines((p) => p.filter((x) => x.key !== l.key))} /> },
              ]} />
            )}
          </Card>
          <Card size="small" title="Chi phí nhập hàng (vận chuyển, bốc xếp…) – phân bổ vào giá vốn" style={{ marginTop: 10 }} extra={<Button size="small" icon={<PlusOutlined />} onClick={() => setCosts((c) => [...c, { key: String(Date.now()), name: '', amount: 0, allocationMethod: 'BY_VALUE', payToSupplier: true }])}>Thêm chi phí</Button>}>
            <Table size="small" rowKey="key" pagination={false} dataSource={costs} locale={{ emptyText: 'Không có chi phí' }}
              columns={[
                { title: 'Khoản chi phí', render: (_, c) => <Input size="small" value={c.name} placeholder="Vận chuyển" onChange={(e) => setCosts((cs) => cs.map((x) => (x.key === c.key ? { ...x, name: e.target.value } : x)))} /> },
                { title: 'Số tiền', width: 150, render: (_, c) => <MoneyInput size="small" value={c.amount} onChange={(v) => setCosts((cs) => cs.map((x) => (x.key === c.key ? { ...x, amount: toNum(v) } : x)))} /> },
                { title: 'Phân bổ', width: 160, render: (_, c) => <Select size="small" style={{ width: '100%' }} value={c.allocationMethod} onChange={(v) => setCosts((cs) => cs.map((x) => (x.key === c.key ? { ...x, allocationMethod: v } : x)))} options={[{ value: 'BY_VALUE', label: 'Theo giá trị' }, { value: 'BY_QUANTITY', label: 'Theo số lượng' }]} /> },
                { title: 'Trả cho NCC', width: 110, render: (_, c) => <Checkbox checked={c.payToSupplier} onChange={(e) => setCosts((cs) => cs.map((x) => (x.key === c.key ? { ...x, payToSupplier: e.target.checked } : x)))} /> },
                { title: '', width: 40, render: (_, c) => <Button size="small" type="text" danger icon={<DeleteOutlined />} onClick={() => setCosts((cs) => cs.filter((x) => x.key !== c.key))} /> },
              ]} />
          </Card>
        </div>
        <div className="kv-doc-side">
          <Card size="small" title="Thông tin phiếu">
            <div className="kv-kv" style={{ marginBottom: 10 }}><span className="k">Chi nhánh</span><span className="v">{branch?.name ?? <span className="neg">Chưa chọn</span>}</span><span className="k">Người tạo</span><span className="v">{me?.user.fullName}</span></div>
            <div style={{ marginBottom: 8 }}><div className="kv-hint">Nhà cung cấp</div><SupplierSelect value={supplierId} onChange={(v) => setSupplierId(v)} disabled={!!orderId} /></div>
            <div style={{ marginBottom: 8 }}><div className="kv-hint">Kho nhập</div><Select style={{ width: '100%' }} value={warehouseId} onChange={setWarehouseId} options={warehouses.map((w) => ({ value: w.id, label: w.name }))} /></div>
            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 8, marginBottom: 8 }}>
              <div><div className="kv-hint">Ngày nhập</div><DatePicker style={{ width: '100%' }} format="DD/MM/YYYY" value={receiptDate} onChange={(v) => v && setReceiptDate(v)} /></div>
              <div><div className="kv-hint">Số HĐ NCC</div><Input value={invoiceNo} onChange={(e) => setInvoiceNo(e.target.value)} /></div>
            </div>
            <div style={{ marginBottom: 8 }}><div className="kv-hint">Chiết khấu phiếu</div><MoneyInput value={discount} onChange={(v) => setDiscount(toNum(v))} /></div>
            <div style={{ marginBottom: 8 }}><div className="kv-hint">Ghi chú</div><Input.TextArea rows={2} value={note} onChange={(e) => setNote(e.target.value)} /></div>
            <div className="kv-kv" style={{ margin: '10px 0' }}>
              <span className="k">Số dòng / SL</span><span className="v">{lines.length} / {qty(totals.qty)}</span>
              <span className="k">Tổng tiền hàng</span><span className="v">{money(totals.subtotal)}</span>
              <span className="k">Chiết khấu phiếu</span><span className="v">{money(totals.docDisc)}</span>
              <span className="k">Thuế</span><span className="v">{money(totals.tax)}</span>
              <span className="k">Chi phí nhập</span><span className="v">{money(totals.landed)}</span>
              <span className="k"><b>Cần trả NCC</b></span><span className="v"><b>{money(totals.total)}</b></span>
            </div>
            {canCost && totals.landed > 0 && <Alert type="info" showIcon style={{ marginBottom: 8 }} message="Chi phí nhập và thuế (theo cấu hình) được phân bổ vào giá vốn từng dòng khi hoàn thành." />}
            <Space direction="vertical" className="kv-doc-actions" style={{ width: '100%' }}>
              <Button block icon={<SaveOutlined />} loading={saving === 'draft'} onClick={() => save('draft')}>Lưu tạm (F9)</Button>
              {can('purchase.receipt.post') && <Button block type="primary" icon={<CheckOutlined />} loading={saving === 'post'} onClick={openPost}>Hoàn thành (F10)</Button>}
              <Button block type="text" onClick={() => nav('/purchase-receipts')}>Quay lại danh sách</Button>
            </Space>
          </Card>
        </div>
      </div>
      <PostReceiptModal open={posting} total={totals.total} code={existing?.code} loading={saving === 'post'} onClose={() => setPosting(false)} onConfirm={(payment) => save('post', payment)} />
      <Modal title="Thêm lô mới" open={!!batchModal} onCancel={() => setBatchModal(null)} onOk={createBatch} okText="Thêm" cancelText="Hủy" destroyOnClose afterOpenChange={(o) => { if (o) setTimeout(() => batchInputRef.current?.focus?.(), 50); }}>
        <div className="kv-hint">Số lô</div><Input ref={batchInputRef} autoFocus value={batchModal?.batchNo} onChange={(e) => setBatchModal((m) => m && { ...m, batchNo: e.target.value })} onPressEnter={createBatch} style={{ marginBottom: 8 }} />
        <div className="kv-hint">Hạn sử dụng</div><DatePicker style={{ width: '100%' }} format="DD/MM/YYYY" onChange={(dv) => setBatchModal((m) => m && { ...m, expiryDate: dv ? dv.format('YYYY-MM-DD') : undefined })} />
      </Modal>
    </div>
  );
}
