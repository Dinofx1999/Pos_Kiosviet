import { App, Button, Divider, Form, Input, Modal, Select } from 'antd';
import { PlusOutlined } from '@ant-design/icons';
import { useEffect, useRef, useState } from 'react';
import { purchasingApi } from '../api/purchasing';
import { errMsg } from '../api/client';
import type { Supplier } from '../api/types';
import { MoneyInput } from './Inputs';
import { useCan } from '../store/auth';
import { useQueryClient } from '@tanstack/react-query';

/** Supplier create/edit form (shared by the suppliers page and the quick-create in editors). */
export function SupplierFormModal({ open, supplier, onClose, onSaved }: { open: boolean; supplier?: Supplier | null; onClose: () => void; onSaved: (s: Supplier) => void }) {
  const [form] = Form.useForm();
  const { message } = App.useApp();
  const qc = useQueryClient();
  const [saving, setSaving] = useState(false);
  const isEdit = !!supplier;
  useEffect(() => {
    if (!open) return;
    if (supplier) form.setFieldsValue({ ...supplier, openingBalance: undefined });
    else form.resetFields();
  }, [open, supplier]);
  const submit = async () => {
    const v = await form.validateFields();
    setSaving(true);
    try {
      const body: any = { name: v.name, phone: v.phone || undefined, email: v.email || undefined, address: v.address || undefined, taxCode: v.taxCode || undefined, contactName: v.contactName || undefined, groupName: v.groupName || undefined, note: v.note || undefined };
      const saved = isEdit ? await purchasingApi.updateSupplier(supplier!.id, body) : await purchasingApi.createSupplier({ ...body, code: v.code || undefined, openingBalance: v.openingBalance ? String(v.openingBalance) : undefined });
      message.success(isEdit ? 'Đã cập nhật nhà cung cấp' : `Đã thêm nhà cung cấp ${saved.code}`);
      ['suppliers', 'supplier', 'supplier-groups', 'supplier-debt'].forEach((k) => qc.invalidateQueries({ queryKey: [k] }));
      onSaved(saved);
    } catch (e) { message.error(errMsg(e)); } finally { setSaving(false); }
  };
  return (
    <Modal title={isEdit ? `Cập nhật ${supplier?.code}` : 'Thêm nhà cung cấp'} open={open} onCancel={onClose} onOk={submit} okText="Lưu" cancelText="Bỏ qua" confirmLoading={saving} destroyOnClose width={640}>
      <Form form={form} layout="vertical" size="middle" style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', columnGap: 12 }}>
        <Form.Item name="code" label="Mã nhà cung cấp" tooltip="Bỏ trống để tự sinh (NCC000001)"><Input placeholder="Mã tự động" disabled={isEdit} /></Form.Item>
        <Form.Item name="name" label="Tên nhà cung cấp" rules={[{ required: true, message: 'Nhập tên nhà cung cấp' }]}><Input autoFocus /></Form.Item>
        <Form.Item name="phone" label="Điện thoại"><Input /></Form.Item>
        <Form.Item name="email" label="Email" rules={[{ type: 'email', message: 'Email không hợp lệ' }]}><Input /></Form.Item>
        <Form.Item name="address" label="Địa chỉ" style={{ gridColumn: '1 / span 2' }}><Input /></Form.Item>
        <Form.Item name="taxCode" label="Mã số thuế"><Input /></Form.Item>
        <Form.Item name="contactName" label="Người liên hệ"><Input /></Form.Item>
        <Form.Item name="groupName" label="Nhóm nhà cung cấp"><GroupInput /></Form.Item>
        {!isEdit && <Form.Item name="openingBalance" label="Công nợ đầu kỳ" tooltip="Số tiền đang nợ nhà cung cấp trước khi dùng phần mềm (ghi vào sổ công nợ)"><MoneyInput /></Form.Item>}
        <Form.Item name="note" label="Ghi chú" style={{ gridColumn: '1 / span 2' }}><Input.TextArea rows={2} /></Form.Item>
      </Form>
    </Modal>
  );
}

function GroupInput({ value, onChange }: { value?: string; onChange?: (v: string) => void }) {
  const [groups, setGroups] = useState<string[]>([]);
  useEffect(() => { purchasingApi.supplierGroups().then((g) => setGroups(g.map((x) => x.name).filter(Boolean) as string[])).catch(() => undefined); }, []);
  return <Select mode="tags" maxCount={1} allowClear value={value ? [value] : []} onChange={(v) => onChange?.((v as string[])[0] ?? '')} options={groups.map((g) => ({ value: g, label: g }))} placeholder="Chọn hoặc nhập nhóm mới" />;
}

/** Search select for suppliers with an inline "+ Thêm NCC" quick-create. */
export function SupplierSelect({ value, onChange, disabled, size = 'middle', allowCreate = true, placeholder = 'Tìm nhà cung cấp (mã, tên, điện thoại)' }: { value?: string; onChange: (id: string | undefined, s?: Supplier) => void; disabled?: boolean; size?: 'small' | 'middle' | 'large'; allowCreate?: boolean; placeholder?: string }) {
  const [options, setOptions] = useState<Supplier[]>([]);
  const [open, setOpen] = useState(false);
  const can = useCan();
  const timer = useRef<number>();
  const load = (q?: string) => purchasingApi.suppliers({ search: q || undefined, isActive: 'true', pageSize: 20 }).then((r) => setOptions((prev) => { const list = r.data; const cur = prev.find((p) => p.id === value); return cur && !list.some((x) => x.id === cur.id) ? [cur, ...list] : list; })).catch(() => undefined);
  useEffect(() => { void load(); }, []);
  useEffect(() => { if (value && !options.some((o) => o.id === value)) purchasingApi.supplier(value).then((s) => setOptions((p) => (p.some((x) => x.id === s.id) ? p : [s, ...p]))).catch(() => undefined); }, [value]);
  return (
    <>
      <Select showSearch allowClear size={size} disabled={disabled} value={value} placeholder={placeholder} style={{ width: '100%' }} filterOption={false}
        onSearch={(q) => { window.clearTimeout(timer.current); timer.current = window.setTimeout(() => void load(q), 250); }}
        onChange={(v) => onChange(v, options.find((o) => o.id === v))}
        options={options.map((s) => ({ value: s.id, label: `${s.name} (${s.code}${s.phone ? ` · ${s.phone}` : ''})` }))}
        dropdownRender={(menu) => (<>{menu}{allowCreate && can('supplier.manage') && <><Divider style={{ margin: '6px 0' }} /><Button type="link" icon={<PlusOutlined />} onMouseDown={(e) => e.preventDefault()} onClick={() => setOpen(true)}>Thêm nhà cung cấp</Button></>}</>)}
      />
      <SupplierFormModal open={open} onClose={() => setOpen(false)} onSaved={(s) => { setOptions((p) => [s, ...p]); onChange(s.id, s); setOpen(false); }} />
    </>
  );
}
