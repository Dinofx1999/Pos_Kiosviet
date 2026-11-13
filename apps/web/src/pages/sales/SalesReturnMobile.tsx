import { Button, DatePicker, Drawer, Input, Segmented, Select, Switch, Tag } from 'antd';
import { DeleteOutlined, FileTextOutlined, LeftOutlined, MinusOutlined, PlusCircleFilled, PlusOutlined, RightOutlined, ShopOutlined, TagOutlined, UserOutlined } from '@ant-design/icons';
import type { Dayjs } from 'dayjs';
import { ReactNode, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import type { Returnable, ReturnCondition, SalesReturn, SearchHit, Shift } from '../../api/types';
import { MoneyInput, QuantityInput } from '../../components/Inputs';
import { ProductSearch } from '../../components/ProductSearch';
import { useFullscreenPage } from '../../components/layout/layoutStore';
import { dt, money, qty, toNum } from '../../utils/format';
import { Thumb } from './InvoiceShared';
import type { RLine, XLine } from './SalesReturnEditorPage';
import { CONDITION_LABEL, METHOD_OPTIONS } from './SalesReturnShared';
import './sales-mobile.css';

/** Những gì màn điện thoại cần từ ReturnEditor (toàn bộ logic phiếu trả / đổi hàng nằm ở đó và dùng chung với máy tính). */
export interface ReturnMobileCtx {
  inv: Returnable['invoice']; existing?: SalesReturn;
  lines: RLine[]; upd: (invoiceLineId: string, patch: Partial<RLine>) => void;
  active: RLine[]; subtotal: number; feeApplied: number; totalRefund: number; maxRefund: number; hasCustomer: boolean;
  returnDate: Dayjs; setReturnDate: (d: Dayjs) => void; reason: string; setReason: (v: string) => void; note: string; setNote: (v: string) => void; fee: number; setFee: (v: number) => void;
  canPriceEdit: boolean; canSellPrice: boolean; canExchange: boolean; canCreate: boolean; canComplete: boolean;
  mode: 'return' | 'exchange'; setMode: (m: 'return' | 'exchange') => void;
  xLines: XLine[]; addX: (hit: SearchHit) => Promise<void>; setX: (key: string, patch: Partial<XLine>) => void; removeX: (key: string) => void;
  xDiscount: number; setXDiscount: (v: number) => void; xNote: string; setXNote: (v: string) => void;
  xTotals: { subtotal: number; discount: number; tax: number; total: number }; settle: { R: number; N: number; offset: number; customerPays: number; refundDue: number };
  payMethod: string; setPayMethod: (m: string) => void; payNow: number; setPayAmount: (v: number | null) => void;
  refMethod: string; setRefMethod: (m: string) => void; refundNow: number; setRefAmount: (v: number | null) => void; refCredit: boolean; setRefCredit: (v: boolean) => void;
  saving: 'draft' | 'complete' | 'exchange' | 'delete' | null;
  saveDraft: () => Promise<void>; removeDraft: () => void; openComplete: () => void; submitExchange: () => Promise<void>;
  shift: Shift | null | undefined; openShift: () => void;
  warehouseName?: string;
  batchSelect: (l: XLine) => ReactNode;
}

type Sheet = null | 'info' | 'settle';

/** Trả hàng hóa đơn trên điện thoại – bố cục như app KiotViet: ‹ tiêu đề + mã HĐ, khách / lý do / kho, "Hàng trả" với − SL/đã mua +, Thêm hàng mua, Tổng trả, nút Thanh toán. */
export function ReturnMobile({ ctx, children }: { ctx: ReturnMobileCtx; children?: ReactNode }) {
  useFullscreenPage();
  const nav = useNavigate();
  const c = ctx;
  const [sheet, setSheet] = useState<Sheet>(null);
  const [lineId, setLineId] = useState<string | null>(null);
  const [xKey, setXKey] = useState<string | null>(null);
  const line = lineId ? c.lines.find((l) => l.invoiceLineId === lineId) : undefined;
  const xLine = xKey ? c.xLines.find((l) => l.key === xKey) : undefined;
  const back = () => (window.history.length > 1 ? nav(-1) : nav('/invoices'));
  const exchange = c.mode === 'exchange';
  const condOptions = [{ value: 'RESTOCK', label: CONDITION_LABEL.RESTOCK }, { value: 'DAMAGED', label: CONDITION_LABEL.DAMAGED }];
  const sheetBody = { padding: '12px 14px calc(16px + env(safe-area-inset-bottom))', display: 'grid', gap: 12 } as const;

  return (
    <div className="rm">
      <div className="rm-top">
        <button type="button" className="iv-ib" aria-label="Quay lại" onClick={back}><LeftOutlined /></button>
        <div className="ttl"><h1>{c.existing ? `Sửa phiếu trả ${c.existing.code}` : exchange ? 'Đổi hàng' : 'Trả hàng hóa đơn'}</h1><div className="sub">{c.inv.code} · {dt(c.inv.invoiceDate)}</div></div>
        <button type="button" className="iv-ib" aria-label="Thông tin phiếu trả" onClick={() => setSheet('info')}><FileTextOutlined /></button>
      </div>

      <div className="rm-scroll">
        <div className="rm-rows">
          <div className="rm-prow"><UserOutlined /><span className="t">{c.inv.customer ? `${c.inv.customer.name}${c.inv.customer.phone ? ` · ${c.inv.customer.phone}` : ''}` : 'Khách lẻ'}</span></div>
          <button type="button" className="rm-prow btn" onClick={() => setSheet('info')}><TagOutlined /><span className={`t ${c.reason ? '' : 'ph'}`}>{c.reason || 'Lý do trả hàng'}</span><RightOutlined className="chev" /></button>
          <div className="rm-prow"><ShopOutlined /><span className="t">{c.warehouseName ?? 'Kho bán hàng'}</span></div>
        </div>
        {c.shift === null && <div className="rm-warn">Chưa có ca bán hàng đang mở – hoàn tiền ngay / đổi hàng cần ca (nếu cửa hàng yêu cầu).<a onClick={c.openShift}>Mở ca</a></div>}

        <div className="rm-sec">Hàng trả</div>
        <div className="rm-list">
          {c.lines.map((l) => (
            <div key={l.invoiceLineId} className={`rm-line${l.returnable <= 0 ? ' off' : ''}`}>
              <Thumb src={l.imageUrl} />
              <div className="nm" onClick={() => l.returnable > 0 && setLineId(l.invoiceLineId)}>{l.name}{l.productType !== 'GOODS' && <Tag>{l.productType === 'SERVICE' ? 'Dịch vụ' : 'Combo'}</Tag>}{l.condition === 'DAMAGED' && l.quantity > 0 && <Tag color="volcano">Hàng hỏng</Tag>}</div>
              <div className="price" onClick={() => l.returnable > 0 && setLineId(l.invoiceLineId)}>{money(l.unitPrice)}{l.returnable <= 0 && <small>đã trả hết</small>}</div>
              <span className={`rm-step ${l.quantity > 0 ? 'on' : ''}`}>
                <button type="button" aria-label="Bớt" disabled={l.returnable <= 0 || l.quantity <= 0} onClick={() => c.upd(l.invoiceLineId, { quantity: Math.max(0, l.quantity - 1) })}><MinusOutlined /></button>
                <span className="q" onClick={() => l.returnable > 0 && setLineId(l.invoiceLineId)}><b>{qty(l.quantity)}</b> /{qty(l.returnable)}</span>
                <button type="button" aria-label="Thêm" disabled={l.returnable <= 0 || l.quantity >= l.returnable} onClick={() => c.upd(l.invoiceLineId, { quantity: Math.min(l.returnable, l.quantity + 1) })}><PlusOutlined /></button>
              </span>
              {l.error && <div className="err">{l.error}</div>}
            </div>
          ))}
        </div>

        {exchange && (
          <>
            <div className="rm-sec">Hàng mua <a onClick={() => c.setMode('return')}>Chỉ trả hàng</a></div>
            <div className="rm-xsearch"><ProductSearch scanContinuous onPick={c.addX} warehouseId={c.inv.warehouseId} size="large" placeholder="Tìm hàng mua hoặc quét mã vạch" /></div>
            {c.xLines.length ? (
              <div className="rm-list">
                {c.xLines.map((l) => (
                  <div key={l.key} className="rm-line">
                    <Thumb src={l.imageUrl} />
                    <div className="nm" onClick={() => setXKey(l.key)}>{l.name}{l.unitName ? <span className="muted"> ({l.unitName})</span> : null}{l.trackBatch && !l.batchId && <Tag color="red">Chọn lô</Tag>}</div>
                    <div className="price" onClick={() => setXKey(l.key)}>{money(l.unitPrice)}{l.discount > 0 && <small>−{money(l.discount)}</small>}</div>
                    <span className="rm-step on">
                      <button type="button" aria-label="Bớt" onClick={() => (l.quantity <= 1 ? c.removeX(l.key) : c.setX(l.key, { quantity: l.quantity - 1 }))}><MinusOutlined /></button>
                      <span className="q" onClick={() => setXKey(l.key)}><b>{qty(l.quantity)}</b></span>
                      <button type="button" aria-label="Thêm" onClick={() => c.setX(l.key, { quantity: l.quantity + 1 })}><PlusOutlined /></button>
                    </span>
                    {l.error && <div className="err">{l.error}</div>}
                  </div>
                ))}
              </div>
            ) : <div className="rm-empty">Chưa có hàng mua – tìm hoặc quét mã vạch để thêm.</div>}
          </>
        )}
        <div style={{ height: 16 }} />
      </div>

      <div className="rm-foot">
        <div className="rm-foot-links">
          {c.existing && c.canCreate && !exchange ? <a className="rm-del" onClick={c.removeDraft}><DeleteOutlined /> {c.saving === 'delete' ? 'Đang xóa…' : 'Xóa phiếu tạm'}</a> : c.canExchange && !c.existing && !exchange ? <a onClick={() => c.setMode('exchange')}>Thêm hàng mua <PlusCircleFilled /></a> : <span className="muted" style={{ fontWeight: 500, fontSize: 14 }}>{exchange ? `Đổi hàng · ${c.xLines.length} hàng mua` : ' '}</span>}
          {c.canCreate && !exchange && <a onClick={() => void c.saveDraft()}>{c.saving === 'draft' ? 'Đang lưu…' : 'Lưu nháp'}</a>}
        </div>
        <div className="rm-tot"><span>Tổng trả <i className="cnt">{c.active.length}</i></span><b>{money(c.totalRefund)}</b></div>
        {c.feeApplied > 0 && <div className="rm-sub"><span>Phí trả hàng (đã trừ)</span><span>−{money(c.feeApplied)}</span></div>}
        {exchange && (
          <>
            <div className="rm-sub"><span>Tiền hàng mua{c.xTotals.tax > 0 ? ` (thuế ${money(c.xTotals.tax)})` : ''}</span><span>{money(c.settle.N)}</span></div>
            {c.settle.customerPays > 0 && <div className="rm-sub b"><span>Khách cần trả thêm</span><span className="red">{money(c.settle.customerPays)}</span></div>}
            {c.settle.refundDue > 0 && <div className="rm-sub b"><span>Hoàn lại khách</span><span className="green">{money(c.settle.refundDue)}</span></div>}
            {c.settle.customerPays <= 0 && c.settle.refundDue <= 0 && c.active.length > 0 && <div className="rm-sub b"><span>Chênh lệch</span><span>0</span></div>}
          </>
        )}
        {exchange
          ? <Button type="primary" block loading={c.saving === 'exchange'} disabled={!c.active.length || !c.xLines.length} onClick={() => setSheet('settle')}>Hoàn tất đổi hàng</Button>
          : <Button type="primary" block loading={c.saving === 'complete'} disabled={!c.canComplete} onClick={c.openComplete}>Thanh toán</Button>}
      </div>

      {/* thông tin phiếu trả */}
      <Drawer className="ps-sheet iv-sheet" placement="bottom" height="auto" open={sheet === 'info'} onClose={() => setSheet(null)} title="Thông tin phiếu trả" styles={{ body: sheetBody }}>
        <div className="rm-field"><div className="kv-hint">Lý do trả</div><Input size="large" value={c.reason} onChange={(e) => c.setReason(e.target.value)} placeholder="Khách đổi ý, hàng lỗi, sai mẫu…" maxLength={200} /></div>
        <div className="rm-field"><div className="kv-hint">Ngày trả</div><DatePicker size="large" style={{ width: '100%' }} format="DD/MM/YYYY HH:mm" showTime value={c.returnDate} onChange={(v) => v && c.setReturnDate(v)} /></div>
        <div className="rm-field"><div className="kv-hint">Phí trả hàng (trừ vào tiền hoàn)</div><MoneyInput size="large" value={c.fee} max={c.subtotal} onChange={(v) => c.setFee(toNum(v))} /></div>
        <div className="rm-field"><div className="kv-hint">Ghi chú</div><Input.TextArea rows={2} value={c.note} onChange={(e) => c.setNote(e.target.value)} maxLength={1000} /></div>
        <div className="rm-settle">
          <span>Hóa đơn</span><span className="v">{c.inv.code} · {money(c.inv.totalAmount)}</span>
          {toNum(c.inv.returnedAmount) > 0 && <><span>Đã trả trước đó</span><span className="v">{money(c.inv.returnedAmount)}</span></>}
          <span>Giá trị hàng trả</span><span className="v">{money(c.subtotal)}</span>
          {c.feeApplied > 0 && <><span>Phí trả hàng</span><span className="v">−{money(c.feeApplied)}</span></>}
          <span className="hr" />
          <span>Tiền hoàn khách</span><span className="v big">{money(c.totalRefund)}</span>
        </div>
        {c.totalRefund > c.maxRefund + 0.01 && <div className="neg" style={{ fontSize: 13 }}>Tiền hoàn vượt phần còn lại của hóa đơn ({money(c.maxRefund)})</div>}
        <div className="kv-hint">{c.hasCustomer ? 'Khách có hồ sơ: khi thanh toán có thể hoàn tiền ngay, hoàn một phần hoặc ghi có công nợ.' : 'Khách lẻ: khi thanh toán phải hoàn đủ tiền ngay (hoặc đổi hàng).'} Giá hoàn mặc định = số tiền khách đã trả cho mỗi đơn vị.</div>
      </Drawer>

      {/* dòng hàng trả */}
      <Drawer className="ps-sheet iv-sheet" placement="bottom" height="auto" open={!!line} onClose={() => setLineId(null)} title={<span style={{ whiteSpace: 'normal', fontSize: 16 }}>{line?.name}</span>} styles={{ body: sheetBody }}>
        {line && (
          <>
            <div className="ps-edit-row"><span>Số lượng trả</span>
              <span className="rm-step on">
                <button type="button" onClick={() => c.upd(line.invoiceLineId, { quantity: Math.max(0, line.quantity - 1) })}><MinusOutlined /></button>
                <QuantityInput variant="borderless" style={{ width: 70, textAlign: 'center' }} min={0} max={line.returnable} inputMode="decimal" value={line.quantity} onChange={(v) => c.upd(line.invoiceLineId, { quantity: Math.min(toNum(v), line.returnable) })} />
                <button type="button" onClick={() => c.upd(line.invoiceLineId, { quantity: Math.min(line.returnable, line.quantity + 1) })}><PlusOutlined /></button>
              </span>
            </div>
            <div className="kv-hint">Đã mua {qty(line.sold)} {line.unit} · còn trả được <b>{qty(line.returnable)}</b> · mã {line.sku}</div>
            {line.productType !== 'SERVICE' && <div className="ps-edit-row"><span>Tình trạng</span><Segmented value={line.condition} onChange={(v) => c.upd(line.invoiceLineId, { condition: v as ReturnCondition })} options={condOptions} /></div>}
            <div className="ps-edit-row"><span>Giá hoàn</span>{c.canPriceEdit ? <MoneyInput size="large" style={{ width: 180 }} max={line.defaultPrice} value={line.unitPrice} onChange={(v) => c.upd(line.invoiceLineId, { unitPrice: Math.min(toNum(v), line.defaultPrice) })} /> : <b>{money(line.unitPrice)}</b>}</div>
            {c.canPriceEdit && <div className="kv-hint">Tối đa {money(line.defaultPrice)} / đơn vị (số tiền khách đã trả)</div>}
            <div className="ps-edit-row"><span>Ghi chú</span><Input size="large" style={{ width: 180 }} value={line.note ?? ''} onChange={(e) => c.upd(line.invoiceLineId, { note: e.target.value })} placeholder="Ghi chú dòng" /></div>
            <div className="ps-edit-row total"><span>Thành tiền</span><b>{money(line.quantity * line.unitPrice)}</b></div>
            {line.error && <div className="neg" style={{ fontSize: 13 }}>{line.error}</div>}
            <Button size="large" type="primary" onClick={() => setLineId(null)}>Xong</Button>
          </>
        )}
      </Drawer>

      {/* dòng hàng mua (đổi hàng) */}
      <Drawer className="ps-sheet iv-sheet" placement="bottom" height="auto" open={!!xLine} onClose={() => setXKey(null)} title={<span style={{ whiteSpace: 'normal', fontSize: 16 }}>{xLine?.name}</span>} styles={{ body: sheetBody }}>
        {xLine && (
          <>
            <div className="ps-edit-row"><span>Số lượng</span>
              <span className="rm-step on">
                <button type="button" onClick={() => c.setX(xLine.key, { quantity: Math.max(1, xLine.quantity - 1) })}><MinusOutlined /></button>
                <QuantityInput variant="borderless" style={{ width: 70, textAlign: 'center' }} min={0.001} inputMode="decimal" value={xLine.quantity} onChange={(v) => c.setX(xLine.key, { quantity: toNum(v) })} />
                <button type="button" onClick={() => c.setX(xLine.key, { quantity: xLine.quantity + 1 })}><PlusOutlined /></button>
              </span>
            </div>
            <div className="kv-hint">Mã {xLine.sku} · tồn {qty(xLine.onHand)}{xLine.unitName ? ` · ĐVT ${xLine.unitName}` : ''}</div>
            {xLine.trackBatch && <div className="ps-edit-row"><span>Lô hàng</span>{c.batchSelect(xLine)}</div>}
            <div className="ps-edit-row"><span>Đơn giá</span>{c.canSellPrice ? <MoneyInput size="large" style={{ width: 180 }} value={xLine.unitPrice} onChange={(v) => c.setX(xLine.key, { unitPrice: toNum(v) })} /> : <b>{money(xLine.unitPrice)}</b>}</div>
            <div className="ps-edit-row"><span>Giảm giá dòng</span><MoneyInput size="large" style={{ width: 180 }} value={xLine.discount} max={xLine.quantity * xLine.unitPrice} onChange={(v) => c.setX(xLine.key, { discount: Math.min(toNum(v), xLine.quantity * xLine.unitPrice) })} /></div>
            <div className="ps-edit-row total"><span>Thành tiền</span><b>{money(Math.max(0, xLine.quantity * xLine.unitPrice - xLine.discount))}</b></div>
            {xLine.error && <div className="neg" style={{ fontSize: 13 }}>{xLine.error}</div>}
            <Button danger size="large" icon={<DeleteOutlined />} onClick={() => { c.removeX(xLine.key); setXKey(null); }}>Bỏ hàng mua này</Button>
          </>
        )}
      </Drawer>

      {/* đổi hàng: thu thêm / hoàn lại */}
      <Drawer className="ps-sheet iv-sheet" placement="bottom" height="auto" open={sheet === 'settle'} onClose={() => setSheet(null)} title="Hoàn tất đổi hàng" styles={{ body: sheetBody }}>
        <div className="rm-settle">
          <span>Giá trị hàng trả</span><span className="v">{money(c.settle.R)}</span>
          <span>Tiền hàng mua</span><span className="v">{money(c.settle.N)}</span>
          <span>Cấn trừ</span><span className="v">−{money(c.settle.offset)}</span>
          <span className="hr" />
          {c.settle.customerPays > 0 && <><span>Khách cần trả thêm</span><span className="v big">{money(c.settle.customerPays)}</span></>}
          {c.settle.refundDue > 0 && <><span>Hoàn lại khách</span><span className="v big">{money(c.settle.refundDue)}</span></>}
          {c.settle.customerPays <= 0 && c.settle.refundDue <= 0 && <><span>Chênh lệch</span><span className="v big">0</span></>}
        </div>
        <div className="rm-field"><div className="kv-hint">Giảm giá hóa đơn mới</div><MoneyInput size="large" value={c.xDiscount} max={c.xTotals.subtotal} onChange={(v) => c.setXDiscount(toNum(v))} /></div>
        {c.settle.customerPays > 0 && (
          <>
            <div className="rm-field"><div className="kv-hint">Khách trả thêm</div><MoneyInput size="large" value={c.payNow} max={c.settle.customerPays} disabled={!c.hasCustomer} onChange={(v) => c.setPayAmount(Math.min(toNum(v), c.settle.customerPays))} /></div>
            <div className="rm-field"><div className="kv-hint">Hình thức</div><Select size="large" value={c.payMethod} onChange={c.setPayMethod} options={METHOD_OPTIONS} /></div>
            <div className="kv-hint">{c.hasCustomer ? (c.payNow + 0.01 < c.settle.customerPays ? <span>Phần còn lại <b className="neg">{money(c.settle.customerPays - c.payNow)}</b> ghi nợ cho khách.</span> : 'Khách thanh toán đủ phần chênh lệch.') : 'Khách lẻ phải trả đủ phần chênh lệch.'}</div>
          </>
        )}
        {c.settle.refundDue > 0 && (
          <>
            {c.hasCustomer && <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}><Switch checked={c.refCredit} onChange={c.setRefCredit} /><span><b>Ghi có công nợ, không hoàn tiền</b><div className="kv-hint">Khách giữ {money(c.settle.refundDue)} cho lần mua sau.</div></span></div>}
            {!c.refCredit && (
              <>
                <div className="rm-field"><div className="kv-hint">Hoàn lại khách</div><MoneyInput size="large" value={c.refundNow} max={c.settle.refundDue} disabled={!c.hasCustomer} onChange={(v) => c.setRefAmount(Math.min(toNum(v), c.settle.refundDue))} /></div>
                <div className="rm-field"><div className="kv-hint">Hình thức</div><Select size="large" value={c.refMethod} onChange={c.setRefMethod} options={METHOD_OPTIONS} /></div>
                {c.hasCustomer && c.refundNow + 0.01 < c.settle.refundDue && <div className="kv-hint">Phần còn lại <b>{money(c.settle.refundDue - c.refundNow)}</b> ghi có công nợ khách.</div>}
              </>
            )}
          </>
        )}
        <div className="rm-field"><div className="kv-hint">Ghi chú hóa đơn mới</div><Input size="large" value={c.xNote} onChange={(e) => c.setXNote(e.target.value)} placeholder={`Đổi hàng từ ${c.inv.code}`} /></div>
        <Button type="primary" size="large" block loading={c.saving === 'exchange'} onClick={() => void c.submitExchange().then(() => setSheet(null))}>Hoàn tất đổi hàng</Button>
      </Drawer>

      {children}
    </div>
  );
}
