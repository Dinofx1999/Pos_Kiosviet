import { App, Button, DatePicker, Descriptions, Empty, Input, Modal, Radio, Table, Tabs, Tag } from 'antd';
import { CarOutlined, DollarOutlined, PrinterOutlined, ReloadOutlined, RollbackOutlined, SearchOutlined, ShopOutlined, StopOutlined, DeleteOutlined } from '@ant-design/icons';
import { useEffect, useState } from 'react';
import { Link, useNavigate, useSearchParams } from 'react-router-dom';
import { useQueryClient } from '@tanstack/react-query';
import { InvoiceQuery, SALES_KEYS, salesApi, useInvoice, useInvoices } from '../../api/sales';
import { errMsg } from '../../api/client';
import type { Invoice } from '../../api/types';
import { CustomerSelect } from '../../components/CustomerSelect';
import { FilterCard, FilterPanel } from '../../components/FilterPanel';
import { PaymentModal } from '../../components/PaymentModal';
import { useAuthStore, useCan } from '../../store/auth';
import { INVOICE_STATUS_COLOR, INVOICE_STATUS_LABEL, MOVEMENT_LABEL, PAYMENT_METHOD_LABEL, dt, money, qty, signedQty } from '../../utils/format';
import { printHtml, receiptHtml } from '../pos/receipt';
import { RETURN_STATUS_COLOR, RETURN_STATUS_LABEL } from './SalesReturnShared';
import { DELIVERY_FINAL, DELIVERY_STATUS_COLOR, DELIVERY_STATUS_LABEL, DeliveryFormModal } from './DeliveryShared';

export default function InvoicesPage() {
  const can = useCan();
  const [sp] = useSearchParams();
  const branchId = useAuthStore((s) => s.currentBranchId);
  const me = useAuthStore((s) => s.me);
  const [q, setQ] = useState<InvoiceQuery>({ page: 1, pageSize: 20, search: sp.get('search') ?? undefined, status: sp.get('status') ?? undefined });
  const [searchText, setSearchText] = useState(q.search ?? '');
  useEffect(() => { const s = sp.get('search'); if (s) { setSearchText(s); setQ((x) => ({ ...x, search: s, page: 1 })); } }, [sp]);
  const { data, isLoading, isFetching, error, refetch } = useInvoices({ ...q, branchId: q.branchId ?? branchId ?? undefined });
  const set = (patch: Partial<InvoiceQuery>) => setQ((s) => ({ ...s, ...patch, page: patch.page ?? 1 }));
  const canCost = can('sales.report.view');
  return (
    <div className="kv-list">
      <FilterPanel>
        <FilterCard title="Trạng thái"><Radio.Group value={q.status ?? ''} onChange={(e) => set({ status: e.target.value || undefined })}><Radio value="">Tất cả</Radio><Radio value="COMPLETED">Hoàn thành</Radio><Radio value="DRAFT">Giữ đơn</Radio><Radio value="CANCELLED">Đã hủy</Radio></Radio.Group></FilterCard>
        <FilterCard title="Công nợ"><Radio.Group value={q.unpaid ?? ''} onChange={(e) => set({ unpaid: e.target.value || undefined })}><Radio value="">Tất cả</Radio><Radio value="true">Còn nợ</Radio></Radio.Group></FilterCard>
        <FilterCard title="Chi nhánh"><Radio.Group value={q.branchId ?? ''} onChange={(e) => set({ branchId: e.target.value || undefined })}><Radio value="">Chi nhánh đang chọn</Radio>{(me?.branches ?? []).map((b) => <Radio key={b.id} value={b.id}>{b.name}</Radio>)}</Radio.Group></FilterCard>
        <FilterCard title="Khách hàng"><CustomerSelect size="small" value={q.customerId} onChange={(v) => set({ customerId: v })} allowCreate={false} placeholder="Tất cả" /></FilterCard>
        <FilterCard title="Thời gian"><DatePicker.RangePicker size="small" style={{ width: '100%' }} format="DD/MM/YYYY" onChange={(r) => set({ from: r?.[0]?.startOf('day').toISOString(), to: r?.[1]?.endOf('day').toISOString() })} /></FilterCard>
      </FilterPanel>
      <div className="kv-main">
        <h1 className="kv-page-title">Hóa đơn</h1>
        <div className="kv-toolbar">
          <Input.Search className="kv-search" allowClear placeholder="Theo mã hóa đơn, khách hàng, SĐT, hàng hóa" value={searchText} onChange={(e) => setSearchText(e.target.value)} onSearch={(v) => set({ search: v || undefined })} enterButton={<SearchOutlined />} />
          <span className="spacer" />
          {can('invoice.create') && <Link to="/pos"><Button type="primary" icon={<ShopOutlined />}>Bán hàng</Button></Link>}
          <Button icon={<ReloadOutlined />} onClick={() => refetch()} loading={isFetching} />
        </div>
        <div className="kv-card">
          <Table className="kv-table" rowKey="id" size="small" loading={isLoading} dataSource={data?.data ?? []} rowSelection={{}} scroll={{ x: 1200 }}
            locale={{ emptyText: error ? <Empty description={errMsg(error)} /> : <Empty description="Chưa có hóa đơn" /> }}
            expandable={{ expandedRowRender: (r) => <InvoiceDetail id={r.id} />, expandRowByClick: true }}
            onChange={(p) => set({ page: p.current, pageSize: p.pageSize })}
            pagination={{ current: q.page, pageSize: q.pageSize, total: data?.meta.total ?? 0, showSizeChanger: true, pageSizeOptions: [15, 20, 50, 100], showTotal: (t) => `${t} hóa đơn` }}
            columns={[
              { title: 'Mã HĐ', dataIndex: 'code', width: 120, render: (v) => <b>{v}</b> },
              { title: 'Thời gian', dataIndex: 'invoiceDate', width: 140, render: (v) => dt(v) },
              { title: 'Khách hàng', render: (_, r) => r.customer ? <span>{r.customer.name}<span className="muted"> · {r.customer.phone ?? r.customer.code}</span></span> : <span className="muted">Khách lẻ</span> },
              { title: 'NV bán', width: 140, render: (_, r) => r.seller?.fullName },
              { title: 'Chi nhánh', width: 150, render: (_, r) => r.branch?.name },
              { title: 'Tổng tiền', dataIndex: 'totalAmount', className: 'num', width: 120, render: (v) => <b>{money(v)}</b> },
              { title: 'Đã thanh toán', dataIndex: 'paidAmount', className: 'num', width: 120, render: (v) => money(v) },
              { title: 'Còn nợ', dataIndex: 'dueAmount', className: 'num', width: 110, render: (v, r) => r.status === 'COMPLETED' ? <span className={Number(v) > 0 ? 'neg' : ''}>{money(v)}</span> : '' },
              ...(canCost ? [{ title: 'Lợi nhuận', className: 'num', width: 110, render: (_: unknown, r: Invoice) => r.status === 'COMPLETED' && r.costTotal !== undefined ? money(Number(r.totalAmount) - Number(r.costTotal)) : '' }] : []),
              { title: 'Trạng thái', dataIndex: 'status', width: 110, render: (v) => <Tag color={INVOICE_STATUS_COLOR[v]}>{INVOICE_STATUS_LABEL[v]}</Tag> },
            ]} />
        </div>
      </div>
    </div>
  );
}

export function InvoiceDetail({ id }: { id: string }) {
  const { data: inv, isLoading } = useInvoice(id);
  const can = useCan();
  const me = useAuthStore((s) => s.me);
  const nav = useNavigate();
  const qc = useQueryClient();
  const { message, modal } = App.useApp();
  const [tab, setTab] = useState('info');
  const [pay, setPay] = useState(false);
  const [ship, setShip] = useState(false);
  if (isLoading || !inv) return <div className="muted">Đang tải…</div>;
  const due = Number(inv.dueAmount ?? Number(inv.totalAmount) - Number(inv.paidAmount));
  // Module 06 relations (salesOrder / deliveries) – the Invoice type lives in api/types.ts which is owned elsewhere
  const ext = inv as Invoice & { salesOrder?: { id: string; code: string; status: string } | null; deliveries?: { id: string; code: string; status: string; carrier?: string | null; trackingCode?: string | null; codAmount?: string; codCollected?: boolean }[] };
  const activeDelivery = (ext.deliveries ?? []).find((d) => !DELIVERY_FINAL.includes(d.status as any));
  const refresh = () => SALES_KEYS.forEach((k) => qc.invalidateQueries({ queryKey: [k] }));
  const cancel = () => {
    let reason = '';
    modal.confirm({
      title: `Hủy hóa đơn ${inv.code}?`, okText: 'Hủy hóa đơn', okButtonProps: { danger: true }, cancelText: 'Bỏ qua',
      content: <div><div className="kv-hint" style={{ marginBottom: 6 }}>Hàng sẽ được nhập lại kho, các phiếu thu của hóa đơn này bị hủy và công nợ khách được hoàn lại.</div><Input placeholder="Lý do hủy" onChange={(e) => (reason = e.target.value)} /></div>,
      onOk: async () => { if (!reason.trim()) { message.warning('Nhập lý do hủy'); throw new Error('no reason'); } try { await salesApi.cancelInvoice(inv.id, reason.trim()); message.success('Đã hủy hóa đơn'); refresh(); } catch (e) { message.error(errMsg(e)); throw e; } },
    });
  };
  const removeDraft = () => modal.confirm({ title: `Xóa đơn giữ ${inv.code}?`, okText: 'Xóa', okButtonProps: { danger: true }, cancelText: 'Bỏ qua', onOk: async () => { try { await salesApi.deleteInvoice(inv.id); message.success('Đã xóa'); qc.removeQueries({ queryKey: ['invoice', inv.id] }); qc.invalidateQueries({ queryKey: ['invoices'] }); } catch (e) { message.error(errMsg(e)); } } });
  const print = () => { if (!printHtml(receiptHtml(inv, { storeName: me?.tenant.name }))) message.error('Trình duyệt không cho phép in'); };
  return (
    <div className="kv-expanded">
      <Tabs className="kv-detail-tabs" activeKey={tab} onChange={setTab} items={[
        { key: 'info', label: 'Thông tin', children: (
          <div>
            <Descriptions size="small" column={3} colon={false} labelStyle={{ color: '#6b7280' }}>
              <Descriptions.Item label="Mã HĐ"><b>{inv.code}</b> <Tag color={INVOICE_STATUS_COLOR[inv.status]}>{INVOICE_STATUS_LABEL[inv.status]}</Tag></Descriptions.Item>
              <Descriptions.Item label="Thời gian">{dt(inv.completedAt ?? inv.invoiceDate)}</Descriptions.Item>
              <Descriptions.Item label="Chi nhánh / kho">{inv.branch?.name} · {inv.warehouse?.name}</Descriptions.Item>
              <Descriptions.Item label="Khách hàng">{inv.customer ? <Link to={`/customers?search=${inv.customer.code}`}>{inv.customer.name}</Link> : 'Khách lẻ'}</Descriptions.Item>
              <Descriptions.Item label="Nhân viên bán">{inv.seller?.fullName}</Descriptions.Item>
              <Descriptions.Item label="Ca bán hàng">{inv.shift ? <Link to={`/shifts?search=${inv.shift.code}`}>{inv.shift.code}</Link> : '—'}</Descriptions.Item>
              {ext.salesOrder && <Descriptions.Item label="Đơn đặt hàng"><Link to={`/orders?search=${ext.salesOrder.code}`}>{ext.salesOrder.code}</Link></Descriptions.Item>}
              {(ext.deliveries?.length ?? 0) > 0 && <Descriptions.Item label="Vận đơn" span={ext.salesOrder ? 2 : 3}>{ext.deliveries!.map((d) => <span key={d.id} style={{ marginRight: 10, whiteSpace: 'nowrap' }}><Link to={`/deliveries?search=${d.code}`}><CarOutlined /> {d.code}</Link> <Tag color={DELIVERY_STATUS_COLOR[d.status]} style={{ marginInlineEnd: 0 }}>{DELIVERY_STATUS_LABEL[d.status] ?? d.status}</Tag>{d.carrier ? <span className="muted"> {d.carrier}</span> : null}</span>)}</Descriptions.Item>}
              {inv.cancelReason && <Descriptions.Item label="Lý do hủy" span={3}>{inv.cancelReason}</Descriptions.Item>}
              {inv.note && <Descriptions.Item label="Ghi chú" span={3}>{inv.note}</Descriptions.Item>}
            </Descriptions>
            <Table size="small" rowKey="id" pagination={false} dataSource={inv.lines ?? []} style={{ marginTop: 8 }}
              columns={[
                { title: '#', dataIndex: 'lineNo', width: 40 },
                { title: 'Mã hàng', width: 110, render: (_, l) => l.variant.sku },
                { title: 'Tên hàng', render: (_, l) => <span>{l.variant.name}{l.isGift ? <Tag color="green" style={{ marginLeft: 6 }}>Hàng tặng</Tag> : null}{l.batch ? <Tag style={{ marginLeft: 6 }}>Lô {l.batch.batchNo}</Tag> : null}</span> },
                { title: 'ĐVT', width: 80, render: (_, l) => l.unitName ?? l.variant.product.baseUnit },
                { title: 'SL', dataIndex: 'quantity', className: 'num', width: 70, render: (v) => qty(v) },
                { title: 'Đơn giá', dataIndex: 'unitPrice', className: 'num', width: 110, render: (v, l) => <span>{money(v)}{Number(l.listPrice) !== Number(v) && <div className="muted" style={{ fontSize: 11, textDecoration: 'line-through' }}>{money(l.listPrice)}</div>}</span> },
                { title: 'Giảm giá', dataIndex: 'discountAmount', className: 'num', width: 110, render: (v, l) => <span>{Number(v) ? money(v) : ''}{Number(l.promotionDiscount) > 0 && <div className="pos" style={{ fontSize: 11 }}>KM −{money(l.promotionDiscount)}</div>}</span> },
                { title: 'Thành tiền', dataIndex: 'lineTotal', className: 'num', width: 120, render: (v) => <b>{money(v)}</b> },
                ...(inv.costTotal !== undefined ? [{ title: 'Giá vốn', className: 'num', width: 110, render: (_: unknown, l: any) => money(l.costTotal) }] : []),
              ]} />
            <div style={{ display: 'flex', justifyContent: 'flex-end', marginTop: 8 }}>
              <Descriptions size="small" column={1} colon={false} labelStyle={{ width: 160, color: '#6b7280' }} style={{ width: 340 }}>
                <Descriptions.Item label="Tổng tiền hàng">{money(inv.subtotal)}</Descriptions.Item>
                <Descriptions.Item label="Giảm giá hóa đơn">{money(inv.discountAmount)}</Descriptions.Item>
                {(Number(inv.promotionDiscount) > 0 || (inv.promotions?.length ?? 0) > 0) && <Descriptions.Item label="Khuyến mãi">{Number(inv.promotionDiscount ?? 0) - Number(inv.promotions?.find((p) => p.type === 'VOUCHER')?.amount ?? 0) > 0 ? <span className="pos">− {money(Number(inv.promotionDiscount ?? 0) - Number(inv.promotions?.find((p) => p.type === 'VOUCHER')?.amount ?? 0))}</span> : <span className="muted">Giảm theo dòng / hàng tặng</span>}{inv.promotions?.filter((p) => p.type !== 'VOUCHER').length ? <div className="kv-hint">{inv.promotions.filter((p) => p.type !== 'VOUCHER').map((p) => `${p.promotion?.name ?? p.promotion?.code ?? ''}${Number(p.amount) > 0 ? ` −${money(p.amount)}` : ''}${Number(p.giftQuantity) > 0 ? ` (${qty(p.giftQuantity)} quà)` : ''}`).join(', ')}</div> : null}</Descriptions.Item>}
                {(inv.voucherCode || inv.promotions?.some((p) => p.type === 'VOUCHER')) && <Descriptions.Item label="Voucher"><span className="pos">− {money(inv.promotions?.find((p) => p.type === 'VOUCHER')?.amount ?? 0)}</span> <Tag color="gold">{inv.voucherCode ?? inv.promotions?.find((p) => p.type === 'VOUCHER')?.voucher?.code}</Tag></Descriptions.Item>}
                <Descriptions.Item label="Thuế">{money(inv.taxAmount)}</Descriptions.Item>
                <Descriptions.Item label="Khách cần trả"><b style={{ fontSize: 15 }}>{money(inv.totalAmount)}</b></Descriptions.Item>
                <Descriptions.Item label="Đã thanh toán">{money(inv.paidAmount)}</Descriptions.Item>
                {Number(inv.returnedAmount) > 0 && <Descriptions.Item label="Đã trả hàng"><span className="neg">− {money(inv.returnedAmount)}</span> <span className="muted">({inv.returns?.filter((r) => r.status === 'COMPLETED').length ?? 0} phiếu)</span></Descriptions.Item>}
                {inv.status === 'COMPLETED' && <Descriptions.Item label="Còn nợ"><b className={due > 0 ? 'neg' : ''}>{money(due)}</b></Descriptions.Item>}
                {inv.costTotal !== undefined && <Descriptions.Item label="Giá vốn / Lợi nhuận">{money(inv.costTotal)} / <b className="pos">{money(Number(inv.totalAmount) - Number(inv.costTotal))}</b></Descriptions.Item>}
              </Descriptions>
            </div>
          </div>
        ) },
        { key: 'pay', label: `Thanh toán (${inv.payments?.length ?? 0})`, children: (
          <Table size="small" rowKey="id" pagination={false} dataSource={inv.payments ?? []} locale={{ emptyText: 'Chưa thanh toán' }}
            columns={[{ title: 'Mã phiếu', render: (_, p) => <Link to={`/payments?search=${p.payment.code}`}>{p.payment.code}</Link> }, { title: 'Thời gian', render: (_, p) => dt(p.payment.paymentDate) }, { title: 'Phương thức', render: (_, p) => PAYMENT_METHOD_LABEL[p.payment.method] ?? p.payment.method }, { title: 'Tham chiếu', render: (_, p) => p.payment.reference }, { title: 'Số tiền', className: 'num', render: (_, p) => money(p.amount) }]} />
        ) },
        ...(inv.returns?.length ? [{ key: 'returns', label: `Trả hàng (${inv.returns.length})`, children: (
          <Table size="small" rowKey="id" pagination={false} dataSource={inv.returns}
            columns={[{ title: 'Phiếu trả', render: (_, r) => <Link to={`/sales-returns/${r.id}`}>{r.code}</Link> }, { title: 'Thời gian', dataIndex: 'returnDate', render: (v) => dt(v) }, { title: 'Loại', render: (_, r) => r.exchangeInvoiceId ? <Tag color="blue">Đổi hàng</Tag> : <Tag>Trả hàng</Tag> }, { title: 'Tiền hoàn', dataIndex: 'totalRefund', className: 'num', render: (v) => money(v) }, { title: 'Đã hoàn', dataIndex: 'refundedAmount', className: 'num', render: (v) => money(v) }, { title: 'Trạng thái', dataIndex: 'status', render: (v) => <Tag color={RETURN_STATUS_COLOR[v]}>{RETURN_STATUS_LABEL[v]}</Tag> }]} />
        ) }] : []),
        ...(inv.movements ? [{ key: 'stock', label: 'Bút toán kho', children: (
          <Table size="small" rowKey="id" pagination={false} dataSource={inv.movements} locale={{ emptyText: 'Chưa có bút toán' }}
            columns={[{ title: 'Thời gian', dataIndex: 'createdAt', render: (v) => dt(v, 'DD/MM/YYYY HH:mm:ss') }, { title: 'Loại', dataIndex: 'type', render: (v) => <Tag>{MOVEMENT_LABEL[v] ?? v}</Tag> }, { title: 'SL', dataIndex: 'quantity', className: 'num', render: (v) => <span className={Number(v) < 0 ? 'neg' : 'pos'}>{signedQty(v)}</span> }, { title: 'Giá vốn', dataIndex: 'unitCost', className: 'num', render: (v) => money(v) }, { title: 'Tồn sau', dataIndex: 'balanceAfter', className: 'num', render: (v) => qty(v) }]} />
        ) }] : []),
      ]} />
      <div className="kv-detail-actions">
        {inv.status === 'COMPLETED' && <Button icon={<PrinterOutlined />} onClick={print}>In</Button>}
        {inv.status === 'COMPLETED' && can('return.create') && <Button icon={<RollbackOutlined />} onClick={() => nav(`/sales-returns/new?invoiceId=${inv.id}`)}>Trả hàng</Button>}
        {inv.status === 'COMPLETED' && !activeDelivery && can('delivery.manage') && <Button icon={<CarOutlined />} onClick={() => setShip(true)}>Tạo vận đơn</Button>}
        {inv.status === 'COMPLETED' && due > 0 && can('payment.create') && <Button type="primary" icon={<DollarOutlined />} onClick={() => setPay(true)}>Thu nợ {money(due)}</Button>}
        {inv.status === 'COMPLETED' && can('invoice.cancel') && <Button danger icon={<StopOutlined />} onClick={cancel}>Hủy hóa đơn</Button>}
        {inv.status === 'DRAFT' && can('invoice.create') && <Button type="primary" icon={<ShopOutlined />} onClick={() => nav(`/pos?draft=${inv.id}`)}>Mở ở POS</Button>}
        {inv.status === 'DRAFT' && can('invoice.create') && <Button danger icon={<DeleteOutlined />} onClick={removeDraft}>Xóa</Button>}
      </div>
      {inv.customerId && <PaymentModal open={pay} partyType="CUSTOMER" direction="IN" partyId={inv.customerId} documentId={inv.id} amount={due} onClose={() => setPay(false)} onSaved={refresh} />}
      {!inv.customerId && pay && <Modal open title="Thu nợ" onCancel={() => setPay(false)} footer={null}>Hóa đơn khách lẻ không có công nợ.</Modal>}
      <DeliveryFormModal open={ship} invoiceId={inv.id} due={due} prefill={{ receiverName: inv.customer?.name ?? '', receiverPhone: inv.customer?.phone ?? '' }} onClose={() => setShip(false)} onSaved={refresh} />
    </div>
  );
}
