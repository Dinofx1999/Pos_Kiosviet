import { Alert, App, Button, Empty, Form, Input, Modal, Select, Skeleton, Switch, Tabs, Tag } from 'antd';
import Table from '../../components/ResponsiveTable';
import { AuditOutlined, BankOutlined, BookOutlined, CheckCircleOutlined, EditOutlined, PlusOutlined, ReloadOutlined, StarFilled, StarOutlined, StopOutlined, WalletOutlined } from '@ant-design/icons';
import { useEffect, useMemo, useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { useQueryClient } from '@tanstack/react-query';
import { CASH_ACCOUNT_TYPE_COLOR, CASH_ACCOUNT_TYPE_LABEL, CashAccount, CashAccountType, FINANCE_KEYS, PaymentCategory, PaymentDirection, financeApi, useCashAccount, useCashAccounts, useCashCategories, useReconciliations } from '../../api/finance';
import { errMsg } from '../../api/client';
import { MoneyInput } from '../../components/Inputs';
import { useIsMobile } from '../../hooks/useMedia';
import { useAuthStore, useCan } from '../../store/auth';
import { dt, money, toNum } from '../../utils/format';
import './finance.css';

const TYPE_ICON: Record<CashAccountType, React.ReactNode> = { CASH: <WalletOutlined />, BANK: <BankOutlined />, EWALLET: <AuditOutlined /> };

export default function CashAccountsPage() {
  const [tab, setTab] = useState('funds');
  return (
    <div className="cb-page">
      <h1 className="kv-page-title">Quỹ tiền / Tài khoản</h1>
      <Tabs className="cb-tabs" activeKey={tab} onChange={setTab} items={[
        { key: 'funds', label: 'Quỹ tiền', children: <FundsTab /> },
        { key: 'cats', label: 'Loại thu / chi', children: <CategoriesTab /> },
      ]} />
    </div>
  );
}

// ---------------------------------------------------------------- funds
function FundsTab() {
  const can = useCan();
  const qc = useQueryClient();
  const navigate = useNavigate();
  const { message, modal } = App.useApp();
  const [showInactive, setShowInactive] = useState(false);
  const { data, isLoading, isFetching, error, refetch } = useCashAccounts(showInactive);
  const [form, setForm] = useState<{ open: boolean; account?: CashAccount | null }>({ open: false });
  const [recon, setRecon] = useState<{ open: boolean; account?: CashAccount }>({ open: false });
  const canManage = can('cash.account.manage');
  const invalidate = () => FINANCE_KEYS.forEach((k) => qc.invalidateQueries({ queryKey: [k] }));
  const list = data ?? [];
  const totals = useMemo(() => list.filter((a) => a.isActive).reduce((acc, a) => { acc[a.type] = (acc[a.type] ?? 0) + toNum(a.balance); acc.ALL += toNum(a.balance); return acc; }, { ALL: 0 } as Record<string, number>), [list]);

  const toggle = (a: CashAccount) => modal.confirm({
    title: a.isActive ? `Ngừng sử dụng quỹ ${a.name}?` : `Kích hoạt lại quỹ ${a.name}?`,
    content: a.isActive ? (toNum(a.balance) !== 0 ? <span>Quỹ còn số dư <b>{money(a.balance)}</b> – cần <Link to="/cash/transfers">chuyển quỹ</Link> hết số dư trước khi ngừng.</span> : 'Quỹ ngừng sẽ không xuất hiện khi lập phiếu; lịch sử vẫn được giữ.') : 'Quỹ sẽ dùng lại được khi lập phiếu thu / chi.',
    okText: a.isActive ? 'Ngừng sử dụng' : 'Kích hoạt', okButtonProps: { danger: a.isActive }, cancelText: 'Bỏ qua',
    onOk: async () => { try { await financeApi.updateAccount(a.id, { isActive: !a.isActive }); message.success('Đã cập nhật'); invalidate(); } catch (e) { message.error(errMsg(e)); throw e; } },
  });
  const setDefault = async (a: CashAccount) => { try { await financeApi.updateAccount(a.id, { isDefault: true }); message.success(`${a.name} là quỹ ${CASH_ACCOUNT_TYPE_LABEL[a.type].toLowerCase()} mặc định${a.branch ? ` của ${a.branch.name}` : ''}`); invalidate(); } catch (e) { message.error(errMsg(e)); } };

  return (
    <div>
      <div className="cb-toolbar">
        <span className="cb-hint" style={{ display: 'inline-flex', alignItems: 'center', gap: 6 }}><Switch size="small" checked={showInactive} onChange={setShowInactive} /> Hiện quỹ ngừng sử dụng</span>
        <span className="cb-spacer" />
        {canManage && <Button type="primary" icon={<PlusOutlined />} onClick={() => setForm({ open: true, account: null })}>Thêm quỹ</Button>}
        <Button icon={<ReloadOutlined />} onClick={() => refetch()} loading={isFetching} />
      </div>
      {error && <Alert type="error" showIcon message={errMsg(error)} style={{ marginBottom: 10 }} />}
      {!isLoading && list.length > 0 && (
        <div className="cb-stats">
          <div className="cb-stat bal"><div className="lbl">Tổng tồn quỹ</div><div className="val">{money(totals.ALL)}</div><div className="sub">{list.filter((a) => a.isActive).length} quỹ đang dùng</div></div>
          {(['CASH', 'BANK', 'EWALLET'] as CashAccountType[]).map((t) => <div key={t} className="cb-stat"><div className="lbl">{CASH_ACCOUNT_TYPE_LABEL[t]}</div><div className="val">{money(totals[t] ?? 0)}</div><div className="sub">{list.filter((a) => a.isActive && a.type === t).length} quỹ</div></div>)}
        </div>
      )}
      {isLoading ? <Skeleton active /> : list.length === 0 ? <Empty className="cb-empty" description="Chưa có quỹ tiền">{canManage && <Button type="primary" onClick={() => setForm({ open: true, account: null })}>Thêm quỹ đầu tiên</Button>}</Empty> : (
        <div className="cb-fund-grid">
          {list.map((a) => (
            <div key={a.id} className={`cb-fund${a.isActive ? '' : ' inactive'}`}>
              <div className="head">
                <div style={{ minWidth: 0 }}>
                  <div className="name">{TYPE_ICON[a.type]} {a.name} {a.isDefault && <Tag color="gold" icon={<StarFilled />} style={{ marginInlineStart: 4 }}>Mặc định</Tag>}{!a.isActive && <Tag>Ngừng sử dụng</Tag>}</div>
                  <div className="code">{a.code} · <Tag color={CASH_ACCOUNT_TYPE_COLOR[a.type]} style={{ marginInlineEnd: 0 }}>{CASH_ACCOUNT_TYPE_LABEL[a.type]}</Tag></div>
                </div>
                <div className="balance">{money(a.balance)}</div>
              </div>
              <div className="meta">
                <span>{a.branch ? a.branch.name : 'Dùng chung toàn hệ thống'}</span>
                {a.bankName && <span>· {a.bankName}{a.accountNumber ? ` ${a.accountNumber}` : ''}{a.accountHolder ? ` (${a.accountHolder})` : ''}</span>}
                {toNum(a.openingBalance) !== 0 && <span>· Đầu kỳ {money(a.openingBalance)}</span>}
              </div>
              <div className="actions">
                <Button icon={<BookOutlined />} onClick={() => navigate(`/cash?accountId=${a.id}`)}>Xem sổ quỹ</Button>
                {can('cash.reconcile') && a.isActive && <Button icon={<CheckCircleOutlined />} onClick={() => setRecon({ open: true, account: a })}>Kiểm quỹ</Button>}
                {canManage && <Button icon={<EditOutlined />} onClick={() => setForm({ open: true, account: a })}>Sửa</Button>}
                {canManage && a.isActive && !a.isDefault && <Button icon={<StarOutlined />} onClick={() => setDefault(a)}>Đặt mặc định</Button>}
                {canManage && <Button danger={a.isActive} icon={a.isActive ? <StopOutlined /> : <CheckCircleOutlined />} onClick={() => toggle(a)}>{a.isActive ? 'Ngừng sử dụng' : 'Kích hoạt'}</Button>}
              </div>
            </div>
          ))}
        </div>
      )}
      <AccountFormModal open={form.open} account={form.account} onClose={() => setForm({ open: false })} />
      <ReconcileModal open={recon.open} account={recon.account} onClose={() => setRecon({ open: false })} />
    </div>
  );
}

function AccountFormModal({ open, account, onClose }: { open: boolean; account?: CashAccount | null; onClose: () => void }) {
  const [form] = Form.useForm();
  const { message } = App.useApp();
  const qc = useQueryClient();
  const me = useAuthStore((s) => s.me);
  const branchId = useAuthStore((s) => s.currentBranchId);
  const [saving, setSaving] = useState(false);
  const isEdit = !!account;
  const type = Form.useWatch('type', form) as CashAccountType | undefined;
  const apply = () => {
    if (account) form.setFieldsValue({ code: account.code, name: account.name, type: account.type, branchId: account.branchId ?? '', bankName: account.bankName ?? undefined, accountNumber: account.accountNumber ?? undefined, accountHolder: account.accountHolder ?? undefined, isDefault: account.isDefault });
    else { form.resetFields(); form.setFieldsValue({ type: 'CASH', branchId: branchId ?? '', isDefault: false }); }
  };
  useEffect(() => { if (open) apply(); }, [open, account]);
  const submit = async () => {
    const v = await form.validateFields();
    setSaving(true);
    try {
      const bank = v.type === 'CASH' ? {} : { bankName: v.bankName || undefined, accountNumber: v.accountNumber || undefined, accountHolder: v.accountHolder || undefined };
      if (isEdit) { await financeApi.updateAccount(account!.id, { name: v.name, ...bank, isDefault: !!v.isDefault }); message.success('Đã cập nhật quỹ'); }
      else { const a = await financeApi.createAccount({ code: v.code || undefined, name: v.name, type: v.type, branchId: v.branchId || undefined, ...bank, openingBalance: v.openingBalance ? String(v.openingBalance) : undefined, isDefault: !!v.isDefault }); message.success(`Đã tạo quỹ ${a.code}`); }
      FINANCE_KEYS.forEach((k) => qc.invalidateQueries({ queryKey: [k] }));
      onClose();
    } catch (e) { message.error(errMsg(e)); } finally { setSaving(false); }
  };
  const isBank = type === 'BANK' || type === 'EWALLET';
  return (
    <Modal title={isEdit ? `Cập nhật quỹ ${account?.code}` : 'Thêm quỹ tiền / tài khoản'} open={open} onCancel={onClose} onOk={submit} okText="Lưu" cancelText="Bỏ qua" confirmLoading={saving} destroyOnClose width={600} afterOpenChange={(v) => { if (v) apply(); }}>
      <Form form={form} layout="vertical" className="cb-form" key={`${open}-${account?.id ?? 'new'}`}>
        <Form.Item name="type" label="Loại quỹ" rules={[{ required: true }]}><Select disabled={isEdit} options={(['CASH', 'BANK', 'EWALLET'] as CashAccountType[]).map((t) => ({ value: t, label: <span>{TYPE_ICON[t]} {CASH_ACCOUNT_TYPE_LABEL[t]}</span> }))} /></Form.Item>
        <Form.Item name="branchId" label="Chi nhánh" tooltip="Quỹ của một chi nhánh (két tại quầy) hoặc dùng chung toàn hệ thống (két sắt, tài khoản ngân hàng công ty)"><Select disabled={isEdit} options={[{ value: '', label: 'Dùng chung toàn hệ thống' }, ...(me?.branches ?? []).map((b) => ({ value: b.id, label: b.name }))]} /></Form.Item>
        <Form.Item name="code" label="Mã quỹ" tooltip="Bỏ trống để tự sinh (QT000001)"><Input placeholder="Mã tự động" disabled={isEdit} /></Form.Item>
        <Form.Item name="name" label="Tên quỹ" rules={[{ required: true, message: 'Nhập tên quỹ' }]}><Input autoFocus placeholder={type === 'BANK' ? 'VD: Vietcombank – TK công ty' : type === 'EWALLET' ? 'VD: Ví MoMo cửa hàng' : 'VD: Két tiền mặt quầy 1'} /></Form.Item>
        {isBank && <Form.Item name="bankName" label={type === 'EWALLET' ? 'Ví / nhà cung cấp' : 'Ngân hàng'}><Input placeholder={type === 'EWALLET' ? 'MoMo, ZaloPay, VNPay…' : 'Vietcombank, Techcombank…'} /></Form.Item>}
        {isBank && <Form.Item name="accountNumber" label={type === 'EWALLET' ? 'Số điện thoại / mã ví' : 'Số tài khoản'}><Input /></Form.Item>}
        {isBank && <Form.Item name="accountHolder" label="Chủ tài khoản" className="full"><Input /></Form.Item>}
        {!isEdit && <Form.Item name="openingBalance" label="Số dư đầu kỳ" tooltip="Số tiền đang có trong quỹ lúc bắt đầu theo dõi"><MoneyInput placeholder="0" /></Form.Item>}
        <Form.Item name="isDefault" label="Quỹ mặc định" valuePropName="checked" tooltip="Phiếu thu / chi theo phương thức tương ứng sẽ tự ghi vào quỹ này nếu không chọn quỹ"><Switch /></Form.Item>
      </Form>
    </Modal>
  );
}

function ReconcileModal({ open, account, onClose }: { open: boolean; account?: CashAccount; onClose: () => void }) {
  const { message } = App.useApp();
  const qc = useQueryClient();
  const isMobile = useIsMobile();
  const { data: fresh } = useCashAccount(open ? account?.id : undefined);
  const { data: history, isLoading: loadingHistory } = useReconciliations(open ? account?.id : undefined);
  const [counted, setCounted] = useState<number | null>(null);
  const [note, setNote] = useState('');
  const [saving, setSaving] = useState(false);
  useEffect(() => { if (open) { setCounted(null); setNote(''); } }, [open, account?.id]);
  const book = toNum(fresh?.balance ?? account?.balance);
  const diff = counted === null ? null : counted - book;
  const submit = async () => {
    if (!account || counted === null) { message.warning('Nhập số tiền thực đếm'); return; }
    setSaving(true);
    try {
      const r = await financeApi.reconcile(account.id, { countedBalance: String(counted), note: note.trim() || undefined });
      const d = toNum(r.difference);
      message.success(d === 0 ? 'Kiểm quỹ khớp sổ sách' : `Đã ghi nhận kiểm quỹ · chênh lệch ${d > 0 ? '+' : ''}${money(d)}`);
      ['cash-account', 'cash-reconciliations', 'cash-accounts'].forEach((k) => qc.invalidateQueries({ queryKey: [k] }));
      setCounted(null); setNote('');
    } catch (e) { message.error(errMsg(e)); } finally { setSaving(false); }
  };
  return (
    <Modal title={`Kiểm quỹ · ${account?.name ?? ''}`} open={open} onCancel={onClose} onOk={submit} okText="Ghi nhận kiểm quỹ" cancelText="Đóng" confirmLoading={saving} okButtonProps={{ disabled: counted === null }} destroyOnClose width={640}>
      <div className="cb-balance-box" style={{ marginTop: 0 }}>
        <div className="line"><span>Số dư sổ sách</span><b>{money(book)}</b></div>
        {fresh?.lastReconciliation && <div className="line"><span className="muted">Lần kiểm gần nhất</span><span className="muted">{dt(fresh.lastReconciliation.createdAt)} · chênh {money(fresh.lastReconciliation.difference)}</span></div>}
      </div>
      <div className="kv-hint" style={{ margin: '10px 0 4px' }}>Số tiền thực đếm {account?.type === 'CASH' ? 'trong két' : 'theo sao kê'}</div>
      <MoneyInput autoFocus size="large" value={counted ?? undefined} placeholder={money(book)} onChange={(v) => setCounted(v === null || v === undefined ? null : toNum(v))} onPressEnter={submit} />
      {diff !== null && <div className="cb-diff">Chênh lệch: <b className={diff < 0 ? 'neg' : diff > 0 ? 'pos' : ''}>{diff > 0 ? '+' : ''}{money(diff)}</b>{diff === 0 ? <span className="muted"> · khớp sổ sách</span> : diff < 0 ? <span className="muted"> · thiếu so với sổ</span> : <span className="muted"> · thừa so với sổ</span>}</div>}
      <div className="kv-hint" style={{ margin: '8px 0 4px' }}>Ghi chú</div>
      <Input value={note} onChange={(e) => setNote(e.target.value)} placeholder="Lý do chênh lệch, người kiểm…" />
      <div style={{ marginTop: 14 }}><b>Lịch sử kiểm quỹ</b></div>
      {isMobile ? (
        <div className="cb-cards" style={{ marginTop: 6 }}>
          {loadingHistory ? <Skeleton active /> : !history?.length ? <div className="muted">Chưa kiểm quỹ lần nào</div> : history.map((h) => (
            <div key={h.id} className="cb-vcard" style={{ cursor: 'default' }}>
              <div className="code">{dt(h.createdAt)}</div>
              <div className={`amt ${toNum(h.difference) < 0 ? 'out' : toNum(h.difference) > 0 ? 'in' : ''}`}>{toNum(h.difference) > 0 ? '+' : ''}{money(h.difference)}</div>
              <div className="meta"><span>Sổ sách {money(h.bookBalance)}</span><span>· Thực đếm {money(h.countedBalance)}</span></div>
              {h.note && <div className="desc">{h.note}</div>}
            </div>
          ))}
        </div>
      ) : (
        <Table size="small" rowKey="id" loading={loadingHistory} dataSource={history ?? []} pagination={false} style={{ marginTop: 6 }} scroll={{ y: 220 }} locale={{ emptyText: 'Chưa kiểm quỹ lần nào' }}
          columns={[
            { title: 'Thời gian', dataIndex: 'createdAt', width: 140, render: (v) => dt(v) },
            { title: 'Sổ sách', dataIndex: 'bookBalance', className: 'num', render: (v) => money(v) },
            { title: 'Thực đếm', dataIndex: 'countedBalance', className: 'num', render: (v) => money(v) },
            { title: 'Chênh lệch', dataIndex: 'difference', className: 'num', render: (v) => <b className={toNum(v) < 0 ? 'neg' : toNum(v) > 0 ? 'pos' : ''}>{toNum(v) > 0 ? '+' : ''}{money(v)}</b> },
            { title: 'Ghi chú', dataIndex: 'note', ellipsis: true },
          ]} />
      )}
    </Modal>
  );
}

// ---------------------------------------------------------------- categories (loại thu / chi)
function CategoriesTab() {
  const [showInactive, setShowInactive] = useState(false);
  return (
    <div>
      <div className="cb-toolbar">
        <span className="cb-hint" style={{ display: 'inline-flex', alignItems: 'center', gap: 6 }}><Switch size="small" checked={showInactive} onChange={setShowInactive} /> Hiện loại đã ngừng</span>
      </div>
      <Alert type="info" showIcon style={{ marginBottom: 10 }} message="Loại thu / chi khác dùng cho các phiếu không gắn khách hàng hay nhà cung cấp (tiền điện nước, lương, thuê mặt bằng, thu nhập khác…)." />
      <div className="cb-fund-grid">
        <CategoryList direction="IN" showInactive={showInactive} />
        <CategoryList direction="OUT" showInactive={showInactive} />
      </div>
    </div>
  );
}

function CategoryList({ direction, showInactive }: { direction: PaymentDirection; showInactive: boolean }) {
  const can = useCan();
  const qc = useQueryClient();
  const { message, modal } = App.useApp();
  const { data, isLoading, error } = useCashCategories({ direction, includeInactive: showInactive });
  const [name, setName] = useState('');
  const [adding, setAdding] = useState(false);
  const canManage = can('cash.account.manage');
  const refresh = () => qc.invalidateQueries({ queryKey: ['cash-categories'] });
  const add = async () => {
    const n = name.trim();
    if (!n) { message.warning('Nhập tên loại'); return; }
    setAdding(true);
    try { await financeApi.createCategory({ direction, name: n }); message.success(`Đã thêm "${n}"`); setName(''); refresh(); } catch (e) { message.error(errMsg(e)); } finally { setAdding(false); }
  };
  const rename = (c: PaymentCategory) => {
    let value = c.name;
    modal.confirm({ title: 'Đổi tên loại', icon: null, content: <Input defaultValue={c.name} autoFocus onChange={(e) => (value = e.target.value)} />, okText: 'Lưu', cancelText: 'Bỏ qua',
      onOk: async () => { const n = value.trim(); if (!n) { message.warning('Nhập tên'); throw new Error('name'); } try { await financeApi.updateCategory(c.id, { name: n }); message.success('Đã đổi tên'); refresh(); } catch (e) { message.error(errMsg(e)); throw e; } } });
  };
  const toggle = async (c: PaymentCategory) => { try { await financeApi.updateCategory(c.id, { isActive: !c.isActive }); message.success(c.isActive ? 'Đã ngừng sử dụng' : 'Đã kích hoạt'); refresh(); } catch (e) { message.error(errMsg(e)); } };
  const list = data ?? [];
  return (
    <div className="kv-card">
      <div className="cb-cat" style={{ background: '#f8fafc', borderRadius: '6px 6px 0 0' }}><b style={{ flex: 1 }}><Tag color={direction === 'IN' ? 'green' : 'orange'}>{direction === 'IN' ? 'Thu' : 'Chi'}</Tag>{direction === 'IN' ? 'Loại thu khác' : 'Loại chi khác'}</b><span className="muted">{list.length}</span></div>
      {canManage && <div className="cb-cat-add"><Input placeholder={direction === 'IN' ? 'Thêm loại thu, VD: Thu nhập khác' : 'Thêm loại chi, VD: Tiền điện nước'} value={name} onChange={(e) => setName(e.target.value)} onPressEnter={add} /><Button type="primary" icon={<PlusOutlined />} loading={adding} onClick={add}>Thêm</Button></div>}
      {error && <div className="cb-cat neg">{errMsg(error)}</div>}
      {isLoading ? <div className="cb-cat"><Skeleton active paragraph={{ rows: 2 }} title={false} /></div> : list.length === 0 ? <div className="cb-cat muted">Chưa có loại nào</div> : list.map((c) => (
        <div key={c.id} className={`cb-cat${c.isActive ? '' : ' off'}`}>
          <span className="nm">{c.name}</span>
          {!c.isActive && <Tag>Ngừng</Tag>}
          {canManage && <Button size="small" type="text" icon={<EditOutlined />} onClick={() => rename(c)} />}
          {canManage && <Button size="small" type="text" danger={c.isActive} icon={c.isActive ? <StopOutlined /> : <CheckCircleOutlined />} onClick={() => toggle(c)} />}
        </div>
      ))}
    </div>
  );
}
