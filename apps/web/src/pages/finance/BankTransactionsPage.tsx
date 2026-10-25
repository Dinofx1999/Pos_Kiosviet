import { Alert, App, Button, Empty, Input, Modal, Pagination, Segmented, Select, Skeleton, Tag, Tooltip } from 'antd';
import Table from '../../components/ResponsiveTable';
import { CheckOutlined, LinkOutlined, QrcodeOutlined, ReloadOutlined, SearchOutlined, SettingOutlined, StopOutlined } from '@ant-design/icons';
import { useEffect, useMemo, useRef, useState } from 'react';
import { Link, useSearchParams } from 'react-router-dom';
import { useQueryClient } from '@tanstack/react-query';
import {
  BANK_PURPOSE_LABEL, BANK_TX_STATUS_COLOR, BANK_TX_STATUS_LABEL, bankApi, invalidateBank, useBankTransactions, useSepayConfig,
  type BankApplyTarget, type BankTransaction, type BankTransactionQuery, type BankTxStatus,
} from '../../api/bankTransfers';
import { ordersApi } from '../../api/orders';
import { salesApi } from '../../api/sales';
import { errMsg, normalizeError } from '../../api/client';
import { CustomerSelect } from '../../components/CustomerSelect';
import { useIsMobile } from '../../hooks/useMedia';
import { useCan } from '../../store/auth';
import { dt, money, toNum } from '../../utils/format';
import { ORDER_STATUS_LABEL } from '../sales/OrderShared';
import './finance.css';

type Filter = BankTxStatus | 'ALL';
const FILTERS: Filter[] = ['UNMATCHED', 'MATCHED', 'APPLIED', 'IGNORED', 'ALL'];
const isFilter = (v: string | null): v is Filter => !!v && (FILTERS as string[]).includes(v);

/** Where the matched code / document of a transaction lives. */
function docLink(t: BankTransaction) {
  const r = t.request;
  if (!r?.documentCode) return null;
  const path = r.purpose === 'SALES_ORDER' ? '/orders' : '/invoices';
  return <Link to={`${path}?search=${encodeURIComponent(r.documentCode)}`} onClick={(e) => e.stopPropagation()}>{r.documentCode}</Link>;
}
const paymentLink = (t: BankTransaction) => (t.payment?.code ? <Link to={`/payments?search=${encodeURIComponent(t.payment.code)}`} onClick={(e) => e.stopPropagation()}>{t.payment.code}</Link> : null);

/** Sổ quỹ → Giao dịch chuyển khoản: money reported by SePay, matched automatically or waiting to be attached by hand. */
export default function BankTransactionsPage() {
  const can = useCan();
  const isMobile = useIsMobile();
  const [sp, setSp] = useSearchParams();
  const canAct = can('payment.create');
  const [filter, setFilter] = useState<Filter>(isFilter(sp.get('status')) ? (sp.get('status') as Filter) : 'UNMATCHED');
  const [q, setQ] = useState<BankTransactionQuery>({ page: 1, pageSize: 20, search: sp.get('search') ?? undefined });
  const [searchText, setSearchText] = useState(q.search ?? '');
  useEffect(() => { const st = sp.get('status'); if (isFilter(st) && st !== filter) { setFilter(st); setQ((x) => ({ ...x, page: 1 })); } }, [sp]);
  const query = { ...q, status: filter === 'ALL' ? undefined : filter };
  const { data, isLoading, isFetching, error, refetch } = useBankTransactions(query);
  const { data: cfg } = useSepayConfig(can('integration.view'));
  const rows = data?.data ?? [];
  const unmatched = data?.unmatchedCount ?? 0;
  const [applying, setApplying] = useState<BankTransaction | null>(null);
  const ignore = useIgnore();
  const pick = (f: Filter) => { setFilter(f); setQ((x) => ({ ...x, page: 1 })); const next = new URLSearchParams(sp); next.set('status', f); setSp(next, { replace: true }); };

  const actions = (t: BankTransaction) => t.status === 'UNMATCHED' && canAct ? (
    <>
      <Button size={isMobile ? 'middle' : 'small'} type="primary" icon={<LinkOutlined />} onClick={(e) => { e.stopPropagation(); setApplying(t); }}>Gắn vào chứng từ</Button>
      <Button size={isMobile ? 'middle' : 'small'} icon={<StopOutlined />} onClick={(e) => { e.stopPropagation(); ignore(t); }}>Bỏ qua</Button>
    </>
  ) : null;
  const matchCell = (t: BankTransaction) => (
    <span className="bt-match">
      {t.request ? <span><Tag style={{ marginInlineEnd: 4 }}>{t.request.code}</Tag>{docLink(t) ?? <span className="muted">{BANK_PURPOSE_LABEL[t.request.purpose]}</span>}</span> : t.code ? <Tag>{t.code}</Tag> : null}
      {t.matchNote && <span className="bt-note">{t.matchNote}</span>}
    </span>
  );

  const empty = <Empty className="cb-empty" description={error ? errMsg(error) : filter === 'UNMATCHED' ? 'Không có giao dịch chưa khớp' : 'Chưa có giao dịch'}>{filter === 'UNMATCHED' && !error && <Button onClick={() => pick('ALL')}>Xem tất cả giao dịch</Button>}</Empty>;
  const list = isMobile ? (
    <div className="cb-cards">
      {isLoading ? <Skeleton active /> : rows.length === 0 ? empty : rows.map((t) => (
        <div key={t.id} className={`cb-vcard bt-card bt-${t.status.toLowerCase()}`}>
          <div className="code"><span className="amt in">+{money(t.amount)}</span><Tag color={BANK_TX_STATUS_COLOR[t.status]} style={{ marginInlineEnd: 0 }}>{BANK_TX_STATUS_LABEL[t.status]}</Tag></div>
          <div className="time">{dt(t.transactionDate, 'DD/MM HH:mm')}</div>
          <div className="desc bt-content">{t.content || <span className="muted">(không có nội dung)</span>}</div>
          <div className="meta">{t.gateway && <span>{t.gateway}</span>}{t.referenceCode && <span>Mã GD {t.referenceCode}</span>}{t.payment && <span>Phiếu thu {paymentLink(t)}</span>}</div>
          {(t.request || t.matchNote || t.code) && <div className="desc">{matchCell(t)}</div>}
          {actions(t) && <div className="actions">{actions(t)}</div>}
        </div>
      ))}
      {(data?.meta.total ?? 0) > (q.pageSize ?? 20) && <div className="cb-pager"><Pagination simple current={q.page} pageSize={q.pageSize} total={data?.meta.total ?? 0} onChange={(p) => setQ((x) => ({ ...x, page: p }))} /></div>}
    </div>
  ) : (
    <div className="kv-card">
      <Table className="kv-table bt-table" rowKey="id" size="small" loading={isLoading} dataSource={rows} scroll={{ x: 1240 }} locale={{ emptyText: empty }}
        onChange={(p) => setQ((x) => ({ ...x, page: p.current, pageSize: p.pageSize }))}
        pagination={{ current: q.page, pageSize: q.pageSize, total: data?.meta.total ?? 0, showSizeChanger: true, pageSizeOptions: [20, 50, 100], showTotal: (n) => `${n} giao dịch` }}
        columns={[
          { title: 'Thời gian', dataIndex: 'transactionDate', width: 120, render: (v) => dt(v) },
          { title: 'Số tiền', dataIndex: 'amount', width: 110, className: 'num', render: (v) => <b className="pos">+{money(v)}</b> },
          { title: 'Nội dung chuyển khoản', dataIndex: 'content', render: (v) => <span className="bt-content">{v || <span className="muted">—</span>}</span> },
          { title: 'Tham chiếu', width: 150, render: (_, t) => <span className="bt-ref">{t.referenceCode ?? '—'}{t.gateway && <div className="kv-hint">{t.gateway}{t.accountNumber ? ` · ${t.accountNumber}` : ''}</div>}</span> },
          { title: 'Trạng thái', dataIndex: 'status', width: 110, render: (v: BankTxStatus) => <Tag color={BANK_TX_STATUS_COLOR[v]}>{BANK_TX_STATUS_LABEL[v]}</Tag> },
          { title: 'Khớp với / ghi chú', width: 220, render: (_, t) => matchCell(t) },
          { title: 'Phiếu thu', width: 100, render: (_, t) => paymentLink(t) ?? <span className="muted">—</span> },
          ...(canAct && (filter === 'UNMATCHED' || filter === 'ALL') ? [{ title: '', width: 190, fixed: 'right' as const, render: (_: unknown, t: BankTransaction) => <span className="bt-actions">{actions(t)}</span> }] : []),
        ]} />
    </div>
  );

  return (
    <div className="cb-page bt-page">
      <h1 className="kv-page-title">Giao dịch chuyển khoản</h1>
      <div className="kv-hint bt-intro">Tiền vào tài khoản do SePay báo về. Giao dịch có mã thanh toán hợp lệ được <b>khớp tự động</b> (bán tại quầy, thu nợ, cọc đơn); giao dịch <b>chưa khớp</b> cần gắn tay vào hóa đơn / đơn đặt hàng / khách hàng hoặc bỏ qua.</div>
      {cfg && !cfg.enabled && <Alert type="warning" showIcon style={{ marginBottom: 10 }} message="Nhận tiền chuyển khoản tự động đang tắt" action={<Link to="/integrations/sepay"><Button size="small" icon={<SettingOutlined />}>Cấu hình SePay</Button></Link>} />}
      <div className="bt-chips">
        <Segmented value={filter} onChange={(v) => pick(v as Filter)} options={FILTERS.map((f) => ({ value: f, label: f === 'ALL' ? 'Tất cả' : f === 'UNMATCHED' ? <span>Chưa khớp {unmatched > 0 && <span className="bt-count">{unmatched}</span>}</span> : BANK_TX_STATUS_LABEL[f] }))} />
      </div>
      <div className="cb-toolbar">
        <Input.Search className="cb-grow bt-search" allowClear placeholder="Nội dung, mã giao dịch, mã thanh toán" value={searchText} onChange={(e) => setSearchText(e.target.value)} onSearch={(v) => setQ((x) => ({ ...x, search: v.trim() || undefined, page: 1 }))} enterButton={<SearchOutlined />} />
        <Tooltip title="Tải lại"><Button icon={<ReloadOutlined />} onClick={() => refetch()} loading={isFetching} /></Tooltip>
        {can('integration.view') && <Link to="/integrations/sepay" aria-label="Cấu hình SePay"><Button icon={<QrcodeOutlined />}>{isMobile ? null : 'Cấu hình SePay'}</Button></Link>}
      </div>
      {list}
      <ApplyModal tx={applying} onClose={() => setApplying(null)} />
    </div>
  );
}

function useIgnore() {
  const { message, modal } = App.useApp();
  const qc = useQueryClient();
  return (t: BankTransaction) => {
    let note = '';
    modal.confirm({
      title: `Bỏ qua giao dịch +${money(t.amount)}?`, okText: 'Bỏ qua giao dịch', cancelText: 'Không', icon: <StopOutlined />,
      content: (
        <div>
          <div className="kv-hint" style={{ marginBottom: 6 }}>Không lập phiếu thu – dùng cho tiền không liên quan bán hàng (chuyển nội bộ, hoàn tiền, giao dịch thử…).</div>
          <div className="bt-tx-mini">{t.content || '(không có nội dung)'}</div>
          <Input.TextArea style={{ marginTop: 8 }} rows={2} maxLength={500} placeholder="Lý do (không bắt buộc)" onChange={(e) => (note = e.target.value)} />
        </div>
      ),
      onOk: async () => {
        try { await bankApi.ignore(t.id, note.trim() || undefined); message.success('Đã bỏ qua giao dịch'); invalidateBank(qc); }
        catch (e) { message.error(errMsg(e)); invalidateBank(qc); throw e; }
      },
    });
  };
}

interface DocOption { value: string; label: string; sub: string }
const TARGETS: Array<{ value: BankApplyTarget; label: string }> = [{ value: 'INVOICE', label: 'Hóa đơn' }, { value: 'SALES_ORDER', label: 'Đơn đặt hàng' }, { value: 'CUSTOMER', label: 'Khách hàng' }];

/** Attach an unmatched transfer to an invoice / sales order / customer → a BANK_TRANSFER receipt is posted. */
function ApplyModal({ tx, onClose }: { tx: BankTransaction | null; onClose: () => void }) {
  const { message } = App.useApp();
  const qc = useQueryClient();
  const [target, setTarget] = useState<BankApplyTarget>('INVOICE');
  const [docId, setDocId] = useState<string | undefined>();
  const [customerId, setCustomerId] = useState<string | undefined>();
  const [options, setOptions] = useState<DocOption[]>([]);
  const [searching, setSearching] = useState(false);
  const [note, setNote] = useState('');
  const [saving, setSaving] = useState(false);
  const timer = useRef<number>();
  const seq = useRef(0);

  // a document code written in the transfer content (HD000123 / DH000045) pre-selects the target and the search
  const guess = useMemo(() => {
    const c = tx?.content ?? '';
    const inv = /\bHD\d{4,}\b/i.exec(c)?.[0]; if (inv) return { target: 'INVOICE' as const, text: inv.toUpperCase() };
    const od = /\bDH\d{4,}\b/i.exec(c)?.[0]; if (od) return { target: 'SALES_ORDER' as const, text: od.toUpperCase() };
    return null;
  }, [tx?.id]);

  const load = (t: BankApplyTarget, text: string, autoPick = false) => {
    if (t === 'CUSTOMER') return;
    const my = ++seq.current;
    setSearching(true);
    const p = t === 'INVOICE'
      ? salesApi.invoices({ search: text || undefined, status: 'COMPLETED', unpaid: text ? undefined : 'true', pageSize: 20 }).then((r) => r.data.map((i) => ({ value: i.id, label: i.code, sub: `${i.customer?.name ?? 'Khách lẻ'} · ${dt(i.invoiceDate, 'DD/MM/YY')} · tổng ${money(i.totalAmount)} · còn nợ ${money(toNum(i.totalAmount) - toNum(i.paidAmount))}` })))
      : ordersApi.list({ search: text || undefined, pageSize: 20 }).then((r) => r.data.filter((o) => o.status === 'DRAFT' || o.status === 'CONFIRMED' || !!text).map((o) => ({ value: o.id, label: o.code, sub: `${o.customer?.name ?? 'Khách lẻ'} · ${ORDER_STATUS_LABEL[o.status] ?? o.status} · tổng ${money(o.totalAmount)} · còn phải thu ${money(o.dueAmount)}` })));
    p.then((list) => { if (my !== seq.current) return; setOptions(list); if (autoPick) { const hit = list.find((o) => o.label.toUpperCase() === text.toUpperCase()); if (hit) setDocId(hit.value); } }).catch(() => { if (my === seq.current) setOptions([]); }).finally(() => { if (my === seq.current) setSearching(false); });
  };
  useEffect(() => {
    if (!tx) return;
    const t = guess?.target ?? 'INVOICE';
    setTarget(t); setDocId(undefined); setCustomerId(undefined); setNote(''); setOptions([]);
    load(t, guess?.text ?? '', !!guess);
  }, [tx?.id]);
  const switchTarget = (t: BankApplyTarget) => { setTarget(t); setDocId(undefined); setOptions([]); load(t, ''); };
  const onSearch = (text: string) => { window.clearTimeout(timer.current); timer.current = window.setTimeout(() => load(target, text.trim()), 300); };

  const submit = async () => {
    if (!tx) return;
    if (target === 'CUSTOMER' ? !customerId : !docId) { message.warning(target === 'CUSTOMER' ? 'Chọn khách hàng' : `Chọn ${target === 'INVOICE' ? 'hóa đơn' : 'đơn đặt hàng'}`); return; }
    setSaving(true);
    try {
      const r = await bankApi.apply(tx.id, { target, documentId: target === 'CUSTOMER' ? undefined : docId, customerId: target === 'CUSTOMER' ? customerId : undefined, note: note.trim() || undefined });
      message.success(`Đã lập phiếu thu ${r.paymentCode}${r.note ? ` – ${r.note.split(' · ').slice(-1)[0]}` : ''}`);
      invalidateBank(qc); onClose();
    } catch (e) {
      const err = normalizeError(e);
      message.error(err.code === 'TRANSACTION_HANDLED' ? 'Giao dịch đã được xử lý ở nơi khác – danh sách đã tải lại' : err.message);
      if (err.code === 'TRANSACTION_HANDLED') { invalidateBank(qc); onClose(); }
    } finally { setSaving(false); }
  };

  return (
    <Modal open={!!tx} title="Gắn giao dịch vào chứng từ" onCancel={onClose} okText="Lập phiếu thu" okButtonProps={{ icon: <CheckOutlined /> }} cancelText="Bỏ qua" confirmLoading={saving} onOk={submit} destroyOnClose width={600}>
      {tx && (
        <>
          <div className="bt-tx-box">
            <div className="bt-tx-amt">+{money(tx.amount)} đ</div>
            <div className="kv-hint">{dt(tx.transactionDate, 'DD/MM/YYYY HH:mm')}{tx.gateway ? ` · ${tx.gateway}` : ''}{tx.referenceCode ? ` · Mã GD ${tx.referenceCode}` : ''}</div>
            <div className="bt-content">{tx.content || '(không có nội dung)'}</div>
            {tx.matchNote && <div className="kv-hint">{tx.matchNote}</div>}
          </div>
          <div className="kv-hint" style={{ margin: '10px 0 4px' }}>Ghi nhận vào</div>
          <Segmented block value={target} onChange={(v) => switchTarget(v as BankApplyTarget)} options={TARGETS} />
          <div style={{ marginTop: 10 }}>
            {target === 'CUSTOMER' ? (
              <>
                <CustomerSelect value={customerId} onChange={(id) => setCustomerId(id)} allowCreate={false} placeholder="Tìm khách hàng (SĐT, tên, mã)" />
                <div className="kv-hint" style={{ marginTop: 6 }}>Phiếu thu chuyển khoản ghi có cho khách: trừ vào công nợ đang có, phần dư thành tiền trả trước.</div>
              </>
            ) : (
              <>
                <Select showSearch value={docId} onChange={setDocId} filterOption={false} onSearch={onSearch} loading={searching} style={{ width: '100%' }} size="large" allowClear
                  placeholder={target === 'INVOICE' ? 'Tìm mã hóa đơn, khách hàng, SĐT' : 'Tìm mã đơn đặt hàng, khách hàng'} defaultActiveFirstOption={false}
                  notFoundContent={searching ? 'Đang tìm…' : 'Không tìm thấy'} optionLabelProp="label"
                  options={options.map((o) => ({ value: o.value, label: o.label, render: o }))}
                  optionRender={(o) => <div className="bt-opt"><b>{o.data.label}</b><div className="kv-hint">{(o.data as { render: DocOption }).render.sub}</div></div>} />
                {docId && options.find((o) => o.value === docId) && <div className="bt-picked">{options.find((o) => o.value === docId)!.sub}</div>}
                <div className="kv-hint" style={{ marginTop: 6 }}>{target === 'INVOICE' ? 'Không gõ gì: hiện hóa đơn còn nợ. Tiền vượt số còn nợ ghi có cho khách (khách lẻ: chỉ ghi đúng số còn nợ).' : 'Đơn đang xử lý: tiền ghi thành tiền cọc của đơn.'}{guess && guess.target === target ? ` Đã tìm theo mã ${guess.text} trong nội dung.` : ''}</div>
              </>
            )}
          </div>
          <div className="kv-hint" style={{ margin: '10px 0 4px' }}>Ghi chú phiếu thu</div>
          <Input value={note} onChange={(e) => setNote(e.target.value)} maxLength={500} placeholder={`Chuyển khoản: ${tx.content ?? ''}`.slice(0, 80)} />
        </>
      )}
    </Modal>
  );
}
