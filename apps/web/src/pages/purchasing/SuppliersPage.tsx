import { App, Button, Descriptions, Empty, Input, Radio, Select, Tabs, Tag } from 'antd';
import Table from '../../components/ResponsiveTable';
import { DollarOutlined, EditOutlined, PlusOutlined, ReloadOutlined, SearchOutlined, StopOutlined, CheckCircleOutlined } from '@ant-design/icons';
import { useState } from 'react';
import { Link, useSearchParams } from 'react-router-dom';
import { useQueryClient } from '@tanstack/react-query';
import { SupplierQuery, purchasingApi, useSupplier, useSupplierGroups, useSupplierHistory, useSupplierLedger, useSuppliers } from '../../api/purchasing';
import { errMsg } from '../../api/client';
import type { Supplier } from '../../api/types';
import { FilterCard, FilterPanel } from '../../components/FilterPanel';
import { PaymentModal } from '../../components/PaymentModal';
import { SupplierFormModal } from '../../components/SupplierSelect';
import { useCan } from '../../store/auth';
import { LEDGER_DOC_PATH, LEDGER_TYPE_LABEL, PAYMENT_METHOD_LABEL, PDOC_STATUS_LABEL, DOC_STATUS_COLOR, dt, money, d } from '../../utils/format';

export default function SuppliersPage() {
  const can = useCan();
  const [sp] = useSearchParams();
  const [q, setQ] = useState<SupplierQuery>({ page: 1, pageSize: 20, search: sp.get('search') ?? undefined, isActive: 'true' });
  const [searchText, setSearchText] = useState(q.search ?? '');
  const [form, setForm] = useState<{ open: boolean; supplier?: Supplier | null }>({ open: false });
  const [pay, setPay] = useState<{ open: boolean; supplierId?: string }>({ open: false });
  const { data, isLoading, isFetching, error, refetch } = useSuppliers(q);
  const { data: groups } = useSupplierGroups();
  const set = (patch: Partial<SupplierQuery>) => setQ((s) => ({ ...s, ...patch, page: patch.page ?? 1 }));
  const canDebt = can('supplier.debt.view');

  return (
    <div className="kv-list">
      <FilterPanel>
        <FilterCard title="Trạng thái"><Radio.Group value={q.isActive ?? ''} onChange={(e) => set({ isActive: e.target.value || undefined })}><Radio value="true">Đang giao dịch</Radio><Radio value="false">Ngừng giao dịch</Radio><Radio value="">Tất cả</Radio></Radio.Group></FilterCard>
        {canDebt && <FilterCard title="Công nợ"><Radio.Group value={q.hasDebt ?? ''} onChange={(e) => set({ hasDebt: e.target.value || undefined })}><Radio value="">Tất cả</Radio><Radio value="true">Đang có công nợ</Radio></Radio.Group></FilterCard>}
        <FilterCard title="Nhóm nhà cung cấp"><Select size="small" allowClear style={{ width: '100%' }} placeholder="Tất cả nhóm" value={q.groupName} onChange={(v) => set({ groupName: v })} options={(groups ?? []).map((g) => ({ value: g.name, label: `${g.name} (${g.count})` }))} /></FilterCard>
      </FilterPanel>
      <div className="kv-main">
        <h1 className="kv-page-title">Nhà cung cấp</h1>
        <div className="kv-toolbar">
          <Input.Search className="kv-search" allowClear placeholder="Theo mã, tên, điện thoại, email" value={searchText} onChange={(e) => setSearchText(e.target.value)} onSearch={(v) => set({ search: v || undefined })} enterButton={<SearchOutlined />} />
          <span className="spacer" />
          {can('supplier.manage') && <Button type="primary" icon={<PlusOutlined />} onClick={() => setForm({ open: true, supplier: null })}>Thêm mới</Button>}
          {can('payment.create') && <Button icon={<DollarOutlined />} onClick={() => setPay({ open: true })}>Thanh toán NCC</Button>}
          <Button icon={<ReloadOutlined />} onClick={() => refetch()} loading={isFetching} />
        </div>
        <div className="kv-card">
          <Table className="kv-table" rowKey="id" size="small" loading={isLoading} dataSource={data?.data ?? []} rowSelection={{}} scroll={{ x: 1200 }}
            locale={{ emptyText: error ? <Empty description={errMsg(error)} /> : <Empty description="Chưa có nhà cung cấp" /> }}
            expandable={{ expandedRowRender: (r) => <SupplierDetail id={r.id} onEdit={() => setForm({ open: true, supplier: r })} onPay={() => setPay({ open: true, supplierId: r.id })} />, expandRowByClick: true }}
            onChange={(p) => set({ page: p.current, pageSize: p.pageSize })}
            pagination={{ current: q.page, pageSize: q.pageSize, total: data?.meta.total ?? 0, showSizeChanger: true, pageSizeOptions: [15, 20, 50, 100], showTotal: (t) => `${t} nhà cung cấp` }}
            columns={[
              { title: 'Mã NCC', dataIndex: 'code', width: 120, render: (v) => <b>{v}</b> },
              { title: 'Tên nhà cung cấp', dataIndex: 'name' },
              { title: 'Điện thoại', dataIndex: 'phone', width: 120 },
              { title: 'Email', dataIndex: 'email', width: 180, ellipsis: true },
              { title: 'Nhóm', dataIndex: 'groupName', width: 120 },
              ...(canDebt ? [{ title: 'Nợ hiện tại', dataIndex: 'balance', className: 'num', width: 130, render: (v: string) => <span className={Number(v) > 0 ? 'neg' : Number(v) < 0 ? 'pos' : ''}>{money(v)}</span> }] : []),
              { title: 'Trạng thái', dataIndex: 'isActive', width: 130, render: (v) => <Tag color={v ? 'green' : 'default'}>{v ? 'Đang giao dịch' : 'Ngừng giao dịch'}</Tag> },
              { title: 'Tạo ngày', dataIndex: 'createdAt', width: 110, render: (v) => d(v) },
            ]} />
        </div>
      </div>
      <SupplierFormModal open={form.open} supplier={form.supplier} onClose={() => setForm({ open: false })} onSaved={() => setForm({ open: false })} />
      <PaymentModal open={pay.open} supplierId={pay.supplierId} onClose={() => setPay({ open: false })} />
    </div>
  );
}

export function SupplierDetail({ id, onEdit, onPay }: { id: string; onEdit: () => void; onPay: () => void }) {
  const { data: s, isLoading } = useSupplier(id);
  const can = useCan();
  const { message, modal } = App.useApp();
  const qc = useQueryClient();
  const [tab, setTab] = useState('info');
  if (isLoading || !s) return <div className="muted">Đang tải…</div>;
  const canDebt = can('supplier.debt.view');
  const toggle = () => modal.confirm({ title: s.isActive ? `Ngừng giao dịch với ${s.name}?` : `Cho phép giao dịch lại với ${s.name}?`, okText: 'Đồng ý', cancelText: 'Bỏ qua', onOk: async () => { try { await purchasingApi.updateSupplier(s.id, { isActive: !s.isActive }); message.success('Đã cập nhật'); ['suppliers', 'supplier'].forEach((k) => qc.invalidateQueries({ queryKey: [k] })); } catch (e) { message.error(errMsg(e)); } } });
  return (
    <div className="kv-expanded">
      <Tabs className="kv-detail-tabs" activeKey={tab} onChange={setTab} items={[
        { key: 'info', label: 'Thông tin', children: (
          <div style={{ display: 'flex', gap: 24, flexWrap: 'wrap' }}>
            <Descriptions size="small" column={1} colon={false} labelStyle={{ width: 140, color: '#6b7280' }} style={{ flex: '1 1 320px' }}>
              <Descriptions.Item label="Mã NCC"><b>{s.code}</b></Descriptions.Item>
              <Descriptions.Item label="Tên">{s.name}</Descriptions.Item>
              <Descriptions.Item label="Điện thoại">{s.phone || '—'}</Descriptions.Item>
              <Descriptions.Item label="Email">{s.email || '—'}</Descriptions.Item>
              <Descriptions.Item label="Địa chỉ">{s.address || '—'}</Descriptions.Item>
              <Descriptions.Item label="Mã số thuế">{s.taxCode || '—'}</Descriptions.Item>
              <Descriptions.Item label="Người liên hệ">{s.contactName || '—'}</Descriptions.Item>
              <Descriptions.Item label="Nhóm">{s.groupName || '—'}</Descriptions.Item>
              <Descriptions.Item label="Ghi chú">{s.note || '—'}</Descriptions.Item>
            </Descriptions>
            <Descriptions size="small" column={1} colon={false} labelStyle={{ width: 160, color: '#6b7280' }} style={{ flex: '1 1 280px' }} title="Thống kê mua hàng">
              {canDebt && <Descriptions.Item label="Nợ hiện tại"><b className={Number(s.balance) > 0 ? 'neg' : ''}>{money(s.balance)}</b></Descriptions.Item>}
              <Descriptions.Item label="Số phiếu nhập">{s.stats?.receipts ?? 0}</Descriptions.Item>
              <Descriptions.Item label="Tổng mua">{money(s.stats?.purchased)}</Descriptions.Item>
              <Descriptions.Item label="Trả hàng">{s.stats?.returns ?? 0} phiếu · {money(s.stats?.returned)}</Descriptions.Item>
              <Descriptions.Item label="Phiếu nhập gần nhất">{s.stats?.lastReceipt ? <Link to={`/purchase-receipts?search=${s.stats.lastReceipt.code}`}>{s.stats.lastReceipt.code} · {d(s.stats.lastReceipt.receiptDate)} · {money(s.stats.lastReceipt.totalAmount)}</Link> : '—'}</Descriptions.Item>
            </Descriptions>
          </div>
        ) },
        { key: 'history', label: 'Lịch sử mua hàng', children: <SupplierHistoryTab id={id} /> },
        ...(canDebt ? [{ key: 'ledger', label: 'Công nợ', children: <SupplierLedgerTab id={id} /> }] : []),
      ]} />
      <div className="kv-detail-actions">
        {can('supplier.manage') && <Button icon={<EditOutlined />} onClick={onEdit}>Cập nhật</Button>}
        {can('supplier.manage') && <Button icon={s.isActive ? <StopOutlined /> : <CheckCircleOutlined />} danger={s.isActive} onClick={toggle}>{s.isActive ? 'Ngừng giao dịch' : 'Cho phép giao dịch'}</Button>}
        {can('payment.create') && Number(s.balance ?? 0) !== 0 && <Button type="primary" icon={<DollarOutlined />} onClick={onPay}>Thanh toán</Button>}
        {can('purchase.receipt.create') && s.isActive && <Link to={`/purchase-receipts/new?supplierId=${s.id}`}>+ Nhập hàng từ NCC này</Link>}
      </div>
    </div>
  );
}

function SupplierHistoryTab({ id }: { id: string }) {
  const { data, isLoading } = useSupplierHistory(id);
  if (isLoading || !data) return <div className="muted">Đang tải…</div>;
  return (
    <div style={{ display: 'grid', gap: 10 }}>
      <Table size="small" rowKey="id" pagination={false} dataSource={data.receipts} title={() => <b>Phiếu nhập hàng</b>} locale={{ emptyText: 'Chưa có phiếu nhập' }}
        columns={[{ title: 'Mã phiếu', dataIndex: 'code', render: (v) => <Link to={`/purchase-receipts?search=${v}`}>{v}</Link> }, { title: 'Ngày', dataIndex: 'receiptDate', render: (v) => dt(v) }, { title: 'Kho', render: (_, r) => r.warehouse?.name }, { title: 'Tổng tiền', dataIndex: 'totalAmount', className: 'num', render: (v) => money(v) }, { title: 'Đã trả', dataIndex: 'paidAmount', className: 'num', render: (v) => money(v) }, { title: 'Trả hàng', dataIndex: 'returnedAmount', className: 'num', render: (v) => money(v) }, { title: 'Trạng thái', dataIndex: 'status', render: (v) => <Tag color={DOC_STATUS_COLOR[v]}>{PDOC_STATUS_LABEL[v]}</Tag> }]} />
      <Table size="small" rowKey="id" pagination={false} dataSource={data.returns} title={() => <b>Trả hàng nhập</b>} locale={{ emptyText: 'Chưa có phiếu trả hàng' }}
        columns={[{ title: 'Mã phiếu', dataIndex: 'code', render: (v) => <Link to={`/purchase-returns?search=${v}`}>{v}</Link> }, { title: 'Phiếu nhập', render: (_, r) => r.receipt?.code }, { title: 'Ngày', dataIndex: 'returnDate', render: (v) => dt(v) }, { title: 'Tổng tiền', dataIndex: 'totalAmount', className: 'num', render: (v) => money(v) }, { title: 'Đã hoàn', dataIndex: 'refundedAmount', className: 'num', render: (v) => money(v) }, { title: 'Trạng thái', dataIndex: 'status', render: (v) => <Tag color={DOC_STATUS_COLOR[v]}>{PDOC_STATUS_LABEL[v]}</Tag> }]} />
      <Table size="small" rowKey="id" pagination={false} dataSource={data.payments} title={() => <b>Phiếu thu / chi</b>} locale={{ emptyText: 'Chưa có thanh toán' }}
        columns={[{ title: 'Mã phiếu', dataIndex: 'code', render: (v) => <Link to={`/payments?search=${v}`}>{v}</Link> }, { title: 'Loại', dataIndex: 'direction', render: (v) => <Tag color={v === 'OUT' ? 'orange' : 'green'}>{v === 'OUT' ? 'Phiếu chi' : 'Phiếu thu'}</Tag> }, { title: 'Ngày', dataIndex: 'paymentDate', render: (v) => dt(v) }, { title: 'Phương thức', dataIndex: 'method', render: (v) => PAYMENT_METHOD_LABEL[v] ?? v }, { title: 'Số tiền', dataIndex: 'amount', className: 'num', render: (v) => money(v) }, { title: 'Đã phân bổ', dataIndex: 'allocated', className: 'num', render: (v) => money(v) }, { title: 'Trạng thái', dataIndex: 'status', render: (v) => <Tag color={v === 'POSTED' ? 'green' : 'red'}>{v === 'POSTED' ? 'Hoàn thành' : 'Đã hủy'}</Tag> }]} />
    </div>
  );
}

function SupplierLedgerTab({ id }: { id: string }) {
  const [page, setPage] = useState(1);
  const { data, isLoading } = useSupplierLedger(id, { page, pageSize: 20 });
  return (
    <Table size="small" rowKey="id" loading={isLoading} dataSource={data?.data ?? []} locale={{ emptyText: 'Chưa có phát sinh công nợ' }}
      pagination={{ current: page, pageSize: 20, total: data?.meta.total ?? 0, onChange: setPage, showTotal: (t) => `${t} dòng` }}
      columns={[
        { title: 'Thời gian', dataIndex: 'createdAt', width: 140, render: (v) => dt(v, 'DD/MM/YYYY HH:mm:ss') },
        { title: 'Loại', dataIndex: 'type', width: 130, render: (v) => <Tag color={v === 'REVERSAL' ? 'red' : v === 'PAYMENT' || v === 'PURCHASE_RETURN' ? 'green' : 'blue'}>{LEDGER_TYPE_LABEL[v] ?? v}</Tag> },
        { title: 'Chứng từ', render: (_, r) => { const to = LEDGER_DOC_PATH[r.documentType]?.(r.documentId, r.documentCode); return to ? <Link to={to}>{r.documentCode}</Link> : r.documentCode; } },
        { title: 'Ghi chú', dataIndex: 'note', ellipsis: true },
        { title: 'Phát sinh', dataIndex: 'amount', className: 'num', width: 130, render: (v) => <span className={Number(v) > 0 ? 'neg' : 'pos'}>{Number(v) > 0 ? '+' : ''}{money(v)}</span> },
        { title: 'Dư nợ sau', dataIndex: 'balanceAfter', className: 'num', width: 130, render: (v) => <b>{money(v)}</b> },
      ]} />
  );
}
