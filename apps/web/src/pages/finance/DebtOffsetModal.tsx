import { Alert, App, Button, Input, Modal, Result } from 'antd';
import { SwapOutlined } from '@ant-design/icons';
import { useEffect, useState } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import { DebtOffsetResult, FINANCE_KEYS, financeApi } from '../../api/finance';
import { errMsg } from '../../api/client';
import type { CustomerHit, Supplier } from '../../api/types';
import { CustomerSelect } from '../../components/CustomerSelect';
import { MoneyInput } from '../../components/Inputs';
import { SupplierSelect } from '../../components/SupplierSelect';
import { useAuthStore } from '../../store/auth';
import { money, toNum } from '../../utils/format';
import './finance.css';

/**
 * Cấn trừ công nợ khách hàng ↔ nhà cung cấp (BR-74): a customer who owes us and is also a supplier we owe.
 * Creates two OFFSET vouchers (IN for the customer, OUT for the supplier); shows both balances after.
 */
export function DebtOffsetModal({ open, onClose, onSaved }: { open: boolean; onClose: () => void; onSaved?: (r: DebtOffsetResult) => void }) {
  const { message } = App.useApp();
  const qc = useQueryClient();
  const branchId = useAuthStore((s) => s.currentBranchId);
  const [customerId, setCustomerId] = useState<string | undefined>();
  const [customer, setCustomer] = useState<CustomerHit | undefined>();
  const [supplierId, setSupplierId] = useState<string | undefined>();
  const [supplier, setSupplier] = useState<Supplier | undefined>();
  const [amount, setAmount] = useState(0);
  const [note, setNote] = useState('');
  const [saving, setSaving] = useState(false);
  const [result, setResult] = useState<DebtOffsetResult | null>(null);
  useEffect(() => { if (open) { setCustomerId(undefined); setCustomer(undefined); setSupplierId(undefined); setSupplier(undefined); setAmount(0); setNote(''); setResult(null); } }, [open]);

  const custBal = customer?.balance !== undefined ? toNum(customer.balance) : undefined;
  const supBal = supplier?.balance !== undefined ? toNum(supplier.balance) : undefined;
  const maxOffset = custBal !== undefined && supBal !== undefined ? Math.max(0, Math.min(custBal, supBal)) : undefined;
  const submit = async () => {
    if (!branchId) { message.warning('Chọn chi nhánh'); return; }
    if (!customerId) { message.warning('Chọn khách hàng'); return; }
    if (!supplierId) { message.warning('Chọn nhà cung cấp'); return; }
    if (!(amount > 0)) { message.warning('Nhập số tiền cấn trừ'); return; }
    setSaving(true);
    try {
      const r = await financeApi.debtOffset({ branchId, customerId, supplierId, amount: String(amount), note: note.trim() || undefined });
      FINANCE_KEYS.forEach((k) => qc.invalidateQueries({ queryKey: [k] }));
      message.success(`Đã cấn trừ ${money(r.amount)} · ${r.vouchers.join(' + ')}`);
      setResult(r); onSaved?.(r);
    } catch (e) { message.error(errMsg(e)); } finally { setSaving(false); }
  };

  return (
    <Modal title={<span><SwapOutlined /> Cấn trừ công nợ khách hàng ↔ nhà cung cấp</span>} open={open} onCancel={onClose} width={600} destroyOnClose
      footer={result ? <Button type="primary" onClick={onClose}>Đóng</Button> : undefined} onOk={submit} okText="Cấn trừ" cancelText="Bỏ qua" confirmLoading={saving}>
      {result ? (
        <Result status="success" title={`Đã cấn trừ ${money(result.amount)}`} subTitle={`Phiếu: ${result.vouchers.join(' + ')}`}
          extra={<div className="cb-balance-box" style={{ textAlign: 'left' }}>
            <div className="line"><span>Khách hàng {result.customer.name} còn nợ</span><b className={toNum(result.customer.balanceAfter) > 0 ? 'neg' : ''}>{money(result.customer.balanceAfter)}</b></div>
            <div className="line"><span>Còn nợ nhà cung cấp {result.supplier.name}</span><b className={toNum(result.supplier.balanceAfter) > 0 ? 'neg' : ''}>{money(result.supplier.balanceAfter)}</b></div>
          </div>} />
      ) : (
        <>
          <Alert type="info" showIcon style={{ marginBottom: 10 }} message="Dùng khi một đối tác vừa là khách hàng đang nợ cửa hàng, vừa là nhà cung cấp cửa hàng đang nợ. Số tiền cấn trừ được trừ đồng thời vào cả hai công nợ, không phát sinh tiền mặt." />
          <div className="cb-form">
            <div className="full"><div className="kv-hint">Khách hàng (đang nợ cửa hàng)</div><CustomerSelect value={customerId} onChange={(id, c) => { setCustomerId(id); setCustomer(c); }} allowCreate={false} />
              {custBal !== undefined && <div className="cb-hint" style={{ marginTop: 4 }}>Khách đang nợ: <b className={custBal > 0 ? 'neg' : ''}>{money(custBal)}</b></div>}</div>
            <div className="full"><div className="kv-hint">Nhà cung cấp (cửa hàng đang nợ)</div><SupplierSelect value={supplierId} onChange={(id, s) => { setSupplierId(id); setSupplier(s); }} allowCreate={false} />
              {supBal !== undefined && <div className="cb-hint" style={{ marginTop: 4 }}>Đang nợ NCC: <b className={supBal > 0 ? 'neg' : ''}>{money(supBal)}</b></div>}</div>
            <div><div className="kv-hint">Số tiền cấn trừ{maxOffset !== undefined ? ` (tối đa ${money(maxOffset)})` : ''}</div>
              <MoneyInput size="large" value={amount || undefined} placeholder="0" onChange={(v) => setAmount(toNum(v))} />
              {maxOffset !== undefined && maxOffset > 0 && amount !== maxOffset && <Button type="link" size="small" style={{ padding: 0 }} onClick={() => setAmount(maxOffset)}>Cấn trừ tối đa {money(maxOffset)}</Button>}
              {maxOffset !== undefined && amount > maxOffset && <div className="neg cb-hint">Vượt quá công nợ của một trong hai bên</div>}</div>
            <div><div className="kv-hint">Ghi chú</div><Input value={note} onChange={(e) => setNote(e.target.value)} placeholder="Mặc định: Cấn trừ công nợ A ↔ B" /></div>
            {custBal !== undefined && supBal !== undefined && amount > 0 && (
              <div className="full cb-balance-box">
                <div className="line"><span>Khách còn nợ sau cấn trừ</span><b>{money(custBal - amount)}</b></div>
                <div className="line"><span>Còn nợ NCC sau cấn trừ</span><b>{money(supBal - amount)}</b></div>
              </div>
            )}
          </div>
        </>
      )}
    </Modal>
  );
}
