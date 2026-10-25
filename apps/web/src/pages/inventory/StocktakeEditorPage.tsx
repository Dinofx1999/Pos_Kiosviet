import './transfers.css';
import { Alert, App, Button, Card, Descriptions, Input, Modal, Progress, Radio, Segmented, Select, Switch, Tag } from 'antd';
import Table from '../../components/ResponsiveTable';
import { ArrowLeftOutlined, CheckCircleFilled, CheckOutlined, DeleteOutlined, ExclamationCircleFilled, LoadingOutlined, MinusOutlined, PlusOutlined, ReloadOutlined, StopOutlined } from '@ant-design/icons';
import { useEffect, useMemo, useRef, useState } from 'react';
import { Link, useNavigate, useParams, useSearchParams } from 'react-router-dom';
import { useQueryClient } from '@tanstack/react-query';
import { catalogApi } from '../../api/catalog';
import { STOCKTAKE_SCOPE_LABEL, STOCKTAKE_STATUS_COLOR, STOCKTAKE_STATUS_LABEL, Stocktake, StocktakeLine, StocktakeScope, TRANSFER_KEYS, UncountedAs, stocktakesApi, useStocktake } from '../../api/transfers';
import { errMsg } from '../../api/client';
import type { Batch, SearchHit } from '../../api/types';
import { QuantityInput } from '../../components/Inputs';
import { ProductSearch, ProductSearchHandle } from '../../components/ProductSearch';
import { useIsMobile } from '../../hooks/useMedia';
import { useAuthStore, useBranchWarehouses, useCan } from '../../store/auth';
import { MOVEMENT_LABEL, dt, money, qty, signedQty, toNum } from '../../utils/format';
import { useCategoryOptions } from '../products/CategoryFilter';
import { StocktakeProgress, useStocktakeActions } from './StocktakesPage';

export default function StocktakeEditorPage() {
  const { id } = useParams();
  const nav = useNavigate();
  const { data: s, isLoading, error } = useStocktake(id);
  if (!id) return <CreateStocktake />;
  if (isLoading) return <div className="muted">Đang tải phiếu…</div>;
  if (!s) return <Alert type="error" showIcon message={error ? errMsg(error) : 'Không tìm thấy phiếu kiểm kho'} action={<Button onClick={() => nav('/stocktakes')}>Về danh sách</Button>} />;
  if (s.status === 'DRAFT') return <CountingScreen s={s} />;
  return <StocktakeView s={s} />;
}

// ====================================================================== create
function CreateStocktake() {
  const nav = useNavigate();
  const qc = useQueryClient();
  const { message } = App.useApp();
  const me = useAuthStore((s) => s.me);
  const branchId = useAuthStore((s) => s.currentBranchId);
  const warehouses = useBranchWarehouses();
  const categories = useCategoryOptions();
  const actions = useStocktakeActions();
  const [warehouseId, setWarehouseId] = useState<string>();
  const [scope, setScope] = useState<StocktakeScope>('SELECTED');
  const [categoryId, setCategoryId] = useState<string>();
  const [note, setNote] = useState('');
  const [saving, setSaving] = useState(false);
  useEffect(() => { if (!warehouseId && warehouses.length) setWarehouseId(warehouses.find((w) => w.isDefault)?.id ?? warehouses[0].id); }, [warehouses, warehouseId]);
  const branch = me?.branches.find((b) => b.id === branchId);

  const start = async () => {
    if (!warehouseId) { message.warning('Chọn kho cần kiểm'); return; }
    setSaving(true);
    try {
      const r = await stocktakesApi.create({ warehouseId, scope, categoryId: scope === 'ALL' ? categoryId : undefined, note: note.trim() || undefined });
      qc.setQueryData(['stocktake', r.id], r);
      qc.invalidateQueries({ queryKey: ['stocktakes'] });
      message.success(`Đã tạo phiếu kiểm kho ${r.code}${scope === 'ALL' ? ` — ${r.totalLines} dòng đã chụp tồn` : ''}`);
      nav(`/stocktakes/${r.id}`, { replace: true });
    } catch (e) { actions.fail(e); } finally { setSaving(false); }
  };

  return (
    <div className="tk-editor">
      <div className="kv-editor-head">
        <Button type="link" icon={<ArrowLeftOutlined />} onClick={() => nav('/stocktakes')} style={{ paddingInline: 0 }} />
        <h1 className="kv-page-title" style={{ margin: 0 }}>Tạo phiếu kiểm kho</h1>
      </div>
      <div className="kv-doc-editor">
        <div className="kv-doc-lines">
          <Card size="small" title="Thiết lập phiếu">
            <div className="kv-kv" style={{ marginBottom: 10 }}><span className="k">Chi nhánh</span><span className="v">{branch?.name ?? <span className="neg">Chưa chọn</span>}</span><span className="k">Người tạo</span><span className="v">{me?.user.fullName}</span></div>
            <div className="tk-field"><div className="kv-hint">Kho cần kiểm</div><Select value={warehouseId} onChange={setWarehouseId} placeholder="Chọn kho" options={warehouses.map((w) => ({ value: w.id, label: w.name }))} /></div>
            <div className="tk-field">
              <div className="kv-hint" style={{ marginBottom: 4 }}>Phạm vi kiểm</div>
              <Radio.Group className="tk-radio-block" value={scope} onChange={(e) => setScope(e.target.value)}>
                <Radio value="SELECTED">Chọn hàng để kiểm<span className="sub">Bắt đầu với phiếu trống; quét mã hoặc tìm từng mặt hàng để thêm vào phiếu.</span></Radio>
                <Radio value="ALL">Toàn bộ kho<span className="sub">Chụp tồn của tất cả hàng hóa đang có số dư trong kho (có thể giới hạn theo nhóm hàng).</span></Radio>
              </Radio.Group>
            </div>
            {scope === 'ALL' && <div className="tk-field"><div className="kv-hint">Giới hạn nhóm hàng (tùy chọn)</div><Select allowClear showSearch optionFilterProp="label" value={categoryId} onChange={setCategoryId} placeholder="Tất cả nhóm hàng" options={categories} /></div>}
            <div className="tk-field"><div className="kv-hint">Ghi chú</div><Input.TextArea rows={2} value={note} onChange={(e) => setNote(e.target.value)} placeholder="VD: kiểm kho cuối tháng" /></div>
            <Alert type="info" showIcon style={{ marginBottom: 8 }} message="Tồn hệ thống được chụp tại thời điểm thêm dòng. Khi cân bằng, hệ thống chỉ ghi chênh lệch = thực tế − tồn lúc chụp, nên bán hàng / nhập hàng trong lúc kiểm không bị tính hai lần." />
            <div className="tk-actions">
              <Button onClick={() => nav('/stocktakes')}>Quay lại</Button>
              <Button type="primary" icon={<CheckOutlined />} loading={saving} onClick={start}>Bắt đầu kiểm</Button>
            </div>
          </Card>
        </div>
      </div>
    </div>
  );
}

// ====================================================================== counting (main phone screen)
type LineFilter = 'all' | 'uncounted' | 'diff';
interface LocalLine { counted?: number | null; note?: string; status: 'dirty' | 'saving' | 'saved' | 'error'; err?: string }
const PAGE = 100;

function CountingScreen({ s }: { s: Stocktake }) {
  const nav = useNavigate();
  const qc = useQueryClient();
  const [sp, setSp] = useSearchParams();
  const { message, modal } = App.useApp();
  const can = useCan();
  const isMobile = useIsMobile();
  const actions = useStocktakeActions();
  const canSeeCost = can('inventory.cost.view');
  const canCount = can('stocktake.create');
  const [local, setLocalState] = useState<Record<string, LocalLine>>({});
  const localRef = useRef<Record<string, LocalLine>>({});
  const setLocal = (fn: (p: Record<string, LocalLine>) => Record<string, LocalLine>) => { localRef.current = fn(localRef.current); setLocalState(localRef.current); };
  const timers = useRef<Record<string, number>>({});
  const pending = useRef<Record<string, () => void>>({}); // debounced saves not yet sent; flushed on unmount so a count typed right before leaving is not lost
  const seqs = useRef<Record<string, number>>({});
  const inputRefs = useRef<Record<string, any>>({});
  const searchRef = useRef<ProductSearchHandle>(null);
  const [filter, setFilter] = useState<LineFilter>('all');
  const [scanPlus, setScanPlus] = useState(false);
  const [limit, setLimit] = useState(PAGE);
  const [focusId, setFocusId] = useState<string | null>(null);
  const [adding, setAdding] = useState(false);
  const [batchPick, setBatchPick] = useState<{ hit: SearchHit; batches: Batch[]; newNo: string; creating: boolean } | null>(null);
  const [completeOpen, setCompleteOpen] = useState(sp.get('action') === 'complete');
  const [uncountedAs, setUncountedAs] = useState<UncountedAs>('SKIP');
  const [completing, setCompleting] = useState(false);
  const [refreshing, setRefreshing] = useState(false);
  const [noteDraft, setNoteDraft] = useState(s.note ?? '');
  useEffect(() => { setNoteDraft(s.note ?? ''); }, [s.note]);
  useEffect(() => () => { for (const k of Object.keys(pending.current)) { window.clearTimeout(timers.current[k]); const run = pending.current[k]; delete pending.current[k]; run(); } }, []);

  const setData = (r: Stocktake) => qc.setQueryData(['stocktake', s.id], r);
  const latest = () => qc.getQueryData<Stocktake>(['stocktake', s.id]) ?? s;
  const counted = (l: StocktakeLine): number | null => { const lc = local[l.id]; if (lc && lc.counted !== undefined) return lc.counted; return l.countedQuantity === null ? null : toNum(l.countedQuantity); };
  const noteOf = (l: StocktakeLine) => local[l.id]?.note ?? l.note ?? '';
  const deltaOf = (l: StocktakeLine) => { const c = counted(l); return c === null ? null : c - toNum(l.systemQuantity); };

  // ---- debounced per-line save (optimistic; the response is the full stocktake and refreshes the counters)
  const saveLine = (l: StocktakeLine, patch: { counted?: number | null; note?: string }, immediate = false) => {
    setLocal((p) => ({ ...p, [l.id]: { ...p[l.id], ...(patch.counted !== undefined ? { counted: patch.counted } : {}), ...(patch.note !== undefined ? { note: patch.note } : {}), status: 'dirty', err: undefined } }));
    window.clearTimeout(timers.current[l.id]);
    const run = async () => {
      delete pending.current[l.id];
      const cur = localRef.current[l.id];
      const c = cur?.counted;
      if ((c === undefined || c === null) && cur?.note === undefined) { setLocal((p) => { const n = { ...p }; delete n[l.id]; return n; }); return; } // nothing to send (input cleared)
      const seq = (seqs.current[l.id] = (seqs.current[l.id] ?? 0) + 1);
      setLocal((p) => ({ ...p, [l.id]: { ...p[l.id], status: 'saving' } }));
      try {
        const r = await stocktakesApi.count(s.id, [{ variantId: l.variantId, batchId: l.batchId ?? undefined, countedQuantity: c !== undefined && c !== null ? String(c) : undefined, note: cur?.note !== undefined ? cur.note : undefined }]);
        setData(r);
        if (seqs.current[l.id] === seq) setLocal((p) => ({ ...p, [l.id]: { status: 'saved' } }));
      } catch (e) {
        if (seqs.current[l.id] === seq) setLocal((p) => ({ ...p, [l.id]: { ...p[l.id], status: 'error', err: errMsg(e) } }));
      }
    };
    pending.current[l.id] = run;
    if (immediate) void run(); else timers.current[l.id] = window.setTimeout(run, 600);
  };
  const retry = (l: StocktakeLine) => { const cur = localRef.current[l.id]; if (!cur) return; saveLine(l, { counted: cur.counted, note: cur.note }, true); };
  const pendingCount = Object.values(local).filter((x) => x.status === 'dirty' || x.status === 'saving').length;

  const focusLine = (lineId: string) => {
    setFocusId(lineId);
    const cur = latest().lines.find((l) => l.id === lineId);
    if (cur && filter === 'uncounted' && counted(cur) !== null) setFilter('all');
    const idx = latest().lines.findIndex((l) => l.id === lineId);
    if (idx >= limit) setLimit(Math.ceil((idx + 1) / PAGE) * PAGE);
    setTimeout(() => { document.getElementById(`tk-line-${lineId}`)?.scrollIntoView({ block: 'center', behavior: 'smooth' }); inputRefs.current[lineId]?.focus?.(); }, 80);
  };

  const addOrFocus = async (variantId: string, batchId: string | undefined, name: string) => {
    const existing = latest().lines.find((l) => l.variantId === variantId && (l.batchId ?? undefined) === batchId);
    if (existing) {
      if (scanPlus) saveLine(existing, { counted: (counted(existing) ?? 0) + 1 }, true);
      else message.info(`${name} đã có trong phiếu`);
      focusLine(existing.id);
      return;
    }
    setAdding(true);
    try {
      const r = await stocktakesApi.count(s.id, [{ variantId, batchId, countedQuantity: scanPlus ? '1' : undefined }]);
      setData(r);
      const nl = r.lines.find((l) => l.variantId === variantId && (l.batchId ?? undefined) === batchId);
      message.success(`Đã thêm ${name} vào phiếu`);
      if (nl) focusLine(nl.id);
    } catch (e) { actions.fail(e); } finally { setAdding(false); }
  };
  const onPick = async (h: SearchHit) => {
    if (!canCount) { message.warning('Bạn không có quyền nhập số đếm'); return; }
    if (h.product.type !== 'GOODS') { message.warning('Chỉ kiểm kho hàng hóa (không áp dụng cho dịch vụ / combo)'); return; }
    if (h.product.trackBatch) { const batches = await catalogApi.batches(h.id).catch(() => [] as Batch[]); setBatchPick({ hit: h, batches, newNo: '', creating: false }); return; }
    await addOrFocus(h.id, undefined, h.name);
  };
  const createBatch = async () => {
    if (!batchPick || !batchPick.newNo.trim()) return;
    try { const b = await catalogApi.createBatch(batchPick.hit.id, { batchNo: batchPick.newNo.trim() }); setBatchPick(null); await addOrFocus(batchPick.hit.id, b.id, `${batchPick.hit.name} (lô ${b.batchNo})`); } catch (e) { message.error(errMsg(e)); }
  };
  const removeLine = (l: StocktakeLine) => modal.confirm({
    title: `Bỏ ${l.variant.name} khỏi phiếu?`, okText: 'Bỏ dòng', okButtonProps: { danger: true }, cancelText: 'Không',
    onOk: async () => { try { const r = await stocktakesApi.removeLine(s.id, l.id); setData(r); setLocal((p) => { const n = { ...p }; delete n[l.id]; return n; }); } catch (e) { actions.fail(e); throw e; } },
  });
  const refreshSnapshot = () => modal.confirm({
    title: 'Làm mới tồn hệ thống?',
    content: 'Tồn hệ thống (lúc chụp) của mọi dòng sẽ được đọc lại theo tồn hiện tại. Số đã đếm được giữ nguyên, chênh lệch sẽ tính lại theo mốc mới. Dùng khi bạn đếm lại từ đầu sau khi có nhiều giao dịch.',
    okText: 'Làm mới', cancelText: 'Bỏ qua',
    onOk: async () => { setRefreshing(true); try { const r = await stocktakesApi.refreshSnapshot(s.id); setData(r); message.success('Đã làm mới tồn hệ thống'); } catch (e) { actions.fail(e); throw e; } finally { setRefreshing(false); } },
  });
  const saveNote = async () => {
    if ((s.note ?? '') === noteDraft.trim()) return;
    try { const r = await stocktakesApi.update(s.id, { version: s.version, note: noteDraft.trim() || undefined }); setData(r); } catch (e) { actions.fail(e); }
  };

  // ---- derived
  const stats = useMemo(() => {
    let countedN = 0, uncountedN = 0, inc = 0, dec = 0, incV = 0, decV = 0, zeroQ = 0, zeroV = 0, diffN = 0;
    for (const l of s.lines) {
      const c = counted(l); const sys = toNum(l.systemQuantity); const uc = toNum(l.unitCost);
      if (c === null) { uncountedN++; zeroQ += sys; zeroV += sys * uc; continue; }
      countedN++;
      const d = c - sys;
      if (d > 0) { inc += d; incV += d * uc; diffN++; } else if (d < 0) { dec += -d; decV += -d * uc; diffN++; }
    }
    return { countedN, uncountedN, inc, dec, incV, decV, zeroQ, zeroV, diffN, total: s.lines.length, pct: s.lines.length ? Math.round((countedN / s.lines.length) * 100) : 0 };
  }, [s, local]);
  const visible = useMemo(() => s.lines.filter((l) => filter === 'all' ? true : filter === 'uncounted' ? counted(l) === null : (deltaOf(l) ?? 0) !== 0), [s, local, filter]);
  const shown = visible.slice(0, limit);

  const complete = async () => {
    if (!can('stocktake.complete')) { message.warning('Bạn không có quyền cân bằng kho'); return; }
    setCompleting(true);
    try {
      const r = await stocktakesApi.complete(s.id, { version: latest().version, uncountedAs: stats.uncountedN ? uncountedAs : undefined });
      setData(r);
      TRANSFER_KEYS.forEach((k) => qc.invalidateQueries({ queryKey: [k] }));
      setCompleteOpen(false);
      if (sp.get('action')) { sp.delete('action'); setSp(sp, { replace: true }); }
      message.success(`Đã cân bằng kho ${r.code}: +${qty(r.increaseQuantity)} / -${qty(r.decreaseQuantity)}`);
    } catch (e) { actions.fail(e); } finally { setCompleting(false); }
  };

  const saveState = (l: StocktakeLine) => {
    const st = local[l.id];
    if (!st) return l.countedAt ? <span className="tk-save saved"><CheckCircleFilled /> {dt(l.countedAt, 'HH:mm')}</span> : <span className="tk-save">Chưa đếm</span>;
    if (st.status === 'saving' || st.status === 'dirty') return <span className="tk-save saving"><LoadingOutlined /> Đang lưu…</span>;
    if (st.status === 'error') return <span className="tk-save error"><ExclamationCircleFilled /> Lỗi</span>;
    return <span className="tk-save saved"><CheckCircleFilled /> Đã lưu</span>;
  };
  const deltaChip = (l: StocktakeLine) => { const d = deltaOf(l); return d === null ? <span className="tk-delta none">—</span> : <span className={`tk-delta ${d > 0 ? 'pos' : d < 0 ? 'neg' : ''}`}>{d === 0 ? '0' : signedQty(d)}</span>; };
  const countInput = (l: StocktakeLine, big: boolean) => {
    const c = counted(l);
    return (
      <div className={`tk-qty${big ? ' big' : ''}`}>
        <Button icon={<MinusOutlined />} disabled={!canCount} onClick={() => saveLine(l, { counted: Math.max(0, (c ?? 0) - 1) })} />
        <QuantityInput ref={(el) => { inputRefs.current[l.id] = el; }} min={0} inputMode="decimal" placeholder="—" value={c} disabled={!canCount}
          onChange={(v) => saveLine(l, { counted: v === null || v === undefined || v === '' ? null : toNum(v) })}
          onFocus={(e) => { setFocusId(l.id); e.target.select(); }}
          onBlur={() => { const cur = localRef.current[l.id]; if (cur && cur.counted === null) { window.clearTimeout(timers.current[l.id]); delete pending.current[l.id]; setLocal((p) => { const n = { ...p }; delete n[l.id]; return n; }); } }}
          onPressEnter={() => searchRef.current?.focus()} />
        <Button icon={<PlusOutlined />} disabled={!canCount} onClick={() => saveLine(l, { counted: (c ?? 0) + 1 })} />
      </div>
    );
  };
  const eqButton = (l: StocktakeLine) => <Button className="tk-eq" size="small" disabled={!canCount} onClick={() => saveLine(l, { counted: toNum(l.systemQuantity) })} title="Đặt thực tế = tồn hệ thống">= tồn</Button>;

  return (
    <div className="tk-editor">
      <div className="kv-editor-head">
        <Button type="link" icon={<ArrowLeftOutlined />} onClick={() => nav('/stocktakes')} style={{ paddingInline: 0 }} />
        <h1 className="kv-page-title" style={{ margin: 0 }}>Kiểm kho {s.code}</h1>
        <Tag color={STOCKTAKE_STATUS_COLOR[s.status]}>{STOCKTAKE_STATUS_LABEL[s.status]}</Tag>
        <span className="muted">{s.warehouse?.name} · {STOCKTAKE_SCOPE_LABEL[s.scope] ?? s.scope}</span>
      </div>
      <div className="tk-sticky">
        <Card size="small">
          <ProductSearch ref={searchRef} autoFocus goodsOnly warehouseId={s.warehouseId} onPick={onPick} placeholder="Quét mã vạch hoặc tìm hàng để đếm (F3)" />
          <div className="tk-sticky-tools">
            <Segmented size="small" value={filter} onChange={(v) => { setFilter(v as LineFilter); setLimit(PAGE); }} options={[{ value: 'all', label: `Tất cả (${stats.total})` }, { value: 'uncounted', label: `Chưa đếm (${stats.uncountedN})` }, { value: 'diff', label: `Lệch (${stats.diffN})` }]} />
            <span className="tk-toolbar-right"><span><Switch size="small" checked={scanPlus} onChange={setScanPlus} /> Mỗi lần quét +1</span>{adding && <span className="tk-save saving"><LoadingOutlined /> đang thêm</span>}{pendingCount > 0 && <span className="tk-save saving"><LoadingOutlined /> lưu {pendingCount}</span>}</span>
          </div>
          <div className="tk-progress" style={{ marginTop: 6 }}><Progress percent={stats.pct} size="small" showInfo={false} status={stats.pct === 100 ? 'success' : 'active'} /><span style={{ whiteSpace: 'nowrap' }}>Đã đếm <b>{stats.countedN}</b>/{stats.total}</span></div>
        </Card>
      </div>
      <div className="kv-doc-editor">
        <div className="kv-doc-lines">
          <Card size="small" styles={{ body: { padding: 0 } }}>
            {!s.lines.length && <div className="muted" style={{ padding: 12 }}>Phiếu chưa có dòng nào. Quét mã vạch hoặc tìm hàng ở ô phía trên để bắt đầu đếm.</div>}
            {s.lines.length > 0 && !visible.length && <div className="muted" style={{ padding: 12 }}>{filter === 'uncounted' ? 'Tất cả các dòng đã được đếm.' : 'Không có dòng nào chênh lệch.'}</div>}
            {isMobile ? (
              <div className="tk-lines">
                {shown.map((l) => {
                  const c = counted(l); const sys = toNum(l.systemQuantity); const cur = toNum(l.currentOnHand ?? l.systemQuantity); const moved = cur !== sys; const st = local[l.id];
                  return (
                    <div key={l.id} id={`tk-line-${l.id}`} className={`tk-line${st?.status === 'error' ? ' error' : c !== null ? ' done' : ''}${focusId === l.id ? ' focus' : ''}`}>
                      <div className="nm">{l.variant.name}</div>
                      {canCount && <DeleteOutlined className="del" onClick={() => removeLine(l)} />}
                      <div className="meta"><span>{l.variant.sku}</span><span>· {l.variant.product.baseUnit ?? ''}</span>{l.batch && <Tag color="gold" style={{ marginInlineEnd: 0 }}>Lô {l.batch.batchNo}</Tag>}{canSeeCost && l.unitCost !== undefined && <span>· GV {money(l.unitCost)}</span>}</div>
                      <div className="stats">
                        <div className="stat"><div className="k">Tồn HT lúc chụp</div><div className="v">{qty(sys)}</div></div>
                        <div className="stat"><div className="k">Tồn hiện tại</div><div className={`v${moved ? '' : ' dim'}`}>{qty(cur)}</div></div>
                        <div className="stat"><div className="k">Chênh lệch</div><div className="v">{deltaChip(l)}</div></div>
                      </div>
                      <div className="tk-count-row"><span className="lbl">Thực tế</span>{countInput(l, true)}{eqButton(l)}<span className="spacer" />{saveState(l)}</div>
                      <div className="row"><span className="lbl">Ghi chú</span><Input placeholder="Ghi chú dòng" value={noteOf(l)} disabled={!canCount} onChange={(e) => saveLine(l, { note: e.target.value })} /></div>
                      {st?.err && <div className="err">{st.err} · <a onClick={() => retry(l)}>Thử lại</a></div>}
                      {moved && <div className="warn">Có giao dịch kể từ lúc chụp ({signedQty(cur - sys)}). Chỉ chênh lệch so với tồn lúc chụp được ghi nhận khi cân bằng.</div>}
                    </div>
                  );
                })}
              </div>
            ) : (
              <Table<StocktakeLine> className="tk-count-table" size="small" rowKey="id" pagination={false} dataSource={shown} scroll={{ x: 1100 }} onRow={(l) => ({ id: `tk-line-${l.id}` })} rowClassName={(l) => (local[l.id]?.status === 'error' ? 'kv-line-error' : '')}
                columns={[
                  { title: 'Mã hàng', width: 120, render: (_, l) => l.variant.sku },
                  { title: 'Tên hàng', width: 240, render: (_, l) => <span>{l.variant.name}{l.batch && <Tag style={{ marginLeft: 6 }} color="gold">Lô {l.batch.batchNo}</Tag>}{local[l.id]?.err && <div className="neg" style={{ fontSize: 12 }}>{local[l.id].err} · <a onClick={() => retry(l)}>Thử lại</a></div>}</span> },
                  { title: 'ĐVT', width: 60, render: (_, l) => l.variant.product.baseUnit ?? '' },
                  { title: 'Tồn HT (lúc chụp)', className: 'num', width: 130, render: (_, l) => qty(l.systemQuantity) },
                  { title: 'Tồn hiện tại', className: 'num', width: 110, render: (_, l) => { const cur = toNum(l.currentOnHand ?? l.systemQuantity); const moved = cur !== toNum(l.systemQuantity); return <span className={moved ? '' : 'muted'} title={moved ? `Có giao dịch kể từ lúc chụp (${signedQty(cur - toNum(l.systemQuantity))})` : ''}>{qty(cur)}{moved && ' *'}</span>; } },
                  { title: 'Thực tế', width: 240, render: (_, l) => <span style={{ display: 'inline-flex', alignItems: 'center', gap: 6 }}>{countInput(l, false)}{eqButton(l)}</span> },
                  { title: 'Chênh lệch', className: 'num', width: 100, render: (_, l) => deltaChip(l) },
                  ...(canSeeCost ? [{ title: 'Giá trị CL', className: 'num', width: 110, render: (_: unknown, l: StocktakeLine) => { const d = deltaOf(l); return d === null ? '' : <span className={d < 0 ? 'neg' : d > 0 ? 'pos' : ''}>{money(d * toNum(l.unitCost))}</span>; } }] : []),
                  { title: 'Ghi chú', width: 150, render: (_, l) => <Input size="small" value={noteOf(l)} disabled={!canCount} onChange={(e) => saveLine(l, { note: e.target.value })} /> },
                  { title: '', width: 110, render: (_, l) => saveState(l) },
                  { title: '', width: 40, render: (_, l) => canCount && <Button size="small" type="text" danger icon={<DeleteOutlined />} onClick={() => removeLine(l)} /> },
                ]} />
            )}
            {visible.length > shown.length && <div style={{ padding: 10, textAlign: 'center' }}><Button onClick={() => setLimit((n) => n + PAGE)}>Hiển thị thêm ({visible.length - shown.length} dòng)</Button></div>}
          </Card>
        </div>
        <div className="kv-doc-side">
          <Card size="small" title="Thông tin phiếu">
            <div className="kv-kv" style={{ marginBottom: 10 }}>
              <span className="k">Kho</span><span className="v">{s.warehouse?.name}</span>
              <span className="k">Chi nhánh</span><span className="v">{s.branch?.name}</span>
              <span className="k">Phạm vi</span><span className="v">{STOCKTAKE_SCOPE_LABEL[s.scope] ?? s.scope}</span>
              <span className="k">Chụp tồn lúc</span><span className="v">{dt(s.snapshotAt)}</span>
              <span className="k">Tạo lúc</span><span className="v">{dt(s.createdAt)}</span>
            </div>
            <div className="tk-field"><div className="kv-hint">Ghi chú phiếu</div><Input.TextArea rows={2} value={noteDraft} disabled={!canCount} onChange={(e) => setNoteDraft(e.target.value)} onBlur={saveNote} placeholder="Ghi chú phiếu kiểm" /></div>
            <div className="tk-totals">
              <span className="k">Đã đếm</span><span className="v">{stats.countedN}/{stats.total} dòng</span>
              <span className="k">Chưa đếm</span><span className={`v${stats.uncountedN ? ' tk-shortage' : ''}`}>{stats.uncountedN}</span>
              <span className="hr" />
              <span className="k">Tăng</span><span className="v pos">{signedQty(stats.inc)}{canSeeCost ? <span className="muted" style={{ fontWeight: 400 }}> · {money(stats.incV)}</span> : null}</span>
              <span className="k">Giảm</span><span className="v neg">-{qty(stats.dec)}{canSeeCost ? <span className="muted" style={{ fontWeight: 400 }}> · {money(stats.decV)}</span> : null}</span>
            </div>
            <Alert type="info" showIcon style={{ marginBottom: 8 }} message="Chênh lệch = thực tế − tồn hệ thống lúc chụp. Giao dịch phát sinh trong lúc kiểm đã được sổ kho ghi nhận nên không bị trừ hai lần; cột “Tồn hiện tại” chỉ để đối chiếu." />
            <div className="tk-actions">
              {canCount && <Button icon={<ReloadOutlined />} loading={refreshing} onClick={refreshSnapshot}>Làm mới tồn HT</Button>}
              {can('stocktake.complete') && <Button type="primary" icon={<CheckOutlined />} onClick={() => setCompleteOpen(true)} disabled={!s.lines.length}>Cân bằng kho</Button>}
              {can('stocktake.cancel') && <Button danger icon={<StopOutlined />} onClick={() => actions.cancel(s, () => nav('/stocktakes'))} title="Hủy phiếu" />}
            </div>
          </Card>
        </div>
      </div>

      <Modal title={`Cân bằng kho ${s.code}?`} open={completeOpen} onCancel={() => { setCompleteOpen(false); if (sp.get('action')) { sp.delete('action'); setSp(sp, { replace: true }); } }} onOk={complete} okText="Cân bằng kho" cancelText="Bỏ qua" confirmLoading={completing} okButtonProps={{ disabled: pendingCount > 0 || !s.lines.length }} destroyOnHidden>
        <div className="tk-modal-sum">
          <span className="k">Kho</span><span className="v">{s.warehouse?.name}</span>
          <span className="k">Số dòng</span><span className="v">{stats.total} · đã đếm {stats.countedN}{stats.uncountedN ? ` · chưa đếm ${stats.uncountedN}` : ''}</span>
          <span className="k">Dòng có chênh lệch</span><span className="v">{stats.diffN}</span>
          <span className="k">Tăng tồn</span><span className="v pos">{signedQty(stats.inc)}{canSeeCost ? ` · ${money(stats.incV)}` : ''}</span>
          <span className="k">Giảm tồn</span><span className="v neg">-{qty(stats.dec)}{canSeeCost ? ` · ${money(stats.decV)}` : ''}</span>
          {stats.uncountedN > 0 && uncountedAs === 'ZERO' && <><span className="k">Giảm thêm (dòng chưa đếm = 0)</span><span className="v neg">-{qty(stats.zeroQ)}{canSeeCost ? ` · ${money(stats.zeroV)}` : ''}</span></>}
        </div>
        {stats.uncountedN > 0 && (
          <div className="tk-field">
            <div className="kv-hint" style={{ marginBottom: 4 }}>{stats.uncountedN} dòng chưa đếm xử lý thế nào?</div>
            <Radio.Group className="tk-radio-block" value={uncountedAs} onChange={(e) => setUncountedAs(e.target.value)}>
              <Radio value="SKIP">Bỏ qua — giữ nguyên tồn<span className="sub">Không ghi bút toán cho các dòng chưa đếm.</span></Radio>
              <Radio value="ZERO">Coi như đếm được 0<span className="sub">Toàn bộ tồn hệ thống của các dòng chưa đếm sẽ bị trừ.</span></Radio>
            </Radio.Group>
          </div>
        )}
        {pendingCount > 0 && <Alert type="warning" showIcon style={{ marginBottom: 8 }} message={`Đang lưu ${pendingCount} dòng, vui lòng chờ…`} />}
        <Alert type="info" showIcon message="Mỗi dòng chênh lệch ≠ 0 sẽ ghi một bút toán kiểm kho theo giá vốn bình quân hiện tại. Sau khi cân bằng chỉ có thể hủy phiếu (ghi đảo toàn bộ)." />
      </Modal>

      <Modal title={batchPick ? `Chọn lô — ${batchPick.hit.name}` : 'Chọn lô'} open={!!batchPick} onCancel={() => setBatchPick(null)} footer={null} destroyOnHidden>
        {batchPick && (
          <div className="tk-batch-pick">
            {!batchPick.batches.length && <div className="muted">Hàng này chưa có lô nào. Tạo lô mới bên dưới.</div>}
            {batchPick.batches.map((b) => {
              const onHand = toNum(b.balances?.find((x) => x.warehouseId === s.warehouseId)?.onHand);
              const already = s.lines.some((l) => l.variantId === batchPick.hit.id && l.batchId === b.id);
              return <Button key={b.id} block className="tk-batch-row" onClick={() => { const hit = batchPick.hit; setBatchPick(null); void addOrFocus(hit.id, b.id, `${hit.name} (lô ${b.batchNo})`); }}><span><b>{b.batchNo}</b>{b.expiryDate ? <span className="muted"> · HSD {b.expiryDate.slice(0, 10)}</span> : null}{already && <Tag style={{ marginLeft: 6 }} color="green">đã có trong phiếu</Tag>}</span><span className="muted">Tồn {qty(onHand)}</span></Button>;
            })}
            <div style={{ display: 'flex', gap: 6, marginTop: 6 }}>
              <Input placeholder="Số lô mới" value={batchPick.newNo} onChange={(e) => setBatchPick((p) => p && { ...p, newNo: e.target.value })} onPressEnter={createBatch} />
              <Button icon={<PlusOutlined />} onClick={createBatch} disabled={!batchPick.newNo.trim()}>Tạo lô</Button>
            </div>
          </div>
        )}
      </Modal>
    </div>
  );
}

// ====================================================================== completed / cancelled (read-only)
function StocktakeView({ s }: { s: Stocktake }) {
  const nav = useNavigate();
  const can = useCan();
  const isMobile = useIsMobile();
  const actions = useStocktakeActions();
  const canSeeCost = can('inventory.cost.view');
  const [onlyDiff, setOnlyDiff] = useState(true);
  const lines = onlyDiff ? s.lines.filter((l) => toNum(l.deltaQuantity) !== 0) : s.lines;
  return (
    <div className="tk-editor">
      <div className="kv-editor-head">
        <Button type="link" icon={<ArrowLeftOutlined />} onClick={() => nav('/stocktakes')} style={{ paddingInline: 0 }} />
        <h1 className="kv-page-title" style={{ margin: 0 }}>Phiếu kiểm kho {s.code}</h1>
        <Tag color={STOCKTAKE_STATUS_COLOR[s.status]}>{STOCKTAKE_STATUS_LABEL[s.status]}</Tag>
      </div>
      <Card size="small" className="tk-detail">
        <Descriptions size="small" column={{ xs: 1, md: 3 }} colon={false} styles={{ label: { color: '#6b7280' } }}>
          <Descriptions.Item label="Kho">{s.warehouse?.name} <span className="muted">· {s.branch?.name}</span></Descriptions.Item>
          <Descriptions.Item label="Phạm vi">{STOCKTAKE_SCOPE_LABEL[s.scope] ?? s.scope}</Descriptions.Item>
          <Descriptions.Item label="Chụp tồn lúc">{dt(s.snapshotAt)}</Descriptions.Item>
          <Descriptions.Item label="Tạo lúc">{dt(s.createdAt)}</Descriptions.Item>
          {s.completedAt && <Descriptions.Item label="Cân bằng lúc">{dt(s.completedAt)}</Descriptions.Item>}
          {s.uncountedAs && <Descriptions.Item label="Dòng chưa đếm">{s.uncountedAs === 'ZERO' ? 'Coi như 0' : 'Giữ nguyên tồn'}</Descriptions.Item>}
          <Descriptions.Item label="Tiến độ"><StocktakeProgress s={s} /></Descriptions.Item>
          <Descriptions.Item label="Tăng tồn"><span className="pos">{signedQty(s.increaseQuantity)}</span>{canSeeCost && s.increaseValue !== undefined ? <span className="muted"> · {money(s.increaseValue)}</span> : null}</Descriptions.Item>
          <Descriptions.Item label="Giảm tồn"><span className="neg">-{qty(s.decreaseQuantity)}</span>{canSeeCost && s.decreaseValue !== undefined ? <span className="muted"> · {money(s.decreaseValue)}</span> : null}</Descriptions.Item>
          {s.cancelledAt && <Descriptions.Item label="Hủy lúc">{dt(s.cancelledAt)} · {s.cancelReason}</Descriptions.Item>}
          <Descriptions.Item label="Ghi chú">{s.note || '—'}</Descriptions.Item>
        </Descriptions>
        <div style={{ display: 'flex', alignItems: 'center', gap: 8, margin: '6px 0' }}><Segmented size="small" value={onlyDiff ? 'diff' : 'all'} onChange={(v) => setOnlyDiff(v === 'diff')} options={[{ value: 'diff', label: `Có chênh lệch (${s.lines.filter((l) => toNum(l.deltaQuantity) !== 0).length})` }, { value: 'all', label: `Tất cả (${s.lines.length})` }]} /></div>
        {isMobile ? (
          <div className="tk-detail-lines">
            {!lines.length && <div className="muted">Không có dòng nào.</div>}
            {lines.map((l) => { const d = toNum(l.deltaQuantity); return (
              <div key={l.id} className="tk-detail-line">
                <div className="nm">{l.variant.name}</div>
                <div className="nums"><span className={`tk-delta ${d > 0 ? 'pos' : d < 0 ? 'neg' : ''}`}>{l.countedQuantity === null ? '—' : signedQty(d)}</span></div>
                <div className="meta">{l.variant.sku}{l.batch ? ` · Lô ${l.batch.batchNo}` : ''} · HT {qty(l.systemQuantity)} → TT {l.countedQuantity === null ? 'chưa đếm' : qty(l.countedQuantity)}{canSeeCost && l.deltaValue !== undefined ? ` · ${money(l.deltaValue)}` : ''}{l.note ? ` · ${l.note}` : ''}</div>
              </div>
            ); })}
          </div>
        ) : (
          <Table<StocktakeLine> size="small" rowKey="id" pagination={lines.length > 50 ? { pageSize: 50 } : false} dataSource={lines}
            columns={[
              { title: 'Mã hàng', width: 120, render: (_, l) => l.variant.sku },
              { title: 'Tên hàng', render: (_, l) => <span>{l.variant.name}{l.batch && <Tag style={{ marginLeft: 6 }} color="gold">Lô {l.batch.batchNo}</Tag>}</span> },
              { title: 'ĐVT', width: 70, render: (_, l) => l.variant.product.baseUnit ?? '' },
              { title: 'Tồn HT (lúc chụp)', className: 'num', width: 130, render: (_, l) => qty(l.systemQuantity) },
              { title: 'Thực tế', className: 'num', width: 90, render: (_, l) => l.countedQuantity === null ? <span className="muted">—</span> : qty(l.countedQuantity) },
              { title: 'Chênh lệch', className: 'num', width: 100, render: (_, l) => { const d = toNum(l.deltaQuantity); return <span className={`tk-delta ${d > 0 ? 'pos' : d < 0 ? 'neg' : ''}`}>{signedQty(d)}</span>; } },
              ...(canSeeCost ? [{ title: 'Giá vốn', dataIndex: 'unitCost', className: 'num', width: 100, render: (v: string) => money(v) }, { title: 'Giá trị CL', dataIndex: 'deltaValue', className: 'num', width: 120, render: (v: string) => <span className={toNum(v) < 0 ? 'neg' : toNum(v) > 0 ? 'pos' : ''}>{money(v)}</span> }] : []),
              { title: 'Ghi chú', dataIndex: 'note', ellipsis: true },
            ]} />
        )}
        {(s.movements?.length ?? 0) > 0 && (
          <Table size="small" rowKey="id" pagination={false} dataSource={s.movements} style={{ marginTop: 8 }} title={() => <b>Bút toán kho</b>} scroll={{ x: 600 }}
            columns={[{ title: 'Thời gian', dataIndex: 'createdAt', width: 150, render: (v) => dt(v, 'DD/MM/YYYY HH:mm:ss') }, { title: 'Loại', dataIndex: 'type', width: 110, render: (v) => <Tag color={v === 'REVERSAL' ? 'red' : 'default'}>{MOVEMENT_LABEL[v] ?? v}</Tag> }, { title: 'Hàng', render: (_, m) => s.lines.find((l) => l.variantId === m.variantId)?.variant.sku ?? m.variantId }, { title: 'SL', dataIndex: 'quantity', className: 'num', width: 80, render: (v) => <span className={Number(v) >= 0 ? 'pos' : 'neg'}>{signedQty(v)}</span> }, ...(canSeeCost ? [{ title: 'Giá vốn', dataIndex: 'unitCost', className: 'num', width: 100, render: (v: string) => money(v) }] : []), { title: 'Tồn sau', dataIndex: 'balanceAfter', className: 'num', width: 90, render: (v) => qty(v) }]} />
        )}
        <div className="kv-detail-actions">
          {s.status === 'COMPLETED' && can('stocktake.cancel') && <Button danger icon={<StopOutlined />} onClick={() => actions.cancel(s)}>Hủy phiếu (ghi đảo)</Button>}
          <Link to={`/inventory/movements?documentId=${s.id}`}>Xem thẻ kho</Link>
        </div>
      </Card>
    </div>
  );
}
