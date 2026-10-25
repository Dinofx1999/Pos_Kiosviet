import { Alert, Button, Card, Col, Row, Skeleton, Statistic } from 'antd';
import Table from '../../components/ResponsiveTable';
import { DollarOutlined, ReloadOutlined } from '@ant-design/icons';
import { useState } from 'react';
import { ExportButton } from './ReportShared';
import { Link } from 'react-router-dom';
import { useSupplierDebt } from '../../api/purchasing';
import { errMsg } from '../../api/client';
import { PaymentModal } from '../../components/PaymentModal';
import { useCan } from '../../store/auth';
import { money } from '../../utils/format';

export default function SupplierDebtPage() {
  const can = useCan();
  const { data, isLoading, isFetching, error, refetch } = useSupplierDebt();
  const [pay, setPay] = useState<{ open: boolean; supplierId?: string; amount?: number }>({ open: false });
  if (error) return <Alert type="error" showIcon message={errMsg(error)} />;
  return (
    <div>
      <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}><h1 className="kv-page-title">Công nợ nhà cung cấp</h1><span className="spacer" /><ExportButton query={{ type: 'supplier-debt' }} /><Button icon={<ReloadOutlined />} loading={isFetching} onClick={() => refetch()} /></div>
      {isLoading || !data ? <Skeleton active /> : (
        <>
          <Row gutter={[12, 12]} style={{ marginBottom: 12 }}>
            <Col xs={24} md={8}><Card className="kv-stat-card"><Statistic title="Tổng nợ phải trả" value={money(data.total)} suffix="₫" valueStyle={{ color: Number(data.total) > 0 ? '#dc2626' : undefined }} /></Card></Col>
            <Col xs={24} md={8}><Card className="kv-stat-card"><Statistic title="Nhà cung cấp đang có công nợ" value={data.suppliers.filter((s) => Number(s.balance) > 0).length} /></Card></Col>
            <Col xs={24} md={8}><Card className="kv-stat-card"><Statistic title="NCC đang nợ lại (trả trước / dư)" value={data.suppliers.filter((s) => Number(s.balance) < 0).length} /></Card></Col>
          </Row>
          <div className="kv-card">
            <Table className="kv-table" rowKey="id" size="small" dataSource={data.suppliers} pagination={{ pageSize: 50 }} locale={{ emptyText: 'Không có công nợ' }}
              columns={[
                { title: 'Mã NCC', dataIndex: 'code', width: 120 },
                { title: 'Nhà cung cấp', render: (_, s) => <Link to={`/suppliers?search=${s.code}`}>{s.name}</Link> },
                { title: 'Điện thoại', dataIndex: 'phone', width: 130 },
                { title: 'Số phiếu nhập', dataIndex: 'receipts', className: 'num', width: 110 },
                { title: 'Đã mua', dataIndex: 'purchased', className: 'num', width: 140, render: (v) => money(v) },
                { title: 'Đã trả', dataIndex: 'paid', className: 'num', width: 140, render: (v) => money(v) },
                { title: 'Nợ hiện tại', dataIndex: 'balance', className: 'num', width: 150, render: (v) => <b className={Number(v) > 0 ? 'neg' : 'pos'}>{money(v)}</b> },
                { title: '', width: 120, render: (_, s) => can('payment.create') && Number(s.balance) > 0 && <Button size="small" type="primary" icon={<DollarOutlined />} onClick={() => setPay({ open: true, supplierId: s.id, amount: Number(s.balance) })}>Thanh toán</Button> },
              ]} />
          </div>
        </>
      )}
      <PaymentModal open={pay.open} supplierId={pay.supplierId} amount={pay.amount} onClose={() => setPay({ open: false })} />
    </div>
  );
}
