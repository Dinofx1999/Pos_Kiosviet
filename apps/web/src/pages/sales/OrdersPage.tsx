import { Button, DatePicker, Empty, Input, Pagination, Radio, Tag } from 'antd';
import Table from '../../components/ResponsiveTable';
import { CarOutlined, DownOutlined, PlusOutlined, ReloadOutlined, SearchOutlined, UpOutlined } from '@ant-design/icons';
import { useEffect, useMemo, useState } from 'react';
import { Link, useNavigate, useSearchParams } from 'react-router-dom';
import { OrderQuery, SalesOrder, useOrders } from '../../api/orders';
import { CustomerSelect } from '../../components/CustomerSelect';
import { FilterCard, FilterPanel } from '../../components/FilterPanel';
import { useIsMobile } from '../../hooks/useMedia';
import { useAuthStore, useCan } from '../../store/auth';
import { dt, money, toNum } from '../../utils/format';
import { DELIVERY_STATUS_COLOR, DELIVERY_STATUS_LABEL } from './DeliveryShared';
import { DeliveryChip, ORDER_SOURCE_LABEL, ORDER_STATUS_COLOR, ORDER_STATUS_LABEL, OrderDetail, orderErrMsg } from './OrderShared';
import './orders.css';

/** KiotViet "Đặt hàng": sales orders with deposits / deliveries – filters, summary strip, phone cards or desktop table, expandable detail with the status actions. */
export default function OrdersPage() {
  const can = useCan();
  const nav = useNavigate();
  const [sp] = useSearchParams();
  const isMobile = useIsMobile();
  const branchId = useAuthStore((s) => s.currentBranchId);
  const me = useAuthStore((s) => s.me);
  const [q, setQ] = useState<OrderQuery>({ page: 1, pageSize: 20, search: sp.get('search') ?? undefined, status: sp.get('status') ?? undefined });
  const [searchText, setSearchText] = useState(q.search ?? '');
  const [expanded, setExpanded] = useState<string[]>([]);
  useEffect(() => { const s = sp.get('search'); if (s) { setSearchText(s); setQ((x) => ({ ...x, search: s, page: 1 })); } }, [sp]);
  const { data, isLoading, isFetching, error, refetch } = useOrders({ ...q, branchId: q.branchId ?? branchId ?? undefined });
  const set = (patch: Partial<OrderQuery>) => setQ((s) => ({ ...s, ...patch, page: patch.page ?? 1 }));
  const rows = data?.data ?? [];
  const total = data?.meta.total ?? 0;
  const sum = useMemo(() => rows.reduce((s, r) => (r.status === 'CANCELLED' ? s : { total: s.total + toNum(r.totalAmount), due: s.due + (r.status === 'COMPLETED' ? 0 : toNum(r.dueAmount)) }), { total: 0, due: 0 }), [rows]);
  const toggle = (id: string) => setExpanded((p) => (p.includes(id) ? p.filter((x) => x !== id) : [...p, id]));
  // a single search hit opens itself (deep links from invoices / deliveries)
  useEffect(() => { if (q.search && rows.length === 1 && !expanded.includes(rows[0].id)) setExpanded([rows[0].id]); }, [q.search, rows.length]);

  const filters = (
    <FilterPanel>
      <FilterCard title="Trạng thái"><Radio.Group value={q.status ?? ''} onChange={(e) => set({ status: e.target.value || undefined })}><Radio value="">Tất cả</Radio><Radio value="DRAFT">Phiếu tạm</Radio><Radio value="CONFIRMED">Đang xử lý (đã giữ hàng)</Radio><Radio value="COMPLETED">Hoàn thành</Radio><Radio value="CANCELLED">Đã hủy</Radio></Radio.Group></FilterCard>
      <FilterCard title="Thanh toán"><Radio.Group value={q.unpaid ?? ''} onChange={(e) => set({ unpaid: e.target.value || undefined })}><Radio value="">Tất cả</Radio><Radio value="true">Còn phải thu</Radio></Radio.Group></FilterCard>
      <FilterCard title="Nguồn đơn"><Radio.Group value={q.source ?? ''} onChange={(e) => set({ source: e.target.value || undefined })}><Radio value="">Tất cả</Radio>{Object.entries(ORDER_SOURCE_LABEL).map(([v, l]) => <Radio key={v} value={v}>{l}</Radio>)}</Radio.Group></FilterCard>
      <FilterCard title="Chi nhánh"><Radio.Group value={q.branchId ?? ''} onChange={(e) => set({ branchId: e.target.value || undefined })}><Radio value="">Chi nhánh đang chọn</Radio>{(me?.branches ?? []).map((b) => <Radio key={b.id} value={b.id}>{b.name}</Radio>)}</Radio.Group></FilterCard>
      <FilterCard title="Khách hàng"><CustomerSelect size="small" value={q.customerId} onChange={(v) => set({ customerId: v })} allowCreate={false} placeholder="Tất cả" /></FilterCard>
      <FilterCard title="Ngày đặt"><DatePicker.RangePicker size="small" style={{ width: '100%' }} format="DD/MM/YYYY" onChange={(r) => set({ from: r?.[0]?.startOf('day').toISOString(), to: r?.[1]?.endOf('day').toISOString() })} /></FilterCard>
    </FilterPanel>
  );

  return (
    <div className="kv-list">
      {filters}
      <div className="kv-main">
        <h1 className="kv-page-title">Đặt hàng</h1>
        <div className="kv-toolbar">
          <Input.Search className="kv-search" allowClear placeholder="Mã đơn, tên / SĐT khách, người nhận, mã vận đơn" value={searchText} onChange={(e) => setSearchText(e.target.value)} onSearch={(v) => set({ search: v || undefined })} enterButton={<SearchOutlined />} />
          <span className="spacer" />
          {can('order.create') && <Button type="primary" icon={<PlusOutlined />} onClick={() => nav('/orders/new')}>Đặt hàng</Button>}
          {can('delivery.view') && !isMobile && <Link to="/deliveries"><Button icon={<CarOutlined />}>Giao hàng</Button></Link>}
          <Button icon={<ReloadOutlined />} onClick={() => refetch()} loading={isFetching} />
        </div>
        <div className="od-summary">
          <div className="od-tile"><div className="lbl">Số đơn</div><div className="val">{total}</div></div>
          <div className="od-tile"><div className="lbl">Tổng tiền{total > rows.length ? ' (trang này)' : ''}</div><div className="val">{money(sum.total)}</div></div>
          <div className="od-tile"><div className="lbl">Còn phải thu{total > rows.length ? ' (trang này)' : ''}</div><div className={`val${sum.due > 0 ? ' neg' : ''}`}>{money(sum.due)}</div></div>
        </div>
        {isMobile ? (
          <div>
            {isLoading && <div className="muted" style={{ padding: 12 }}>Đang tải…</div>}
            {!isLoading && !rows.length && <div className="kv-card" style={{ padding: 16 }}><Empty description={error ? orderErrMsg(error) : 'Chưa có đơn đặt hàng'} /></div>}
            <div className="od-cards">
              {rows.map((r) => {
                const open = expanded.includes(r.id);
                const due = toNum(r.dueAmount);
                return (
                  <div key={r.id} className="od-card" onClick={() => toggle(r.id)}>
                    <div className="od-card-head"><span><b>{r.code}</b> <Tag color={ORDER_STATUS_COLOR[r.status]}>{ORDER_STATUS_LABEL[r.status]}</Tag></span><span className="muted">{open ? <UpOutlined /> : <DownOutlined />}</span></div>
                    <div className="od-card-meta">{dt(r.orderDate)} · {ORDER_SOURCE_LABEL[r.source] ?? r.source}{r.expectedAt ? ` · hẹn ${dt(r.expectedAt, 'DD/MM HH:mm')}` : ''}{r._count ? ` · ${r._count.lines} dòng` : ''}</div>
                    <div className="od-card-meta">{r.customer ? `${r.customer.name}${r.customer.phone ? ` · ${r.customer.phone}` : ''}` : 'Khách lẻ'} · {r.branch?.name}</div>
                    {(r.delivery || r.invoice) && <div className="od-card-meta" style={{ display: 'flex', gap: 6, flexWrap: 'wrap', alignItems: 'center' }}>{r.delivery && <span className={`od-chip od-chip-${r.delivery.status}`}><CarOutlined /> {DELIVERY_STATUS_LABEL[r.delivery.status]}{r.delivery.carrier ? ` · ${r.delivery.carrier}` : ''}</span>}{r.invoice && <span>HĐ {r.invoice.code}</span>}</div>}
                    <div className="od-card-amts"><span>Tổng <b>{money(r.totalAmount)}</b>{toNum(r.depositAmount) > 0 && <span className="muted"> · cọc {money(r.depositAmount)}</span>}</span>{r.status === 'COMPLETED' ? <span className="pos">Đã lập hóa đơn</span> : r.status === 'CANCELLED' ? null : due > 0 ? <span className="neg">Còn thu {money(due)}</span> : <span className="pos">Đã cọc đủ</span>}</div>
                    {open && <div className="od-card-body" onClick={(e) => e.stopPropagation()}><OrderDetail id={r.id} onDeleted={() => setExpanded((p) => p.filter((x) => x !== r.id))} /></div>}
                  </div>
                );
              })}
            </div>
            {total > (q.pageSize ?? 20) && <div className="od-pager"><Pagination simple current={q.page} pageSize={q.pageSize} total={total} onChange={(page, pageSize) => set({ page, pageSize })} /></div>}
          </div>
        ) : (
          <div className="kv-card">
            <Table<SalesOrder> className="kv-table" rowKey="id" size="small" loading={isLoading} dataSource={rows} scroll={{ x: 1300 }}
              locale={{ emptyText: error ? <Empty description={orderErrMsg(error)} /> : <Empty description="Chưa có đơn đặt hàng" /> }}
              expandable={{ expandedRowRender: (r) => <OrderDetail id={r.id} />, expandRowByClick: true, expandedRowKeys: expanded, onExpandedRowsChange: (keys) => setExpanded(keys as string[]) }}
              onChange={(p) => set({ page: p.current, pageSize: p.pageSize })}
              pagination={{ current: q.page, pageSize: q.pageSize, total, showSizeChanger: true, pageSizeOptions: [15, 20, 50, 100], showTotal: (t) => `${t} đơn` }}
              columns={[
                { title: 'Mã đơn', dataIndex: 'code', width: 110, render: (v) => <b>{v}</b> },
                { title: 'Ngày đặt', dataIndex: 'orderDate', width: 130, render: (v) => dt(v) },
                { title: 'Khách hàng', width: 200, render: (_, r) => r.customer ? <span>{r.customer.name}<span className="muted"> · {r.customer.phone ?? r.customer.code}</span></span> : <span className="muted">Khách lẻ</span> },
                { title: 'Nguồn', dataIndex: 'source', width: 100, render: (v) => ORDER_SOURCE_LABEL[v] ?? v },
                { title: 'Hẹn giao', dataIndex: 'expectedAt', width: 120, render: (v) => (v ? dt(v) : '') },
                { title: 'Tổng tiền', dataIndex: 'totalAmount', className: 'num', width: 115, render: (v) => <b>{money(v)}</b> },
                { title: 'Đã cọc', dataIndex: 'depositAmount', className: 'num', width: 105, render: (v) => (toNum(v) ? money(v) : '') },
                { title: 'Còn phải thu', dataIndex: 'dueAmount', className: 'num', width: 115, render: (v, r) => r.status === 'DRAFT' || r.status === 'CONFIRMED' ? <span className={toNum(v) > 0 ? 'neg' : 'pos'}>{money(v)}</span> : '' },
                { title: 'Giao hàng', width: 170, render: (_, r) => r.delivery ? <span style={{ display: 'inline-flex', gap: 4, alignItems: 'center', flexWrap: 'wrap' }}><Tag color={DELIVERY_STATUS_COLOR[r.delivery.status]} style={{ marginInlineEnd: 0 }}>{DELIVERY_STATUS_LABEL[r.delivery.status]}</Tag><DeliveryChip d={r.delivery} /></span> : '' },
                { title: 'Hóa đơn', width: 110, render: (_, r) => r.invoice ? <Link to={`/invoices?search=${r.invoice.code}`} onClick={(e) => e.stopPropagation()}>{r.invoice.code}</Link> : '' },
                { title: 'Trạng thái', dataIndex: 'status', width: 120, render: (v) => <Tag color={ORDER_STATUS_COLOR[v]}>{ORDER_STATUS_LABEL[v]}</Tag> },
                { title: 'Ghi chú', dataIndex: 'note', ellipsis: true },
              ]} />
          </div>
        )}
      </div>
    </div>
  );
}
