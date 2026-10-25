import { Button, DatePicker, Descriptions, Empty, Input, Radio, Tag } from 'antd';
import Table from '../../components/ResponsiveTable';
import { PlusOutlined, ReloadOutlined, SearchOutlined, StopOutlined } from '@ant-design/icons';
import { useState } from 'react';
import { Link, useSearchParams } from 'react-router-dom';
import { ShiftQuery, useShift, useShifts } from '../../api/sales';
import { errMsg } from '../../api/client';
import { FilterCard, FilterPanel } from '../../components/FilterPanel';
import { useAuthStore, useCan } from '../../store/auth';
import { PAYMENT_METHOD_LABEL, SHIFT_STATUS_LABEL, dt, money } from '../../utils/format';
import { ShiftOpenModal } from '../pos/PosModals';
import { ShiftCloseHandoverModal } from '../finance/ShiftCloseHandoverModal';
import { useCashTransfers } from '../../api/finance';

export default function ShiftsPage() {
  const can = useCan();
  const [sp] = useSearchParams();
  const me = useAuthStore((s) => s.me);
  const branchId = useAuthStore((s) => s.currentBranchId);
  const [q, setQ] = useState<ShiftQuery>({ page: 1, pageSize: 20, search: sp.get('search') ?? undefined });
  const [searchText, setSearchText] = useState(q.search ?? '');
  const [openModal, setOpenModal] = useState(false);
  const [closeId, setCloseId] = useState<string | undefined>();
  const { data, isLoading, isFetching, error, refetch } = useShifts(q);
  const set = (patch: Partial<ShiftQuery>) => setQ((s) => ({ ...s, ...patch, page: patch.page ?? 1 }));
  return (
    <div className="kv-list">
      <FilterPanel>
        <FilterCard title="Trạng thái"><Radio.Group value={q.status ?? ''} onChange={(e) => set({ status: e.target.value || undefined })}><Radio value="">Tất cả</Radio><Radio value="OPEN">Đang mở</Radio><Radio value="CLOSED">Đã đóng</Radio></Radio.Group></FilterCard>
        <FilterCard title="Chi nhánh"><Radio.Group value={q.branchId ?? ''} onChange={(e) => set({ branchId: e.target.value || undefined })}><Radio value="">Tất cả</Radio>{(me?.branches ?? []).map((b) => <Radio key={b.id} value={b.id}>{b.name}</Radio>)}</Radio.Group></FilterCard>
        <FilterCard title="Thời gian mở ca"><DatePicker.RangePicker size="small" style={{ width: '100%' }} format="DD/MM/YYYY" onChange={(r) => set({ from: r?.[0]?.startOf('day').toISOString(), to: r?.[1]?.endOf('day').toISOString() })} /></FilterCard>
      </FilterPanel>
      <div className="kv-main">
        <h1 className="kv-page-title">Ca bán hàng</h1>
        <div className="kv-toolbar">
          <Input.Search className="kv-search" allowClear placeholder="Theo mã ca" value={searchText} onChange={(e) => setSearchText(e.target.value)} onSearch={(v) => set({ search: v || undefined })} enterButton={<SearchOutlined />} />
          <span className="spacer" />
          {can('shift.open') && <Button type="primary" icon={<PlusOutlined />} onClick={() => setOpenModal(true)}>Mở ca</Button>}
          <Button icon={<ReloadOutlined />} onClick={() => refetch()} loading={isFetching} />
        </div>
        <div className="kv-card">
          <Table className="kv-table" rowKey="id" size="small" loading={isLoading} dataSource={data?.data ?? []} scroll={{ x: 1200 }}
            locale={{ emptyText: error ? <Empty description={errMsg(error)} /> : <Empty description="Chưa có ca bán hàng" /> }}
            expandable={{ expandedRowRender: (r) => <ShiftDetail id={r.id} onClose={() => setCloseId(r.id)} />, expandRowByClick: true }}
            onChange={(p) => set({ page: p.current, pageSize: p.pageSize })}
            pagination={{ current: q.page, pageSize: q.pageSize, total: data?.meta.total ?? 0, showSizeChanger: true, pageSizeOptions: [15, 20, 50, 100], showTotal: (t) => `${t} ca` }}
            columns={[
              { title: 'Mã ca', dataIndex: 'code', width: 110, render: (v) => <b>{v}</b> },
              { title: 'Nhân viên', width: 160, render: (_, r) => r.user?.fullName },
              { title: 'Chi nhánh', width: 150, render: (_, r) => r.branch?.name },
              { title: 'Mở lúc', dataIndex: 'openedAt', width: 140, render: (v) => dt(v) },
              { title: 'Đóng lúc', dataIndex: 'closedAt', width: 140, render: (v) => dt(v) || '—' },
              { title: 'Tiền đầu ca', dataIndex: 'openingCash', className: 'num', width: 120, render: (v) => money(v) },
              { title: 'Dự kiến', dataIndex: 'expectedCash', className: 'num', width: 120, render: (v) => v ? money(v) : '—' },
              { title: 'Thực đếm', dataIndex: 'countedCash', className: 'num', width: 120, render: (v) => v ? money(v) : '—' },
              { title: 'Chênh lệch', dataIndex: 'difference', className: 'num', width: 110, render: (v) => v ? <span className={Number(v) < 0 ? 'neg' : Number(v) > 0 ? 'pos' : ''}>{Number(v) > 0 ? '+' : ''}{money(v)}</span> : '—' },
              { title: 'HĐ', width: 60, render: (_, r) => r._count?.invoices ?? 0 },
              { title: 'Trạng thái', dataIndex: 'status', width: 100, render: (v) => <Tag color={v === 'OPEN' ? 'green' : 'default'}>{SHIFT_STATUS_LABEL[v]}</Tag> },
            ]} />
        </div>
      </div>
      <ShiftOpenModal open={openModal} branchId={branchId} onClose={() => setOpenModal(false)} onOpened={() => refetch()} />
      <ShiftCloseHandoverModal open={!!closeId} shiftId={closeId} onClose={() => setCloseId(undefined)} onClosed={() => refetch()} />
    </div>
  );
}

function ShiftDetail({ id, onClose }: { id: string; onClose: () => void }) {
  const { data: s, isLoading } = useShift(id);
  const can = useCan();
  const me = useAuthStore((st) => st.me);
  // Module 08: the handover transfer created at shift close (its note is "Bàn giao ca <code>")
  const { data: handovers } = useCashTransfers({ search: s ? `Bàn giao ca ${s.code}` : undefined, pageSize: 5 }, !!s && s.status === 'CLOSED' && can('cash.view'));
  if (isLoading || !s) return <div className="muted">Đang tải…</div>;
  const mine = s.userId === me?.user.id;
  const handover = (handovers?.data ?? []).filter((t) => t.note === `Bàn giao ca ${s.code}`);
  return (
    <div className="kv-expanded">
      <div style={{ display: 'flex', gap: 24, flexWrap: 'wrap' }}>
        <Descriptions size="small" column={1} colon={false} labelStyle={{ width: 150, color: '#6b7280' }} style={{ flex: '1 1 300px' }}>
          <Descriptions.Item label="Mã ca"><b>{s.code}</b> <Tag color={s.status === 'OPEN' ? 'green' : 'default'}>{SHIFT_STATUS_LABEL[s.status]}</Tag></Descriptions.Item>
          <Descriptions.Item label="Nhân viên">{s.user?.fullName}</Descriptions.Item>
          <Descriptions.Item label="Mở / đóng">{dt(s.openedAt)}{s.closedAt ? ` → ${dt(s.closedAt)}` : ''}</Descriptions.Item>
          <Descriptions.Item label="Số hóa đơn"><Link to={`/invoices?shiftId=${s.id}`}>{s.invoices ?? 0}</Link></Descriptions.Item>
          <Descriptions.Item label="Doanh thu">{money(s.revenue)}</Descriptions.Item>
          <Descriptions.Item label="Đã thu trên hóa đơn">{money(s.collected)}</Descriptions.Item>
          <Descriptions.Item label="Tiền đầu ca">{money(s.openingCash)}</Descriptions.Item>
          <Descriptions.Item label="Tiền mặt dự kiến"><b>{money(s.expectedCash)}</b></Descriptions.Item>
          {s.status === 'CLOSED' && <><Descriptions.Item label="Thực đếm">{money(s.countedCash)}</Descriptions.Item><Descriptions.Item label="Chênh lệch"><b className={Number(s.difference) < 0 ? 'neg' : Number(s.difference) > 0 ? 'pos' : ''}>{money(s.difference)}</b></Descriptions.Item></>}
          {s.status === 'CLOSED' && can('cash.view') && <Descriptions.Item label="Bàn giao ca">{handover.length ? handover.map((t) => <span key={t.id}><Link to={`/cash/transfers?search=${t.code}`}>{t.code}</Link> · {money(t.amount)} → {t.toAccount.name}{t.status === 'CANCELLED' ? <Tag color="red" style={{ marginLeft: 6 }}>Đã hủy</Tag> : null}</span>) : <span className="muted">Không bàn giao</span>}</Descriptions.Item>}
          {s.note && <Descriptions.Item label="Ghi chú">{s.note}</Descriptions.Item>}
        </Descriptions>
        <Table size="small" rowKey="method" pagination={false} dataSource={s.byMethod ?? []} style={{ flex: '1 1 320px' }} title={() => <b>Thu / chi trong ca theo phương thức</b>} locale={{ emptyText: 'Chưa có thu / chi' }}
          columns={[{ title: 'Phương thức', dataIndex: 'method', render: (v) => PAYMENT_METHOD_LABEL[v] ?? v }, { title: 'Thu', dataIndex: 'in', className: 'num', render: (v) => money(v) }, { title: 'Chi', dataIndex: 'out', className: 'num', render: (v) => money(v) }, { title: 'Ròng', dataIndex: 'net', className: 'num', render: (v) => <b>{money(v)}</b> }]} />
      </div>
      <div className="kv-detail-actions">
        {s.status === 'OPEN' && (mine ? can('shift.close') : can('shift.manage')) && <Button danger icon={<StopOutlined />} onClick={onClose}>Đóng ca & đối soát</Button>}
      </div>
    </div>
  );
}
