import './transfers.css';
import { App, Button, DatePicker, Descriptions, Empty, Input, Pagination, Radio, Segmented, Select, Tag } from 'antd';
import Table from '../../components/ResponsiveTable';
import { ArrowRightOutlined, DeleteOutlined, DownOutlined, EditOutlined, EyeOutlined, InboxOutlined, PlusOutlined, ReloadOutlined, SearchOutlined, SendOutlined, StopOutlined, UpOutlined } from '@ant-design/icons';
import { useEffect, useMemo, useState } from 'react';
import { Link, useNavigate, useSearchParams } from 'react-router-dom';
import { useQueryClient } from '@tanstack/react-query';
import { SHORTAGE_ACTION_LABEL, TRANSFER_KEYS, TRANSFER_STATUS_COLOR, TRANSFER_STATUS_LABEL, Transfer, TransferQuery, TransferRow, transfersApi, useTransfer, useTransfers } from '../../api/transfers';
import { useWarehouses } from '../../api/org';
import { errMsg } from '../../api/client';
import { FilterCard, FilterPanel } from '../../components/FilterPanel';
import { useIsMobile } from '../../hooks/useMedia';
import { useAuthStore, useCan } from '../../store/auth';
import { MOVEMENT_LABEL, dt, money, qty, signedQty, toNum } from '../../utils/format';

type Direction = 'out' | 'in' | 'all';

/** true when the current user belongs to the branch (owners see every active branch in `me.branches`). */
export function useInBranch() {
  const me = useAuthStore((s) => s.me);
  return (branchId?: string | null) => !!branchId && !!me && (me.user.isOwner || me.user.allBranches || me.branches.some((b) => b.id === branchId));
}

export function TransferRoute({ t, compact }: { t: Pick<TransferRow, 'fromWarehouse' | 'toWarehouse' | 'fromBranch' | 'toBranch'>; compact?: boolean }) {
  return (
    <span className="tk-route">
      <span><span className="wh">{t.fromWarehouse?.name}</span>{!compact && t.fromBranch && <span className="br"> · {t.fromBranch.name}</span>}</span>
      <ArrowRightOutlined className="arrow" />
      <span><span className="wh">{t.toWarehouse?.name}</span>{!compact && t.toBranch && <span className="br"> · {t.toBranch.name}</span>}</span>
    </span>
  );
}

/** Shared mutations with confirmation dialogs (list detail + editor). */
export function useTransferActions() {
  const { message, modal } = App.useApp();
  const qc = useQueryClient();
  const nav = useNavigate();
  const refresh = () => TRANSFER_KEYS.forEach((k) => qc.invalidateQueries({ queryKey: [k] }));
  const fail = (e: unknown) => {
    const err = e as { code?: string; message: string; statusCode?: number };
    if (err.statusCode === 403 || err.code === 'BRANCH_ACCESS_DENIED' || err.code === 'WAREHOUSE_ACCESS_DENIED') message.error(`${err.message}. Người xuất/hủy phải thuộc chi nhánh gửi, người nhận phải thuộc chi nhánh nhận.`);
    else message.error(err.message);
    if (err.code === 'VERSION_CONFLICT') refresh();
  };
  const dispatch = (t: Pick<Transfer, 'id' | 'code' | 'version' | 'totalQuantity' | 'fromWarehouse' | 'toWarehouse'>, after?: (t: Transfer) => void) => modal.confirm({
    title: `Xuất chuyển kho ${t.code}?`,
    content: <div>Hàng sẽ được xuất khỏi <b>{t.fromWarehouse?.name}</b> ({qty(t.totalQuantity)} đơn vị) và ở trạng thái <b>đang chuyển</b> cho đến khi <b>{t.toWarehouse?.name}</b> xác nhận nhận hàng. Phiếu sẽ bị từ chối nếu kho nguồn không đủ tồn.</div>,
    okText: 'Xuất chuyển', cancelText: 'Bỏ qua',
    onOk: async () => { try { const r = await transfersApi.dispatch(t.id, t.version); message.success(`Đã xuất chuyển kho ${r.code}`); refresh(); after?.(r); } catch (e) { fail(e); throw e; } },
  });
  const cancel = (t: Pick<Transfer, 'id' | 'code' | 'status'>, after?: (t: Transfer) => void) => {
    let reason = '';
    modal.confirm({
      title: `Hủy phiếu chuyển kho ${t.code}?`,
      content: <div>{t.status === 'IN_TRANSIT' ? 'Hàng đang chuyển sẽ được ghi đảo về kho nguồn theo đúng giá vốn lúc xuất; kho đích không còn hàng đang về.' : 'Phiếu tạm sẽ được đánh dấu đã hủy.'}<Input.TextArea style={{ marginTop: 8 }} placeholder="Lý do hủy (bắt buộc)" onChange={(e) => (reason = e.target.value)} /></div>,
      okText: 'Hủy phiếu', okButtonProps: { danger: true }, cancelText: 'Bỏ qua',
      onOk: async () => { if (!reason.trim()) { message.warning('Nhập lý do hủy'); throw new Error('reason'); } try { const r = await transfersApi.cancel(t.id, reason.trim()); message.success('Đã hủy phiếu'); refresh(); after?.(r); } catch (e) { fail(e); throw e; } },
    });
  };
  const remove = (t: Pick<Transfer, 'id' | 'code'>, after?: () => void) => modal.confirm({
    title: `Xóa phiếu tạm ${t.code}?`, okText: 'Xóa', okButtonProps: { danger: true }, cancelText: 'Bỏ qua',
    onOk: async () => { try { await transfersApi.remove(t.id); message.success('Đã xóa'); qc.removeQueries({ queryKey: ['transfer', t.id] }); qc.invalidateQueries({ queryKey: ['transfers'] }); if (after) after(); else nav('/transfers'); } catch (e) { fail(e); throw e; } },
  });
  return { dispatch, cancel, remove, refresh, fail };
}

export default function TransfersPage() {
  const can = useCan();
  const nav = useNavigate();
  const [sp] = useSearchParams();
  const isMobile = useIsMobile();
  const me = useAuthStore((s) => s.me);
  const currentBranchId = useAuthStore((s) => s.currentBranchId);
  const { data: allWarehouses } = useWarehouses();
  const [dir, setDir] = useState<Direction>(((sp.get('dir') as Direction) || 'all'));
  const [branchSel, setBranchSel] = useState<string>(''); // '' = current branch, 'all' = every branch, else branch id
  const [q, setQ] = useState<TransferQuery>({ page: 1, pageSize: 20, search: sp.get('search') ?? undefined, status: sp.get('status') ?? undefined });
  const [searchText, setSearchText] = useState(q.search ?? '');
  const [expanded, setExpanded] = useState<string[]>([]);
  useEffect(() => { const s = sp.get('search'); if (s) { setSearchText(s); setQ((x) => ({ ...x, search: s, page: 1 })); } }, [sp]);
  const branchId = branchSel === 'all' ? undefined : branchSel || currentBranchId || undefined;
  const { data, isLoading, isFetching, error, refetch } = useTransfers({ ...q, branchId, direction: dir === 'all' ? undefined : dir });
  const set = (patch: Partial<TransferQuery>) => setQ((s) => ({ ...s, ...patch, page: patch.page ?? 1 }));
  const rows = data?.data ?? [];
  const total = data?.meta.total ?? 0;
  const toggle = (id: string) => setExpanded((p) => (p.includes(id) ? p.filter((x) => x !== id) : [...p, id]));
  const whOptions = useMemo(() => (allWarehouses ?? []).map((w) => ({ value: w.id, label: `${w.name}${w.branch ? ` · ${w.branch.name}` : ''}` })), [allWarehouses]);
  const sum = useMemo(() => rows.reduce((s, r) => ({ qty: s.qty + (r.status === 'CANCELLED' ? 0 : toNum(r.totalQuantity)), transit: s.transit + (r.status === 'IN_TRANSIT' ? 1 : 0), shortage: s.shortage + toNum(r.shortageQuantity) }), { qty: 0, transit: 0, shortage: 0 }), [rows]);

  const filters = (
    <FilterPanel>
      <FilterCard title="Trạng thái"><Radio.Group value={q.status ?? ''} onChange={(e) => set({ status: e.target.value || undefined })}><Radio value="">Tất cả</Radio><Radio value="DRAFT">Phiếu tạm</Radio><Radio value="IN_TRANSIT">Đang chuyển</Radio><Radio value="RECEIVED">Đã nhận</Radio><Radio value="CANCELLED">Đã hủy</Radio></Radio.Group></FilterCard>
      <FilterCard title="Chi nhánh"><Radio.Group value={branchSel} onChange={(e) => { setBranchSel(e.target.value); set({}); }}><Radio value="">Chi nhánh đang chọn</Radio><Radio value="all">Tất cả chi nhánh</Radio>{(me?.branches ?? []).map((b) => <Radio key={b.id} value={b.id}>{b.name}</Radio>)}</Radio.Group></FilterCard>
      <FilterCard title="Kho gửi"><Select size="small" allowClear showSearch optionFilterProp="label" style={{ width: '100%' }} placeholder="Tất cả" value={q.fromWarehouseId} onChange={(v) => set({ fromWarehouseId: v })} options={whOptions} /></FilterCard>
      <FilterCard title="Kho nhận"><Select size="small" allowClear showSearch optionFilterProp="label" style={{ width: '100%' }} placeholder="Tất cả" value={q.toWarehouseId} onChange={(v) => set({ toWarehouseId: v })} options={whOptions} /></FilterCard>
      <FilterCard title="Thời gian tạo"><DatePicker.RangePicker size="small" style={{ width: '100%' }} format="DD/MM/YYYY" onChange={(r) => set({ from: r?.[0]?.startOf('day').toISOString(), to: r?.[1]?.endOf('day').toISOString() })} /></FilterCard>
    </FilterPanel>
  );

  const columns = [
    { title: 'Mã phiếu', dataIndex: 'code', width: 130, render: (v: string) => <b>{v}</b> },
    { title: 'Kho gửi → Kho nhận', width: 320, render: (_: unknown, r: TransferRow) => <TransferRoute t={r} /> },
    { title: 'Số dòng', width: 70, className: 'num', render: (_: unknown, r: TransferRow) => r._count?.lines },
    { title: 'SL gửi', dataIndex: 'totalQuantity', className: 'num', width: 90, render: (v: string) => qty(v) },
    { title: 'SL nhận', className: 'num', width: 90, render: (_: unknown, r: TransferRow) => r.status === 'RECEIVED' ? qty(r.receivedQuantity) : '' },
    { title: 'Thiếu', className: 'num', width: 80, render: (_: unknown, r: TransferRow) => toNum(r.shortageQuantity) > 0 ? <span className="tk-shortage">{qty(r.shortageQuantity)}</span> : '' },
    ...(can('inventory.cost.view') ? [{ title: 'Giá trị', dataIndex: 'totalCost', className: 'num', width: 120, render: (v: string) => money(v) }] : []),
    { title: 'Trạng thái', dataIndex: 'status', width: 110, render: (v: string) => <Tag color={TRANSFER_STATUS_COLOR[v]}>{TRANSFER_STATUS_LABEL[v]}</Tag> },
    { title: 'Thời gian', dataIndex: 'createdAt', width: 140, render: (v: string, r: TransferRow) => <span>{dt(v)}{r.dispatchedAt && <div className="kv-hint">Xuất: {dt(r.dispatchedAt)}</div>}{r.receivedAt && <div className="kv-hint">Nhận: {dt(r.receivedAt)}</div>}</span> },
    { title: 'Ghi chú', dataIndex: 'note', ellipsis: true },
  ];

  return (
    <div className="kv-list">
      {filters}
      <div className="kv-main">
        <h1 className="kv-page-title">Chuyển kho</h1>
        <div className="kv-toolbar">
          <Input.Search className="kv-search" allowClear placeholder="Theo mã phiếu, mã/tên hàng, ghi chú" value={searchText} onChange={(e) => setSearchText(e.target.value)} onSearch={(v) => set({ search: v || undefined })} enterButton={<SearchOutlined />} />
          <span className="spacer" />
          {can('transfer.create') && <Button type="primary" icon={<PlusOutlined />} onClick={() => nav('/transfers/new')}>Chuyển kho</Button>}
          <Button icon={<ReloadOutlined />} onClick={() => refetch()} loading={isFetching} />
        </div>
        <div className="tk-tabs">
          <Segmented block value={dir} onChange={(v) => { setDir(v as Direction); set({}); }} options={[{ value: 'out', label: 'Gửi đi', icon: <SendOutlined /> }, { value: 'in', label: 'Nhận về', icon: <InboxOutlined /> }, { value: 'all', label: 'Tất cả' }]} />
        </div>
        <div className="tk-summary">
          <div className="tk-tile"><div className="lbl">Số phiếu</div><div className="val">{total}</div></div>
          <div className="tk-tile"><div className="lbl">Đang chuyển{total > rows.length ? ' (trang này)' : ''}</div><div className="val">{sum.transit}</div></div>
          <div className="tk-tile"><div className="lbl">SL thiếu{total > rows.length ? ' (trang này)' : ''}</div><div className={`val${sum.shortage > 0 ? ' neg' : ''}`}>{qty(sum.shortage)}</div></div>
        </div>
        {isMobile ? (
          <div>
            {isLoading && <div className="muted" style={{ padding: 12 }}>Đang tải…</div>}
            {!isLoading && !rows.length && <div className="kv-card tk-empty"><Empty description={error ? errMsg(error) : 'Chưa có phiếu chuyển kho'} /></div>}
            <div className="tk-cards">
              {rows.map((r) => {
                const open = expanded.includes(r.id);
                return (
                  <div key={r.id} className="tk-card" onClick={() => toggle(r.id)}>
                    <div className="tk-card-head"><span><span className="code">{r.code}</span> <Tag color={TRANSFER_STATUS_COLOR[r.status]}>{TRANSFER_STATUS_LABEL[r.status]}</Tag></span><span className="muted">{open ? <UpOutlined /> : <DownOutlined />}</span></div>
                    <div style={{ marginTop: 4 }}><TransferRoute t={r} /></div>
                    <div className="tk-card-meta">{dt(r.createdAt)} · {r._count?.lines ?? 0} dòng{r.note ? ` · ${r.note}` : ''}</div>
                    <div className="tk-card-amts">
                      <span>SL gửi <b>{qty(r.totalQuantity)}</b></span>
                      {r.status === 'RECEIVED' && <span>SL nhận <b>{qty(r.receivedQuantity)}</b></span>}
                      {toNum(r.shortageQuantity) > 0 && <span className="tk-shortage">Thiếu {qty(r.shortageQuantity)}</span>}
                      {can('inventory.cost.view') && r.totalCost !== undefined && <span className="muted">{money(r.totalCost)}</span>}
                    </div>
                    {open && <div className="tk-card-body" onClick={(e) => e.stopPropagation()}><TransferDetail id={r.id} /></div>}
                  </div>
                );
              })}
            </div>
            {total > (q.pageSize ?? 20) && <div className="tk-pager"><Pagination simple current={q.page} pageSize={q.pageSize} total={total} onChange={(page, pageSize) => set({ page, pageSize })} /></div>}
          </div>
        ) : (
          <div className="kv-card">
            <Table<TransferRow> className="kv-table" rowKey="id" size="small" loading={isLoading} dataSource={rows} scroll={{ x: 1250 }}
              locale={{ emptyText: error ? <Empty description={errMsg(error)} /> : <Empty description="Chưa có phiếu chuyển kho" /> }}
              expandable={{ expandedRowRender: (r) => <div className="kv-expanded"><TransferDetail id={r.id} /></div>, expandRowByClick: true }}
              onChange={(p) => set({ page: p.current, pageSize: p.pageSize })}
              pagination={{ current: q.page, pageSize: q.pageSize, total, showSizeChanger: true, pageSizeOptions: [15, 20, 50, 100], showTotal: (t) => `${t} phiếu` }}
              columns={columns} />
          </div>
        )}
      </div>
    </div>
  );
}

/** Expanded detail of a transfer: header, lines, movements and the state-dependent actions. */
export function TransferDetail({ id, hideOpen }: { id: string; hideOpen?: boolean }) {
  const { data: t, isLoading, error } = useTransfer(id);
  const can = useCan();
  const nav = useNavigate();
  const isMobile = useIsMobile();
  const inBranch = useInBranch();
  const actions = useTransferActions();
  const canSeeCost = can('inventory.cost.view');
  if (isLoading) return <div className="muted">Đang tải…</div>;
  if (!t) return <div className="neg">{error ? errMsg(error) : 'Không tìm thấy phiếu'}</div>;
  const inSource = inBranch(t.fromBranchId); const inDest = inBranch(t.toBranchId);
  const shortage = toNum(t.shortageQuantity);

  return (
    <div className="tk-detail">
      <Descriptions size="small" column={{ xs: 1, md: 3 }} colon={false} styles={{ label: { color: '#6b7280' } }}>
        <Descriptions.Item label="Mã phiếu"><b>{t.code}</b></Descriptions.Item>
        <Descriptions.Item label="Trạng thái"><Tag color={TRANSFER_STATUS_COLOR[t.status]}>{TRANSFER_STATUS_LABEL[t.status]}</Tag></Descriptions.Item>
        <Descriptions.Item label="Tạo lúc">{dt(t.createdAt)}</Descriptions.Item>
        <Descriptions.Item label="Kho gửi">{t.fromWarehouse?.name} <span className="muted">· {t.fromBranch?.name}</span></Descriptions.Item>
        <Descriptions.Item label="Kho nhận">{t.toWarehouse?.name} <span className="muted">· {t.toBranch?.name}</span></Descriptions.Item>
        {t.dispatchedAt && <Descriptions.Item label="Xuất lúc">{dt(t.dispatchedAt)}</Descriptions.Item>}
        {t.receivedAt && <Descriptions.Item label="Nhận lúc">{dt(t.receivedAt)}</Descriptions.Item>}
        {t.status === 'RECEIVED' && <Descriptions.Item label="Kết quả nhận">{qty(t.receivedQuantity)}/{qty(t.totalQuantity)}{shortage > 0 && <span className="tk-shortage"> · thiếu {qty(shortage)} ({SHORTAGE_ACTION_LABEL[t.shortageAction ?? 'WRITE_OFF']}{canSeeCost && t.shortageAction === 'WRITE_OFF' && t.shortageValue !== undefined ? `, ${money(t.shortageValue)}` : ''})</span>}</Descriptions.Item>}
        {t.receiveNote && <Descriptions.Item label="Ghi chú nhận">{t.receiveNote}</Descriptions.Item>}
        {t.cancelledAt && <Descriptions.Item label="Hủy lúc">{dt(t.cancelledAt)} · {t.cancelReason}</Descriptions.Item>}
        <Descriptions.Item label="Ghi chú">{t.note || '—'}</Descriptions.Item>
      </Descriptions>
      {isMobile ? (
        <div className="tk-detail-lines">
          {t.lines.map((l) => {
            const sent = toNum(l.quantity); const got = l.receivedQuantity !== null && l.receivedQuantity !== undefined ? toNum(l.receivedQuantity) : null;
            return (
              <div key={l.id} className="tk-detail-line">
                <div className="nm">{l.lineNo}. {l.variant.name}</div>
                <div className="nums"><span className="lbl">Gửi</span><b>{qty(sent)}</b>{t.status === 'RECEIVED' && got !== null && <span> <span className="lbl">· Nhận</span><b className={got < sent ? 'tk-shortage' : ''}>{qty(got)}</b></span>}</div>
                <div className="meta">{l.variant.sku} · {l.variant.product.baseUnit ?? ''}{l.batch ? ` · Lô ${l.batch.batchNo}` : ''}{canSeeCost && l.unitCost !== undefined ? ` · GV ${money(l.unitCost)}` : ''}{l.note ? ` · ${l.note}` : ''}</div>
              </div>
            );
          })}
        </div>
      ) : (
        <Table size="small" rowKey="id" pagination={false} dataSource={t.lines}
          columns={[
            { title: '#', dataIndex: 'lineNo', width: 40 },
            { title: 'Mã hàng', render: (_, l) => l.variant.sku, width: 120 },
            { title: 'Tên hàng', render: (_, l) => <span>{l.variant.name}{l.batch && <Tag style={{ marginLeft: 6 }} color="gold">Lô {l.batch.batchNo}</Tag>}</span> },
            { title: 'ĐVT', render: (_, l) => l.variant.product.baseUnit ?? '', width: 70 },
            { title: 'SL gửi', dataIndex: 'quantity', className: 'num', width: 90, render: (v) => qty(v) },
            ...(t.status === 'RECEIVED' ? [{ title: 'SL nhận', className: 'num', width: 90, render: (_: unknown, l: Transfer['lines'][number]) => <span className={toNum(l.receivedQuantity) < toNum(l.quantity) ? 'tk-shortage' : ''}>{qty(l.receivedQuantity)}</span> }] : []),
            ...(canSeeCost ? [{ title: 'Giá vốn', dataIndex: 'unitCost', className: 'num', width: 110, render: (v: string) => money(v) }, { title: 'Thành tiền', dataIndex: 'totalCost', className: 'num', width: 120, render: (v: string) => money(v) }] : []),
            { title: 'Ghi chú', dataIndex: 'note', ellipsis: true },
          ]}
          summary={() => <Table.Summary.Row><Table.Summary.Cell index={0} colSpan={4}><b>Tổng</b></Table.Summary.Cell><Table.Summary.Cell index={1} className="num"><b>{qty(t.totalQuantity)}</b></Table.Summary.Cell>{t.status === 'RECEIVED' && <Table.Summary.Cell index={2} className="num"><b>{qty(t.receivedQuantity)}</b></Table.Summary.Cell>}{canSeeCost && <Table.Summary.Cell index={3} className="num" colSpan={2}><b>{money(t.totalCost)}</b></Table.Summary.Cell>}<Table.Summary.Cell index={4} /></Table.Summary.Row>} />
      )}
      {(t.movements?.length ?? 0) > 0 && (
        <Table size="small" rowKey="id" pagination={false} dataSource={t.movements} style={{ marginTop: 8 }} title={() => <b>Bút toán kho</b>} scroll={{ x: 640 }}
          columns={[{ title: 'Thời gian', dataIndex: 'createdAt', width: 150, render: (v) => dt(v, 'DD/MM/YYYY HH:mm:ss') }, { title: 'Loại', dataIndex: 'type', width: 110, render: (v) => <Tag color={v === 'REVERSAL' ? 'red' : v === 'TRANSFER_IN' ? 'green' : 'default'}>{MOVEMENT_LABEL[v] ?? v}</Tag> }, { title: 'Kho', width: 140, render: (_, m) => m.warehouseId === t.fromWarehouseId ? t.fromWarehouse?.name : m.warehouseId === t.toWarehouseId ? t.toWarehouse?.name : m.warehouseId }, { title: 'Hàng', render: (_, m) => t.lines.find((l) => l.variantId === m.variantId)?.variant.sku ?? m.variantId }, { title: 'SL', dataIndex: 'quantity', className: 'num', width: 80, render: (v) => <span className={Number(v) >= 0 ? 'pos' : 'neg'}>{signedQty(v)}</span> }, ...(canSeeCost ? [{ title: 'Giá vốn', dataIndex: 'unitCost', className: 'num', width: 100, render: (v: string) => money(v) }] : []), { title: 'Tồn sau', dataIndex: 'balanceAfter', className: 'num', width: 90, render: (v) => qty(v) }]} />
      )}
      {t.status === 'DRAFT' && !inSource && <div className="tk-hint-box">Bạn không thuộc chi nhánh gửi ({t.fromBranch?.name}) nên không thể sửa / xuất / hủy phiếu này.</div>}
      {t.status === 'IN_TRANSIT' && !inDest && <div className="tk-hint-box">Chỉ người dùng thuộc chi nhánh nhận ({t.toBranch?.name}) mới xác nhận nhận hàng được.</div>}
      <div className="kv-detail-actions">
        {!hideOpen && <Button icon={<EyeOutlined />} onClick={() => nav(`/transfers/${t.id}`)}>{t.status === 'IN_TRANSIT' && can('transfer.receive') && inDest ? 'Mở phiếu' : 'Xem chi tiết'}</Button>}
        {t.status === 'DRAFT' && can('transfer.create') && inSource && <Button icon={<EditOutlined />} onClick={() => nav(`/transfers/${t.id}`)}>Sửa</Button>}
        {t.status === 'DRAFT' && can('transfer.create') && inSource && <Button danger icon={<DeleteOutlined />} onClick={() => actions.remove(t, () => undefined)}>Xóa</Button>}
        {t.status === 'DRAFT' && can('transfer.dispatch') && inSource && <Button type="primary" icon={<SendOutlined />} onClick={() => actions.dispatch(t)}>Xuất chuyển</Button>}
        {t.status === 'IN_TRANSIT' && can('transfer.receive') && inDest && <Button type="primary" icon={<InboxOutlined />} onClick={() => nav(`/transfers/${t.id}`)}>Nhận hàng</Button>}
        {t.status === 'IN_TRANSIT' && can('transfer.cancel') && inSource && <Button danger icon={<StopOutlined />} onClick={() => actions.cancel(t)}>Hủy</Button>}
        <Link to={`/inventory/movements?documentId=${t.id}`}>Xem thẻ kho</Link>
      </div>
    </div>
  );
}
