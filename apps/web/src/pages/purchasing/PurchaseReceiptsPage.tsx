import { App, Button, DatePicker, Descriptions, Empty, Input, Radio, Select, Tabs, Tag } from 'antd';
import Table from '../../components/ResponsiveTable';
import { CheckOutlined, DeleteOutlined, DollarOutlined, EditOutlined, PlusOutlined, PrinterOutlined, ReloadOutlined, RollbackOutlined, SearchOutlined, StopOutlined } from '@ant-design/icons';
import { useState } from 'react';
import { Link, useNavigate, useSearchParams } from 'react-router-dom';
import { useQueryClient } from '@tanstack/react-query';
import { PURCHASING_KEYS, ReceiptQuery, purchasingApi, usePurchaseReceipt, usePurchaseReceipts } from '../../api/purchasing';
import { errMsg } from '../../api/client';
import type { PurchaseReceipt } from '../../api/types';
import { FilterCard, FilterPanel } from '../../components/FilterPanel';
import { PaymentModal } from '../../components/PaymentModal';
import { SupplierSelect } from '../../components/SupplierSelect';
import { useAuthStore, useBranchWarehouses, useCan } from '../../store/auth';
import { DOC_STATUS_COLOR, MOVEMENT_LABEL, PAYMENT_METHOD_LABEL, PDOC_STATUS_LABEL, dt, money, pct, qty, signedQty } from '../../utils/format';
import { PostReceiptModal } from './PostReceiptModal';

export default function PurchaseReceiptsPage() {
  const can = useCan();
  const nav = useNavigate();
  const [sp] = useSearchParams();
  const warehouses = useBranchWarehouses();
  const branchId = useAuthStore((s) => s.currentBranchId);
  const [q, setQ] = useState<ReceiptQuery>({ page: 1, pageSize: 20, search: sp.get('search') ?? undefined, supplierId: sp.get('supplierId') ?? undefined });
  const [searchText, setSearchText] = useState(q.search ?? '');
  const { data, isLoading, isFetching, error, refetch } = usePurchaseReceipts({ ...q, branchId: branchId ?? undefined });
  const set = (patch: Partial<ReceiptQuery>) => setQ((s) => ({ ...s, ...patch, page: patch.page ?? 1 }));

  return (
    <div className="kv-list">
      <FilterPanel>
        <FilterCard title="Trạng thái"><Radio.Group value={q.status ?? ''} onChange={(e) => set({ status: e.target.value || undefined })}><Radio value="">Tất cả</Radio><Radio value="DRAFT">Phiếu tạm</Radio><Radio value="POSTED">Hoàn thành</Radio><Radio value="CANCELLED">Đã hủy</Radio></Radio.Group></FilterCard>
        <FilterCard title="Công nợ"><Radio.Group value={q.unpaid ?? ''} onChange={(e) => set({ unpaid: e.target.value || undefined })}><Radio value="">Tất cả</Radio><Radio value="true">Còn nợ</Radio></Radio.Group></FilterCard>
        <FilterCard title="Nhà cung cấp"><SupplierSelect size="small" value={q.supplierId} onChange={(v) => set({ supplierId: v })} allowCreate={false} placeholder="Tất cả" /></FilterCard>
        <FilterCard title="Kho"><Select size="small" allowClear style={{ width: '100%' }} placeholder="Tất cả kho" value={q.warehouseId} onChange={(v) => set({ warehouseId: v })} options={warehouses.map((w) => ({ value: w.id, label: w.name }))} /></FilterCard>
        <FilterCard title="Ngày nhập"><DatePicker.RangePicker size="small" style={{ width: '100%' }} format="DD/MM/YYYY" onChange={(r) => set({ from: r?.[0]?.startOf('day').toISOString(), to: r?.[1]?.endOf('day').toISOString() })} /></FilterCard>
      </FilterPanel>
      <div className="kv-main">
        <h1 className="kv-page-title">Nhập hàng</h1>
        <div className="kv-toolbar">
          <Input.Search className="kv-search" allowClear placeholder="Theo mã phiếu, số HĐ NCC, nhà cung cấp, hàng hóa" value={searchText} onChange={(e) => setSearchText(e.target.value)} onSearch={(v) => set({ search: v || undefined })} enterButton={<SearchOutlined />} />
          <span className="spacer" />
          {can('purchase.receipt.create') && <Button type="primary" icon={<PlusOutlined />} onClick={() => nav('/purchase-receipts/new')}>Nhập hàng</Button>}
          {can('purchase.order.view') && <Button onClick={() => nav('/purchase-orders')}>Đặt hàng nhập</Button>}
          <Button icon={<ReloadOutlined />} onClick={() => refetch()} loading={isFetching} />
        </div>
        <div className="kv-card">
          <Table className="kv-table" rowKey="id" size="small" loading={isLoading} dataSource={data?.data ?? []} rowSelection={{}} scroll={{ x: 1300 }}
            locale={{ emptyText: error ? <Empty description={errMsg(error)} /> : <Empty description="Chưa có phiếu nhập hàng" /> }}
            expandable={{ expandedRowRender: (r) => <PurchaseReceiptDetail id={r.id} />, expandRowByClick: true }}
            onChange={(p) => set({ page: p.current, pageSize: p.pageSize })}
            pagination={{ current: q.page, pageSize: q.pageSize, total: data?.meta.total ?? 0, showSizeChanger: true, pageSizeOptions: [15, 20, 50, 100], showTotal: (t) => `${t} phiếu` }}
            columns={[
              { title: 'Mã PN', dataIndex: 'code', width: 130, render: (v) => <b>{v}</b> },
              { title: 'Nhà cung cấp', render: (_, r) => r.supplier?.name },
              { title: 'Kho', render: (_, r) => r.warehouse?.name, width: 130 },
              { title: 'Ngày nhập', dataIndex: 'receiptDate', width: 120, render: (v) => dt(v) },
              { title: 'Tổng tiền', dataIndex: 'totalAmount', className: 'num', width: 130, render: (v) => money(v) },
              { title: 'Đã trả', dataIndex: 'paidAmount', className: 'num', width: 120, render: (v) => money(v) },
              { title: 'Còn nợ', dataIndex: 'dueAmount', className: 'num', width: 120, render: (v, r) => <span className={r.status === 'POSTED' && Number(v) > 0 ? 'neg' : ''}>{r.status === 'POSTED' ? money(v) : '—'}</span> },
              { title: 'Trạng thái', dataIndex: 'status', width: 110, render: (v) => <Tag color={DOC_STATUS_COLOR[v]}>{PDOC_STATUS_LABEL[v]}</Tag> },
              { title: 'Ghi chú', dataIndex: 'note', ellipsis: true },
            ]} />
        </div>
      </div>
    </div>
  );
}

export function PurchaseReceiptDetail({ id }: { id: string }) {
  const { data: r, isLoading } = usePurchaseReceipt(id);
  const can = useCan();
  const nav = useNavigate();
  const qc = useQueryClient();
  const { message, modal } = App.useApp();
  const [tab, setTab] = useState('info');
  const [pay, setPay] = useState(false);
  const [posting, setPosting] = useState(false);
  if (isLoading || !r) return <div className="muted">Đang tải…</div>;
  const refresh = () => PURCHASING_KEYS.forEach((k) => qc.invalidateQueries({ queryKey: [k] }));
  const canCost = can('product.cost.view') || can('inventory.cost.view');
  const cancel = () => { let reason = ''; modal.confirm({ title: `Hủy phiếu nhập ${r.code}?`, content: <div>Tồn kho và công nợ nhà cung cấp sẽ được ghi đảo. Phiếu đã thanh toán hoặc đã có trả hàng phải hủy các phiếu đó trước.<Input.TextArea style={{ marginTop: 8 }} placeholder="Lý do hủy (bắt buộc)" onChange={(e) => (reason = e.target.value)} /></div>, okText: 'Hủy phiếu', okButtonProps: { danger: true }, cancelText: 'Bỏ qua', onOk: async () => { if (!reason.trim()) { message.warning('Nhập lý do'); throw new Error('reason'); } try { await purchasingApi.cancelReceipt(r.id, reason.trim()); message.success('Đã hủy phiếu'); refresh(); } catch (e) { message.error(errMsg(e)); throw e; } } }); };
  const remove = () => modal.confirm({ title: `Xóa phiếu tạm ${r.code}?`, okText: 'Xóa', okButtonProps: { danger: true }, cancelText: 'Bỏ qua', onOk: async () => { try { await purchasingApi.deleteReceipt(r.id); message.success('Đã xóa'); qc.removeQueries({ queryKey: ['purchase-receipt', r.id] }); qc.invalidateQueries({ queryKey: ['purchase-receipts'] }); qc.invalidateQueries({ queryKey: ['purchase-order'] }); } catch (e) { message.error(errMsg(e)); } } });
  const print = () => printReceipt(r, message);
  return (
    <div className="kv-expanded">
      <Tabs className="kv-detail-tabs" activeKey={tab} onChange={setTab} items={[
        { key: 'info', label: 'Thông tin', children: (
          <div>
            <Descriptions size="small" column={{ xs: 1, md: 3 }} colon={false} labelStyle={{ color: '#6b7280' }}>
              <Descriptions.Item label="Mã phiếu"><b>{r.code}</b></Descriptions.Item>
              <Descriptions.Item label="Trạng thái"><Tag color={DOC_STATUS_COLOR[r.status]}>{PDOC_STATUS_LABEL[r.status]}</Tag></Descriptions.Item>
              <Descriptions.Item label="Nhà cung cấp"><Link to={`/suppliers?search=${r.supplier?.code}`}>{r.supplier?.name}</Link></Descriptions.Item>
              <Descriptions.Item label="Chi nhánh / Kho">{r.branch?.name} / {r.warehouse?.name}</Descriptions.Item>
              <Descriptions.Item label="Ngày nhập">{dt(r.receiptDate)}</Descriptions.Item>
              <Descriptions.Item label="Số HĐ NCC">{r.supplierInvoiceNo || '—'}</Descriptions.Item>
              {r.order && <Descriptions.Item label="Từ đơn đặt hàng"><Link to={`/purchase-orders?search=${r.order.code}`}>{r.order.code}</Link></Descriptions.Item>}
              {r.postedAt && <Descriptions.Item label="Hoàn thành lúc">{dt(r.postedAt)}</Descriptions.Item>}
              {r.cancelledAt && <Descriptions.Item label="Hủy lúc">{dt(r.cancelledAt)} · {r.cancelReason}</Descriptions.Item>}
              <Descriptions.Item label="Ghi chú">{r.note || '—'}</Descriptions.Item>
            </Descriptions>
            <Table size="small" rowKey="id" pagination={false} dataSource={r.lines ?? []} style={{ marginTop: 8 }} scroll={{ x: 1000 }}
              columns={[
                { title: '#', dataIndex: 'lineNo', width: 40 },
                { title: 'Mã hàng', render: (_, l) => l.variant.sku, width: 120 },
                { title: 'Tên hàng', render: (_, l) => <span>{l.variant.name}{l.batch && <Tag style={{ marginLeft: 6 }} color="gold">Lô {l.batch.batchNo}</Tag>}</span> },
                { title: 'ĐVT', render: (_, l) => l.variant.product.baseUnit ?? '', width: 60 },
                { title: 'SL', dataIndex: 'quantity', className: 'num', width: 80, render: (v) => qty(v) },
                { title: 'Đơn giá', dataIndex: 'unitPrice', className: 'num', width: 110, render: (v) => money(v) },
                { title: 'CK', dataIndex: 'discountAmount', className: 'num', width: 90, render: (v) => money(v) },
                { title: 'Thuế', dataIndex: 'taxRate', className: 'num', width: 70, render: (v, l) => <span>{pct(v) || '0%'}<div className="kv-hint">{money(l.taxAmount)}</div></span> },
                { title: 'Thành tiền', dataIndex: 'lineTotal', className: 'num', width: 120, render: (v) => money(v) },
                ...(canCost ? [{ title: 'Giá vốn/đv', dataIndex: 'unitCost', className: 'num', width: 110, render: (v: string) => money(v) }] : []),
                ...(r.status === 'POSTED' ? [{ title: 'Đã trả NCC', dataIndex: 'returnedQuantity', className: 'num', width: 90, render: (v: string) => qty(v) }] : []),
              ]} />
            <div style={{ display: 'flex', gap: 24, flexWrap: 'wrap', marginTop: 8 }}>
              <div style={{ flex: '1 1 280px' }}>
                {(r.costs?.length ?? 0) > 0 && <Table size="small" rowKey={(c) => c.id ?? c.name} pagination={false} dataSource={r.costs} title={() => <b>Chi phí nhập hàng</b>}
                  columns={[{ title: 'Khoản chi phí', dataIndex: 'name' }, { title: 'Phân bổ', dataIndex: 'allocationMethod', render: (v) => (v === 'BY_QUANTITY' ? 'Theo số lượng' : 'Theo giá trị') }, { title: 'Trả cho', dataIndex: 'payToSupplier', render: (v) => (v ? 'Nhà cung cấp' : 'Bên thứ ba') }, { title: 'Số tiền', dataIndex: 'amount', className: 'num', render: (v) => money(v) }]} />}
              </div>
              <div className="kv-kv" style={{ flex: '0 0 320px' }}>
                <span className="k">Tổng tiền hàng</span><span className="v">{money(r.subtotal)}</span>
                <span className="k">Chiết khấu phiếu</span><span className="v">{money(r.discountAmount)}</span>
                <span className="k">Thuế</span><span className="v">{money(r.taxAmount)}</span>
                <span className="k">Chi phí nhập</span><span className="v">{money(r.landedCostTotal)}</span>
                <span className="k"><b>Cần trả NCC</b></span><span className="v"><b>{money(r.totalAmount)}</b></span>
                <span className="k">Đã trả</span><span className="v">{money(r.paidAmount)}</span>
                <span className="k">Còn nợ</span><span className="v"><b className={Number(r.dueAmount) > 0 && r.status === 'POSTED' ? 'neg' : ''}>{money(r.dueAmount)}</b></span>
                {Number(r.returnedAmount) > 0 && <><span className="k">Đã trả hàng</span><span className="v">{money(r.returnedAmount)}</span></>}
              </div>
            </div>
          </div>
        ) },
        { key: 'payments', label: `Thanh toán (${r.payments?.length ?? 0})`, children: (
          <div>
            <Table size="small" rowKey="id" pagination={false} dataSource={r.payments ?? []} locale={{ emptyText: 'Chưa có thanh toán' }}
              columns={[{ title: 'Mã phiếu', render: (_, a) => <Link to={`/payments?search=${a.payment.code}`}>{a.payment.code}</Link> }, { title: 'Ngày', render: (_, a) => dt(a.payment.paymentDate) }, { title: 'Phương thức', render: (_, a) => PAYMENT_METHOD_LABEL[a.payment.method] ?? a.payment.method }, { title: 'Số tiền phiếu', className: 'num', render: (_, a) => money(a.payment.amount) }, { title: 'Phân bổ cho phiếu này', dataIndex: 'amount', className: 'num', render: (v) => <b>{money(v)}</b> }]} />
            {r.status === 'POSTED' && Number(r.dueAmount) > 0 && can('payment.create') && <Button type="primary" icon={<DollarOutlined />} style={{ marginTop: 8 }} onClick={() => setPay(true)}>Thanh toán {money(r.dueAmount)}</Button>}
          </div>
        ) },
        { key: 'movements', label: 'Bút toán kho', children: (
          <Table size="small" rowKey="id" pagination={false} dataSource={r.movements ?? []} locale={{ emptyText: 'Chưa ghi sổ kho' }}
            columns={[{ title: 'Thời gian', dataIndex: 'createdAt', render: (v) => dt(v, 'DD/MM/YYYY HH:mm:ss') }, { title: 'Loại', dataIndex: 'type', render: (v) => <Tag color={v === 'REVERSAL' ? 'red' : 'blue'}>{MOVEMENT_LABEL[v] ?? v}</Tag> }, { title: 'Hàng hóa', render: (_, m) => r.lines?.find((l) => l.variantId === m.variantId)?.variant.sku ?? m.variantId }, { title: 'SL', dataIndex: 'quantity', className: 'num', render: (v) => <span className={Number(v) >= 0 ? 'pos' : 'neg'}>{signedQty(v)}</span> }, ...(canCost ? [{ title: 'Giá vốn', dataIndex: 'unitCost', className: 'num', render: (v: string) => money(v) }] : []), { title: 'Tồn sau', dataIndex: 'balanceAfter', className: 'num', render: (v) => qty(v) }]} />
        ) },
        { key: 'returns', label: `Trả hàng (${r.returns?.length ?? 0})`, children: (
          <div>
            <Table size="small" rowKey="id" pagination={false} dataSource={r.returns ?? []} locale={{ emptyText: 'Chưa có phiếu trả hàng' }}
              columns={[{ title: 'Mã phiếu', dataIndex: 'code', render: (v) => <Link to={`/purchase-returns?search=${v}`}>{v}</Link> }, { title: 'Ngày', dataIndex: 'returnDate', render: (v) => dt(v) }, { title: 'Tổng tiền', dataIndex: 'totalAmount', className: 'num', render: (v) => money(v) }, { title: 'Trạng thái', dataIndex: 'status', render: (v) => <Tag color={DOC_STATUS_COLOR[v]}>{PDOC_STATUS_LABEL[v]}</Tag> }]} />
            {r.status === 'POSTED' && can('purchase.return.create') && (r.lines ?? []).some((l) => Number(l.returnableQuantity) > 0) && <Button icon={<RollbackOutlined />} style={{ marginTop: 8 }} onClick={() => nav(`/purchase-returns/new?receiptId=${r.id}`)}>Trả hàng nhập</Button>}
          </div>
        ) },
      ]} />
      <div className="kv-detail-actions">
        <Button icon={<PrinterOutlined />} onClick={print}>In</Button>
        {r.status === 'DRAFT' && can('purchase.receipt.create') && <Button icon={<EditOutlined />} onClick={() => nav(`/purchase-receipts/${r.id}/edit`)}>Sửa</Button>}
        {r.status === 'DRAFT' && can('purchase.receipt.create') && <Button danger icon={<DeleteOutlined />} onClick={remove}>Xóa</Button>}
        {r.status === 'DRAFT' && can('purchase.receipt.post') && <Button type="primary" icon={<CheckOutlined />} onClick={() => setPosting(true)}>Hoàn thành</Button>}
        {r.status === 'POSTED' && can('purchase.receipt.cancel') && <Button danger icon={<StopOutlined />} onClick={cancel}>Hủy phiếu</Button>}
        <Link to={`/inventory/movements?documentId=${r.id}`}>Xem thẻ kho</Link>
      </div>
      <PaymentModal open={pay} direction="OUT" supplierId={r.supplierId} documentId={r.id} amount={Number(r.dueAmount)} onClose={() => setPay(false)} />
      <PostReceiptModal open={posting} total={Number(r.totalAmount)} code={r.code} onClose={() => setPosting(false)} onConfirm={async (payment) => { try { await purchasingApi.postReceipt(r.id, payment); message.success(`Đã hoàn thành phiếu ${r.code}`); setPosting(false); refresh(); } catch (e) { message.error(errMsg(e)); } }} />
    </div>
  );
}

export function printReceipt(r: PurchaseReceipt, message: { error: (m: string) => void }) {
  const rows = (r.lines ?? []).map((l) => `<tr><td>${l.lineNo}</td><td>${l.variant.sku}</td><td>${l.variant.name}${l.batch ? ` (Lô ${l.batch.batchNo})` : ''}</td><td class="r">${qty(l.quantity)}</td><td class="r">${money(l.unitPrice)}</td><td class="r">${money(l.discountAmount)}</td><td class="r">${money(l.lineTotal)}</td></tr>`).join('');
  const html = `<!doctype html><html lang="vi"><head><meta charset="utf-8"><title>${r.code}</title><style>body{font-family:Arial,sans-serif;font-size:13px;padding:24px}h2{margin:0 0 4px}table{width:100%;border-collapse:collapse;margin-top:12px}th,td{border:1px solid #999;padding:4px 6px}th{background:#eee}.r{text-align:right}.meta td{border:none;padding:2px 4px}</style></head><body>
  <h2>PHIẾU NHẬP HÀNG – ${r.code}</h2><div>${PDOC_STATUS_LABEL[r.status]}</div>
  <table class="meta"><tr><td>Nhà cung cấp: <b>${r.supplier?.name ?? ''}</b></td><td>Kho: <b>${r.warehouse?.name ?? ''}</b></td><td>Ngày: ${dt(r.receiptDate)}</td></tr><tr><td colspan="3">Số HĐ NCC: ${r.supplierInvoiceNo ?? ''} · Ghi chú: ${r.note ?? ''}</td></tr></table>
  <table><thead><tr><th>#</th><th>Mã hàng</th><th>Tên hàng</th><th>SL</th><th>Đơn giá</th><th>CK</th><th>Thành tiền</th></tr></thead><tbody>${rows}</tbody></table>
  <table class="meta" style="margin-top:8px;width:50%;margin-left:auto"><tr><td>Tổng tiền hàng</td><td class="r">${money(r.subtotal)}</td></tr><tr><td>Chiết khấu phiếu</td><td class="r">${money(r.discountAmount)}</td></tr><tr><td>Thuế</td><td class="r">${money(r.taxAmount)}</td></tr><tr><td>Chi phí nhập</td><td class="r">${money(r.landedCostTotal)}</td></tr><tr><td><b>Cần trả NCC</b></td><td class="r"><b>${money(r.totalAmount)}</b></td></tr><tr><td>Đã trả</td><td class="r">${money(r.paidAmount)}</td></tr><tr><td>Còn nợ</td><td class="r">${money(r.dueAmount)}</td></tr></table>
  <table class="meta" style="margin-top:40px"><tr><td style="text-align:center">Người lập phiếu<br/><br/><br/></td><td style="text-align:center">Thủ kho<br/><br/><br/></td><td style="text-align:center">Nhà cung cấp<br/><br/><br/></td></tr></table></body></html>`;
  const frame = document.createElement('iframe');
  frame.style.cssText = 'position:fixed;right:0;bottom:0;width:0;height:0;border:0;';
  document.body.appendChild(frame);
  const w = frame.contentWindow;
  if (!w) { frame.remove(); message.error('Trình duyệt không cho phép in'); return; }
  w.document.open(); w.document.write(html); w.document.close();
  const done = () => setTimeout(() => frame.remove(), 1000);
  w.onafterprint = done;
  setTimeout(() => { try { w.focus(); w.print(); } catch { message.error('Không mở được hộp thoại in'); } done(); }, 300);
}
