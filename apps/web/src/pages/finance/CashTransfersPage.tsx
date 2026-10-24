import { Alert, App, Button, DatePicker, Descriptions, Empty, Input, Modal, Pagination, Radio, Select, Skeleton, Table, Tag } from 'antd';
import { ArrowRightOutlined, PlusOutlined, ReloadOutlined, SearchOutlined, StopOutlined, SwapOutlined } from '@ant-design/icons';
import { useEffect, useMemo, useState } from 'react';
import { Link, useSearchParams } from 'react-router-dom';
import { useQueryClient } from '@tanstack/react-query';
import { CashAccount, CashTransfer, FINANCE_KEYS, TransferQuery, financeApi, useCashAccounts, useCashTransfers } from '../../api/finance';
import { errMsg, normalizeError } from '../../api/client';
import { FilterCard, FilterPanel } from '../../components/FilterPanel';
import { MoneyInput } from '../../components/Inputs';
import { useIsMobile } from '../../hooks/useMedia';
import { useAuthStore, useCan } from '../../store/auth';
import { dt, money, toNum } from '../../utils/format';
import { FundSelect, accessibleFunds, branchDrawer } from './FinanceSelects';
import './finance.css';

/** A transfer created by closing a shift (its note is "Bàn giao ca <code>"); `shiftId` alone only says a shift was open at the time. */
export const isHandover = (t: { note?: string | null }) => /^bàn giao ca\b/i.test(t.note ?? '');

/** Chuyển quỹ (két → ngân hàng / két sắt) and the shift-handover transfers created at shift close. */
export default function CashTransfersPage() {
  const can = useCan();
  const isMobile = useIsMobile();
  const [sp] = useSearchParams();
  const me = useAuthStore((s) => s.me);
  const [q, setQ] = useState<TransferQuery>({ page: 1, pageSize: 20, search: sp.get('search') ?? undefined });
  const [searchText, setSearchText] = useState(q.search ?? '');
  const [create, setCreate] = useState(false);
  const [detail, setDetail] = useState<CashTransfer | undefined>();
  useEffect(() => { const s = sp.get('search'); if (s) { setSearchText(s); setQ((st) => ({ ...st, search: s, page: 1 })); } }, [sp]);
  const { data, isLoading, isFetching, error, refetch } = useCashTransfers(q);
  const set = (patch: Partial<TransferQuery>) => setQ((s) => ({ ...s, ...patch, page: patch.page ?? 1 }));
  const rows = data?.data ?? [];
  const cancel = useCancelTransfer();
  const canTransfer = can('cash.transfer');

  const list = isMobile ? (
    <div className="cb-cards">
      {isLoading ? <Skeleton active /> : rows.length === 0 ? <Empty className="cb-empty" description={error ? errMsg(error) : 'Chưa có phiếu chuyển quỹ'} /> : rows.map((t) => (
        <div key={t.id} className={`cb-vcard${t.status === 'CANCELLED' ? ' cancelled' : ''}`} onClick={() => setDetail(t)} role="button">
          <div className="code">{t.code}<Tag color={t.status === 'POSTED' ? 'green' : 'red'} style={{ marginInlineEnd: 0 }}>{t.status === 'POSTED' ? 'Hoàn thành' : 'Đã hủy'}</Tag>{isHandover(t) && <Tag color="geekblue" style={{ marginInlineEnd: 0 }}>Bàn giao ca</Tag>}</div>
          <div className="time">{dt(t.createdAt, 'DD/MM HH:mm')}</div>
          <div className="desc">{t.fromAccount.name} <ArrowRightOutlined className="cb-arrow" /> {t.toAccount.name}</div>
          <div className="row"><span className="meta">{t.note || <span>&nbsp;</span>}</span><span className="amt">{money(t.amount)}</span></div>
        </div>
      ))}
      {(data?.meta.total ?? 0) > (q.pageSize ?? 20) && <div className="cb-pager"><Pagination simple current={q.page} pageSize={q.pageSize} total={data?.meta.total ?? 0} onChange={(p) => set({ page: p })} /></div>}
    </div>
  ) : (
    <div className="kv-card">
      <Table className="kv-table" rowKey="id" size="small" loading={isLoading} dataSource={rows} scroll={{ x: 1180 }}
        locale={{ emptyText: error ? <Empty description={errMsg(error)} /> : <Empty description="Chưa có phiếu chuyển quỹ" /> }}
        expandable={{ expandedRowRender: (t) => <TransferDetail t={t} onCancel={() => cancel(t)} />, expandRowByClick: true }}
        onChange={(p) => set({ page: p.current, pageSize: p.pageSize })}
        pagination={{ current: q.page, pageSize: q.pageSize, total: data?.meta.total ?? 0, showSizeChanger: true, pageSizeOptions: [15, 20, 50, 100], showTotal: (t) => `${t} phiếu` }}
        columns={[
          { title: 'Mã phiếu', dataIndex: 'code', width: 120, render: (v, t) => <span><b>{v}</b>{isHandover(t) && <Tag color="geekblue" style={{ marginLeft: 6 }}>Bàn giao ca</Tag>}</span> },
          { title: 'Thời gian', dataIndex: 'createdAt', width: 140, render: (v) => dt(v) },
          { title: 'Từ quỹ', width: 200, ellipsis: true, render: (_, t) => <span title={t.fromAccount.name}>{t.fromAccount.name}</span> },
          { title: '', width: 30, render: () => <ArrowRightOutlined className="cb-arrow" /> },
          { title: 'Đến quỹ', width: 200, ellipsis: true, render: (_, t) => <span title={t.toAccount.name}>{t.toAccount.name}</span> },
          { title: 'Số tiền', dataIndex: 'amount', className: 'num', width: 140, render: (v) => <b>{money(v)}</b> },
          { title: 'Phiếu thu / chi', width: 190, render: (_, t) => <span className="cb-legs">{t.payments.map((p) => <Tag key={p.id} color={p.status === 'CANCELLED' ? 'red' : p.direction === 'OUT' ? 'orange' : 'green'} style={{ marginInlineEnd: 0 }}>{p.code}</Tag>)}</span> },
          { title: 'Trạng thái', dataIndex: 'status', width: 110, render: (v) => <Tag color={v === 'POSTED' ? 'green' : 'red'}>{v === 'POSTED' ? 'Hoàn thành' : 'Đã hủy'}</Tag> },
          { title: 'Ghi chú', dataIndex: 'note', ellipsis: true },
        ]} />
    </div>
  );

  return (
    <div className="kv-list cb-page">
      <FilterPanel>
        <FilterCard title="Trạng thái"><Radio.Group value={q.status ?? ''} onChange={(e) => set({ status: e.target.value || undefined })}><Radio value="">Tất cả</Radio><Radio value="POSTED">Hoàn thành</Radio><Radio value="CANCELLED">Đã hủy</Radio></Radio.Group></FilterCard>
        <FilterCard title="Chi nhánh"><Radio.Group value={q.branchId ?? ''} onChange={(e) => set({ branchId: e.target.value || undefined })}><Radio value="">Tất cả</Radio>{(me?.branches ?? []).map((b) => <Radio key={b.id} value={b.id}>{b.name}</Radio>)}</Radio.Group></FilterCard>
        <FilterCard title="Thời gian"><DatePicker.RangePicker size="small" style={{ width: '100%' }} format="DD/MM/YYYY" onChange={(r) => set({ from: r?.[0]?.startOf('day').toISOString(), to: r?.[1]?.endOf('day').toISOString() })} /></FilterCard>
      </FilterPanel>
      <div className="kv-main">
        <h1 className="kv-page-title">Chuyển quỹ / Bàn giao ca</h1>
        <div className="kv-toolbar">
          <Input.Search className="kv-search" allowClear placeholder="Theo mã phiếu, ghi chú" value={searchText} onChange={(e) => setSearchText(e.target.value)} onSearch={(v) => set({ search: v || undefined })} enterButton={<SearchOutlined />} />
          <span className="spacer" />
          {canTransfer && <Button type="primary" icon={<PlusOutlined />} onClick={() => setCreate(true)} block={isMobile}>Chuyển quỹ</Button>}
          <Button icon={<ReloadOutlined />} onClick={() => refetch()} loading={isFetching} />
        </div>
        <Alert type="info" showIcon style={{ marginBottom: 10 }} message={<span><b>Bàn giao ca</b> (nộp tiền mặt từ két quầy về két sắt / ngân hàng cuối ca) được thực hiện ngay trên màn hình <Link to="/shifts">Đóng ca</Link>; phiếu chuyển quỹ tương ứng sẽ xuất hiện ở đây với nhãn “Bàn giao ca”. Dùng nút “Chuyển quỹ” cho các lần chuyển tiền khác giữa các quỹ.</span>} />
        {list}
      </div>
      <TransferCreateModal open={create} onClose={() => setCreate(false)} />
      <Modal open={!!detail} onCancel={() => setDetail(undefined)} footer={null} title={detail ? `Chuyển quỹ ${detail.code}` : ''} destroyOnClose width={640}>
        {detail && <TransferDetail t={rows.find((r) => r.id === detail.id) ?? detail} onCancel={() => { setDetail(undefined); cancel(detail); }} />}
      </Modal>
    </div>
  );
}

function useCancelTransfer() {
  const { message, modal } = App.useApp();
  const qc = useQueryClient();
  return (t: CashTransfer) => {
    let reason = '';
    modal.confirm({
      title: `Hủy phiếu chuyển quỹ ${t.code}?`, okText: 'Hủy chuyển quỹ', okButtonProps: { danger: true }, cancelText: 'Bỏ qua',
      content: <div>Số tiền <b>{money(t.amount)}</b> sẽ được hoàn về quỹ <b>{t.fromAccount.name}</b>; cả hai phiếu thu / chi của lần chuyển bị hủy.<Input.TextArea style={{ marginTop: 8 }} placeholder="Lý do hủy (bắt buộc)" onChange={(e) => (reason = e.target.value)} /></div>,
      onOk: async () => {
        if (!reason.trim()) { message.warning('Nhập lý do'); throw new Error('reason'); }
        try { await financeApi.cancelTransfer(t.id, reason.trim()); message.success(`Đã hủy chuyển quỹ ${t.code}`); FINANCE_KEYS.forEach((k) => qc.invalidateQueries({ queryKey: [k] })); }
        catch (e) { const err = normalizeError(e); message.error(err.code === 'CASH_INSUFFICIENT' ? `Quỹ đích không còn đủ tiền để hoàn lại (${err.message})` : err.message); throw e; }
      },
    });
  };
}

function TransferDetail({ t, onCancel }: { t: CashTransfer; onCancel: () => void }) {
  const can = useCan();
  const out = t.payments.find((p) => p.direction === 'OUT');
  const inn = t.payments.find((p) => p.direction === 'IN');
  return (
    <div className="kv-expanded">
      <div className="cb-transfer-flow">
        <div className="box"><div className="bl">Từ quỹ</div><div className="nm">{t.fromAccount.name}</div><div className="bl">{t.fromAccount.code}</div></div>
        <div className="cb-arrow-cell"><ArrowRightOutlined /></div>
        <div className="box"><div className="bl">Đến quỹ</div><div className="nm">{t.toAccount.name}</div><div className="bl">{t.toAccount.code}</div></div>
      </div>
      <Descriptions size="small" column={{ xs: 1, md: 2 }} colon={false} labelStyle={{ color: '#6b7280' }}>
        <Descriptions.Item label="Số tiền"><b>{money(t.amount)}</b></Descriptions.Item>
        <Descriptions.Item label="Trạng thái"><Tag color={t.status === 'POSTED' ? 'green' : 'red'}>{t.status === 'POSTED' ? 'Hoàn thành' : 'Đã hủy'}</Tag>{isHandover(t) && <Tag color="geekblue">Bàn giao ca</Tag>}</Descriptions.Item>
        <Descriptions.Item label="Thời gian">{dt(t.createdAt)}</Descriptions.Item>
        <Descriptions.Item label="Ghi chú">{t.note || '—'}</Descriptions.Item>
        <Descriptions.Item label="Phiếu chi (quỹ nguồn)">{out ? <Link to={`/payments?search=${out.code}`}>{out.code}</Link> : '—'}{out?.status === 'CANCELLED' && <Tag color="red" style={{ marginLeft: 6 }}>Đã hủy</Tag>}</Descriptions.Item>
        <Descriptions.Item label="Phiếu thu (quỹ đích)">{inn ? <Link to={`/payments?search=${inn.code}`}>{inn.code}</Link> : '—'}{inn?.status === 'CANCELLED' && <Tag color="red" style={{ marginLeft: 6 }}>Đã hủy</Tag>}</Descriptions.Item>
        {t.cancelledAt && <Descriptions.Item label="Hủy lúc" span={{ xs: 1, md: 2 }}>{dt(t.cancelledAt)} · {t.cancelReason}</Descriptions.Item>}
      </Descriptions>
      <div className="kv-detail-actions">
        <Link to={`/cash?accountId=${t.fromAccount.id}`}><Button>Sổ quỹ nguồn</Button></Link>
        <Link to={`/cash?accountId=${t.toAccount.id}`}><Button>Sổ quỹ đích</Button></Link>
        {t.status === 'POSTED' && can('cash.transfer') && <Button danger icon={<StopOutlined />} onClick={onCancel}>Hủy chuyển quỹ</Button>}
      </div>
    </div>
  );
}

function TransferCreateModal({ open, onClose }: { open: boolean; onClose: () => void }) {
  const { message } = App.useApp();
  const qc = useQueryClient();
  const me = useAuthStore((s) => s.me);
  const currentBranch = useAuthStore((s) => s.currentBranchId);
  const { data: accounts } = useCashAccounts(false, open);
  const [branchId, setBranchId] = useState<string | undefined>(currentBranch ?? undefined);
  const [fromId, setFromId] = useState<string | undefined>();
  const [toId, setToId] = useState<string | undefined>();
  const [amount, setAmount] = useState(0);
  const [note, setNote] = useState('');
  const [saving, setSaving] = useState(false);
  const funds = useMemo(() => accessibleFunds(accounts, branchId), [accounts, branchId]);
  useEffect(() => { if (open) { setBranchId(currentBranch ?? undefined); setFromId(undefined); setToId(undefined); setAmount(0); setNote(''); } }, [open, currentBranch]);
  useEffect(() => { if (open && !fromId && funds.length) setFromId(branchDrawer(funds, branchId)?.id); }, [open, funds, branchId, fromId]);
  const from = funds.find((a) => a.id === fromId);
  const to = funds.find((a) => a.id === toId);
  const insufficient = !!from && amount > 0 && amount > toNum(from.balance);
  const submit = async () => {
    if (!branchId) { message.warning('Chọn chi nhánh'); return; }
    if (!fromId || !toId) { message.warning('Chọn quỹ nguồn và quỹ đích'); return; }
    if (fromId === toId) { message.warning('Quỹ nguồn và quỹ đích phải khác nhau'); return; }
    if (!(amount > 0)) { message.warning('Nhập số tiền'); return; }
    if (insufficient) { message.warning(`Quỹ ${from?.name} chỉ còn ${money(from?.balance)}`); return; }
    setSaving(true);
    try {
      const t = await financeApi.createTransfer({ branchId, fromAccountId: fromId, toAccountId: toId, amount: String(amount), note: note.trim() || undefined });
      message.success(`Đã chuyển quỹ ${t.code} · ${money(t.amount)}`);
      FINANCE_KEYS.forEach((k) => qc.invalidateQueries({ queryKey: [k] }));
      onClose();
    } catch (e) { const err = normalizeError(e); message.error(err.code === 'CASH_INSUFFICIENT' ? `Quỹ nguồn không đủ số dư (còn ${money(err.details?.balance)})` : err.message); } finally { setSaving(false); }
  };
  const box = (label: string, a?: CashAccount, delta = 0) => (
    <div className="box"><div className="bl">{label}</div>{a ? <><div className="nm">{a.name}</div><div className="bl">Số dư: {money(a.balance)}</div>{amount > 0 && <div className="af">Sau chuyển: <span className={toNum(a.balance) + delta < 0 ? 'neg' : ''}>{money(toNum(a.balance) + delta)}</span></div>}</> : <div className="bl">Chưa chọn</div>}</div>
  );
  return (
    <Modal title={<span><SwapOutlined /> Chuyển tiền giữa các quỹ</span>} open={open} onCancel={onClose} onOk={submit} okText="Chuyển quỹ" cancelText="Bỏ qua" confirmLoading={saving} destroyOnClose width={600}>
      <div className="cb-form">
        <div className="full"><div className="kv-hint">Chi nhánh</div><Select value={branchId} onChange={(v) => { setBranchId(v); setFromId(undefined); setToId(undefined); }} options={(me?.branches ?? []).map((b) => ({ value: b.id, label: b.name }))} /></div>
        <div><div className="kv-hint">Từ quỹ</div><FundSelect value={fromId} onChange={(id) => setFromId(id)} branchId={branchId} exclude={toId ? [toId] : []} /></div>
        <div><div className="kv-hint">Đến quỹ</div><FundSelect value={toId} onChange={(id) => setToId(id)} branchId={branchId} exclude={fromId ? [fromId] : []} placeholder="Chọn quỹ nhận" /></div>
        <div><div className="kv-hint">Số tiền</div><MoneyInput size="large" value={amount || undefined} placeholder="0" onChange={(v) => setAmount(toNum(v))} status={insufficient ? 'error' : undefined} />
          {from && amount !== toNum(from.balance) && toNum(from.balance) > 0 && <Button type="link" size="small" style={{ padding: 0 }} onClick={() => setAmount(toNum(from.balance))}>Chuyển toàn bộ {money(from.balance)}</Button>}
          {insufficient && <div className="neg cb-hint">Quỹ nguồn không đủ số dư</div>}</div>
        <div><div className="kv-hint">Ghi chú</div><Input value={note} onChange={(e) => setNote(e.target.value)} placeholder="VD: Nộp tiền về két sắt" /></div>
      </div>
      <div className="cb-transfer-flow">
        {box('Quỹ nguồn', from, -amount)}
        <div className="cb-arrow-cell"><ArrowRightOutlined /></div>
        {box('Quỹ đích', to, amount)}
      </div>
    </Modal>
  );
}
