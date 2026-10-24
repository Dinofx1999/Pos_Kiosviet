import { App, Button, DatePicker, Descriptions, Empty, Input, Radio, Select, Space, Table, Tag } from 'antd';
import { CheckOutlined, DeleteOutlined, EditOutlined, PlusOutlined, PrinterOutlined, ReloadOutlined, SearchOutlined, StopOutlined } from '@ant-design/icons';

import { useState } from 'react';
import { Link, useNavigate, useSearchParams } from 'react-router-dom';
import { useQueryClient } from '@tanstack/react-query';
import { DocQuery, inventoryApi, useDocument, useDocuments } from '../../api/inventory';
import { errMsg } from '../../api/client';
import type { InventoryDocument } from '../../api/types';
import { FilterCard, FilterPanel } from '../../components/FilterPanel';
import { useAuthStore, useBranchWarehouses, useCan } from '../../store/auth';
import { DOC_STATUS_COLOR, DOC_STATUS_LABEL, DOC_TYPE_LABEL, MOVEMENT_LABEL, REASON_LABEL, dt, money, qty, signedQty } from '../../utils/format';

export default function DocumentsPage() {
  const can = useCan();
  const nav = useNavigate();
  const [sp] = useSearchParams();
  const warehouses = useBranchWarehouses();
  const branchId = useAuthStore((s) => s.currentBranchId);
  const [q, setQ] = useState<DocQuery>({ page: 1, pageSize: 20, search: sp.get('search') ?? undefined, type: sp.get('type') ?? undefined });
  const [searchText, setSearchText] = useState(q.search ?? '');
  const { data, isLoading, isFetching, error, refetch } = useDocuments({ ...q, branchId: branchId ?? undefined });
  const set = (patch: Partial<DocQuery>) => setQ((s) => ({ ...s, ...patch, page: patch.page ?? 1 }));

  return (
    <div className="kv-list">
      <FilterPanel>
        <FilterCard title="Loại phiếu"><Radio.Group value={q.type ?? ''} onChange={(e) => set({ type: e.target.value || undefined })}><Radio value="">Tất cả</Radio><Radio value="RECEIPT">Nhập kho</Radio><Radio value="ISSUE">Xuất kho / hủy</Radio><Radio value="ADJUSTMENT">Điều chỉnh</Radio></Radio.Group></FilterCard>
        <FilterCard title="Trạng thái"><Radio.Group value={q.status ?? ''} onChange={(e) => set({ status: e.target.value || undefined })}><Radio value="">Tất cả</Radio><Radio value="DRAFT">Phiếu tạm</Radio><Radio value="POSTED">Đã ghi sổ</Radio><Radio value="CANCELLED">Đã hủy</Radio></Radio.Group></FilterCard>
        <FilterCard title="Kho"><Select size="small" allowClear style={{ width: '100%' }} placeholder="Tất cả kho" value={q.warehouseId} onChange={(v) => set({ warehouseId: v })} options={warehouses.map((w) => ({ value: w.id, label: w.name }))} /></FilterCard>
        <FilterCard title="Thời gian"><DatePicker.RangePicker size="small" style={{ width: '100%' }} format="DD/MM/YYYY" onChange={(r) => set({ from: r?.[0]?.startOf('day').toISOString(), to: r?.[1]?.endOf('day').toISOString() })} /></FilterCard>
      </FilterPanel>
      <div className="kv-main">
        <h1 className="kv-page-title">Phiếu kho (Nhập / Xuất / Điều chỉnh)</h1>
        <div className="kv-toolbar">
          <Input.Search className="kv-search" allowClear placeholder="Theo mã phiếu, mã/tên hàng, ghi chú" value={searchText} onChange={(e) => setSearchText(e.target.value)} onSearch={(v) => set({ search: v || undefined })} enterButton={<SearchOutlined />} />
          <span className="spacer" />
          {can('inventory.document.create') && <Space.Compact>
            <Button type="primary" icon={<PlusOutlined />} onClick={() => nav('/inventory/documents/new?type=RECEIPT')}>Nhập kho</Button>
            <Button icon={<PlusOutlined />} onClick={() => nav('/inventory/documents/new?type=ISSUE')}>Xuất kho</Button>
            <Button icon={<PlusOutlined />} onClick={() => nav('/inventory/documents/new?type=ADJUSTMENT')}>Điều chỉnh</Button>
          </Space.Compact>}
          <Button icon={<ReloadOutlined />} onClick={() => refetch()} loading={isFetching} />
        </div>
        <div className="kv-card">
          <Table className="kv-table" rowKey="id" size="small" loading={isLoading} dataSource={data?.data ?? []} rowSelection={{}} scroll={{ x: 900 }}
            locale={{ emptyText: error ? <Empty description={errMsg(error)} /> : <Empty description="Chưa có phiếu kho" /> }}
            expandable={{ expandedRowRender: (r) => <DocumentDetail id={r.id} />, expandRowByClick: true }}
            onChange={(p) => set({ page: p.current, pageSize: p.pageSize })}
            pagination={{ current: q.page, pageSize: q.pageSize, total: data?.meta.total ?? 0, showSizeChanger: true, pageSizeOptions: [15, 20, 50, 100], showTotal: (t) => `${t} phiếu` }}
            columns={[
              { title: 'Mã phiếu', dataIndex: 'code', width: 150, render: (v) => <b>{v}</b> },
              { title: 'Loại', dataIndex: 'type', width: 110, render: (v, r) => <span><Tag color={v === 'RECEIPT' ? 'blue' : v === 'ISSUE' ? 'orange' : 'purple'}>{DOC_TYPE_LABEL[v]}</Tag>{r.reason && <div className="kv-hint">{REASON_LABEL[r.reason] ?? r.reason}</div>}</span> },
              { title: 'Kho', render: (_, r) => r.warehouse?.name, width: 140 },
              { title: 'Chi nhánh', render: (_, r) => r.branch?.name, width: 150 },
              { title: 'Số dòng', render: (_, r) => r._count?.lines, width: 70, className: 'num' },
              { title: 'Tổng SL', dataIndex: 'totalQuantity', className: 'num', width: 90, render: (v) => qty(v) },
              { title: 'Tổng giá trị', dataIndex: 'totalCost', className: 'num', width: 120, render: (v) => money(v) },
              { title: 'Trạng thái', dataIndex: 'status', width: 110, render: (v) => <Tag color={DOC_STATUS_COLOR[v]}>{DOC_STATUS_LABEL[v]}</Tag> },
              { title: 'Thời gian', dataIndex: 'createdAt', width: 130, render: (v, r) => <span>{dt(v)}{r.postedAt && <div className="kv-hint">Ghi sổ: {dt(r.postedAt)}</div>}</span> },
              { title: 'Ghi chú', dataIndex: 'note', ellipsis: true },
            ]} />
        </div>
      </div>
    </div>
  );
}

export function DocumentDetail({ id }: { id: string }) {
  const { data: doc, isLoading } = useDocument(id);
  const { message, modal } = App.useApp();
  const can = useCan();
  const nav = useNavigate();
  const qc = useQueryClient();
  const canSeeCost = can('inventory.cost.view');
  if (isLoading || !doc) return <div className="muted">Đang tải…</div>;

  const refresh = () => { qc.invalidateQueries({ queryKey: ['documents'] }); qc.invalidateQueries({ queryKey: ['document', id] }); qc.invalidateQueries({ queryKey: ['balances'] }); qc.invalidateQueries({ queryKey: ['movements'] }); qc.invalidateQueries({ queryKey: ['products'] }); qc.invalidateQueries({ queryKey: ['dashboard'] }); };
  const post = () => modal.confirm({ title: `Ghi sổ phiếu ${doc.code}?`, content: 'Tồn kho và giá vốn sẽ được cập nhật. Sau khi ghi sổ không thể sửa, chỉ có thể hủy (ghi đảo).', okText: 'Ghi sổ', cancelText: 'Bỏ qua', onOk: async () => { try { await inventoryApi.post(doc.id); message.success('Đã ghi sổ'); refresh(); } catch (e) { message.error(errMsg(e)); } } });
  const cancel = () => { let reason = ''; modal.confirm({ title: `Hủy phiếu ${doc.code}?`, content: <div>Hệ thống sẽ ghi bút toán đảo toàn bộ số lượng của phiếu.<Input.TextArea style={{ marginTop: 8 }} placeholder="Lý do hủy (bắt buộc)" onChange={(e) => (reason = e.target.value)} /></div>, okText: 'Hủy phiếu', okButtonProps: { danger: true }, cancelText: 'Bỏ qua', onOk: async () => { if (!reason.trim()) { message.warning('Nhập lý do hủy'); throw new Error('reason'); } try { await inventoryApi.cancel(doc.id, reason.trim()); message.success('Đã hủy phiếu'); refresh(); } catch (e) { message.error(errMsg(e)); throw e; } } }); };
  const remove = () => modal.confirm({ title: `Xóa phiếu tạm ${doc.code}?`, okText: 'Xóa', okButtonProps: { danger: true }, cancelText: 'Bỏ qua', onOk: async () => { try { await inventoryApi.deleteDraft(doc.id); message.success('Đã xóa'); qc.removeQueries({ queryKey: ['document', doc.id] }); qc.invalidateQueries({ queryKey: ['documents'] }); } catch (e) { message.error(errMsg(e)); } } });
  // Print through a hidden iframe: works even when pop-ups are blocked (window.open returned null before and nothing happened).
  const print = () => {
    const frame = document.createElement('iframe');
    frame.style.cssText = 'position:fixed;right:0;bottom:0;width:0;height:0;border:0;';
    document.body.appendChild(frame);
    const w = frame.contentWindow;
    if (!w) { frame.remove(); message.error('Trình duyệt không cho phép in'); return; }
    w.document.open(); w.document.write(printHtml(doc)); w.document.close();
    const done = () => setTimeout(() => frame.remove(), 1000);
    w.onafterprint = done;
    setTimeout(() => { try { w.focus(); w.print(); } catch { message.error('Không mở được hộp thoại in'); } done(); }, 300);
  };

  return (
    <div>
      <Descriptions size="small" column={{ xs: 1, md: 3 }} colon={false} labelStyle={{ color: '#6b7280' }}>
        <Descriptions.Item label="Mã phiếu"><b>{doc.code}</b></Descriptions.Item>
        <Descriptions.Item label="Trạng thái"><Tag color={DOC_STATUS_COLOR[doc.status]}>{DOC_STATUS_LABEL[doc.status]}</Tag></Descriptions.Item>
        <Descriptions.Item label="Loại">{DOC_TYPE_LABEL[doc.type]}{doc.reason ? ` · ${REASON_LABEL[doc.reason] ?? doc.reason}` : ''}</Descriptions.Item>
        <Descriptions.Item label="Chi nhánh">{doc.branch?.name}</Descriptions.Item>
        <Descriptions.Item label="Kho">{doc.warehouse?.name}</Descriptions.Item>
        <Descriptions.Item label="Tạo lúc">{dt(doc.createdAt)}</Descriptions.Item>
        {doc.postedAt && <Descriptions.Item label="Ghi sổ lúc">{dt(doc.postedAt)}</Descriptions.Item>}
        {doc.cancelledAt && <Descriptions.Item label="Hủy lúc">{dt(doc.cancelledAt)} · {doc.cancelReason}</Descriptions.Item>}
        <Descriptions.Item label="Ghi chú">{doc.note || '—'}</Descriptions.Item>
      </Descriptions>
      <Table size="small" rowKey="id" pagination={false} dataSource={doc.lines ?? []} style={{ marginTop: 8 }}
        columns={[
          { title: '#', dataIndex: 'lineNo', width: 40 },
          { title: 'Mã hàng', render: (_, l) => l.variant.sku, width: 120 },
          { title: 'Tên hàng', render: (_, l) => <span>{l.variant.name}{l.batch && <Tag style={{ marginLeft: 6 }} color="gold">Lô {l.batch.batchNo}</Tag>}</span> },
          { title: 'ĐVT', render: (_, l) => l.variant.product.baseUnit ?? '', width: 70 },
          ...(doc.type === 'ADJUSTMENT' ? [{ title: 'Hệ thống', dataIndex: 'systemQuantity', className: 'num', width: 90, render: (v: string | null) => v !== null ? qty(v) : '—' }, { title: 'Thực tế', dataIndex: 'actualQuantity', className: 'num', width: 90, render: (v: string | null) => v !== null ? qty(v) : '—' }] : []),
          { title: doc.type === 'ADJUSTMENT' ? 'Chênh lệch' : 'Số lượng', dataIndex: 'quantity', className: 'num', width: 100, render: (v) => doc.type === 'ADJUSTMENT' ? <span className={Number(v) >= 0 ? 'pos' : 'neg'}>{signedQty(v)}</span> : qty(v) },
          ...(canSeeCost ? [{ title: 'Đơn giá vốn', dataIndex: 'unitCost', className: 'num', width: 110, render: (v: string) => money(v) }, { title: 'Thành tiền', dataIndex: 'totalCost', className: 'num', width: 120, render: (v: string) => money(v) }] : []),
          { title: 'Ghi chú', dataIndex: 'note', ellipsis: true },
        ]}
        summary={() => <Table.Summary.Row><Table.Summary.Cell index={0} colSpan={4}><b>Tổng</b></Table.Summary.Cell><Table.Summary.Cell index={1} className="num" colSpan={doc.type === 'ADJUSTMENT' ? 3 : 1}><b>{qty(doc.totalQuantity)}</b></Table.Summary.Cell>{canSeeCost && <Table.Summary.Cell index={2} className="num" colSpan={2}><b>{money(doc.totalCost)}</b></Table.Summary.Cell>}<Table.Summary.Cell index={3} /></Table.Summary.Row>} />
      {(doc.movements?.length ?? 0) > 0 && (
        <Table size="small" rowKey="id" pagination={false} dataSource={doc.movements} style={{ marginTop: 8 }} title={() => <b>Bút toán kho</b>}
          columns={[{ title: 'Thời gian', dataIndex: 'createdAt', render: (v) => dt(v, 'DD/MM/YYYY HH:mm:ss') }, { title: 'Loại', dataIndex: 'type', render: (v) => <Tag color={v === 'REVERSAL' ? 'red' : 'default'}>{MOVEMENT_LABEL[v] ?? v}</Tag> }, { title: 'Biến thể', render: (_, m) => doc.lines?.find((l) => l.variantId === m.variantId)?.variant.sku ?? m.variantId }, { title: 'SL', dataIndex: 'quantity', className: 'num', render: (v) => <span className={Number(v) >= 0 ? 'pos' : 'neg'}>{signedQty(v)}</span> }, ...(canSeeCost ? [{ title: 'Giá vốn', dataIndex: 'unitCost', className: 'num', render: (v: string) => money(v) }] : []), { title: 'Tồn sau', dataIndex: 'balanceAfter', className: 'num', render: (v) => qty(v) }]} />
      )}
      <div className="kv-detail-actions">
        <Button icon={<PrinterOutlined />} onClick={print}>In</Button>
        {doc.status === 'DRAFT' && can('inventory.document.create') && <Button icon={<EditOutlined />} onClick={() => nav(`/inventory/documents/${doc.id}/edit`)}>Sửa</Button>}
        {doc.status === 'DRAFT' && can('inventory.document.create') && <Button danger icon={<DeleteOutlined />} onClick={remove}>Xóa</Button>}
        {doc.status === 'DRAFT' && can('inventory.document.post') && <Button type="primary" icon={<CheckOutlined />} onClick={post}>Ghi sổ</Button>}
        {doc.status === 'POSTED' && can('inventory.document.cancel') && <Button danger icon={<StopOutlined />} onClick={cancel}>Hủy phiếu</Button>}
        <Link to={`/inventory/movements?documentId=${doc.id}`}>Xem thẻ kho</Link>
      </div>
    </div>
  );
}

function printHtml(doc: InventoryDocument) {
  const rows = (doc.lines ?? []).map((l) => `<tr><td>${l.lineNo}</td><td>${l.variant.sku}</td><td>${l.variant.name}${l.batch ? ` (Lô ${l.batch.batchNo})` : ''}</td><td>${l.variant.product.baseUnit ?? ''}</td><td class="r">${qty(l.quantity)}</td><td class="r">${money(l.unitCost)}</td><td class="r">${money(l.totalCost)}</td></tr>`).join('');
  return `<!doctype html><html lang="vi"><head><meta charset="utf-8"><title>${doc.code}</title><style>body{font-family:Arial,sans-serif;font-size:13px;padding:24px}h2{margin:0 0 4px}table{width:100%;border-collapse:collapse;margin-top:12px}th,td{border:1px solid #999;padding:4px 6px}th{background:#eee}.r{text-align:right}.meta td{border:none;padding:2px 4px}</style></head><body>
  <h2>${DOC_TYPE_LABEL[doc.type]} – ${doc.code}</h2><div>${DOC_STATUS_LABEL[doc.status]}${doc.reason ? ' · ' + (REASON_LABEL[doc.reason] ?? doc.reason) : ''}</div>
  <table class="meta"><tr><td>Chi nhánh: <b>${doc.branch?.name ?? ''}</b></td><td>Kho: <b>${doc.warehouse?.name ?? ''}</b></td><td>Ngày: ${dt(doc.postedAt ?? doc.createdAt)}</td></tr><tr><td colspan="3">Ghi chú: ${doc.note ?? ''}</td></tr></table>
  <table><thead><tr><th>#</th><th>Mã hàng</th><th>Tên hàng</th><th>ĐVT</th><th>SL</th><th>Đơn giá</th><th>Thành tiền</th></tr></thead><tbody>${rows}</tbody>
  <tfoot><tr><th colspan="4">Tổng</th><th class="r">${qty(doc.totalQuantity)}</th><th></th><th class="r">${money(doc.totalCost)}</th></tr></tfoot></table>
  <table class="meta" style="margin-top:40px"><tr><td style="text-align:center">Người lập phiếu<br/><br/><br/></td><td style="text-align:center">Thủ kho<br/><br/><br/></td><td style="text-align:center">Người duyệt<br/><br/><br/></td></tr></table>
  </body></html>`;
}
