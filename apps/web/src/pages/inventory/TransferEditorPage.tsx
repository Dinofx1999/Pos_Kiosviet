import './transfers.css';
import { Alert, App, Button, Card, DatePicker, Input, Modal, Radio, Select, Space, Tag } from 'antd';
import Table from '../../components/ResponsiveTable';
import { ArrowLeftOutlined, ArrowRightOutlined, CheckOutlined, DeleteOutlined, InboxOutlined, MinusOutlined, PlusOutlined, SaveOutlined, SendOutlined, StopOutlined } from '@ant-design/icons';
import { ReactNode, useEffect, useMemo, useRef, useState } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import { useQueryClient } from '@tanstack/react-query';
import { catalogApi } from '../../api/catalog';
import { useWarehouses } from '../../api/org';
import { SHORTAGE_ACTION_LABEL, ShortageAction, TRANSFER_KEYS, TRANSFER_STATUS_COLOR, TRANSFER_STATUS_LABEL, Transfer, TransferInput, transfersApi, useTransfer } from '../../api/transfers';
import { errMsg } from '../../api/client';
import type { Batch, SearchHit } from '../../api/types';
import { QuantityInput } from '../../components/Inputs';
import { ProductSearch, ProductSearchHandle } from '../../components/ProductSearch';
import { useIsMobile } from '../../hooks/useMedia';
import { useAuthStore, useBranchWarehouses, useCan } from '../../store/auth';
import { dt, money, qty, toNum } from '../../utils/format';
import { TransferDetail, TransferRoute, useInBranch, useTransferActions } from './TransfersPage';

interface Line { key: string; variantId: string; sku: string; name: string; unit: string; trackBatch: boolean; onHand: number; quantity: number; unitCost: number; batchId?: string; batches?: Batch[]; note?: string; error?: string }

export default function TransferEditorPage() {
  const { id } = useParams();
  const nav = useNavigate();
  const can = useCan();
  const inBranch = useInBranch();
  const { data: existing, isLoading, error } = useTransfer(id);
  if (id && isLoading) return <div className="muted">Đang tải phiếu…</div>;
  if (id && !existing) return <Alert type="error" showIcon message={error ? errMsg(error) : 'Không tìm thấy phiếu chuyển kho'} action={<Button onClick={() => nav('/transfers')}>Về danh sách</Button>} />;
  if (!existing) return <TransferForm />;
  if (existing.status === 'DRAFT' && can('transfer.create') && inBranch(existing.fromBranchId)) return <TransferForm existing={existing} />;
  if (existing.status === 'IN_TRANSIT' && can('transfer.receive') && inBranch(existing.toBranchId)) return <ReceiveForm t={existing} />;
  return <TransferView t={existing} />;
}

// ====================================================================== create / edit draft
function TransferForm({ existing }: { existing?: Transfer }) {
  const nav = useNavigate();
  const qc = useQueryClient();
  const { message } = App.useApp();
  const can = useCan();
  const me = useAuthStore((s) => s.me);
  const branchId = useAuthStore((s) => s.currentBranchId);
  const myWarehouses = useBranchWarehouses();
  const { data: allWarehouses } = useWarehouses();
  const isMobile = useIsMobile();
  const actions = useTransferActions();
  const canSeeCost = can('inventory.cost.view') || can('product.cost.view');
  const [fromId, setFromId] = useState<string | undefined>(existing?.fromWarehouseId);
  const [toId, setToId] = useState<string | undefined>(existing?.toWarehouseId);
  const [note, setNote] = useState(existing?.note ?? '');
  const [lines, setLines] = useState<Line[]>([]);
  const [saving, setSaving] = useState<'draft' | 'dispatch' | null>(null);
  const [batchModal, setBatchModal] = useState<{ lineKey: string; variantId: string; batchNo: string; expiryDate?: string } | null>(null);
  const searchRef = useRef<ProductSearchHandle>(null);
  const batchInputRef = useRef<any>(null);
  const loadedRef = useRef<string | null>(null);

  useEffect(() => { if (!existing && !fromId && myWarehouses.length) setFromId(myWarehouses.find((w) => w.isDefault)?.id ?? myWarehouses[0].id); }, [myWarehouses, fromId, existing]);

  // load the draft once (refetches must not wipe local edits)
  useEffect(() => {
    if (!existing || loadedRef.current === existing.id) return;
    loadedRef.current = existing.id;
    (async () => {
      const ls: Line[] = [];
      for (const l of existing.lines) {
        let onHand = 0;
        try { const hits = await catalogApi.search(l.variant.sku, existing.fromWarehouseId); onHand = toNum(hits.find((h) => h.id === l.variantId)?.onHand); } catch { /* ignore */ }
        ls.push({ key: l.id, variantId: l.variantId, sku: l.variant.sku, name: l.variant.name, unit: l.variant.product.baseUnit ?? '', trackBatch: l.variant.product.trackBatch, onHand, quantity: toNum(l.quantity), unitCost: toNum(l.unitCost ?? l.variant.costPrice ?? 0), batchId: l.batchId ?? undefined, note: l.note ?? undefined, batches: l.variant.product.trackBatch ? await catalogApi.batches(l.variantId).catch(() => []) : undefined });
      }
      setLines(ls);
    })();
  }, [existing]);

  // source changed → on-hand of every line is re-read at the new source
  const prevFrom = useRef(fromId);
  useEffect(() => {
    if (prevFrom.current === fromId) return;
    prevFrom.current = fromId;
    if (!fromId || !lines.length) return;
    (async () => {
      const updates = new Map<string, number>();
      for (const l of lines) { try { const hits = await catalogApi.search(l.sku, fromId); updates.set(l.variantId, toNum(hits.find((h) => h.id === l.variantId)?.onHand)); } catch { /* ignore */ } }
      setLines((prev) => prev.map((l) => (updates.has(l.variantId) ? { ...l, onHand: updates.get(l.variantId)! } : l)));
    })();
  }, [fromId, lines]);

  useEffect(() => {
    const h = (e: KeyboardEvent) => {
      if (e.key === 'F3') { e.preventDefault(); searchRef.current?.focus(); }
      if (e.key === 'F9') { e.preventDefault(); void save('draft'); }
      if (e.key === 'F10') { e.preventDefault(); void save('dispatch'); }
    };
    window.addEventListener('keydown', h);
    return () => window.removeEventListener('keydown', h);
  });

  const toOptions = useMemo(() => {
    const list = (allWarehouses ?? []).filter((w) => w.isActive && w.id !== fromId);
    const groups = new Map<string, { label: string; options: { value: string; label: ReactNode }[] }>();
    for (const w of list) {
      const g = groups.get(w.branchId) ?? { label: w.branch?.name ?? w.branchName ?? 'Chi nhánh khác', options: [] };
      g.options.push({ value: w.id, label: w.name });
      groups.set(w.branchId, g);
    }
    return [...groups.entries()].sort((a, b) => (a[0] === branchId ? -1 : b[0] === branchId ? 1 : 0)).map(([key, g]) => ({ key, label: g.label, options: g.options }));
  }, [allWarehouses, fromId, branchId]);
  const toWarehouse = (allWarehouses ?? []).find((w) => w.id === toId);
  const batchOnHand = (b: Batch) => toNum(b.balances?.find((x) => x.warehouseId === fromId)?.onHand);
  const batchLabel = (b: Batch) => `${b.batchNo}${b.expiryDate ? ` (HSD ${b.expiryDate.slice(0, 10)})` : ''} · tồn ${qty(batchOnHand(b))}`;

  const addHit = async (h: SearchHit) => {
    if (h.product.type !== 'GOODS') { message.warning('Chỉ chuyển kho được hàng hóa'); return; }
    const factor = h.unit ? toNum(h.unit.conversionFactor) : 1;
    setLines((prev) => {
      const idx = prev.findIndex((l) => l.variantId === h.id && !l.trackBatch);
      if (idx >= 0) return prev.map((l, i) => (i === idx ? { ...l, quantity: l.quantity + factor, error: undefined } : l));
      return [...prev, { key: `${h.id}-${Date.now()}`, variantId: h.id, sku: h.sku, name: h.name, unit: h.product.baseUnit ?? '', trackBatch: h.product.trackBatch, onHand: toNum(h.onHand ?? h.onHandTotal), quantity: factor, unitCost: toNum(h.costPrice ?? 0) }];
    });
    if (h.product.trackBatch) { const batches = await catalogApi.batches(h.id).catch(() => []); setLines((prev) => prev.map((l) => (l.variantId === h.id && !l.batches ? { ...l, batches } : l))); }
  };
  const upd = (key: string, patch: Partial<Line>) => setLines((prev) => prev.map((l) => (l.key === key ? { ...l, ...patch, error: undefined } : l)));
  const lineOnHand = (l: Line) => (l.trackBatch && l.batchId ? batchOnHand(l.batches?.find((b) => b.id === l.batchId) ?? ({} as Batch)) : l.onHand);
  const over = (l: Line) => l.quantity > lineOnHand(l);

  const totals = useMemo(() => lines.reduce((s, l) => ({ qty: s.qty + l.quantity, cost: s.cost + l.quantity * l.unitCost, over: s.over + (over(l) ? 1 : 0) }), { qty: 0, cost: 0, over: 0 }), [lines, fromId]);

  const buildPayload = (): TransferInput | null => {
    if (!fromId) { message.warning('Chọn kho gửi'); return null; }
    if (!toId) { message.warning('Chọn kho nhận'); return null; }
    if (fromId === toId) { message.warning('Kho nhận phải khác kho gửi'); return null; }
    if (!lines.length) { message.warning('Thêm ít nhất một dòng hàng'); return null; }
    for (const l of lines) {
      if (l.trackBatch && !l.batchId) { upd(l.key, { error: 'Chọn lô' }); message.warning(`Chọn lô cho ${l.sku}`); return null; }
      if (!(l.quantity > 0)) { upd(l.key, { error: 'Số lượng > 0' }); message.warning(`Số lượng của ${l.sku} phải lớn hơn 0`); return null; }
    }
    return { fromWarehouseId: fromId, toWarehouseId: toId, note: note.trim() || undefined, lines: lines.map((l) => ({ variantId: l.variantId, batchId: l.batchId, quantity: String(l.quantity), note: l.note?.trim() || undefined })) };
  };

  const save = async (mode: 'draft' | 'dispatch') => {
    if (saving) return;
    if (mode === 'dispatch' && !can('transfer.dispatch')) { message.warning('Bạn không có quyền xuất chuyển kho'); return; }
    const payload = buildPayload();
    if (!payload) return;
    setSaving(mode);
    try {
      let r: Transfer;
      if (existing) {
        r = await transfersApi.update(existing.id, { version: existing.version, toWarehouseId: payload.toWarehouseId, note: payload.note, lines: payload.lines });
        if (mode === 'dispatch') r = await transfersApi.dispatch(existing.id, r.version);
      } else {
        r = mode === 'dispatch' ? await transfersApi.dispatchNow(payload) : await transfersApi.create(payload);
      }
      message.success(mode === 'dispatch' ? `Đã xuất chuyển kho ${r.code} — chờ ${r.toWarehouse?.name} nhận hàng` : `Đã lưu phiếu tạm ${r.code}`);
      TRANSFER_KEYS.forEach((k) => qc.invalidateQueries({ queryKey: [k] }));
      nav(`/transfers?search=${r.code}`);
    } catch (e) {
      const err = e as { code?: string; message: string; details?: any; statusCode?: number };
      if (err.code === 'INSUFFICIENT_STOCK' && err.details?.variantId) setLines((prev) => prev.map((l) => (l.variantId === err.details.variantId && (!err.details.batchId || l.batchId === err.details.batchId) ? { ...l, error: `Không đủ tồn ở kho gửi (tồn ${qty(err.details.onHand ?? err.details.available)}, yêu cầu ${qty(err.details.requested)})` } : l)));
      if (err.code === 'VERSION_CONFLICT') { qc.invalidateQueries({ queryKey: ['transfer', existing?.id] }); loadedRef.current = null; }
      actions.fail(err);
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

  const branch = me?.branches.find((b) => b.id === (existing?.fromBranchId ?? branchId));
  const batchSelect = (l: Line, size?: 'small') => (
    <Space.Compact style={{ width: '100%', flex: 1 }}>
      <Select size={size} style={{ flex: 1, minWidth: 0 }} placeholder="Chọn lô" value={l.batchId} onChange={(v) => upd(l.key, { batchId: v })} options={(l.batches ?? []).map((b) => ({ value: b.id, label: batchLabel(b) }))} />
      <Button size={size} icon={<PlusOutlined />} onClick={() => setBatchModal({ lineKey: l.key, variantId: l.variantId, batchNo: '' })} />
    </Space.Compact>
  );
  const stepper = (l: Line) => (
    <div className="tk-qty"><Button icon={<MinusOutlined />} onClick={() => upd(l.key, { quantity: Math.max(0, l.quantity - 1) })} /><QuantityInput min={0} inputMode="decimal" value={l.quantity} onChange={(v) => upd(l.key, { quantity: toNum(v) })} /><Button icon={<PlusOutlined />} onClick={() => upd(l.key, { quantity: l.quantity + 1 })} /></div>
  );

  return (
    <div className="tk-editor">
      <div className="kv-editor-head">
        <Button type="link" icon={<ArrowLeftOutlined />} onClick={() => nav('/transfers')} style={{ paddingInline: 0 }} />
        <h1 className="kv-page-title" style={{ margin: 0 }}>{existing ? `Sửa phiếu chuyển ${existing.code}` : 'Chuyển kho'}</h1>
        {existing && <Tag color={TRANSFER_STATUS_COLOR[existing.status]}>{TRANSFER_STATUS_LABEL[existing.status]}</Tag>}
        <span className="kv-hint"><span className="kv-kbd">F3</span>Tìm hàng <span className="kv-kbd">F9</span>Lưu tạm <span className="kv-kbd">F10</span>Xuất chuyển</span>
      </div>
      <div className="kv-doc-editor">
        <div className="kv-doc-lines">
          <Card size="small" style={{ marginBottom: 10 }}>
            <div style={{ display: 'flex', gap: 8, alignItems: 'center', flexWrap: 'wrap', marginBottom: 8 }}>
              <div style={{ flex: '1 1 160px', minWidth: 0 }}>
                <div className="kv-hint">Kho gửi · {branch?.name ?? 'chi nhánh đang chọn'}</div>
                <Select style={{ width: '100%' }} value={fromId} onChange={setFromId} disabled={!!existing} placeholder="Chọn kho gửi" options={myWarehouses.map((w) => ({ value: w.id, label: w.name }))} />
              </div>
              <ArrowRightOutlined className="muted" style={{ marginTop: 18 }} />
              <div style={{ flex: '1 1 160px', minWidth: 0 }}>
                <div className="kv-hint">Kho nhận{toWarehouse?.branch ? ` · ${toWarehouse.branch.name}` : ''}</div>
                <Select style={{ width: '100%' }} value={toId} onChange={setToId} placeholder="Chọn kho nhận" showSearch optionFilterProp="label" options={toOptions} notFoundContent={<span className="muted">Không có kho đích nào khác. Tạo kho ở Thiết lập → Chi nhánh / Kho.</span>} />
              </div>
            </div>
            <ProductSearch ref={searchRef} autoFocus goodsOnly warehouseId={fromId} onPick={addHit} placeholder="Tìm hàng để chuyển theo mã, tên hoặc quét mã vạch (F3)" />
          </Card>
          <Card size="small" styles={{ body: { padding: 0 } }}>
            {isMobile ? (
              <div className="tk-lines">
                {!lines.length && <div className="muted" style={{ padding: 8 }}>Chưa có hàng hóa. Tìm hoặc quét mã vạch để thêm.</div>}
                {lines.map((l, i) => (
                  <div key={l.key} className={`tk-line${l.error ? ' error' : ''}`}>
                    <div className="nm">{i + 1}. {l.name}</div>
                    <DeleteOutlined className="del" onClick={() => setLines((p) => p.filter((x) => x.key !== l.key))} />
                    <div className="meta"><span>{l.sku}</span><span>· {l.unit}</span><span>· Tồn kho gửi: <b>{qty(lineOnHand(l))}</b></span>{canSeeCost && <span>· GV {money(l.unitCost)}</span>}</div>
                    {l.trackBatch && <div className="row"><span className="lbl">Lô</span>{batchSelect(l)}</div>}
                    <div className="row"><span className="lbl">SL chuyển</span>{stepper(l)}</div>
                    <div className="row"><span className="lbl">Ghi chú</span><Input placeholder="Ghi chú dòng" value={l.note} onChange={(e) => upd(l.key, { note: e.target.value })} /></div>
                    {over(l) && !l.error && <div className="warn">Vượt tồn kho gửi — phiếu sẽ bị từ chối khi xuất nếu không cho phép âm kho.</div>}
                    {l.error && <div className="err">{l.error}</div>}
                  </div>
                ))}
              </div>
            ) : (
              <Table size="small" rowKey="key" pagination={false} dataSource={lines} locale={{ emptyText: 'Chưa có hàng hóa. Tìm hoặc quét mã vạch để thêm.' }} rowClassName={(l) => (l.error ? 'kv-line-error' : '')} scroll={{ x: 980 }}
                columns={[
                  { title: '#', width: 36, render: (_, __, i) => i + 1 },
                  { title: 'Mã hàng', dataIndex: 'sku', width: 120 },
                  { title: 'Tên hàng', dataIndex: 'name', width: 260, render: (v, l) => <span>{v}{l.error && <div className="neg" style={{ fontSize: 12 }}>{l.error}</div>}{over(l) && !l.error && <div style={{ fontSize: 12, color: '#d97706' }}>Vượt tồn kho gửi</div>}</span> },
                  { title: 'ĐVT', dataIndex: 'unit', width: 60 },
                  { title: 'Lô', width: 220, render: (_, l) => l.trackBatch ? batchSelect(l, 'small') : <span className="muted">—</span> },
                  { title: 'Tồn kho gửi', className: 'num', width: 100, render: (_, l) => qty(lineOnHand(l)) },
                  { title: 'SL chuyển', width: 110, render: (_, l) => <QuantityInput size="small" min={0} value={l.quantity} onChange={(v) => upd(l.key, { quantity: toNum(v) })} /> },
                  ...(canSeeCost ? [{ title: 'Giá vốn', className: 'num', width: 110, render: (_: unknown, l: Line) => money(l.unitCost) }, { title: 'Thành tiền', className: 'num', width: 120, render: (_: unknown, l: Line) => money(l.quantity * l.unitCost) }] : []),
                  { title: 'Ghi chú', width: 140, render: (_, l) => <Input size="small" value={l.note} onChange={(e) => upd(l.key, { note: e.target.value })} /> },
                  { title: '', width: 40, render: (_, l) => <Button size="small" type="text" danger icon={<DeleteOutlined />} onClick={() => setLines((p) => p.filter((x) => x.key !== l.key))} /> },
                ]} />
            )}
          </Card>
        </div>
        <div className="kv-doc-side">
          <Card size="small" title="Thông tin phiếu">
            <div className="kv-kv" style={{ marginBottom: 10 }}>
              <span className="k">Chi nhánh gửi</span><span className="v">{branch?.name ?? <span className="neg">Chưa chọn</span>}</span>
              <span className="k">Chi nhánh nhận</span><span className="v">{toWarehouse?.branch?.name ?? toWarehouse?.branchName ?? <span className="muted">—</span>}</span>
              <span className="k">Người lập</span><span className="v">{me?.user.fullName}</span>
            </div>
            <div className="tk-field"><div className="kv-hint">Ghi chú</div><Input.TextArea rows={2} value={note} onChange={(e) => setNote(e.target.value)} placeholder="Ghi chú phiếu chuyển" /></div>
            <div className="tk-totals">
              <span className="k">Số dòng</span><span className="v">{lines.length}</span>
              <span className="k">Tổng SL chuyển</span><span className="v big">{qty(totals.qty)}</span>
              {canSeeCost && <><span className="k">Giá trị (giá vốn hiện tại)</span><span className="v">{money(totals.cost)}</span></>}
            </div>
            {totals.over > 0 && <Alert type="warning" showIcon style={{ marginBottom: 8 }} message={`${totals.over} dòng vượt tồn kho gửi.`} />}
            <Alert type="info" showIcon style={{ marginBottom: 8 }} message="Xuất chuyển sẽ trừ kho gửi ngay; hàng ở trạng thái đang chuyển cho đến khi kho nhận xác nhận. Giá vốn bình quân không thay đổi." />
            <div className="tk-actions">
              <Button icon={<SaveOutlined />} loading={saving === 'draft'} onClick={() => save('draft')}>Lưu tạm</Button>
              {can('transfer.dispatch') && <Button type="primary" icon={<SendOutlined />} loading={saving === 'dispatch'} onClick={() => save('dispatch')}>Xuất chuyển ngay</Button>}
              {existing && can('transfer.create') && <Button danger icon={<DeleteOutlined />} onClick={() => actions.remove(existing)} />}
            </div>
          </Card>
        </div>
      </div>
      <Modal title="Thêm lô mới" open={!!batchModal} onCancel={() => setBatchModal(null)} onOk={createBatch} okText="Thêm" cancelText="Hủy" destroyOnHidden afterOpenChange={(o) => { if (o) setTimeout(() => batchInputRef.current?.focus?.(), 50); }}>
        <div className="kv-hint">Số lô</div><Input ref={batchInputRef} autoFocus value={batchModal?.batchNo} onChange={(e) => setBatchModal((m) => m && { ...m, batchNo: e.target.value })} onPressEnter={createBatch} style={{ marginBottom: 8 }} />
        <div className="kv-hint">Hạn sử dụng</div><DatePicker style={{ width: '100%' }} format="DD/MM/YYYY" onChange={(d) => setBatchModal((m) => m && { ...m, expiryDate: d ? d.format('YYYY-MM-DD') : undefined })} />
      </Modal>
    </div>
  );
}

// ====================================================================== receive (kho nhận)
function ReceiveForm({ t }: { t: Transfer }) {
  const nav = useNavigate();
  const qc = useQueryClient();
  const { message, modal } = App.useApp();
  const can = useCan();
  const isMobile = useIsMobile();
  const inBranch = useInBranch();
  const actions = useTransferActions();
  const canSeeCost = can('inventory.cost.view');
  const [recv, setRecv] = useState<Record<string, number>>(() => Object.fromEntries(t.lines.map((l) => [l.id, toNum(l.quantity)])));
  const [notes, setNotes] = useState<Record<string, string>>({});
  const [action, setAction] = useState<ShortageAction>('WRITE_OFF');
  const [note, setNote] = useState('');
  const [saving, setSaving] = useState(false);
  const inSource = inBranch(t.fromBranchId);
  const got = (l: Transfer['lines'][number]) => recv[l.id] ?? toNum(l.quantity);
  const setGot = (l: Transfer['lines'][number], v: number) => setRecv((p) => ({ ...p, [l.id]: Math.min(toNum(l.quantity), Math.max(0, v)) }));
  const totals = useMemo(() => t.lines.reduce((s, l) => { const sent = toNum(l.quantity); const g = got(l); const sh = Math.max(0, sent - g); return { sent: s.sent + sent, got: s.got + g, short: s.short + sh, shortValue: s.shortValue + sh * toNum(l.unitCost), shortLines: s.shortLines + (sh > 0 ? 1 : 0) }; }, { sent: 0, got: 0, short: 0, shortValue: 0, shortLines: 0 }), [t, recv]);

  const submit = () => {
    if (!can('transfer.receive')) { message.warning('Bạn không có quyền nhận hàng'); return; }
    modal.confirm({
      title: `Xác nhận nhận hàng ${t.code}?`,
      content: (
        <div className="tk-modal-sum">
          <span className="k">Kho nhận</span><span className="v">{t.toWarehouse?.name}</span>
          <span className="k">SL nhận / SL gửi</span><span className="v">{qty(totals.got)} / {qty(totals.sent)}</span>
          {totals.short > 0 && <><span className="k">Phần thiếu</span><span className="v tk-shortage">{qty(totals.short)} ({totals.shortLines} dòng)</span><span className="k">Xử lý phần thiếu</span><span className="v">{SHORTAGE_ACTION_LABEL[action]}</span>{canSeeCost && action === 'WRITE_OFF' && <><span className="k">Giá trị thất thoát</span><span className="v neg">{money(totals.shortValue)}</span></>}</>}
          {totals.short === 0 && <><span className="k">Phần thiếu</span><span className="v pos">Không — nhận đủ</span></>}
        </div>
      ),
      okText: 'Nhận hàng', cancelText: 'Bỏ qua',
      onOk: async () => {
        setSaving(true);
        try {
          const r = await transfersApi.receive(t.id, { version: t.version, lines: t.lines.map((l) => ({ lineId: l.id, receivedQuantity: String(got(l)), note: notes[l.id]?.trim() || undefined })), shortageAction: totals.short > 0 ? action : undefined, note: note.trim() || undefined });
          message.success(`Đã nhận hàng ${r.code}${toNum(r.shortageQuantity) > 0 ? ` — thiếu ${qty(r.shortageQuantity)}` : ''}`);
          TRANSFER_KEYS.forEach((k) => qc.invalidateQueries({ queryKey: [k] }));
          nav(`/transfers?search=${r.code}&dir=in`);
        } catch (e) { actions.fail(e); throw e; } finally { setSaving(false); }
      },
    });
  };

  const stepper = (l: Transfer['lines'][number]) => (
    <div className="tk-qty"><Button icon={<MinusOutlined />} onClick={() => setGot(l, got(l) - 1)} /><QuantityInput min={0} max={toNum(l.quantity)} inputMode="decimal" value={got(l)} onChange={(v) => setGot(l, toNum(v))} /><Button icon={<PlusOutlined />} onClick={() => setGot(l, got(l) + 1)} /></div>
  );
  const deltaChip = (sent: number, g: number) => { const d = g - sent; return <span className={`tk-delta ${d < 0 ? 'neg' : 'pos'}`}>{d === 0 ? 'Đủ' : `${qty(d)}`}</span>; };

  return (
    <div className="tk-editor">
      <div className="kv-editor-head">
        <Button type="link" icon={<ArrowLeftOutlined />} onClick={() => nav('/transfers')} style={{ paddingInline: 0 }} />
        <h1 className="kv-page-title" style={{ margin: 0 }}>Nhận hàng {t.code}</h1>
        <Tag color={TRANSFER_STATUS_COLOR[t.status]}>{TRANSFER_STATUS_LABEL[t.status]}</Tag>
      </div>
      <div className="kv-doc-editor">
        <div className="kv-doc-lines">
          <Card size="small" style={{ marginBottom: 10 }}>
            <TransferRoute t={t} />
            <div className="kv-hint" style={{ marginTop: 4 }}>Xuất lúc {dt(t.dispatchedAt)} · {t.lines.length} dòng · {qty(t.totalQuantity)} đơn vị{t.note ? ` · ${t.note}` : ''}</div>
          </Card>
          <Card size="small" styles={{ body: { padding: 0 } }}>
            {isMobile ? (
              <div className="tk-lines">
                {t.lines.map((l, i) => { const sent = toNum(l.quantity); const g = got(l); return (
                  <div key={l.id} className={`tk-line${g < sent ? ' short' : ''}`}>
                    <div className="nm">{i + 1}. {l.variant.name}</div>
                    {deltaChip(sent, g)}
                    <div className="meta"><span>{l.variant.sku}</span><span>· {l.variant.product.baseUnit ?? ''}</span>{l.batch && <Tag color="gold" style={{ marginInlineEnd: 0 }}>Lô {l.batch.batchNo}</Tag>}{l.note && <span>· {l.note}</span>}</div>
                    <div className="row"><span className="lbl">SL gửi</span><b>{qty(sent)}</b></div>
                    <div className="row"><span className="lbl">SL nhận</span>{stepper(l)}</div>
                    <div className="row"><span className="lbl">Ghi chú nhận</span><Input placeholder="VD: vỡ 2 hộp" value={notes[l.id]} onChange={(e) => setNotes((p) => ({ ...p, [l.id]: e.target.value }))} /></div>
                    {g < sent && <div className="warn">Thiếu {qty(sent - g)}{canSeeCost && l.unitCost !== undefined ? ` · ${money((sent - g) * toNum(l.unitCost))}` : ''}</div>}
                  </div>
                ); })}
              </div>
            ) : (
              <Table size="small" rowKey="id" pagination={false} dataSource={t.lines} rowClassName={(l) => (got(l) < toNum(l.quantity) ? 'tk-row-short' : '')} scroll={{ x: 900 }}
                columns={[
                  { title: '#', dataIndex: 'lineNo', width: 36 },
                  { title: 'Mã hàng', width: 120, render: (_, l) => l.variant.sku },
                  { title: 'Tên hàng', width: 260, render: (_, l) => <span>{l.variant.name}{l.batch && <Tag style={{ marginLeft: 6 }} color="gold">Lô {l.batch.batchNo}</Tag>}</span> },
                  { title: 'ĐVT', width: 60, render: (_, l) => l.variant.product.baseUnit ?? '' },
                  { title: 'SL gửi', className: 'num', width: 90, render: (_, l) => <b>{qty(l.quantity)}</b> },
                  { title: 'SL nhận', width: 170, render: (_, l) => stepper(l) },
                  { title: 'Chênh lệch', className: 'num', width: 100, render: (_, l) => deltaChip(toNum(l.quantity), got(l)) },
                  ...(canSeeCost ? [{ title: 'Giá vốn', className: 'num', width: 100, render: (_: unknown, l: Transfer['lines'][number]) => money(l.unitCost) }] : []),
                  { title: 'Ghi chú nhận', width: 160, render: (_, l) => <Input size="small" value={notes[l.id]} placeholder={l.note ?? ''} onChange={(e) => setNotes((p) => ({ ...p, [l.id]: e.target.value }))} /> },
                ]} />
            )}
          </Card>
        </div>
        <div className="kv-doc-side">
          <Card size="small" title="Xác nhận nhận hàng">
            <div className="tk-totals">
              <span className="k">SL gửi</span><span className="v">{qty(totals.sent)}</span>
              <span className="k">SL nhận</span><span className="v big">{qty(totals.got)}</span>
              <span className="k">Phần thiếu</span><span className={`v${totals.short > 0 ? ' tk-shortage' : ''}`}>{qty(totals.short)}{totals.shortLines ? ` (${totals.shortLines} dòng)` : ''}</span>
              {canSeeCost && totals.short > 0 && action === 'WRITE_OFF' && <><span className="k">Giá trị thất thoát</span><span className="v neg">{money(totals.shortValue)}</span></>}
            </div>
            <div className="tk-field">
              <div className="kv-hint" style={{ marginBottom: 4 }}>Phần thiếu (nếu có)</div>
              <Radio.Group className="tk-radio-block" value={action} onChange={(e) => setAction(e.target.value)} disabled={totals.short === 0}>
                <Radio value="WRITE_OFF">Ghi nhận thất thoát<span className="sub">Hàng thiếu coi như mất; giá trị đã rời kho gửi được ghi là thất thoát.</span></Radio>
                <Radio value="RETURN_TO_SOURCE">Trả về kho nguồn<span className="sub">Phần thiếu được nhập lại kho gửi theo giá vốn lúc xuất.</span></Radio>
              </Radio.Group>
            </div>
            <div className="tk-field"><div className="kv-hint">Ghi chú nhận</div><Input.TextArea rows={2} value={note} onChange={(e) => setNote(e.target.value)} placeholder="Ghi chú khi nhận hàng" /></div>
            <Alert type="info" showIcon style={{ marginBottom: 8 }} message="Hàng nhận được nhập vào kho nhận theo đúng giá vốn lúc xuất. Phiếu đã nhận không hủy được — nếu nhầm hãy tạo phiếu chuyển ngược lại." />
            <div className="tk-actions">
              <Button onClick={() => setRecv(Object.fromEntries(t.lines.map((l) => [l.id, toNum(l.quantity)])))}>Nhận đủ tất cả</Button>
              <Button type="primary" icon={<CheckOutlined />} loading={saving} onClick={submit}>Xác nhận nhận hàng</Button>
              {can('transfer.cancel') && inSource && <Button danger icon={<StopOutlined />} onClick={() => actions.cancel(t, () => nav('/transfers'))} title="Hủy phiếu (trả hàng về kho gửi)" />}
            </div>
          </Card>
        </div>
      </div>
    </div>
  );
}

// ====================================================================== read-only
function TransferView({ t }: { t: Transfer }) {
  const nav = useNavigate();
  return (
    <div className="tk-editor">
      <div className="kv-editor-head">
        <Button type="link" icon={<ArrowLeftOutlined />} onClick={() => nav('/transfers')} style={{ paddingInline: 0 }} />
        <h1 className="kv-page-title" style={{ margin: 0 }}>Phiếu chuyển kho {t.code}</h1>
        <Tag color={TRANSFER_STATUS_COLOR[t.status]}>{TRANSFER_STATUS_LABEL[t.status]}</Tag>
        {t.status === 'IN_TRANSIT' && <Tag icon={<InboxOutlined />} color="blue">Chờ {t.toWarehouse?.name} nhận</Tag>}
      </div>
      <Card size="small"><TransferDetail id={t.id} hideOpen /></Card>
    </div>
  );
}
