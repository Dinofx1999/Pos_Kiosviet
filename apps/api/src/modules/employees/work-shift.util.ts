/**
 * Ca làm việc (BR-187): khung giờ ca của một lượt chấm công và giờ công tính trong khung ca.
 * Giờ ca lưu theo phút trong ngày (giờ địa phương của cửa hàng); hết ca ≤ vào ca = ca qua đêm (kết thúc sáng hôm sau).
 */
export interface ShiftDef { id: string; name: string; startMinute: number; endMinute: number }
export interface ShiftWindow { start: Date; end: Date }

const DAY = 86_400_000;
/** Chấm vào sớm hơn giờ vào ca tối đa bao lâu vẫn được coi là đi ca đó (tự nhận ca). */
export const EARLY_MATCH_MS = 3 * 3_600_000;

/** Độ lệch (ms) của múi giờ so với UTC tại thời điểm `at` (VD Asia/Ho_Chi_Minh = +7 giờ). */
export function tzOffsetMs(at: Date, tz: string): number {
  const parts = new Intl.DateTimeFormat('en-US', { timeZone: tz, hourCycle: 'h23', year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', second: '2-digit' }).formatToParts(at);
  const p = Object.fromEntries(parts.map((x) => [x.type, x.value])) as Record<string, string>;
  const asUtc = Date.UTC(+p.year, +p.month - 1, +p.day, +p.hour, +p.minute, +p.second);
  return asUtc - Math.floor(at.getTime() / 1000) * 1000;
}

/** 0 giờ (giờ địa phương) của ngày chứa `at`. */
export function localDayStart(at: Date, tz: string): Date {
  const off = tzOffsetMs(at, tz);
  const local = at.getTime() + off;
  return new Date(local - (((local % DAY) + DAY) % DAY) - off);
}

/** Độ dài ca (phút): 08:00–17:00 = 540; 22:00–06:00 = 480; vào = ra coi như 24 giờ. */
export const shiftLength = (s: Pick<ShiftDef, 'startMinute' | 'endMinute'>) => (((s.endMinute - s.startMinute) % 1440) + 1440) % 1440 || 1440;

/** Khung giờ của ca trong ngày hôm trước / hôm nay / hôm sau so với `at`. */
function windows(s: ShiftDef, at: Date, tz: string): ShiftWindow[] {
  const day0 = localDayStart(at, tz).getTime();
  return [-1, 0, 1].map((d) => { const start = day0 + d * DAY + s.startMinute * 60_000; return { start: new Date(start), end: new Date(start + shiftLength(s) * 60_000) }; });
}

/** Khung giờ của một ca cụ thể gần thời điểm chấm vào nhất (theo giờ vào ca). */
export function windowFor(s: ShiftDef, at: Date, tz: string): ShiftWindow {
  return windows(s, at, tz).sort((a, b) => Math.abs(a.start.getTime() - at.getTime()) - Math.abs(b.start.getTime() - at.getTime()))[0];
}

/**
 * Tự nhận ca khi chấm vào: các ca có khung [vào ca − 3 giờ, hết ca) chứa giờ chấm; nhiều ca thì lấy ca có giờ vào gần giờ chấm nhất
 * (ca dài hơn thắng khi bằng nhau). Không ca nào khớp → null (chấm ngoài giờ ca).
 */
export function matchShift<T extends ShiftDef>(shifts: T[], at: Date, tz: string): { shift: T; window: ShiftWindow } | null {
  let best: { shift: T; window: ShiftWindow; gap: number } | null = null;
  for (const s of shifts) {
    for (const w of windows(s, at, tz)) {
      if (at.getTime() < w.start.getTime() - EARLY_MATCH_MS || at.getTime() >= w.end.getTime()) continue;
      const gap = Math.abs(w.start.getTime() - at.getTime());
      if (!best || gap < best.gap || (gap === best.gap && shiftLength(s) > shiftLength(best.shift))) best = { shift: s, window: w, gap };
    }
  }
  return best ? { shift: best.shift, window: best.window } : null;
}

/** Giờ công (phút): có ca → phần giao giữa [vào, ra] và khung ca (vào sớm tính từ giờ vào ca, ra muộn tính đến hết ca); không ca → cả lượt. */
export function creditedMinutes(checkIn: Date, checkOut: Date, window?: { start: Date | null; end: Date | null } | null): number {
  const from = window?.start && window.start > checkIn ? window.start : checkIn;
  const to = window?.end && window.end < checkOut ? window.end : checkOut;
  return Math.max(0, Math.round((to.getTime() - from.getTime()) / 60_000));
}

/** "07:30" ↔ 450 */
export const minuteToHHmm = (m: number) => `${String(Math.floor(m / 60)).padStart(2, '0')}:${String(m % 60).padStart(2, '0')}`;
