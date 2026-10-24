import { PAYMENT_METHOD_LABELS } from '@erp/shared';
import type { Invoice } from '../../api/types';
import { PAYMENT_METHOD_LABEL, dt, money, qty } from '../../utils/format';

const esc = (s: unknown) => String(s ?? '').replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c] as string));
const methodLabel = (m: string) => PAYMENT_METHOD_LABEL[m] ?? (PAYMENT_METHOD_LABELS as Record<string, string>)[m] ?? m;
const fmtPts = (v: unknown) => Number(v ?? 0).toLocaleString('vi-VN', { maximumFractionDigits: 2 });

/** 80mm thermal-style receipt (K80) as a self-contained HTML document. */
export function receiptHtml(inv: Invoice, opts: { storeName?: string; change?: number; cashGiven?: number; pointsBalance?: string | number } = {}) {
  const lines = (inv.lines ?? []).map((l) => {
    const promo = Number(l.promotionDiscount ?? 0);
    const manual = Number(l.discountAmount ?? 0);
    const disc = manual + promo;
    return `
    <tr><td colspan="4" class="n">${esc(l.variant.name)}${l.isGift ? ' <span class="gift">(Hàng tặng)</span>' : ''}${l.batch ? ` (Lô ${esc(l.batch.batchNo)})` : ''}</td></tr>
    <tr><td class="r">${qty(l.quantity)} ${esc(l.unitName ?? '')}</td><td class="r">${money(l.unitPrice)}</td><td class="r">${disc > 0 ? '-' + money(disc) : ''}</td><td class="r b">${money(l.lineTotal)}</td></tr>
    ${promo > 0 && !l.isGift ? `<tr><td colspan="4" class="muted km">&nbsp;&nbsp;Khuyến mãi: -${money(promo)}</td></tr>` : ''}`;
  }).join('');
  // loyalty (BR-141): points pay like money – listed on their own line above "KHÁCH CẦN TRẢ", not among the cash payments
  const pointsValue = Number(inv.pointsValue ?? 0);
  const pointsRedeemed = Number(inv.pointsRedeemed ?? 0);
  const pointsEarned = Number(inv.pointsEarned ?? 0);
  const pays = (inv.payments ?? []).filter((p) => p.payment.method !== 'POINTS').map((p) => `<div class="row"><span>${esc(methodLabel(p.payment.method))}${p.payment.reference ? ` (${esc(p.payment.reference)})` : ''}</span><span>${money(p.amount)}</span></div>`).join('');
  const due = Number(inv.dueAmount ?? Number(inv.totalAmount) - Number(inv.paidAmount));
  const pointsLine = pointsEarned > 0 || pointsRedeemed > 0
    ? `<div class="row muted"><span>Điểm tích lũy: ${[pointsRedeemed > 0 ? `-${fmtPts(pointsRedeemed)}` : '', pointsEarned > 0 ? `+${fmtPts(pointsEarned)}` : ''].filter(Boolean).join(', ')}${opts.pointsBalance !== undefined && opts.pointsBalance !== null ? ` (còn ${fmtPts(opts.pointsBalance)})` : ''}</span></div>`
    : '';
  // invoice-level promotion rows: the voucher (if any) is listed on its own, the other document-level promotions as "Khuyến mãi"
  const promoDoc = Number(inv.promotionDiscount ?? 0);
  const voucherRow = (inv.promotions ?? []).find((p) => p.type === 'VOUCHER' || p.voucher);
  const voucherAmount = voucherRow ? Number(voucherRow.amount) : 0;
  const otherPromo = Math.max(0, promoDoc - voucherAmount);
  const promoNames = (inv.promotions ?? []).filter((p) => p.type !== 'VOUCHER' && Number(p.amount) > 0).map((p) => p.promotion?.name ?? p.promotion?.code).filter(Boolean);
  const giftRows = (inv.promotions ?? []).filter((p) => Number(p.giftQuantity) > 0);
  return `<!doctype html><html lang="vi"><head><meta charset="utf-8"><title>${esc(inv.code)}</title>
  <style>@page{size:80mm auto;margin:4mm}body{font-family:Arial,Helvetica,sans-serif;font-size:12px;width:72mm;margin:0 auto;color:#000}h2{text-align:center;margin:0;font-size:16px}.c{text-align:center}.muted{color:#444;font-size:11px}
  table{width:100%;border-collapse:collapse;margin-top:6px}td{padding:2px 0;vertical-align:top}.r{text-align:right}.b{font-weight:700}.n{font-weight:600;padding-top:5px;border-top:1px dashed #999}.km{padding-top:0}.gift{font-weight:400;font-size:11px}
  .row{display:flex;justify-content:space-between;padding:2px 0}.total{border-top:1px solid #000;margin-top:6px;padding-top:4px;font-size:14px;font-weight:700}.foot{margin-top:10px;text-align:center;font-size:11px}</style></head><body>
  <h2>${esc(opts.storeName ?? inv.branch?.name ?? '')}</h2>
  <div class="c muted">${esc(inv.branch?.name ?? '')}${inv.branch?.address ? ' · ' + esc(inv.branch.address) : ''}${inv.branch?.phone ? ' · ' + esc(inv.branch.phone) : ''}</div>
  <div class="c b" style="margin-top:6px;font-size:14px">HÓA ĐƠN BÁN HÀNG</div>
  <div class="c">${esc(inv.code)} · ${dt(inv.completedAt ?? inv.invoiceDate)}</div>
  <div class="row"><span>Thu ngân: ${esc(inv.seller?.fullName ?? '')}</span><span>Khách: ${esc(inv.customer?.name ?? 'Khách lẻ')}</span></div>
  ${inv.customer?.phone ? `<div class="muted">SĐT: ${esc(inv.customer.phone)}</div>` : ''}
  <table><tbody>${lines}</tbody></table>
  <div class="row" style="margin-top:6px;border-top:1px dashed #999;padding-top:4px"><span>Tổng tiền hàng</span><span>${money(inv.subtotal)}</span></div>
  ${Number(inv.discountAmount) > 0 ? `<div class="row"><span>Giảm giá hóa đơn</span><span>-${money(inv.discountAmount)}</span></div>` : ''}
  ${otherPromo > 0 ? `<div class="row"><span>Khuyến mãi${promoNames.length ? ` <span class="muted">(${esc(promoNames.join(', '))})</span>` : ''}</span><span>-${money(otherPromo)}</span></div>` : ''}
  ${voucherRow ? `<div class="row"><span>Voucher ${esc(inv.voucherCode ?? voucherRow.voucher?.code ?? '')}</span><span>-${money(voucherAmount)}</span></div>` : ''}
  ${giftRows.length ? `<div class="row muted"><span>Hàng tặng kèm</span><span>${giftRows.map((g) => `${qty(g.giftQuantity)} (${esc(g.promotion?.code ?? '')})`).join(', ')}</span></div>` : ''}
  ${Number(inv.taxAmount) > 0 ? `<div class="row muted"><span>Trong đó thuế</span><span>${money(inv.taxAmount)}</span></div>` : ''}
  ${pointsValue > 0 ? `<div class="row b"><span>Tổng cộng</span><span>${money(inv.totalAmount)}</span></div><div class="row"><span>Thanh toán bằng điểm (${fmtPts(pointsRedeemed)} điểm)</span><span>-${money(pointsValue)}</span></div>` : ''}
  <div class="row total"><span>KHÁCH CẦN TRẢ</span><span>${money(Number(inv.totalAmount) - pointsValue)}</span></div>
  ${pays}
  ${opts.cashGiven !== undefined && opts.cashGiven > 0 ? `<div class="row"><span>Tiền khách đưa</span><span>${money(opts.cashGiven)}</span></div>` : ''}
  ${opts.change !== undefined && opts.change > 0 ? `<div class="row"><span>Tiền thừa trả khách</span><span>${money(opts.change)}</span></div>` : ''}
  ${due > 0 ? `<div class="row b"><span>Còn nợ</span><span>${money(due)}</span></div>` : ''}
  ${pointsLine}
  ${inv.note ? `<div class="muted" style="margin-top:4px">Ghi chú: ${esc(inv.note)}</div>` : ''}
  <div class="foot">Cảm ơn quý khách và hẹn gặp lại!</div>
  </body></html>`;
}

/** Prints an HTML document through a hidden iframe (works when pop-ups are blocked). Returns false if printing is impossible. */
export function printHtml(html: string): boolean {
  const frame = document.createElement('iframe');
  frame.style.cssText = 'position:fixed;right:0;bottom:0;width:0;height:0;border:0;';
  document.body.appendChild(frame);
  const w = frame.contentWindow;
  if (!w) { frame.remove(); return false; }
  w.document.open(); w.document.write(html); w.document.close();
  const done = () => setTimeout(() => frame.remove(), 1000);
  w.onafterprint = done;
  setTimeout(() => { try { w.focus(); w.print(); } catch { /* ignore */ } done(); }, 300);
  return true;
}
