import { Alert, App, Button, Card, DatePicker, Empty, Input, Segmented, Select, Switch, Tag } from 'antd';
import Table from '../../components/ResponsiveTable';
import { ArrowLeftOutlined, CheckCircleOutlined, CheckOutlined, DeleteOutlined, MinusOutlined, PlusOutlined, SaveOutlined, SwapOutlined } from '@ant-design/icons';
import dayjs, { Dayjs } from 'dayjs';
import { useEffect, useMemo, useState } from 'react';
import { Link, useNavigate, useParams, useSearchParams } from 'react-router-dom';
import { useQueryClient } from '@tanstack/react-query';
import { catalogApi } from '../../api/catalog';
import { ExchangeInput, RefundInput, ReturnInput, SALES_KEYS, salesApi, useCurrentShift, useInvoices, useReturnable, useSalesReturn } from '../../api/sales';
import { normalizeError } from '../../api/client';
import type { Batch, ExchangeResult, Invoice, ReturnCondition, SalesReturn, SearchHit } from '../../api/types';
import { MoneyInput, QuantityInput } from '../../components/Inputs';
import { ProductSearch } from '../../components/ProductSearch';
import { useIsMobile } from '../../hooks/useMedia';
import { useAuthStore, useCan } from '../../store/auth';
import { dt, money, qty, toNum, uuid } from '../../utils/format';
import { ShiftOpenModal } from '../pos/PosModals';
import { CONDITION_LABEL, METHOD_OPTIONS, RETURN_STATUS_COLOR, RETURN_STATUS_LABEL, ReturnCompleteModal, SalesReturnDetail, returnErrMsg } from './SalesReturnShared';

interface RLine { invoiceLineId: string; variantId: string; sku: string; name: string; unit: string; productType: string; sold: number; returnable: number; defaultPrice: number; unitPrice: number; quantity: number; condition: ReturnCondition; note?: string; error?: string }
interface XLine { key: string; variantId: string; productId: string; sku: string; name: string; productType: string; unitName?: string | null; productUnitId?: string; quantity: number; listPrice: number; unitPrice: number; discount: number; taxRate: number; trackBatch: boolean; batchId?: string; batches?: Batch[]; onHand: number; error?: string }

/** Mirrors the API's computeInvoice (BR-52) for the live total of the exchange invoice. */
function invoiceTotals(lines: XLine[], docDiscount: number, priceIncludesTax: boolean) {
  const totals = lines.map((l) => Math.max(0, l.quantity * l.unitPrice - l.discount));
  const subtotal = totals.reduce((s, v) => s + v, 0);
  const disc = Math.min(docDiscount, subtotal);
  let tax = 0; let total = 0;
  lines.forEach((l, i) => { const share = subtotal > 0 ? (disc * totals[i]) / subtotal : 0; const net = totals[i] - share; const t = l.taxRate ? (priceIncludesTax ? (net * l.taxRate) / (100 + l.taxRate) : (net * l.taxRate) / 100) : 0; tax += t; total += net + (priceIncludesTax ? 0 : t); });
  return { subtotal, discount: disc, tax: Math.round(tax * 100) / 100, total: Math.round(total * 100) / 100 };
}

export default function SalesReturnEditorPage() {
  const { id } = useParams();
  const [sp, setSp] = useSearchParams();
  const nav = useNavigate();
  const { data: existing, isLoading, error } = useSalesReturn(id);
  if (id && isLoading) return <div className="muted">Đang tải phiếu trả hàng…</div>;
  if (id && (error || !existing)) return <Alert type="error" showIcon message={error ? returnErrMsg(error) : 'Không tìm thấy phiếu trả hàng'} action={<Button onClick={() => nav('/sales-returns')}>Danh sách</Button>} />;
  if (existing && existing.status !== 'DRAFT') return <ReadOnlyReturn r={existing} />;
  const invoiceId = existing?.invoiceId ?? sp.get('invoiceId') ?? undefined;
  if (!invoiceId) return <InvoicePicker onPick={(inv) => setSp({ invoiceId: inv.id })} />;
  return <ReturnEditor key={`${invoiceId}:${existing?.id ?? 'new'}`} invoiceId={invoiceId} existing={existing} />;
}

function ReadOnlyReturn({ r }: { r: SalesReturn }) {
  const nav = useNavigate();
  return (
    <div className="sr-editor">
      <div className="kv-editor-head">
        <h1 className="kv-page-title" style={{ margin: 0 }}>Phiếu trả hàng {r.code}</h1>
        <Tag color={RETURN_STATUS_COLOR[r.status]}>{RETURN_STATUS_LABEL[r.status]}</Tag>
        {r.exchangeInvoice && <Tag color="blue"><SwapOutlined /> Đổi hàng → {r.exchangeInvoice.code}</Tag>}
      </div>
      <div className="kv-card" style={{ padding: 12 }}><SalesReturnDetail id={r.id} /></div>
      <Button type="text" icon={<ArrowLeftOutlined />} style={{ marginTop: 10 }} onClick={() => nav('/sales-returns')}>Quay lại danh sách</Button>
    </div>
  );
}

/** Step 1 – pick the completed invoice to return from (search by code / customer / phone). */
function InvoicePicker({ onPick }: { onPick: (inv: Invoice) => void }) {
  const nav = useNavigate();
  const branchId = useAuthStore((s) => s.currentBranchId);
  const [text, setText] = useState('');
  const [search, setSearch] = useState<string | undefined>();
  const { data, isLoading, error } = useInvoices({ search, status: 'COMPLETED', branchId: branchId ?? undefined, pageSize: 20 });
  const rows = data?.data ?? [];
  return (
    <div className="sr-editor">
      <div className="kv-editor-head"><h1 className="kv-page-title" style={{ margin: 0 }}>Trả hàng / Đổi hàng</h1></div>
      <div className="sr-steps"><span className="on">1. Chọn hóa đơn</span><span>›</span><span>2. Chọn hàng trả</span><span>›</span><span>3. Hoàn tiền / đổi hàng</span></div>
      <Input.Search size="large" allowClear autoFocus placeholder="Mã hóa đơn, tên hoặc SĐT khách hàng" value={text} onChange={(e) => setText(e.target.value)} onSearch={(v) => setSearch(v.trim() || undefined)} enterButton="Tìm" style={{ marginBottom: 10 }} />
      <div className="kv-hint" style={{ marginBottom: 8 }}>{search ? `Kết quả cho “${search}”` : 'Hóa đơn hoàn thành gần đây của chi nhánh đang chọn'} · chỉ trả được hóa đơn đã hoàn thành.</div>
      {isLoading && <div className="muted">Đang tải…</div>}
      {!isLoading && !rows.length && <div className="kv-card" style={{ padding: 16 }}><Empty description={error ? returnErrMsg(error) : 'Không có hóa đơn phù hợp'} /></div>}
      <div className="sr-inv-list">
        {rows.map((inv) => {
          const returned = toNum(inv.returnedAmount);
          const full = returned >= toNum(inv.totalAmount) && toNum(inv.totalAmount) > 0;
          return (
            <div key={inv.id} className="sr-inv">
              <div style={{ minWidth: 0 }}>
                <div className="code">{inv.code} <span className="muted" style={{ fontWeight: 400, fontSize: 12 }}>{dt(inv.invoiceDate)}</span></div>
                <div className="meta">{inv.customer ? `${inv.customer.name}${inv.customer.phone ? ` · ${inv.customer.phone}` : ''}` : 'Khách lẻ'} · {inv._count?.lines ?? inv.lines?.length ?? ''} dòng{returned > 0 && <span className="neg"> · đã trả {money(returned)}</span>}</div>
              </div>
              <div style={{ textAlign: 'right' }}>
                <div className="amt">{money(inv.totalAmount)}</div>
                <Button size="small" type="primary" disabled={full} onClick={() => onPick(inv)}>{full ? 'Đã trả hết' : 'Chọn'}</Button>
              </div>
            </div>
          );
        })}
      </div>
      <Button type="text" icon={<ArrowLeftOutlined />} style={{ marginTop: 12 }} onClick={() => nav('/sales-returns')}>Quay lại danh sách</Button>
    </div>
  );
}

/** Step 2/3 – returnable lines of the invoice, refund or exchange. */
function ReturnEditor({ invoiceId, existing }: { invoiceId: string; existing?: SalesReturn }) {
  const nav = useNavigate();
  const qc = useQueryClient();
  const { message } = App.useApp();
  const can = useCan();
  const isMobile = useIsMobile();
  const me = useAuthStore((s) => s.me);
  const branchId = useAuthStore((s) => s.currentBranchId);
  const priceIncludesTax = me?.settings?.['pricing.priceIncludesTax'] !== false;
  const canPriceEdit = can('return.price.edit');
  const canSellPrice = can('invoice.price.edit');
  const canExchange = can('return.complete') && can('invoice.create') && can('invoice.complete');
  const { data, isLoading, error } = useReturnable(invoiceId);
  const inv = data?.invoice;
  const { data: shift } = useCurrentShift(inv?.branchId ?? branchId);
  const [openShift, setOpenShift] = useState(false);

  const [lines, setLines] = useState<RLine[]>([]);
  const [returnDate, setReturnDate] = useState<Dayjs>(dayjs());
  const [reason, setReason] = useState('');
  const [note, setNote] = useState('');
  const [fee, setFee] = useState(0);
  const [saving, setSaving] = useState<'draft' | 'complete' | 'exchange' | null>(null);
  const [completing, setCompleting] = useState(false);
  const [mode, setMode] = useState<'return' | 'exchange'>('return');
  // exchange
  const [xLines, setXLines] = useState<XLine[]>([]);
  const [xDiscount, setXDiscount] = useState(0);
  const [xNote, setXNote] = useState('');
  const [payMethod, setPayMethod] = useState('CASH');
  const [payAmount, setPayAmount] = useState<number | null>(null);
  const [refMethod, setRefMethod] = useState('CASH');
  const [refAmount, setRefAmount] = useState<number | null>(null);
  const [refCredit, setRefCredit] = useState(false);
  const [result, setResult] = useState<ExchangeResult | null>(null);

  useEffect(() => {
    if (!data) return;
    const base: RLine[] = data.lines.map((l) => ({ invoiceLineId: l.id, variantId: l.variantId, sku: l.variant.sku, name: l.variant.name, unit: l.unitName ?? l.variant.product.baseUnit ?? '', productType: l.variant.product.type ?? 'GOODS', sold: toNum(l.quantity), returnable: toNum(l.returnableQuantity), defaultPrice: toNum(l.refundUnitPrice), unitPrice: toNum(l.refundUnitPrice), quantity: 0, condition: 'RESTOCK' }));
    if (existing) {
      setReturnDate(dayjs(existing.returnDate)); setReason(existing.reason ?? ''); setNote(existing.note ?? ''); setFee(toNum(existing.feeAmount));
      for (const l of existing.lines ?? []) { const b = base.find((x) => x.invoiceLineId === l.invoiceLineId); if (b) { b.quantity = toNum(l.quantity); b.unitPrice = toNum(l.unitPrice); b.condition = l.condition; b.note = l.note ?? undefined; } }
    } else if (data.lines.length === 1 && toNum(data.lines[0].returnableQuantity) > 0) base[0].quantity = toNum(data.lines[0].returnableQuantity);
    setLines(base);
  }, [data, existing?.id, existing?.version]);

  useEffect(() => {
    const h = (e: KeyboardEvent) => { if (e.key === 'F9') { e.preventDefault(); void saveDraft(); } if (e.key === 'F10') { e.preventDefault(); openComplete(); } };
    window.addEventListener('keydown', h); return () => window.removeEventListener('keydown', h);
  });

  const upd = (ilId: string, patch: Partial<RLine>) => setLines((p) => p.map((l) => (l.invoiceLineId === ilId ? { ...l, ...patch, error: undefined } : l)));
  const active = lines.filter((l) => l.quantity > 0);
  const subtotal = useMemo(() => active.reduce((s, l) => s + l.quantity * l.unitPrice, 0), [lines]);
  const feeApplied = Math.min(fee, subtotal);
  const totalRefund = Math.max(0, subtotal - feeApplied);
  const maxRefund = toNum(data?.maxRefund);
  const hasCustomer = !!inv?.customer;

  // ---------- exchange maths
  const xTotals = useMemo(() => invoiceTotals(xLines, xDiscount, priceIncludesTax), [xLines, xDiscount, priceIncludesTax]);
  const settle = useMemo(() => { const R = totalRefund; const N = xTotals.total; const offset = Math.min(R, N); return { R, N, offset, customerPays: Math.round((N - offset) * 100) / 100, refundDue: Math.round((R - offset) * 100) / 100 }; }, [totalRefund, xTotals.total]);
  const payNow = payAmount === null ? settle.customerPays : Math.min(payAmount, settle.customerPays);
  const refundNow = refCredit ? 0 : refAmount === null ? settle.refundDue : Math.min(refAmount, settle.refundDue);

  const addX = async (hit: SearchHit) => {
    if (!inv) return;
    const dup = xLines.find((l) => l.variantId === hit.id && !l.productUnitId && !hit.unit);
    if (dup) { setX(dup.key, { quantity: dup.quantity + 1 }); return; }
    try {
      let productUnitId: string | undefined; let trackBatch = hit.product.trackBatch;
      if (hit.unit) { const product = await catalogApi.product(hit.product.id); productUnitId = product.units?.find((u) => u.unitName === hit.unit!.unitName)?.id; trackBatch = product.trackBatch; }
      const priced = await salesApi.price({ variantId: hit.id, productUnitId, quantity: '1' });
      const batches = trackBatch ? await catalogApi.batches(hit.id).catch(() => [] as Batch[]) : undefined;
      setXLines((p) => [...p, { key: uuid(), variantId: hit.id, productId: hit.product.id, sku: hit.sku, name: hit.name, productType: hit.product.type, unitName: priced.unitName ?? hit.product.baseUnit, productUnitId, quantity: 1, listPrice: toNum(priced.listPrice), unitPrice: toNum(priced.listPrice), discount: 0, taxRate: toNum(priced.taxRate), trackBatch: !!trackBatch, batches, onHand: toNum(hit.onHand ?? hit.onHandTotal) }]);
    } catch (e) { message.error(returnErrMsg(e)); }
  };
  const setX = (key: string, patch: Partial<XLine>) => setXLines((p) => p.map((l) => (l.key === key ? { ...l, ...patch, error: undefined } : l)));
  const removeX = (key: string) => setXLines((p) => p.filter((l) => l.key !== key));

  // ---------- payload / actions
  const buildReturn = (): ReturnInput | null => {
    if (!active.length) { message.warning('Nhập số lượng trả cho ít nhất một dòng'); return null; }
    for (const l of active) {
      if (l.quantity > l.returnable + 1e-9) { upd(l.invoiceLineId, { error: `Chỉ còn trả được ${qty(l.returnable)}` }); message.warning(`${l.sku}: vượt số lượng còn có thể trả (${qty(l.returnable)})`); return null; }
      if (l.unitPrice > l.defaultPrice + 0.0001) { upd(l.invoiceLineId, { error: `Giá hoàn tối đa ${money(l.defaultPrice)}` }); message.warning(`${l.sku}: giá hoàn không được cao hơn số tiền khách đã trả (${money(l.defaultPrice)})`); return null; }
    }
    if (fee > subtotal) { message.warning('Phí trả hàng không được lớn hơn giá trị hàng trả'); return null; }
    if (totalRefund > maxRefund + 0.01) { message.warning(`Tiền hoàn vượt phần còn lại của hóa đơn (${money(maxRefund)})`); return null; }
    return { invoiceId, returnDate: returnDate.toISOString(), reason: reason.trim() || undefined, note: note.trim() || undefined, feeAmount: String(feeApplied), lines: active.map((l) => ({ invoiceLineId: l.invoiceLineId, quantity: String(l.quantity), unitPrice: canPriceEdit && Math.abs(l.unitPrice - l.defaultPrice) > 0.0001 ? String(l.unitPrice) : undefined, condition: l.productType === 'SERVICE' ? undefined : l.condition, note: l.note?.trim() || undefined })) };
  };
  const done = (code: string, msg: string) => { message.success(msg); SALES_KEYS.forEach((k) => qc.invalidateQueries({ queryKey: [k] })); nav(`/sales-returns?search=${code}`); };
  const fail = (e: unknown) => {
    const err = normalizeError(e);
    message.error(returnErrMsg(e));
    if (err.code === 'VERSION_CONFLICT' && existing) qc.invalidateQueries({ queryKey: ['sales-return', existing.id] });
    if (err.code === 'RETURN_QUANTITY_EXCEEDED' && err.details?.invoiceLineId) upd(err.details.invoiceLineId, { error: `Chỉ còn trả được ${qty(err.details.returnable)}` });
    if (err.code === 'INSUFFICIENT_STOCK' && err.details?.variantId) setXLines((p) => p.map((l) => (l.variantId === err.details!.variantId ? { ...l, error: `Không đủ tồn (khả dụng ${qty(err.details!.available ?? err.details!.onHand)})` } : l)));
  };
  const saveDraft = async () => {
    if (saving) return;
    const payload = buildReturn(); if (!payload) return;
    setSaving('draft');
    try {
      const r = existing ? await salesApi.updateReturn(existing.id, { version: existing.version, returnDate: payload.returnDate, reason: payload.reason, note: payload.note, feeAmount: payload.feeAmount, lines: payload.lines }) : await salesApi.createReturn(payload);
      done(r.code, `Đã lưu phiếu tạm ${r.code}`);
    } catch (e) { fail(e); } finally { setSaving(null); }
  };
  const openComplete = () => { if (!can('return.complete')) { message.warning('Bạn không có quyền hoàn thành phiếu trả'); return; } if (buildReturn()) setCompleting(true); };
  const complete = async (refund?: RefundInput) => {
    if (saving) return;
    const payload = buildReturn(); if (!payload) return;
    setSaving('complete');
    try {
      let r: SalesReturn;
      if (existing) { const upd1 = await salesApi.updateReturn(existing.id, { version: existing.version, returnDate: payload.returnDate, reason: payload.reason, note: payload.note, feeAmount: payload.feeAmount, lines: payload.lines }); r = await salesApi.completeReturn(existing.id, { version: upd1.version, refund }); }
      else r = await salesApi.completeReturnNow({ ...payload, refund });
      setCompleting(false);
      done(r.code, `Đã hoàn thành phiếu trả ${r.code}${refund ? ` · hoàn ${money(refund.amount)}` : hasCustomer ? ' · ghi có công nợ' : ''}`);
    } catch (e) { fail(e); } finally { setSaving(null); }
  };
  const submitExchange = async () => {
    if (saving || !inv) return;
    const ret = buildReturn(); if (!ret) return;
    if (!xLines.length) { message.warning('Chọn ít nhất một mặt hàng đổi'); return; }
    for (const l of xLines) { if (!(l.quantity > 0)) { setX(l.key, { error: 'Số lượng > 0' }); message.warning(`${l.sku}: số lượng phải lớn hơn 0`); return; } if (l.trackBatch && !l.batchId) { setX(l.key, { error: 'Chọn lô' }); message.warning(`${l.sku}: chọn lô hàng`); return; } }
    if (settle.customerPays > 0 && !hasCustomer && payNow + 0.01 < settle.customerPays) { message.warning(`Khách lẻ phải trả đủ phần chênh lệch ${money(settle.customerPays)}`); return; }
    if (settle.refundDue > 0 && !hasCustomer && Math.abs(refundNow - settle.refundDue) > 0.01) { message.warning(`Khách lẻ phải được hoàn đúng ${money(settle.refundDue)}`); return; }
    const body: ExchangeInput = {
      return: ret,
      newInvoice: { warehouseId: inv.warehouseId, discountAmount: xTotals.discount > 0 ? String(xTotals.discount) : undefined, note: xNote.trim() || undefined, lines: xLines.map((l) => ({ variantId: l.variantId, quantity: String(l.quantity), productUnitId: l.productUnitId, batchId: l.batchId, unitPrice: canSellPrice && Math.abs(l.unitPrice - l.listPrice) > 0.0001 ? String(l.unitPrice) : undefined, discountAmount: l.discount > 0 ? String(l.discount) : undefined })) },
      payments: settle.customerPays > 0 && payNow > 0 ? [{ method: payMethod, amount: String(payNow) }] : undefined,
      refund: settle.refundDue > 0 && refundNow > 0 ? { method: refMethod, amount: String(refundNow) } : undefined,
    };
    setSaving('exchange');
    try {
      const res = await salesApi.exchange(body);
      SALES_KEYS.forEach((k) => qc.invalidateQueries({ queryKey: [k] }));
      message.success(`Đã đổi hàng: phiếu trả ${res.return.code} · hóa đơn mới ${res.invoice.code}`);
      setResult(res);
    } catch (e) { fail(e); } finally { setSaving(null); }
  };

  if (isLoading) return <div className="muted">Đang tải hóa đơn…</div>;
  if (error || !data || !inv) return <Alert type="error" showIcon message={error ? returnErrMsg(error) : 'Không tải được hóa đơn'} action={<Button onClick={() => nav('/sales-returns/new')}>Chọn hóa đơn khác</Button>} />;
  if (result) return <ExchangeResultView res={result} onAgain={() => nav('/sales-returns/new')} />;

  const condOptions = [{ value: 'RESTOCK', label: CONDITION_LABEL.RESTOCK }, { value: 'DAMAGED', label: CONDITION_LABEL.DAMAGED }];
  const qtyBox = (l: RLine) => (
    <div className="sr-qty">
      <Button icon={<MinusOutlined />} disabled={l.returnable <= 0} onClick={() => upd(l.invoiceLineId, { quantity: Math.max(0, l.quantity - 1) })} />
      <QuantityInput min={0} max={l.returnable} inputMode="decimal" disabled={l.returnable <= 0} value={l.quantity} onChange={(v) => upd(l.invoiceLineId, { quantity: Math.min(toNum(v), l.returnable) })} />
      <Button icon={<PlusOutlined />} disabled={l.returnable <= 0} onClick={() => upd(l.invoiceLineId, { quantity: Math.min(l.returnable, l.quantity + 1) })} />
    </div>
  );
  const xQtyBox = (l: XLine) => (
    <div className="sr-qty">
      <Button icon={<MinusOutlined />} onClick={() => setX(l.key, { quantity: Math.max(1, l.quantity - 1) })} />
      <QuantityInput min={0.001} inputMode="decimal" value={l.quantity} onChange={(v) => setX(l.key, { quantity: toNum(v) })} />
      <Button icon={<PlusOutlined />} onClick={() => setX(l.key, { quantity: l.quantity + 1 })} />
    </div>
  );
  const batchSelect = (l: XLine) => <Select style={{ minWidth: 140 }} placeholder="Chọn lô" value={l.batchId} status={l.batchId ? undefined : 'error'} onChange={(batchId) => setX(l.key, { batchId })} options={(l.batches ?? []).map((b) => ({ value: b.id, label: `${b.batchNo}${b.expiryDate ? ` · HSD ${dt(b.expiryDate, 'DD/MM/YY')}` : ''}` }))} />;

  return (
    <div className="sr-editor">
      <div className="kv-editor-head">
        <h1 className="kv-page-title" style={{ margin: 0 }}>{existing ? `Sửa phiếu trả ${existing.code}` : mode === 'exchange' ? 'Đổi hàng' : 'Trả hàng'}</h1>
        <Tag color="blue">HĐ {inv.code} · {dt(inv.invoiceDate)}</Tag>
        {!existing && <Button size="small" type="link" onClick={() => nav('/sales-returns/new')}>Đổi hóa đơn</Button>}
        <span className="kv-hint"><span className="kv-kbd">F9</span>Lưu nháp <span className="kv-kbd">F10</span>Hoàn thành</span>
      </div>
      {!existing && <div className="sr-steps"><span>1. Chọn hóa đơn</span><span>›</span><span className="on">2. Chọn hàng trả</span><span>›</span><span className={mode === 'exchange' ? 'on' : ''}>3. Hoàn tiền / đổi hàng</span></div>}
      {shift === null && <Alert type="warning" showIcon style={{ marginBottom: 10 }} message="Chưa có ca bán hàng đang mở" description="Hoàn tiền ngay và đổi hàng cần ca đang mở (nếu cửa hàng yêu cầu ca). Lưu nháp hoặc ghi có công nợ không cần ca." action={<Button size="small" onClick={() => setOpenShift(true)}>Mở ca</Button>} />}
      <div className="kv-doc-editor">
        <div className="kv-doc-lines">
          <Card size="small" title="Hàng trả lại" extra={<span className="kv-hint">{active.length}/{lines.length} dòng</span>} styles={{ body: { padding: isMobile ? 8 : 0 } }}>
            {isMobile ? (
              <div className="sr-lines">
                {lines.map((l, i) => (
                  <div key={l.invoiceLineId} className={`sr-line${l.returnable <= 0 ? ' off' : ''}${l.error ? ' error' : ''}`}>
                    <div className="nm">{i + 1}. {l.name}{l.productType !== 'GOODS' && <Tag style={{ marginLeft: 6 }}>{l.productType === 'SERVICE' ? 'Dịch vụ' : 'Combo'}</Tag>}</div>
                    <div className="meta"><span>{l.sku}</span><span>ĐVT {l.unit || '—'}</span><span>Đã mua {qty(l.sold)}</span><span>Còn trả được <b>{qty(l.returnable)}</b></span></div>
                    <div className="row"><span className="lbl">SL trả</span>{qtyBox(l)}</div>
                    {l.productType !== 'SERVICE' && <div className="row"><span className="lbl">Tình trạng</span><Segmented block value={l.condition} onChange={(v) => upd(l.invoiceLineId, { condition: v as ReturnCondition })} options={condOptions} disabled={l.returnable <= 0} /></div>}
                    <div className="row"><span className="lbl">Giá hoàn</span>{canPriceEdit ? <MoneyInput max={l.defaultPrice} value={l.unitPrice} disabled={l.returnable <= 0} onChange={(v) => upd(l.invoiceLineId, { unitPrice: Math.min(toNum(v), l.defaultPrice) })} /> : <span>{money(l.unitPrice)}</span>}</div>
                    <div className="row"><span className="lbl">Thành tiền</span><b className="tot">{money(l.quantity * l.unitPrice)}</b></div>
                    {l.quantity > 0 && <div className="row"><span className="lbl">Ghi chú</span><Input placeholder="Ghi chú dòng" value={l.note} onChange={(e) => upd(l.invoiceLineId, { note: e.target.value })} /></div>}
                    {l.error && <div className="err">{l.error}</div>}
                  </div>
                ))}
              </div>
            ) : (
              <Table size="small" rowKey="invoiceLineId" pagination={false} dataSource={lines} rowClassName={(l) => (l.error ? 'kv-line-error' : l.returnable <= 0 ? 'muted' : '')} scroll={{ x: 1100 }}
                columns={[
                  { title: '#', width: 36, render: (_, __, i) => i + 1 },
                  { title: 'Mã hàng', dataIndex: 'sku', width: 120 },
                  { title: 'Tên hàng', dataIndex: 'name', render: (v, l) => <span>{v}{l.productType !== 'GOODS' && <Tag style={{ marginLeft: 6 }}>{l.productType === 'SERVICE' ? 'Dịch vụ' : 'Combo'}</Tag>}{l.error && <div className="neg" style={{ fontSize: 12 }}>{l.error}</div>}</span> },
                  { title: 'ĐVT', dataIndex: 'unit', width: 70 },
                  { title: 'Đã mua', dataIndex: 'sold', className: 'num', width: 80, render: (v) => qty(v) },
                  { title: 'Còn trả được', dataIndex: 'returnable', className: 'num', width: 100, render: (v) => <b>{qty(v)}</b> },
                  { title: 'SL trả', width: 110, render: (_, l) => <QuantityInput size="small" min={0} max={l.returnable} disabled={l.returnable <= 0} value={l.quantity} onChange={(v) => upd(l.invoiceLineId, { quantity: Math.min(toNum(v), l.returnable) })} /> },
                  { title: 'Tình trạng', width: 140, render: (_, l) => l.productType === 'SERVICE' ? <span className="muted">—</span> : <Select size="small" style={{ width: '100%' }} value={l.condition} disabled={l.returnable <= 0} onChange={(v) => upd(l.invoiceLineId, { condition: v })} options={condOptions} /> },
                  { title: 'Giá hoàn', width: 140, className: 'num', render: (_, l) => canPriceEdit ? <MoneyInput size="small" max={l.defaultPrice} value={l.unitPrice} disabled={l.returnable <= 0} onChange={(v) => upd(l.invoiceLineId, { unitPrice: Math.min(toNum(v), l.defaultPrice) })} title={`Tối đa ${money(l.defaultPrice)} (số tiền khách đã trả / đơn vị)`} /> : money(l.unitPrice) },
                  { title: 'Thành tiền', className: 'num', width: 120, render: (_, l) => <b>{money(l.quantity * l.unitPrice)}</b> },
                  { title: 'Ghi chú', width: 140, render: (_, l) => <Input size="small" value={l.note} disabled={l.returnable <= 0} onChange={(e) => upd(l.invoiceLineId, { note: e.target.value })} /> },
                ]} />
            )}
          </Card>
          <div className="kv-hint" style={{ marginTop: 6 }}>Giá hoàn mặc định = số tiền khách đã trả cho mỗi đơn vị (sau chiết khấu) và là mức tối đa{canPriceEdit ? '' : ' – bạn không có quyền sửa giá hoàn'}. “Nhập lại kho” cộng tồn theo giá vốn lúc bán; “Hàng hỏng” không nhập kho.</div>

          {mode === 'exchange' && (
            <Card size="small" style={{ marginTop: 10 }} title={<span><SwapOutlined /> Hàng đổi – hóa đơn mới</span>} extra={<Button type="link" size="small" onClick={() => setMode('return')}>Chỉ trả hàng</Button>} styles={{ body: { padding: isMobile ? 8 : 12 } }}>
              <ProductSearch scanContinuous onPick={addX} warehouseId={inv.warehouseId} size={isMobile ? 'large' : 'middle'} placeholder="Tìm hàng đổi hoặc quét mã vạch" />
              <div style={{ marginTop: 8 }}>
                {!xLines.length && <div className="muted" style={{ padding: '12px 4px' }}>Chưa có hàng đổi. Tìm hoặc quét mã vạch để thêm.</div>}
                {isMobile ? (
                  <div className="sr-lines">
                    {xLines.map((l, i) => (
                      <div key={l.key} className={`sr-line${l.error ? ' error' : ''}`}>
                        <div className="nm" style={{ gridColumn: '1' }}>{i + 1}. {l.name}</div>
                        <DeleteOutlined className="del" onClick={() => removeX(l.key)} />
                        <div className="meta"><span>{l.sku}</span><span>ĐVT {l.unitName ?? '—'}</span><span>Tồn {qty(l.onHand)}</span></div>
                        {l.trackBatch && <div className="row"><span className="lbl">Lô</span>{batchSelect(l)}</div>}
                        <div className="row"><span className="lbl">Số lượng</span>{xQtyBox(l)}</div>
                        <div className="row"><span className="lbl">Đơn giá</span>{canSellPrice ? <MoneyInput value={l.unitPrice} onChange={(v) => setX(l.key, { unitPrice: toNum(v) })} /> : <span>{money(l.unitPrice)}</span>}</div>
                        <div className="row"><span className="lbl">Giảm giá</span><MoneyInput value={l.discount} onChange={(v) => setX(l.key, { discount: toNum(v) })} /></div>
                        <div className="row"><span className="lbl">Thành tiền</span><b className="tot">{money(Math.max(0, l.quantity * l.unitPrice - l.discount))}</b></div>
                        {l.error && <div className="err">{l.error}</div>}
                      </div>
                    ))}
                  </div>
                ) : xLines.length > 0 && (
                  <Table size="small" rowKey="key" pagination={false} dataSource={xLines} rowClassName={(l) => (l.error ? 'kv-line-error' : '')} scroll={{ x: 900 }}
                    columns={[
                      { title: '#', width: 36, render: (_, __, i) => i + 1 },
                      { title: 'Mã hàng', dataIndex: 'sku', width: 120 },
                      { title: 'Tên hàng', dataIndex: 'name', render: (v, l) => <span>{v}{l.trackBatch && <div style={{ marginTop: 4 }}>{batchSelect(l)}</div>}{l.error && <div className="neg" style={{ fontSize: 12 }}>{l.error}</div>}</span> },
                      { title: 'ĐVT', width: 70, render: (_, l) => l.unitName },
                      { title: 'Tồn', dataIndex: 'onHand', className: 'num', width: 70, render: (v) => qty(v) },
                      { title: 'Số lượng', width: 100, render: (_, l) => <QuantityInput size="small" min={0.001} value={l.quantity} onChange={(v) => setX(l.key, { quantity: toNum(v) })} /> },
                      { title: 'Đơn giá', width: 130, className: 'num', render: (_, l) => canSellPrice ? <MoneyInput size="small" value={l.unitPrice} onChange={(v) => setX(l.key, { unitPrice: toNum(v) })} /> : money(l.unitPrice) },
                      { title: 'Giảm giá', width: 110, render: (_, l) => <MoneyInput size="small" value={l.discount} onChange={(v) => setX(l.key, { discount: toNum(v) })} /> },
                      { title: 'Thành tiền', className: 'num', width: 120, render: (_, l) => <b>{money(Math.max(0, l.quantity * l.unitPrice - l.discount))}</b> },
                      { title: '', width: 40, render: (_, l) => <Button size="small" type="text" danger icon={<DeleteOutlined />} onClick={() => removeX(l.key)} /> },
                    ]} />
                )}
              </div>
              <div style={{ display: 'grid', gridTemplateColumns: isMobile ? '1fr' : '1fr 1fr', gap: 8, marginTop: 10 }}>
                <div><div className="kv-hint">Giảm giá hóa đơn mới</div><MoneyInput value={xDiscount} max={xTotals.subtotal} onChange={(v) => setXDiscount(toNum(v))} /></div>
                <div><div className="kv-hint">Ghi chú hóa đơn mới</div><Input value={xNote} onChange={(e) => setXNote(e.target.value)} placeholder={`Đổi hàng từ ${inv.code}`} /></div>
              </div>
              <div className="sr-settle" style={{ marginTop: 10 }}>
                <span className="k">Giá trị hàng trả</span><span className="v">{money(settle.R)}</span>
                <span className="k">Tiền hàng mới{xTotals.tax > 0 ? ` (${priceIncludesTax ? 'gồm' : 'cộng'} thuế ${money(xTotals.tax)})` : ''}</span><span className="v">{money(settle.N)}</span>
                <span className="k">Cấn trừ</span><span className="v">− {money(settle.offset)}</span>
                <span className="hr" />
                {settle.customerPays > 0 && <><span className="k">Khách cần trả thêm</span><span className="v big neg">{money(settle.customerPays)}</span></>}
                {settle.refundDue > 0 && <><span className="k">Hoàn lại khách</span><span className="v big pos">{money(settle.refundDue)}</span></>}
                {settle.customerPays <= 0 && settle.refundDue <= 0 && <><span className="k">Chênh lệch</span><span className="v big">0</span></>}
              </div>
              {settle.customerPays > 0 && (
                <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 8, marginTop: 10 }}>
                  <div><div className="kv-hint">Khách trả thêm</div><MoneyInput value={payNow} max={settle.customerPays} disabled={!hasCustomer} onChange={(v) => setPayAmount(Math.min(toNum(v), settle.customerPays))} /></div>
                  <div><div className="kv-hint">Phương thức</div><Select style={{ width: '100%' }} value={payMethod} onChange={setPayMethod} options={METHOD_OPTIONS} /></div>
                  <div className="kv-hint" style={{ gridColumn: '1 / span 2' }}>{hasCustomer ? (payNow + 0.01 < settle.customerPays ? <span>Phần còn lại <b className="neg">{money(settle.customerPays - payNow)}</b> ghi nợ cho khách.</span> : 'Khách thanh toán đủ phần chênh lệch.') : 'Khách lẻ phải trả đủ phần chênh lệch.'}</div>
                </div>
              )}
              {settle.refundDue > 0 && (
                <div style={{ marginTop: 10 }}>
                  {hasCustomer && <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: 8 }}><Switch checked={refCredit} onChange={setRefCredit} /><span><b>Ghi có công nợ, không hoàn tiền</b><div className="kv-hint">Khách giữ {money(settle.refundDue)} để dùng cho lần mua sau.</div></span></div>}
                  {!refCredit && (
                    <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 8 }}>
                      <div><div className="kv-hint">Hoàn lại khách</div><MoneyInput value={refundNow} max={settle.refundDue} disabled={!hasCustomer} onChange={(v) => setRefAmount(Math.min(toNum(v), settle.refundDue))} /></div>
                      <div><div className="kv-hint">Phương thức</div><Select style={{ width: '100%' }} value={refMethod} onChange={setRefMethod} options={METHOD_OPTIONS} /></div>
                      {hasCustomer && refundNow + 0.01 < settle.refundDue && <div className="kv-hint" style={{ gridColumn: '1 / span 2' }}>Phần còn lại <b>{money(settle.refundDue - refundNow)}</b> ghi có công nợ khách.</div>}
                      {!hasCustomer && <div className="kv-hint" style={{ gridColumn: '1 / span 2' }}>Khách lẻ phải được hoàn đúng phần chênh lệch.</div>}
                    </div>
                  )}
                </div>
              )}
            </Card>
          )}
        </div>

        <div className="kv-doc-side">
          <Card size="small" title="Thông tin phiếu trả">
            <div className="kv-kv" style={{ marginBottom: 10 }}>
              <span className="k">Hóa đơn</span><span className="v"><Link to={`/invoices?search=${inv.code}`}>{inv.code}</Link> · {money(inv.totalAmount)}{toNum(inv.returnedAmount) > 0 && <span className="muted"> · đã trả {money(inv.returnedAmount)}</span>}</span>
              <span className="k">Khách hàng</span><span className="v">{inv.customer ? `${inv.customer.name}${inv.customer.phone ? ` · ${inv.customer.phone}` : ''}` : 'Khách lẻ'}</span>
              <span className="k">Chi nhánh</span><span className="v">{me?.branches.find((b) => b.id === inv.branchId)?.name ?? '—'}</span>
            </div>
            <div className="sr-field"><div className="kv-hint">Ngày trả</div><DatePicker style={{ width: '100%' }} format="DD/MM/YYYY HH:mm" showTime value={returnDate} onChange={(v) => v && setReturnDate(v)} /></div>
            <div className="sr-field"><div className="kv-hint">Lý do trả</div><Input value={reason} onChange={(e) => setReason(e.target.value)} placeholder="Khách đổi ý, hàng lỗi, sai mẫu…" maxLength={200} /></div>
            <div className="sr-field"><div className="kv-hint">Phí trả hàng (trừ vào tiền hoàn)</div><MoneyInput value={fee} max={subtotal} onChange={(v) => setFee(toNum(v))} /></div>
            <div className="sr-field"><div className="kv-hint">Ghi chú</div><Input.TextArea rows={2} value={note} onChange={(e) => setNote(e.target.value)} maxLength={1000} /></div>
            <div className="sr-settle" style={{ margin: '10px 0' }}>
              <span className="k">Số dòng / SL trả</span><span className="v">{active.length} · {qty(active.reduce((s, l) => s + l.quantity, 0))}</span>
              <span className="k">Giá trị hàng trả</span><span className="v">{money(subtotal)}</span>
              {feeApplied > 0 && <><span className="k">Phí trả hàng</span><span className="v">− {money(feeApplied)}</span></>}
              <span className="k">Tiền hoàn khách</span><span className="v big">{money(totalRefund)}</span>
            </div>
            {totalRefund > maxRefund + 0.01 && <Alert type="error" showIcon style={{ marginBottom: 8 }} message={`Tiền hoàn vượt phần còn lại của hóa đơn (${money(maxRefund)})`} />}
            {hasCustomer ? <div className="kv-hint">Khách có hồ sơ: khi hoàn thành có thể hoàn tiền ngay, hoàn một phần hoặc ghi có công nợ.</div> : <div className="kv-hint">Khách lẻ: khi hoàn thành phải hoàn đủ tiền ngay (hoặc đổi hàng).</div>}
            <div className="sr-actions">
              {mode === 'return' ? (
                <>
                  {can('return.create') && <Button icon={<SaveOutlined />} loading={saving === 'draft'} onClick={saveDraft}>Lưu nháp</Button>}
                  {can('return.complete') && <Button type="primary" icon={<CheckOutlined />} loading={saving === 'complete'} onClick={openComplete}>Hoàn thành</Button>}
                  {canExchange && !existing && <Button icon={<SwapOutlined />} onClick={() => setMode('exchange')}>Đổi hàng</Button>}
                </>
              ) : (
                <>
                  <Button icon={<ArrowLeftOutlined />} onClick={() => setMode('return')}>Chỉ trả hàng</Button>
                  <Button type="primary" className="pos-pay-btn" icon={<SwapOutlined />} loading={saving === 'exchange'} disabled={!xLines.length || !active.length} onClick={submitExchange}>Hoàn tất đổi hàng</Button>
                </>
              )}
            </div>
            {!isMobile && <Button block type="text" style={{ marginTop: 8 }} onClick={() => nav('/sales-returns')}>Quay lại danh sách</Button>}
          </Card>
        </div>
      </div>
      <ReturnCompleteModal open={completing} total={totalRefund} code={existing?.code} hasCustomer={hasCustomer} customerName={inv.customer?.name} loading={saving === 'complete'} onClose={() => setCompleting(false)} onConfirm={complete} />
      <ShiftOpenModal open={openShift} branchId={inv.branchId} onClose={() => setOpenShift(false)} onOpened={() => qc.invalidateQueries({ queryKey: ['shift-current'] })} />
    </div>
  );
}

function ExchangeResultView({ res, onAgain }: { res: ExchangeResult; onAgain: () => void }) {
  const nav = useNavigate();
  const s = res.settlement;
  return (
    <div className="sr-editor">
      <div className="sr-result">
        <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: 10 }}><CheckCircleOutlined style={{ fontSize: 28, color: '#15803d' }} /><div><div style={{ fontSize: 18, fontWeight: 700 }}>Đổi hàng thành công</div><div className="kv-hint">Phiếu trả và hóa đơn mới đã được ghi nhận trong một giao dịch.</div></div></div>
        <div className="sr-settle">
          <span className="k">Phiếu trả hàng</span><span className="v"><Link to={`/sales-returns/${res.return.id}`}>{res.return.code}</Link></span>
          <span className="k">Hóa đơn mới</span><span className="v"><Link to={`/invoices?search=${res.invoice.code}`}>{res.invoice.code}</Link></span>
          <span className="hr" />
          <span className="k">Giá trị hàng trả</span><span className="v">{money(s.returnValue)}</span>
          <span className="k">Tiền hàng mới</span><span className="v">{money(s.newTotal)}</span>
          <span className="k">Cấn trừ</span><span className="v">− {money(s.offset)}</span>
          {toNum(s.customerPays) > 0 && <><span className="k">Khách trả thêm</span><span className="v big">{money(s.customerPays)}{toNum(res.invoice.dueAmount) > 0 && <span className="neg" style={{ fontWeight: 400, fontSize: 12 }}> · còn nợ {money(res.invoice.dueAmount)}</span>}</span></>}
          {toNum(s.refundDue) > 0 && <><span className="k">Hoàn lại khách</span><span className="v big">{money(s.refundDue)}{toNum(res.return.dueRefund) > 0 && <span className="muted" style={{ fontWeight: 400, fontSize: 12 }}> · ghi có công nợ {money(res.return.dueRefund)}</span>}</span></>}
        </div>
        <div className="sr-actions" style={{ position: 'static' }}>
          <Button type="primary" onClick={() => nav(`/sales-returns/${res.return.id}`)}>Xem phiếu trả</Button>
          <Button onClick={() => nav(`/invoices?search=${res.invoice.code}`)}>Xem hóa đơn mới</Button>
          <Button onClick={onAgain}>Trả hàng khác</Button>
        </div>
      </div>
    </div>
  );
}
