import { App, Button, DatePicker, Divider, Form, Input, Modal, Select, Switch } from 'antd';
import { PlusOutlined } from '@ant-design/icons';
import dayjs from 'dayjs';
import { useEffect, useRef, useState } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import { salesApi } from '../api/sales';
import { errMsg } from '../api/client';
import type { Customer, CustomerHit } from '../api/types';
import { useCan } from '../store/auth';
import { money } from '../utils/format';
import { MoneyInput } from './Inputs';

/** Customer create/edit form (customers page + quick-create at the POS). */
export function CustomerFormModal({ open, customer, onClose, onSaved, initialName }: { open: boolean; customer?: Customer | null; onClose: () => void; onSaved: (c: Customer) => void; initialName?: string }) {
  const [form] = Form.useForm();
  const { message } = App.useApp();
  const qc = useQueryClient();
  const can = useCan();
  const [saving, setSaving] = useState(false);
  const isEdit = !!customer;
  // destroyOnClose unmounts the form while the modal animates in → (re)apply values once the form is mounted as well
  const applyValues = () => {
    if (customer) form.setFieldsValue({ ...customer, birthday: customer.birthday ? dayjs(customer.birthday) : undefined, creditLimit: customer.creditLimit ? Number(customer.creditLimit) : undefined, openingBalance: undefined });
    else { form.resetFields(); form.setFieldsValue({ name: initialName, isActive: true }); }
  };
  useEffect(() => { if (open) applyValues(); }, [open, customer, initialName]);
  const submit = async () => {
    const v = await form.validateFields();
    setSaving(true);
    try {
      const body: any = { name: v.name, phone: v.phone || undefined, email: v.email || undefined, address: v.address || undefined, gender: v.gender || undefined, birthday: v.birthday ? dayjs(v.birthday).format('YYYY-MM-DD') : undefined, taxCode: v.taxCode || undefined, groupName: v.groupName || undefined, note: v.note || undefined };
      const saved = isEdit
        ? await salesApi.updateCustomer(customer!.id, { ...body, creditLimit: v.creditLimit === undefined || v.creditLimit === null || v.creditLimit === '' ? null : String(v.creditLimit), isActive: v.isActive })
        : await salesApi.createCustomer({ ...body, code: v.code || undefined, creditLimit: v.creditLimit ? String(v.creditLimit) : undefined, openingBalance: v.openingBalance ? String(v.openingBalance) : undefined });
      message.success(isEdit ? 'Đã cập nhật khách hàng' : `Đã thêm khách hàng ${saved.code}`);
      ['customers', 'customer', 'customer-groups', 'customer-debt'].forEach((k) => qc.invalidateQueries({ queryKey: [k] }));
      onSaved(saved);
    } catch (e) { message.error(errMsg(e)); } finally { setSaving(false); }
  };
  return (
    <Modal title={isEdit ? `Cập nhật ${customer?.code}` : 'Thêm khách hàng'} open={open} onCancel={onClose} onOk={submit} okText="Lưu" cancelText="Bỏ qua" confirmLoading={saving} destroyOnClose width={680} zIndex={1200} afterOpenChange={(v) => { if (v) applyValues(); }}>
      <Form form={form} layout="vertical" size="middle" key={`${open}-${customer?.id ?? 'new'}-${initialName ?? ''}`} style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', columnGap: 12 }}>
        <Form.Item name="code" label="Mã khách hàng" tooltip="Bỏ trống để tự sinh (KH000001)"><Input placeholder="Mã tự động" disabled={isEdit} /></Form.Item>
        <Form.Item name="name" label="Tên khách hàng" rules={[{ required: true, message: 'Nhập tên khách hàng' }]} initialValue={isEdit ? undefined : initialName}><Input autoFocus /></Form.Item>
        <Form.Item name="phone" label="Điện thoại"><Input /></Form.Item>
        <Form.Item name="email" label="Email" rules={[{ type: 'email', message: 'Email không hợp lệ' }]}><Input /></Form.Item>
        <Form.Item name="address" label="Địa chỉ" style={{ gridColumn: '1 / span 2' }}><Input /></Form.Item>
        <Form.Item name="gender" label="Giới tính"><Select allowClear options={[{ value: 'MALE', label: 'Nam' }, { value: 'FEMALE', label: 'Nữ' }, { value: 'OTHER', label: 'Khác' }]} /></Form.Item>
        <Form.Item name="birthday" label="Sinh nhật"><DatePicker style={{ width: '100%' }} format="DD/MM/YYYY" /></Form.Item>
        <Form.Item name="taxCode" label="Mã số thuế"><Input /></Form.Item>
        <Form.Item name="groupName" label="Nhóm khách hàng"><GroupInput /></Form.Item>
        <Form.Item name="creditLimit" label="Hạn mức nợ" tooltip="Bỏ trống = không giới hạn"><MoneyInput placeholder="Không giới hạn" /></Form.Item>
        {!isEdit && can('customer.debt.view') && <Form.Item name="openingBalance" label="Công nợ đầu kỳ" tooltip="Số tiền khách đang nợ trước khi dùng phần mềm"><MoneyInput /></Form.Item>}
        {isEdit && <Form.Item name="isActive" label="Đang giao dịch" valuePropName="checked"><Switch /></Form.Item>}
        <Form.Item name="note" label="Ghi chú" style={{ gridColumn: '1 / span 2' }}><Input.TextArea rows={2} /></Form.Item>
      </Form>
    </Modal>
  );
}

function GroupInput({ value, onChange }: { value?: string; onChange?: (v: string) => void }) {
  const [groups, setGroups] = useState<string[]>([]);
  useEffect(() => { salesApi.customerGroups().then((g) => setGroups(g.map((x) => x.name).filter(Boolean) as string[])).catch(() => undefined); }, []);
  return <Select mode="tags" maxCount={1} allowClear value={value ? [value] : []} onChange={(v) => onChange?.((v as string[])[0] ?? '')} options={groups.map((g) => ({ value: g, label: g }))} placeholder="Chọn hoặc nhập nhóm mới" />;
}

/** Search select for customers (phone / name / code) with an inline "+ Thêm khách" quick-create. */
export function CustomerSelect({ value, onChange, disabled, size = 'middle', allowCreate = true, placeholder = 'Tìm khách hàng (SĐT, tên, mã)', autoFocus }: { value?: string; onChange: (id: string | undefined, c?: CustomerHit) => void; disabled?: boolean; size?: 'small' | 'middle' | 'large'; allowCreate?: boolean; placeholder?: string; autoFocus?: boolean }) {
  const [options, setOptions] = useState<CustomerHit[]>([]);
  const [open, setOpen] = useState(false);
  const [typed, setTyped] = useState('');
  // the Select clears its search text (onSearch('')) when it loses focus to the modal → keep the value captured at click time
  const [createName, setCreateName] = useState('');
  const can = useCan();
  const timer = useRef<number>();
  const load = (q?: string) => (q?.trim() ? salesApi.customerSearch(q) : salesApi.customers({ isActive: 'true', pageSize: 20 }).then((r) => r.data as unknown as CustomerHit[]))
    .then((list) => setOptions((prev) => { const cur = prev.find((p) => p.id === value); return cur && !list.some((x) => x.id === cur.id) ? [cur, ...list] : list; })).catch(() => undefined);
  useEffect(() => { void load(); }, []);
  useEffect(() => { if (value && !options.some((o) => o.id === value)) salesApi.customer(value).then((c) => setOptions((p) => (p.some((x) => x.id === c.id) ? p : [{ id: c.id, code: c.code, name: c.name, phone: c.phone, groupName: c.groupName, creditLimit: c.creditLimit, balance: c.balance }, ...p]))).catch(() => undefined); }, [value]);
  return (
    <>
      <Select showSearch allowClear size={size} disabled={disabled} value={value} placeholder={placeholder} style={{ width: '100%' }} filterOption={false} autoFocus={autoFocus}
        onSearch={(q) => { setTyped(q); window.clearTimeout(timer.current); timer.current = window.setTimeout(() => void load(q), 250); }}
        onChange={(v) => onChange(v, options.find((o) => o.id === v))}
        optionLabelProp="label"
        options={options.map((c) => ({ value: c.id, label: `${c.name}${c.phone ? ` · ${c.phone}` : ''}`, title: c.code, data: c }))}
        optionRender={(o) => { const c = (o.data as any).data as CustomerHit; return <div style={{ display: 'flex', justifyContent: 'space-between', gap: 8 }}><span>{c.name} <span className="muted">· {c.phone || c.code}</span></span>{c.balance !== undefined && Number(c.balance) !== 0 && <span className={Number(c.balance) > 0 ? 'neg' : 'pos'}>Nợ {money(c.balance)}</span>}</div>; }}
        dropdownRender={(menu) => (<>{menu}{allowCreate && can('customer.manage') && <><Divider style={{ margin: '6px 0' }} /><Button type="link" icon={<PlusOutlined />} onMouseDown={(e) => e.preventDefault()} onClick={() => { setCreateName(typed); setOpen(true); }}>Thêm khách hàng{typed ? ` "${typed}"` : ''}</Button></>}</>)}
      />
      <CustomerFormModal open={open} initialName={createName} onClose={() => setOpen(false)} onSaved={(c) => { const hit: CustomerHit = { id: c.id, code: c.code, name: c.name, phone: c.phone, groupName: c.groupName, creditLimit: c.creditLimit, balance: c.balance }; setOptions((p) => [hit, ...p]); onChange(c.id, hit); setOpen(false); }} />
    </>
  );
}
