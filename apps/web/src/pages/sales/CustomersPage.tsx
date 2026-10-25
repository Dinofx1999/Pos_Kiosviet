import { App, Button, Descriptions, Empty, Input, Radio, Select, Tabs, Tag } from 'antd';
import Table from '../../components/ResponsiveTable';
import { CheckCircleOutlined, DollarOutlined, EditOutlined, PlusOutlined, ReloadOutlined, SearchOutlined, StopOutlined } from '@ant-design/icons';
import { useEffect, useState } from 'react';
import { Link, useSearchParams } from 'react-router-dom';
import { useQueryClient } from '@tanstack/react-query';
import { CustomerQuery, salesApi, useCustomer, useCustomerGroups, useCustomerHistory, useCustomerLedger, useCustomers } from '../../api/sales';
import { errMsg } from '../../api/client';
import type { Customer } from '../../api/types';
import { CustomerFormModal } from '../../components/CustomerSelect';
import { FilterCard, FilterPanel } from '../../components/FilterPanel';
import { PaymentModal } from '../../components/PaymentModal';
import { useCan } from '../../store/auth';
import { GENDER_LABEL, INVOICE_STATUS_COLOR, INVOICE_STATUS_LABEL, LEDGER_DOC_PATH, LEDGER_TYPE_LABEL, PAYMENT_METHOD_LABEL, d, dt, money } from '../../utils/format';
import { PAYMENT_METHOD_LABELS } from '@erp/shared';
import { CustomerPointsTab, PointsBadge } from './CustomerPointsTab';
import { RETURN_STATUS_COLOR, RETURN_STATUS_LABEL } from './SalesReturnShared';

const methodLabel = (m: string) => PAYMENT_METHOD_LABEL[m] ?? (PAYMENT_METHOD_LABELS as Record<string, string>)[m] ?? m;

export default function CustomersPage() {
  const can = useCan();
  const [sp] = useSearchParams();
  const [q, setQ] = useState<CustomerQuery>({ page: 1, pageSize: 20, search: sp.get('search') ?? undefined, isActive: 'true' });
  const [searchText, setSearchText] = useState(q.search ?? '');
  useEffect(() => { const s = sp.get('search'); if (s) { setSearchText(s); setQ((x) => ({ ...x, search: s, page: 1 })); } }, [sp]);
  const [form, setForm] = useState<{ open: boolean; customer?: Customer | null }>({ open: false });
  const [pay, setPay] = useState<{ open: boolean; customerId?: string }>({ open: false });
  const { data, isLoading, isFetching, error, refetch } = useCustomers(q);
  const { data: groups } = useCustomerGroups();
  const set = (patch: Partial<CustomerQuery>) => setQ((s) => ({ ...s, ...patch, page: patch.page ?? 1 }));
  const canDebt = can('customer.debt.view');
  return (
    <div className="kv-list">
      <FilterPanel>
        <FilterCard title="Trạng thái"><Radio.Group value={q.isActive ?? ''} onChange={(e) => set({ isActive: e.target.value || undefined })}><Radio value="true">Đang giao dịch</Radio><Radio value="false">Ngừng giao dịch</Radio><Radio value="">Tất cả</Radio></Radio.Group></FilterCard>
        {canDebt && <FilterCard title="Công nợ"><Radio.Group value={q.hasDebt ?? ''} onChange={(e) => set({ hasDebt: e.target.value || undefined })}><Radio value="">Tất cả</Radio><Radio value="true">Đang có công nợ</Radio></Radio.Group></FilterCard>}
        <FilterCard title="Nhóm khách hàng"><Select size="small" allowClear style={{ width: '100%' }} placeholder="Tất cả nhóm" value={q.groupName} onChange={(v) => set({ groupName: v })} options={(groups ?? []).map((g) => ({ value: g.name, label: `${g.name} (${g.count})` }))} /></FilterCard>
      </FilterPanel>
      <div className="kv-main">
        <h1 className="kv-page-title">Khách hàng</h1>
        <div className="kv-toolbar">
          <Input.Search className="kv-search" allowClear placeholder="Theo mã, tên, điện thoại, email" value={searchText} onChange={(e) => setSearchText(e.target.value)} onSearch={(v) => set({ search: v || undefined })} enterButton={<SearchOutlined />} />
          <span className="spacer" />
          {can('customer.manage') && <Button type="primary" icon={<PlusOutlined />} onClick={() => setForm({ open: true, customer: null })}>Thêm mới</Button>}
          {can('payment.create') && <Button icon={<DollarOutlined />} onClick={() => setPay({ open: true })}>Thu nợ khách</Button>}
          <Button icon={<ReloadOutlined />} onClick={() => refetch()} loading={isFetching} />
        </div>
        <div className="kv-card">
          <Table className="kv-table" rowKey="id" size="small" loading={isLoading} dataSource={data?.data ?? []} rowSelection={{}} scroll={{ x: 1100 }}
            locale={{ emptyText: error ? <Empty description={errMsg(error)} /> : <Empty description="Chưa có khách hàng" /> }}
            expandable={{ expandedRowRender: (r) => <CustomerDetail id={r.id} onEdit={() => setForm({ open: true, customer: r })} onPay={() => setPay({ open: true, customerId: r.id })} />, expandRowByClick: true }}
            onChange={(p) => set({ page: p.current, pageSize: p.pageSize })}
            pagination={{ current: q.page, pageSize: q.pageSize, total: data?.meta.total ?? 0, showSizeChanger: true, pageSizeOptions: [15, 20, 50, 100], showTotal: (t) => `${t} khách hàng` }}
            columns={[
              { title: 'Mã KH', dataIndex: 'code', width: 110, render: (v) => <b>{v}</b> },
              { title: 'Tên khách hàng', dataIndex: 'name' },
              { title: 'Điện thoại', dataIndex: 'phone', width: 120 },
              { title: 'Nhóm', dataIndex: 'groupName', width: 120 },
              { title: 'Điểm', dataIndex: 'points', className: 'num', width: 110, render: (v) => v !== undefined && v !== null ? <PointsBadge value={v} /> : <span className="muted">—</span> },
              ...(canDebt ? [{ title: 'Nợ hiện tại', dataIndex: 'balance', className: 'num', width: 130, render: (v: string) => <span className={Number(v) > 0 ? 'neg' : Number(v) < 0 ? 'pos' : ''}>{money(v)}</span> }] : []),
              { title: 'Hạn mức nợ', dataIndex: 'creditLimit', className: 'num', width: 120, render: (v) => v ? money(v) : <span className="muted">Không giới hạn</span> },
              { title: 'Trạng thái', dataIndex: 'isActive', width: 130, render: (v) => <Tag color={v ? 'green' : 'default'}>{v ? 'Đang giao dịch' : 'Ngừng giao dịch'}</Tag> },
              { title: 'Tạo ngày', dataIndex: 'createdAt', width: 110, render: (v) => d(v) },
            ]} />
        </div>
      </div>
      <CustomerFormModal open={form.open} customer={form.customer} onClose={() => setForm({ open: false })} onSaved={() => setForm({ open: false })} />
      <PaymentModal open={pay.open} partyType="CUSTOMER" direction="IN" partyId={pay.customerId} onClose={() => setPay({ open: false })} />
    </div>
  );
}

export function CustomerDetail({ id, onEdit, onPay }: { id: string; onEdit: () => void; onPay: () => void }) {
  const { data: c, isLoading } = useCustomer(id);
  const can = useCan();
  const { message, modal } = App.useApp();
  const qc = useQueryClient();
  const [tab, setTab] = useState('info');
  if (isLoading || !c) return <div className="muted">Đang tải…</div>;
  const canDebt = can('customer.debt.view');
  const toggle = () => modal.confirm({ title: c.isActive ? `Ngừng giao dịch với ${c.name}?` : `Cho phép giao dịch lại với ${c.name}?`, okText: 'Đồng ý', cancelText: 'Bỏ qua', onOk: async () => { try { await salesApi.updateCustomer(c.id, { isActive: !c.isActive }); message.success('Đã cập nhật'); ['customers', 'customer'].forEach((k) => qc.invalidateQueries({ queryKey: [k] })); } catch (e) { message.error(errMsg(e)); } } });
  return (
    <div className="kv-expanded">
      <Tabs className="kv-detail-tabs" activeKey={tab} onChange={setTab} items={[
        { key: 'info', label: 'Thông tin', children: (
          <div style={{ display: 'flex', gap: 24, flexWrap: 'wrap' }}>
            <Descriptions size="small" column={1} colon={false} labelStyle={{ width: 140, color: '#6b7280' }} style={{ flex: '1 1 320px' }}>
              <Descriptions.Item label="Mã KH"><b>{c.code}</b></Descriptions.Item>
              <Descriptions.Item label="Tên">{c.name}</Descriptions.Item>
              <Descriptions.Item label="Điện thoại">{c.phone || '—'}</Descriptions.Item>
              <Descriptions.Item label="Email">{c.email || '—'}</Descriptions.Item>
              <Descriptions.Item label="Địa chỉ">{c.address || '—'}</Descriptions.Item>
              <Descriptions.Item label="Giới tính / Sinh nhật">{c.gender ? GENDER_LABEL[c.gender] : '—'}{c.birthday ? ` · ${d(c.birthday)}` : ''}</Descriptions.Item>
              <Descriptions.Item label="Mã số thuế">{c.taxCode || '—'}</Descriptions.Item>
              <Descriptions.Item label="Nhóm">{c.groupName || '—'}</Descriptions.Item>
              <Descriptions.Item label="Ghi chú">{c.note || '—'}</Descriptions.Item>
            </Descriptions>
            <Descriptions size="small" column={1} colon={false} labelStyle={{ width: 160, color: '#6b7280' }} style={{ flex: '1 1 280px' }} title="Thống kê mua hàng">
              {canDebt && <Descriptions.Item label="Nợ hiện tại"><b className={Number(c.balance) > 0 ? 'neg' : ''}>{money(c.balance)}</b></Descriptions.Item>}
              <Descriptions.Item label="Hạn mức nợ">{c.creditLimit ? money(c.creditLimit) : 'Không giới hạn'}</Descriptions.Item>
              <Descriptions.Item label="Điểm tích lũy"><PointsBadge value={c.points} /> <a onClick={() => setTab('points')} style={{ fontSize: 12, marginLeft: 6 }}>Xem sổ điểm</a></Descriptions.Item>
              <Descriptions.Item label="Số hóa đơn">{c.stats?.invoices ?? 0}</Descriptions.Item>
              <Descriptions.Item label="Tổng mua">{money(c.stats?.revenue)}</Descriptions.Item>
              <Descriptions.Item label="Hóa đơn gần nhất">{c.stats?.lastInvoice ? <Link to={`/invoices?search=${c.stats.lastInvoice.code}`}>{c.stats.lastInvoice.code} · {d(c.stats.lastInvoice.invoiceDate)} · {money(c.stats.lastInvoice.totalAmount)}</Link> : '—'}</Descriptions.Item>
            </Descriptions>
          </div>
        ) },
        { key: 'history', label: 'Lịch sử mua hàng', children: <CustomerHistoryTab id={id} /> },
        { key: 'points', label: <span>Điểm tích lũy <PointsBadge value={c.points} /></span>, children: <CustomerPointsTab id={id} /> },
        ...(canDebt ? [{ key: 'ledger', label: 'Công nợ', children: <CustomerLedgerTab id={id} /> }] : []),
      ]} />
      <div className="kv-detail-actions">
        {can('customer.manage') && <Button icon={<EditOutlined />} onClick={onEdit}>Cập nhật</Button>}
        {can('customer.manage') && <Button icon={c.isActive ? <StopOutlined /> : <CheckCircleOutlined />} danger={c.isActive} onClick={toggle}>{c.isActive ? 'Ngừng giao dịch' : 'Cho phép giao dịch'}</Button>}
        {can('payment.create') && Number(c.balance ?? 0) > 0 && <Button type="primary" icon={<DollarOutlined />} onClick={onPay}>Thu nợ</Button>}
      </div>
    </div>
  );
}

function CustomerHistoryTab({ id }: { id: string }) {
  const { data, isLoading } = useCustomerHistory(id);
  if (isLoading || !data) return <div className="muted">Đang tải…</div>;
  return (
    <div style={{ display: 'grid', gap: 10 }}>
      <Table size="small" rowKey="id" pagination={false} dataSource={data.invoices} title={() => <b>Hóa đơn</b>} locale={{ emptyText: 'Chưa có hóa đơn' }}
        columns={[{ title: 'Mã HĐ', dataIndex: 'code', render: (v) => <Link to={`/invoices?search=${v}`}>{v}</Link> }, { title: 'Thời gian', dataIndex: 'invoiceDate', render: (v) => dt(v) }, { title: 'Chi nhánh', render: (_, r) => r.branch?.name }, { title: 'Tổng tiền', dataIndex: 'totalAmount', className: 'num', render: (v) => money(v) }, { title: 'Đã thanh toán', dataIndex: 'paidAmount', className: 'num', render: (v) => money(v) }, { title: 'Trạng thái', dataIndex: 'status', render: (v) => <Tag color={INVOICE_STATUS_COLOR[v]}>{INVOICE_STATUS_LABEL[v]}</Tag> }]} />
      <Table size="small" rowKey="id" pagination={false} dataSource={data.payments} title={() => <b>Phiếu thu / chi</b>} locale={{ emptyText: 'Chưa có thanh toán' }}
        columns={[{ title: 'Mã phiếu', dataIndex: 'code', render: (v) => <Link to={`/payments?search=${v}`}>{v}</Link> }, { title: 'Loại', dataIndex: 'direction', render: (v) => <Tag color={v === 'IN' ? 'green' : 'orange'}>{v === 'IN' ? 'Phiếu thu' : 'Phiếu chi'}</Tag> }, { title: 'Thời gian', dataIndex: 'paymentDate', render: (v) => dt(v) }, { title: 'Phương thức', dataIndex: 'method', render: (v) => methodLabel(v) }, { title: 'Số tiền', dataIndex: 'amount', className: 'num', render: (v) => money(v) }, { title: 'Trạng thái', dataIndex: 'status', render: (v) => <Tag color={v === 'POSTED' ? 'green' : 'red'}>{v === 'POSTED' ? 'Hoàn thành' : 'Đã hủy'}</Tag> }]} />
      <Table size="small" rowKey="id" pagination={false} dataSource={data.returns ?? []} title={() => <b>Trả hàng / đổi hàng</b>} locale={{ emptyText: 'Chưa có trả hàng' }}
        columns={[{ title: 'Phiếu trả', dataIndex: 'code', render: (v, r) => <Link to={`/sales-returns/${r.id}`}>{v}</Link> }, { title: 'Thời gian', dataIndex: 'returnDate', render: (v) => dt(v) }, { title: 'Hóa đơn', render: (_, r) => r.invoice ? <Link to={`/invoices?search=${r.invoice.code}`}>{r.invoice.code}</Link> : '' }, { title: 'Đổi hàng', render: (_, r) => r.exchangeInvoice ? <Link to={`/invoices?search=${r.exchangeInvoice.code}`}>{r.exchangeInvoice.code}</Link> : <span className="muted">—</span> }, { title: 'Tiền hoàn', dataIndex: 'totalRefund', className: 'num', render: (v) => money(v) }, { title: 'Đã hoàn', dataIndex: 'refundedAmount', className: 'num', render: (v) => money(v) }, { title: 'Trạng thái', dataIndex: 'status', render: (v) => <Tag color={RETURN_STATUS_COLOR[v]}>{RETURN_STATUS_LABEL[v]}</Tag> }]} />
    </div>
  );
}

function CustomerLedgerTab({ id }: { id: string }) {
  const [page, setPage] = useState(1);
  const { data, isLoading } = useCustomerLedger(id, { page, pageSize: 20 });
  return (
    <Table size="small" rowKey="id" loading={isLoading} dataSource={data?.data ?? []} locale={{ emptyText: 'Chưa có phát sinh công nợ' }}
      pagination={{ current: page, pageSize: 20, total: data?.meta.total ?? 0, onChange: setPage, showTotal: (t) => `${t} dòng` }}
      columns={[
        { title: 'Thời gian', dataIndex: 'createdAt', width: 140, render: (v) => dt(v, 'DD/MM/YYYY HH:mm:ss') },
        { title: 'Loại', dataIndex: 'type', width: 130, render: (v) => <Tag color={v === 'REVERSAL' ? 'red' : v === 'RECEIPT' || v === 'SALE_RETURN' ? 'green' : 'blue'}>{LEDGER_TYPE_LABEL[v] ?? v}</Tag> },
        { title: 'Chứng từ', render: (_, r) => { const to = LEDGER_DOC_PATH[r.documentType]?.(r.documentId, r.documentCode); return to ? <Link to={to}>{r.documentCode}</Link> : r.documentCode; } },
        { title: 'Ghi chú', dataIndex: 'note', ellipsis: true },
        { title: 'Phát sinh', dataIndex: 'amount', className: 'num', width: 130, render: (v) => <span className={Number(v) > 0 ? 'neg' : 'pos'}>{Number(v) > 0 ? '+' : ''}{money(v)}</span> },
        { title: 'Dư nợ sau', dataIndex: 'balanceAfter', className: 'num', width: 130, render: (v) => <b>{money(v)}</b> },
      ]} />
  );
}
