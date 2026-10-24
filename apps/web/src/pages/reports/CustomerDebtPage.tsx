import { Alert, Button, Card, Skeleton, Statistic, Table } from 'antd';
import { DollarOutlined } from '@ant-design/icons';
import { useState } from 'react';
import { ExportButton } from './ReportShared';
import { Link } from 'react-router-dom';
import { useCustomerDebt } from '../../api/sales';
import { errMsg } from '../../api/client';
import { PaymentModal } from '../../components/PaymentModal';
import { useCan } from '../../store/auth';
import { money } from '../../utils/format';

export default function CustomerDebtPage() {
  const can = useCan();
  const { data, isLoading, error, refetch } = useCustomerDebt();
  const [pay, setPay] = useState<{ open: boolean; customerId?: string; amount?: number }>({ open: false });
  if (error) return <Alert type="error" showIcon message={errMsg(error)} />;
  return (
    <div>
      <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}><h1 className="kv-page-title">Công nợ khách hàng</h1><span className="spacer" /><ExportButton query={{ type: 'customer-debt' }} /></div>
      {isLoading || !data ? <Skeleton active /> : (
        <>
          <Card className="kv-stat-card" style={{ width: 320, marginBottom: 12 }}><Statistic title="Tổng khách đang nợ" value={money(data.total)} suffix="₫" valueStyle={{ color: '#dc2626' }} /></Card>
          <div className="kv-card">
            <Table size="small" rowKey="id" dataSource={data.customers} pagination={{ pageSize: 20 }}
              columns={[
                { title: 'Mã KH', dataIndex: 'code', width: 110, render: (v, r) => <Link to={`/customers?search=${r.code}`}>{v}</Link> },
                { title: 'Khách hàng', dataIndex: 'name' },
                { title: 'Điện thoại', dataIndex: 'phone', width: 120 },
                { title: 'Số HĐ', dataIndex: 'invoices', className: 'num', width: 80 },
                { title: 'Đã mua', dataIndex: 'revenue', className: 'num', width: 130, render: (v) => money(v) },
                { title: 'Đã trả', dataIndex: 'paid', className: 'num', width: 130, render: (v) => money(v) },
                { title: 'Hạn mức', dataIndex: 'creditLimit', className: 'num', width: 120, render: (v) => v ? money(v) : '—' },
                { title: 'Nợ hiện tại', dataIndex: 'balance', className: 'num', width: 130, render: (v) => <b className={Number(v) > 0 ? 'neg' : 'pos'}>{money(v)}</b> },
                { title: '', width: 110, render: (_, r) => can('payment.create') && Number(r.balance) > 0 && <Button size="small" type="primary" icon={<DollarOutlined />} onClick={() => setPay({ open: true, customerId: r.id, amount: Number(r.balance) })}>Thu nợ</Button> },
              ]} />
          </div>
        </>
      )}
      <PaymentModal open={pay.open} partyType="CUSTOMER" direction="IN" partyId={pay.customerId} amount={pay.amount} onClose={() => setPay({ open: false })} onSaved={() => refetch()} />
    </div>
  );
}
