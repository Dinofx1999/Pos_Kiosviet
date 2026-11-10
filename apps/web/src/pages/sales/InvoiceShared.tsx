import { App, Input } from 'antd';
import { useQueryClient } from '@tanstack/react-query';
import { SALES_KEYS, salesApi } from '../../api/sales';
import { errMsg } from '../../api/client';
import type { Invoice } from '../../api/types';
import { useAuthStore } from '../../store/auth';
import { PAYMENT_METHOD_LABEL, dt, money } from '../../utils/format';
import { printHtml, receiptHtml } from '../pos/receipt';

/** Ảnh hàng nhỏ trong các danh sách điện thoại (ảnh phiên bản → ảnh hàng hóa; không có ảnh → ô xanh nhạt). */
export const Thumb = ({ src, size = 56 }: { src?: string | null; size?: number }) =>
  src ? <img className="kv-thumb" src={src} alt="" loading="lazy" style={{ width: size, height: size }} /> : <span className="kv-thumb ph" style={{ width: size, height: size }} />;

/** Nhãn hình thức thanh toán của một hóa đơn trong danh sách: Tiền mặt / Chuyển khoản / Kết hợp / Nợ … */
export function paymentLabel(r: Invoice): { text: string; cls: string } {
  if (r.status === 'DRAFT') return { text: 'Giữ đơn', cls: 'draft' };
  if (r.status === 'CANCELLED') return { text: 'Đã hủy', cls: 'cancel' };
  const due = Number(r.dueAmount ?? Number(r.totalAmount) - Number(r.paidAmount));
  if (due > 0) return { text: Number(r.paidAmount) > 0 ? `Nợ ${money(due)}` : 'Chưa thanh toán', cls: 'due' };
  const ms = r.paymentMethods ?? [];
  if (!ms.length) return { text: 'Đã thanh toán', cls: '' };
  return { text: ms.length > 1 ? 'Kết hợp' : PAYMENT_METHOD_LABEL[ms[0]] ?? ms[0], cls: '' };
}

/** Các thao tác trên một hóa đơn – dùng chung cho bảng trên máy tính và trang chi tiết trên điện thoại. */
export function useInvoiceActions(inv: Invoice | undefined, opts: { afterDelete?: () => void } = {}) {
  const { message, modal } = App.useApp();
  const qc = useQueryClient();
  const me = useAuthStore((s) => s.me);
  const refresh = () => SALES_KEYS.forEach((k) => qc.invalidateQueries({ queryKey: [k] }));
  const cancel = () => {
    if (!inv) return;
    let reason = '';
    modal.confirm({
      title: `Hủy hóa đơn ${inv.code}?`, okText: 'Hủy hóa đơn', okButtonProps: { danger: true }, cancelText: 'Bỏ qua',
      content: <div><div className="kv-hint" style={{ marginBottom: 6 }}>Hàng sẽ được nhập lại kho, các phiếu thu của hóa đơn này bị hủy và công nợ khách được hoàn lại.</div><Input placeholder="Lý do hủy" onChange={(e) => (reason = e.target.value)} /></div>,
      onOk: async () => { if (!reason.trim()) { message.warning('Nhập lý do hủy'); throw new Error('no reason'); } try { await salesApi.cancelInvoice(inv.id, reason.trim()); message.success('Đã hủy hóa đơn'); refresh(); } catch (e) { message.error(errMsg(e)); throw e; } },
    });
  };
  const removeDraft = () => {
    if (!inv) return;
    modal.confirm({ title: `Xóa đơn giữ ${inv.code}?`, okText: 'Xóa', okButtonProps: { danger: true }, cancelText: 'Bỏ qua', onOk: async () => { try { await salesApi.deleteInvoice(inv.id); message.success('Đã xóa'); qc.removeQueries({ queryKey: ['invoice', inv.id] }); qc.invalidateQueries({ queryKey: ['invoices'] }); opts.afterDelete?.(); } catch (e) { message.error(errMsg(e)); } } });
  };
  const print = () => { if (!inv) return; if (!printHtml(receiptHtml(inv, { storeName: me?.tenant.name }))) message.error('Trình duyệt không cho phép in'); };
  /** Chia sẻ (Zalo, Messenger…) qua hộp chia sẻ của điện thoại; máy tính thì sao chép vào bộ nhớ tạm. */
  const share = async () => {
    if (!inv) return;
    const text = `Hóa đơn ${inv.code} · ${dt(inv.invoiceDate)} · ${inv.customer?.name ?? 'Khách lẻ'} · ${money(inv.totalAmount)}`;
    const url = `${window.location.origin}/invoices/${inv.id}`;
    if (typeof navigator.share === 'function') { try { await navigator.share({ title: `Hóa đơn ${inv.code}`, text, url }); } catch { /* người dùng đóng hộp chia sẻ */ } return; }
    try { await navigator.clipboard.writeText(`${text}\n${url}`); message.success('Đã sao chép thông tin hóa đơn'); } catch { message.error('Trình duyệt không cho phép sao chép'); }
  };
  const copyCode = async () => { if (!inv) return; try { await navigator.clipboard.writeText(inv.code); message.success(`Đã sao chép ${inv.code}`); } catch { message.error('Trình duyệt không cho phép sao chép'); } };
  return { refresh, cancel, removeDraft, print, share, copyCode };
}
