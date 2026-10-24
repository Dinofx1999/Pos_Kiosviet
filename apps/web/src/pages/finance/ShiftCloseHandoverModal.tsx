import { Alert, App, Descriptions, Input, Modal, Switch, Table, Tag } from 'antd';
import { SwapOutlined } from '@ant-design/icons';
import { useEffect, useMemo, useState } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import { FINANCE_KEYS, ShiftClosed, financeApi, useCashAccounts } from '../../api/finance';
import { useShift } from '../../api/sales';
import { errMsg } from '../../api/client';
import { MoneyInput } from '../../components/Inputs';
import { useCan } from '../../store/auth';
import { PAYMENT_METHOD_LABEL, dt, money, toNum } from '../../utils/format';
import { FundSelect, accessibleFunds, branchDrawer } from './FinanceSelects';
import './finance.css';

/**
 * Close-shift modal (reconciliation summary + counted cash) with the Module 08 "Bàn giao ca" block:
 * hand the counted cash from the branch drawer over to the safe / bank as a cash transfer (BR-72).
 * Lives here because the POS modals file is owned by the POS module.
 */
export function ShiftCloseHandoverModal({ open, shiftId, onClose, onClosed }: { open: boolean; shiftId?: string; onClose: () => void; onClosed?: (s: ShiftClosed) => void }) {
  const { message, modal } = App.useApp();
  const qc = useQueryClient();
  const can = useCan();
  const { data: s, isLoading } = useShift(open ? shiftId : undefined);
  const { data: accounts } = useCashAccounts(false, open);
  const [counted, setCounted] = useState<number | null>(null);
  const [note, setNote] = useState('');
  const [handover, setHandover] = useState(false);
  const [handoverAmount, setHandoverAmount] = useState<number | null>(null); // null = same as counted cash
  const [toAccountId, setToAccountId] = useState<string | undefined>();
  const [saving, setSaving] = useState(false);
  useEffect(() => { if (open) { setCounted(null); setNote(''); setHandover(false); setHandoverAmount(null); setToAccountId(undefined); } }, [open, shiftId]);

  const canHandover = can('cash.transfer');
  const drawer = useMemo(() => (s ? branchDrawer(accounts, s.branchId) : undefined), [accounts, s]);
  // targets: anything except the branch's own cash drawer(s) → bank / e-wallet / tenant-wide safe
  const targets = useMemo(() => (s ? accessibleFunds(accounts, s.branchId).filter((a) => !(a.type === 'CASH' && a.branchId === s.branchId)) : []), [accounts, s]);
  useEffect(() => {
    if (!open || toAccountId || !targets.length) return;
    const pick = targets.find((a) => a.type === 'BANK' && a.isDefault) ?? targets.find((a) => a.type === 'CASH') ?? targets.find((a) => a.type === 'BANK') ?? targets[0];
    setToAccountId(pick?.id);
  }, [open, targets, toAccountId]);

  const expected = toNum(s?.expectedCash);
  const diff = counted === null ? null : counted - expected;
  const effHandover = handover ? (handoverAmount ?? counted ?? 0) : 0;
  const target = targets.find((a) => a.id === toAccountId);
  const handoverError = handover ? (!toAccountId ? 'Chọn quỹ nhận bàn giao' : !(effHandover > 0) ? 'Nhập số tiền bàn giao' : counted !== null && effHandover > counted ? 'Số tiền bàn giao vượt quá tiền mặt đếm được' : drawer && effHandover > toNum(drawer.balance) ? `Két ${drawer.name} chỉ còn ${money(drawer.balance)} trên sổ quỹ` : null) : null;

  const submit = async () => {
    if (!shiftId || counted === null) { message.warning('Nhập số tiền mặt đếm được'); return; }
    if (handoverError) { message.warning(handoverError); return; }
    setSaving(true);
    try {
      const closed = await financeApi.closeShift(shiftId, { countedCash: String(counted), note: note.trim() || undefined, ...(handover && effHandover > 0 ? { handoverAmount: String(effHandover), handoverToAccountId: toAccountId } : {}) });
      FINANCE_KEYS.forEach((k) => qc.invalidateQueries({ queryKey: [k] }));
      message.success(`Đã đóng ca ${closed.code}`);
      const d = toNum(closed.difference);
      modal.success({
        title: `Đã đóng ca ${closed.code}`, okText: 'Xong', width: 420,
        content: (
          <div className="cb-balance-box" style={{ marginTop: 4 }}>
            <div className="line"><span>Tiền mặt dự kiến</span><b>{money(closed.expectedCash)}</b></div>
            <div className="line"><span>Thực đếm</span><b>{money(closed.countedCash)}</b></div>
            <div className="line"><span>Chênh lệch</span><b className={d < 0 ? 'neg' : d > 0 ? 'pos' : ''}>{d > 0 ? '+' : ''}{money(d)}</b></div>
            {closed.handover ? <div className="line"><span>Bàn giao ca</span><b><Tag color="geekblue" style={{ marginInlineEnd: 4 }}>{closed.handover.code}</Tag>{money(closed.handover.amount)} → {target?.name ?? 'quỹ nhận'}</b></div> : <div className="line muted"><span>Bàn giao ca</span><span>Không bàn giao – tiền ở lại két</span></div>}
          </div>
        ),
      });
      onClosed?.(closed); onClose();
    } catch (e) { message.error(errMsg(e)); } finally { setSaving(false); }
  };

  return (
    <Modal title={`Đóng ca ${s?.code ?? ''}`} open={open} onCancel={onClose} onOk={submit} okText={handover && effHandover > 0 ? 'Đóng ca & bàn giao' : 'Đóng ca'} okButtonProps={{ danger: true, disabled: !s || s.status !== 'OPEN' }} cancelText="Bỏ qua" confirmLoading={saving} destroyOnClose width={600}>
      {isLoading || !s ? <div className="muted">Đang tải…</div> : (
        <>
          <Descriptions size="small" column={2} colon={false} labelStyle={{ color: '#6b7280' }}>
            <Descriptions.Item label="Nhân viên">{s.user?.fullName}</Descriptions.Item>
            <Descriptions.Item label="Mở lúc">{dt(s.openedAt)}</Descriptions.Item>
            <Descriptions.Item label="Số hóa đơn">{s.invoices ?? 0}</Descriptions.Item>
            <Descriptions.Item label="Doanh thu">{money(s.revenue)}</Descriptions.Item>
            <Descriptions.Item label="Tiền đầu ca">{money(s.openingCash)}</Descriptions.Item>
            <Descriptions.Item label="Tiền mặt dự kiến"><b>{money(expected)}</b></Descriptions.Item>
          </Descriptions>
          <Table size="small" rowKey="method" pagination={false} dataSource={s.byMethod ?? []} style={{ margin: '8px 0' }} locale={{ emptyText: 'Chưa có thu / chi trong ca' }}
            columns={[{ title: 'Phương thức', dataIndex: 'method', render: (v) => PAYMENT_METHOD_LABEL[v] ?? v }, { title: 'Thu', dataIndex: 'in', className: 'num', render: (v) => money(v) }, { title: 'Chi', dataIndex: 'out', className: 'num', render: (v) => money(v) }, { title: 'Ròng', dataIndex: 'net', className: 'num', render: (v) => <b>{money(v)}</b> }]} />
          <div className="kv-hint" style={{ marginBottom: 4 }}>Tiền mặt thực đếm trong két</div>
          <MoneyInput autoFocus size="large" value={counted ?? undefined} placeholder={money(expected)} onChange={(v) => setCounted(v === null || v === undefined ? null : toNum(v))} />
          {diff !== null && <div style={{ marginTop: 6 }}>Chênh lệch: <b className={diff < 0 ? 'neg' : diff > 0 ? 'pos' : ''}>{diff > 0 ? '+' : ''}{money(diff)}</b></div>}
          <div className="kv-hint" style={{ margin: '8px 0 4px' }}>Ghi chú</div>
          <Input value={note} onChange={(e) => setNote(e.target.value)} placeholder="Lý do chênh lệch, người nhận bàn giao…" />

          {canHandover && (
            <div className="cb-balance-box" style={{ marginTop: 12 }}>
              <div className="line" style={{ alignItems: 'center' }}><b><SwapOutlined /> Bàn giao ca</b><span style={{ display: 'inline-flex', alignItems: 'center', gap: 6 }}>Bàn giao tiền mặt <Switch checked={handover} onChange={setHandover} disabled={!targets.length} /></span></div>
              {!targets.length ? <div className="cb-hint">Chưa có quỹ nhận (két sắt dùng chung / tài khoản ngân hàng). Tạo tại Sổ quỹ → Quỹ tiền.</div> : (
                <div className="cb-hint">Chuyển tiền mặt từ két {drawer ? <b>{drawer.name}</b> : 'của chi nhánh'}{drawer ? ` (sổ quỹ: ${money(drawer.balance)})` : ''} sang két sắt / ngân hàng; tạo phiếu chuyển quỹ gắn với ca này.</div>
              )}
              {handover && targets.length > 0 && (
                <div className="cb-form" style={{ marginTop: 6 }}>
                  <div><div className="kv-hint">Số tiền bàn giao</div><MoneyInput value={handoverAmount ?? counted ?? undefined} placeholder={counted !== null ? money(counted) : 'Nhập thực đếm trước'} onChange={(v) => setHandoverAmount(v === null || v === undefined ? null : toNum(v))} status={handoverError && counted !== null ? 'error' : undefined} /></div>
                  <div><div className="kv-hint">Quỹ nhận</div><FundSelect value={toAccountId} onChange={(id) => setToAccountId(id)} branchId={s.branchId} exclude={accessibleFunds(accounts, s.branchId).filter((a) => a.type === 'CASH' && a.branchId === s.branchId).map((a) => a.id)} placeholder="Két sắt / ngân hàng" /></div>
                  {counted !== null && effHandover > 0 && !handoverError && <div className="full cb-hint">Sau bàn giao: két còn <b>{money((drawer ? toNum(drawer.balance) : counted) - effHandover)}</b>{target ? <> · {target.name} có <b>{money(toNum(target.balance) + effHandover)}</b></> : null}</div>}
                  {handoverError && counted !== null && <div className="full"><Alert type="warning" showIcon message={handoverError} /></div>}
                </div>
              )}
            </div>
          )}
        </>
      )}
    </Modal>
  );
}
