import { Alert, Button, Card, DatePicker, Empty, Modal, Pagination, Segmented, Skeleton, Table, Tabs, Tag, Tooltip } from 'antd';
import { MinusCircleOutlined, PlusCircleOutlined, ReloadOutlined, SettingOutlined, SwapOutlined } from '@ant-design/icons';
import dayjs, { Dayjs } from 'dayjs';
import { useEffect, useMemo, useState } from 'react';
import { Link, useSearchParams } from 'react-router-dom';
import { CASH_ACCOUNT_TYPE_COLOR, CASH_ACCOUNT_TYPE_LABEL, CASH_KIND_LABEL, CashbookEntry, useCashAccounts, useCashBook, useCashSummary } from '../../api/finance';
import { errMsg } from '../../api/client';
import { useIsMobile } from '../../hooks/useMedia';
import { useAuthStore, useCan } from '../../store/auth';
import { dt, money } from '../../utils/format';
import { DebtOffsetModal } from './DebtOffsetModal';
import { FundSelect, branchDrawer } from './FinanceSelects';
import { ExportButton } from '../reports/ReportShared';
import { METHOD_LABEL, VoucherCard, VoucherDetail, describeVoucher } from './VoucherDetail';
import { VoucherModal } from './VoucherModal';
import './finance.css';

type Dir = '' | 'IN' | 'OUT';

/** KiotViet "Sổ quỹ": running balance of one fund over a period + totals per fund / kind. */
export default function CashbookPage() {
  const can = useCan();
  const isMobile = useIsMobile();
  const [sp, setSp] = useSearchParams();
  const branchId = useAuthStore((s) => s.currentBranchId);
  const { data: accounts, isLoading: loadingAccounts } = useCashAccounts();
  const [accountId, setAccountId] = useState<string | undefined>(sp.get('accountId') ?? undefined);
  const [range, setRange] = useState<[Dayjs, Dayjs]>([dayjs().startOf('month'), dayjs().endOf('day')]);
  const [direction, setDirection] = useState<Dir>('');
  const [page, setPage] = useState(1);
  const [pageSize, setPageSize] = useState(20);
  const [tab, setTab] = useState('book');
  const [voucher, setVoucher] = useState<{ open: boolean; direction: 'IN' | 'OUT' }>({ open: false, direction: 'IN' });
  const [offset, setOffset] = useState(false);
  const [detailId, setDetailId] = useState<string | undefined>();
  useEffect(() => { const id = sp.get('accountId'); if (id) setAccountId(id); }, [sp]);

  const defaultId = useMemo(() => branchDrawer(accounts, branchId)?.id, [accounts, branchId]);
  const effectiveId = accountId && accounts?.some((a) => a.id === accountId) ? accountId : defaultId;
  const account = accounts?.find((a) => a.id === effectiveId);
  const period = { from: range[0].toISOString(), to: range[1].toISOString() };
  const { data, isLoading, isFetching, error, refetch } = useCashBook({ accountId: effectiveId, from: period.from, to: period.to, direction: direction || undefined, page, pageSize }, !!accounts);
  const { data: summary, isLoading: loadingSummary, error: summaryError } = useCashSummary({ ...period, branchId: branchId ?? undefined }, tab === 'summary');
  const rows = data?.data ?? [];
  const hasRunning = !!data?.account;
  const canVoucher = can('payment.create') || can('payment.other');
  const canOffset = can('debt.offset');
  const pickFund = (id?: string) => { setAccountId(id); setPage(1); if (id) setSp({ accountId: id }, { replace: true }); else setSp({}, { replace: true }); };

  const stats = (
    <div className="cb-stats">
      <div className="cb-stat"><div className="lbl">Quỹ đầu kỳ</div><div className="val">{hasRunning ? money(data?.openingBalance) : '—'}</div><div className="sub">{range[0].format('DD/MM/YYYY')}</div></div>
      <div className="cb-stat in"><div className="lbl">Tổng thu</div><div className="val">{hasRunning ? `+${money(data?.totalIn)}` : '—'}</div><div className="sub">trong kỳ</div></div>
      <div className="cb-stat out"><div className="lbl">Tổng chi</div><div className="val">{hasRunning ? `−${money(data?.totalOut)}` : '—'}</div><div className="sub">trong kỳ</div></div>
      <div className="cb-stat bal"><div className="lbl">Tồn quỹ cuối kỳ</div><div className="val">{hasRunning ? money(data?.closingBalance) : '—'}</div><div className="sub">{account ? `Số dư hiện tại: ${money(account.balance)}` : range[1].format('DD/MM/YYYY')}</div></div>
    </div>
  );

  const bookTable = (
    <Table className="kv-table" rowKey="id" size="small" loading={isLoading} dataSource={rows} scroll={{ x: 980 }}
      locale={{ emptyText: error ? <Empty description={errMsg(error)} /> : <Empty description="Không có phiếu thu / chi trong kỳ" /> }}
      expandable={{ expandedRowRender: (r) => <VoucherDetail id={r.id} />, expandRowByClick: true }}
      onChange={(p) => { setPage(p.current ?? 1); setPageSize(p.pageSize ?? 20); }}
      pagination={{ current: page, pageSize, total: data?.meta.total ?? 0, showSizeChanger: true, pageSizeOptions: [20, 50, 100], showTotal: (t) => `${t} phiếu` }}
      columns={[
        { title: 'Mã phiếu', dataIndex: 'code', width: 120, render: (v) => <b>{v}</b> },
        { title: 'Thời gian', dataIndex: 'paymentDate', width: 130, render: (v) => dt(v) },
        { title: 'Loại', width: 130, render: (_, r) => { const d = describeVoucher(r); return <Tag color={d.color}>{d.label}</Tag>; } },
        { title: 'Đối tượng / diễn giải', ellipsis: true, render: (_, r) => { const d = describeVoucher(r); return <span>{d.who || <span className="muted">—</span>}{d.who && r.note && d.who !== r.note ? <div className="kv-hint">{r.note}</div> : null}</span>; } },
        { title: 'Phương thức', dataIndex: 'method', width: 110, render: (v) => METHOD_LABEL[v] ?? v },
        ...(hasRunning ? [] : [{ title: 'Quỹ', width: 160, render: (_: unknown, r: CashbookEntry) => r.cashAccount?.name ?? <span className="muted">—</span> }]),
        { title: 'Thu', className: 'num', width: 120, render: (_, r) => (r.direction === 'IN' ? <b className="pos">{money(r.amount)}</b> : '') },
        { title: 'Chi', className: 'num', width: 120, render: (_, r) => (r.direction === 'OUT' ? <b className="neg">{money(r.amount)}</b> : '') },
        ...(hasRunning ? [{ title: 'Tồn quỹ', className: 'num', width: 130, render: (_: unknown, r: CashbookEntry) => <b>{money(r.balanceAfter)}</b> }] : []),
      ]} />
  );

  const bookCards = (
    <div className="cb-cards">
      {isLoading ? <Skeleton active /> : rows.length === 0 ? <Empty className="cb-empty" description={error ? errMsg(error) : 'Không có phiếu thu / chi trong kỳ'} /> : rows.map((r) => (
        <VoucherCard key={r.id} p={r} balanceAfter={hasRunning ? r.balanceAfter : undefined} fundName={hasRunning ? undefined : r.cashAccount?.name} onClick={() => setDetailId(r.id)} />
      ))}
      {(data?.meta.total ?? 0) > pageSize && <div className="cb-pager"><Pagination simple current={page} pageSize={pageSize} total={data?.meta.total ?? 0} onChange={(p) => setPage(p)} /></div>}
    </div>
  );

  const summaryTab = (
    <div>
      {summaryError && <Alert type="error" showIcon message={errMsg(summaryError)} style={{ marginBottom: 10 }} />}
      {loadingSummary || !summary ? <Skeleton active /> : (
        <>
          <div className="cb-stats" style={{ gridTemplateColumns: isMobile ? 'repeat(3, minmax(0, 1fr))' : undefined }}>
            <div className="cb-stat in"><div className="lbl">Tổng thu</div><div className="val">{money(summary.totals.in)}</div><div className="sub">không tính chuyển quỹ</div></div>
            <div className="cb-stat out"><div className="lbl">Tổng chi</div><div className="val">{money(summary.totals.out)}</div><div className="sub">không tính chuyển quỹ</div></div>
            <div className="cb-stat bal"><div className="lbl">Thu − chi</div><div className="val">{money(summary.totals.net)}</div><div className="sub">{dayjs(summary.from).format('DD/MM')} – {dayjs(summary.to).format('DD/MM')}</div></div>
          </div>
          <Card size="small" title="Theo quỹ tiền" style={{ marginBottom: 12 }}>
            <Table size="small" rowKey={(r) => r.accountId ?? 'none'} pagination={false} dataSource={summary.byAccount} scroll={{ x: 520 }} locale={{ emptyText: 'Không có phát sinh' }}
              columns={[
                { title: 'Quỹ', render: (_, r) => r.accountId ? <Link to={`/cash?accountId=${r.accountId}`} onClick={() => { pickFund(r.accountId!); setTab('book'); }}>{r.name}</Link> : <span className="muted">{r.name}</span> },
                { title: 'Thu', dataIndex: 'totalIn', className: 'num', width: 130, render: (v) => <span className="pos">{money(v)}</span> },
                { title: 'Chi', dataIndex: 'totalOut', className: 'num', width: 130, render: (v) => <span className="neg">{money(v)}</span> },
                { title: 'Số dư hiện tại', dataIndex: 'balance', className: 'num', width: 140, render: (v) => (v === null ? '—' : <b>{money(v)}</b>) },
              ]} />
          </Card>
          <Card size="small" title="Theo loại thu / chi">
            <Table size="small" rowKey={(r) => `${r.direction}-${r.kind}-${r.label ?? ''}`} pagination={false} dataSource={summary.byKind} scroll={{ x: 520 }} locale={{ emptyText: 'Không có phát sinh' }}
              columns={[
                { title: 'Loại', width: 90, dataIndex: 'direction', render: (v) => <Tag color={v === 'IN' ? 'green' : 'orange'}>{v === 'IN' ? 'Thu' : 'Chi'}</Tag> },
                { title: 'Nhóm', render: (_, r) => <span>{CASH_KIND_LABEL[r.kind] ?? r.kind}{r.label ? <span className="muted"> · {r.label}</span> : null}</span> },
                { title: 'Số phiếu', dataIndex: 'count', className: 'num', width: 90 },
                { title: 'Số tiền', dataIndex: 'amount', className: 'num', width: 140, render: (v, r) => <b className={r.direction === 'IN' ? 'pos' : 'neg'}>{money(v)}</b> },
              ]} />
          </Card>
        </>
      )}
    </div>
  );

  return (
    <div className={`cb-page${isMobile && (canVoucher || canOffset) ? ' has-bar' : ''}`}>
      <h1 className="kv-page-title">Sổ quỹ{account ? <span className="muted" style={{ fontWeight: 400, fontSize: 14 }}> · {account.name}</span> : null}</h1>
      <div className="cb-toolbar">
        <FundSelect className="cb-grow" style={{ maxWidth: isMobile ? undefined : 320 }} value={effectiveId} onChange={(id) => pickFund(id)} includeInactive placeholder={loadingAccounts ? 'Đang tải quỹ…' : 'Chọn quỹ tiền'} />
        <DatePicker.RangePicker className="cb-half" value={range} format="DD/MM/YYYY" allowClear={false} onChange={(r) => { if (r?.[0] && r?.[1]) { setRange([r[0].startOf('day'), r[1].endOf('day')]); setPage(1); } }}
          presets={[{ label: 'Hôm nay', value: [dayjs().startOf('day'), dayjs().endOf('day')] }, { label: 'Tuần này', value: [dayjs().startOf('week'), dayjs().endOf('day')] }, { label: 'Tháng này', value: [dayjs().startOf('month'), dayjs().endOf('day')] }, { label: 'Tháng trước', value: [dayjs().subtract(1, 'month').startOf('month'), dayjs().subtract(1, 'month').endOf('month')] }]} />
        <Segmented className="cb-half" value={direction} onChange={(v) => { setDirection(v as Dir); setPage(1); }} options={[{ value: '', label: 'Tất cả' }, { value: 'IN', label: 'Thu' }, { value: 'OUT', label: 'Chi' }]} />
        <ExportButton query={{ type: 'cashbook', accountId: effectiveId, from: period.from, to: period.to }} disabled={!effectiveId} />
        {!isMobile && <span className="cb-spacer" />}
        {!isMobile && canVoucher && <Button type="primary" icon={<PlusCircleOutlined />} onClick={() => setVoucher({ open: true, direction: 'IN' })}>Lập phiếu thu</Button>}
        {!isMobile && canVoucher && <Button icon={<MinusCircleOutlined />} onClick={() => setVoucher({ open: true, direction: 'OUT' })}>Lập phiếu chi</Button>}
        {!isMobile && canOffset && <Button icon={<SwapOutlined />} onClick={() => setOffset(true)}>Cấn trừ công nợ</Button>}
        <Tooltip title="Quỹ tiền / tài khoản"><Link to="/cash/accounts"><Button icon={<SettingOutlined />} /></Link></Tooltip>
        <Button icon={<ReloadOutlined />} onClick={() => refetch()} loading={isFetching} />
      </div>
      {!loadingAccounts && accounts && accounts.length === 0 && <Alert type="warning" showIcon style={{ marginBottom: 10 }} message="Chưa có quỹ tiền nào" description={<span>Tạo két tiền mặt / tài khoản ngân hàng tại <Link to="/cash/accounts">Quỹ tiền / Tài khoản</Link> để theo dõi tồn quỹ.</span>} />}
      {account && !account.isActive && <Alert type="info" showIcon style={{ marginBottom: 10 }} message={`Quỹ ${account.name} đã ngừng sử dụng – chỉ xem lịch sử.`} />}
      {account && <div className="cb-hint" style={{ marginBottom: 8 }}><Tag color={CASH_ACCOUNT_TYPE_COLOR[account.type]}>{CASH_ACCOUNT_TYPE_LABEL[account.type]}</Tag>{account.code}{account.branch ? ` · ${account.branch.name}` : ' · dùng chung'}{account.bankName ? ` · ${account.bankName}${account.accountNumber ? ` ${account.accountNumber}` : ''}` : ''}</div>}
      {tab === 'book' && stats}
      <Tabs className="cb-tabs" activeKey={tab} onChange={setTab} items={[
        { key: 'book', label: 'Sổ quỹ', children: isMobile ? bookCards : <div className="kv-card">{bookTable}</div> },
        { key: 'summary', label: 'Tổng hợp theo quỹ', children: summaryTab },
      ]} />
      {isMobile && (canVoucher || canOffset) && (
        <div className="cb-bar">
          {canVoucher && <Button type="primary" icon={<PlusCircleOutlined />} onClick={() => setVoucher({ open: true, direction: 'IN' })}>Phiếu thu</Button>}
          {canVoucher && <Button icon={<MinusCircleOutlined />} onClick={() => setVoucher({ open: true, direction: 'OUT' })}>Phiếu chi</Button>}
          {canOffset && <Button icon={<SwapOutlined />} onClick={() => setOffset(true)}>Cấn trừ</Button>}
        </div>
      )}
      <VoucherModal open={voucher.open} direction={voucher.direction} defaultAccountId={effectiveId} onClose={() => setVoucher((v) => ({ ...v, open: false }))} />
      <DebtOffsetModal open={offset} onClose={() => setOffset(false)} />
      <Modal open={!!detailId} onCancel={() => setDetailId(undefined)} footer={null} title={rows.find((r) => r.id === detailId)?.code ?? 'Chi tiết phiếu'} destroyOnClose width={720}>
        {detailId && <VoucherDetail id={detailId} onDone={() => setDetailId(undefined)} />}
      </Modal>
      {!hasRunning && rows.length > 0 && <div className="cb-hint" style={{ marginTop: 6 }}>Chọn một quỹ để xem tồn quỹ lũy kế theo từng phiếu.</div>}
    </div>
  );
}
