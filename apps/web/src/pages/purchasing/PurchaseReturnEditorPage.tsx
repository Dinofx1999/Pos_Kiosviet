import { Alert, App, Button, Card, Checkbox, DatePicker, Input, Modal, Select, Space, Tag } from 'antd';
import Table from '../../components/ResponsiveTable';
import { CheckOutlined, SaveOutlined } from '@ant-design/icons';
import dayjs, { Dayjs } from 'dayjs';
import { useEffect, useMemo, useState } from 'react';
import { useNavigate, useParams, useSearchParams } from 'react-router-dom';
import { useQueryClient } from '@tanstack/react-query';
import { ImmediatePayment, PURCHASING_KEYS, ReturnInput, purchasingApi, usePurchaseReceipt, usePurchaseReturn } from '../../api/purchasing';
import { errMsg } from '../../api/client';
import { MoneyInput, QuantityInput } from '../../components/Inputs';
import { useCan } from '../../store/auth';
import { PAYMENT_METHOD_LABEL, dt, money, qty, toNum } from '../../utils/format';

interface Line { receiptLineId: string; sku: string; name: string; unit: string; batchNo?: string; received: number; returnable: number; unitPrice: number; maxUnitPrice: number; quantity: number; note?: string }

/** "Hoàn thành phiếu trả hàng" confirmation with optional immediate refund (phiếu thu). */
export function RefundModal({ open, total, code, onClose, onConfirm, loading }: { open: boolean; total: number; code?: string; onClose: () => void; onConfirm: (refund?: ImmediatePayment) => Promise<void> | void; loading?: boolean }) {
  const can = useCan();
  const [refundNow, setRefundNow] = useState(false);
  const [amount, setAmount] = useState(0);
  const [method, setMethod] = useState('CASH');
  const [reference, setReference] = useState('');
  const [busy, setBusy] = useState(false);
  useEffect(() => { if (open) { setRefundNow(false); setAmount(total); setMethod('CASH'); setReference(''); } }, [open, total]);
  const ok = async () => { setBusy(true); try { await onConfirm(refundNow && amount > 0 ? { amount: String(amount), method, reference: reference || undefined } : undefined); } finally { setBusy(false); } };
  return (
    <Modal title={code ? `Hoàn thành phiếu trả hàng ${code}` : 'Hoàn thành phiếu trả hàng'} open={open} onCancel={onClose} onOk={ok} okText="Hoàn thành" cancelText="Bỏ qua" confirmLoading={busy || loading} destroyOnClose>
      <p>Hàng sẽ được xuất khỏi kho (theo giá vốn hiện tại) và công nợ nhà cung cấp giảm tương ứng.</p>
      <div className="kv-kv" style={{ marginBottom: 10 }}><span className="k">Giá trị trả hàng</span><span className="v"><b>{money(total)}</b></span></div>
      {can('payment.create') && (
        <div style={{ background: '#f8fafc', padding: 10, borderRadius: 6 }}>
          <Checkbox checked={refundNow} onChange={(e) => setRefundNow(e.target.checked)}><b>Nhà cung cấp hoàn tiền ngay</b> (lập phiếu thu)</Checkbox>
          {refundNow && (
            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 8, marginTop: 8 }}>
              <div><div className="kv-hint">Số tiền</div><MoneyInput value={amount} max={total} onChange={(v) => setAmount(Math.min(toNum(v), total))} /></div>
              <div><div className="kv-hint">Phương thức</div><Select style={{ width: '100%' }} value={method} onChange={setMethod} options={Object.entries(PAYMENT_METHOD_LABEL).map(([value, label]) => ({ value, label }))} /></div>
              <div style={{ gridColumn: '1 / span 2' }}><div className="kv-hint">Tham chiếu</div><Input value={reference} onChange={(e) => setReference(e.target.value)} /></div>
            </div>
          )}
          {!refundNow && <div className="kv-hint" style={{ marginTop: 6 }}>Không hoàn tiền ngay: giá trị trả hàng được trừ vào công nợ nhà cung cấp.</div>}
        </div>
      )}
    </Modal>
  );
}

export default function PurchaseReturnEditorPage() {
  const { id } = useParams();
  const [sp] = useSearchParams();
  const nav = useNavigate();
  const qc = useQueryClient();
  const { message } = App.useApp();
  const can = useCan();
  const { data: existing, isLoading: loadingReturn } = usePurchaseReturn(id);
  const receiptId = existing?.receiptId ?? sp.get('receiptId') ?? undefined;
  const { data: receipt, isLoading: loadingReceipt } = usePurchaseReceipt(receiptId);
  const [returnDate, setReturnDate] = useState<Dayjs>(dayjs());
  const [reason, setReason] = useState('');
  const [note, setNote] = useState('');
  const [lines, setLines] = useState<Line[]>([]);
  const [saving, setSaving] = useState<'draft' | 'post' | null>(null);
  const [posting, setPosting] = useState(false);

  useEffect(() => {
    if (!receipt) return;
    if (receipt.status !== 'POSTED') { message.warning('Chỉ trả hàng cho phiếu nhập đã hoàn thành'); nav('/purchase-receipts'); return; }
    const base: Line[] = (receipt.lines ?? []).map((l) => ({ receiptLineId: l.id, sku: l.variant.sku, name: l.variant.name, unit: l.variant.product.baseUnit ?? '', batchNo: l.batch?.batchNo, received: toNum(l.quantity), returnable: toNum(l.returnableQuantity ?? toNum(l.quantity) - toNum(l.returnedQuantity)), unitPrice: l.returnUnitPrice != null ? toNum(l.returnUnitPrice) : toNum(l.quantity) ? Math.round((toNum(l.lineTotal) / toNum(l.quantity)) * 10000) / 10000 : 0, maxUnitPrice: l.returnUnitPrice != null ? toNum(l.returnUnitPrice) : Number.MAX_SAFE_INTEGER, quantity: 0 }));
    if (existing) {
      if (existing.status !== 'DRAFT') { message.warning('Chỉ sửa được phiếu tạm'); nav('/purchase-returns'); return; }
      setReturnDate(dayjs(existing.returnDate)); setReason(existing.reason ?? ''); setNote(existing.note ?? '');
      for (const l of existing.lines ?? []) { const b = base.find((x) => x.receiptLineId === l.receiptLineId); if (b) { b.quantity = toNum(l.quantity); b.unitPrice = toNum(l.unitPrice); b.note = l.note ?? undefined; } }
    }
    setLines(base);
  }, [receipt, existing]);

  useEffect(() => {
    const h = (e: KeyboardEvent) => { if (e.key === 'F9') { e.preventDefault(); void save('draft'); } if (e.key === 'F10') { e.preventDefault(); openPost(); } };
    window.addEventListener('keydown', h); return () => window.removeEventListener('keydown', h);
  });

  const upd = (rl: string, patch: Partial<Line>) => setLines((p) => p.map((l) => (l.receiptLineId === rl ? { ...l, ...patch } : l)));
  const total = useMemo(() => lines.reduce((s, l) => s + l.quantity * l.unitPrice, 0), [lines]);
  const active = lines.filter((l) => l.quantity > 0);

  const buildPayload = (): ReturnInput | null => {
    if (!receiptId) return null;
    if (!active.length) { message.warning('Nhập số lượng trả cho ít nhất một dòng'); return null; }
    for (const l of active) if (l.quantity > l.returnable) { message.warning(`${l.sku}: vượt số lượng còn có thể trả (${qty(l.returnable)})`); return null; }
    return { receiptId, returnDate: returnDate.toISOString(), reason: reason || undefined, note: note || undefined, lines: active.map((l) => ({ receiptLineId: l.receiptLineId, quantity: String(l.quantity), unitPrice: String(l.unitPrice), note: l.note })) };
  };
  const openPost = () => { if (!can('purchase.return.post')) { message.warning('Bạn không có quyền hoàn thành phiếu'); return; } if (buildPayload()) setPosting(true); };
  const save = async (mode: 'draft' | 'post', refund?: ImmediatePayment) => {
    if (saving) return;
    const payload = buildPayload();
    if (!payload) return;
    setSaving(mode);
    try {
      let r;
      if (id && existing) { r = await purchasingApi.updateReturn(id, { ...payload, version: existing.version }); if (mode === 'post') r = await purchasingApi.postReturn(id, refund); }
      else r = mode === 'post' ? await purchasingApi.createAndPostReturn({ ...payload, refund }) : await purchasingApi.createReturn(payload);
      message.success(mode === 'post' ? `Đã hoàn thành phiếu trả hàng ${r.code}` : `Đã lưu phiếu tạm ${r.code}`);
      PURCHASING_KEYS.forEach((k) => qc.invalidateQueries({ queryKey: [k] }));
      setPosting(false);
      nav(`/purchase-returns?search=${r.code}`);
    } catch (e) { message.error(errMsg(e)); if ((e as any).code === 'VERSION_CONFLICT') qc.invalidateQueries({ queryKey: ['purchase-return', id] }); } finally { setSaving(null); }
  };

  if ((id && loadingReturn) || (receiptId && loadingReceipt)) return <div className="muted">Đang tải…</div>;
  if (!receiptId || !receipt) return <Alert type="warning" showIcon message="Chọn phiếu nhập hàng đã hoàn thành rồi bấm “Trả hàng nhập”." action={<Button onClick={() => nav('/purchase-receipts?status=POSTED')}>Danh sách phiếu nhập</Button>} />;

  return (
    <div>
      <div className="kv-editor-head">
        <h1 className="kv-page-title" style={{ margin: 0 }}>{id ? `Sửa phiếu trả hàng ${existing?.code ?? ''}` : 'Trả hàng nhập'}</h1>
        <Tag color="blue">Phiếu nhập {receipt.code} · {receipt.supplier?.name} · {dt(receipt.receiptDate)}</Tag>
        <span className="kv-hint"><span className="kv-kbd">F9</span>Lưu tạm <span className="kv-kbd">F10</span>Hoàn thành</span>
      </div>
      <div className="kv-doc-editor">
        <div className="kv-doc-lines">
          <Card size="small" styles={{ body: { padding: 0 } }}>
            <Table size="small" rowKey="receiptLineId" pagination={false} dataSource={lines} rowClassName={(l) => (l.quantity > l.returnable ? 'kv-line-error' : l.returnable <= 0 ? 'muted' : '')} scroll={{ x: 1000 }}
              columns={[
                { title: '#', width: 36, render: (_, __, i) => i + 1 },
                { title: 'Mã hàng', dataIndex: 'sku', width: 120 },
                { title: 'Tên hàng', dataIndex: 'name', render: (v, l) => <span>{v}{l.batchNo && <Tag style={{ marginLeft: 6 }} color="gold">Lô {l.batchNo}</Tag>}</span> },
                { title: 'ĐVT', dataIndex: 'unit', width: 60 },
                { title: 'SL nhập', dataIndex: 'received', className: 'num', width: 80, render: (v) => qty(v) },
                { title: 'Còn có thể trả', dataIndex: 'returnable', className: 'num', width: 110, render: (v) => <b>{qty(v)}</b> },
                { title: 'SL trả', width: 110, render: (_, l) => <QuantityInput size="small" min={0} max={l.returnable} disabled={l.returnable <= 0} value={l.quantity} onChange={(v) => upd(l.receiptLineId, { quantity: Math.min(toNum(v), l.returnable) })} /> },
                { title: 'Đơn giá trả', width: 150, render: (_, l) => <MoneyInput size="small" disabled={l.returnable <= 0} value={l.unitPrice} max={l.maxUnitPrice} onChange={(v) => upd(l.receiptLineId, { unitPrice: Math.min(toNum(v), l.maxUnitPrice) })} title={`Tối đa ${l.maxUnitPrice} (số tiền đã trả NCC cho mỗi đơn vị)`} /> },
                { title: 'Thành tiền', className: 'num', width: 120, render: (_, l) => money(l.quantity * l.unitPrice) },
                { title: 'Ghi chú', width: 130, render: (_, l) => <Input size="small" value={l.note} disabled={l.returnable <= 0} onChange={(e) => upd(l.receiptLineId, { note: e.target.value })} /> },
              ]} />
          </Card>
          <div className="kv-hint" style={{ marginTop: 6 }}>Đơn giá trả mặc định = số tiền đã trả NCC cho mỗi đơn vị (sau chiết khấu dòng và phiếu, gồm thuế) và là mức tối đa. Hàng được xuất kho theo giá vốn bình quân hiện tại.</div>
        </div>
        <div className="kv-doc-side">
          <Card size="small" title="Thông tin phiếu trả">
            <div className="kv-kv" style={{ marginBottom: 10 }}><span className="k">Nhà cung cấp</span><span className="v">{receipt.supplier?.name}</span><span className="k">Kho</span><span className="v">{receipt.warehouse?.name}</span></div>
            <div style={{ marginBottom: 8 }}><div className="kv-hint">Ngày trả</div><DatePicker style={{ width: '100%' }} format="DD/MM/YYYY" value={returnDate} onChange={(v) => v && setReturnDate(v)} /></div>
            <div style={{ marginBottom: 8 }}><div className="kv-hint">Lý do trả</div><Input value={reason} onChange={(e) => setReason(e.target.value)} placeholder="Hàng lỗi, giao sai, hết hạn…" /></div>
            <div style={{ marginBottom: 8 }}><div className="kv-hint">Ghi chú</div><Input.TextArea rows={2} value={note} onChange={(e) => setNote(e.target.value)} /></div>
            <div className="kv-kv" style={{ margin: '10px 0' }}>
              <span className="k">Số dòng trả</span><span className="v">{active.length}</span>
              <span className="k">Tổng SL trả</span><span className="v">{qty(active.reduce((s, l) => s + l.quantity, 0))}</span>
              <span className="k"><b>Giá trị trả</b></span><span className="v"><b>{money(total)}</b></span>
            </div>
            <Space direction="vertical" className="kv-doc-actions" style={{ width: '100%' }}>
              <Button block icon={<SaveOutlined />} loading={saving === 'draft'} onClick={() => save('draft')}>Lưu tạm (F9)</Button>
              {can('purchase.return.post') && <Button block type="primary" icon={<CheckOutlined />} loading={saving === 'post'} onClick={openPost}>Hoàn thành (F10)</Button>}
              <Button block type="text" onClick={() => nav('/purchase-returns')}>Quay lại danh sách</Button>
            </Space>
          </Card>
        </div>
      </div>
      <RefundModal open={posting} total={total} code={existing?.code} loading={saving === 'post'} onClose={() => setPosting(false)} onConfirm={(refund) => save('post', refund)} />
    </div>
  );
}
