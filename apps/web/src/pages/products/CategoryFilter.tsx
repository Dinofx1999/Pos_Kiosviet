import { App, Button, Input, Modal, Select, Tree, Typography } from 'antd';
import { DeleteOutlined, EditOutlined, PlusOutlined } from '@ant-design/icons';
import { useState } from 'react';
import { catalogApi, useCategories, useInvalidate } from '../../api/catalog';
import type { Category } from '../../api/types';
import { errMsg } from '../../api/client';
import { useCan } from '../../store/auth';

function flatten(list: Category[], depth = 0): { id: string; name: string; depth: number }[] {
  return list.flatMap((c) => [{ id: c.id, name: c.name, depth }, ...flatten(c.children ?? [], depth + 1)]);
}
export const useCategoryOptions = () => {
  const { data } = useCategories();
  return flatten(data ?? []).map((c) => ({ value: c.id, label: `${'— '.repeat(c.depth)}${c.name}` }));
};

export function CategoryFilter({ value, onChange }: { value?: string; onChange: (id?: string) => void }) {
  const { data, isLoading } = useCategories();
  const can = useCan();
  const invalidate = useInvalidate();
  const { message, modal } = App.useApp();
  const [editing, setEditing] = useState<{ id?: string; name: string; parentId?: string } | null>(null);

  const save = async () => {
    if (!editing?.name.trim()) return;
    try {
      if (editing.id) await catalogApi.updateCategory(editing.id, { name: editing.name.trim(), parentId: editing.parentId ?? null });
      else await catalogApi.createCategory({ name: editing.name.trim(), parentId: editing.parentId });
      message.success('Đã lưu nhóm hàng');
      invalidate('categories', 'products');
      setEditing(null);
    } catch (e) { message.error(errMsg(e)); }
  };
  const remove = (c: Category) => modal.confirm({
    title: `Xóa nhóm "${c.name}"?`, okText: 'Xóa', okButtonProps: { danger: true }, cancelText: 'Hủy',
    onOk: async () => { try { await catalogApi.deleteCategory(c.id); invalidate('categories'); if (value === c.id) onChange(undefined); message.success('Đã xóa'); } catch (e) { message.error(errMsg(e)); } },
  });

  const toNode = (c: Category): any => ({
    key: c.id,
    title: (
      <span style={{ display: 'inline-flex', alignItems: 'center' }}>
        <span>{c.name}</span>{c.productCount ? <span className="muted" style={{ marginLeft: 4 }}>({c.productCount})</span> : null}
        {can('category.manage') && (
          <span className="kv-tree-actions" onClick={(e) => e.stopPropagation()}>
            <Button type="text" size="small" icon={<PlusOutlined />} title="Thêm nhóm con" onClick={() => setEditing({ name: '', parentId: c.id })} />
            <Button type="text" size="small" icon={<EditOutlined />} title="Sửa" onClick={() => setEditing({ id: c.id, name: c.name, parentId: c.parentId ?? undefined })} />
            <Button type="text" size="small" danger icon={<DeleteOutlined />} title="Xóa" onClick={() => remove(c)} />
          </span>
        )}
      </span>
    ),
    children: (c.children ?? []).map(toNode),
  });

  return (
    <div>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 4 }}>
        <Typography.Link onClick={() => onChange(undefined)} style={{ fontWeight: value ? 400 : 600 }}>Tất cả</Typography.Link>
        {can('category.manage') && <Button type="link" size="small" icon={<PlusOutlined />} onClick={() => setEditing({ name: '' })}>Thêm nhóm</Button>}
      </div>
      {!isLoading && (data?.length ?? 0) === 0 && <div className="kv-hint">Chưa có nhóm hàng</div>}
      <Tree className="kv-tree" blockNode selectedKeys={value ? [value] : []} treeData={(data ?? []).map(toNode)} defaultExpandAll onSelect={(keys) => onChange(keys[0] as string | undefined)} />
      <Modal title={editing?.id ? 'Sửa nhóm hàng' : 'Thêm nhóm hàng'} open={!!editing} onCancel={() => setEditing(null)} onOk={save} okText="Lưu" cancelText="Bỏ qua" destroyOnClose>
        <Input placeholder="Tên nhóm hàng" value={editing?.name} onChange={(e) => setEditing((s) => s && { ...s, name: e.target.value })} onPressEnter={save} autoFocus style={{ marginBottom: 10 }} />
        <Select allowClear placeholder="Nhóm cha (tùy chọn)" style={{ width: '100%' }} value={editing?.parentId} onChange={(v) => setEditing((s) => s && { ...s, parentId: v })} options={flatten(data ?? []).filter((c) => c.id !== editing?.id).map((c) => ({ value: c.id, label: `${'— '.repeat(c.depth)}${c.name}` }))} />
      </Modal>
    </div>
  );
}
