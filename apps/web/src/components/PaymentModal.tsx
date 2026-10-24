import { Alert, App, DatePicker, Input, Modal, Select, Table } from 'antd';
import dayjs from 'dayjs';
import { useEffect, useMemo, useState } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import { PURCHASING_KEYS, purchasingApi } from '../api/purchasing';
import { SALES_KEYS, salesApi } from '../api/sales';
import { errMsg } from '../api/client';
import type { Invoice, PurchaseReceipt, PurchaseReturn } from '../api/types';
import { useAuthStore } from '../store/auth';
import { PAYMENT_METHOD_LABEL, d, money, toNum } from '../utils/format';
import { CustomerSelect } from './CustomerSelect';
import { MoneyInput } from './Inputs';
import { SupplierSelect } from './SupplierSelect';

export interface PaymentModalProps {
  open: boolean;
  onClose: () => void;
  onSaved?: () => void;
  /** SUPPLIER: OUT = phiếu chi (trả NCC), IN = NCC hoàn tiền. CUSTOMER: IN = thu nợ khách, OUT = hoàn tiền khách */
  partyType?: 'SUPPLIER' | 'CUSTOMER';
  direction?: 'IN' | 'OUT';
  /** @deprecated use partyId */
  supplierId?: string;
  partyId?: string;
  /** pre-select a document (receipt / return / invoice) to allocate to */
  documentId?: string;
  amount?: number;
}

type DocRow = { id: string; code: string; date: string; total: number; due: number; alloc: number };

/**
 * Reusable phiếu thu / chi modal with an allocation table:
 *  - SUPPLIER OUT → unpaid purchase receipts, SUPPLIER IN → un-refunded purchase returns,
 *  - CUSTOMER IN → unpaid invoices (thu nợ), CUSTOMER OUT → no allocations (hoàn tiền / trả trước).
 * Allocations are auto-filled oldest-first up to the entered amount and can be edited; Σ allocations ≤ amount is enforced client-side.
 */
export function PaymentModal({ open, onClose, onSaved, partyType: party0 = 'SUPPLIER', direction: dir0, supplierId, partyId: party0Id, documentId, amount: amount0 }: PaymentModalProps) {
  const { message } = App.useApp();
  const qc = useQueryClient();
  const branchId = useAuthStore((s) => s.currentBranchId);
  const defaultDir = (pt: 'SUPPLIER' | 'CUSTOMER') => (pt === 'SUPPLIER' ? 'OUT' : 'IN');
  const [partyType, setPartyType] = useState<'SUPPLIER' | 'CUSTOMER'>(party0);
  const [direction, setDirection] = useState<'IN' | 'OUT'>(dir0 ?? defaultDir(party0));
  const [partyId, setPartyId] = useState<string | undefined>(party0Id ?? supplierId);
  const [amount, setAmount] = useState<number>(amount0 ?? 0);
  const [method, setMethod] = useState('CASH');
  const [date, setDate] = useState(dayjs());
  const [reference, setReference] = useState('');
  const [note, setNote] = useState('');
  const [docs, setDocs] = useState<DocRow[]>([]);
  const [loadingDocs, setLoadingDocs] = useState(false);
  const [saving, setSaving] = useState(false);

  useEffect(() => { if (open) { setPartyType(party0); setDirection(dir0 ?? defaultDir(party0)); setPartyId(party0Id ?? supplierId); setAmount(amount0 ?? 0); setMethod('CASH'); setDate(dayjs()); setReference(''); setNote(''); setDocs([]); } }, [open, party0, dir0, party0Id, supplierId, amount0, documentId]);

  // load open documents of the party
  useEffect(() => {
    if (!open || !partyId) { setDocs([]); return; }
    let alive = true;
    setLoadingDocs(true);
    (async () => {
      try {
        let rows: Omit<DocRow, 'alloc'>[] = [];
        if (partyType === 'SUPPLIER' && direction === 'OUT') {
          const r = await purchasingApi.receipts({ supplierId: partyId, unpaid: 'true', pageSize: 100 });
          rows = r.data.map((x: PurchaseReceipt) => ({ id: x.id, code: x.code, date: x.receiptDate, total: toNum(x.totalAmount), due: toNum(x.dueAmount ?? toNum(x.totalAmount) - toNum(x.paidAmount)) }));
        } else if (partyType === 'SUPPLIER') {
          const r = await purchasingApi.returns({ supplierId: partyId, status: 'POSTED', pageSize: 100 });
          rows = r.data.map((x: PurchaseReturn) => ({ id: x.id, code: x.code, date: x.returnDate, total: toNum(x.totalAmount), due: toNum(x.totalAmount) - toNum(x.refundedAmount) })).filter((x) => x.due > 0);
        } else if (direction === 'IN') {
          const r = await salesApi.invoices({ customerId: partyId, unpaid: 'true', pageSize: 100 });
          rows = r.data.map((x: Invoice) => ({ id: x.id, code: x.code, date: x.invoiceDate, total: toNum(x.totalAmount), due: toNum(x.dueAmount ?? toNum(x.totalAmount) - toNum(x.paidAmount)) }));
        }
        rows.sort((a, b) => (documentId ? (a.id === documentId ? -1 : b.id === documentId ? 1 : 0) : 0) || +new Date(a.date) - +new Date(b.date));
        if (!alive) return;
        const total = amount0 ?? (documentId ? rows.find((x) => x.id === documentId)?.due ?? 0 : rows.reduce((s, x) => s + x.due, 0));
        setAmount((a) => (a ? a : total));
        setDocs(autoFill(rows.map((x) => ({ ...x, alloc: 0 })), amount0 ?? total));
      } catch (e) { message.error(errMsg(e)); } finally { if (alive) setLoadingDocs(false); }
    })();
    return () => { alive = false; };
  }, [open, partyId, direction, partyType]);

  const allocated = useMemo(() => docs.reduce((s, x) => s + x.alloc, 0), [docs]);
  const overAlloc = allocated > amount + 1e-6;
  const docType = partyType === 'SUPPLIER' ? (direction === 'OUT' ? 'PURCHASE_RECEIPT' : 'PURCHASE_RETURN') : 'INVOICE';
  const title = partyType === 'SUPPLIER' ? (direction === 'OUT' ? 'Lập phiếu chi – thanh toán nhà cung cấp' : 'Lập phiếu thu – nhà cung cấp hoàn tiền') : (direction === 'IN' ? 'Lập phiếu thu – thu nợ khách hàng' : 'Lập phiếu chi – hoàn tiền khách hàng');

  const submit = async () => {
    if (!branchId) { message.warning('Chọn chi nhánh'); return; }
    if (!partyId) { message.warning(partyType === 'SUPPLIER' ? 'Chọn nhà cung cấp' : 'Chọn khách hàng'); return; }
    if (!(amount > 0)) { message.warning('Nhập số tiền'); return; }
    if (overAlloc) { message.warning('Tổng phân bổ vượt quá số tiền phiếu'); return; }
    setSaving(true);
    try {
      const p = await purchasingApi.createPayment({
        branchId, direction, method, partyType, partyId, amount: String(amount), paymentDate: date.toISOString(), reference: reference || undefined, note: note || undefined,
        allocations: docs.filter((x) => x.alloc > 0).map((x) => ({ documentType: docType as any, documentId: x.id, amount: String(x.alloc) })),
      });
      message.success(`Đã lập ${direction === 'OUT' ? 'phiếu chi' : 'phiếu thu'} ${p.code}`);
      [...PURCHASING_KEYS, ...SALES_KEYS].forEach((k) => qc.invalidateQueries({ queryKey: [k] }));
      onSaved?.();
      onClose();
    } catch (e) { message.error(errMsg(e)); } finally { setSaving(false); }
  };

  return (
    <Modal title={title} open={open} onCancel={onClose} onOk={submit} okText="Lưu phiếu" cancelText="Bỏ qua" confirmLoading={saving} width={760} destroyOnClose>
      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 10 }}>
        <div><div className="kv-hint">Loại phiếu</div>
          <Select style={{ width: '100%' }} value={`${partyType}:${direction}`} onChange={(v) => { const [pt, dir] = v.split(':') as ['SUPPLIER' | 'CUSTOMER', 'IN' | 'OUT']; if (pt !== partyType) setPartyId(undefined); setPartyType(pt); setDirection(dir); setDocs([]); setAmount(0); }}
            options={[{ value: 'SUPPLIER:OUT', label: 'Phiếu chi – trả nhà cung cấp' }, { value: 'SUPPLIER:IN', label: 'Phiếu thu – NCC hoàn tiền' }, { value: 'CUSTOMER:IN', label: 'Phiếu thu – thu nợ khách hàng' }, { value: 'CUSTOMER:OUT', label: 'Phiếu chi – hoàn tiền khách hàng' }]} /></div>
        <div><div className="kv-hint">{partyType === 'SUPPLIER' ? 'Nhà cung cấp' : 'Khách hàng'}</div>
          {partyType === 'SUPPLIER'
            ? <SupplierSelect value={partyId} onChange={(id) => { setPartyId(id); setDocs([]); setAmount(0); }} allowCreate={false} />
            : <CustomerSelect value={partyId} onChange={(id) => { setPartyId(id); setDocs([]); setAmount(0); }} allowCreate={false} />}
        </div>
        <div><div className="kv-hint">Số tiền</div><MoneyInput value={amount} onChange={(v) => { const a = toNum(v); setAmount(a); setDocs((ds) => autoFill(ds.map((x) => ({ ...x, alloc: 0 })), a)); }} /></div>
        <div><div className="kv-hint">Phương thức</div><Select style={{ width: '100%' }} value={method} onChange={setMethod} options={Object.entries(PAYMENT_METHOD_LABEL).map(([value, label]) => ({ value, label }))} /></div>
        <div><div className="kv-hint">Ngày</div><DatePicker style={{ width: '100%' }} format="DD/MM/YYYY HH:mm" showTime value={date} onChange={(v) => v && setDate(v)} /></div>
        <div><div className="kv-hint">Tham chiếu (số UNC, mã GD…)</div><Input value={reference} onChange={(e) => setReference(e.target.value)} /></div>
        <div style={{ gridColumn: '1 / span 2' }}><div className="kv-hint">Ghi chú</div><Input value={note} onChange={(e) => setNote(e.target.value)} /></div>
      </div>
      {!(partyType === 'CUSTOMER' && direction === 'OUT') && (
        <div style={{ marginTop: 12 }}>
          <div className="kv-hint" style={{ marginBottom: 4 }}>{docType === 'PURCHASE_RECEIPT' ? 'Phân bổ vào phiếu nhập còn nợ' : docType === 'PURCHASE_RETURN' ? 'Phân bổ vào phiếu trả hàng chưa hoàn' : 'Phân bổ vào hóa đơn còn nợ'} (phần không phân bổ sẽ trừ vào công nợ chung)</div>
          <Table size="small" rowKey="id" pagination={false} dataSource={docs} loading={loadingDocs} locale={{ emptyText: partyId ? 'Không có chứng từ còn nợ' : partyType === 'SUPPLIER' ? 'Chọn nhà cung cấp' : 'Chọn khách hàng' }} scroll={{ y: 220 }}
            columns={[
              { title: 'Chứng từ', dataIndex: 'code', width: 130 },
              { title: 'Ngày', dataIndex: 'date', width: 100, render: (v) => d(v) },
              { title: 'Tổng', dataIndex: 'total', className: 'num', render: (v) => money(v) },
              { title: 'Còn nợ', dataIndex: 'due', className: 'num', render: (v) => money(v) },
              { title: direction === 'OUT' ? 'Trả cho phiếu này' : 'Thu cho phiếu này', width: 160, render: (_, r) => <MoneyInput size="small" max={r.due} value={r.alloc} onChange={(v) => setDocs((ds) => ds.map((x) => (x.id === r.id ? { ...x, alloc: Math.min(toNum(v), r.due) } : x)))} /> },
            ]}
            summary={() => <Table.Summary.Row><Table.Summary.Cell index={0} colSpan={4}><b>Đã phân bổ / Số tiền</b></Table.Summary.Cell><Table.Summary.Cell index={1} className="num"><b className={overAlloc ? 'neg' : ''}>{money(allocated)} / {money(amount)}</b></Table.Summary.Cell></Table.Summary.Row>} />
          {overAlloc && <Alert type="error" showIcon style={{ marginTop: 8 }} message="Tổng phân bổ vượt quá số tiền phiếu" />}
        </div>
      )}
    </Modal>
  );
}

function autoFill<T extends { due: number; alloc: number }>(rows: T[], amount: number): T[] {
  let left = amount;
  return rows.map((r) => { const a = Math.max(0, Math.min(r.due, left)); left -= a; return { ...r, alloc: a }; });
}
