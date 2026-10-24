import { Alert, App, Button, Empty, Form, Input, InputNumber, Modal, Pagination, Radio, Skeleton, Table, Tag } from 'antd';
import { EditOutlined, GiftOutlined } from '@ant-design/icons';
import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { useQueryClient } from '@tanstack/react-query';
import { errMsg } from '../../api/client';
import { POINT_TYPE_COLOR, POINT_TYPE_LABEL, PointEntry, loyaltyApi, pts, useCustomerPoints } from '../../api/loyalty';
import { useIsMobile } from '../../hooks/useMedia';
import { useCan } from '../../store/auth';
import { dt, money, toNum } from '../../utils/format';
import '../settings/loyalty.css';

const docLink = (e: PointEntry) => {
  if (!e.documentCode) return null;
  if (e.documentType === 'INVOICE') return <Link to={`/invoices?search=${e.documentCode}`}>{e.documentCode}</Link>;
  if (e.documentType === 'SALES_RETURN') return <Link to={`/sales-returns?search=${e.documentCode}`}>{e.documentCode}</Link>;
  return <span>{e.documentCode}</span>;
};
const signedPts = (v: unknown) => { const n = toNum(v); return `${n > 0 ? '+' : n < 0 ? '−' : ''}${pts(Math.abs(n))}`; };

/** Points badge for the customer header / list: balance with tone. */
export function PointsBadge({ value, title }: { value?: string | number | null; title?: string }) {
  const n = toNum(value);
  return <span className={`lp-points-badge${n === 0 ? ' zero' : n < 0 ? ' neg' : ''}`} title={title ?? 'Điểm tích lũy'}><GiftOutlined /> {pts(n)} điểm</span>;
}

/** Khách hàng › Điểm tích lũy (BR-140..BR-144): balance, earned / redeemed / adjusted, ledger, manual adjustment. */
export function CustomerPointsTab({ id }: { id: string }) {
  const can = useCan();
  const isMobile = useIsMobile();
  const [page, setPage] = useState(1);
  const [adjust, setAdjust] = useState(false);
  const { data, isLoading, error } = useCustomerPoints(id, { page, pageSize: 20 });
  if (isLoading && !data) return <Skeleton active />;
  if (!data) return <Alert type="error" showIcon message={errMsg(error)} />;
  const cfg = data.config;
  const rows = data.data;
  return (
    <div>
      <div className="lp-head">
        <div className="kv-hint">{cfg.enabled ? <>Tích <b>{cfg.earnPoints}</b> điểm / <b>{money(cfg.earnPerAmount)} đ</b> · 1 điểm = <b>{money(cfg.redeemValue)} đ</b>{cfg.minRedeem > 0 ? <> · tối thiểu {cfg.minRedeem} điểm/lần</> : null} · tối đa {cfg.maxRedeemPercent}% hóa đơn</> : <>Cửa hàng chưa bật tích điểm{can('tenant.settings.manage') ? <> – <Link to="/settings/loyalty">bật trong Thiết lập › Tích điểm</Link></> : ''}</>}</div>
        {can('loyalty.manage') && <Button icon={<EditOutlined />} onClick={() => setAdjust(true)}>Điều chỉnh điểm</Button>}
      </div>
      <div className="lp-stats">
        <div className="lp-stat"><div className="lbl">Số dư hiện tại</div><div className={`val big${toNum(data.balance) < 0 ? ' neg' : ''}`}>{pts(data.balance)}</div><div className="sub">≈ {money(toNum(data.balance) * cfg.redeemValue)} đ</div></div>
        <div className="lp-stat"><div className="lbl">Đã tích</div><div className="val pos">+{pts(data.earned)}</div></div>
        <div className="lp-stat"><div className="lbl">Đã dùng</div><div className="val">−{pts(data.redeemed)}</div><div className="sub">≈ {money(toNum(data.redeemed) * cfg.redeemValue)} đ</div></div>
        <div className="lp-stat"><div className="lbl">Điều chỉnh</div><div className={`val${toNum(data.adjusted) < 0 ? ' neg' : toNum(data.adjusted) > 0 ? ' pos' : ''}`}>{signedPts(data.adjusted)}</div></div>
      </div>
      {rows.length === 0 ? <Empty description="Chưa có phát sinh điểm" /> : isMobile ? (
        <>
          <div className="lp-entries">
            {rows.map((e) => (
              <div key={e.id} className="lp-entry">
                <div className="ty"><Tag color={POINT_TYPE_COLOR[e.type]}>{POINT_TYPE_LABEL[e.type] ?? e.type}</Tag>{docLink(e)}</div>
                <div className={`pt ${toNum(e.points) >= 0 ? 'pos' : 'neg'}`}>{signedPts(e.points)}</div>
                <div className="meta"><span>{dt(e.createdAt)}</span>{e.note && <span>· {e.note}</span>}</div>
                <div className="bal">còn {pts(e.balanceAfter)}</div>
              </div>
            ))}
          </div>
          {data.meta.total > 20 && <div style={{ display: 'flex', justifyContent: 'center', padding: '10px 0' }}><Pagination simple current={page} pageSize={20} total={data.meta.total} onChange={setPage} /></div>}
        </>
      ) : (
        <Table<PointEntry> size="small" rowKey="id" dataSource={rows} pagination={{ current: page, pageSize: 20, total: data.meta.total, onChange: setPage, showTotal: (t) => `${t} dòng` }}
          columns={[
            { title: 'Thời gian', dataIndex: 'createdAt', width: 150, render: (v) => dt(v, 'DD/MM/YYYY HH:mm:ss') },
            { title: 'Loại', dataIndex: 'type', width: 120, render: (v) => <Tag color={POINT_TYPE_COLOR[v as PointEntry['type']]}>{POINT_TYPE_LABEL[v as PointEntry['type']] ?? v}</Tag> },
            { title: 'Chứng từ', width: 140, render: (_, e) => docLink(e) ?? <span className="muted">—</span> },
            { title: 'Ghi chú', dataIndex: 'note', ellipsis: true, render: (v) => v || <span className="muted">—</span> },
            { title: 'Điểm', dataIndex: 'points', className: 'num', width: 100, render: (v) => <b className={toNum(v) >= 0 ? 'pos' : 'neg'}>{signedPts(v)}</b> },
            { title: 'Số dư sau', dataIndex: 'balanceAfter', className: 'num', width: 110, render: (v) => <b>{pts(v)}</b> },
          ]} />
      )}
      <AdjustPointsModal open={adjust} customerId={id} customerName={data.customer.name} balance={data.balance} onClose={() => setAdjust(false)} />
    </div>
  );
}

/** Manual +/− adjustment with a mandatory reason (loyalty.manage, BR-144). */
export function AdjustPointsModal({ open, customerId, customerName, balance, onClose }: { open: boolean; customerId: string; customerName?: string; balance?: string; onClose: () => void }) {
  const { message } = App.useApp();
  const qc = useQueryClient();
  const [form] = Form.useForm();
  const [saving, setSaving] = useState(false);
  const sign: '+' | '-' = Form.useWatch('sign', form) ?? '+';
  const points = toNum(Form.useWatch('points', form));
  useEffect(() => { if (open) { form.resetFields(); form.setFieldsValue({ sign: '+', points: undefined, note: '' }); } }, [open]);
  const after = toNum(balance) + (sign === '+' ? points : -points);
  const submit = async () => {
    const v = await form.validateFields();
    const n = Math.round(toNum(v.points));
    if (n <= 0) { message.warning('Nhập số điểm lớn hơn 0'); return; }
    setSaving(true);
    try {
      await loyaltyApi.adjust(customerId, { points: `${v.sign === '-' ? '-' : ''}${n}`, note: v.note.trim() });
      message.success(`Đã ${v.sign === '-' ? 'trừ' : 'cộng'} ${n} điểm`);
      ['customer-points', 'customer', 'customers'].forEach((k) => qc.invalidateQueries({ queryKey: [k] }));
      onClose();
    } catch (e) { message.error(errMsg(e)); } finally { setSaving(false); }
  };
  return (
    <Modal title={`Điều chỉnh điểm${customerName ? ` · ${customerName}` : ''}`} open={open} onCancel={onClose} onOk={submit} okText="Lưu điều chỉnh" cancelText="Bỏ qua" confirmLoading={saving} destroyOnClose>
      <Form form={form} layout="vertical">
        <Form.Item name="sign" label="Thao tác"><Radio.Group optionType="button" buttonStyle="solid" options={[{ value: '+', label: 'Cộng điểm' }, { value: '-', label: 'Trừ điểm' }]} /></Form.Item>
        <Form.Item name="points" label="Số điểm" rules={[{ required: true, message: 'Nhập số điểm' }]}><InputNumber min={1} step={1} precision={0} style={{ width: '100%' }} inputMode="numeric" autoFocus /></Form.Item>
        <Form.Item name="note" label="Lý do" rules={[{ required: true, whitespace: true, message: 'Nhập lý do điều chỉnh' }]}><Input.TextArea rows={2} maxLength={500} placeholder="Tặng điểm sinh nhật, bù điểm do lỗi hệ thống…" /></Form.Item>
        <div className="lp-adjust-preview"><span>Số dư hiện tại <b>{pts(balance)}</b></span><span>Sau điều chỉnh <b className={after < 0 ? 'neg' : ''}>{pts(after)}</b></span></div>
        {after < 0 && <div className="kv-hint neg" style={{ marginTop: 6 }}>Số dư sẽ âm – khách đã tiêu nhiều hơn số điểm thực có.</div>}
      </Form>
    </Modal>
  );
}
