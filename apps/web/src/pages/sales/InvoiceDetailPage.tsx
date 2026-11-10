import { Alert, Button, Drawer, Modal, Skeleton, Tag } from 'antd';
import { ArrowLeftOutlined, CarOutlined, CopyOutlined, DeleteOutlined, DollarOutlined, DownOutlined, EllipsisOutlined, LeftOutlined, PrinterOutlined, RightOutlined, RollbackOutlined, ShareAltOutlined, ShopOutlined, StopOutlined, UpOutlined, UserOutlined } from '@ant-design/icons';
import { useState } from 'react';
import { Link, useNavigate, useParams } from 'react-router-dom';
import { useInvoice, SALES_KEYS } from '../../api/sales';
import { useSepayReady } from '../../api/bankTransfers';
import { errMsg } from '../../api/client';
import type { Invoice } from '../../api/types';
import { DocumentQrButton } from '../../components/DocumentQrButton';
import { PaymentModal } from '../../components/PaymentModal';
import { useFullscreenPage } from '../../components/layout/layoutStore';
import { useIsMobile } from '../../hooks/useMedia';
import { useCan } from '../../store/auth';
import { INVOICE_STATUS_LABEL, PAYMENT_METHOD_LABEL, dt, money, qty } from '../../utils/format';
import { DELIVERY_FINAL, DELIVERY_STATUS_COLOR, DELIVERY_STATUS_LABEL, DeliveryFormModal } from './DeliveryShared';
import { Thumb, paymentLabel, useInvoiceActions } from './InvoiceShared';
import { InvoiceDetail } from './InvoicesPage';
import { RETURN_STATUS_COLOR, RETURN_STATUS_LABEL } from './SalesReturnShared';
import './sales-mobile.css';

const SOURCE_LABEL: Record<string, string> = { POS: 'Bán trực tiếp', ONLINE: 'Web bán hàng', PHONE: 'Điện thoại', FACEBOOK: 'Facebook', ZALO: 'Zalo', OTHER: 'Khác' };

/** /invoices/:id – điện thoại: trang chi tiết như app KiotViet; máy tính: thẻ chi tiết quen thuộc với nút quay lại. */
export default function InvoiceDetailPage() {
  const { id } = useParams();
  const isMobile = useIsMobile();
  if (!id) return null;
  return isMobile ? <InvoiceMobile id={id} /> : <InvoiceDesktop id={id} />;
}

function InvoiceDesktop({ id }: { id: string }) {
  const nav = useNavigate();
  const { data: inv } = useInvoice(id);
  return (
    <div>
      <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 10 }}>
        <Button type="text" icon={<ArrowLeftOutlined />} onClick={() => nav('/invoices')}>Hóa đơn</Button>
        {inv && <h1 className="kv-page-title" style={{ margin: 0 }}>{inv.code}</h1>}
      </div>
      <div className="kv-card" style={{ padding: 12 }}><InvoiceDetail id={id} /></div>
    </div>
  );
}

function InvoiceMobile({ id }: { id: string }) {
  useFullscreenPage();
  const nav = useNavigate();
  const can = useCan();
  const { data: inv, isLoading, error } = useInvoice(id);
  const act = useInvoiceActions(inv, { afterDelete: () => nav('/invoices', { replace: true }) });
  const sepayReady = useSepayReady();
  const [more, setMore] = useState(false);
  const [pay, setPay] = useState(false);
  const [ship, setShip] = useState(false);
  const [showPays, setShowPays] = useState(false);
  const back = () => (window.history.length > 1 ? nav(-1) : nav('/invoices'));

  if (isLoading) return <div className="iv"><div className="iv-bar"><button type="button" className="iv-ib" onClick={back}><LeftOutlined /></button></div><div className="iv-card"><Skeleton active paragraph={{ rows: 6 }} /></div></div>;
  if (error || !inv) return <div className="iv"><div className="iv-bar"><button type="button" className="iv-ib" onClick={back}><LeftOutlined /></button></div><div className="iv-card"><Alert type="error" showIcon message={error ? errMsg(error) : 'Không tìm thấy hóa đơn'} /></div></div>;

  const ext = inv as Invoice & { deliveries?: { id: string; code: string; status: string; carrier?: string | null }[] };
  const due = Number(inv.dueAmount ?? Number(inv.totalAmount) - Number(inv.paidAmount));
  const completed = inv.status === 'COMPLETED';
  const draft = inv.status === 'DRAFT';
  const lines = inv.lines ?? [];
  const payments = inv.payments ?? [];
  const methods = Array.from(new Set(payments.map((p) => p.payment.method)));
  const payText = methods.length > 1 ? 'Kết hợp' : methods.length === 1 ? PAYMENT_METHOD_LABEL[methods[0]] ?? methods[0] : paymentLabel(inv).text;
  const voucher = inv.promotions?.find((p) => p.type === 'VOUCHER');
  const promo = Number(inv.promotionDiscount ?? 0) - Number(voucher?.amount ?? 0);
  const activeDelivery = (ext.deliveries ?? []).find((d) => !DELIVERY_FINAL.includes(d.status as never));
  const returnsDone = inv.returns?.filter((r) => r.status === 'COMPLETED').length ?? 0;
  const channel = inv.salesOrder ? `${SOURCE_LABEL[inv.salesOrder.source ?? ''] ?? 'Đơn đặt hàng'} · ${inv.salesOrder.code}` : 'Bán trực tiếp';
  const closeMore = (fn: () => void) => () => { setMore(false); fn(); };

  return (
    <div className="iv">
      <div className="iv-bar">
        <button type="button" className="iv-ib" aria-label="Quay lại" onClick={back}><LeftOutlined /></button>
        <span className="t">{inv.code}</span>
        <button type="button" className="iv-ib" aria-label="Thêm thao tác" onClick={() => setMore(true)}><EllipsisOutlined /></button>
      </div>

      <div className="iv-card iv-top">
        <div>
          <div className="code">{inv.code} <button type="button" className="iv-copy" aria-label="Sao chép mã" onClick={() => void act.copyCode()}><CopyOutlined /></button></div>
          <div className="date">{dt(inv.completedAt ?? inv.invoiceDate)}</div>
        </div>
        <span className={`iv-status ${inv.status.toLowerCase()}`}>{INVOICE_STATUS_LABEL[inv.status]}</span>
      </div>

      <div className={`iv-card iv-cust ${inv.customer ? 'link' : ''}`} onClick={inv.customer ? () => nav(`/customers?search=${inv.customer!.code}`) : undefined} role={inv.customer ? 'button' : undefined}>
        <span className="av"><UserOutlined /></span>
        <span className="nm">{inv.customer?.name ?? 'Khách lẻ'}{inv.customer?.phone && <small>{inv.customer.phone}</small>}</span>
        {inv.customer && <RightOutlined className="chev" />}
      </div>

      <div className="iv-card iv-lines">
        {lines.map((l) => (
          <div key={l.id} className={`iv-line ${l.isGift ? 'gift' : ''}`}>
            <Thumb src={l.variant.imageUrl ?? l.variant.product.imageUrl} />
            <div className="main">
              <div className="nm">{l.variant.name}{l.isGift && <Tag color="green">Hàng tặng</Tag>}{l.batch && <Tag>Lô {l.batch.batchNo}</Tag>}</div>
              <div className="sku">{l.variant.sku}{l.unitName ? ` · ${l.unitName}` : ''}{l.note ? ` · ${l.note}` : ''}</div>
              <div className="row">
                <span>{money(l.isGift ? 0 : l.unitPrice)} x {qty(l.quantity)}{Number(l.discountAmount) > 0 && <small> −{money(l.discountAmount)}</small>}{Number(l.promotionDiscount) > 0 && <small> KM −{money(l.promotionDiscount)}</small>}</span>
                <b>{money(l.lineTotal)}</b>
              </div>
              {Number(l.returnedQuantity) > 0 && <div className="ret">Đã trả {qty(l.returnedQuantity)}</div>}
            </div>
          </div>
        ))}
        {!lines.length && <div className="iv-empty">Hóa đơn chưa có dòng hàng</div>}
      </div>

      <div className="iv-card iv-tot">
        <div className="r"><span>Tổng tiền hàng <i className="cnt">{lines.length}</i></span><span>{money(inv.subtotal)}</span></div>
        <div className="r"><span>Giảm giá</span><span>{money(inv.discountAmount)}</span></div>
        {promo > 0 && <div className="r"><span>Khuyến mại</span><span className="green">−{money(promo)}</span></div>}
        {voucher && <div className="r"><span>Voucher {voucher.voucher?.code ?? inv.voucherCode ?? ''}</span><span className="green">−{money(voucher.amount)}</span></div>}
        {Number(inv.taxAmount) > 0 && <div className="r"><span>Thuế</span><span>{money(inv.taxAmount)}</span></div>}
        <div className="r b"><span>Khách cần trả</span><span>{money(inv.totalAmount)}</span></div>
        <div className="r b"><span>Khách đã trả</span><span className="blue">{money(inv.paidAmount)}</span></div>
        {payments.length > 0 && (
          <button type="button" className="iv-pays" onClick={() => setShowPays(!showPays)}>{showPays ? <UpOutlined /> : <DownOutlined />} {payText}</button>
        )}
        {showPays && payments.map((p) => (
          <div key={p.id} className="iv-pay">
            <span>{PAYMENT_METHOD_LABEL[p.payment.method] ?? p.payment.method} · {dt(p.payment.paymentDate)}<small><Link to={`/payments?search=${p.payment.code}`}>{p.payment.code}</Link>{p.payment.reference ? ` · ${p.payment.reference}` : ''}</small></span>
            <span>{money(p.amount)}</span>
          </div>
        ))}
        {completed && due > 0 && <div className="r b"><span>Còn nợ</span><span className="red">{money(due)}</span></div>}
        {Number(inv.returnedAmount) > 0 && <div className="r"><span>Đã trả hàng ({returnsDone} phiếu)</span><span className="red">−{money(inv.returnedAmount)}</span></div>}
        {inv.costTotal !== undefined && completed && <div className="r muted"><span>Giá vốn / Lợi nhuận</span><span>{money(inv.costTotal)} / <b className="green">{money(Number(inv.totalAmount) - Number(inv.costTotal))}</b></span></div>}
      </div>

      <div className="iv-card iv-note">
        <div className="hd"><span>GHI CHÚ</span>{draft && can('invoice.create') && <a onClick={() => nav(`/pos?draft=${inv.id}`)}>Sửa</a>}</div>
        <div className={`txt ${inv.note ? '' : 'muted'}`}>{inv.note || 'Chưa có ghi chú…'}</div>
        {inv.cancelReason && <div className="txt red">Lý do hủy: {inv.cancelReason}</div>}
      </div>

      <div className="iv-card iv-info">
        <div><div className="k">Bảng giá</div><div className="v">{inv.priceBookId ? 'Bảng giá riêng' : 'Bảng giá chung'}</div></div>
        <div><div className="k">Kênh bán</div><div className="v">{inv.salesOrder ? <Link to={`/orders/${inv.salesOrder.id}`}>{channel}</Link> : channel}</div></div>
        <div><div className="k">Người bán</div><div className="v">{inv.seller?.fullName ?? '—'}</div></div>
        <div><div className="k">Ca bán hàng</div><div className="v">{inv.shift ? <Link to={`/shifts?search=${inv.shift.code}`}>{inv.shift.code}</Link> : '—'}</div></div>
        <div><div className="k">Chi nhánh</div><div className="v">{inv.branch?.name ?? '—'}</div></div>
        <div><div className="k">Kho</div><div className="v">{inv.warehouse?.name ?? '—'}</div></div>
        {(ext.deliveries?.length ?? 0) > 0 && <div className="full"><div className="k">Vận đơn</div><div className="v">{ext.deliveries!.map((d) => <span key={d.id} className="chip"><Link to={`/deliveries?search=${d.code}`}><CarOutlined /> {d.code}</Link> <Tag color={DELIVERY_STATUS_COLOR[d.status]}>{DELIVERY_STATUS_LABEL[d.status] ?? d.status}</Tag></span>)}</div></div>}
        {(inv.returns?.length ?? 0) > 0 && <div className="full"><div className="k">Phiếu trả hàng</div><div className="v">{inv.returns!.map((r) => <span key={r.id} className="chip"><Link to={`/sales-returns/${r.id}`}>{r.code}</Link> <Tag color={RETURN_STATUS_COLOR[r.status]}>{RETURN_STATUS_LABEL[r.status]}</Tag> {money(r.totalRefund)}</span>)}</div></div>}
      </div>

      {(completed || draft) && (
        <div className="iv-foot">
          {completed && <button type="button" onClick={act.print}><PrinterOutlined /><span>In</span></button>}
          {completed && can('return.create') && <button type="button" onClick={() => nav(`/sales-returns/new?invoiceId=${inv.id}`)}><RollbackOutlined /><span>Trả hàng</span></button>}
          {completed && due > 0 && can('payment.create') && <button type="button" className="primary" onClick={() => setPay(true)}><DollarOutlined /><span>Thu nợ</span></button>}
          {draft && can('invoice.create') && <button type="button" className="primary" onClick={() => nav(`/pos?draft=${inv.id}`)}><ShopOutlined /><span>Mở ở Bán hàng</span></button>}
          {draft && can('invoice.create') && <button type="button" className="danger" onClick={act.removeDraft}><DeleteOutlined /><span>Xóa</span></button>}
        </div>
      )}

      <Drawer className="iv-sheet" placement="bottom" height="auto" open={more} onClose={() => setMore(false)} closable={false} styles={{ body: { padding: '6px 0 calc(10px + env(safe-area-inset-bottom))' } }}>
        {completed && can('return.create') && <button type="button" className="iv-more" onClick={closeMore(() => nav(`/sales-returns/new?invoiceId=${inv.id}`))}><RollbackOutlined /> Trả hàng</button>}
        {completed && <button type="button" className="iv-more" onClick={closeMore(act.print)}><PrinterOutlined /> In</button>}
        <button type="button" className="iv-more" onClick={closeMore(() => void act.share())}><ShareAltOutlined /> Chia sẻ</button>
        {completed && due > 0 && can('payment.create') && <button type="button" className="iv-more" onClick={closeMore(() => setPay(true))}><DollarOutlined /> Thu nợ {money(due)}</button>}
        {completed && due > 0 && can('payment.create') && sepayReady && <div className="iv-more-qr"><DocumentQrButton purpose="INVOICE" documentId={inv.id} documentCode={inv.code} due={due} customerName={inv.customer?.name} refreshKeys={SALES_KEYS} block /></div>}
        {completed && !activeDelivery && can('delivery.manage') && <button type="button" className="iv-more" onClick={closeMore(() => setShip(true))}><CarOutlined /> Tạo vận đơn</button>}
        {draft && can('invoice.create') && <button type="button" className="iv-more" onClick={closeMore(() => nav(`/pos?draft=${inv.id}`))}><ShopOutlined /> Mở ở Bán hàng</button>}
        {completed && can('invoice.cancel') && <button type="button" className="iv-more danger" onClick={closeMore(act.cancel)}><StopOutlined /> Huỷ hoá đơn</button>}
        {draft && can('invoice.create') && <button type="button" className="iv-more danger" onClick={closeMore(act.removeDraft)}><DeleteOutlined /> Xóa đơn giữ</button>}
      </Drawer>

      {inv.customerId && <PaymentModal open={pay} partyType="CUSTOMER" direction="IN" partyId={inv.customerId} documentId={inv.id} amount={due} onClose={() => setPay(false)} onSaved={act.refresh} />}
      {!inv.customerId && pay && <Modal open title="Thu nợ" onCancel={() => setPay(false)} footer={null}>Hóa đơn khách lẻ không có công nợ.</Modal>}
      <DeliveryFormModal open={ship} invoiceId={inv.id} due={due} prefill={{ receiverName: inv.customer?.name ?? '', receiverPhone: inv.customer?.phone ?? '' }} onClose={() => setShip(false)} onSaved={act.refresh} />
    </div>
  );
}
