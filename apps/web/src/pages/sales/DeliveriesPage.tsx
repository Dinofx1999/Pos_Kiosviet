import { Button, DatePicker, Drawer, Empty, Input, Pagination, Radio, Tag } from 'antd';
import Table from '../../components/ResponsiveTable';
import { PlusOutlined, ReloadOutlined, RightOutlined, SearchOutlined, ShoppingOutlined } from '@ant-design/icons';
import { useEffect, useMemo, useState } from 'react';
import { Link, useSearchParams } from 'react-router-dom';
import { Delivery, DeliveryQuery, useDeliveries } from '../../api/orders';
import { FilterCard, FilterPanel } from '../../components/FilterPanel';
import { useIsMobile } from '../../hooks/useMedia';
import { useAuthStore, useCan } from '../../store/auth';
import { dt, money, toNum } from '../../utils/format';
import { CodBadge, DELIVERY_STATUS_COLOR, DELIVERY_STATUS_LABEL, DeliveryDetail, DeliveryFormModal, deliveryErrMsg } from './DeliveryShared';
import './orders.css';

/** KiotViet "Giao hàng": deliveries (vận đơn) with status / carrier / COD filters, cards or table, detail drawer with the status machine and COD collection. */
export default function DeliveriesPage() {
  const can = useCan();
  const [sp] = useSearchParams();
  const isMobile = useIsMobile();
  const branchId = useAuthStore((s) => s.currentBranchId);
  const me = useAuthStore((s) => s.me);
  const [q, setQ] = useState<DeliveryQuery>({ page: 1, pageSize: 20, search: sp.get('search') ?? undefined, status: sp.get('status') ?? undefined, codPending: sp.get('codPending') ?? undefined });
  const [searchText, setSearchText] = useState(q.search ?? '');
  const [carrierText, setCarrierText] = useState('');
  const [openId, setOpenId] = useState<string | null>(null);
  const [creating, setCreating] = useState(false);
  useEffect(() => { const s = sp.get('search'); if (s) { setSearchText(s); setQ((x) => ({ ...x, search: s, page: 1 })); } }, [sp]);
  const { data, isLoading, isFetching, error, refetch } = useDeliveries({ ...q, branchId: q.branchId ?? branchId ?? undefined });
  const set = (patch: Partial<DeliveryQuery>) => setQ((s) => ({ ...s, ...patch, page: patch.page ?? 1 }));
  const rows = data?.data ?? [];
  const total = data?.meta.total ?? 0;
  const sum = useMemo(() => rows.reduce((s, r) => (r.status === 'CANCELLED' || r.status === 'RETURNED' ? s : { cod: s.cod + toNum(r.codAmount), pending: s.pending + (r.codCollected ? 0 : toNum(r.codAmount)), fee: s.fee + toNum(r.shippingFee) }), { cod: 0, pending: 0, fee: 0 }), [rows]);
  // a single search hit opens itself (deep links from orders / invoices)
  useEffect(() => { if (q.search && rows.length === 1 && openId === null) setOpenId(rows[0].id); }, [q.search, rows.length]);
  const opened = rows.find((r) => r.id === openId);

  const filters = (
    <FilterPanel>
      <FilterCard title="Trạng thái"><Radio.Group value={q.status ?? ''} onChange={(e) => set({ status: e.target.value || undefined })}><Radio value="">Tất cả</Radio>{Object.entries(DELIVERY_STATUS_LABEL).map(([v, l]) => <Radio key={v} value={v}>{l}</Radio>)}</Radio.Group></FilterCard>
      <FilterCard title="Thu hộ (COD)"><Radio.Group value={q.codPending ?? ''} onChange={(e) => set({ codPending: e.target.value || undefined })}><Radio value="">Tất cả</Radio><Radio value="true">COD chưa thu</Radio></Radio.Group></FilterCard>
      <FilterCard title="Đơn vị vận chuyển"><Input.Search size="small" allowClear placeholder="GHTK, GHN…" value={carrierText} onChange={(e) => setCarrierText(e.target.value)} onSearch={(v) => set({ carrier: v.trim() || undefined })} /></FilterCard>
      <FilterCard title="Chi nhánh"><Radio.Group value={q.branchId ?? ''} onChange={(e) => set({ branchId: e.target.value || undefined })}><Radio value="">Chi nhánh đang chọn</Radio>{(me?.branches ?? []).map((b) => <Radio key={b.id} value={b.id}>{b.name}</Radio>)}</Radio.Group></FilterCard>
      <FilterCard title="Ngày tạo"><DatePicker.RangePicker size="small" style={{ width: '100%' }} format="DD/MM/YYYY" onChange={(r) => set({ from: r?.[0]?.startOf('day').toISOString(), to: r?.[1]?.endOf('day').toISOString() })} /></FilterCard>
    </FilterPanel>
  );

  const addressOf = (r: Delivery) => [r.address, r.ward, r.district, r.province].filter(Boolean).join(', ');

  return (
    <div className="kv-list">
      {filters}
      <div className="kv-main">
        <h1 className="kv-page-title">Giao hàng</h1>
        <div className="kv-toolbar">
          <Input.Search className="kv-search" allowClear placeholder="Mã vận đơn, người nhận, SĐT, địa chỉ, mã đơn / hóa đơn" value={searchText} onChange={(e) => setSearchText(e.target.value)} onSearch={(v) => set({ search: v || undefined })} enterButton={<SearchOutlined />} />
          <span className="spacer" />
          {can('delivery.manage') && <Button type="primary" icon={<PlusOutlined />} onClick={() => setCreating(true)}>Vận đơn</Button>}
          {can('order.view') && !isMobile && <Link to="/orders"><Button icon={<ShoppingOutlined />}>Đặt hàng</Button></Link>}
          <Button icon={<ReloadOutlined />} onClick={() => refetch()} loading={isFetching} />
        </div>
        <div className="od-summary">
          <div className="od-tile"><div className="lbl">Số vận đơn</div><div className="val">{total}</div></div>
          <div className="od-tile"><div className="lbl">Tiền thu hộ{total > rows.length ? ' (trang này)' : ''}</div><div className="val">{money(sum.cod)}</div></div>
          <div className="od-tile"><div className="lbl">COD chưa thu{total > rows.length ? ' (trang này)' : ''}</div><div className={`val${sum.pending > 0 ? ' neg' : ''}`}>{money(sum.pending)}</div></div>
        </div>
        {isMobile ? (
          <div>
            {isLoading && <div className="muted" style={{ padding: 12 }}>Đang tải…</div>}
            {!isLoading && !rows.length && <div className="kv-card" style={{ padding: 16 }}><Empty description={error ? deliveryErrMsg(error) : 'Chưa có vận đơn'} /></div>}
            <div className="od-cards">
              {rows.map((r) => (
                <div key={r.id} className="od-card" onClick={() => setOpenId(r.id)}>
                  <div className="od-card-head"><span><b>{r.code}</b> <Tag color={DELIVERY_STATUS_COLOR[r.status]}>{DELIVERY_STATUS_LABEL[r.status]}</Tag></span><span className="muted"><RightOutlined /></span></div>
                  <div className="od-card-meta"><b style={{ color: '#111827' }}>{r.receiverName}</b>{r.receiverPhone ? ` · ${r.receiverPhone}` : ''}</div>
                  <div className="od-card-meta">{addressOf(r)}</div>
                  <div className="od-card-meta">{r.carrier || 'Chưa có ĐVVC'}{r.trackingCode ? ` · ${r.trackingCode}` : ''} · {dt(r.createdAt, 'DD/MM HH:mm')}{r.expectedAt ? ` · hẹn ${dt(r.expectedAt, 'DD/MM HH:mm')}` : ''}</div>
                  <div className="od-card-amts"><span>COD <CodBadge d={r} /></span><span className="muted">{r.order ? `Đơn ${r.order.code}` : ''}{r.order && r.invoice ? ' · ' : ''}{r.invoice ? `HĐ ${r.invoice.code}` : ''}</span></div>
                </div>
              ))}
            </div>
            {total > (q.pageSize ?? 20) && <div className="od-pager"><Pagination simple current={q.page} pageSize={q.pageSize} total={total} onChange={(page, pageSize) => set({ page, pageSize })} /></div>}
          </div>
        ) : (
          <div className="kv-card">
            <Table<Delivery> className="kv-table" rowKey="id" size="small" loading={isLoading} dataSource={rows} scroll={{ x: 1300 }}
              locale={{ emptyText: error ? <Empty description={deliveryErrMsg(error)} /> : <Empty description="Chưa có vận đơn" /> }}
              onRow={(r) => ({ onClick: () => setOpenId(r.id) })}
              onChange={(p) => set({ page: p.current, pageSize: p.pageSize })}
              pagination={{ current: q.page, pageSize: q.pageSize, total, showSizeChanger: true, pageSizeOptions: [15, 20, 50, 100], showTotal: (t) => `${t} vận đơn` }}
              columns={[
                { title: 'Mã vận đơn', dataIndex: 'code', width: 110, render: (v) => <b>{v}</b> },
                { title: 'Tạo lúc', dataIndex: 'createdAt', width: 130, render: (v) => dt(v) },
                { title: 'Người nhận', width: 180, render: (_, r) => <span>{r.receiverName}{r.receiverPhone && <div className="muted" style={{ fontSize: 12 }}>{r.receiverPhone}</div>}</span> },
                { title: 'Địa chỉ', ellipsis: true, render: (_, r) => addressOf(r) },
                { title: 'Vận chuyển', width: 160, render: (_, r) => <span>{r.carrier || <span className="muted">—</span>}{r.trackingCode && <div className="muted" style={{ fontSize: 12 }}>{r.trackingCode}</div>}</span> },
                { title: 'Phí giao', dataIndex: 'shippingFee', className: 'num', width: 95, render: (v) => (toNum(v) ? money(v) : '') },
                { title: 'Thu hộ (COD)', width: 150, className: 'num', render: (_, r) => <CodBadge d={r} /> },
                { title: 'Đơn / Hóa đơn', width: 150, render: (_, r) => <span>{r.order && <Link to={`/orders?search=${r.order.code}`} onClick={(e) => e.stopPropagation()}>{r.order.code}</Link>}{r.order && r.invoice ? <br /> : null}{r.invoice && <Link to={`/invoices?search=${r.invoice.code}`} onClick={(e) => e.stopPropagation()}>{r.invoice.code}</Link>}</span> },
                { title: 'Hẹn giao', dataIndex: 'expectedAt', width: 120, render: (v) => (v ? dt(v) : '') },
                { title: 'Trạng thái', dataIndex: 'status', width: 130, render: (v) => <Tag color={DELIVERY_STATUS_COLOR[v]}>{DELIVERY_STATUS_LABEL[v]}</Tag> },
              ]} />
          </div>
        )}
      </div>
      <Drawer className="od-drawer" title={opened ? <span>Vận đơn {opened.code} <Tag color={DELIVERY_STATUS_COLOR[opened.status]}>{DELIVERY_STATUS_LABEL[opened.status]}</Tag></span> : 'Vận đơn'} open={!!openId} onClose={() => setOpenId(null)} width={640} destroyOnClose>
        {openId && <DeliveryDetail id={openId} />}
      </Drawer>
      <DeliveryFormModal open={creating} onClose={() => setCreating(false)} onSaved={(d) => setOpenId(d.id)} />
    </div>
  );
}
