import { Alert, Card, Col, Empty, Row, Skeleton, Statistic, Table, Tag } from 'antd';
import { AppstoreOutlined, BarcodeOutlined, DollarOutlined, HomeOutlined, ShoppingCartOutlined, WarningOutlined } from '@ant-design/icons';
import dayjs from 'dayjs';
import { Link } from 'react-router-dom';
import { useDashboard } from '../../api/dashboard';
import { usePurchaseSummary } from '../../api/purchasing';
import { useCan } from '../../store/auth';
import { errMsg } from '../../api/client';
import { DOC_STATUS_COLOR, DOC_STATUS_LABEL, DOC_TYPE_LABEL, MOVEMENT_LABEL, dt, money, qty, signedQty } from '../../utils/format';

export default function DashboardPage() {
  const { data, isLoading, error } = useDashboard();
  const can = useCan();
  const { data: purchase } = usePurchaseSummary({ from: dayjs().subtract(29, 'day').startOf('day').toISOString(), to: dayjs().endOf('day').toISOString(), groupBy: 'month' }, can('purchase.report.view'));
  if (error) return <Alert type="error" message={errMsg(error)} showIcon />;
  if (isLoading || !data) return <Skeleton active paragraph={{ rows: 8 }} />;

  // 7-day bars grouped by day
  const days = Array.from({ length: 7 }, (_, i) => dayjs().subtract(6 - i, 'day').format('YYYY-MM-DD'));
  const byDay = days.map((day) => {
    const rows = data.documentsByDay.filter((r) => dayjs(r.day).format('YYYY-MM-DD') === day);
    const get = (t: string) => rows.filter((r) => r.type === t).reduce((s, r) => s + r.count, 0);
    return { day, RECEIPT: get('RECEIPT'), ISSUE: get('ISSUE'), ADJUSTMENT: get('ADJUSTMENT') };
  });
  const max = Math.max(1, ...byDay.map((d) => d.RECEIPT + d.ISSUE + d.ADJUSTMENT));

  return (
    <div>
      <h1 className="kv-page-title">Tổng quan</h1>
      <Row gutter={[12, 12]}>
        <Col xs={12} md={8} lg={4}><Card className="kv-stat-card"><Statistic title="Hàng hóa đang kinh doanh" value={data.products} prefix={<AppstoreOutlined />} /></Card></Col>
        <Col xs={12} md={8} lg={4}><Card className="kv-stat-card"><Statistic title="SKU có tồn" value={data.skuCount} suffix={`/ ${data.variants}`} prefix={<BarcodeOutlined />} /></Card></Col>
        <Col xs={12} md={8} lg={5}><Card className="kv-stat-card"><Statistic title="Tổng tồn (đơn vị)" value={qty(data.onHandTotal)} /></Card></Col>
        {data.stockValue !== undefined && <Col xs={12} md={8} lg={5}><Card className="kv-stat-card"><Statistic title="Giá trị tồn kho" value={money(data.stockValue)} suffix="₫" prefix={<DollarOutlined />} /></Card></Col>}
        <Col xs={12} md={8} lg={3}><Card className="kv-stat-card"><Statistic title="Cảnh báo tồn thấp" value={data.lowStockCount} valueStyle={{ color: data.lowStockCount ? '#d97706' : undefined }} prefix={<WarningOutlined />} /></Card></Col>
        <Col xs={12} md={8} lg={3}><Card className="kv-stat-card"><Statistic title="Kho hàng" value={data.warehouses} prefix={<HomeOutlined />} /></Card></Col>
        {purchase && <Col xs={12} md={8} lg={5}><Card className="kv-stat-card"><Link to="/reports/purchasing"><Statistic title="Mua hàng 30 ngày" value={money(purchase.totals.purchased)} suffix="₫" prefix={<ShoppingCartOutlined />} /></Link></Card></Col>}
        {data.salesToday && <Col xs={12} md={8} lg={5}><Card className="kv-stat-card"><Link to="/reports/sales"><Statistic title={`Doanh thu hôm nay · ${data.salesToday.invoices} hóa đơn`} value={money(data.salesToday.revenue)} suffix="₫" valueStyle={{ color: '#15803d' }} prefix={<DollarOutlined />} /></Link></Card></Col>}
      </Row>
      <Row gutter={[12, 12]} style={{ marginTop: 12 }}>
        <Col xs={24} lg={14}>
          <Card title="Phiếu kho đã ghi sổ 7 ngày qua" size="small" extra={<span className="kv-hint"><Tag color="blue">Nhập</Tag><Tag color="orange">Xuất</Tag><Tag color="purple">Điều chỉnh</Tag></span>}>
            <div className="kv-bars">
              {byDay.map((d) => (
                <div className="kv-bar" key={d.day} title={`Nhập ${d.RECEIPT} · Xuất ${d.ISSUE} · ĐC ${d.ADJUSTMENT}`}>
                  <div style={{ fontSize: 11, color: '#374151' }}>{d.RECEIPT + d.ISSUE + d.ADJUSTMENT || ''}</div>
                  <div style={{ width: '100%', maxWidth: 36, display: 'flex', flexDirection: 'column', justifyContent: 'flex-end', height: 80 }}>
                    <div className="b adj" style={{ height: `${(d.ADJUSTMENT / max) * 80}px`, borderRadius: 0 }} />
                    <div className="b issue" style={{ height: `${(d.ISSUE / max) * 80}px`, borderRadius: 0 }} />
                    <div className="b" style={{ height: `${(d.RECEIPT / max) * 80}px` }} />
                  </div>
                  <div>{dayjs(d.day).format('DD/MM')}</div>
                </div>
              ))}
            </div>
          </Card>
          <Card title="Phiếu kho gần đây" size="small" style={{ marginTop: 12 }} extra={<Link to="/inventory/documents">Xem tất cả</Link>}>
            <Table size="small" rowKey="id" pagination={false} dataSource={data.recentDocuments} locale={{ emptyText: <Empty description="Chưa có phiếu kho" /> }}
              columns={[
                { title: 'Mã phiếu', dataIndex: 'code', render: (v) => <Link to={`/inventory/documents?search=${v}`}>{v}</Link> },
                { title: 'Loại', dataIndex: 'type', render: (v) => DOC_TYPE_LABEL[v] ?? v },
                { title: 'Kho', render: (_, r) => r.warehouse?.name },
                { title: 'Giá trị', dataIndex: 'totalCost', className: 'num', render: (v) => money(v) },
                { title: 'Trạng thái', dataIndex: 'status', render: (v) => <Tag color={DOC_STATUS_COLOR[v]}>{DOC_STATUS_LABEL[v]}</Tag> },
                { title: 'Ngày', dataIndex: 'createdAt', render: (v) => dt(v) },
              ]} />
          </Card>
        </Col>
        <Col xs={24} lg={10}>
          <Card title="Hàng hóa theo nhóm" size="small">
            {data.productsByCategory.length === 0 ? <Empty description="Chưa có hàng hóa" /> : data.productsByCategory.sort((a, b) => b.count - a.count).slice(0, 8).map((c) => (
              <div key={c.categoryId ?? 'none'} style={{ display: 'flex', alignItems: 'center', gap: 8, margin: '6px 0' }}>
                <div style={{ width: 140, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{c.name}</div>
                <div style={{ flex: 1, background: '#eef2f7', borderRadius: 3, height: 10 }}><div style={{ width: `${(c.count / Math.max(...data.productsByCategory.map((x) => x.count))) * 100}%`, background: '#0070f4', height: 10, borderRadius: 3 }} /></div>
                <div style={{ width: 30, textAlign: 'right' }}>{c.count}</div>
              </div>
            ))}
          </Card>
          <Card title="Biến động kho gần đây" size="small" style={{ marginTop: 12 }} extra={<Link to="/inventory/movements">Thẻ kho</Link>}>
            <Table size="small" rowKey="id" pagination={false} dataSource={data.recentMovements} locale={{ emptyText: <Empty description="Chưa có biến động" /> }}
              columns={[
                { title: 'Thời gian', dataIndex: 'createdAt', render: (v) => dt(v, 'DD/MM HH:mm'), width: 100 },
                { title: 'Hàng hóa', render: (_, r) => <span>{r.variant?.name}<div className="muted" style={{ fontSize: 11 }}>{r.documentCode} · {MOVEMENT_LABEL[r.type] ?? r.type}</div></span> },
                { title: 'SL', dataIndex: 'quantity', className: 'num', render: (v) => <span className={Number(v) >= 0 ? 'pos' : 'neg'}>{signedQty(v)}</span> },
                { title: 'Tồn sau', dataIndex: 'balanceAfter', className: 'num', render: (v) => qty(v) },
              ]} />
          </Card>
        </Col>
      </Row>
    </div>
  );
}
