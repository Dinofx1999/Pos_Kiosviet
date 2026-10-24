import { App, Form, Input, Modal } from 'antd';
import { authApi } from '../api/auth';
import { errMsg } from '../api/client';

export function ChangePasswordModal({ open, onClose }: { open: boolean; onClose: () => void }) {
  const [form] = Form.useForm();
  const { message } = App.useApp();
  return (
    <Modal title="Đổi mật khẩu" open={open} onCancel={onClose} okText="Lưu" cancelText="Bỏ qua" destroyOnClose
      onOk={async () => {
        const v = await form.validateFields();
        try { await authApi.changePassword({ currentPassword: v.currentPassword, newPassword: v.newPassword }); message.success('Đã đổi mật khẩu'); form.resetFields(); onClose(); } catch (e) { message.error(errMsg(e)); }
      }}>
      <Form form={form} layout="vertical">
        <Form.Item name="currentPassword" label="Mật khẩu hiện tại" rules={[{ required: true }]}><Input.Password /></Form.Item>
        <Form.Item name="newPassword" label="Mật khẩu mới" rules={[{ required: true, min: 6, message: 'Tối thiểu 6 ký tự' }]}><Input.Password /></Form.Item>
        <Form.Item name="confirm" label="Nhập lại mật khẩu mới" dependencies={['newPassword']} rules={[{ required: true }, ({ getFieldValue }) => ({ validator: (_, v) => (v === getFieldValue('newPassword') ? Promise.resolve() : Promise.reject(new Error('Mật khẩu không khớp'))) })]}><Input.Password /></Form.Item>
      </Form>
    </Modal>
  );
}
