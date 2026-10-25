import { App, Button, DatePicker, Descriptions, Empty, Input, Radio, Tag } from 'antd';
import Table from '../../components/ResponsiveTable';
import { CheckOutlined, DeleteOutlined, EditOutlined, ReloadOutlined, SearchOutlined, StopOutlined } from '@ant-design/icons';
import { useState } from 'react';
import { Link, useNavigate, useSearchParams } from 'react-router-dom';
import { useQueryClient } from '@tanstack/react-query';
import { PURCHASING_KEYS, ReturnQuery, purchasingApi, usePurchaseReturn, usePurchaseReturns } from '../../api/purchasing';
import { errMsg } from '../../api/client';
import { FilterCard, FilterPanel } from '../../components/FilterPanel';
import { SupplierSelect } from '../../components/SupplierSelect';
import { useAuthStore, useCan } from '../../store/auth';
import { DOC_STATUS_COLOR, MOVEMENT_LABEL, PAYMENT_METHOD_LABEL, PDOC_STATUS_LABEL, dt, money, qty, signedQty } from '../../utils/format';
import { RefundModal } from './PurchaseReturnEditorPage';

export default function PurchaseReturnsPage() {
  const can = useCan();
  const nav = useNavigate();
  const [sp] = useSearchParams();
  const branchId = useAuthStore((s) => s.currentBranchId);
  const [q, setQ] = useState<ReturnQuery>({ page: 1, pageSize: 20, search: sp.get('search') ?? undefined });
  const [searchText, setSearchText] = useState(q.search ?? '');
  const { data, isLoading, isFetching, error, refetch } = usePurchaseReturns({ ...q, branchId: branchId ?? undefined });
  const set = (patch: Partial<ReturnQuery>) => setQ((s) => ({ ...s, ...patch, page: patch.page ?? 1 }));
  return (
    <div className="kv-list">
      <FilterPanel>
        <FilterCard title="Trạng thái"><Radio.Group value={q.status ?? ''} onChange={(e) => set({ status: e.target.value || undefined })}><Radio value="">Tất cả</Radio><Radio value="DRAFT">Phiếu tạm</Radio><Radio value="POSTED">Hoàn thành</Radio><Radio value="CANCELLED">Đã hủy</Radio></Radio.Group></FilterCard>
        <FilterCard title="Nhà cung cấp"><SupplierSelect size="small" value={q.supplierId} onChange={(v) => set({ supplierId: v })} allowCreate={false} placeholder="Tất cả" /></FilterCard>
        <FilterCard title="Ngày trả"><DatePicker.RangePicker size="small" style={{ width: '100%' }} format="DD/MM/YYYY" onChange={(r) => set({ from: r?.[0]?.startOf('day').toISOString(), to: r?.[1]?.endOf('day').toISOString() })} /></FilterCard>
      </FilterPanel>
      <div className="kv-main">
        <h1 className="kv-page-title">Trả hàng nhập</h1>
        <div className="kv-toolbar">
          <Input.Search className="kv-search" allowClear placeholder="Theo mã phiếu trả, mã phiếu nhập, nhà cung cấp" value={searchText} onChange={(e) => setSearchText(e.target.value)} onSearch={(v) => set({ search: v || undefined })} enterButton={<SearchOutlined />} />
          <span className="spacer" />
          {can('purchase.return.create') && <Button type="primary" onClick={() => nav('/purchase-receipts?status=POSTED')}>Chọn phiếu nhập để trả hàng</Button>}
          <Button icon={<ReloadOutlined />} onClick={() => refetch()} loading={isFetching} />
        </div>
        <div className="kv-card">
          <Table className="kv-table" rowKey="id" size="small" loading={isLoading} dataSource={data?.data ?? []} rowSelection={{}} scroll={{ x: 1150 }}
            locale={{ emptyText: error ? <Empty description={errMsg(error)} /> : <Empty description="Chưa có phiếu trả hàng nhập" /> }}
            expandable={{ expandedRowRender: (r) => <PurchaseReturnDetail id={r.id} />, expandRowByClick: true }}
            onChange={(p) => set({ page: p.current, pageSize: p.pageSize })}
            pagination={{ current: q.page, pageSize: q.pageSize, total: data?.meta.total ?? 0, showSizeChanger: true, pageSizeOptions: [15, 20, 50, 100], showTotal: (t) => `${t} phiếu` }}
            columns={[
              { title: 'Mã THN', dataIndex: 'code', width: 130, render: (v) => <b>{v}</b> },
              { title: 'Phiếu nhập', render: (_, r) => <Link to={`/purchase-receipts?search=${r.receipt?.code}`} onClick={(e) => e.stopPropagation()}>{r.receipt?.code}</Link>, width: 130 },
              { title: 'Nhà cung cấp', render: (_, r) => r.supplier?.name },
              { title: 'Ngày trả', dataIndex: 'returnDate', width: 120, render: (v) => dt(v) },
              { title: 'Tổng tiền', dataIndex: 'totalAmount', className: 'num', width: 130, render: (v) => money(v) },
              { title: 'Đã hoàn', dataIndex: 'refundedAmount', className: 'num', width: 120, render: (v) => money(v) },
              { title: 'Trạng thái', dataIndex: 'status', width: 110, render: (v) => <Tag color={DOC_STATUS_COLOR[v]}>{PDOC_STATUS_LABEL[v]}</Tag> },
              { title: 'Lý do', dataIndex: 'reason', ellipsis: true },
            ]} />
        </div>
      </div>
    </div>
  );
}

export function PurchaseReturnDetail({ id }: { id: string }) {
  const { data: r, isLoading } = usePurchaseReturn(id);
  const can = useCan();
  const nav = useNavigate();
  const qc = useQueryClient();
  const { message, modal } = App.useApp();
  const [posting, setPosting] = useState(false);
  if (isLoading || !r) return <div className="muted">Đang tải…</div>;
  const refresh = () => PURCHASING_KEYS.forEach((k) => qc.invalidateQueries({ queryKey: [k] }));
  const canCost = can('product.cost.view') || can('inventory.cost.view');
  const cancel = () => { let reason = ''; modal.confirm({ title: `Hủy phiếu trả hàng ${r.code}?`, content: <div>Hàng sẽ được nhập lại kho và công nợ ghi đảo. Phiếu đã nhận hoàn tiền phải hủy phiếu thu trước.<Input.TextArea style={{ marginTop: 8 }} placeholder="Lý do hủy (bắt buộc)" onChange={(e) => (reason = e.target.value)} /></div>, okText: 'Hủy phiếu', okButtonProps: { danger: true }, cancelText: 'Bỏ qua', onOk: async () => { if (!reason.trim()) { message.warning('Nhập lý do'); throw new Error('reason'); } try { await purchasingApi.cancelReturn(r.id, reason.trim()); message.success('Đã hủy phiếu'); refresh(); } catch (e) { message.error(errMsg(e)); throw e; } } }); };
  const remove = () => modal.confirm({ title: `Xóa phiếu tạm ${r.code}?`, okText: 'Xóa', okButtonProps: { danger: true }, cancelText: 'Bỏ qua', onOk: async () => { try { await purchasingApi.deleteReturn(r.id); message.success('Đã xóa'); qc.removeQueries({ queryKey: ['purchase-return', r.id] }); qc.invalidateQueries({ queryKey: ['purchase-returns'] }); } catch (e) { message.error(errMsg(e)); } } });
  return (
    <div className="kv-expanded">
      <Descriptions size="small" column={{ xs: 1, md: 3 }} colon={false} labelStyle={{ color: '#6b7280' }}>
        <Descriptions.Item label="Mã phiếu"><b>{r.code}</b></Descriptions.Item>
        <Descriptions.Item label="Trạng thái"><Tag color={DOC_STATUS_COLOR[r.status]}>{PDOC_STATUS_LABEL[r.status]}</Tag></Descriptions.Item>
        <Descriptions.Item label="Phiếu nhập gốc"><Link to={`/purchase-receipts?search=${r.receipt?.code}`}>{r.receipt?.code}</Link></Descriptions.Item>
        <Descriptions.Item label="Nhà cung cấp">{r.supplier?.name}</Descriptions.Item>
        <Descriptions.Item label="Kho">{r.warehouse?.name}</Descriptions.Item>
        <Descriptions.Item label="Ngày trả">{dt(r.returnDate)}</Descriptions.Item>
        <Descriptions.Item label="Lý do">{r.reason || '—'}</Descriptions.Item>
        {r.cancelledAt && <Descriptions.Item label="Hủy lúc">{dt(r.cancelledAt)} · {r.cancelReason}</Descriptions.Item>}
        <Descriptions.Item label="Ghi chú">{r.note || '—'}</Descriptions.Item>
      </Descriptions>
      <Table size="small" rowKey="id" pagination={false} dataSource={r.lines ?? []} style={{ marginTop: 8 }}
        columns={[
          { title: '#', dataIndex: 'lineNo', width: 40 },
          { title: 'Mã hàng', render: (_, l) => l.variant.sku, width: 120 },
          { title: 'Tên hàng', render: (_, l) => <span>{l.variant.name}{l.receiptLine?.batch && <Tag style={{ marginLeft: 6 }} color="gold">Lô {l.receiptLine.batch.batchNo}</Tag>}</span> },
          { title: 'ĐVT', render: (_, l) => l.variant.product.baseUnit ?? '', width: 60 },
          { title: 'SL nhập', className: 'num', width: 80, render: (_, l) => qty(l.receiptLine?.quantity) },
          { title: 'SL trả', dataIndex: 'quantity', className: 'num', width: 80, render: (v) => <b>{qty(v)}</b> },
          { title: 'Đơn giá trả', dataIndex: 'unitPrice', className: 'num', width: 110, render: (v) => money(v) },
          { title: 'Thành tiền', dataIndex: 'lineTotal', className: 'num', width: 120, render: (v) => money(v) },
          { title: 'Ghi chú', dataIndex: 'note', ellipsis: true },
        ]}
        summary={() => <Table.Summary.Row><Table.Summary.Cell index={0} colSpan={7}><b>Tổng giá trị trả</b></Table.Summary.Cell><Table.Summary.Cell index={1} className="num"><b>{money(r.totalAmount)}</b></Table.Summary.Cell><Table.Summary.Cell index={2}>Đã hoàn: <b>{money(r.refundedAmount)}</b></Table.Summary.Cell></Table.Summary.Row>} />
      {(r.refunds?.length ?? 0) > 0 && <Table size="small" rowKey="id" pagination={false} dataSource={r.refunds} style={{ marginTop: 8 }} title={() => <b>Hoàn tiền từ nhà cung cấp</b>}
        columns={[{ title: 'Phiếu thu', render: (_, a) => <Link to={`/payments?search=${a.payment.code}`}>{a.payment.code}</Link> }, { title: 'Ngày', render: (_, a) => dt(a.payment.paymentDate) }, { title: 'Phương thức', render: (_, a) => PAYMENT_METHOD_LABEL[a.payment.method] ?? a.payment.method }, { title: 'Số tiền', dataIndex: 'amount', className: 'num', render: (v) => money(v) }]} />}
      {(r.movements?.length ?? 0) > 0 && <Table size="small" rowKey="id" pagination={false} dataSource={r.movements} style={{ marginTop: 8 }} title={() => <b>Bút toán kho</b>}
        columns={[{ title: 'Thời gian', dataIndex: 'createdAt', render: (v) => dt(v, 'DD/MM/YYYY HH:mm:ss') }, { title: 'Loại', dataIndex: 'type', render: (v) => <Tag color={v === 'REVERSAL' ? 'red' : 'orange'}>{MOVEMENT_LABEL[v] ?? v}</Tag> }, { title: 'Hàng hóa', render: (_, m) => r.lines?.find((l) => l.variantId === m.variantId)?.variant.sku ?? m.variantId }, { title: 'SL', dataIndex: 'quantity', className: 'num', render: (v) => <span className={Number(v) >= 0 ? 'pos' : 'neg'}>{signedQty(v)}</span> }, ...(canCost ? [{ title: 'Giá vốn', dataIndex: 'unitCost', className: 'num', render: (v: string) => money(v) }] : []), { title: 'Tồn sau', dataIndex: 'balanceAfter', className: 'num', render: (v) => qty(v) }]} />}
      <div className="kv-detail-actions">
        {r.status === 'DRAFT' && can('purchase.return.create') && <Button icon={<EditOutlined />} onClick={() => nav(`/purchase-returns/${r.id}/edit`)}>Sửa</Button>}
        {r.status === 'DRAFT' && can('purchase.return.create') && <Button danger icon={<DeleteOutlined />} onClick={remove}>Xóa</Button>}
        {r.status === 'DRAFT' && can('purchase.return.post') && <Button type="primary" icon={<CheckOutlined />} onClick={() => setPosting(true)}>Hoàn thành</Button>}
        {r.status === 'POSTED' && can('purchase.return.cancel') && <Button danger icon={<StopOutlined />} onClick={cancel}>Hủy phiếu</Button>}
      </div>
      <RefundModal open={posting} total={Number(r.totalAmount)} code={r.code} onClose={() => setPosting(false)} onConfirm={async (refund) => { try { await purchasingApi.postReturn(r.id, refund); message.success(`Đã hoàn thành phiếu ${r.code}`); setPosting(false); refresh(); } catch (e) { message.error(errMsg(e)); } }} />
    </div>
  );
}
