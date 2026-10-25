import { Alert, Button, Card, Col, DatePicker, Radio, Row, Select, Skeleton, Statistic, Tag } from 'antd';
import Table from '../../components/ResponsiveTable';
import dayjs, { Dayjs } from 'dayjs';
import { useState } from 'react';
import { Link } from 'react-router-dom';
import { usePurchaseSummary } from '../../api/purchasing';
import { errMsg } from '../../api/client';
import { useBranches } from '../../api/org';
import { SupplierSelect } from '../../components/SupplierSelect';
import { useCan } from '../../store/auth';
import { money, qty } from '../../utils/format';

export default function PurchasingReportPage() {
  const can = useCan();
  const [range, setRange] = useState<[Dayjs, Dayjs]>([dayjs().subtract(29, 'day').startOf('day'), dayjs().endOf('day')]);
  const [groupBy, setGroupBy] = useState<'day' | 'month'>('day');
  const [supplierId, setSupplierId] = useState<string>();
  const [branchId, setBranchId] = useState<string>();
  const { data: branches } = useBranches();
  const { data, isLoading, error, refetch } = usePurchaseSummary({ from: range[0].toISOString(), to: range[1].toISOString(), groupBy, supplierId, branchId });
  const max = Math.max(1, ...(data?.byPeriod ?? []).map((p) => Number(p.purchased)));
  return (
    <div>
      <h1 className="kv-page-title">Báo cáo mua hàng</h1>
      <Card size="small" style={{ marginBottom: 12 }}>
        <div style={{ display: 'flex', gap: 10, flexWrap: 'wrap', alignItems: 'center' }}>
          <DatePicker.RangePicker value={range} format="DD/MM/YYYY" onChange={(r) => r && r[0] && r[1] && setRange([r[0].startOf('day'), r[1].endOf('day')])} allowClear={false} presets={[{ label: '7 ngày', value: [dayjs().subtract(6, 'day').startOf('day'), dayjs().endOf('day')] }, { label: '30 ngày', value: [dayjs().subtract(29, 'day').startOf('day'), dayjs().endOf('day')] }, { label: 'Tháng này', value: [dayjs().startOf('month'), dayjs().endOf('month')] }, { label: 'Năm nay', value: [dayjs().startOf('year'), dayjs().endOf('year')] }]} />
          <Radio.Group value={groupBy} onChange={(e) => setGroupBy(e.target.value)} optionType="button" options={[{ value: 'day', label: 'Theo ngày' }, { value: 'month', label: 'Theo tháng' }]} />
          <div style={{ width: 260 }}><SupplierSelect value={supplierId} onChange={(v) => setSupplierId(v)} allowCreate={false} placeholder="Tất cả nhà cung cấp" /></div>
          <Select allowClear style={{ width: 200 }} placeholder="Tất cả chi nhánh" value={branchId} onChange={setBranchId} options={(branches ?? []).map((b) => ({ value: b.id, label: b.name }))} />
          <Button onClick={() => refetch()}>Làm mới</Button>
        </div>
      </Card>
      {error && <Alert type="error" showIcon message={errMsg(error)} />}
      {isLoading || !data ? <Skeleton active paragraph={{ rows: 8 }} /> : (
        <>
          <Row gutter={[12, 12]}>
            <Col xs={12} md={8} lg={4}><Card className="kv-stat-card"><Statistic title="Số phiếu nhập" value={data.totals.receipts} /></Card></Col>
            <Col xs={12} md={8} lg={5}><Card className="kv-stat-card"><Statistic title="Tổng mua hàng" value={money(data.totals.purchased)} suffix="₫" /></Card></Col>
            <Col xs={12} md={8} lg={5}><Card className="kv-stat-card"><Statistic title="Trả lại NCC" value={money(data.totals.returned)} suffix="₫" valueStyle={{ color: '#d97706' }} /></Card></Col>
            <Col xs={12} md={8} lg={5}><Card className="kv-stat-card"><Statistic title="Đã chi trả NCC" value={money(data.totals.paidOut)} suffix="₫" valueStyle={{ color: '#dc2626' }} /></Card></Col>
            <Col xs={12} md={8} lg={5}><Card className="kv-stat-card"><Statistic title="NCC hoàn tiền" value={money(data.totals.refundedIn)} suffix="₫" valueStyle={{ color: '#16a34a' }} /></Card></Col>
          </Row>
          <Card title={`Giá trị mua hàng ${groupBy === 'day' ? 'theo ngày' : 'theo tháng'}`} size="small" style={{ marginTop: 12 }} extra={<span className="kv-hint"><Tag color="blue">Mua</Tag><Tag color="orange">Trả lại</Tag></span>}>
            {data.byPeriod.length === 0 ? <div className="muted">Không có dữ liệu trong khoảng thời gian này</div> : (
              <div className="kv-bars" style={{ overflowX: 'auto' }}>
                {data.byPeriod.map((p) => (
                  <div className="kv-bar" key={p.period} title={`Mua ${money(p.purchased)} · Trả ${money(p.returned)} · Chi ${money(p.paidOut)}`} style={{ minWidth: 44 }}>
                    <div style={{ fontSize: 10, color: '#374151' }}>{Number(p.purchased) ? money(Number(p.purchased) / 1000) + 'k' : ''}</div>
                    <div style={{ width: '100%', maxWidth: 36, display: 'flex', flexDirection: 'column', justifyContent: 'flex-end', height: 90 }}>
                      <div className="b issue" style={{ height: `${(Number(p.returned) / max) * 90}px`, borderRadius: 0 }} />
                      <div className="b" style={{ height: `${(Number(p.purchased) / max) * 90}px` }} />
                    </div>
                    <div style={{ fontSize: 11 }}>{dayjs(p.period).format(groupBy === 'day' ? 'DD/MM' : 'MM/YYYY')}</div>
                  </div>
                ))}
              </div>
            )}
          </Card>
          <Row gutter={[12, 12]} style={{ marginTop: 12 }}>
            <Col xs={24} lg={14}>
              <Card title="Theo nhà cung cấp" size="small">
                <Table size="small" rowKey="supplierId" pagination={false} dataSource={data.bySupplier} locale={{ emptyText: 'Không có dữ liệu' }}
                  columns={[
                    { title: 'Nhà cung cấp', render: (_, s) => <Link to={`/suppliers?search=${s.code}`}>{s.name}</Link> },
                    { title: 'Số phiếu', dataIndex: 'receipts', className: 'num', width: 80 },
                    { title: 'Đã mua', dataIndex: 'purchased', className: 'num', render: (v) => money(v) },
                    { title: 'Trả lại', dataIndex: 'returned', className: 'num', render: (v) => money(v) },
                    { title: 'Đã trả tiền', dataIndex: 'paid', className: 'num', render: (v) => money(v) },
                    ...(can('supplier.debt.view') ? [{ title: 'Còn nợ (theo phiếu)', className: 'num', render: (_: unknown, s: any) => <span className="neg">{money(Number(s.purchased) - Number(s.paid))}</span> }] : []),
                  ]} />
              </Card>
            </Col>
            <Col xs={24} lg={10}>
              <Card title="Hàng mua nhiều nhất" size="small">
                <Table size="small" rowKey="variantId" pagination={false} dataSource={data.topProducts} locale={{ emptyText: 'Không có dữ liệu' }}
                  columns={[{ title: 'Hàng hóa', render: (_, p) => <span>{p.name}<div className="kv-hint">{p.sku}</div></span> }, { title: 'SL', dataIndex: 'quantity', className: 'num', render: (v) => qty(v) }, { title: 'Giá trị', dataIndex: 'amount', className: 'num', render: (v) => money(v) }]} />
              </Card>
            </Col>
          </Row>
        </>
      )}
    </div>
  );
}
