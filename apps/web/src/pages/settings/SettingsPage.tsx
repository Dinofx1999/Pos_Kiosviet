import { App, Button, Card, Form, Input, InputNumber, Menu, Modal, Select, Switch, Tag } from 'antd';
import Table from '../../components/ResponsiveTable';
import { EditOutlined, PlusOutlined } from '@ant-design/icons';
import { useEffect, useState } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { orgApi, useBranches, useWarehouses } from '../../api/org';
import { errMsg } from '../../api/client';
import type { Branch, SequenceRow, Warehouse } from '../../api/types';
import { useIsMobile } from '../../hooks/useMedia';
import { useCan } from '../../store/auth';
import { AuditTab, LoginHistoryTab, RolesTab, UsersTab } from './SettingsTabs';
import { LoyaltySettingsTab } from './LoyaltySettingsTab';
import { SubscriptionTab } from './SubscriptionTab';
import './loyalty.css';

const TABS = [
  { key: 'branches', label: 'Chi nhánh', perm: 'branch.manage' },
  { key: 'warehouses', label: 'Kho hàng', perm: 'warehouse.manage' },
  { key: 'users', label: 'Người dùng', perm: 'user.manage' },
  { key: 'roles', label: 'Vai trò & phân quyền', perm: 'role.manage' },
  { key: 'config', label: 'Cấu hình & mã chứng từ', perm: 'tenant.settings.manage' },
  { key: 'loyalty', label: 'Tích điểm', perm: 'tenant.settings.manage' },
  { key: 'subscription', label: 'Gói dịch vụ', perm: 'subscription.view' },
  { key: 'audit', label: 'Nhật ký hệ thống', perm: 'audit.view' },
  { key: 'logins', label: 'Lịch sử đăng nhập', perm: 'audit.view' },
];

export default function SettingsPage() {
  const { tab } = useParams();
  const nav = useNavigate();
  const can = useCan();
  const isMobile = useIsMobile();
  const visible = TABS.filter((t) => can(t.perm));
  const active = visible.find((t) => t.key === tab)?.key ?? visible[0]?.key;
  useEffect(() => { if (!tab && active) nav(`/settings/${active}`, { replace: true }); }, [tab, active]);
  if (!visible.length) return <Card>Bạn không có quyền truy cập thiết lập cửa hàng.</Card>;
  return (
    <div>
      <h1 className="kv-page-title">Thiết lập cửa hàng</h1>
      <div className="kv-settings">
        {isMobile
          ? <div className="lp-settings-chips" role="tablist">{visible.map((t) => <Tag.CheckableTag key={t.key} checked={active === t.key} onChange={() => nav(`/settings/${t.key}`)}>{t.label}</Tag.CheckableTag>)}</div>
          : <Card size="small" className="kv-settings-menu" styles={{ body: { padding: 0 } }}><Menu mode="inline" selectedKeys={active ? [active] : []} items={visible.map((t) => ({ key: t.key, label: t.label }))} onClick={(e) => nav(`/settings/${e.key}`)} style={{ borderInlineEnd: 'none' }} /></Card>}
        <div className="kv-settings-body">
          {active === 'branches' && <BranchesTab />}
          {active === 'warehouses' && <WarehousesTab />}
          {active === 'users' && <UsersTab />}
          {active === 'roles' && <RolesTab />}
          {active === 'config' && <ConfigTab />}
          {active === 'loyalty' && <LoyaltySettingsTab />}
          {active === 'subscription' && <SubscriptionTab />}
          {active === 'audit' && <AuditTab />}
          {active === 'logins' && <LoginHistoryTab />}
        </div>
      </div>
    </div>
  );
}

function BranchesTab() {
  const { message } = App.useApp();
  const qc = useQueryClient();
  const { data, isLoading } = useBranches();
  const [form] = Form.useForm();
  const [editing, setEditing] = useState<Branch | null | undefined>(undefined);
  useEffect(() => { if (editing === undefined) return; if (editing) form.setFieldsValue(editing); else { form.resetFields(); form.setFieldsValue({ createDefaultWarehouse: true, isActive: true }); } }, [editing]);
  const save = async () => {
    const v = await form.validateFields();
    try {
      if (editing) await orgApi.updateBranch(editing.id, { name: v.name, address: v.address, phone: v.phone, email: v.email || undefined, isActive: v.isActive, isDefault: v.isDefault });
      else await orgApi.createBranch({ code: v.code, name: v.name, address: v.address, phone: v.phone, email: v.email || undefined, createDefaultWarehouse: v.createDefaultWarehouse });
      message.success('Đã lưu chi nhánh'); qc.invalidateQueries({ queryKey: ['branches'] }); qc.invalidateQueries({ queryKey: ['me'] }); qc.invalidateQueries({ queryKey: ['warehouses'] }); setEditing(undefined);
    } catch (e) { message.error(errMsg(e)); }
  };
  return (
    <Card size="small" title="Chi nhánh" extra={<Button type="primary" size="small" icon={<PlusOutlined />} onClick={() => setEditing(null)}>Thêm chi nhánh</Button>}>
      <Table rowKey="id" size="small" loading={isLoading} dataSource={data ?? []} pagination={false}
        columns={[{ title: 'Mã', dataIndex: 'code', width: 100 }, { title: 'Tên chi nhánh', dataIndex: 'name', render: (v, b) => <span>{v} {b.isDefault && <Tag color="blue">Mặc định</Tag>}</span> }, { title: 'Địa chỉ', dataIndex: 'address' }, { title: 'Điện thoại', dataIndex: 'phone', width: 120 }, { title: 'Số kho', width: 80, className: 'num', render: (_, b) => b._count?.warehouses }, { title: 'Trạng thái', dataIndex: 'isActive', width: 120, render: (v) => v ? <Tag color="green">Hoạt động</Tag> : <Tag>Ngừng</Tag> }, { title: '', width: 60, render: (_, b) => <Button size="small" type="link" icon={<EditOutlined />} onClick={() => setEditing(b)} /> }]} />
      <Modal title={editing ? 'Sửa chi nhánh' : 'Thêm chi nhánh'} open={editing !== undefined} onCancel={() => setEditing(undefined)} onOk={save} okText="Lưu" cancelText="Bỏ qua" destroyOnClose>
        <Form form={form} layout="vertical">
          <Form.Item name="code" label="Mã chi nhánh" rules={[{ required: true, pattern: /^[A-Za-z0-9_-]{1,50}$/, message: 'Chữ, số, -, _' }]}><Input disabled={!!editing} placeholder="CN02" /></Form.Item>
          <Form.Item name="name" label="Tên chi nhánh" rules={[{ required: true }]}><Input /></Form.Item>
          <Form.Item name="address" label="Địa chỉ"><Input /></Form.Item>
          <Form.Item name="phone" label="Điện thoại"><Input /></Form.Item>
          <Form.Item name="email" label="Email"><Input type="email" /></Form.Item>
          {!editing && <Form.Item name="createDefaultWarehouse" label="Tạo kho mặc định cho chi nhánh" valuePropName="checked"><Switch /></Form.Item>}
          {editing && <><Form.Item name="isDefault" label="Chi nhánh mặc định" valuePropName="checked"><Switch /></Form.Item><Form.Item name="isActive" label="Đang hoạt động" valuePropName="checked"><Switch /></Form.Item></>}
        </Form>
      </Modal>
    </Card>
  );
}

function WarehousesTab() {
  const { message } = App.useApp();
  const qc = useQueryClient();
  const { data: branches } = useBranches();
  const { data, isLoading } = useWarehouses();
  const [form] = Form.useForm();
  const [editing, setEditing] = useState<Warehouse | null | undefined>(undefined);
  useEffect(() => { if (editing === undefined) return; if (editing) form.setFieldsValue(editing); else { form.resetFields(); form.setFieldsValue({ branchId: branches?.[0]?.id }); } }, [editing]);
  const save = async () => {
    const v = await form.validateFields();
    try {
      if (editing) await orgApi.updateWarehouse(editing.id, { name: v.name, address: v.address, isActive: v.isActive, isDefault: v.isDefault });
      else await orgApi.createWarehouse({ branchId: v.branchId, code: v.code, name: v.name, address: v.address });
      message.success('Đã lưu kho'); qc.invalidateQueries({ queryKey: ['warehouses'] }); qc.invalidateQueries({ queryKey: ['me'] }); qc.invalidateQueries({ queryKey: ['branches'] }); setEditing(undefined);
    } catch (e) { message.error(errMsg(e)); }
  };
  return (
    <Card size="small" title="Kho hàng" extra={<Button type="primary" size="small" icon={<PlusOutlined />} onClick={() => setEditing(null)}>Thêm kho</Button>}>
      <Table rowKey="id" size="small" loading={isLoading} dataSource={data ?? []} pagination={false}
        columns={[{ title: 'Mã', dataIndex: 'code', width: 100 }, { title: 'Tên kho', dataIndex: 'name', render: (v, w) => <span>{v} {w.isDefault && <Tag color="blue">Mặc định</Tag>}</span> }, { title: 'Chi nhánh', render: (_, w) => w.branch?.name }, { title: 'Địa chỉ', dataIndex: 'address' }, { title: 'Trạng thái', dataIndex: 'isActive', width: 120, render: (v) => v ? <Tag color="green">Hoạt động</Tag> : <Tag>Ngừng</Tag> }, { title: '', width: 60, render: (_, w) => <Button size="small" type="link" icon={<EditOutlined />} onClick={() => setEditing(w)} /> }]} />
      <Modal title={editing ? 'Sửa kho' : 'Thêm kho'} open={editing !== undefined} onCancel={() => setEditing(undefined)} onOk={save} okText="Lưu" cancelText="Bỏ qua" destroyOnClose>
        <Form form={form} layout="vertical">
          <Form.Item name="branchId" label="Chi nhánh" rules={[{ required: true }]}><Select disabled={!!editing} options={(branches ?? []).map((b) => ({ value: b.id, label: b.name }))} /></Form.Item>
          <Form.Item name="code" label="Mã kho" rules={[{ required: true, pattern: /^[A-Za-z0-9_-]{1,50}$/, message: 'Chữ, số, -, _' }]}><Input disabled={!!editing} placeholder="KHO02" /></Form.Item>
          <Form.Item name="name" label="Tên kho" rules={[{ required: true }]}><Input /></Form.Item>
          <Form.Item name="address" label="Địa chỉ"><Input /></Form.Item>
          {editing && <><Form.Item name="isDefault" label="Kho mặc định của chi nhánh" valuePropName="checked"><Switch /></Form.Item><Form.Item name="isActive" label="Đang hoạt động" valuePropName="checked"><Switch /></Form.Item></>}
        </Form>
      </Modal>
    </Card>
  );
}

const SEQ_LABEL: Record<string, string> = { PRODUCT: 'Mã hàng hóa', INVENTORY_RECEIPT: 'Phiếu nhập kho khác', INVENTORY_ISSUE: 'Phiếu xuất kho / hủy', INVENTORY_ADJUSTMENT: 'Phiếu điều chỉnh tồn', PURCHASE_ORDER: 'Đơn đặt hàng nhập', PURCHASE_RECEIPT: 'Phiếu nhập hàng', SALES_ORDER: 'Đơn đặt hàng', INVOICE: 'Hóa đơn', SALES_RETURN: 'Phiếu trả hàng', TRANSFER: 'Phiếu chuyển hàng', STOCKTAKE: 'Phiếu kiểm kho', CASH_RECEIPT: 'Phiếu thu', CASH_PAYMENT: 'Phiếu chi' };

function ConfigTab() {
  const { message } = App.useApp();
  const qc = useQueryClient();
  const settings = useQuery({ queryKey: ['settings'], queryFn: orgApi.settings });
  const sequences = useQuery({ queryKey: ['sequences'], queryFn: orgApi.sequences });
  const [rows, setRows] = useState<SequenceRow[]>([]);
  useEffect(() => { if (sequences.data) setRows(sequences.data); }, [sequences.data]);
  const setSetting = async (key: string, value: unknown) => { try { await orgApi.updateSettings({ [key]: value }); message.success('Đã lưu cấu hình'); qc.invalidateQueries({ queryKey: ['settings'] }); qc.invalidateQueries({ queryKey: ['me'] }); } catch (e) { message.error(errMsg(e)); } };
  const saveSeq = async () => { try { await orgApi.updateSequences(rows.map(({ nextNumber: _n, ...r }) => r)); message.success('Đã lưu mã chứng từ'); qc.invalidateQueries({ queryKey: ['sequences'] }); } catch (e) { message.error(errMsg(e)); } };
  const s = settings.data ?? {};
  return (
    <>
      <Card size="small" title="Chính sách tồn kho & giá" loading={settings.isLoading}>
        <div className="kv-kv kv-kv-wide" style={{ rowGap: 12 }}>
          <span className="k">Cho phép bán / xuất âm kho</span><span><Switch checked={s['inventory.allowNegativeStock'] === true} onChange={(v) => setSetting('inventory.allowNegativeStock', v)} /> <span className="kv-hint">Tắt = từ chối phiếu xuất/bán khi không đủ tồn (khuyến nghị)</span></span>
          <span className="k">Phương pháp tính giá vốn</span><span>Bình quân gia quyền di động (AVG) <span className="kv-hint">– theo toàn gian hàng</span></span>
          <span className="k">Giá bán đã bao gồm thuế</span><span><Switch checked={s['pricing.priceIncludesTax'] !== false} onChange={(v) => setSetting('pricing.priceIncludesTax', v)} /> <span className="kv-hint">Bật = thuế được tách ra từ giá bán; tắt = thuế cộng thêm vào hóa đơn</span></span>
          <span className="k">Thuế mua hàng tính vào giá vốn</span><span><Switch checked={s['purchasing.includeTaxInCost'] !== false} onChange={(v) => setSetting('purchasing.includeTaxInCost', v)} /> <span className="kv-hint">Tắt nếu doanh nghiệp khấu trừ VAT đầu vào</span></span>
          <span className="k">Bắt buộc mở ca trước khi bán</span><span><Switch checked={s['pos.requireOpenShift'] === true} onChange={(v) => setSetting('pos.requireOpenShift', v)} /> <span className="kv-hint">Thu ngân phải mở ca bán hàng mới thanh toán được</span></span>
          <span className="k">Trần giảm giá tại quầy (%)</span><span><InputNumber size="small" min={0} max={100} style={{ width: 100 }} value={typeof s['pos.maxDiscountPercent'] === 'number' ? (s['pos.maxDiscountPercent'] as number) : 100} onChange={(v) => { if (v !== null && v !== undefined) void setSetting('pos.maxDiscountPercent', Number(v)); }} /> <span className="kv-hint">Giảm giá dòng / hóa đơn không vượt quá tỷ lệ này (100 = không giới hạn)</span></span>
          <span className="k">Cho phép bán nợ (khách trả sau)</span><span><Switch checked={s['pos.allowCreditSales'] !== false} onChange={(v) => setSetting('pos.allowCreditSales', v)} /> <span className="kv-hint">Tắt = hóa đơn phải thanh toán đủ tại quầy</span></span>
          <span className="k">Đơn vị tiền tệ</span><span><Select size="small" style={{ width: 120 }} value={(s['general.currency'] as string) ?? 'VND'} onChange={(v) => setSetting('general.currency', v)} options={[{ value: 'VND', label: 'VND' }, { value: 'USD', label: 'USD' }]} /></span>
        </div>
      </Card>
      <Card size="small" title="Cấu hình mã chứng từ" style={{ marginTop: 12 }} loading={sequences.isLoading} extra={<Button type="primary" size="small" onClick={saveSeq}>Lưu</Button>}>
        <Table rowKey="docType" size="small" pagination={false} dataSource={rows}
          columns={[
            { title: 'Loại chứng từ', dataIndex: 'docType', render: (v) => SEQ_LABEL[v] ?? v },
            { title: 'Tiền tố', width: 120, render: (_, r, i) => <Input size="small" value={r.prefix} maxLength={10} onChange={(e) => setRows((rs) => rs.map((x, j) => (j === i ? { ...x, prefix: e.target.value.toUpperCase() } : x)))} /> },
            { title: 'Số chữ số', width: 110, render: (_, r, i) => <Input size="small" type="number" min={1} max={10} value={r.padding} onChange={(e) => setRows((rs) => rs.map((x, j) => (j === i ? { ...x, padding: Number(e.target.value) || 1 } : x)))} /> },
            { title: 'Đặt lại số', width: 150, render: (_, r, i) => <Select size="small" style={{ width: '100%' }} value={r.resetPolicy} onChange={(v) => setRows((rs) => rs.map((x, j) => (j === i ? { ...x, resetPolicy: v } : x)))} options={[{ value: 'NEVER', label: 'Không' }, { value: 'YEARLY', label: 'Hàng năm' }, { value: 'MONTHLY', label: 'Hàng tháng' }]} /> },
            { title: 'Số kế tiếp', dataIndex: 'nextNumber', width: 100, className: 'num' },
            { title: 'Ví dụ', width: 160, render: (_, r) => <code>{r.prefix}{r.resetPolicy === 'YEARLY' ? `${new Date().getFullYear()}-` : r.resetPolicy === 'MONTHLY' ? `${new Date().getFullYear()}${String(new Date().getMonth() + 1).padStart(2, '0')}-` : ''}{String(r.nextNumber).padStart(r.padding, '0')}</code> },
          ]} />
      </Card>
    </>
  );
}
