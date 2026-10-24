import { App, Button, Card, Form, Input, Modal, Typography } from 'antd';
import { LockOutlined, ShopOutlined, UserOutlined } from '@ant-design/icons';
import { useState } from 'react';
import { Navigate, useLocation, useNavigate } from 'react-router-dom';
import { useQueryClient } from '@tanstack/react-query';
import { authApi } from '../../api/auth';
import { errMsg } from '../../api/client';
import { useAuthStore } from '../../store/auth';

export default function LoginPage() {
  const { message } = App.useApp();
  const nav = useNavigate();
  const loc = useLocation() as any;
  const qc = useQueryClient();
  const token = useAuthStore((s) => s.accessToken);
  const setTokens = useAuthStore((s) => s.setTokens);
  const [loading, setLoading] = useState(false);
  const [regOpen, setRegOpen] = useState(false);
  const [regForm] = Form.useForm();
  if (token) return <Navigate to="/" replace />;

  const finish = async (v: any) => {
    setLoading(true);
    try {
      const res = await authApi.login({ tenantCode: v.tenantCode.trim(), username: v.username.trim(), password: v.password });
      setTokens(res.accessToken, res.refreshToken);
      localStorage.setItem('erp-last-tenant', v.tenantCode.trim());
      qc.clear();
      message.success(`Xin chào ${res.user.fullName}`);
      nav(loc.state?.from && loc.state.from !== '/login' ? loc.state.from : '/', { replace: true });
    } catch (e) { message.error(errMsg(e)); } finally { setLoading(false); }
  };

  return (
    <div className="kv-login">
      <Card className="kv-login-card">
        <div style={{ textAlign: 'center', marginBottom: 16 }}>
          <div style={{ width: 48, height: 48, borderRadius: 12, background: '#0070f4', color: '#fff', display: 'inline-flex', alignItems: 'center', justifyContent: 'center', fontSize: 24 }}><ShopOutlined /></div>
          <Typography.Title level={4} style={{ margin: '10px 0 0' }}>Đăng nhập quản lý</Typography.Title>
          <div className="muted">Hệ thống quản lý bán hàng &amp; kho</div>
        </div>
        <Form layout="vertical" onFinish={finish} initialValues={{ tenantCode: localStorage.getItem('erp-last-tenant') ?? '' }} size="large">
          <Form.Item name="tenantCode" label="Mã gian hàng" rules={[{ required: true, message: 'Nhập mã gian hàng' }]}><Input prefix={<ShopOutlined />} placeholder="vd: demo" autoFocus /></Form.Item>
          <Form.Item name="username" label="Tên đăng nhập" rules={[{ required: true, message: 'Nhập tên đăng nhập' }]}><Input prefix={<UserOutlined />} placeholder="admin" /></Form.Item>
          <Form.Item name="password" label="Mật khẩu" rules={[{ required: true, message: 'Nhập mật khẩu' }]}><Input.Password prefix={<LockOutlined />} /></Form.Item>
          <Button type="primary" htmlType="submit" block loading={loading}>Đăng nhập</Button>
        </Form>
        <div style={{ textAlign: 'center', marginTop: 12 }}>Chưa có gian hàng? <Button type="link" style={{ padding: 0 }} onClick={() => setRegOpen(true)}>Đăng ký gian hàng mới</Button></div>
      </Card>
      <Modal title="Đăng ký gian hàng mới" open={regOpen} onCancel={() => setRegOpen(false)} okText="Đăng ký" cancelText="Hủy" destroyOnClose
        onOk={async () => {
          const v = await regForm.validateFields();
          try {
            const res = await authApi.register({ tenantCode: v.tenantCode.trim().toLowerCase(), tenantName: v.tenantName, ownerUsername: v.ownerUsername, ownerPassword: v.ownerPassword, ownerFullName: v.ownerFullName, email: v.email || undefined, phone: v.phone || undefined });
            setTokens(res.accessToken, res.refreshToken);
            localStorage.setItem('erp-last-tenant', v.tenantCode.trim().toLowerCase());
            message.success('Tạo gian hàng thành công');
            setRegOpen(false);
            nav('/', { replace: true });
          } catch (e) { message.error(errMsg(e)); }
        }}>
        <Form form={regForm} layout="vertical">
          <Form.Item name="tenantCode" label="Mã gian hàng (chữ thường, số, dấu -)" rules={[{ required: true, pattern: /^[a-z0-9-]{3,50}$/, message: '3-50 ký tự: a-z, 0-9, -' }]}><Input placeholder="myshop" /></Form.Item>
          <Form.Item name="tenantName" label="Tên cửa hàng" rules={[{ required: true }]}><Input /></Form.Item>
          <Form.Item name="ownerFullName" label="Họ tên chủ cửa hàng" rules={[{ required: true }]}><Input /></Form.Item>
          <Form.Item name="ownerUsername" label="Tên đăng nhập" rules={[{ required: true, pattern: /^[a-zA-Z0-9._-]{3,100}$/, message: '3-100 ký tự không dấu' }]}><Input /></Form.Item>
          <Form.Item name="ownerPassword" label="Mật khẩu" rules={[{ required: true, min: 6 }]}><Input.Password /></Form.Item>
          <Form.Item name="email" label="Email"><Input type="email" /></Form.Item>
          <Form.Item name="phone" label="Số điện thoại"><Input /></Form.Item>
        </Form>
      </Modal>
    </div>
  );
}
