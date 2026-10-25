import { Alert, Card, Col, DatePicker, Radio, Row, Select, Skeleton, Statistic } from 'antd';
import Table from '../../components/ResponsiveTable';
import dayjs, { Dayjs } from 'dayjs';
import { useState } from 'react';
import { ExportButton } from './ReportShared';
import { useSalesSummary } from '../../api/sales';
import { errMsg } from '../../api/client';
import { useAuthStore } from '../../store/auth';
import { PAYMENT_METHOD_LABEL, money, qty } from '../../utils/format';

export default function SalesReportPage() {
  const me = useAuthStore((s) => s.me);
  const [range, setRange] = useState<[Dayjs, Dayjs]>([dayjs().startOf('month'), dayjs().endOf('day')]);
  const [groupBy, setGroupBy] = useState<'day' | 'month'>('day');
  const [branchId, setBranchId] = useState<string | undefined>();
  const { data, isLoading, error } = useSalesSummary({ from: range[0].toISOString(), to: range[1].toISOString(), groupBy, branchId });
  const max = Math.max(1, ...(data?.byPeriod ?? []).map((p) => Number(p.revenue)));
  return (
    <div>
      <h1 className="kv-page-title">Báo cáo doanh thu</h1>
      <div className="kv-toolbar">
        <DatePicker.RangePicker value={range} format="DD/MM/YYYY" onChange={(r) => r?.[0] && r?.[1] && setRange([r[0].startOf('day'), r[1].endOf('day')])} />
        <Radio.Group value={groupBy} onChange={(e) => setGroupBy(e.target.value)} optionType="button" options={[{ value: 'day', label: 'Theo ngày' }, { value: 'month', label: 'Theo tháng' }]} />
        <Select allowClear placeholder="Tất cả chi nhánh" style={{ width: 200 }} value={branchId} onChange={setBranchId} options={(me?.branches ?? []).map((b) => ({ value: b.id, label: b.name }))} />
        <ExportButton query={{ type: 'sales', from: range[0].toISOString(), to: range[1].toISOString(), branchId }} />
      </div>
      {error && <Alert type="error" showIcon message={errMsg(error)} />}
      {isLoading || !data ? <Skeleton active /> : (
        <>
          <Row gutter={[12, 12]}>
            <Col xs={12} md={6} lg={3}><Card className="kv-stat-card"><Statistic title="Hóa đơn" value={data.totals.invoices} suffix={data.totals.cancelled ? `(${data.totals.cancelled} hủy)` : undefined} /></Card></Col>
            <Col xs={12} md={6} lg={4}><Card className="kv-stat-card"><Statistic title="Doanh thu" value={money(data.totals.revenue)} suffix="₫" /></Card></Col>
            <Col xs={12} md={6} lg={4}><Card className="kv-stat-card"><Statistic title="Giá vốn" value={money(data.totals.cost)} suffix="₫" /></Card></Col>
            <Col xs={12} md={6} lg={4}><Card className="kv-stat-card"><Statistic title="Lợi nhuận gộp" value={money(data.totals.grossProfit)} suffix="₫" valueStyle={{ color: '#15803d' }} /></Card></Col>
            <Col xs={12} md={6} lg={3}><Card className="kv-stat-card"><Statistic title="Giảm giá" value={money(data.totals.discount)} suffix="₫" /></Card></Col>
            <Col xs={12} md={6} lg={3}><Card className="kv-stat-card"><Statistic title="Đã thu" value={money(data.totals.paid)} suffix="₫" /></Card></Col>
            <Col xs={12} md={6} lg={3}><Card className="kv-stat-card"><Statistic title="Còn nợ" value={money(data.totals.debt)} suffix="₫" valueStyle={{ color: Number(data.totals.debt) > 0 ? '#dc2626' : undefined }} /></Card></Col>
          </Row>
          <Card size="small" title="Doanh thu theo kỳ" style={{ marginTop: 12 }}>
            {data.byPeriod.length === 0 ? <div className="muted">Không có hóa đơn trong kỳ</div> : (
              <div className="kv-bars" style={{ height: 160 }}>
                {data.byPeriod.map((p) => (
                  <div key={p.period} className="kv-bar" title={`${money(p.revenue)} · LN ${money(p.grossProfit)} · ${p.invoices} HĐ`}>
                    <span style={{ fontSize: 10 }}>{money(p.revenue)}</span>
                    <div style={{ width: '70%', background: '#0070f4', borderRadius: 3, height: `${Math.max(2, (Number(p.revenue) / max) * 110)}px` }} />
                    <span>{dayjs(p.period).format(groupBy === 'month' ? 'MM/YY' : 'DD/MM')}</span>
                  </div>
                ))}
              </div>
            )}
          </Card>
          <Row gutter={[12, 12]} style={{ marginTop: 12 }}>
            <Col xs={24} lg={12}><Card size="small" title="Theo nhân viên bán"><Table size="small" rowKey={(r) => r.sellerId ?? '-'} pagination={false} dataSource={data.bySeller} columns={[{ title: 'Nhân viên', dataIndex: 'name' }, { title: 'HĐ', dataIndex: 'invoices', className: 'num', width: 60 }, { title: 'Doanh thu', dataIndex: 'revenue', className: 'num', render: (v) => money(v) }, { title: 'Lợi nhuận', dataIndex: 'grossProfit', className: 'num', render: (v) => money(v) }]} /></Card></Col>
            <Col xs={24} lg={12}><Card size="small" title="Theo chi nhánh"><Table size="small" rowKey="branchId" pagination={false} dataSource={data.byBranch} columns={[{ title: 'Chi nhánh', dataIndex: 'name' }, { title: 'HĐ', dataIndex: 'invoices', className: 'num', width: 60 }, { title: 'Doanh thu', dataIndex: 'revenue', className: 'num', render: (v) => money(v) }, { title: 'Lợi nhuận', dataIndex: 'grossProfit', className: 'num', render: (v) => money(v) }]} /></Card></Col>
            <Col xs={24} lg={14}><Card size="small" title="Hàng bán chạy"><Table size="small" rowKey="variantId" pagination={false} dataSource={data.byProduct} columns={[{ title: 'Mã', dataIndex: 'sku', width: 110 }, { title: 'Tên hàng', dataIndex: 'name' }, { title: 'SL', dataIndex: 'quantity', className: 'num', width: 70, render: (v) => qty(v) }, { title: 'Doanh thu', dataIndex: 'revenue', className: 'num', render: (v) => money(v) }, { title: 'Lợi nhuận', dataIndex: 'grossProfit', className: 'num', render: (v) => money(v) }]} /></Card></Col>
            <Col xs={24} lg={10}><Card size="small" title="Theo phương thức thanh toán"><Table size="small" rowKey="method" pagination={false} dataSource={data.byMethod} columns={[{ title: 'Phương thức', dataIndex: 'method', render: (v) => PAYMENT_METHOD_LABEL[v] ?? v }, { title: 'Số phiếu', dataIndex: 'count', className: 'num', width: 80 }, { title: 'Số tiền', dataIndex: 'amount', className: 'num', render: (v) => money(v) }]} /></Card></Col>
          </Row>
        </>
      )}
    </div>
  );
}
