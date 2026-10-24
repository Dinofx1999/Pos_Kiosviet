import { App, Button, DatePicker, Descriptions, Empty, Input, Radio, Select, Table, Tag } from 'antd';
import { CheckOutlined, DeleteOutlined, EditOutlined, ImportOutlined, PlusOutlined, ReloadOutlined, SearchOutlined, StopOutlined } from '@ant-design/icons';
import { useState } from 'react';
import { Link, useNavigate, useSearchParams } from 'react-router-dom';
import { useQueryClient } from '@tanstack/react-query';
import { OrderQuery, PURCHASING_KEYS, purchasingApi, usePurchaseOrder, usePurchaseOrders } from '../../api/purchasing';
import { errMsg } from '../../api/client';
import { FilterCard, FilterPanel } from '../../components/FilterPanel';
import { SupplierSelect } from '../../components/SupplierSelect';
import { useAuthStore, useBranchWarehouses, useCan } from '../../store/auth';
import { DOC_STATUS_COLOR, PDOC_STATUS_LABEL, PO_STATUS_COLOR, PO_STATUS_LABEL, dt, d, money, pct, qty } from '../../utils/format';

export default function PurchaseOrdersPage() {
  const can = useCan();
  const nav = useNavigate();
  const [sp] = useSearchParams();
  const warehouses = useBranchWarehouses();
  const branchId = useAuthStore((s) => s.currentBranchId);
  const [q, setQ] = useState<OrderQuery>({ page: 1, pageSize: 20, search: sp.get('search') ?? undefined });
  const [searchText, setSearchText] = useState(q.search ?? '');
  const { data, isLoading, isFetching, error, refetch } = usePurchaseOrders({ ...q, branchId: branchId ?? undefined });
  const set = (patch: Partial<OrderQuery>) => setQ((s) => ({ ...s, ...patch, page: patch.page ?? 1 }));

  return (
    <div className="kv-list">
      <FilterPanel>
        <FilterCard title="Trạng thái"><Radio.Group value={q.status ?? ''} onChange={(e) => set({ status: e.target.value || undefined })} style={{ display: 'grid' }}><Radio value="">Tất cả</Radio>{Object.entries(PO_STATUS_LABEL).map(([k, v]) => <Radio key={k} value={k}>{v}</Radio>)}</Radio.Group></FilterCard>
        <FilterCard title="Nhà cung cấp"><SupplierSelect size="small" value={q.supplierId} onChange={(v) => set({ supplierId: v })} allowCreate={false} placeholder="Tất cả" /></FilterCard>
        <FilterCard title="Kho nhận"><Select size="small" allowClear style={{ width: '100%' }} placeholder="Tất cả kho" value={q.warehouseId} onChange={(v) => set({ warehouseId: v })} options={warehouses.map((w) => ({ value: w.id, label: w.name }))} /></FilterCard>
        <FilterCard title="Ngày đặt"><DatePicker.RangePicker size="small" style={{ width: '100%' }} format="DD/MM/YYYY" onChange={(r) => set({ from: r?.[0]?.startOf('day').toISOString(), to: r?.[1]?.endOf('day').toISOString() })} /></FilterCard>
      </FilterPanel>
      <div className="kv-main">
        <h1 className="kv-page-title">Đặt hàng nhập</h1>
        <div className="kv-toolbar">
          <Input.Search className="kv-search" allowClear placeholder="Theo mã phiếu, nhà cung cấp, hàng hóa" value={searchText} onChange={(e) => setSearchText(e.target.value)} onSearch={(v) => set({ search: v || undefined })} enterButton={<SearchOutlined />} />
          <span className="spacer" />
          {can('purchase.order.create') && <Button type="primary" icon={<PlusOutlined />} onClick={() => nav('/purchase-orders/new')}>Đặt hàng nhập</Button>}
          <Button icon={<ReloadOutlined />} onClick={() => refetch()} loading={isFetching} />
        </div>
        <div className="kv-card">
          <Table className="kv-table" rowKey="id" size="small" loading={isLoading} dataSource={data?.data ?? []} rowSelection={{}} scroll={{ x: 1150 }}
            locale={{ emptyText: error ? <Empty description={errMsg(error)} /> : <Empty description="Chưa có đơn đặt hàng nhập" /> }}
            expandable={{ expandedRowRender: (r) => <PurchaseOrderDetail id={r.id} />, expandRowByClick: true }}
            onChange={(p) => set({ page: p.current, pageSize: p.pageSize })}
            pagination={{ current: q.page, pageSize: q.pageSize, total: data?.meta.total ?? 0, showSizeChanger: true, pageSizeOptions: [15, 20, 50, 100], showTotal: (t) => `${t} đơn` }}
            columns={[
              { title: 'Mã PDN', dataIndex: 'code', width: 140, render: (v) => <b>{v}</b> },
              { title: 'Nhà cung cấp', render: (_, r) => r.supplier?.name },
              { title: 'Kho', render: (_, r) => r.warehouse?.name, width: 140 },
              { title: 'Ngày đặt', dataIndex: 'orderDate', width: 120, render: (v) => dt(v) },
              { title: 'Dự kiến', dataIndex: 'expectedDate', width: 100, render: (v) => d(v) || '—' },
              { title: 'Tổng tiền', dataIndex: 'totalAmount', className: 'num', width: 130, render: (v) => money(v) },
              { title: 'Trạng thái', dataIndex: 'status', width: 130, render: (v) => <Tag color={PO_STATUS_COLOR[v]}>{PO_STATUS_LABEL[v]}</Tag> },
              { title: 'Ghi chú', dataIndex: 'note', ellipsis: true },
            ]} />
        </div>
      </div>
    </div>
  );
}

export function PurchaseOrderDetail({ id }: { id: string }) {
  const { data: o, isLoading } = usePurchaseOrder(id);
  const can = useCan();
  const nav = useNavigate();
  const qc = useQueryClient();
  const { message, modal } = App.useApp();
  if (isLoading || !o) return <div className="muted">Đang tải…</div>;
  const refresh = () => PURCHASING_KEYS.forEach((k) => qc.invalidateQueries({ queryKey: [k] }));
  const confirm = () => modal.confirm({ title: `Xác nhận đơn ${o.code}?`, content: 'Sau khi xác nhận có thể lập phiếu nhập hàng từ đơn này.', okText: 'Xác nhận', cancelText: 'Bỏ qua', onOk: async () => { try { await purchasingApi.confirmOrder(o.id); message.success('Đã xác nhận đơn'); refresh(); } catch (e) { message.error(errMsg(e)); } } });
  const cancel = () => { let reason = ''; modal.confirm({ title: `Hủy đơn ${o.code}?`, content: <Input.TextArea placeholder="Lý do hủy (bắt buộc)" onChange={(e) => (reason = e.target.value)} />, okText: 'Hủy đơn', okButtonProps: { danger: true }, cancelText: 'Bỏ qua', onOk: async () => { if (!reason.trim()) { message.warning('Nhập lý do'); throw new Error('reason'); } try { await purchasingApi.cancelOrder(o.id, reason.trim()); message.success('Đã hủy đơn'); refresh(); } catch (e) { message.error(errMsg(e)); throw e; } } }); };
  const remove = () => modal.confirm({ title: `Xóa đơn tạm ${o.code}?`, okText: 'Xóa', okButtonProps: { danger: true }, cancelText: 'Bỏ qua', onOk: async () => { try { await purchasingApi.deleteOrder(o.id); message.success('Đã xóa'); qc.removeQueries({ queryKey: ['purchase-order', o.id] }); qc.invalidateQueries({ queryKey: ['purchase-orders'] }); } catch (e) { message.error(errMsg(e)); } } });
  const receivable = o.status === 'CONFIRMED' || o.status === 'PARTIAL';
  return (
    <div className="kv-expanded">
      <Descriptions size="small" column={{ xs: 1, md: 3 }} colon={false} labelStyle={{ color: '#6b7280' }}>
        <Descriptions.Item label="Mã đơn"><b>{o.code}</b></Descriptions.Item>
        <Descriptions.Item label="Trạng thái"><Tag color={PO_STATUS_COLOR[o.status]}>{PO_STATUS_LABEL[o.status]}</Tag></Descriptions.Item>
        <Descriptions.Item label="Nhà cung cấp">{o.supplier?.name} ({o.supplier?.code})</Descriptions.Item>
        <Descriptions.Item label="Chi nhánh / Kho">{o.branch?.name} / {o.warehouse?.name}</Descriptions.Item>
        <Descriptions.Item label="Ngày đặt">{dt(o.orderDate)}</Descriptions.Item>
        <Descriptions.Item label="Dự kiến nhận">{d(o.expectedDate) || '—'}</Descriptions.Item>
        {o.cancelledAt && <Descriptions.Item label="Hủy lúc">{dt(o.cancelledAt)} · {o.cancelReason}</Descriptions.Item>}
        <Descriptions.Item label="Ghi chú">{o.note || '—'}</Descriptions.Item>
      </Descriptions>
      <Table size="small" rowKey="id" pagination={false} dataSource={o.lines ?? []} style={{ marginTop: 8 }}
        columns={[
          { title: '#', dataIndex: 'lineNo', width: 40 },
          { title: 'Mã hàng', render: (_, l) => l.variant.sku, width: 120 },
          { title: 'Tên hàng', render: (_, l) => l.variant.name },
          { title: 'ĐVT', render: (_, l) => l.variant.product.baseUnit ?? '', width: 60 },
          { title: 'SL đặt', dataIndex: 'quantity', className: 'num', width: 80, render: (v) => qty(v) },
          { title: 'Đã nhận', dataIndex: 'receivedQuantity', className: 'num', width: 80, render: (v) => qty(v) },
          { title: 'Còn lại', dataIndex: 'remainingQuantity', className: 'num', width: 80, render: (v) => <b className={Number(v) > 0 ? 'neg' : 'pos'}>{qty(v)}</b> },
          { title: 'Đơn giá', dataIndex: 'unitPrice', className: 'num', width: 110, render: (v) => money(v) },
          { title: 'CK', dataIndex: 'discountAmount', className: 'num', width: 90, render: (v) => money(v) },
          { title: 'Thuế', dataIndex: 'taxRate', className: 'num', width: 60, render: (v) => pct(v) || '0%' },
          { title: 'Thành tiền', dataIndex: 'lineTotal', className: 'num', width: 120, render: (v) => money(v) },
        ]}
        summary={() => <Table.Summary.Row><Table.Summary.Cell index={0} colSpan={10}><div className="kv-kv" style={{ maxWidth: 420, marginLeft: 'auto' }}><span className="k">Tổng tiền hàng</span><span className="v">{money(o.subtotal)}</span><span className="k">Chiết khấu đơn</span><span className="v">{money(o.discountAmount)}</span><span className="k">Thuế</span><span className="v">{money(o.taxAmount)}</span><span className="k"><b>Tổng cộng</b></span><span className="v"><b>{money(o.totalAmount)}</b></span></div></Table.Summary.Cell><Table.Summary.Cell index={1} /></Table.Summary.Row>} />
      {(o.receipts?.length ?? 0) > 0 && <Table size="small" rowKey="id" pagination={false} dataSource={o.receipts} style={{ marginTop: 8 }} title={() => <b>Phiếu nhập từ đơn này</b>}
        columns={[{ title: 'Mã phiếu', dataIndex: 'code', render: (v) => <Link to={`/purchase-receipts?search=${v}`}>{v}</Link> }, { title: 'Ngày', dataIndex: 'receiptDate', render: (v) => dt(v) }, { title: 'Tổng tiền', dataIndex: 'totalAmount', className: 'num', render: (v) => money(v) }, { title: 'Trạng thái', dataIndex: 'status', render: (v) => <Tag color={DOC_STATUS_COLOR[v]}>{PDOC_STATUS_LABEL[v]}</Tag> }]} />}
      <div className="kv-detail-actions">
        {o.status === 'DRAFT' && can('purchase.order.create') && <Button icon={<EditOutlined />} onClick={() => nav(`/purchase-orders/${o.id}/edit`)}>Sửa</Button>}
        {o.status === 'DRAFT' && can('purchase.order.create') && <Button danger icon={<DeleteOutlined />} onClick={remove}>Xóa</Button>}
        {o.status === 'DRAFT' && can('purchase.order.confirm') && <Button type="primary" icon={<CheckOutlined />} onClick={confirm}>Xác nhận</Button>}
        {receivable && can('purchase.receipt.create') && <Button type="primary" icon={<ImportOutlined />} onClick={() => nav(`/purchase-receipts/new?orderId=${o.id}`)}>Nhập hàng từ đơn</Button>}
        {o.status !== 'RECEIVED' && o.status !== 'CANCELLED' && can('purchase.order.cancel') && <Button danger icon={<StopOutlined />} onClick={cancel}>Hủy đơn</Button>}
      </div>
    </div>
  );
}
