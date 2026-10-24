import { Button, DatePicker, Empty, Input, Modal, Pagination, Radio, Select, Skeleton, Table, Tag } from 'antd';
import { FileAddOutlined, PlusOutlined, ReloadOutlined, SearchOutlined } from '@ant-design/icons';
import { useEffect, useState } from 'react';
import { useSearchParams } from 'react-router-dom';
import { PaymentQuery, usePayments } from '../../api/purchasing';
import { PaymentEx, useCashCategories } from '../../api/finance';
import { errMsg } from '../../api/client';
import { FilterCard, FilterPanel } from '../../components/FilterPanel';
import { PaymentModal } from '../../components/PaymentModal';
import { SupplierSelect } from '../../components/SupplierSelect';
import { useIsMobile } from '../../hooks/useMedia';
import { useAuthStore, useCan } from '../../store/auth';
import { dt, money } from '../../utils/format';
import { FundSelect } from '../finance/FinanceSelects';
import { METHOD_LABEL, VoucherCard, VoucherDetail, describeVoucher } from '../finance/VoucherDetail';
import { VoucherModal } from '../finance/VoucherModal';
import '../finance/finance.css';

/** Module 08 filters the payments endpoint now understands. */
type PaymentsQ = PaymentQuery & { cashAccountId?: string; categoryId?: string; method?: string };

export default function PaymentsPage() {
  const can = useCan();
  const isMobile = useIsMobile();
  const [sp] = useSearchParams();
  const branchId = useAuthStore((s) => s.currentBranchId);
  const [q, setQ] = useState<PaymentsQ>({ page: 1, pageSize: 20, search: sp.get('search') ?? undefined, direction: sp.get('direction') ?? undefined });
  const [searchText, setSearchText] = useState(q.search ?? '');
  const [modal, setModal] = useState<{ open: boolean; direction: 'IN' | 'OUT' }>({ open: false, direction: 'OUT' });
  const [other, setOther] = useState<{ open: boolean; direction: 'IN' | 'OUT' }>({ open: false, direction: 'OUT' });
  const [detailId, setDetailId] = useState<string | undefined>();
  useEffect(() => { setQ((s) => ({ ...s, direction: sp.get('direction') ?? undefined, search: sp.get('search') ?? s.search, page: 1 })); }, [sp]);
  const { data, isLoading, isFetching, error, refetch } = usePayments({ ...q, branchId: branchId ?? undefined });
  const { data: categories } = useCashCategories({ includeInactive: true });
  const set = (patch: Partial<PaymentsQ>) => setQ((s) => ({ ...s, ...patch, page: patch.page ?? 1 }));
  const title = q.direction === 'OUT' ? 'Phiếu chi' : q.direction === 'IN' ? 'Phiếu thu' : 'Phiếu thu / chi';
  const rows = (data?.data ?? []) as PaymentEx[];
  const catOptions = (categories ?? []).filter((c) => !q.direction || c.direction === q.direction).map((c) => ({ value: c.id, label: `${c.direction === 'IN' ? 'Thu' : 'Chi'} · ${c.name}${c.isActive ? '' : ' (ngừng)'}` }));
  return (
    <div className="kv-list">
      <FilterPanel>
        <FilterCard title="Loại phiếu"><Radio.Group value={q.direction ?? ''} onChange={(e) => set({ direction: e.target.value || undefined, categoryId: undefined })}><Radio value="">Tất cả</Radio><Radio value="IN">Phiếu thu</Radio><Radio value="OUT">Phiếu chi</Radio></Radio.Group></FilterCard>
        <FilterCard title="Trạng thái"><Radio.Group value={q.status ?? ''} onChange={(e) => set({ status: e.target.value || undefined })}><Radio value="">Tất cả</Radio><Radio value="POSTED">Hoàn thành</Radio><Radio value="CANCELLED">Đã hủy</Radio></Radio.Group></FilterCard>
        <FilterCard title="Quỹ tiền"><FundSelect size="small" allowClear includeInactive showBalance={false} value={q.cashAccountId} onChange={(v) => set({ cashAccountId: v })} placeholder="Tất cả quỹ" /></FilterCard>
        <FilterCard title="Loại thu / chi khác"><Select size="small" allowClear showSearch optionFilterProp="label" style={{ width: '100%' }} placeholder="Tất cả loại" value={q.categoryId} onChange={(v) => set({ categoryId: v })} options={catOptions} /></FilterCard>
        <FilterCard title="Phương thức"><Select size="small" allowClear style={{ width: '100%' }} placeholder="Tất cả" value={q.method} onChange={(v) => set({ method: v })} options={Object.entries(METHOD_LABEL).map(([value, label]) => ({ value, label }))} /></FilterCard>
        <FilterCard title="Nhà cung cấp"><SupplierSelect size="small" value={q.partyType === 'SUPPLIER' ? q.partyId : undefined} onChange={(v) => set({ partyId: v, partyType: v ? 'SUPPLIER' : undefined })} allowCreate={false} placeholder="Tất cả" /></FilterCard>
        <FilterCard title="Thời gian"><DatePicker.RangePicker size="small" style={{ width: '100%' }} format="DD/MM/YYYY" onChange={(r) => set({ from: r?.[0]?.startOf('day').toISOString(), to: r?.[1]?.endOf('day').toISOString() })} /></FilterCard>
      </FilterPanel>
      <div className="kv-main">
        <h1 className="kv-page-title">{title}</h1>
        <div className="kv-toolbar">
          <Input.Search className="kv-search" allowClear placeholder="Theo mã phiếu, tham chiếu, ghi chú" value={searchText} onChange={(e) => setSearchText(e.target.value)} onSearch={(v) => set({ search: v || undefined })} enterButton={<SearchOutlined />} />
          <span className="spacer" />
          {can('payment.create') && <Button type="primary" icon={<PlusOutlined />} onClick={() => setModal({ open: true, direction: 'OUT' })}>Lập phiếu chi</Button>}
          {can('payment.create') && <Button icon={<PlusOutlined />} onClick={() => setModal({ open: true, direction: 'IN' })}>Lập phiếu thu</Button>}
          {can('payment.other') && <Button icon={<FileAddOutlined />} onClick={() => setOther({ open: true, direction: q.direction === 'IN' ? 'IN' : 'OUT' })}>Lập phiếu thu/chi khác</Button>}
          <Button icon={<ReloadOutlined />} onClick={() => refetch()} loading={isFetching} />
        </div>
        {isMobile ? (
          <div className="cb-cards">
            {isLoading ? <Skeleton active /> : rows.length === 0 ? <Empty className="cb-empty" description={error ? errMsg(error) : 'Chưa có phiếu thu / chi'} /> : rows.map((p) => (
              <VoucherCard key={p.id} p={p} fundName={p.cashAccount?.name} onClick={() => setDetailId(p.id)} />
            ))}
            {(data?.meta.total ?? 0) > (q.pageSize ?? 20) && <div className="cb-pager"><Pagination simple current={q.page} pageSize={q.pageSize} total={data?.meta.total ?? 0} onChange={(p) => set({ page: p })} /></div>}
          </div>
        ) : (
          <div className="kv-card">
            <Table className="kv-table" rowKey="id" size="small" loading={isLoading} dataSource={rows} rowSelection={{}} scroll={{ x: 1560 }}
              locale={{ emptyText: error ? <Empty description={errMsg(error)} /> : <Empty description="Chưa có phiếu thu / chi" /> }}
              expandable={{ expandedRowRender: (r) => <VoucherDetail id={r.id} />, expandRowByClick: true }}
              onChange={(p) => set({ page: p.current, pageSize: p.pageSize })}
              pagination={{ current: q.page, pageSize: q.pageSize, total: data?.meta.total ?? 0, showSizeChanger: true, pageSizeOptions: [15, 20, 50, 100], showTotal: (t) => `${t} phiếu` }}
              columns={[
                { title: 'Mã phiếu', dataIndex: 'code', width: 130, render: (v) => <b>{v}</b> },
                { title: 'Loại', dataIndex: 'direction', width: 100, render: (v) => <Tag color={v === 'OUT' ? 'orange' : 'green'}>{v === 'OUT' ? 'Phiếu chi' : 'Phiếu thu'}</Tag> },
                { title: 'Thời gian', dataIndex: 'paymentDate', width: 130, render: (v) => dt(v) },
                { title: 'Đối tượng', width: 240, ellipsis: true, render: (_, r) => { const d = describeVoucher(r); const who = r.party ? r.party.name : d.who || '—'; return <span title={who}>{who}<div className="kv-hint">{r.party ? r.party.code : d.label}</div></span>; } },
                { title: 'Loại thu / chi', width: 150, render: (_, r) => r.category ? r.category.name : <Tag color={describeVoucher(r).color}>{describeVoucher(r).label}</Tag> },
                { title: 'Quỹ tiền', width: 170, ellipsis: true, render: (_, r) => r.cashAccount?.name ?? <span className="muted">—</span> },
                { title: 'Phương thức', dataIndex: 'method', width: 120, render: (v) => METHOD_LABEL[v] ?? v },
                { title: 'Số tiền', dataIndex: 'amount', className: 'num', width: 130, render: (v, r) => <b className={r.direction === 'OUT' ? 'neg' : 'pos'}>{money(v)}</b> },
                { title: 'Đã phân bổ', dataIndex: 'allocated', className: 'num', width: 120, render: (v) => money(v) },
                { title: 'Trạng thái', dataIndex: 'status', width: 110, render: (v) => <Tag color={v === 'POSTED' ? 'green' : 'red'}>{v === 'POSTED' ? 'Hoàn thành' : 'Đã hủy'}</Tag> },
                { title: 'Ghi chú', dataIndex: 'note', ellipsis: true },
              ]} />
          </div>
        )}
      </div>
      <PaymentModal open={modal.open} direction={modal.direction} onClose={() => setModal((m) => ({ ...m, open: false }))} />
      <VoucherModal open={other.open} direction={other.direction} defaultKind="OTHER" allowDirectionSwitch onClose={() => setOther((m) => ({ ...m, open: false }))} />
      <Modal open={!!detailId} onCancel={() => setDetailId(undefined)} footer={null} title={rows.find((r) => r.id === detailId)?.code ?? 'Chi tiết phiếu'} destroyOnClose width={720}>
        {detailId && <VoucherDetail id={detailId} onDone={() => setDetailId(undefined)} />}
      </Modal>
    </div>
  );
}
