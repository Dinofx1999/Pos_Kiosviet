import { Alert, App, Button, Card, InputNumber, Skeleton, Switch } from 'antd';
import { useEffect, useState } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { errMsg } from '../../api/client';
import { orgApi } from '../../api/org';
import { MoneyInput } from '../../components/Inputs';
import { money, toNum } from '../../utils/format';
import './loyalty.css';

const K = { enabled: 'loyalty.enabled', earnPoints: 'loyalty.earnPoints', earnPerAmount: 'loyalty.earnPerAmount', redeemValue: 'loyalty.redeemValue', minRedeem: 'loyalty.minRedeemPoints', maxRedeemPercent: 'loyalty.maxRedeemPercent' } as const;
interface Cfg { enabled: boolean; earnPoints: number; earnPerAmount: number; redeemValue: number; minRedeem: number; maxRedeemPercent: number }
const DEFAULTS: Cfg = { enabled: false, earnPoints: 1, earnPerAmount: 10000, redeemValue: 1000, minRedeem: 0, maxRedeemPercent: 100 };
const num = (v: unknown, d: number) => (typeof v === 'number' && Number.isFinite(v) ? v : d);
const fromSettings = (s: Record<string, unknown>): Cfg => ({ enabled: s[K.enabled] === true, earnPoints: num(s[K.earnPoints], DEFAULTS.earnPoints), earnPerAmount: num(s[K.earnPerAmount], DEFAULTS.earnPerAmount), redeemValue: num(s[K.redeemValue], DEFAULTS.redeemValue), minRedeem: num(s[K.minRedeem], DEFAULTS.minRedeem), maxRedeemPercent: num(s[K.maxRedeemPercent], DEFAULTS.maxRedeemPercent) });
const fmtN = (n: number) => n.toLocaleString('vi-VN', { maximumFractionDigits: 2 });

/** Thiết lập › Tích điểm (BR-140, BR-141): earning rule, point value, redemption limits – one PUT /settings. */
export function LoyaltySettingsTab() {
  const { message } = App.useApp();
  const qc = useQueryClient();
  const settings = useQuery({ queryKey: ['settings'], queryFn: orgApi.settings });
  const [cfg, setCfg] = useState<Cfg>(DEFAULTS);
  const [dirty, setDirty] = useState(false);
  const [saving, setSaving] = useState(false);
  useEffect(() => { if (settings.data && !dirty) setCfg(fromSettings(settings.data)); }, [settings.data]);
  const set = (p: Partial<Cfg>) => { setCfg((c) => ({ ...c, ...p })); setDirty(true); };
  const problems: string[] = [];
  if (!(cfg.earnPerAmount > 0)) problems.push('Số tiền để tích điểm phải lớn hơn 0');
  if (cfg.earnPoints < 0 || cfg.earnPoints > 1_000_000) problems.push('Số điểm tích phải từ 0 đến 1.000.000');
  if (cfg.redeemValue < 0) problems.push('Giá trị 1 điểm không được âm');
  if (!Number.isInteger(cfg.minRedeem) || cfg.minRedeem < 0) problems.push('Điểm tối thiểu mỗi lần dùng phải là số nguyên ≥ 0');
  if (cfg.maxRedeemPercent < 0 || cfg.maxRedeemPercent > 100) problems.push('Tỷ lệ tối đa phải từ 0 đến 100 %');
  const save = async () => {
    if (problems.length) { message.warning(problems[0]); return; }
    setSaving(true);
    try {
      await orgApi.updateSettings({ [K.enabled]: cfg.enabled, [K.earnPoints]: cfg.earnPoints, [K.earnPerAmount]: cfg.earnPerAmount, [K.redeemValue]: cfg.redeemValue, [K.minRedeem]: cfg.minRedeem, [K.maxRedeemPercent]: cfg.maxRedeemPercent });
      message.success('Đã lưu cấu hình tích điểm');
      setDirty(false);
      ['settings', 'me'].forEach((k) => qc.invalidateQueries({ queryKey: [k] }));
    } catch (e) { message.error(errMsg(e)); } finally { setSaving(false); }
  };
  const example = 500_000;
  const earned = cfg.earnPerAmount > 0 ? Math.floor((example / cfg.earnPerAmount) * cfg.earnPoints) : 0;
  const maxPts = cfg.redeemValue > 0 ? Math.floor(((example * cfg.maxRedeemPercent) / 100) / cfg.redeemValue) : 0;
  return (
    <Card size="small" title="Tích điểm khách hàng" extra={<Button type="primary" size="small" onClick={save} loading={saving} disabled={!dirty}>Lưu</Button>}>
      {settings.isLoading && !settings.data ? <Skeleton active /> : (
        <>
          {settings.error && <Alert type="error" showIcon message={errMsg(settings.error)} style={{ marginBottom: 10 }} />}
          <div className="lp-switch-row"><Switch checked={cfg.enabled} onChange={(v) => set({ enabled: v })} /><b>{cfg.enabled ? 'Đang bật tích điểm' : 'Tích điểm đang tắt'}</b><span className="kv-hint">Khi tắt, hóa đơn không tích điểm và quầy không dùng được điểm; số dư hiện có vẫn giữ nguyên.</span></div>
          <div className={cfg.enabled ? undefined : 'lp-off'}>
            <div className="lp-grid">
              <div className="lp-field"><div className="lbl">Số điểm tích được</div><InputNumber min={0} max={1_000_000} step={1} value={cfg.earnPoints} onChange={(v) => set({ earnPoints: toNum(v) })} suffix="điểm" inputMode="decimal" /><div className="hint">Khách nhận số điểm này cho mỗi mức tiền bên cạnh</div></div>
              <div className="lp-field"><div className="lbl">Cho mỗi số tiền thanh toán bằng tiền</div><MoneyInput min={1} value={cfg.earnPerAmount} onChange={(v) => set({ earnPerAmount: toNum(v) })} suffix="đ" /><div className="hint">Tổng hóa đơn trừ phần trả bằng điểm, làm tròn xuống số điểm nguyên</div></div>
              <div className="lp-field"><div className="lbl">Giá trị 1 điểm khi sử dụng</div><MoneyInput min={0} value={cfg.redeemValue} onChange={(v) => set({ redeemValue: toNum(v) })} suffix="đ" /><div className="hint">0 = chỉ tích, không cho dùng điểm thanh toán</div></div>
              <div className="lp-field"><div className="lbl">Số điểm tối thiểu mỗi lần dùng</div><InputNumber min={0} step={1} precision={0} value={cfg.minRedeem} onChange={(v) => set({ minRedeem: Math.max(0, Math.round(toNum(v))) })} suffix="điểm" inputMode="numeric" /><div className="hint">Khách phải có ít nhất bấy nhiêu điểm mới được dùng</div></div>
              <div className="lp-field"><div className="lbl">Tối đa % giá trị hóa đơn được trả bằng điểm</div><InputNumber min={0} max={100} step={5} value={cfg.maxRedeemPercent} onChange={(v) => set({ maxRedeemPercent: toNum(v) })} suffix="%" inputMode="decimal" /><div className="hint">100 = có thể trả toàn bộ hóa đơn bằng điểm</div></div>
            </div>
            <div className="lp-rule">
              Khách nhận <b>{fmtN(cfg.earnPoints)} điểm</b> cho mỗi <b>{money(cfg.earnPerAmount)} đ</b> thanh toán bằng tiền · <b>1 điểm = {money(cfg.redeemValue)} đ</b> · dùng tối thiểu <b>{fmtN(cfg.minRedeem)} điểm</b>/lần · tối đa <b>{fmtN(cfg.maxRedeemPercent)} %</b> giá trị hóa đơn.
            </div>
            <div className="lp-example">
              <div><span className="k">Ví dụ hóa đơn {money(example)} đ có khách hàng: </span>tích <b>{fmtN(earned)} điểm</b> (tương đương {money(earned * cfg.redeemValue)} đ){cfg.redeemValue > 0 ? <> · khách có thể dùng tối đa <b>{fmtN(maxPts)} điểm</b> ({money(maxPts * cfg.redeemValue)} đ) để trả cho hóa đơn này{cfg.minRedeem > maxPts ? ' – thấp hơn mức tối thiểu nên không dùng được' : ''}</> : null}.</div>
            </div>
          </div>
          {problems.length > 0 && <Alert type="warning" showIcon style={{ marginTop: 10 }} message={problems[0]} />}
          <ul className="lp-notes">
            <li>Điểm được ghi khi hóa đơn hoàn thành và chỉ với hóa đơn có khách hàng; hủy hóa đơn trả lại / thu hồi toàn bộ điểm, trả hàng thu hồi điểm theo tỷ lệ tiền hoàn.</li>
            <li>Dùng điểm là một hình thức thanh toán (phương thức "Điểm tích lũy"), không phải giảm giá: doanh thu giữ nguyên, không vào sổ quỹ / tiền mặt ca.</li>
            <li>Điều chỉnh điểm thủ công cần quyền "Điều chỉnh điểm tích lũy" (loyalty.manage) và ghi lý do; xem sổ điểm trong Khách hàng › Điểm tích lũy.</li>
          </ul>
        </>
      )}
    </Card>
  );
}
