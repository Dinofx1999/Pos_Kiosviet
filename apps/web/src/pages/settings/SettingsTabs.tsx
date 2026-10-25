import { App, Button, Card, Checkbox, DatePicker, Divider, Drawer, Form, Input, Modal, Select, Switch, Tag } from 'antd';
import Table from '../../components/ResponsiveTable';
import { DeleteOutlined, EditOutlined, KeyOutlined, PlusOutlined } from '@ant-design/icons';
import dayjs from 'dayjs';
import { useEffect, useState } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { orgApi, useBranches, useRoles, useUsers, useWarehouses } from '../../api/org';
import { errMsg } from '../../api/client';
import { EmployeeProfile, useEmployees } from '../../api/employees';
import type { Role, UserRow } from '../../api/types';
import { MoneyInput } from '../../components/Inputs';
import { useCan, useMe } from '../../store/auth';
import { USER_STATUS_LABEL, dt } from '../../utils/format';

export function UsersTab() {
  const { message, modal } = App.useApp();
  const me = useMe();
  const [q, setQ] = useState<{ page: number; pageSize: number; search?: string; status?: string }>({ page: 1, pageSize: 20 });
  const { data, isLoading } = useUsers(q);
  const { data: branches } = useBranches();
  const [editing, setEditing] = useState<UserRow | null | undefined>(undefined);
  const resetPwd = (u: UserRow) => { let pwd = ''; modal.confirm({ title: `Đặt lại mật khẩu cho ${u.username}`, content: <Input.Password placeholder="Mật khẩu mới (≥ 6 ký tự)" onChange={(e) => (pwd = e.target.value)} />, okText: 'Đặt lại', cancelText: 'Bỏ qua', onOk: async () => { if (pwd.length < 6) { message.warning('Mật khẩu tối thiểu 6 ký tự'); throw new Error(); } try { await orgApi.resetPassword(u.id, pwd); message.success('Đã đặt lại mật khẩu'); } catch (e) { message.error(errMsg(e)); throw e; } } }); };
  return (
    <Card size="small" title="Người dùng" extra={<Button type="primary" size="small" icon={<PlusOutlined />} onClick={() => setEditing(null)}>Thêm người dùng</Button>}>
      <div className="kv-toolbar"><Input.Search allowClear placeholder="Tên đăng nhập, họ tên, email" style={{ width: 300 }} onSearch={(v) => setQ((s) => ({ ...s, page: 1, search: v || undefined }))} /><Select allowClear placeholder="Trạng thái" style={{ width: 160 }} onChange={(v) => setQ((s) => ({ ...s, page: 1, status: v }))} options={Object.entries(USER_STATUS_LABEL).map(([value, label]) => ({ value, label }))} /></div>
      <Table rowKey="id" size="small" loading={isLoading} dataSource={data?.data ?? []} onChange={(p) => setQ((s) => ({ ...s, page: p.current ?? 1, pageSize: p.pageSize ?? 20 }))} pagination={{ current: q.page, pageSize: q.pageSize, total: data?.meta.total ?? 0 }}
        columns={[
          { title: 'Tên đăng nhập', dataIndex: 'username', render: (v, u) => <span><b>{v}</b> {u.isOwner && <Tag color="gold">Chủ gian hàng</Tag>}</span> },
          { title: 'Họ tên', dataIndex: 'fullName' }, { title: 'Email / SĐT', render: (_, u) => [u.email, u.phone].filter(Boolean).join(' · ') || '—' },
          { title: 'Vai trò', render: (_, u) => u.roles.map((r) => <Tag key={r.id}>{r.name}</Tag>) },
          { title: 'Chi nhánh', render: (_, u) => u.allBranches || u.isOwner ? 'Tất cả' : u.branchIds.map((id) => branches?.find((b) => b.id === id)?.name ?? '').join(', ') || <span className="neg">Chưa cấp</span> },
          { title: 'Trạng thái', dataIndex: 'status', width: 120, render: (v) => <Tag color={v === 'ACTIVE' ? 'green' : v === 'LOCKED' ? 'orange' : 'default'}>{USER_STATUS_LABEL[v]}</Tag> },
          { title: 'Đăng nhập cuối', dataIndex: 'lastLoginAt', width: 140, render: (v) => v ? dt(v) : '—' },
          { title: '', width: 90, render: (_, u) => <><Button size="small" type="link" icon={<EditOutlined />} onClick={() => setEditing(u)} />{(!u.isOwner || u.id === me?.user.id) && <Button size="small" type="link" icon={<KeyOutlined />} title="Đặt lại mật khẩu" onClick={() => resetPwd(u)} />}</> },
        ]} />
      <UserFormDrawer editing={editing} onClose={() => setEditing(undefined)} />
    </Card>
  );
}

/**
 * User create / edit drawer including the employee profile (position, hire date, base salary, note – BR-153).
 * Also opened from the employee list. GET /users does not return the profile fields, so they are loaded from
 * /employees (managers) unless the caller passes `profile`.
 */
export function UserFormDrawer({ editing, profile, onClose, onSaved }: { editing: UserRow | null | undefined; profile?: EmployeeProfile; onClose: () => void; onSaved?: (u: UserRow) => void }) {
  const { message } = App.useApp();
  const qc = useQueryClient();
  const me = useMe();
  const can = useCan();
  const canSalary = can('employee.manage');
  const { data: roles } = useRoles();
  const { data: branches } = useBranches();
  const { data: warehouses } = useWarehouses();
  const [form] = Form.useForm();
  const [saving, setSaving] = useState(false);
  const allBranches = Form.useWatch('allBranches', form);
  const emp = useEmployees({ search: editing?.username, pageSize: 10 }, !!editing && !profile && can('attendance.view'));
  const loaded: EmployeeProfile | undefined = profile ?? emp.data?.data.find((e) => e.id === editing?.id);
  const profileKnown = !editing || !!loaded;
  useEffect(() => { if (editing === undefined) return; if (editing) form.setFieldsValue({ ...editing, roleIds: editing.roles.map((r) => r.id) }); else { form.resetFields(); form.setFieldsValue({ allBranches: false, status: 'ACTIVE' }); } }, [editing]);
  useEffect(() => { if (editing && loaded) form.setFieldsValue({ position: loaded.position ?? undefined, hiredAt: loaded.hiredAt ? dayjs(loaded.hiredAt) : undefined, baseSalary: loaded.baseSalary !== undefined && loaded.baseSalary !== null ? Number(loaded.baseSalary) : undefined, employeeNote: loaded.employeeNote ?? undefined }); }, [editing, loaded]);
  const save = async () => {
    const v = await form.validateFields();
    // empty text clears the field when we know the stored profile; otherwise leave it untouched
    const text = (s?: string) => { const t = (s ?? '').trim(); return t ? t : editing && profileKnown ? null : undefined; };
    const body: any = {
      fullName: v.fullName, email: v.email || undefined, phone: v.phone || undefined, roleIds: v.roleIds ?? [], allBranches: !!v.allBranches, branchIds: v.allBranches ? [] : (v.branchIds ?? []), warehouseIds: v.warehouseIds ?? [],
      position: text(v.position), employeeNote: text(v.employeeNote), hiredAt: v.hiredAt ? dayjs(v.hiredAt).format('YYYY-MM-DD') : undefined,
      ...(canSalary ? { baseSalary: v.baseSalary !== undefined && v.baseSalary !== null && v.baseSalary !== '' ? String(v.baseSalary) : editing && profileKnown ? null : undefined } : {}),
    };
    setSaving(true);
    try {
      const saved = editing ? await orgApi.updateUser(editing.id, { ...body, status: v.status }) : await orgApi.createUser({ ...body, username: v.username, password: v.password });
      message.success('Đã lưu người dùng');
      ['users', 'employees', 'me'].forEach((k) => qc.invalidateQueries({ queryKey: [k] }));
      onSaved?.(saved); onClose();
    } catch (e) { message.error(errMsg(e)); } finally { setSaving(false); }
  };
  return (
    <Drawer title={editing ? `Sửa người dùng ${editing.username}` : 'Thêm người dùng'} open={editing !== undefined} onClose={onClose} width={520} destroyOnClose extra={<Button type="primary" onClick={save} loading={saving}>Lưu</Button>}>
      <Form form={form} layout="vertical">
        {!editing && <><Form.Item name="username" label="Tên đăng nhập" rules={[{ required: true, pattern: /^[a-zA-Z0-9._-]{3,100}$/, message: '3-100 ký tự không dấu' }]}><Input /></Form.Item><Form.Item name="password" label="Mật khẩu" rules={[{ required: true, min: 6 }]}><Input.Password /></Form.Item></>}
        <Form.Item name="fullName" label="Họ tên" rules={[{ required: true }]}><Input /></Form.Item>
        <Form.Item name="email" label="Email"><Input type="email" /></Form.Item>
        <Form.Item name="phone" label="Số điện thoại"><Input /></Form.Item>
        <Form.Item name="roleIds" label="Vai trò" rules={[{ required: !editing?.isOwner, message: 'Chọn ít nhất 1 vai trò' }]}><Select mode="multiple" options={(roles ?? []).map((r) => ({ value: r.id, label: r.name }))} /></Form.Item>
        <Form.Item name="allBranches" label="Được thao tác trên tất cả chi nhánh" valuePropName="checked"><Switch disabled={editing?.isOwner} /></Form.Item>
        {!allBranches && !editing?.isOwner && <Form.Item name="branchIds" label="Chi nhánh được phép" rules={[{ required: true, message: 'Chọn chi nhánh hoặc bật tất cả' }]}><Select mode="multiple" options={(branches ?? []).map((b) => ({ value: b.id, label: b.name }))} /></Form.Item>}
        {!editing?.isOwner && <Form.Item name="warehouseIds" label="Giới hạn kho (trống = tất cả kho trong chi nhánh)"><Select mode="multiple" options={(warehouses ?? []).map((w) => ({ value: w.id, label: `${w.name} (${w.branch?.name ?? ''})` }))} /></Form.Item>}
        {editing && <Form.Item name="status" label="Trạng thái"><Select disabled={editing.isOwner || editing.id === me?.user.id} options={Object.entries(USER_STATUS_LABEL).map(([value, label]) => ({ value, label }))} /></Form.Item>}
        <Divider orientation="left" plain style={{ margin: '4px 0 12px' }}>Hồ sơ nhân viên</Divider>
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(200px, 1fr))', columnGap: 12 }}>
          <Form.Item name="position" label="Chức vụ"><Input placeholder="Thu ngân, Quản lý cửa hàng…" maxLength={100} /></Form.Item>
          <Form.Item name="hiredAt" label="Ngày vào làm"><DatePicker style={{ width: '100%' }} format="DD/MM/YYYY" inputReadOnly /></Form.Item>
          {canSalary && <Form.Item name="baseSalary" label="Lương cơ bản (đ/tháng)" tooltip="Chỉ người có quyền quản lý nhân viên xem được"><MoneyInput placeholder="0" /></Form.Item>}
        </div>
        <Form.Item name="employeeNote" label="Ghi chú nhân sự"><Input.TextArea rows={2} maxLength={1000} placeholder="Hợp đồng, ca làm, lưu ý…" /></Form.Item>
        {editing && !profileKnown && !emp.isLoading && <div className="kv-hint">Không tải được hồ sơ nhân viên hiện có (cần quyền xem chấm công) – các ô để trống sẽ giữ nguyên giá trị cũ.</div>}
      </Form>
    </Drawer>
  );
}

export function RolesTab() {
  const { message, modal } = App.useApp();
  const qc = useQueryClient();
  const { data: roles, isLoading } = useRoles();
  const perms = useQuery({ queryKey: ['permissions'], queryFn: orgApi.permissions });
  const [form] = Form.useForm();
  const [editing, setEditing] = useState<Role | null | undefined>(undefined);
  const [selected, setSelected] = useState<string[]>([]);
  useEffect(() => { if (editing === undefined) return; if (editing) { form.setFieldsValue(editing); setSelected(editing.permissions); } else { form.resetFields(); setSelected([]); } }, [editing]);
  const save = async () => {
    const v = await form.validateFields();
    try {
      if (editing) await orgApi.updateRole(editing.id, { name: v.name, description: v.description, ...(editing.isSystem ? {} : { permissions: selected }) });
      else await orgApi.createRole({ code: v.code, name: v.name, description: v.description, permissions: selected });
      message.success('Đã lưu vai trò'); qc.invalidateQueries({ queryKey: ['roles'] }); setEditing(undefined);
    } catch (e) { message.error(errMsg(e)); }
  };
  const remove = (r: Role) => modal.confirm({ title: `Xóa vai trò ${r.name}?`, okText: 'Xóa', okButtonProps: { danger: true }, cancelText: 'Bỏ qua', onOk: async () => { try { await orgApi.deleteRole(r.id); message.success('Đã xóa'); qc.invalidateQueries({ queryKey: ['roles'] }); } catch (e) { message.error(errMsg(e)); } } });
  const toggleGroup = (codes: string[], on: boolean) => setSelected((s) => on ? Array.from(new Set([...s, ...codes])) : s.filter((c) => !codes.includes(c)));
  return (
    <Card size="small" title="Vai trò & phân quyền" extra={<Button type="primary" size="small" icon={<PlusOutlined />} onClick={() => setEditing(null)}>Thêm vai trò</Button>}>
      <Table rowKey="id" size="small" loading={isLoading} dataSource={roles ?? []} pagination={false}
        columns={[{ title: 'Mã', dataIndex: 'code', width: 120 }, { title: 'Tên vai trò', dataIndex: 'name', render: (v, r) => <span>{v} {r.isSystem && <Tag color="blue">Hệ thống</Tag>}</span> }, { title: 'Mô tả', dataIndex: 'description' }, { title: 'Số quyền', width: 90, className: 'num', render: (_, r) => r.permissions.includes('*') ? 'Toàn quyền' : r.permissions.length }, { title: 'Người dùng', dataIndex: 'userCount', width: 100, className: 'num' }, { title: '', width: 90, render: (_, r) => <><Button size="small" type="link" icon={<EditOutlined />} onClick={() => setEditing(r)} />{!r.isSystem && <Button size="small" type="link" danger icon={<DeleteOutlined />} onClick={() => remove(r)} />}</> }]} />
      <Modal title={editing ? `Vai trò ${editing.name}` : 'Thêm vai trò'} open={editing !== undefined} onCancel={() => setEditing(undefined)} onOk={save} okText="Lưu" cancelText="Bỏ qua" width={760} destroyOnClose>
        <Form form={form} layout="vertical">
          <Form.Item name="code" label="Mã vai trò (VIẾT HOA)" rules={[{ required: true, pattern: /^[A-Z0-9_]{2,50}$/, message: 'Chữ hoa, số, _' }]}><Input disabled={!!editing} placeholder="SALES_LEAD" /></Form.Item>
          <Form.Item name="name" label="Tên vai trò" rules={[{ required: true }]}><Input /></Form.Item>
          <Form.Item name="description" label="Mô tả"><Input /></Form.Item>
        </Form>
        {editing?.isSystem ? <Tag color="blue">Vai trò hệ thống có toàn quyền, không chỉnh sửa quyền.</Tag> : (
          <div style={{ maxHeight: 380, overflow: 'auto', border: '1px solid #eee', borderRadius: 4, padding: 8 }}>
            {(perms.data ?? []).map((g) => {
              const codes = g.permissions.map((p) => p.code);
              const all = codes.every((c) => selected.includes(c));
              return (
                <div key={g.group} style={{ marginBottom: 10 }}>
                  <Checkbox checked={all} indeterminate={!all && codes.some((c) => selected.includes(c))} onChange={(e) => toggleGroup(codes, e.target.checked)}><b>{g.group}</b></Checkbox>
                  <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(220px, 1fr))', paddingLeft: 24 }}>
                    {g.permissions.map((p) => <Checkbox key={p.code} checked={selected.includes(p.code)} onChange={(e) => toggleGroup([p.code], e.target.checked)}>{p.label} <span className="kv-hint">({p.code})</span></Checkbox>)}
                  </div>
                </div>
              );
            })}
          </div>
        )}
      </Modal>
    </Card>
  );
}

export function AuditTab() {
  const [q, setQ] = useState<any>({ page: 1, pageSize: 20 });
  const { data, isLoading } = useQuery({ queryKey: ['audit-logs', q], queryFn: () => orgApi.auditLogs(q) });
  const [row, setRow] = useState<any>(null);
  return (
    <Card size="small" title="Nhật ký hệ thống (audit log)">
      <div className="kv-toolbar">
        <Input.Search allowClear placeholder="Mã đối tượng, người dùng, hành động" style={{ width: 300 }} onSearch={(v) => setQ((s: any) => ({ ...s, page: 1, search: v || undefined }))} />
        <Select allowClear placeholder="Loại đối tượng" style={{ width: 180 }} onChange={(v) => setQ((s: any) => ({ ...s, page: 1, entityType: v }))} options={['Product', 'InventoryDocument', 'User', 'Role', 'Branch', 'Warehouse', 'TenantSetting', 'PriceBook', 'ProductCategory', 'Brand', 'StockReservation'].map((v) => ({ value: v, label: v }))} />
        <DatePicker.RangePicker format="DD/MM/YYYY" onChange={(r) => setQ((s: any) => ({ ...s, page: 1, from: r?.[0]?.startOf('day').toISOString(), to: r?.[1]?.endOf('day').toISOString() }))} />
      </div>
      <Table rowKey="id" size="small" loading={isLoading} dataSource={data?.data ?? []} onRow={(r) => ({ onClick: () => setRow(r), style: { cursor: 'pointer' } })} onChange={(p) => setQ((s: any) => ({ ...s, page: p.current, pageSize: p.pageSize }))} pagination={{ current: q.page, pageSize: q.pageSize, total: data?.meta.total ?? 0 }}
        columns={[{ title: 'Thời gian', dataIndex: 'createdAt', width: 150, render: (v) => dt(v, 'DD/MM/YYYY HH:mm:ss') }, { title: 'Người dùng', dataIndex: 'username', width: 120 }, { title: 'Hành động', dataIndex: 'action', width: 220, render: (v) => <code>{v}</code> }, { title: 'Đối tượng', render: (_, r) => `${r.entityType}${r.entityCode ? ` · ${r.entityCode}` : ''}` }, { title: 'IP', dataIndex: 'ip', width: 120 }]} />
      <Drawer title={row ? `${row.action} · ${row.entityCode ?? row.entityId ?? ''}` : ''} open={!!row} onClose={() => setRow(null)} width={640}>
        {row && <>
          <div className="kv-kv" style={{ marginBottom: 12 }}><span className="k">Thời gian</span><span className="v">{dt(row.createdAt, 'DD/MM/YYYY HH:mm:ss')}</span><span className="k">Người dùng</span><span className="v">{row.username ?? '—'}</span><span className="k">IP</span><span className="v">{row.ip ?? '—'}</span></div>
          <b>Trước</b><pre style={{ background: '#f8fafc', padding: 8, maxHeight: 220, overflow: 'auto', fontSize: 12 }}>{JSON.stringify(row.before, null, 2) ?? 'null'}</pre>
          <b>Sau</b><pre style={{ background: '#f8fafc', padding: 8, maxHeight: 220, overflow: 'auto', fontSize: 12 }}>{JSON.stringify(row.after, null, 2) ?? 'null'}</pre>
          {row.metadata && <><b>Thông tin thêm</b><pre style={{ background: '#f8fafc', padding: 8, fontSize: 12 }}>{JSON.stringify(row.metadata, null, 2)}</pre></>}
        </>}
      </Drawer>
    </Card>
  );
}

export function LoginHistoryTab() {
  const [q, setQ] = useState<any>({ page: 1, pageSize: 20 });
  const { data, isLoading } = useQuery({ queryKey: ['login-history', q], queryFn: () => orgApi.loginHistory(q) });
  return (
    <Card size="small" title="Lịch sử đăng nhập">
      <div className="kv-toolbar"><Input.Search allowClear placeholder="Tên đăng nhập" style={{ width: 260 }} onSearch={(v) => setQ((s: any) => ({ ...s, page: 1, search: v || undefined }))} /></div>
      <Table rowKey="id" size="small" loading={isLoading} dataSource={data?.data ?? []} onChange={(p) => setQ((s: any) => ({ ...s, page: p.current, pageSize: p.pageSize }))} pagination={{ current: q.page, pageSize: q.pageSize, total: data?.meta.total ?? 0 }}
        columns={[{ title: 'Thời gian', dataIndex: 'createdAt', width: 150, render: (v) => dt(v, 'DD/MM/YYYY HH:mm:ss') }, { title: 'Tên đăng nhập', dataIndex: 'username', width: 150 }, { title: 'Kết quả', dataIndex: 'success', width: 120, render: (v, r) => v ? <Tag color="green">Thành công</Tag> : <Tag color="red">Thất bại{r.reason ? ` (${r.reason})` : ''}</Tag> }, { title: 'IP', dataIndex: 'ip', width: 130 }, { title: 'Thiết bị', dataIndex: 'userAgent', ellipsis: true }]} />
    </Card>
  );
}
