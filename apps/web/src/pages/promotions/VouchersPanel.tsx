import { App, Button, DatePicker, Empty, Form, Input, InputNumber, Modal, Pagination, Radio, Select, Table, Tag, Tooltip } from 'antd';
import { CopyOutlined, LockOutlined, PlusOutlined, ReloadOutlined, SearchOutlined, UnlockOutlined } from '@ant-design/icons';
import dayjs from 'dayjs';
import { useEffect, useState } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import { errMsg } from '../../api/client';
import { CreateVouchersInput, PROMOTION_KEYS, VOUCHER_STATUS_COLOR, VOUCHER_STATUS_LABEL, Voucher, VoucherQuery, promotionsApi, useVouchers } from '../../api/promotions';
import { CustomerSelect } from '../../components/CustomerSelect';
import { useIsMobile } from '../../hooks/useMedia';
import { useCan } from '../../store/auth';
import { dt } from '../../utils/format';

async function copyText(text: string): Promise<boolean> {
  try { await navigator.clipboard.writeText(text); return true; } catch {
    try { const ta = document.createElement('textarea'); ta.value = text; ta.style.position = 'fixed'; ta.style.opacity = '0'; document.body.appendChild(ta); ta.select(); const ok = document.execCommand('copy'); ta.remove(); return ok; } catch { return false; }
  }
}

/** Issue codes + list / disable / enable / copy – used in the editor's "Voucher" tab and on the detail page. */
export function VouchersPanel({ promotionId }: { promotionId: string }) {
  const { message } = App.useApp();
  const qc = useQueryClient();
  const can = useCan();
  const isMobile = useIsMobile();
  const canManage = can('promotion.manage');
  const [q, setQ] = useState<VoucherQuery>({ page: 1, pageSize: 20 });
  const [searchText, setSearchText] = useState('');
  const { data, isLoading, isFetching, refetch } = useVouchers(promotionId, q);
  const [issue, setIssue] = useState(false);
  const [issued, setIssued] = useState<string[] | null>(null);
  const [mode, setMode] = useState<'auto' | 'custom'>('auto');
  const [form] = Form.useForm();
  const [saving, setSaving] = useState(false);
  useEffect(() => { if (issue) { form.resetFields(); form.setFieldsValue({ count: 10, maxUses: 1 }); setMode('auto'); } }, [issue]);
  const rows = data?.data ?? [];
  const total = data?.meta.total ?? 0;
  const invalidate = () => PROMOTION_KEYS.forEach((k) => qc.invalidateQueries({ queryKey: [k] }));

  const submit = async () => {
    const v = await form.validateFields();
    const codes: string[] = mode === 'custom' ? String(v.codes ?? '').split(/[\s,;]+/).map((c: string) => c.trim().toUpperCase()).filter(Boolean) : [];
    const body: CreateVouchersInput = {
      ...(mode === 'custom' ? { codes } : { count: Math.floor(v.count ?? 1), prefix: v.prefix ? String(v.prefix).toUpperCase() : undefined }),
      maxUses: v.maxUses ? Math.floor(v.maxUses) : undefined, customerId: v.customerId || undefined, expiresAt: v.expiresAt ? dayjs(v.expiresAt).endOf('day').toISOString() : undefined, note: v.note || undefined,
    };
    if (mode === 'custom' && !codes.length) { message.warning('Nhập ít nhất một mã'); return; }
    if (mode === 'custom' && codes.some((c) => !/^[A-Z0-9._-]{3,50}$/.test(c))) { message.warning('Mã chỉ gồm chữ, số, dấu . _ - và dài 3–50 ký tự'); return; }
    setSaving(true);
    try {
      const r = await promotionsApi.createVouchers(promotionId, body);
      invalidate(); setIssue(false); setIssued(r.codes);
      message.success(`Đã phát hành ${r.count} mã`);
    } catch (e) { message.error(errMsg(e)); } finally { setSaving(false); }
  };
  const toggle = async (v: Voucher) => {
    try { await promotionsApi.updateVoucher(v.id, { status: v.status === 'DISABLED' ? 'ACTIVE' : 'DISABLED' }); invalidate(); message.success(v.status === 'DISABLED' ? `Đã mở khóa ${v.code}` : `Đã khóa ${v.code}`); } catch (e) { message.error(errMsg(e)); }
  };
  const copy = async (text: string) => { if (await copyText(text)) message.success('Đã sao chép'); else message.error('Không sao chép được'); };

  const statusTag = (v: Voucher) => <Tag color={VOUCHER_STATUS_COLOR[v.status]}>{VOUCHER_STATUS_LABEL[v.status]}</Tag>;
  const actions = (v: Voucher) => (
    <span className="km-vc-actions">
      <Tooltip title="Sao chép mã"><Button size="small" type="text" icon={<CopyOutlined />} onClick={() => copy(v.code)} /></Tooltip>
      {canManage && v.status !== 'USED' && <Button size="small" type="link" danger={v.status === 'ACTIVE'} icon={v.status === 'ACTIVE' ? <LockOutlined /> : <UnlockOutlined />} onClick={() => toggle(v)}>{v.status === 'ACTIVE' ? 'Khóa' : 'Mở khóa'}</Button>}
    </span>
  );

  return (
    <div className="km-vouchers">
      <div className="kv-toolbar">
        <Input.Search className="kv-search" allowClear placeholder="Tìm theo mã" value={searchText} onChange={(e) => setSearchText(e.target.value)} onSearch={(v) => setQ((s) => ({ ...s, search: v || undefined, page: 1 }))} enterButton={<SearchOutlined />} />
        <Select value={q.status ?? ''} onChange={(v) => setQ((s) => ({ ...s, status: v || undefined, page: 1 }))} style={{ width: 140 }} options={[{ value: '', label: 'Tất cả trạng thái' }, { value: 'ACTIVE', label: 'Còn hiệu lực' }, { value: 'USED', label: 'Đã dùng' }, { value: 'DISABLED', label: 'Đã khóa' }]} />
        <span className="spacer" />
        {canManage && <Button type="primary" icon={<PlusOutlined />} onClick={() => setIssue(true)}>Phát hành mã</Button>}
        <Button icon={<ReloadOutlined />} onClick={() => refetch()} loading={isFetching} />
      </div>
      {isMobile ? (
        <div className="km-vc-cards">
          {isLoading && <div className="muted">Đang tải…</div>}
          {!isLoading && !rows.length && <Empty description="Chưa có mã voucher" />}
          {rows.map((v) => (
            <div key={v.id} className="km-vc-card">
              <div className="row"><b className="code">{v.code}</b>{statusTag(v)}</div>
              <div className="kv-hint">Đã dùng {v.usedCount}/{v.maxUses}{v.expiresAt ? ` · HSD ${dt(v.expiresAt, 'DD/MM/YYYY')}` : ''}{v.customerId ? ' · Dành riêng 1 khách' : ''}{v.note ? ` · ${v.note}` : ''}</div>
              <div className="row">{actions(v)}</div>
            </div>
          ))}
          {total > (q.pageSize ?? 20) && <div className="km-pager"><Pagination simple current={q.page} pageSize={q.pageSize} total={total} onChange={(page, pageSize) => setQ((s) => ({ ...s, page, pageSize }))} /></div>}
        </div>
      ) : (
        <Table size="small" rowKey="id" loading={isLoading} dataSource={rows} locale={{ emptyText: <Empty description="Chưa có mã voucher" /> }}
          onChange={(p) => setQ((s) => ({ ...s, page: p.current, pageSize: p.pageSize }))}
          pagination={{ current: q.page, pageSize: q.pageSize, total, showSizeChanger: true, pageSizeOptions: [20, 50, 100], showTotal: (t) => `${t} mã` }}
          columns={[
            { title: 'Mã', dataIndex: 'code', width: 160, render: (v) => <b className="code">{v}</b> },
            { title: 'Trạng thái', width: 120, render: (_, v) => statusTag(v) },
            { title: 'Đã dùng', width: 100, className: 'num', render: (_, v) => `${v.usedCount}/${v.maxUses}` },
            { title: 'Hạn dùng', width: 120, render: (_, v) => v.expiresAt ? dt(v.expiresAt, 'DD/MM/YYYY') : <span className="muted">Không</span> },
            { title: 'Khách hàng', width: 130, render: (_, v) => v.customerId ? <Tag>Dành riêng</Tag> : <span className="muted">Mọi khách</span> },
            { title: 'Ghi chú', dataIndex: 'note', ellipsis: true },
            { title: 'Tạo lúc', dataIndex: 'createdAt', width: 130, render: (v) => dt(v) },
            { title: '', width: 150, render: (_, v) => actions(v) },
          ]} />
      )}

      <Modal title="Phát hành mã voucher" open={issue} onCancel={() => setIssue(false)} onOk={submit} okText="Phát hành" cancelText="Bỏ qua" confirmLoading={saving} destroyOnHidden zIndex={1100}>
        <Form form={form} layout="vertical" size="middle">
          <Radio.Group value={mode} onChange={(e) => setMode(e.target.value)} style={{ marginBottom: 12 }} optionType="button" buttonStyle="solid" options={[{ value: 'auto', label: 'Tự sinh mã' }, { value: 'custom', label: 'Tự đặt mã' }]} />
          {mode === 'auto' ? (
            <div className="km-grid">
              <Form.Item name="count" label="Số lượng mã" rules={[{ required: true, message: 'Nhập số lượng' }]}><InputNumber min={1} max={1000} style={{ width: '100%' }} /></Form.Item>
              <Form.Item name="prefix" label="Tiền tố" tooltip="VD: SALE → SALEA1B2C3D4" rules={[{ pattern: /^[A-Za-z0-9._-]{0,20}$/, message: 'Chữ, số, . _ - (≤ 20 ký tự)' }]}><Input placeholder="Tùy chọn" style={{ textTransform: 'uppercase' }} /></Form.Item>
            </div>
          ) : (
            <Form.Item name="codes" label="Danh sách mã" tooltip="Mỗi mã một dòng hoặc cách nhau bằng dấu phẩy" rules={[{ required: true, message: 'Nhập mã' }]}><Input.TextArea rows={4} placeholder={'SALE30\nTET2026\n…'} style={{ textTransform: 'uppercase' }} /></Form.Item>
          )}
          <div className="km-grid">
            <Form.Item name="maxUses" label="Số lượt dùng / mã" rules={[{ required: true, message: 'Nhập số lượt' }]}><InputNumber min={1} max={100000} style={{ width: '100%' }} /></Form.Item>
            <Form.Item name="expiresAt" label="Hết hạn" tooltip="Bỏ trống = theo thời gian của chương trình"><DatePicker style={{ width: '100%' }} format="DD/MM/YYYY" /></Form.Item>
            <Form.Item name="customerId" label="Dành riêng cho khách" className="span2" tooltip="Chỉ khách này dùng được mã"><CustomerSelect value={undefined} onChange={(id) => form.setFieldValue('customerId', id)} allowCreate={false} placeholder="Mọi khách hàng" /></Form.Item>
            <Form.Item name="note" label="Ghi chú" className="span2"><Input placeholder="VD: tặng khách sinh nhật tháng 11" /></Form.Item>
          </div>
        </Form>
      </Modal>

      <Modal title={`Đã phát hành ${issued?.length ?? 0} mã`} open={!!issued} onCancel={() => setIssued(null)} zIndex={1100} footer={[<Button key="copy" type="primary" icon={<CopyOutlined />} onClick={() => copy((issued ?? []).join('\n'))}>Sao chép tất cả</Button>, <Button key="c" onClick={() => setIssued(null)}>Đóng</Button>]}>
        <div className="km-codes">{(issued ?? []).map((c) => <Tag key={c} className="km-code" onClick={() => copy(c)}>{c}</Tag>)}</div>
        <div className="kv-hint" style={{ marginTop: 8 }}>Chạm vào một mã để sao chép riêng.</div>
      </Modal>
    </div>
  );
}
