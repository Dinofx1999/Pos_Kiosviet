import './transfers.css';
import { App, Button, DatePicker, Descriptions, Empty, Input, Pagination, Progress, Radio, Select, Table, Tag } from 'antd';
import { CheckOutlined, DownOutlined, EditOutlined, EyeOutlined, PlusOutlined, ReloadOutlined, SearchOutlined, StopOutlined, UpOutlined } from '@ant-design/icons';
import { useEffect, useMemo, useState } from 'react';
import { Link, useNavigate, useSearchParams } from 'react-router-dom';
import { useQueryClient } from '@tanstack/react-query';
import { STOCKTAKE_SCOPE_LABEL, STOCKTAKE_STATUS_COLOR, STOCKTAKE_STATUS_LABEL, Stocktake, StocktakeQuery, StocktakeRow, TRANSFER_KEYS, stocktakesApi, useStocktake, useStocktakes } from '../../api/transfers';
import { errMsg } from '../../api/client';
import { FilterCard, FilterPanel } from '../../components/FilterPanel';
import { useIsMobile } from '../../hooks/useMedia';
import { useAuthStore, useBranchWarehouses, useCan } from '../../store/auth';
import { dt, money, qty, signedQty, toNum } from '../../utils/format';

/** Shared mutations with confirmation dialogs (list + editor). */
export function useStocktakeActions() {
  const { message, modal } = App.useApp();
  const qc = useQueryClient();
  const refresh = () => TRANSFER_KEYS.forEach((k) => qc.invalidateQueries({ queryKey: [k] }));
  const fail = (e: unknown) => {
    const err = e as { code?: string; message: string; statusCode?: number };
    if (err.statusCode === 403 || err.code === 'BRANCH_ACCESS_DENIED' || err.code === 'WAREHOUSE_ACCESS_DENIED') message.error(`${err.message}. Bạn cần thuộc chi nhánh của kho được kiểm.`);
    else message.error(err.message);
    if (err.code === 'VERSION_CONFLICT') refresh();
  };
  const cancel = (s: Pick<Stocktake, 'id' | 'code' | 'status'>, after?: (s: Stocktake) => void) => {
    let reason = '';
    modal.confirm({
      title: `Hủy phiếu kiểm kho ${s.code}?`,
      content: <div>{s.status === 'COMPLETED' ? 'Phiếu đã cân bằng: toàn bộ bút toán chênh lệch sẽ được ghi đảo, tồn kho quay về như trước khi cân bằng.' : 'Phiếu đang kiểm sẽ bị hủy, số đếm không được ghi nhận.'}<Input.TextArea style={{ marginTop: 8 }} placeholder="Lý do hủy (bắt buộc)" onChange={(e) => (reason = e.target.value)} /></div>,
      okText: 'Hủy phiếu', okButtonProps: { danger: true }, cancelText: 'Bỏ qua',
      onOk: async () => { if (!reason.trim()) { message.warning('Nhập lý do hủy'); throw new Error('reason'); } try { const r = await stocktakesApi.cancel(s.id, reason.trim()); message.success('Đã hủy phiếu kiểm kho'); qc.setQueryData(['stocktake', s.id], r); refresh(); after?.(r); } catch (e) { fail(e); throw e; } },
    });
  };
  return { cancel, refresh, fail };
}

export function StocktakeProgress({ s }: { s: Pick<StocktakeRow, 'countedLines' | 'totalLines'> }) {
  const pct = s.totalLines ? Math.round((s.countedLines / s.totalLines) * 100) : 0;
  return <div className="tk-progress"><Progress percent={pct} size="small" showInfo={false} status={pct === 100 ? 'success' : 'active'} /><span style={{ whiteSpace: 'nowrap' }}>{s.countedLines}/{s.totalLines} dòng</span></div>;
}

export default function StocktakesPage() {
  const can = useCan();
  const nav = useNavigate();
  const [sp] = useSearchParams();
  const isMobile = useIsMobile();
  const me = useAuthStore((s) => s.me);
  const currentBranchId = useAuthStore((s) => s.currentBranchId);
  const warehouses = useBranchWarehouses();
  const [branchSel, setBranchSel] = useState<string>('');
  const [q, setQ] = useState<StocktakeQuery>({ page: 1, pageSize: 20, search: sp.get('search') ?? undefined, status: sp.get('status') ?? undefined });
  const [searchText, setSearchText] = useState(q.search ?? '');
  const [expanded, setExpanded] = useState<string[]>([]);
  useEffect(() => { const s = sp.get('search'); if (s) { setSearchText(s); setQ((x) => ({ ...x, search: s, page: 1 })); } }, [sp]);
  const branchId = branchSel === 'all' ? undefined : branchSel || currentBranchId || undefined;
  const { data, isLoading, isFetching, error, refetch } = useStocktakes({ ...q, branchId });
  const set = (patch: Partial<StocktakeQuery>) => setQ((s) => ({ ...s, ...patch, page: patch.page ?? 1 }));
  const rows = data?.data ?? [];
  const total = data?.meta.total ?? 0;
  const toggle = (id: string) => setExpanded((p) => (p.includes(id) ? p.filter((x) => x !== id) : [...p, id]));
  const canSeeCost = can('inventory.cost.view');
  const sum = useMemo(() => rows.reduce((s, r) => (r.status === 'COMPLETED' ? { inc: s.inc + toNum(r.increaseQuantity), dec: s.dec + toNum(r.decreaseQuantity), counting: s.counting } : { ...s, counting: s.counting + (r.status === 'DRAFT' ? 1 : 0) }), { inc: 0, dec: 0, counting: 0 }), [rows]);

  const filters = (
    <FilterPanel>
      <FilterCard title="Trạng thái"><Radio.Group value={q.status ?? ''} onChange={(e) => set({ status: e.target.value || undefined })}><Radio value="">Tất cả</Radio><Radio value="DRAFT">Đang kiểm</Radio><Radio value="COMPLETED">Đã cân bằng</Radio><Radio value="CANCELLED">Đã hủy</Radio></Radio.Group></FilterCard>
      <FilterCard title="Chi nhánh"><Radio.Group value={branchSel} onChange={(e) => { setBranchSel(e.target.value); set({ warehouseId: undefined }); }}><Radio value="">Chi nhánh đang chọn</Radio><Radio value="all">Tất cả chi nhánh</Radio>{(me?.branches ?? []).map((b) => <Radio key={b.id} value={b.id}>{b.name}</Radio>)}</Radio.Group></FilterCard>
      <FilterCard title="Kho"><Select size="small" allowClear style={{ width: '100%' }} placeholder="Tất cả kho" value={q.warehouseId} onChange={(v) => set({ warehouseId: v })} options={(branchSel ? (me?.warehouses ?? []).filter((w) => branchSel === 'all' || w.branchId === branchSel) : warehouses).map((w) => ({ value: w.id, label: branchSel === 'all' ? `${w.name} · ${w.branchName ?? ''}` : w.name }))} /></FilterCard>
      <FilterCard title="Thời gian tạo"><DatePicker.RangePicker size="small" style={{ width: '100%' }} format="DD/MM/YYYY" onChange={(r) => set({ from: r?.[0]?.startOf('day').toISOString(), to: r?.[1]?.endOf('day').toISOString() })} /></FilterCard>
    </FilterPanel>
  );

  return (
    <div className="kv-list">
      {filters}
      <div className="kv-main">
        <h1 className="kv-page-title">Kiểm kho</h1>
        <div className="kv-toolbar">
          <Input.Search className="kv-search" allowClear placeholder="Theo mã phiếu, ghi chú" value={searchText} onChange={(e) => setSearchText(e.target.value)} onSearch={(v) => set({ search: v || undefined })} enterButton={<SearchOutlined />} />
          <span className="spacer" />
          {can('stocktake.create') && <Button type="primary" icon={<PlusOutlined />} onClick={() => nav('/stocktakes/new')}>Kiểm kho</Button>}
          <Button icon={<ReloadOutlined />} onClick={() => refetch()} loading={isFetching} />
        </div>
        <div className="tk-summary">
          <div className="tk-tile"><div className="lbl">Đang kiểm{total > rows.length ? ' (trang này)' : ''}</div><div className="val">{sum.counting}</div></div>
          <div className="tk-tile"><div className="lbl">SL tăng</div><div className="val pos">{signedQty(sum.inc)}</div></div>
          <div className="tk-tile"><div className="lbl">SL giảm</div><div className={`val${sum.dec > 0 ? ' neg' : ''}`}>{sum.dec > 0 ? `-${qty(sum.dec)}` : '0'}</div></div>
        </div>
        {isMobile ? (
          <div>
            {isLoading && <div className="muted" style={{ padding: 12 }}>Đang tải…</div>}
            {!isLoading && !rows.length && <div className="kv-card tk-empty"><Empty description={error ? errMsg(error) : 'Chưa có phiếu kiểm kho'} /></div>}
            <div className="tk-cards">
              {rows.map((r) => {
                const open = expanded.includes(r.id);
                return (
                  <div key={r.id} className="tk-card" onClick={() => toggle(r.id)}>
                    <div className="tk-card-head"><span><span className="code">{r.code}</span> <Tag color={STOCKTAKE_STATUS_COLOR[r.status]}>{STOCKTAKE_STATUS_LABEL[r.status]}</Tag></span><span className="muted">{open ? <UpOutlined /> : <DownOutlined />}</span></div>
                    <div className="tk-card-meta"><b style={{ color: '#111827' }}>{r.warehouse?.name}</b> · {r.branch?.name} · {STOCKTAKE_SCOPE_LABEL[r.scope] ?? r.scope}</div>
                    <div className="tk-card-meta">{dt(r.createdAt)}{r.completedAt ? ` · cân bằng ${dt(r.completedAt)}` : ''}{r.note ? ` · ${r.note}` : ''}</div>
                    <div style={{ marginTop: 6 }}><StocktakeProgress s={r} /></div>
                    {r.status === 'COMPLETED' && <div className="tk-card-amts"><span>Tăng <b className="pos">{signedQty(r.increaseQuantity)}</b>{canSeeCost && r.increaseValue !== undefined ? <span className="muted"> ({money(r.increaseValue)})</span> : null}</span><span>Giảm <b className="neg">-{qty(r.decreaseQuantity)}</b>{canSeeCost && r.decreaseValue !== undefined ? <span className="muted"> ({money(r.decreaseValue)})</span> : null}</span></div>}
                    {open && <div className="tk-card-body" onClick={(e) => e.stopPropagation()}><StocktakeDetail id={r.id} /></div>}
                  </div>
                );
              })}
            </div>
            {total > (q.pageSize ?? 20) && <div className="tk-pager"><Pagination simple current={q.page} pageSize={q.pageSize} total={total} onChange={(page, pageSize) => set({ page, pageSize })} /></div>}
          </div>
        ) : (
          <div className="kv-card">
            <Table<StocktakeRow> className="kv-table" rowKey="id" size="small" loading={isLoading} dataSource={rows} scroll={{ x: 1150 }}
              locale={{ emptyText: error ? <Empty description={errMsg(error)} /> : <Empty description="Chưa có phiếu kiểm kho" /> }}
              expandable={{ expandedRowRender: (r) => <div className="kv-expanded"><StocktakeDetail id={r.id} /></div>, expandRowByClick: true }}
              onChange={(p) => set({ page: p.current, pageSize: p.pageSize })}
              pagination={{ current: q.page, pageSize: q.pageSize, total, showSizeChanger: true, pageSizeOptions: [15, 20, 50, 100], showTotal: (t) => `${t} phiếu` }}
              columns={[
                { title: 'Mã phiếu', dataIndex: 'code', width: 130, render: (v) => <b>{v}</b> },
                { title: 'Kho', width: 160, render: (_, r) => <span>{r.warehouse?.name}<div className="kv-hint">{r.branch?.name}</div></span> },
                { title: 'Phạm vi', dataIndex: 'scope', width: 110, render: (v) => STOCKTAKE_SCOPE_LABEL[v] ?? v },
                { title: 'Tiến độ đếm', width: 200, render: (_, r) => <StocktakeProgress s={r} /> },
                { title: 'SL tăng', className: 'num', width: 90, render: (_, r) => r.status === 'COMPLETED' ? <span className="pos">{signedQty(r.increaseQuantity)}</span> : '' },
                { title: 'SL giảm', className: 'num', width: 90, render: (_, r) => r.status === 'COMPLETED' ? <span className="neg">-{qty(r.decreaseQuantity)}</span> : '' },
                ...(canSeeCost ? [{ title: 'Giá trị tăng', dataIndex: 'increaseValue', className: 'num', width: 120, render: (v: string, r: StocktakeRow) => r.status === 'COMPLETED' ? money(v) : '' }, { title: 'Giá trị giảm', dataIndex: 'decreaseValue', className: 'num', width: 120, render: (v: string, r: StocktakeRow) => r.status === 'COMPLETED' ? money(v) : '' }] : []),
                { title: 'Trạng thái', dataIndex: 'status', width: 110, render: (v) => <Tag color={STOCKTAKE_STATUS_COLOR[v]}>{STOCKTAKE_STATUS_LABEL[v]}</Tag> },
                { title: 'Thời gian', dataIndex: 'createdAt', width: 140, render: (v, r) => <span>{dt(v)}{r.completedAt && <div className="kv-hint">Cân bằng: {dt(r.completedAt)}</div>}</span> },
                { title: 'Ghi chú', dataIndex: 'note', ellipsis: true },
              ]} />
          </div>
        )}
      </div>
    </div>
  );
}

/** Expanded detail: header, lines with a difference (max 50) and the state-dependent actions. */
export function StocktakeDetail({ id }: { id: string }) {
  const { data: s, isLoading, error } = useStocktake(id);
  const can = useCan();
  const nav = useNavigate();
  const isMobile = useIsMobile();
  const actions = useStocktakeActions();
  const canSeeCost = can('inventory.cost.view');
  if (isLoading) return <div className="muted">Đang tải…</div>;
  if (!s) return <div className="neg">{error ? errMsg(error) : 'Không tìm thấy phiếu'}</div>;
  const delta = (l: Stocktake['lines'][number]) => (s.status === 'DRAFT' ? (l.pendingDelta === null ? null : toNum(l.pendingDelta)) : (l.countedQuantity === null ? null : toNum(l.deltaQuantity)));
  const diffLines = s.lines.filter((l) => { const d = delta(l); return d !== null && d !== 0; });
  const shown = diffLines.slice(0, 50);
  const uncounted = s.lines.filter((l) => l.countedQuantity === null).length;

  return (
    <div className="tk-detail">
      <Descriptions size="small" column={{ xs: 1, md: 3 }} colon={false} styles={{ label: { color: '#6b7280' } }}>
        <Descriptions.Item label="Mã phiếu"><b>{s.code}</b></Descriptions.Item>
        <Descriptions.Item label="Trạng thái"><Tag color={STOCKTAKE_STATUS_COLOR[s.status]}>{STOCKTAKE_STATUS_LABEL[s.status]}</Tag></Descriptions.Item>
        <Descriptions.Item label="Kho">{s.warehouse?.name} <span className="muted">· {s.branch?.name}</span></Descriptions.Item>
        <Descriptions.Item label="Phạm vi">{STOCKTAKE_SCOPE_LABEL[s.scope] ?? s.scope}</Descriptions.Item>
        <Descriptions.Item label="Chụp tồn lúc">{dt(s.snapshotAt)}</Descriptions.Item>
        <Descriptions.Item label="Tiến độ">{s.countedLines}/{s.totalLines} dòng đã đếm{uncounted > 0 && s.status === 'DRAFT' ? ` · ${uncounted} chưa đếm` : ''}</Descriptions.Item>
        {s.completedAt && <Descriptions.Item label="Cân bằng lúc">{dt(s.completedAt)}{s.uncountedAs ? ` · dòng chưa đếm: ${s.uncountedAs === 'ZERO' ? 'coi như 0' : 'giữ nguyên'}` : ''}</Descriptions.Item>}
        {s.status === 'COMPLETED' && <Descriptions.Item label="Kết quả"><span className="pos">{signedQty(s.increaseQuantity)}</span> / <span className="neg">-{qty(s.decreaseQuantity)}</span>{canSeeCost && s.increaseValue !== undefined ? <span className="muted"> · {money(s.increaseValue)} / {money(s.decreaseValue)}</span> : null}</Descriptions.Item>}
        {s.cancelledAt && <Descriptions.Item label="Hủy lúc">{dt(s.cancelledAt)} · {s.cancelReason}</Descriptions.Item>}
        <Descriptions.Item label="Ghi chú">{s.note || '—'}</Descriptions.Item>
      </Descriptions>
      <div className="kv-hint" style={{ margin: '4px 0 6px' }}>{diffLines.length ? `${diffLines.length} dòng có chênh lệch${diffLines.length > shown.length ? ` (hiển thị ${shown.length})` : ''} — chênh lệch = thực tế − tồn hệ thống lúc chụp` : s.totalLines ? 'Chưa có dòng nào chênh lệch' : 'Phiếu chưa có dòng nào'}</div>
      {shown.length > 0 && (isMobile ? (
        <div className="tk-detail-lines">
          {shown.map((l) => { const d = delta(l) ?? 0; return (
            <div key={l.id} className="tk-detail-line">
              <div className="nm">{l.variant.name}</div>
              <div className="nums"><span className={`tk-delta ${d > 0 ? 'pos' : 'neg'}`}>{signedQty(d)}</span></div>
              <div className="meta">{l.variant.sku}{l.batch ? ` · Lô ${l.batch.batchNo}` : ''} · HT {qty(l.systemQuantity)} → TT {qty(l.countedQuantity)}{canSeeCost && l.deltaValue !== undefined && s.status !== 'DRAFT' ? ` · ${money(l.deltaValue)}` : ''}</div>
            </div>
          ); })}
        </div>
      ) : (
        <Table size="small" rowKey="id" pagination={false} dataSource={shown}
          columns={[
            { title: 'Mã hàng', width: 120, render: (_, l) => l.variant.sku },
            { title: 'Tên hàng', render: (_, l) => <span>{l.variant.name}{l.batch && <Tag style={{ marginLeft: 6 }} color="gold">Lô {l.batch.batchNo}</Tag>}</span> },
            { title: 'ĐVT', width: 70, render: (_, l) => l.variant.product.baseUnit ?? '' },
            { title: 'Tồn HT (lúc chụp)', className: 'num', width: 130, render: (_, l) => qty(l.systemQuantity) },
            { title: 'Thực tế', className: 'num', width: 90, render: (_, l) => qty(l.countedQuantity) },
            { title: 'Chênh lệch', className: 'num', width: 100, render: (_, l) => { const d = delta(l) ?? 0; return <span className={`tk-delta ${d > 0 ? 'pos' : 'neg'}`}>{signedQty(d)}</span>; } },
            ...(canSeeCost && s.status !== 'DRAFT' ? [{ title: 'Giá trị CL', dataIndex: 'deltaValue', className: 'num', width: 120, render: (v: string) => <span className={toNum(v) < 0 ? 'neg' : 'pos'}>{money(v)}</span> }] : []),
            { title: 'Ghi chú', dataIndex: 'note', ellipsis: true },
          ]} />
      ))}
      <div className="kv-detail-actions">
        {s.status === 'DRAFT' && can('stocktake.create') && <Button type="primary" icon={<EditOutlined />} onClick={() => nav(`/stocktakes/${s.id}`)}>Tiếp tục kiểm</Button>}
        {s.status === 'DRAFT' && can('stocktake.complete') && <Button icon={<CheckOutlined />} onClick={() => nav(`/stocktakes/${s.id}?action=complete`)}>Cân bằng kho</Button>}
        {s.status !== 'DRAFT' && <Button icon={<EyeOutlined />} onClick={() => nav(`/stocktakes/${s.id}`)}>Xem chi tiết</Button>}
        {s.status !== 'CANCELLED' && can('stocktake.cancel') && <Button danger icon={<StopOutlined />} onClick={() => actions.cancel(s)}>{s.status === 'COMPLETED' ? 'Hủy (ghi đảo)' : 'Hủy phiếu'}</Button>}
        {s.status !== 'DRAFT' && <Link to={`/inventory/movements?documentId=${s.id}`}>Xem thẻ kho</Link>}
      </div>
    </div>
  );
}
