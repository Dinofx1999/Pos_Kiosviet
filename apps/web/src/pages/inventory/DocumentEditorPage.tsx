import { Alert, App, Button, Card, Input, Modal, Select, Space, Table, Tag, DatePicker } from 'antd';
import { CheckOutlined, DeleteOutlined, MinusOutlined, PlusOutlined, SaveOutlined } from '@ant-design/icons';
import { useEffect, useMemo, useRef, useState } from 'react';
import { useNavigate, useParams, useSearchParams } from 'react-router-dom';
import { useQueryClient } from '@tanstack/react-query';
import { catalogApi } from '../../api/catalog';
import { DocInput, inventoryApi, useDocument } from '../../api/inventory';
import { errMsg } from '../../api/client';
import type { Batch, SearchHit } from '../../api/types';
import { MoneyInput, QuantityInput } from '../../components/Inputs';
import { ProductSearch, ProductSearchHandle } from '../../components/ProductSearch';
import { useIsMobile } from '../../hooks/useMedia';
import { useAuthStore, useBranchWarehouses, useCan } from '../../store/auth';
import { DOC_TYPE_LABEL, money, qty, toNum } from '../../utils/format';

type DocType = 'RECEIPT' | 'ISSUE' | 'ADJUSTMENT';
interface Line { key: string; variantId: string; sku: string; name: string; unit: string; trackBatch: boolean; onHand: number; quantity: number; actualQuantity?: number; unitCost: number; batchId?: string; batches?: Batch[]; note?: string; error?: string }

const REASONS: Record<DocType, { value: string; label: string }[]> = {
  RECEIPT: [{ value: 'OTHER', label: 'Nhập khác' }, { value: 'OPENING', label: 'Tồn đầu kỳ' }, { value: 'RETURN_TO_STOCK', label: 'Nhập lại kho' }],
  ISSUE: [{ value: 'DAMAGE', label: 'Xuất hủy (hàng hỏng, hết hạn)' }, { value: 'INTERNAL_USE', label: 'Sử dụng nội bộ' }, { value: 'LOSS', label: 'Thất thoát' }, { value: 'OTHER', label: 'Khác' }],
  ADJUSTMENT: [{ value: 'COUNT', label: 'Kiểm đếm thực tế' }, { value: 'OTHER', label: 'Khác' }],
};

export default function DocumentEditorPage() {
  const { id } = useParams();
  const [sp] = useSearchParams();
  const nav = useNavigate();
  const qc = useQueryClient();
  const { message } = App.useApp();
  const can = useCan();
  const branchId = useAuthStore((s) => s.currentBranchId);
  const me = useAuthStore((s) => s.me);
  const warehouses = useBranchWarehouses();
  const { data: existing, isLoading } = useDocument(id);
  const [type, setType] = useState<DocType>(((sp.get('type') as DocType) ?? 'RECEIPT'));
  const [warehouseId, setWarehouseId] = useState<string | undefined>();
  const [reason, setReason] = useState<string>();
  const [note, setNote] = useState('');
  const [lines, setLines] = useState<Line[]>([]);
  const [saving, setSaving] = useState<'draft' | 'post' | null>(null);
  const [batchModal, setBatchModal] = useState<{ lineKey: string; variantId: string; batchNo: string; expiryDate?: string } | null>(null);
  const searchRef = useRef<ProductSearchHandle>(null);
  const batchInputRef = useRef<any>(null);
  const canSeeCost = can('inventory.cost.view') || can('product.cost.view');
  const isMobile = useIsMobile();

  useEffect(() => { if (!warehouseId && warehouses.length) setWarehouseId(warehouses.find((w) => w.isDefault)?.id ?? warehouses[0].id); }, [warehouses, warehouseId]);
  useEffect(() => { if (!reason) setReason(REASONS[type][0].value); }, [type, reason]);

  // load existing draft
  useEffect(() => {
    if (!existing) return;
    if (existing.status !== 'DRAFT') { message.warning('Chỉ sửa được phiếu tạm'); nav('/inventory/documents'); return; }
    setType(existing.type); setWarehouseId(existing.warehouseId); setReason(existing.reason ?? undefined); setNote(existing.note ?? '');
    (async () => {
      const ls: Line[] = [];
      for (const l of existing.lines ?? []) {
        let onHand = 0;
        try { const hits = await catalogApi.search(l.variant.sku, existing.warehouseId); onHand = toNum(hits.find((h) => h.id === l.variantId)?.onHand); } catch { /* ignore */ }
        ls.push({ key: l.id, variantId: l.variantId, sku: l.variant.sku, name: l.variant.name, unit: l.variant.product.baseUnit ?? '', trackBatch: l.variant.product.trackBatch, onHand, quantity: Math.abs(toNum(l.quantity)), actualQuantity: l.actualQuantity !== null && l.actualQuantity !== undefined ? toNum(l.actualQuantity) : undefined, unitCost: toNum(l.unitCost), batchId: l.batchId ?? undefined, note: l.note ?? undefined, batches: l.variant.product.trackBatch ? await catalogApi.batches(l.variantId).catch(() => []) : undefined });
      }
      setLines(ls);
    })();
  }, [existing]);

  // keyboard shortcuts
  useEffect(() => {
    const h = (e: KeyboardEvent) => {
      if (e.key === 'F3') { e.preventDefault(); searchRef.current?.focus(); }
      if (e.key === 'F9') { e.preventDefault(); void save('draft'); }
      if (e.key === 'F10') { e.preventDefault(); void save('post'); }
    };
    window.addEventListener('keydown', h);
    return () => window.removeEventListener('keydown', h);
  });

  const addHit = async (h: SearchHit) => {
    if (h.product.type !== 'GOODS') { message.warning('Chỉ hàng hóa mới nhập/xuất kho được'); return; }
    const factor = h.unit ? toNum(h.unit.conversionFactor) : 1;
    setLines((prev) => {
      const idx = prev.findIndex((l) => l.variantId === h.id && !l.trackBatch);
      if (idx >= 0 && type !== 'ADJUSTMENT') return prev.map((l, i) => (i === idx ? { ...l, quantity: l.quantity + factor } : l));
      return [...prev, { key: `${h.id}-${Date.now()}`, variantId: h.id, sku: h.sku, name: h.name, unit: h.product.baseUnit ?? '', trackBatch: h.product.trackBatch, onHand: toNum(h.onHand ?? h.onHandTotal), quantity: factor, actualQuantity: type === 'ADJUSTMENT' ? toNum(h.onHand ?? h.onHandTotal) : undefined, unitCost: toNum(h.costPrice ?? 0) }];
    });
    if (h.product.trackBatch) { const batches = await catalogApi.batches(h.id).catch(() => []); setLines((prev) => prev.map((l) => (l.variantId === h.id && !l.batches ? { ...l, batches } : l))); }
  };
  const upd = (key: string, patch: Partial<Line>) => setLines((prev) => prev.map((l) => (l.key === key ? { ...l, ...patch, error: undefined } : l)));

  const totals = useMemo(() => lines.reduce((s, l) => { const q = type === 'ADJUSTMENT' ? Math.abs((l.actualQuantity ?? 0) - l.onHand) : l.quantity; return { qty: s.qty + q, cost: s.cost + q * (type === 'RECEIPT' ? l.unitCost : l.unitCost) }; }, { qty: 0, cost: 0 }), [lines, type]);

  const buildPayload = (): DocInput | null => {
    if (!branchId || !warehouseId) { message.warning('Chọn chi nhánh và kho'); return null; }
    if (lines.length === 0) { message.warning('Thêm ít nhất một dòng hàng'); return null; }
    for (const l of lines) {
      if (l.trackBatch && !l.batchId) { upd(l.key, { error: 'Chọn lô' }); message.warning(`Chọn lô cho ${l.sku}`); return null; }
      if (type !== 'ADJUSTMENT' && !(l.quantity > 0)) { upd(l.key, { error: 'Số lượng > 0' }); message.warning(`Số lượng của ${l.sku} phải lớn hơn 0`); return null; }
    }
    return {
      type, branchId, warehouseId, reason, note: note || undefined,
      lines: lines.map((l) => ({ variantId: l.variantId, batchId: l.batchId, quantity: type === 'ADJUSTMENT' ? undefined : String(l.quantity), actualQuantity: type === 'ADJUSTMENT' ? String(l.actualQuantity ?? 0) : undefined, unitCost: type === 'RECEIPT' ? String(l.unitCost ?? 0) : undefined, note: l.note })),
    };
  };

  const save = async (mode: 'draft' | 'post') => {
    if (saving) return;
    if (mode === 'post' && !can('inventory.document.post')) { message.warning('Bạn không có quyền ghi sổ'); return; }
    const payload = buildPayload();
    if (!payload) return;
    setSaving(mode);
    try {
      let doc;
      if (id && existing) {
        doc = await inventoryApi.updateDraft(id, { ...payload, version: existing.version });
        if (mode === 'post') doc = await inventoryApi.post(id);
      } else {
        doc = mode === 'post' ? await inventoryApi.createAndPost(payload) : await inventoryApi.createDraft(payload);
      }
      message.success(mode === 'post' ? `Đã ghi sổ phiếu ${doc.code}` : `Đã lưu phiếu tạm ${doc.code}`);
      ['documents', 'document', 'balances', 'balance-summary', 'movements', 'products', 'product', 'dashboard'].forEach((k) => qc.invalidateQueries({ queryKey: [k] }));
      nav(`/inventory/documents?search=${doc.code}`);
    } catch (e) {
      const err = e as { code?: string; message: string; details?: any };
      if (err.code === 'INSUFFICIENT_STOCK' && err.details?.variantId) {
        setLines((prev) => prev.map((l) => (l.variantId === err.details.variantId ? { ...l, error: `Không đủ tồn (tồn ${qty(err.details.onHand ?? err.details.available)}, yêu cầu ${qty(err.details.requested)})` } : l)));
      }
      if (err.code === 'VERSION_CONFLICT') qc.invalidateQueries({ queryKey: ['document', id] });
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
        <h1 className="kv-page-title" style={{ margin: 0 }}>{id ? `Sửa phiếu ${existing?.code ?? ''}` : `Tạo phiếu ${DOC_TYPE_LABEL[type].toLowerCase()}`}</h1>
        {!id && <Select value={type} onChange={(t) => { setType(t); setReason(REASONS[t][0].value); setLines((ls) => ls.map((l) => ({ ...l, actualQuantity: t === 'ADJUSTMENT' ? l.onHand : undefined }))); }} options={(['RECEIPT', 'ISSUE', 'ADJUSTMENT'] as DocType[]).map((t) => ({ value: t, label: DOC_TYPE_LABEL[t] }))} style={{ width: 160 }} />}
        <span className="kv-hint"><span className="kv-kbd">F3</span>Tìm hàng <span className="kv-kbd">F9</span>Lưu tạm <span className="kv-kbd">F10</span>Hoàn thành</span>
      </div>
      <div className="kv-doc-editor">
        <div className="kv-doc-lines">
          <Card size="small" style={{ marginBottom: 10 }}><ProductSearch ref={searchRef} autoFocus goodsOnly warehouseId={warehouseId} onPick={addHit} /></Card>
          <Card size="small" styles={{ body: { padding: 0 } }}>
            {isMobile ? (
              <div className="kv-mlines">
                {!lines.length && <div className="muted" style={{ padding: 8 }}>Chưa có hàng hóa. Tìm hoặc quét mã vạch để thêm.</div>}
                {lines.map((l, i) => {
                  const diff = (l.actualQuantity ?? 0) - l.onHand;
                  const amount = (type === 'ADJUSTMENT' ? Math.abs(diff) : l.quantity) * l.unitCost;
                  const batchRow = l.trackBatch ? (
                    <div className="row"><span className="lbl">Lô</span>
                      <Space.Compact style={{ flex: 1 }}><Select style={{ flex: 1 }} placeholder="Chọn lô" value={l.batchId} onChange={(v) => upd(l.key, { batchId: v })} options={(l.batches ?? []).map((b) => ({ value: b.id, label: `${b.batchNo}${b.expiryDate ? ` (HSD ${b.expiryDate.slice(0, 10)})` : ''}` }))} /><Button icon={<PlusOutlined />} onClick={() => setBatchModal({ lineKey: l.key, variantId: l.variantId, batchNo: '' })} /></Space.Compact>
                    </div>
                  ) : null;
                  return (
                    <div key={l.key} className={`kv-mline${l.error ? ' error' : ''}`}>
                      <div className="nm">{i + 1}. {l.name}</div>
                      <DeleteOutlined className="del" onClick={() => setLines((p) => p.filter((x) => x.key !== l.key))} />
                      <div className="meta">{l.sku} · {l.unit} · Tồn hiện tại: {qty(l.onHand)}</div>
                      {batchRow}
                      {type === 'ADJUSTMENT' ? (
                        <div className="row"><span className="lbl">Thực tế</span>
                          <div className="kv-qty"><Button icon={<MinusOutlined />} onClick={() => upd(l.key, { actualQuantity: Math.max(0, (l.actualQuantity ?? 0) - 1) })} /><QuantityInput min={0} inputMode="decimal" value={l.actualQuantity} onChange={(v) => upd(l.key, { actualQuantity: toNum(v) })} /><Button icon={<PlusOutlined />} onClick={() => upd(l.key, { actualQuantity: (l.actualQuantity ?? 0) + 1 })} /></div>
                          <b className={diff > 0 ? 'pos' : diff < 0 ? 'neg' : ''}>{diff > 0 ? '+' : ''}{qty(diff)}</b>
                        </div>
                      ) : (
                        <div className="row"><span className="lbl">Số lượng</span>
                          <div className="kv-qty"><Button icon={<MinusOutlined />} onClick={() => upd(l.key, { quantity: Math.max(0, l.quantity - 1) })} /><QuantityInput min={0} inputMode="decimal" value={l.quantity} onChange={(v) => upd(l.key, { quantity: toNum(v) })} /><Button icon={<PlusOutlined />} onClick={() => upd(l.key, { quantity: l.quantity + 1 })} /></div>
                        </div>
                      )}
                      {type === 'RECEIPT' && <div className="row"><span className="lbl">Đơn giá nhập</span><MoneyInput inputMode="decimal" value={l.unitCost} onChange={(v) => upd(l.key, { unitCost: toNum(v) })} /></div>}
                      {type !== 'RECEIPT' && canSeeCost && <div className="row"><span className="lbl">Giá vốn</span><span>{money(l.unitCost)}</span></div>}
                      {(canSeeCost || type === 'RECEIPT') && <div className="row"><span className="lbl">Thành tiền</span><b className="tot">{money(amount)}</b></div>}
                      <div className="row"><span className="lbl">Ghi chú</span><Input placeholder="Ghi chú dòng" value={l.note} onChange={(e) => upd(l.key, { note: e.target.value })} /></div>
                      {l.error && <div className="err">{l.error}</div>}
                    </div>
                  );
                })}
              </div>
            ) : (
              <Table size="small" rowKey="key" pagination={false} dataSource={lines} locale={{ emptyText: 'Chưa có hàng hóa. Tìm hoặc quét mã vạch để thêm.' }} rowClassName={(l) => (l.error ? 'kv-line-error' : '')} scroll={{ x: 1150 }}
              columns={[
                { title: '#', width: 36, render: (_, __, i) => i + 1 },
                { title: 'Mã hàng', dataIndex: 'sku', width: 120 },
                { title: 'Tên hàng', dataIndex: 'name', width: 260, render: (v, l) => <span>{v}{l.error && <div className="neg" style={{ fontSize: 12 }}>{l.error}</div>}</span> },
                { title: 'ĐVT', dataIndex: 'unit', width: 60 },
                { title: 'Lô', width: 150, render: (_, l) => l.trackBatch ? <Space.Compact style={{ width: '100%' }}><Select size="small" style={{ flex: 1 }} placeholder="Chọn lô" value={l.batchId} onChange={(v) => upd(l.key, { batchId: v })} options={(l.batches ?? []).map((b) => ({ value: b.id, label: `${b.batchNo}${b.expiryDate ? ` (HSD ${b.expiryDate.slice(0, 10)})` : ''}` }))} /><Button size="small" icon={<PlusOutlined />} onClick={() => setBatchModal({ lineKey: l.key, variantId: l.variantId, batchNo: '' })} /></Space.Compact> : <span className="muted">—</span> },
                { title: 'Tồn hiện tại', dataIndex: 'onHand', className: 'num', width: 90, render: (v) => qty(v) },
                ...(type === 'ADJUSTMENT'
                  ? [{ title: 'Thực tế', width: 110, render: (_: unknown, l: Line) => <QuantityInput size="small" min={0} value={l.actualQuantity} onChange={(v) => upd(l.key, { actualQuantity: toNum(v) })} /> },
                    { title: 'Chênh lệch', className: 'num', width: 90, render: (_: unknown, l: Line) => { const d = (l.actualQuantity ?? 0) - l.onHand; return <b className={d > 0 ? 'pos' : d < 0 ? 'neg' : ''}>{d > 0 ? '+' : ''}{qty(d)}</b>; } }]
                  : [{ title: 'Số lượng', width: 110, render: (_: unknown, l: Line) => <QuantityInput size="small" min={0} value={l.quantity} onChange={(v) => upd(l.key, { quantity: toNum(v) })} /> }]),
                ...(type === 'RECEIPT' ? [{ title: 'Đơn giá nhập', width: 130, render: (_: unknown, l: Line) => <MoneyInput size="small" value={l.unitCost} onChange={(v) => upd(l.key, { unitCost: toNum(v) })} /> }] : canSeeCost ? [{ title: 'Giá vốn', className: 'num', width: 110, render: (_: unknown, l: Line) => money(l.unitCost) }] : []),
                ...(canSeeCost || type === 'RECEIPT' ? [{ title: 'Thành tiền', className: 'num', width: 120, render: (_: unknown, l: Line) => money((type === 'ADJUSTMENT' ? Math.abs((l.actualQuantity ?? 0) - l.onHand) : l.quantity) * l.unitCost) }] : []),
                { title: 'Ghi chú', width: 130, render: (_, l) => <Input size="small" value={l.note} onChange={(e) => upd(l.key, { note: e.target.value })} /> },
                { title: '', width: 40, render: (_, l) => <Button size="small" type="text" danger icon={<DeleteOutlined />} onClick={() => setLines((p) => p.filter((x) => x.key !== l.key))} /> },
              ]} />
            )}
          </Card>
        </div>
        <div className="kv-doc-side">
          <Card size="small" title="Thông tin phiếu">
            <div className="kv-kv" style={{ marginBottom: 10 }}>
              <span className="k">Chi nhánh</span><span className="v">{branch?.name ?? <span className="neg">Chưa chọn</span>}</span>
              <span className="k">Người tạo</span><span className="v">{me?.user.fullName}</span>
            </div>
            <div style={{ marginBottom: 8 }}><div className="kv-hint">Kho</div><Select style={{ width: '100%' }} value={warehouseId} onChange={setWarehouseId} options={warehouses.map((w) => ({ value: w.id, label: w.name }))} disabled={!!id} /></div>
            <div style={{ marginBottom: 8 }}><div className="kv-hint">Lý do</div><Select style={{ width: '100%' }} value={reason} onChange={setReason} options={REASONS[type]} /></div>
            <div style={{ marginBottom: 8 }}><div className="kv-hint">Ghi chú</div><Input.TextArea rows={3} value={note} onChange={(e) => setNote(e.target.value)} placeholder="Ghi chú phiếu" /></div>
            <div className="kv-kv" style={{ margin: '10px 0' }}>
              <span className="k">Số dòng</span><span className="v">{lines.length}</span>
              <span className="k">Tổng số lượng</span><span className="v">{qty(totals.qty)}</span>
              {(canSeeCost || type === 'RECEIPT') && <><span className="k">Tổng giá trị</span><span className="v">{money(totals.cost)}</span></>}
            </div>
            {type === 'ADJUSTMENT' && <Alert type="info" showIcon style={{ marginBottom: 8 }} message="Chênh lệch được tính lại theo tồn thực tế tại thời điểm ghi sổ." />}
            {type === 'ISSUE' && <Alert type="warning" showIcon style={{ marginBottom: 8 }} message="Phiếu xuất sẽ bị từ chối nếu làm âm kho (trừ khi cấu hình cho phép)." />}
            <Space direction="vertical" className="kv-doc-actions" style={{ width: '100%' }}>
              <Button block icon={<SaveOutlined />} loading={saving === 'draft'} onClick={() => save('draft')}>Lưu tạm (F9)</Button>
              {can('inventory.document.post') && <Button block type="primary" icon={<CheckOutlined />} loading={saving === 'post'} onClick={() => save('post')}>Hoàn thành – ghi sổ (F10)</Button>}
              <Button block type="text" onClick={() => nav('/inventory/documents')}>Quay lại danh sách</Button>
            </Space>
            <div style={{ marginTop: 8 }}>{lines.some((l) => l.trackBatch) && <Tag color="gold">Có hàng theo lô</Tag>}</div>
          </Card>
        </div>
      </div>
      <Modal title="Thêm lô mới" open={!!batchModal} onCancel={() => setBatchModal(null)} onOk={createBatch} okText="Thêm" cancelText="Hủy" destroyOnClose afterOpenChange={(o) => { if (o) setTimeout(() => batchInputRef.current?.focus?.(), 50); }}>
        <div className="kv-hint">Số lô</div><Input ref={batchInputRef} autoFocus value={batchModal?.batchNo} onChange={(e) => setBatchModal((m) => m && { ...m, batchNo: e.target.value })} onPressEnter={createBatch} style={{ marginBottom: 8 }} />
        <div className="kv-hint">Hạn sử dụng</div><DatePicker style={{ width: '100%' }} format="DD/MM/YYYY" onChange={(d) => setBatchModal((m) => m && { ...m, expiryDate: d ? d.format('YYYY-MM-DD') : undefined })} />
      </Modal>
    </div>
  );
}
