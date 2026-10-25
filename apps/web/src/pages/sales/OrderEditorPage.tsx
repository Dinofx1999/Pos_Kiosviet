import { Alert, App, Button, Card, DatePicker, Input, Select, Switch, Tag } from 'antd';
import Table from '../../components/ResponsiveTable';
import { ArrowLeftOutlined, CarOutlined, CheckOutlined, DeleteOutlined, DollarOutlined, MinusOutlined, PlusOutlined, SaveOutlined } from '@ant-design/icons';
import dayjs, { Dayjs } from 'dayjs';
import { useEffect, useMemo, useState } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import { useQueryClient } from '@tanstack/react-query';
import { catalogApi } from '../../api/catalog';
import { DeliveryInfoInput, OrderLineInput, OrderSource, SalesOrder, deliveriesApi, ordersApi, useOrder } from '../../api/orders';
import type { ApplicablePriceBook } from '../../api/promotions';
import { salesApi } from '../../api/sales';
import { normalizeError } from '../../api/client';
import type { Batch, CustomerHit, ProductUnit, SearchHit } from '../../api/types';
import { CustomerSelect } from '../../components/CustomerSelect';
import { MoneyInput, QuantityInput } from '../../components/Inputs';
import { ProductSearch } from '../../components/ProductSearch';
import { useIsMobile } from '../../hooks/useMedia';
import { useAuthStore, useBranchWarehouses, useCan } from '../../store/auth';
import { dt, money, qty, toNum, uuid } from '../../utils/format';
import { DeliveryFormFields, DeliveryFormValue, DeliverySummary, METHOD_OPTIONS, deliveryFormToInput, emptyDeliveryForm, validateDeliveryForm } from './DeliveryShared';
import { ORDER_STATUS_COLOR, ORDER_STATUS_LABEL, OrderDetail, SOURCE_OPTIONS, invalidateOrders, lineNames, orderErrMsg } from './OrderShared';
import './orders.css';

interface ELine { key: string; variantId: string; productId: string; sku: string; name: string; productType: string; baseUnit?: string | null; units: ProductUnit[]; productUnitId?: string; unitName?: string | null; quantity: number; listPrice: number; unitPrice: number; discount: number; taxRate: number; trackBatch: boolean; batchId?: string; batches?: Batch[]; onHand?: number; note?: string; error?: string }

/** Mirrors the API's computeInvoice (BR-52) for the live totals of the order. */
function orderTotals(lines: ELine[], docDiscount: number, priceIncludesTax: boolean) {
  const totals = lines.map((l) => Math.max(0, l.quantity * l.unitPrice - l.discount));
  const subtotal = totals.reduce((s, v) => s + v, 0);
  const disc = Math.min(docDiscount, subtotal);
  let tax = 0; let total = 0;
  lines.forEach((l, i) => { const share = subtotal > 0 ? (disc * totals[i]) / subtotal : 0; const net = totals[i] - share; const t = l.taxRate ? (priceIncludesTax ? (net * l.taxRate) / (100 + l.taxRate) : (net * l.taxRate) / 100) : 0; tax += t; total += net + (priceIncludesTax ? 0 : t); });
  return { subtotal, discount: disc, tax: Math.round(tax * 100) / 100, total: Math.round(total * 100) / 100 };
}

export default function OrderEditorPage() {
  const { id } = useParams();
  const nav = useNavigate();
  const { data: existing, isLoading, error } = useOrder(id);
  if (id && isLoading) return <div className="muted">Đang tải đơn đặt hàng…</div>;
  if (id && (error || !existing)) return <Alert type="error" showIcon message={error ? orderErrMsg(error) : 'Không tìm thấy đơn đặt hàng'} action={<Button onClick={() => nav('/orders')}>Danh sách</Button>} />;
  if (existing && existing.status !== 'DRAFT') return <ReadOnlyOrder o={existing} />;
  return <OrderEditor key={existing?.id ?? 'new'} existing={existing} />;
}

/** CONFIRMED / COMPLETED / CANCELLED: the detail block with its status actions (lines are frozen once stock is reserved – BR-101). */
function ReadOnlyOrder({ o }: { o: SalesOrder }) {
  const nav = useNavigate();
  return (
    <div className="od-editor">
      <div className="kv-editor-head">
        <h1 className="kv-page-title" style={{ margin: 0 }}>Đơn đặt hàng {o.code}</h1>
        <Tag color={ORDER_STATUS_COLOR[o.status]}>{ORDER_STATUS_LABEL[o.status]}</Tag>
        {o.invoice && <Tag color="green">HĐ {o.invoice.code}</Tag>}
        {o.delivery && <Tag color="blue"><CarOutlined /> {o.delivery.code}</Tag>}
      </div>
      {o.status === 'CONFIRMED' && <Alert type="info" showIcon style={{ marginBottom: 10 }} message="Đơn đã xác nhận đang giữ hàng" description="Chỉ sửa được ghi chú / ngày hẹn. Để đổi dòng hàng hãy “Hủy xác nhận” (trả lại tồn khả dụng) rồi sửa phiếu tạm." />}
      <div className="kv-card" style={{ padding: 12 }}><OrderDetail id={o.id} onDeleted={() => nav('/orders')} /></div>
      <Button type="text" icon={<ArrowLeftOutlined />} style={{ marginTop: 10 }} onClick={() => nav('/orders')}>Quay lại danh sách</Button>
    </div>
  );
}

function OrderEditor({ existing }: { existing?: SalesOrder }) {
  const nav = useNavigate();
  const qc = useQueryClient();
  const { message } = App.useApp();
  const can = useCan();
  const isMobile = useIsMobile();
  const me = useAuthStore((s) => s.me);
  const branchId = useAuthStore((s) => s.currentBranchId);
  const warehouses = useBranchWarehouses();
  const priceIncludesTax = me?.settings?.['pricing.priceIncludesTax'] !== false;
  const canPriceEdit = can('invoice.price.edit');
  const canDiscount = can('invoice.discount');
  const canPriceBook = can('invoice.pricebook.select');
  const canPrice = can('invoice.create');

  const [customerId, setCustomerId] = useState<string | undefined>(existing?.customerId ?? undefined);
  const [customer, setCustomer] = useState<{ name: string; phone?: string | null; address?: string | null } | null>(existing?.customer ?? null);
  const [source, setSource] = useState<OrderSource>((existing?.source as OrderSource) ?? 'POS');
  const [expectedAt, setExpectedAt] = useState<Dayjs | null>(existing?.expectedAt ? dayjs(existing.expectedAt) : null);
  const [warehouseId, setWarehouseId] = useState<string | undefined>(existing?.warehouseId ?? (warehouses.find((w) => w.isDefault) ?? warehouses[0])?.id);
  const [priceBookId, setPriceBookId] = useState<string | undefined>(existing?.priceBookId ?? undefined);
  const [priceBooks, setPriceBooks] = useState<ApplicablePriceBook[]>([]);
  const [lines, setLines] = useState<ELine[]>([]);
  const [loadingLines, setLoadingLines] = useState(!!existing);
  const [discount, setDiscount] = useState(toNum(existing?.discountAmount));
  const [note, setNote] = useState(existing?.note ?? '');
  const [hasDelivery, setHasDelivery] = useState(false);
  const [delivery, setDelivery] = useState<DeliveryFormValue>(emptyDeliveryForm({ receiverName: existing?.customer?.name ?? '', receiverPhone: existing?.customer?.phone ?? '', address: existing?.customer?.address ?? '' }));
  const [deposit, setDeposit] = useState({ method: 'CASH', amount: 0, reference: '' });
  const [saving, setSaving] = useState<'draft' | 'confirm' | null>(null);

  // existing draft → editor lines (units / batches fetched per product, like the POS reopening a held order)
  useEffect(() => {
    if (!existing) return;
    let alive = true;
    (async () => {
      const mapped = await Promise.all((existing.lines ?? []).map(async (l) => {
        let units: ProductUnit[] = []; let batches: Batch[] | undefined;
        try { const p = await catalogApi.product(l.variant.product.id); units = p.units ?? []; if (p.trackBatch) batches = await catalogApi.batches(l.variantId); } catch { /* ignore */ }
        return { key: uuid(), variantId: l.variantId, productId: l.variant.product.id, sku: l.variant.sku, name: l.variant.name, productType: l.variant.product.type, baseUnit: l.variant.product.baseUnit, units, productUnitId: l.productUnitId ?? undefined, unitName: l.unitName, quantity: toNum(l.quantity), listPrice: toNum(l.listPrice), unitPrice: toNum(l.unitPrice), discount: toNum(l.discountAmount), taxRate: toNum(l.taxRate), trackBatch: !!l.variant.product.trackBatch, batchId: l.batchId ?? undefined, batches, note: l.note ?? undefined } as ELine;
      }));
      if (alive) { setLines(mapped); setLoadingLines(false); }
    })();
    return () => { alive = false; };
  }, [existing?.id, existing?.version]);

  // price books applicable to the branch / customer (a group-targeted book is pre-selected for new orders – BR-97)
  useEffect(() => {
    if (!canPriceBook || !branchId) return;
    salesApi.applicablePriceBooks({ branchId, customerId }).then((list) => { setPriceBooks(list); const sug = list.find((p) => p.suggested); if (!existing && sug && !priceBookId) void changePriceBook(sug.id); }).catch(() => setPriceBooks([]));
  }, [branchId, customerId, canPriceBook]);

  useEffect(() => {
    const h = (e: KeyboardEvent) => { if (e.key === 'F9') { e.preventDefault(); void save(false); } if (e.key === 'F10') { e.preventDefault(); void save(true); } };
    window.addEventListener('keydown', h); return () => window.removeEventListener('keydown', h);
  });

  const setLine = (key: string, p: Partial<ELine> | ((l: ELine) => Partial<ELine>)) => setLines((prev) => prev.map((l) => (l.key === key ? { ...l, ...(typeof p === 'function' ? p(l) : p), error: undefined } : l)));
  const removeLine = (key: string) => setLines((p) => p.filter((l) => l.key !== key));
  const lineTotal = (l: ELine) => Math.max(0, l.quantity * l.unitPrice - l.discount);
  const totals = useMemo(() => orderTotals(lines, discount, priceIncludesTax), [lines, discount, priceIncludesTax]);
  const names = useMemo(() => lineNames(lines), [lines]);
  const depositAmount = Math.min(deposit.amount, totals.total);
  const dueAfterDeposit = Math.max(0, totals.total - depositAmount);

  const priceOf = async (variantId: string, productUnitId: string | undefined, fallback: number) => {
    if (!canPrice) return { listPrice: fallback, taxRate: 0, unitName: undefined as string | null | undefined };
    try { const p = await salesApi.price({ variantId, priceBookId, productUnitId, quantity: '1' }); return { listPrice: toNum(p.listPrice), taxRate: toNum(p.taxRate), unitName: p.unitName }; }
    catch { return { listPrice: fallback, taxRate: 0, unitName: undefined }; }
  };
  const addHit = async (hit: SearchHit) => {
    const dup = lines.find((l) => l.variantId === hit.id && !l.productUnitId && !hit.unit);
    if (dup) { setLine(dup.key, { quantity: dup.quantity + 1 }); return; }
    try {
      const product = await catalogApi.product(hit.product.id);
      const units = product.units ?? [];
      const unit = hit.unit ? units.find((u) => u.unitName === hit.unit!.unitName) : undefined;
      const priced = await priceOf(hit.id, unit?.id, toNum(hit.unit?.sellPrice ?? hit.sellPrice));
      const batches = product.trackBatch ? await catalogApi.batches(hit.id).catch(() => [] as Batch[]) : undefined;
      setLines((p) => [...p, { key: uuid(), variantId: hit.id, productId: hit.product.id, sku: hit.sku, name: hit.name, productType: hit.product.type, baseUnit: hit.product.baseUnit, units, productUnitId: unit?.id, unitName: priced.unitName ?? unit?.unitName ?? hit.product.baseUnit, quantity: 1, listPrice: priced.listPrice, unitPrice: priced.listPrice, discount: 0, taxRate: priced.taxRate, trackBatch: !!product.trackBatch, batches, onHand: toNum(hit.onHand ?? hit.onHandTotal) }]);
    } catch (e) { message.error(orderErrMsg(e)); }
  };
  const changeUnit = async (l: ELine, productUnitId?: string) => {
    const u = l.units.find((x) => x.id === productUnitId);
    const priced = await priceOf(l.variantId, productUnitId, toNum(u?.sellPrice ?? l.listPrice));
    setLine(l.key, { productUnitId, unitName: priced.unitName ?? u?.unitName ?? l.baseUnit, listPrice: priced.listPrice, unitPrice: priced.listPrice });
  };
  const changePriceBook = async (id?: string) => {
    setPriceBookId(id);
    for (const l of lines) {
      try { const p = await salesApi.price({ variantId: l.variantId, priceBookId: id, productUnitId: l.productUnitId, quantity: String(l.quantity) }); setLine(l.key, (cur) => ({ listPrice: toNum(p.listPrice), unitPrice: cur.unitPrice === cur.listPrice ? toNum(p.listPrice) : cur.unitPrice })); } catch { /* keep */ }
    }
  };
  const pickCustomer = (id: string | undefined, hit?: CustomerHit) => {
    setCustomerId(id);
    if (!id) { setCustomer(null); return; }
    setCustomer(hit ? { name: hit.name, phone: hit.phone } : null);
    salesApi.customer(id).then((c) => { setCustomer(c); setDelivery((f) => ({ ...f, receiverName: f.receiverName || c.name, receiverPhone: f.receiverPhone || c.phone || '', address: f.address || c.address || '' })); }).catch(() => undefined);
  };

  const buildLines = (): OrderLineInput[] | null => {
    if (!lines.length) { message.warning('Thêm ít nhất một mặt hàng'); return null; }
    for (const l of lines) {
      if (!(l.quantity > 0)) { setLine(l.key, { error: 'Số lượng phải lớn hơn 0' }); message.warning(`${l.sku}: số lượng phải lớn hơn 0`); return null; }
      if (l.discount > l.quantity * l.unitPrice + 1e-9) { setLine(l.key, { error: 'Giảm giá vượt thành tiền' }); message.warning(`${l.sku}: giảm giá không được vượt thành tiền`); return null; }
    }
    if (!canDiscount && (discount > 0 || lines.some((l) => l.discount > 0))) { message.warning('Bạn không có quyền giảm giá (invoice.discount)'); return null; }
    return lines.map((l) => ({ variantId: l.variantId, quantity: String(l.quantity), productUnitId: l.productUnitId, batchId: l.batchId, unitPrice: canPriceEdit && Math.abs(l.unitPrice - l.listPrice) > 0.0001 ? String(l.unitPrice) : undefined, discountAmount: l.discount > 0 ? String(l.discount) : undefined, note: l.note?.trim() || undefined }));
  };
  const fail = (e: unknown) => {
    const err = normalizeError(e);
    message.error(orderErrMsg(e, names), 6);
    if (err.code === 'INSUFFICIENT_STOCK' && err.details?.variantId) setLines((p) => p.map((l) => (l.variantId === err.details!.variantId ? { ...l, error: `Không đủ tồn khả dụng: còn ${qty(err.details!.available ?? err.details!.onHand ?? 0)}, cần ${qty(err.details!.requested ?? 0)}` } : l)));
    if (err.code === 'VERSION_CONFLICT' && existing) qc.invalidateQueries({ queryKey: ['order', existing.id] });
  };
  const save = async (confirm: boolean) => {
    if (saving) return;
    const ls = buildLines(); if (!ls) return;
    if (!branchId || !warehouseId) { message.warning('Chọn kho xuất hàng'); return; }
    if (confirm && !can('order.confirm')) { message.warning('Bạn không có quyền xác nhận đơn (order.confirm)'); return; }
    if (deposit.amount > totals.total + 0.001) { message.warning(`Tiền cọc không được vượt tổng đơn (${money(totals.total)})`); return; }
    let deliveryInput: DeliveryInfoInput | undefined;
    if (hasDelivery && !existing?.delivery) { const bad = validateDeliveryForm(delivery); if (bad) { message.warning(bad); return; } deliveryInput = deliveryFormToInput(delivery); }
    setSaving(confirm ? 'confirm' : 'draft');
    try {
      let o: SalesOrder;
      const dep = deposit.amount > 0 ? { method: deposit.method, amount: String(deposit.amount), reference: deposit.reference.trim() || undefined } : undefined;
      if (!existing) {
        o = await ordersApi.create({ branchId, warehouseId, customerId, priceBookId, source, expectedAt: expectedAt?.toISOString(), discountAmount: discount > 0 ? String(discount) : undefined, note: note.trim() || undefined, lines: ls, confirm, deposits: dep ? [dep] : undefined, delivery: deliveryInput });
      } else {
        o = await ordersApi.update(existing.id, {
          version: existing.version, lines: ls, discountAmount: String(discount), note: note.trim() || undefined, expectedAt: expectedAt ? expectedAt.toISOString() : null,
          customerId: (customerId ?? null) !== (existing.customerId ?? null) ? customerId ?? null : undefined,
          priceBookId: (priceBookId ?? null) !== (existing.priceBookId ?? null) ? priceBookId ?? null : undefined,
          warehouseId: warehouseId !== existing.warehouseId ? warehouseId : undefined,
        });
        if (dep) o = await ordersApi.deposit(existing.id, dep);
        if (deliveryInput) await deliveriesApi.create({ ...deliveryInput, orderId: existing.id });
        if (confirm) o = await ordersApi.confirm(existing.id, o.version);
      }
      invalidateOrders(qc);
      message.success(confirm ? `Đã xác nhận đơn ${o.code} – hàng đã được giữ${dep ? ` · cọc ${money(dep.amount)}` : ''}${o.delivery ? ` · vận đơn ${o.delivery.code}` : ''}` : `Đã lưu phiếu tạm ${o.code}`);
      nav(confirm ? `/orders/${o.id}` : `/orders?search=${o.code}`);
    } catch (e) { fail(e); } finally { setSaving(null); }
  };

  const unitSelect = (l: ELine) => <Select size={isMobile ? 'middle' : 'small'} style={{ minWidth: 110 }} value={l.productUnitId ?? ''} onChange={(v) => changeUnit(l, v || undefined)} options={[{ value: '', label: l.baseUnit ?? 'Cơ bản' }, ...l.units.map((u) => ({ value: u.id!, label: u.unitName }))]} />;
  const batchSelect = (l: ELine) => <Select size={isMobile ? 'middle' : 'small'} allowClear style={{ minWidth: 140 }} placeholder="Lô (tùy chọn)" value={l.batchId} onChange={(batchId) => setLine(l.key, { batchId })} options={(l.batches ?? []).map((b) => ({ value: b.id, label: `${b.batchNo}${b.expiryDate ? ` · HSD ${dt(b.expiryDate, 'DD/MM/YY')}` : ''}` }))} />;
  const qtyBox = (l: ELine) => (
    <div className="od-qty">
      <Button icon={<MinusOutlined />} onClick={() => setLine(l.key, { quantity: Math.max(1, l.quantity - 1) })} />
      <QuantityInput min={0.001} inputMode="decimal" value={l.quantity} onChange={(v) => setLine(l.key, { quantity: toNum(v) })} />
      <Button icon={<PlusOutlined />} onClick={() => setLine(l.key, { quantity: l.quantity + 1 })} />
    </div>
  );
  const typeTag = (l: ELine) => l.productType !== 'GOODS' ? <Tag style={{ marginInlineEnd: 0 }}>{l.productType === 'SERVICE' ? 'Dịch vụ' : 'Combo'}</Tag> : null;

  return (
    <div className="od-editor">
      <div className="kv-editor-head">
        <h1 className="kv-page-title" style={{ margin: 0 }}>{existing ? `Sửa phiếu tạm ${existing.code}` : 'Đặt hàng'}</h1>
        {existing && <Tag>Phiếu tạm · chưa giữ hàng</Tag>}
        <span className="kv-hint"><span className="kv-kbd">F9</span>Lưu phiếu tạm <span className="kv-kbd">F10</span>Xác nhận</span>
      </div>
      {isMobile && <div className="od-total-bar"><span className="muted">{lines.length} dòng · Tổng đơn</span><span className="big">{money(totals.total)}</span></div>}
      <div className="kv-doc-editor">
        <div className="kv-doc-lines">
          <Card size="small" title="Hàng đặt" extra={<span className="kv-hint">{lines.length} dòng · {qty(lines.reduce((s, l) => s + l.quantity, 0))} SP</span>} styles={{ body: { padding: isMobile ? 8 : 12 } }}>
            <ProductSearch scanContinuous onPick={addHit} warehouseId={warehouseId} size={isMobile ? 'large' : 'middle'} placeholder="Tìm hàng hóa hoặc quét mã vạch" autoFocus={!isMobile && !existing} />
            <div style={{ marginTop: 8 }}>
              {loadingLines && <div className="muted" style={{ padding: 8 }}>Đang tải dòng hàng…</div>}
              {!lines.length && !loadingLines && <div className="muted" style={{ padding: '12px 4px' }}>Chưa có hàng. Tìm hoặc quét mã vạch để thêm.</div>}
              {isMobile ? (
                <div className="od-lines">
                  {lines.map((l, i) => (
                    <div key={l.key} className={`od-line editable${l.error ? ' error' : ''}`}>
                      <div className="nm">{i + 1}. {l.name}</div>
                      <DeleteOutlined className="del" onClick={() => removeLine(l.key)} />
                      <div className="meta"><span>{l.sku}</span>{l.onHand !== undefined && <span>Tồn {qty(l.onHand)}</span>}{!l.units.length && <span>ĐVT {l.unitName ?? l.baseUnit ?? '—'}</span>}{typeTag(l)}</div>
                      {l.units.length > 0 && <div className="row"><span className="lbl">Đơn vị</span>{unitSelect(l)}</div>}
                      {l.trackBatch && <div className="row"><span className="lbl">Lô</span>{batchSelect(l)}</div>}
                      <div className="row"><span className="lbl">Số lượng</span>{qtyBox(l)}</div>
                      <div className="row"><span className="lbl">Đơn giá</span>{canPriceEdit ? <MoneyInput value={l.unitPrice} onChange={(v) => setLine(l.key, { unitPrice: toNum(v) })} /> : <span>{money(l.unitPrice)}</span>}</div>
                      {canDiscount && <div className="row"><span className="lbl">Giảm giá</span><MoneyInput value={l.discount} max={l.quantity * l.unitPrice} onChange={(v) => setLine(l.key, { discount: toNum(v) })} /></div>}
                      <div className="row"><span className="lbl">Thành tiền</span><b className="tot">{money(lineTotal(l))}</b></div>
                      <div className="row"><span className="lbl">Ghi chú</span><Input placeholder="Ghi chú dòng" value={l.note} onChange={(e) => setLine(l.key, { note: e.target.value })} /></div>
                      {l.error && <div className="err">{l.error}</div>}
                    </div>
                  ))}
                </div>
              ) : lines.length > 0 && (
                <Table size="small" rowKey="key" pagination={false} dataSource={lines} rowClassName={(l) => (l.error ? 'kv-line-error' : '')} scroll={{ x: 1000 }}
                  columns={[
                    { title: '#', width: 36, render: (_, __, i) => i + 1 },
                    { title: 'Mã hàng', dataIndex: 'sku', width: 120 },
                    { title: 'Tên hàng', dataIndex: 'name', render: (v, l) => <span>{v} {typeTag(l)}{l.trackBatch && <div style={{ marginTop: 4 }}>{batchSelect(l)}</div>}{l.error && <div className="neg" style={{ fontSize: 12 }}>{l.error}</div>}</span> },
                    { title: 'ĐVT', width: 120, render: (_, l) => (l.units.length ? unitSelect(l) : l.unitName ?? l.baseUnit) },
                    { title: 'Tồn', className: 'num', width: 70, render: (_, l) => (l.onHand !== undefined ? qty(l.onHand) : '') },
                    { title: 'Số lượng', width: 100, render: (_, l) => <QuantityInput size="small" min={0.001} value={l.quantity} onChange={(v) => setLine(l.key, { quantity: toNum(v) })} /> },
                    { title: 'Đơn giá', width: 130, className: 'num', render: (_, l) => canPriceEdit ? <MoneyInput size="small" value={l.unitPrice} onChange={(v) => setLine(l.key, { unitPrice: toNum(v) })} /> : money(l.unitPrice) },
                    ...(canDiscount ? [{ title: 'Giảm giá', width: 110, render: (_: unknown, l: ELine) => <MoneyInput size="small" value={l.discount} max={l.quantity * l.unitPrice} onChange={(v) => setLine(l.key, { discount: toNum(v) })} /> }] : []),
                    { title: 'Thành tiền', className: 'num', width: 120, render: (_, l) => <b>{money(lineTotal(l))}</b> },
                    { title: 'Ghi chú', width: 140, render: (_, l) => <Input size="small" value={l.note} onChange={(e) => setLine(l.key, { note: e.target.value })} /> },
                    { title: '', width: 40, render: (_, l) => <Button size="small" type="text" danger icon={<DeleteOutlined />} onClick={() => removeLine(l.key)} /> },
                  ]} />
              )}
            </div>
          </Card>
          <div className="kv-hint" style={{ marginTop: 6 }}>Giá lấy theo bảng giá / đơn vị như khi bán hàng{canPriceEdit ? '' : ' – bạn không có quyền sửa giá'}. Khuyến mãi tự động và voucher áp dụng khi lập hóa đơn lúc hoàn tất đơn. Xác nhận đơn sẽ giữ tồn kho cho khách.</div>
        </div>

        <div className="kv-doc-side">
          <Card size="small" title="Thông tin đơn" className="od-side-card">
            <div className="od-side-field"><div className="kv-hint">Khách hàng{existing && toNum(existing.depositAmount) > 0 ? ' (đã cọc – không đổi)' : ''}</div><CustomerSelect value={customerId} onChange={pickCustomer} disabled={!!existing && toNum(existing.depositAmount) > 0} /></div>
            <div className="od-form">
              <div className="od-field"><div className="kv-hint">Nguồn đơn</div><Select style={{ width: '100%' }} value={source} onChange={setSource} options={SOURCE_OPTIONS} disabled={!!existing} /></div>
              <div className="od-field"><div className="kv-hint">Hẹn giao / lấy hàng</div><DatePicker style={{ width: '100%' }} format="DD/MM/YYYY HH:mm" showTime={{ minuteStep: 15 }} value={expectedAt} onChange={setExpectedAt} placeholder="Không hẹn" /></div>
              <div className="od-field"><div className="kv-hint">Kho xuất</div><Select style={{ width: '100%' }} value={warehouseId} onChange={setWarehouseId} options={warehouses.map((w) => ({ value: w.id, label: w.name }))} placeholder="Chọn kho" /></div>
              {canPriceBook && <div className="od-field"><div className="kv-hint">Bảng giá</div><Select style={{ width: '100%' }} allowClear value={priceBookId} onChange={(v) => changePriceBook(v || undefined)} options={priceBooks.map((pb) => ({ value: pb.id, label: pb.suggested ? `${pb.name} · nhóm khách` : pb.name }))} placeholder="Giá niêm yết" /></div>}
              <div className="od-field od-span"><div className="kv-hint">Ghi chú</div><Input.TextArea rows={2} value={note} onChange={(e) => setNote(e.target.value)} maxLength={1000} placeholder="Giao chiều, gọi trước khi giao…" /></div>
            </div>
          </Card>

          <Card size="small" title={<span><DollarOutlined /> Tiền cọc</span>} className="od-side-card" extra={existing && toNum(existing.depositAmount) > 0 ? <span className="kv-hint">đã cọc {money(existing.depositAmount)}</span> : undefined}>
            <div className="od-form">
              <div className="od-field"><div className="kv-hint">Khách cọc ngay</div><MoneyInput value={deposit.amount} max={totals.total || undefined} onChange={(v) => setDeposit((d) => ({ ...d, amount: toNum(v) }))} placeholder="0" /></div>
              <div className="od-field"><div className="kv-hint">Phương thức</div><Select style={{ width: '100%' }} value={deposit.method} onChange={(v) => setDeposit((d) => ({ ...d, method: v }))} options={METHOD_OPTIONS} /></div>
              {deposit.amount > 0 && <div className="od-field od-span"><div className="kv-hint">Tham chiếu (số UNC, mã GD…)</div><Input value={deposit.reference} onChange={(e) => setDeposit((d) => ({ ...d, reference: e.target.value }))} /></div>}
            </div>
            <div className="kv-hint" style={{ marginTop: 6 }}>Phiếu thu cọc được lập cùng đơn{customerId ? ' và ghi vào sổ công nợ của khách' : ''}. Có thể nhận cọc thêm sau khi lưu.</div>
          </Card>

          <Card size="small" title={<span><CarOutlined /> Giao hàng</span>} className="od-side-card" extra={!existing?.delivery && <Switch checked={hasDelivery} onChange={setHasDelivery} checkedChildren="Có" unCheckedChildren="Không" />}>
            {existing?.delivery ? <DeliverySummary d={existing.delivery} /> : hasDelivery ? (
              <>
                <DeliveryFormFields compact value={delivery} onChange={setDelivery} due={dueAfterDeposit} />
                <div className="kv-hint" style={{ marginTop: 6 }}>COD mặc định = tổng đơn − tiền cọc + phí giao hàng. Vận đơn được tạo cùng đơn và chuyển sang hóa đơn khi hoàn tất.</div>
              </>
            ) : <div className="kv-hint">Bật “Có giao hàng” để tạo vận đơn kèm đơn (người nhận lấy từ khách hàng{customer ? ` ${customer.name}${customer.address ? ` – ${customer.address}` : ''}` : ''}, COD tự tính).</div>}
          </Card>

          <div className="od-settle" style={{ marginTop: 10 }}>
            <span className="k">Tiền hàng</span><span className="v">{money(totals.subtotal)}</span>
            {canDiscount && <><span className="k">Giảm giá đơn</span><span className="v" style={{ minWidth: 140 }}><MoneyInput size="small" value={discount} max={totals.subtotal} onChange={(v) => setDiscount(toNum(v))} /></span></>}
            {totals.tax > 0 && <><span className="k">{priceIncludesTax ? 'Trong đó thuế' : 'Thuế'}</span><span className="v">{money(totals.tax)}</span></>}
            <span className="hr" />
            <span className="k">Tổng đơn</span><span className="v big">{money(totals.total)}</span>
            {depositAmount > 0 && <><span className="k">Cọc ngay</span><span className="v">− {money(depositAmount)}</span><span className="k">Còn phải thu</span><span className={`v${dueAfterDeposit > 0 ? ' neg' : ' pos'}`}>{money(dueAfterDeposit)}</span></>}
            {hasDelivery && !existing?.delivery && <><span className="k">COD dự kiến</span><span className="v">{money(delivery.codAmount ?? dueAfterDeposit + Math.max(0, delivery.shippingFee))}</span></>}
          </div>
          <div className="od-actions">
            {can('order.create') && <Button icon={<SaveOutlined />} loading={saving === 'draft'} disabled={!!saving && saving !== 'draft'} onClick={() => save(false)}>Lưu phiếu tạm</Button>}
            {can('order.confirm') && <Button type="primary" icon={<CheckOutlined />} loading={saving === 'confirm'} disabled={!!saving && saving !== 'confirm'} onClick={() => save(true)}>Xác nhận đặt hàng</Button>}
          </div>
          {!isMobile && <Button block type="text" style={{ marginTop: 8 }} icon={<ArrowLeftOutlined />} onClick={() => nav('/orders')}>Quay lại danh sách</Button>}
        </div>
      </div>
    </div>
  );
}
