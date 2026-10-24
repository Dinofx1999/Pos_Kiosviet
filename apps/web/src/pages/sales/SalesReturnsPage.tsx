import { Button, DatePicker, Empty, Input, Pagination, Radio, Table, Tag } from 'antd';
import { DownOutlined, PlusOutlined, ReloadOutlined, SearchOutlined, SwapOutlined, UpOutlined } from '@ant-design/icons';
import { useEffect, useMemo, useState } from 'react';
import { Link, useNavigate, useSearchParams } from 'react-router-dom';
import { SalesReturnQuery, useSalesReturns } from '../../api/sales';
import { errMsg } from '../../api/client';
import type { SalesReturn } from '../../api/types';
import { CustomerSelect } from '../../components/CustomerSelect';
import { FilterCard, FilterPanel } from '../../components/FilterPanel';
import { useIsMobile } from '../../hooks/useMedia';
import { useAuthStore, useCan } from '../../store/auth';
import { dt, money, toNum } from '../../utils/format';
import { RETURN_STATUS_COLOR, RETURN_STATUS_LABEL, SalesReturnDetail } from './SalesReturnShared';

/** KiotViet "Trả hàng": list of sales returns / exchanges with filters, summary strip and expandable detail. */
export default function SalesReturnsPage() {
  const can = useCan();
  const nav = useNavigate();
  const [sp] = useSearchParams();
  const isMobile = useIsMobile();
  const branchId = useAuthStore((s) => s.currentBranchId);
  const me = useAuthStore((s) => s.me);
  const [q, setQ] = useState<SalesReturnQuery>({ page: 1, pageSize: 20, search: sp.get('search') ?? undefined, status: sp.get('status') ?? undefined });
  const [searchText, setSearchText] = useState(q.search ?? '');
  const [expanded, setExpanded] = useState<string[]>([]);
  useEffect(() => { const s = sp.get('search'); if (s) { setSearchText(s); setQ((x) => ({ ...x, search: s, page: 1 })); } }, [sp]);
  const { data, isLoading, isFetching, error, refetch } = useSalesReturns({ ...q, branchId: q.branchId ?? branchId ?? undefined });
  const set = (patch: Partial<SalesReturnQuery>) => setQ((s) => ({ ...s, ...patch, page: patch.page ?? 1 }));
  const rows = data?.data ?? [];
  const sum = useMemo(() => rows.reduce((s, r) => (r.status === 'CANCELLED' ? s : { refund: s.refund + toNum(r.totalRefund), due: s.due + (r.status === 'COMPLETED' ? toNum(r.dueRefund) : 0) }), { refund: 0, due: 0 }), [rows]);
  const total = data?.meta.total ?? 0;
  const toggle = (id: string) => setExpanded((p) => (p.includes(id) ? p.filter((x) => x !== id) : [...p, id]));

  const filters = (
    <FilterPanel>
      <FilterCard title="Trạng thái"><Radio.Group value={q.status ?? ''} onChange={(e) => set({ status: e.target.value || undefined })}><Radio value="">Tất cả</Radio><Radio value="COMPLETED">Hoàn thành</Radio><Radio value="DRAFT">Phiếu tạm</Radio><Radio value="CANCELLED">Đã hủy</Radio></Radio.Group></FilterCard>
      <FilterCard title="Chi nhánh"><Radio.Group value={q.branchId ?? ''} onChange={(e) => set({ branchId: e.target.value || undefined })}><Radio value="">Chi nhánh đang chọn</Radio>{(me?.branches ?? []).map((b) => <Radio key={b.id} value={b.id}>{b.name}</Radio>)}</Radio.Group></FilterCard>
      <FilterCard title="Khách hàng"><CustomerSelect size="small" value={q.customerId} onChange={(v) => set({ customerId: v })} allowCreate={false} placeholder="Tất cả" /></FilterCard>
      <FilterCard title="Ngày trả"><DatePicker.RangePicker size="small" style={{ width: '100%' }} format="DD/MM/YYYY" onChange={(r) => set({ from: r?.[0]?.startOf('day').toISOString(), to: r?.[1]?.endOf('day').toISOString() })} /></FilterCard>
    </FilterPanel>
  );

  return (
    <div className="kv-list">
      {filters}
      <div className="kv-main">
        <h1 className="kv-page-title">Trả hàng / Đổi hàng</h1>
        <div className="kv-toolbar">
          <Input.Search className="kv-search" allowClear placeholder="Theo mã phiếu trả, mã hóa đơn, tên / SĐT khách" value={searchText} onChange={(e) => setSearchText(e.target.value)} onSearch={(v) => set({ search: v || undefined })} enterButton={<SearchOutlined />} />
          <span className="spacer" />
          {can('return.create') && <Button type="primary" icon={<PlusOutlined />} onClick={() => nav('/sales-returns/new')}>Trả hàng</Button>}
          <Button icon={<ReloadOutlined />} onClick={() => refetch()} loading={isFetching} />
        </div>
        <div className="sr-summary">
          <div className="sr-tile"><div className="lbl">Số phiếu</div><div className="val">{total}</div></div>
          <div className="sr-tile"><div className="lbl">Tiền hoàn{total > rows.length ? ' (trang này)' : ''}</div><div className="val">{money(sum.refund)}</div></div>
          <div className="sr-tile"><div className="lbl">Còn phải hoàn{total > rows.length ? ' (trang này)' : ''}</div><div className={`val${sum.due > 0 ? ' neg' : ''}`}>{money(sum.due)}</div></div>
        </div>
        {isMobile ? (
          <div>
            {isLoading && <div className="muted" style={{ padding: 12 }}>Đang tải…</div>}
            {!isLoading && !rows.length && <div className="kv-card" style={{ padding: 16 }}><Empty description={error ? errMsg(error) : 'Chưa có phiếu trả hàng'} /></div>}
            <div className="sr-cards">
              {rows.map((r) => {
                const open = expanded.includes(r.id);
                const due = toNum(r.dueRefund);
                return (
                  <div key={r.id} className="sr-card" onClick={() => toggle(r.id)}>
                    <div className="sr-card-head"><span><b>{r.code}</b> <Tag color={RETURN_STATUS_COLOR[r.status]}>{RETURN_STATUS_LABEL[r.status]}</Tag></span><span className="muted">{open ? <UpOutlined /> : <DownOutlined />}</span></div>
                    <div className="sr-card-meta">{dt(r.returnDate)} · HĐ {r.invoice?.code}{r.exchangeInvoice ? <span> · <SwapOutlined /> đổi → {r.exchangeInvoice.code}</span> : null}</div>
                    <div className="sr-card-meta">{r.customer ? `${r.customer.name}` : 'Khách lẻ'} · {r.branch?.name}{r.reason ? ` · ${r.reason}` : ''}</div>
                    <div className="sr-card-amts"><span>Tiền hoàn <b>{money(r.totalRefund)}</b></span>{r.status === 'COMPLETED' && (due > 0 ? <span className="neg">Còn phải hoàn {money(due)}</span> : <span className="pos">Đã hoàn đủ</span>)}</div>
                    {open && <div className="sr-card-body" onClick={(e) => e.stopPropagation()}><SalesReturnDetail id={r.id} /></div>}
                  </div>
                );
              })}
            </div>
            {total > (q.pageSize ?? 20) && <div className="sr-pager"><Pagination simple current={q.page} pageSize={q.pageSize} total={total} onChange={(page, pageSize) => set({ page, pageSize })} /></div>}
          </div>
        ) : (
          <div className="kv-card">
            <Table<SalesReturn> className="kv-table" rowKey="id" size="small" loading={isLoading} dataSource={rows} rowSelection={{}} scroll={{ x: 1250 }}
              locale={{ emptyText: error ? <Empty description={errMsg(error)} /> : <Empty description="Chưa có phiếu trả hàng" /> }}
              expandable={{ expandedRowRender: (r) => <SalesReturnDetail id={r.id} />, expandRowByClick: true }}
              onChange={(p) => set({ page: p.current, pageSize: p.pageSize })}
              pagination={{ current: q.page, pageSize: q.pageSize, total, showSizeChanger: true, pageSizeOptions: [15, 20, 50, 100], showTotal: (t) => `${t} phiếu` }}
              columns={[
                { title: 'Mã phiếu', dataIndex: 'code', width: 120, render: (v) => <b>{v}</b> },
                { title: 'Thời gian', dataIndex: 'returnDate', width: 140, render: (v) => dt(v) },
                { title: 'Hóa đơn', width: 120, render: (_, r) => r.invoice ? <Link to={`/invoices?search=${r.invoice.code}`} onClick={(e) => e.stopPropagation()}>{r.invoice.code}</Link> : '' },
                { title: 'Khách hàng', width: 180, render: (_, r) => r.customer ? r.customer.name : <span className="muted">Khách lẻ</span> },
                { title: 'Chi nhánh', width: 150, render: (_, r) => r.branch?.name },
                { title: 'Tiền hoàn', dataIndex: 'totalRefund', className: 'num', width: 120, render: (v) => <b>{money(v)}</b> },
                { title: 'Đã hoàn', dataIndex: 'refundedAmount', className: 'num', width: 110, render: (v) => money(v) },
                { title: 'Còn phải hoàn', dataIndex: 'dueRefund', className: 'num', width: 120, render: (v, r) => r.status === 'COMPLETED' ? <span className={toNum(v) > 0 ? 'neg' : ''}>{money(v)}</span> : '' },
                { title: 'Đổi hàng', width: 120, render: (_, r) => r.exchangeInvoice ? <Link to={`/invoices?search=${r.exchangeInvoice.code}`} onClick={(e) => e.stopPropagation()}><SwapOutlined /> {r.exchangeInvoice.code}</Link> : '' },
                { title: 'Trạng thái', dataIndex: 'status', width: 110, render: (v) => <Tag color={RETURN_STATUS_COLOR[v]}>{RETURN_STATUS_LABEL[v]}</Tag> },
                { title: 'Lý do', dataIndex: 'reason' },
              ]} />
          </div>
        )}
      </div>
    </div>
  );
}
