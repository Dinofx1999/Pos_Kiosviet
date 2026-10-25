import { Alert, App, Button, Card, Form, Input, InputNumber, Modal, Select, Skeleton, Switch, Tag } from 'antd';
import { ApiOutlined, BankOutlined, CopyOutlined, KeyOutlined, LinkOutlined, QrcodeOutlined, ReadOutlined, SaveOutlined, SwapOutlined } from '@ant-design/icons';
import { useEffect, useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import { useQueryClient } from '@tanstack/react-query';
import { VIETQR_BANKS, sepayQrUrl } from '@erp/shared';
import { bankApi, copyText, useSepayConfig, type BankTxStatus, type SepayConfig, type SepayKey } from '../../api/bankTransfers';
import { useCashAccounts } from '../../api/finance';
import { errMsg } from '../../api/client';
import { useCan } from '../../store/auth';
import { dt, money, qty } from '../../utils/format';

interface FormValues { enabled: boolean; bankCode?: string; accountNumber?: string; accountName?: string; cashAccountId?: string; codePrefix: string; posTtlMinutes: number }

const norm = (s: string) => s.normalize('NFD').replace(/[̀-ͯ]/g, '').replace(/đ/g, 'd').replace(/Đ/g, 'D').toLowerCase();
const BANK_OPTIONS = VIETQR_BANKS.map((b) => ({ value: b.shortName, label: `${b.shortName} – ${b.name}`, search: norm(`${b.shortName} ${b.code} ${b.name}`) }));
const TILES: Array<{ key: BankTxStatus; label: string; tone: 'pos' | 'info' | 'neg' | 'muted' }> = [
  { key: 'MATCHED', label: 'Khớp tự động', tone: 'pos' },
  { key: 'APPLIED', label: 'Gắn tay', tone: 'info' },
  { key: 'UNMATCHED', label: 'Chưa khớp', tone: 'neg' },
  { key: 'IGNORED', label: 'Bỏ qua', tone: 'muted' },
];

/** Tích hợp → "Chuyển khoản tự động (SePay)": tài khoản nhận tiền, khóa webhook, hướng dẫn cấu hình my.sepay.vn, thống kê 30 ngày. */
export function SepayTab() {
  const { message, modal } = App.useApp();
  const qc = useQueryClient();
  const can = useCan();
  const manage = can('integration.manage');
  const { data: cfg, isLoading, error } = useSepayConfig();
  const { data: funds } = useCashAccounts(false, can('cash.view'));
  const bankFunds = useMemo(() => (funds ?? []).filter((f) => f.type === 'BANK' && f.isActive), [funds]);
  const [form] = Form.useForm<FormValues>();
  const [saving, setSaving] = useState(false);
  const [rotating, setRotating] = useState(false);
  const [newKey, setNewKey] = useState<SepayKey | null>(null);

  useEffect(() => {
    if (cfg) form.setFieldsValue({ enabled: cfg.enabled, bankCode: cfg.bankCode ?? undefined, accountNumber: cfg.accountNumber ?? undefined, accountName: cfg.accountName ?? undefined, cashAccountId: cfg.cashAccountId ?? undefined, codePrefix: cfg.codePrefix, posTtlMinutes: cfg.posTtlMinutes });
  }, [cfg]);

  const w = Form.useWatch([], form) as Partial<FormValues> | undefined;
  const prefix = (w?.codePrefix || cfg?.codePrefix || 'BA').toUpperCase();
  const webhookUrl = `${window.location.origin}${cfg?.webhookPath ?? '/api/v1/webhooks/sepay'}`;
  const sampleQr = w?.bankCode && w?.accountNumber && /^[0-9A-Za-z]{4,30}$/.test(w.accountNumber) ? sepayQrUrl({ bankCode: w.bankCode, accountNumber: w.accountNumber, amount: 10000, content: `${prefix}00000000` }) : null;
  const refresh = (v?: SepayConfig) => { if (v) qc.setQueryData(['sepay-config'], v); qc.invalidateQueries({ queryKey: ['sepay-config'] }); qc.removeQueries({ queryKey: ['sepay-off'] }); };

  const copy = async (text: string, what: string) => { if (await copyText(text)) message.success(`Đã sao chép ${what}`); else message.warning('Không sao chép được – hãy chọn và sao chép thủ công'); };

  const save = async () => {
    const v = await form.validateFields();
    setSaving(true);
    try {
      const saved = await bankApi.saveConfig({
        enabled: v.enabled, bankCode: v.bankCode, accountNumber: v.accountNumber?.trim(), accountName: v.accountName?.trim() || undefined,
        cashAccountId: v.cashAccountId ?? null, codePrefix: v.codePrefix.trim().toUpperCase(), posTtlMinutes: v.posTtlMinutes,
      });
      refresh(saved);
      message.success(saved.enabled ? (saved.hasWebhookKey ? 'Đã lưu – nhận tiền tự động đang bật' : 'Đã lưu. Tạo khóa API và khai báo webhook trên SePay để bắt đầu nhận tiền.') : 'Đã lưu – nhận tiền tự động đang tắt');
    } catch (e) { message.error(errMsg(e)); } finally { setSaving(false); }
  };

  const rotate = () => modal.confirm({
    title: cfg?.hasWebhookKey ? 'Tạo khóa API mới?' : 'Tạo khóa API cho webhook?', okText: 'Tạo khóa', cancelText: 'Bỏ qua',
    content: cfg?.hasWebhookKey
      ? <span>Khóa cũ (…{cfg.webhookKeyLast4}) <b>ngừng hoạt động ngay</b>: SePay sẽ bị từ chối cho đến khi bạn dán khóa mới vào webhook trên my.sepay.vn.</span>
      : 'Khóa chỉ hiển thị một lần. Hãy dán ngay vào mục Tích hợp WebHooks trên my.sepay.vn.',
    onOk: async () => {
      setRotating(true);
      try { const k = await bankApi.rotateKey(); setNewKey(k); refresh(); } catch (e) { message.error(errMsg(e)); throw e; } finally { setRotating(false); }
    },
  });

  if (isLoading) return <Skeleton active paragraph={{ rows: 8 }} />;
  if (error || !cfg) return <Alert type="error" showIcon message="Không tải được cấu hình SePay" description={error ? errMsg(error) : undefined} />;

  const status = !cfg.enabled ? <Tag>Đang tắt</Tag> : !cfg.ready ? <Tag color="red">Thiếu thông tin</Tag> : !cfg.hasWebhookKey ? <Tag color="gold">Chưa có khóa API</Tag> : <Tag color="green">Đang hoạt động</Tag>;
  const stat = (k: BankTxStatus) => cfg.stats30d?.[k] ?? { count: 0, amount: '0' };

  return (
    <div className="ig-kv sp-tab">
      <Alert className="ig-hint" type="info" showIcon icon={<QrcodeOutlined />}
        message={<span>Khách quét <b>mã VietQR</b> có sẵn số tiền và mã thanh toán → SePay báo về hệ thống khi tiền vào tài khoản → hóa đơn / phiếu thu được ghi <b>tự động</b>, không cần nhân viên kiểm tra app ngân hàng.</span>} />

      <Card size="small" className="ig-card" title={<span><BankOutlined /> Tài khoản nhận tiền</span>} extra={status}>
        <div className="sp-config">
          <Form form={form} layout="vertical" className="ig-form" disabled={!manage} autoComplete="off" initialValues={{ enabled: false, codePrefix: 'BA', posTtlMinutes: 15 }}>
            <div className="sp-switch">
              <Form.Item name="enabled" valuePropName="checked" noStyle><Switch /></Form.Item>
              <div><b>Bật nhận tiền chuyển khoản tự động</b><div className="kv-hint">Hiện nút “QR chuyển khoản” ở màn Bán hàng, “Thu qua QR” ở hóa đơn còn nợ và “Cọc qua QR” ở đơn đặt hàng.</div></div>
            </div>
            <div className="sp-grid">
              <Form.Item name="bankCode" label="Ngân hàng" className="sp-full" rules={[{ validator: (_, v) => (form.getFieldValue('enabled') && !v ? Promise.reject(new Error('Chọn ngân hàng')) : Promise.resolve()) }]}>
                <Select showSearch allowClear placeholder="Chọn ngân hàng (gõ để tìm: MB, Vietcombank, quân đội…)" options={BANK_OPTIONS} filterOption={(input, o) => !!o && o.search.includes(norm(input))} />
              </Form.Item>
              <Form.Item name="accountNumber" label="Số tài khoản" rules={[{ validator: (_, v) => (form.getFieldValue('enabled') && !v?.trim() ? Promise.reject(new Error('Nhập số tài khoản')) : Promise.resolve()) }, { pattern: /^[0-9A-Za-z]{4,30}$/, message: 'Chỉ gồm chữ / số, 4–30 ký tự, không dấu cách' }]}>
                <Input placeholder="vd: 0123456789" inputMode="numeric" autoCapitalize="none" />
              </Form.Item>
              <Form.Item name="accountName" label="Chủ tài khoản" extra="Viết hoa không dấu, đúng như trên app ngân hàng." rules={[{ max: 120 }]}>
                <Input placeholder="vd: NGUYEN THI BAO AN" style={{ textTransform: 'uppercase' }} />
              </Form.Item>
              <Form.Item name="cashAccountId" label="Quỹ ghi nhận tiền về" className="sp-full"
                extra={<span>Phiếu thu chuyển khoản tự động được ghi vào quỹ này (loại Ngân hàng). Bỏ trống = quỹ ngân hàng mặc định. {can('cash.view') && <Link to="/cash/accounts">Thêm quỹ ngân hàng</Link>}</span>}>
                <Select allowClear placeholder="Quỹ ngân hàng mặc định" options={bankFunds.map((f) => ({ value: f.id, label: `${f.name}${f.accountNumber ? ` · ${f.accountNumber}` : ''}${f.isDefault ? ' (mặc định)' : ''}` }))}
                  notFoundContent={<span className="kv-hint">Chưa có quỹ loại Ngân hàng – tạo ở Sổ quỹ → Quỹ tiền / Tài khoản</span>} />
              </Form.Item>
              <Form.Item name="codePrefix" label="Tiền tố mã thanh toán" extra={<span>Mã in trong nội dung CK: <b>{prefix}</b> + 8 số, vd <code>{prefix}12345678</code>. Phải trùng với cấu hình trên SePay.</span>}
                rules={[{ required: true, message: 'Nhập tiền tố' }, { pattern: /^[A-Za-z]{2,5}$/, message: '2–5 chữ cái, không dấu' }]} normalize={(v: string) => v?.toUpperCase()}>
                <Input maxLength={5} placeholder="BA" style={{ textTransform: 'uppercase' }} />
              </Form.Item>
              <Form.Item name="posTtlMinutes" label="Hiệu lực mã QR tại quầy (phút)" extra="Mã thu nợ hóa đơn / cọc đơn có hiệu lực 7 ngày." rules={[{ required: true, message: 'Nhập số phút' }]}>
                <InputNumber min={2} max={240} precision={0} style={{ width: '100%' }} inputMode="numeric" />
              </Form.Item>
            </div>
          </Form>
          <div className="sp-preview">
            <div className="sp-preview-title">Xem trước mã QR</div>
            {sampleQr ? (
              <>
                <img src={sampleQr} alt="Mã VietQR mẫu" className="sp-preview-img" />
                <div className="kv-hint">Mẫu 10.000đ · nội dung <code>{prefix}00000000</code>. Quét thử bằng app ngân hàng để kiểm tra đúng tên chủ tài khoản (không cần chuyển).</div>
              </>
            ) : <div className="sp-preview-empty"><QrcodeOutlined /><div className="kv-hint">Chọn ngân hàng và nhập số tài khoản để xem mã mẫu.</div></div>}
          </div>
        </div>
        <div className="ig-actions"><Button type="primary" icon={<SaveOutlined />} loading={saving} disabled={!manage} onClick={save}>Lưu cấu hình</Button>{!manage && <span className="kv-hint">Cần quyền “Nhập dữ liệu / cấu hình kết nối” để thay đổi.</span>}</div>
      </Card>

      <Card size="small" className="ig-card" title={<span><ApiOutlined /> Webhook &amp; khóa API</span>} extra={cfg.lastWebhookAt ? <Tag color="green">SePay đã gọi {dt(cfg.lastWebhookAt, 'HH:mm DD/MM')}</Tag> : <Tag>Chưa nhận lần nào</Tag>}>
        <div className="sp-kv">
          <span className="k">URL webhook</span>
          <span className="v sp-url"><code>{webhookUrl}</code><Button size="small" icon={<CopyOutlined />} onClick={() => copy(webhookUrl, 'URL webhook')}>Sao chép</Button></span>
          <span className="k">Khóa API</span>
          <span className="v">{cfg.hasWebhookKey ? <span><Tag color="green">Đã tạo</Tag>kết thúc bằng <code>…{cfg.webhookKeyLast4}</code></span> : <Tag color="red">Chưa có khóa</Tag>}</span>
          <span className="k">Lần cuối SePay gọi</span>
          <span className="v">{cfg.lastWebhookAt ? dt(cfg.lastWebhookAt, 'DD/MM/YYYY HH:mm:ss') : 'Chưa có'}</span>
        </div>
        {window.location.hostname === 'localhost' || window.location.hostname === '127.0.0.1' ? <Alert type="warning" showIcon style={{ marginTop: 10 }} message="Bạn đang mở hệ thống trên máy cục bộ (localhost) – SePay không gọi tới được địa chỉ này. Hãy cấu hình webhook từ tên miền thật của cửa hàng." /> : null}
        <div className="ig-actions" style={{ marginTop: 10 }}>
          <Button type={cfg.hasWebhookKey ? 'default' : 'primary'} icon={<KeyOutlined />} loading={rotating} disabled={!manage} onClick={rotate}>{cfg.hasWebhookKey ? 'Tạo khóa API mới' : 'Tạo khóa API'}</Button>
          {can('cash.view') && <Link to="/cash/bank-transactions"><Button icon={<SwapOutlined />}>Giao dịch chuyển khoản</Button></Link>}
        </div>
      </Card>

      <Card size="small" className="ig-card" title={<span><ReadOutlined /> Cấu hình trên my.sepay.vn (làm một lần)</span>}>
        <ol className="ig-steps-list sp-steps">
          <li>Đăng ký tài khoản tại <a href="https://my.sepay.vn" target="_blank" rel="noreferrer">my.sepay.vn <LinkOutlined /></a> và <b>liên kết tài khoản ngân hàng</b> nhận tiền (đúng số tài khoản đã nhập ở trên).</li>
          <li>Vào <b>Cấu hình công ty → Cấu trúc mã thanh toán</b>: Tiền tố = <code>{prefix}</code>, Hậu tố: <b>8 ký tự</b>, kiểu <b>Chỉ số</b>. Bấm Lưu.</li>
          <li>Vào <b>Tích hợp WebHooks → Thêm webhook</b>: Sự kiện <b>“Có tiền vào”</b>, chọn tài khoản ngân hàng, URL = <code className="sp-break">{webhookUrl}</code>, Kiểu chứng thực <b>“API Key”</b>, dán khóa API vừa tạo ở trên.</li>
          <li>Bật <b>“Gọi lại khi lỗi”</b> (SePay tự gửi lại nếu mạng chập chờn – hệ thống không ghi trùng) rồi Lưu webhook.</li>
          <li>Thử: ở chế độ Test của SePay dùng <b>“Giả lập giao dịch”</b> với nội dung <code>{prefix}00000000</code>, hoặc chuyển thật 2.000đ. Giao dịch hiện ở <Link to="/cash/bank-transactions">Sổ quỹ → Giao dịch chuyển khoản</Link> (mã mẫu không tồn tại nên ở mục “Chưa khớp” – bấm Bỏ qua).</li>
        </ol>
        <div className="kv-hint" style={{ marginTop: 6 }}>Xem thêm: <Link to="/help/sepay-cai-dat">Hướng dẫn cài đặt SePay</Link> · <Link to="/help/thu-tien-qr">Thu tiền bằng mã QR</Link></div>
      </Card>

      <Card size="small" className="ig-card" title="30 ngày gần nhất" extra={can('cash.view') ? <Link to="/cash/bank-transactions">Xem giao dịch</Link> : null}>
        <div className="ig-tiles sp-tiles">
          {TILES.map((t) => {
            const body = <><div className="ig-tile-v">{qty(stat(t.key).count)}</div><div className="ig-tile-l">{t.label}</div><div className="sp-tile-amt">{money(stat(t.key).amount)} đ</div></>;
            return can('cash.view')
              ? <Link key={t.key} to={`/cash/bank-transactions?status=${t.key}`} className={`ig-tile ig-tile-${t.tone} sp-tile`}>{body}</Link>
              : <div key={t.key} className={`ig-tile ig-tile-${t.tone} sp-tile`}>{body}</div>;
          })}
        </div>
      </Card>

      <Modal open={!!newKey} title={<span><KeyOutlined /> Khóa API mới</span>} onCancel={() => setNewKey(null)} maskClosable={false} destroyOnClose
        footer={<div style={{ display: 'flex', gap: 8, justifyContent: 'flex-end', width: '100%' }}><Button icon={<CopyOutlined />} onClick={() => newKey && copy(newKey.apiKey, 'khóa API')}>Sao chép khóa</Button><Button type="primary" onClick={() => setNewKey(null)}>Tôi đã lưu khóa</Button></div>}>
        <Alert type="warning" showIcon message="Khóa chỉ hiển thị MỘT lần" description="Sao chép và dán ngay vào ô API Key của webhook trên my.sepay.vn. Hệ thống chỉ lưu bản mã hóa – không xem lại được; mất khóa thì tạo khóa mới." style={{ marginBottom: 12 }} />
        <div className="sp-key">{newKey?.apiKey}</div>
        <div className="sp-kv" style={{ marginTop: 12 }}>
          <span className="k">Header SePay gửi</span><span className="v"><code className="sp-break">Authorization: Apikey {newKey?.apiKey}</code></span>
          <span className="k">URL webhook</span><span className="v"><code className="sp-break">{webhookUrl}</code></span>
        </div>
      </Modal>
    </div>
  );
}
