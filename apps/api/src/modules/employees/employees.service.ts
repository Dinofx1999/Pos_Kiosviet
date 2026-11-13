import { Injectable } from '@nestjs/common';
import { TENANT_SETTING_KEYS } from '@erp/shared';
import { ClsService } from 'nestjs-cls';
import { CommissionBasis, Prisma } from '@prisma/client';
import { Errors } from '../../common/errors/app-error';
import { paginated, skipTake } from '../../common/pagination';
import { D, money, ZERO } from '../../common/utils/decimal';
import { AccessService } from '../../infra/access/access.service';
import { AuditService } from '../../infra/audit/audit.service';
import { getCtx, RequestUser } from '../../infra/cls/request-context';
import { PrismaService } from '../../infra/prisma/prisma.service';
import { AttendanceQueryDto, AttendanceDevicePatchDto, AttendanceDeviceQueryDto, CheckInDto, CheckOutDto, CreateCommissionRuleDto, CreateWorkShiftDto, EditAttendanceDto, EmployeeQueryDto, LatePolicyDto, ManualAttendanceDto, PeriodQueryDto, UpdateCommissionRuleDto, UpdateWorkShiftDto } from './dto/employees.dto';
import { creditedMinutes, LATE_POLICY_KEY, lateOf, LatePolicy, matchShift, minuteToHHmm, normalizeLatePolicy, ShiftWindow, windowFor } from './work-shift.util';

const SHIFT_SELECT = { id: true, name: true, startMinute: true, endMinute: true } as const;
const toMinute = (hhmm: string) => Number(hhmm.slice(0, 2)) * 60 + Number(hhmm.slice(3, 5));

const NONE = '00000000-0000-0000-0000-000000000000';
const uuidList = (ids: string[]) => Prisma.join((ids.length ? ids : [NONE]).map((id) => Prisma.sql`${id}::uuid`));

interface SaleLine { seller_id: string | null; full_name: string | null; variant_id: string; category_id: string | null; invoice_id: string; net_revenue: Prisma.Decimal; net_cost: Prisma.Decimal; net_qty: Prisma.Decimal }
interface Rule { id: string; name: string; userId: string | null; categoryId: string | null; variantId: string | null; basis: CommissionBasis; rate: Prisma.Decimal; minRevenue: Prisma.Decimal; priority: number }

/** Nhân viên (BR-150..BR-153): hồ sơ, quy tắc hoa hồng + báo cáo, chấm công, hiệu suất. */
@Injectable()
export class EmployeesService {
  constructor(private readonly prisma: PrismaService, private readonly access: AccessService, private readonly audit: AuditService, private readonly cls: ClsService) {}

  // ---------------------------------------------------------------- employees (slim list for managers)
  async list(user: RequestUser, q: EmployeeQueryDto) {
    const where: Prisma.UserWhereInput = {
      ...(q.status ? { status: q.status as never } : {}),
      ...(q.branchId ? { OR: [{ allBranches: true }, { branchAccess: { some: { branchId: q.branchId } } }] } : {}),
      ...(q.search ? { OR: [{ fullName: { contains: q.search, mode: 'insensitive' } }, { username: { contains: q.search, mode: 'insensitive' } }, { phone: { contains: q.search } }] } : {}),
    };
    const [rows, total] = await Promise.all([
      this.prisma.db.user.findMany({ where, select: { id: true, username: true, fullName: true, email: true, phone: true, status: true, isOwner: true, allBranches: true, position: true, hiredAt: true, baseSalary: true, employeeNote: true, lastLoginAt: true, roles: { select: { role: { select: { id: true, code: true, name: true } } } }, branchAccess: { select: { branch: { select: { id: true, name: true } } } } }, ...skipTake(q), orderBy: { fullName: 'asc' } }),
      this.prisma.db.user.count({ where }),
    ]);
    const canSalary = user.permissions.has('*') || user.permissions.has('employee.manage');
    return paginated(rows.map((r) => ({ ...r, baseSalary: canSalary ? r.baseSalary : undefined, roles: r.roles.map((x) => x.role), branches: r.branchAccess.map((b) => b.branch), branchAccess: undefined })), total, q);
  }

  // ---------------------------------------------------------------- commission rules
  async listRules(includeInactive = false) {
    const rules = await this.prisma.db.commissionRule.findMany({ where: includeInactive ? {} : { isActive: true }, include: { user: { select: { id: true, fullName: true } } }, orderBy: [{ priority: 'desc' }, { createdAt: 'asc' }] });
    const categoryIds = [...new Set(rules.map((r) => r.categoryId).filter((x): x is string => !!x))];
    const variantIds = [...new Set(rules.map((r) => r.variantId).filter((x): x is string => !!x))];
    const [cats, vars] = await Promise.all([
      categoryIds.length ? this.prisma.db.productCategory.findMany({ where: { id: { in: categoryIds } }, select: { id: true, name: true } }) : ([] as Array<{ id: string; name: string }>),
      variantIds.length ? this.prisma.db.productVariant.findMany({ where: { id: { in: variantIds } }, select: { id: true, sku: true, name: true } }) : ([] as Array<{ id: string; sku: string; name: string }>),
    ]);
    const cat = new Map(cats.map((c) => [c.id, c])); const vr = new Map(vars.map((v) => [v.id, v]));
    return rules.map((r) => ({ ...r, category: r.categoryId ? cat.get(r.categoryId) ?? null : null, variant: r.variantId ? vr.get(r.variantId) ?? null : null }));
  }
  async createRule(user: RequestUser, dto: CreateCommissionRuleDto) {
    await this.assertRuleRefs(dto);
    const r = await this.prisma.db.commissionRule.create({ data: { tenantId: user.tenantId, name: dto.name, userId: dto.userId ?? null, categoryId: dto.categoryId ?? null, variantId: dto.variantId ?? null, basis: dto.basis ?? 'REVENUE', rate: money(dto.rate), minRevenue: money(dto.minRevenue ?? 0), priority: dto.priority ?? 0, isActive: dto.isActive ?? true, startsAt: dto.startsAt ? new Date(dto.startsAt) : null, endsAt: dto.endsAt ? new Date(dto.endsAt) : null } });
    await this.audit.log(this.prisma.db as never, { action: 'commission.rule.create', entityType: 'CommissionRule', entityId: r.id, after: r });
    return r;
  }
  async updateRule(user: RequestUser, id: string, dto: UpdateCommissionRuleDto) {
    const before = await this.prisma.db.commissionRule.findFirst({ where: { id } });
    if (!before) throw Errors.notFound('Quy tắc hoa hồng', id);
    await this.assertRuleRefs({ userId: dto.userId ?? undefined, categoryId: dto.categoryId ?? undefined, variantId: dto.variantId ?? undefined });
    const after = await this.prisma.db.commissionRule.update({ where: { id }, data: { name: dto.name, userId: dto.userId === undefined ? undefined : dto.userId, categoryId: dto.categoryId === undefined ? undefined : dto.categoryId, variantId: dto.variantId === undefined ? undefined : dto.variantId, basis: dto.basis, rate: dto.rate === undefined ? undefined : money(dto.rate), minRevenue: dto.minRevenue === undefined ? undefined : money(dto.minRevenue), priority: dto.priority, isActive: dto.isActive, startsAt: dto.startsAt === undefined ? undefined : dto.startsAt ? new Date(dto.startsAt) : null, endsAt: dto.endsAt === undefined ? undefined : dto.endsAt ? new Date(dto.endsAt) : null } });
    await this.audit.log(this.prisma.db as never, { action: 'commission.rule.update', entityType: 'CommissionRule', entityId: id, before, after });
    return after;
  }
  async removeRule(user: RequestUser, id: string) {
    const r = await this.prisma.db.commissionRule.findFirst({ where: { id } });
    if (!r) throw Errors.notFound('Quy tắc hoa hồng', id);
    await this.prisma.db.commissionRule.delete({ where: { id } });
    await this.audit.log(this.prisma.db as never, { action: 'commission.rule.delete', entityType: 'CommissionRule', entityId: id, before: r });
  }
  private async assertRuleRefs(dto: { userId?: string; categoryId?: string; variantId?: string }) {
    if (dto.userId && !(await this.prisma.db.user.findFirst({ where: { id: dto.userId } }))) throw Errors.notFound('Nhân viên', dto.userId);
    if (dto.categoryId && !(await this.prisma.db.productCategory.findFirst({ where: { id: dto.categoryId } }))) throw Errors.notFound('Nhóm hàng', dto.categoryId);
    if (dto.variantId && !(await this.prisma.db.productVariant.findFirst({ where: { id: dto.variantId } }))) throw Errors.notFound('Hàng hóa', dto.variantId);
  }

  /** Net sale lines (completed invoices, returned share removed) for the period. */
  private async saleLines(user: RequestUser, q: PeriodQueryDto, from: Date, to: Date): Promise<SaleLine[]> {
    const scope = this.access.branchWhere(user);
    if (q.branchId) this.access.assertBranch(user, q.branchId);
    const branches = q.branchId ? [q.branchId] : scope.branchId ? scope.branchId.in : null;
    const brSql = branches ? Prisma.sql`AND i.branch_id IN (${uuidList(branches)})` : Prisma.empty;
    const userSql = q.userId ? Prisma.sql`AND i.seller_id = ${q.userId}::uuid` : Prisma.empty;
    return this.prisma.raw.$queryRaw<SaleLine[]>`
      SELECT i.seller_id, u.full_name, l.variant_id, p.category_id, i.id AS invoice_id,
        COALESCE(l.line_total * (1 - (i.discount_amount + i.promotion_discount) / NULLIF(i.subtotal, 0)) * (1 - l.returned_quantity / NULLIF(l.quantity, 0)), 0) AS net_revenue,
        COALESCE(l.cost_total * (1 - l.returned_quantity / NULLIF(l.quantity, 0)), 0) AS net_cost,
        (l.quantity - l.returned_quantity) AS net_qty
      FROM invoice_lines l JOIN invoices i ON i.id = l.invoice_id JOIN product_variants v ON v.id = l.variant_id JOIN products p ON p.id = v.product_id LEFT JOIN users u ON u.id = i.seller_id
      WHERE i.tenant_id = ${user.tenantId}::uuid AND i.status = 'COMPLETED' AND i.imported = false AND i.invoice_date BETWEEN ${from} AND ${to} ${brSql} ${userSql}`;
  }

  private pickRule(rules: Rule[], sellerId: string, variantId: string, categoryId: string | null): Rule | null {
    let best: Rule | null = null; let bestScore = -1;
    for (const r of rules) {
      if (r.userId && r.userId !== sellerId) continue;
      if (r.variantId && r.variantId !== variantId) continue;
      if (r.categoryId && r.categoryId !== categoryId) continue;
      const score = (r.userId ? 4 : 0) + (r.variantId ? 2 : 0) + (r.categoryId ? 1 : 0);
      if (score > bestScore || (score === bestScore && best && r.priority > best.priority)) { best = r; bestScore = score; }
    }
    return best;
  }

  /** Hoa hồng theo kỳ (BR-150): mỗi dòng bán gắn với quy tắc cụ thể nhất; ngưỡng doanh thu kiểm tra trên tổng kỳ của nhân viên. */
  async commissions(user: RequestUser, q: PeriodQueryDto) {
    const from = q.from ? new Date(q.from) : new Date(new Date().setDate(1));
    const to = q.to ? new Date(q.to) : new Date();
    const [lines, rulesRaw] = await Promise.all([this.saleLines(user, q, from, to), this.prisma.db.commissionRule.findMany({ where: { isActive: true, AND: [{ OR: [{ startsAt: null }, { startsAt: { lte: to } }] }, { OR: [{ endsAt: null }, { endsAt: { gte: from } }] }] } })]);
    const rules: Rule[] = rulesRaw.map((r) => ({ id: r.id, name: r.name, userId: r.userId, categoryId: r.categoryId, variantId: r.variantId, basis: r.basis, rate: r.rate, minRevenue: r.minRevenue, priority: r.priority }));
    const sellers = new Map<string, { sellerId: string; name: string; revenue: Prisma.Decimal; cost: Prisma.Decimal; quantity: Prisma.Decimal; invoices: Set<string>; byRule: Map<string, { ruleId: string; name: string; basis: CommissionBasis; rate: Prisma.Decimal; base: Prisma.Decimal; commission: Prisma.Decimal; lines: number }>; commission: Prisma.Decimal }>();
    for (const l of lines) {
      if (!l.seller_id) continue;
      const s = sellers.get(l.seller_id) ?? sellers.set(l.seller_id, { sellerId: l.seller_id, name: l.full_name ?? '—', revenue: ZERO, cost: ZERO, quantity: ZERO, invoices: new Set(), byRule: new Map(), commission: ZERO }).get(l.seller_id)!;
      s.revenue = s.revenue.plus(D(l.net_revenue)); s.cost = s.cost.plus(D(l.net_cost)); s.quantity = s.quantity.plus(D(l.net_qty)); s.invoices.add(l.invoice_id);
      const rule = this.pickRule(rules, l.seller_id, l.variant_id, l.category_id);
      if (!rule) continue;
      const base = rule.basis === 'REVENUE' ? D(l.net_revenue) : rule.basis === 'GROSS_PROFIT' ? Prisma.Decimal.max(ZERO, D(l.net_revenue).minus(D(l.net_cost))) : D(l.net_qty);
      const amount = rule.basis === 'QUANTITY' ? base.times(D(rule.rate)) : base.times(D(rule.rate)).dividedBy(100);
      const agg = s.byRule.get(rule.id) ?? s.byRule.set(rule.id, { ruleId: rule.id, name: rule.name, basis: rule.basis, rate: D(rule.rate), base: ZERO, commission: ZERO, lines: 0 }).get(rule.id)!;
      agg.base = agg.base.plus(base); agg.commission = agg.commission.plus(amount); agg.lines++;
    }
    const data = Array.from(sellers.values()).map((s) => {
      // minRevenue gate per rule on the seller's total net revenue
      const byRule = Array.from(s.byRule.values()).map((r) => { const rule = rules.find((x) => x.id === r.ruleId)!; const eligible = s.revenue.greaterThanOrEqualTo(D(rule.minRevenue)); return { ...r, base: money(r.base), commission: eligible ? money(r.commission) : ZERO, eligible, minRevenue: D(rule.minRevenue) }; });
      const commission = byRule.reduce((a, r) => a.plus(r.commission), ZERO);
      return { sellerId: s.sellerId, name: s.name, invoices: s.invoices.size, revenue: money(s.revenue), cost: money(s.cost), grossProfit: money(s.revenue.minus(s.cost)), quantity: s.quantity, commission, byRule };
    }).sort((a, b) => b.commission.comparedTo(a.commission));
    return { from, to, rules: rules.length, data, totals: { sellers: data.length, revenue: data.reduce((a, r) => a.plus(r.revenue), ZERO), commission: data.reduce((a, r) => a.plus(r.commission), ZERO) } };
  }

  // ---------------------------------------------------------------- attendance (BR-151)
  // ---------------------------------------------------------------- chấm công GPS tại chi nhánh & chống chấm công hộ (thiết bị tin cậy)
  private async attendanceConfig() {
    const K = TENANT_SETTING_KEYS;
    const rows = await this.prisma.db.tenantSetting.findMany({ where: { key: { in: [K.ATTENDANCE_GPS_REQUIRED, K.ATTENDANCE_RADIUS, K.ATTENDANCE_DEVICE_LOCK, K.ATTENDANCE_MAX_ACCURACY] } } });
    const get = (k: string) => rows.find((r) => r.key === k)?.value as unknown;
    const num = (v: unknown, d: number) => (typeof v === 'number' && v > 0 ? v : d);
    return { gpsRequired: get(K.ATTENDANCE_GPS_REQUIRED) === true, radius: num(get(K.ATTENDANCE_RADIUS), 150), deviceLock: get(K.ATTENDANCE_DEVICE_LOCK) === true, maxAccuracy: num(get(K.ATTENDANCE_MAX_ACCURACY), 150) };
  }
  private async branchGeo(branchId: string | null) {
    if (!branchId) return null;
    const b = await this.prisma.db.branch.findFirst({ where: { id: branchId }, select: { id: true, name: true, latitude: true, longitude: true, radiusMeters: true } });
    return b ? { id: b.id, name: b.name, latitude: b.latitude === null ? null : Number(b.latitude), longitude: b.longitude === null ? null : Number(b.longitude), radiusMeters: b.radiusMeters } : null;
  }
  /** Khoảng cách (m) giữa hai tọa độ – công thức haversine. */
  static distanceMeters(aLat: number, aLng: number, bLat: number, bLng: number) {
    const rad = (d: number) => (d * Math.PI) / 180;
    const dLat = rad(bLat - aLat); const dLng = rad(bLng - aLng);
    const h = Math.sin(dLat / 2) ** 2 + Math.cos(rad(aLat)) * Math.cos(rad(bLat)) * Math.sin(dLng / 2) ** 2;
    return Math.round(2 * 6371000 * Math.asin(Math.min(1, Math.sqrt(h))));
  }
  /**
   * Kiểm tra vị trí so với chi nhánh. strict (chấm vào, cửa hàng bật "bắt buộc GPS", chi nhánh có tọa độ) → từ chối khi thiếu GPS,
   * sai số quá lớn hoặc ngoài bán kính; ngược lại chỉ ghi cờ. Trả về khoảng cách (m) nếu tính được.
   */
  private geoCheck(cfg: { gpsRequired: boolean; radius: number; maxAccuracy: number }, branch: { name: string; latitude: number | null; longitude: number | null; radiusMeters: number | null } | null, pos: { latitude?: number; longitude?: number; accuracy?: number }, strict: boolean, flags: string[], prefix = ''): number | null {
    const hasBranch = !!branch && branch.latitude !== null && branch.longitude !== null;
    const hasPos = pos.latitude !== undefined && pos.longitude !== undefined;
    const enforce = strict && cfg.gpsRequired && hasBranch;
    if (!hasPos) {
      if (enforce) throw Errors.conflict('ATTENDANCE_GPS_REQUIRED', `Chi nhánh ${branch!.name} yêu cầu bật định vị (GPS) khi chấm công – cho phép trình duyệt truy cập vị trí rồi thử lại`, { branchName: branch!.name });
      flags.push(`${prefix}NO_GPS`);
      return null;
    }
    if (!hasBranch) return null;
    if (pos.accuracy !== undefined && pos.accuracy > cfg.maxAccuracy) {
      if (enforce) throw Errors.conflict('ATTENDANCE_GPS_INACCURATE', `Vị trí chưa đủ chính xác (sai số ±${Math.round(pos.accuracy)} m) – ra chỗ thoáng, bật "định vị chính xác cao" rồi thử lại`, { accuracy: Math.round(pos.accuracy), maxAccuracy: cfg.maxAccuracy });
      flags.push(`${prefix}GPS_INACCURATE`);
    }
    const distance = EmployeesService.distanceMeters(pos.latitude!, pos.longitude!, branch!.latitude!, branch!.longitude!);
    const radius = branch!.radiusMeters ?? cfg.radius;
    const tolerance = Math.min(pos.accuracy ?? 0, 50);
    if (distance - tolerance > radius) {
      if (enforce) throw Errors.conflict('ATTENDANCE_OUT_OF_RANGE', `Bạn đang cách ${branch!.name} khoảng ${distance} m, ngoài bán kính cho phép ${radius} m – hãy đến cửa hàng rồi chấm công`, { distance, radius, branchName: branch!.name });
      flags.push(`${prefix}OUT_OF_RANGE`);
    }
    return distance;
  }
  /**
   * Thiết bị: mã do trình duyệt sinh và lưu trên máy. Mỗi thiết bị thuộc đúng một nhân viên; khi bật "khóa thiết bị" nhân viên
   * chỉ chấm được trên thiết bị đã tin cậy (thiết bị mới → PENDING chờ quản lý duyệt) và thiết bị của người khác bị từ chối –
   * đăng nhập tài khoản đồng nghiệp để chấm hộ không qua được. Khi không khóa: vẫn ghi nhận và gắn cờ để quản lý soát.
   */
  private async deviceCheck(user: RequestUser, cfg: { deviceLock: boolean }, dto: { deviceId?: string; deviceName?: string }, flags: string[]) {
    if (!dto.deviceId) {
      if (cfg.deviceLock) throw Errors.conflict('ATTENDANCE_DEVICE_REQUIRED', 'Không nhận diện được thiết bị – hãy chấm công bằng trình duyệt thường (không ở chế độ ẩn danh)');
      flags.push('NO_DEVICE');
      return null;
    }
    const now = new Date();
    const name = dto.deviceName?.slice(0, 200) || undefined;
    const found = await this.prisma.db.attendanceDevice.findFirst({ where: { deviceId: dto.deviceId } });
    if (!found) {
      const trusted = await this.prisma.db.attendanceDevice.count({ where: { userId: user.id, status: 'TRUSTED' } });
      const status = cfg.deviceLock && trusted >= 1 ? 'PENDING' : 'TRUSTED';
      const d = await this.prisma.db.attendanceDevice.create({ data: { tenantId: user.tenantId, userId: user.id, deviceId: dto.deviceId, name: name ?? null, status, firstSeenAt: now, lastSeenAt: now } });
      await this.audit.log(this.prisma.db as never, { action: 'attendance.device.register', entityType: 'AttendanceDevice', entityId: d.id, after: { status, name } });
      if (status === 'PENDING') throw Errors.conflict('ATTENDANCE_DEVICE_UNTRUSTED', 'Thiết bị mới chưa được duyệt – nhờ quản lý duyệt ở Chấm công → Thiết bị, hoặc chấm công bằng điện thoại đã đăng ký', { deviceId: d.id });
      if (trusted >= 1) flags.push('NEW_DEVICE');
      return d;
    }
    if (found.userId !== user.id) {
      if (cfg.deviceLock) throw Errors.conflict('ATTENDANCE_DEVICE_SHARED', 'Thiết bị này đã đăng ký cho nhân viên khác – không chấm công hộ được, hãy dùng điện thoại của bạn', { deviceId: found.id });
      flags.push('DEVICE_SHARED');
      await this.prisma.db.attendanceDevice.update({ where: { id: found.id }, data: { lastSeenAt: now } });
      return found;
    }
    if (found.status === 'BLOCKED') throw Errors.conflict('ATTENDANCE_DEVICE_BLOCKED', 'Thiết bị này đã bị quản lý khóa chấm công', { deviceId: found.id });
    if (found.status === 'PENDING' && cfg.deviceLock) throw Errors.conflict('ATTENDANCE_DEVICE_UNTRUSTED', 'Thiết bị đang chờ quản lý duyệt – nhờ quản lý duyệt ở Chấm công → Thiết bị', { deviceId: found.id });
    return this.prisma.db.attendanceDevice.update({ where: { id: found.id }, data: { lastSeenAt: now, status: 'TRUSTED', ...(name ? { name } : {}) } });
  }

  // ---------------------------------------------------------------- ca làm việc (BR-187)
  private async timezone(tenantId: string) {
    return (await this.prisma.raw.tenant.findUnique({ where: { id: tenantId }, select: { timezone: true } }))?.timezone || 'Asia/Ho_Chi_Minh';
  }
  /** Ca đang dùng của một chi nhánh (ca chung + ca riêng của chi nhánh). */
  private shiftsFor(branchId: string | null) {
    return this.prisma.db.workShift.findMany({ where: { isActive: true, ...(branchId ? { OR: [{ branchId: null }, { branchId }] } : { branchId: null }) }, select: { ...SHIFT_SELECT, branchId: true }, orderBy: [{ sortOrder: 'asc' }, { startMinute: 'asc' }] });
  }
  /**
   * Ca của một lượt: ca được chọn (khung giờ gần giờ vào nhất) hoặc tự nhận theo giờ vào. Có ca nhưng giờ vào ngoài mọi ca → cờ OFF_SHIFT
   * (giờ công tính cả lượt, quản lý soát lại). `chosen` = null → không theo ca.
   */
  private async resolveShift(tenantId: string, branchId: string | null, at: Date, chosen: string | null | undefined, flags?: string[]): Promise<{ workShiftId: string | null; window: ShiftWindow | null }> {
    if (chosen === null) return { workShiftId: null, window: null };
    const tz = await this.timezone(tenantId);
    if (chosen) {
      const sh = await this.prisma.db.workShift.findFirst({ where: { id: chosen }, select: SHIFT_SELECT });
      if (!sh) throw Errors.validation('Ca làm việc không tồn tại');
      return { workShiftId: sh.id, window: windowFor(sh, at, tz) };
    }
    const shifts = await this.shiftsFor(branchId);
    const m = matchShift(shifts, at, tz);
    if (!m) { if (shifts.length) flags?.push('OFF_SHIFT'); return { workShiftId: null, window: null }; }
    return { workShiftId: m.shift.id, window: m.window };
  }
  private shiftView<T extends { startMinute: number; endMinute: number }>(s: T) { return { ...s, start: minuteToHHmm(s.startMinute), end: minuteToHHmm(s.endMinute) }; }
  async listShifts(includeInactive: boolean) {
    const rows = await this.prisma.db.workShift.findMany({ where: includeInactive ? {} : { isActive: true }, include: { branch: { select: { id: true, name: true } }, _count: { select: { attendances: true } } }, orderBy: [{ isActive: 'desc' }, { sortOrder: 'asc' }, { startMinute: 'asc' }] });
    return rows.map(({ _count, ...r }) => ({ ...this.shiftView(r), used: _count.attendances }));
  }
  private async checkShiftInput(branchId: string | null | undefined, start?: string, end?: string) {
    if (start !== undefined && end !== undefined && start === end) throw Errors.validation('Giờ vào ca và giờ hết ca không được trùng nhau');
    if (branchId && !(await this.prisma.db.branch.findFirst({ where: { id: branchId } }))) throw Errors.notFound('Chi nhánh', branchId);
  }
  async createShift(user: RequestUser, dto: CreateWorkShiftDto) {
    await this.checkShiftInput(dto.branchId, dto.start, dto.end);
    const r = await this.prisma.db.workShift.create({ data: { tenantId: user.tenantId, name: dto.name, startMinute: toMinute(dto.start), endMinute: toMinute(dto.end), branchId: dto.branchId ?? null, isActive: dto.isActive ?? true, sortOrder: dto.sortOrder ?? 0 } });
    await this.audit.log(this.prisma.db as never, { action: 'attendance.shift.create', entityType: 'WorkShift', entityId: r.id, after: { name: r.name, start: dto.start, end: dto.end, branchId: r.branchId } });
    return this.shiftView(r);
  }
  async updateShift(user: RequestUser, id: string, dto: UpdateWorkShiftDto) {
    const cur = await this.prisma.db.workShift.findFirst({ where: { id } });
    if (!cur) throw Errors.notFound('Ca làm việc', id);
    await this.checkShiftInput(dto.branchId, dto.start ?? minuteToHHmm(cur.startMinute), dto.end ?? minuteToHHmm(cur.endMinute));
    // đổi giờ ca không đổi các lượt đã chấm (mỗi lượt giữ khung giờ ca của ngày đó)
    const r = await this.prisma.db.workShift.update({ where: { id }, data: {
      ...(dto.name !== undefined ? { name: dto.name } : {}), ...(dto.start ? { startMinute: toMinute(dto.start) } : {}), ...(dto.end ? { endMinute: toMinute(dto.end) } : {}),
      ...(dto.branchId !== undefined ? { branchId: dto.branchId } : {}), ...(dto.isActive !== undefined ? { isActive: dto.isActive } : {}), ...(dto.sortOrder !== undefined ? { sortOrder: dto.sortOrder } : {}),
    } });
    await this.audit.log(this.prisma.db as never, { action: 'attendance.shift.update', entityType: 'WorkShift', entityId: id, before: { name: cur.name, start: minuteToHHmm(cur.startMinute), end: minuteToHHmm(cur.endMinute), isActive: cur.isActive }, after: { name: r.name, start: minuteToHHmm(r.startMinute), end: minuteToHHmm(r.endMinute), isActive: r.isActive } });
    return this.shiftView(r);
  }
  /** Ca chưa dùng thì xóa hẳn; đã có lượt chấm công thì chỉ ngừng dùng (giữ lịch sử). */
  async removeShift(user: RequestUser, id: string) {
    const cur = await this.prisma.db.workShift.findFirst({ where: { id }, include: { _count: { select: { attendances: true } } } });
    if (!cur) throw Errors.notFound('Ca làm việc', id);
    if (cur._count.attendances > 0) {
      await this.prisma.db.workShift.update({ where: { id }, data: { isActive: false } });
      await this.audit.log(this.prisma.db as never, { action: 'attendance.shift.deactivate', entityType: 'WorkShift', entityId: id, before: { name: cur.name, isActive: cur.isActive } });
      return { removed: false, deactivated: true };
    }
    await this.prisma.db.workShift.delete({ where: { id } });
    await this.audit.log(this.prisma.db as never, { action: 'attendance.shift.remove', entityType: 'WorkShift', entityId: id, before: { name: cur.name, start: minuteToHHmm(cur.startMinute), end: minuteToHHmm(cur.endMinute) } });
    return { removed: true, deactivated: false };
  }

  // ---------------------------------------------------------------- phạt đi trễ (BR-188)
  async latePolicy(): Promise<LatePolicy> {
    const row = await this.prisma.db.tenantSetting.findFirst({ where: { key: LATE_POLICY_KEY } });
    return normalizeLatePolicy(row?.value);
  }
  async saveLatePolicy(user: RequestUser, dto: LatePolicyDto) {
    const before = await this.latePolicy();
    const next = normalizeLatePolicy(dto);
    if (next.enabled && next.mode === 'TIERS' && !next.tiers.some((t) => t.amount > 0)) throw Errors.validation('Thêm ít nhất một mức phạt (trễ từ … phút → … đ)');
    if (next.enabled && next.mode === 'PER_MINUTE' && next.perMinute <= 0) throw Errors.validation('Nhập số tiền phạt mỗi phút trễ');
    await this.prisma.db.tenantSetting.upsert({
      where: { tenantId_key: { tenantId: user.tenantId, key: LATE_POLICY_KEY } },
      create: { tenantId: user.tenantId, key: LATE_POLICY_KEY, value: next as unknown as Prisma.InputJsonValue },
      update: { value: next as unknown as Prisma.InputJsonValue },
    });
    await this.audit.log(this.prisma.db as never, { action: 'attendance.late_policy.update', entityType: 'TenantSetting', entityCode: LATE_POLICY_KEY, before: before as never, after: next as never });
    return next;
  }

  async checkIn(user: RequestUser, dto: CheckInDto) {
    if (dto.branchId) this.access.assertBranch(user, dto.branchId);
    const open = await this.prisma.db.attendance.findFirst({ where: { userId: user.id, checkOutAt: null } });
    if (open) throw Errors.conflict('ATTENDANCE_OPEN', 'Bạn đang trong ca (chưa chấm ra)', { attendanceId: open.id, checkInAt: open.checkInAt });
    const branchId = dto.branchId ?? (user.branchIds[0] ?? null);
    const cfg = await this.attendanceConfig();
    const branch = await this.branchGeo(branchId);
    const flags: string[] = [];
    const distance = this.geoCheck(cfg, branch, dto, true, flags);
    const device = await this.deviceCheck(user, cfg, dto, flags);
    const now = new Date();
    const shift = await this.resolveShift(user.tenantId, branchId, now, dto.workShiftId, flags);
    // nhân viên chọn "Chấm ngoài ca" (workShiftId = null) khi cửa hàng có ca → gắn cờ để quản lý xem lại
    if (dto.workShiftId === null && (await this.shiftsFor(branchId)).length) flags.push('OFF_SHIFT');
    const late = lateOf(now, shift.window, await this.latePolicy());
    const ctx = getCtx(this.cls);
    const a = await this.prisma.db.attendance.create({ include: { workShift: { select: SHIFT_SELECT } }, data: {
      tenantId: user.tenantId, userId: user.id, branchId, checkInAt: now, note: dto.note, workShiftId: shift.workShiftId, shiftStartAt: shift.window?.start ?? null, shiftEndAt: shift.window?.end ?? null,
      lateMinutes: late.lateMinutes, latePenalty: late.penalty, latitude: dto.latitude, longitude: dto.longitude, accuracy: dto.accuracy === undefined ? undefined : Math.round(dto.accuracy * 10) / 10,
      distanceMeters: distance, deviceId: device?.deviceId ?? dto.deviceId ?? null, ip: ctx.ip?.slice(0, 64) ?? null, userAgent: ctx.userAgent?.slice(0, 300) ?? null, flags,
    } });
    await this.audit.log(this.prisma.db as never, { action: 'attendance.check_in', entityType: 'Attendance', entityId: a.id, after: { branchId: a.branchId, distance, flags, workShiftId: a.workShiftId } });
    return a;
  }
  async checkOut(user: RequestUser, dto: CheckOutDto) {
    const open = await this.prisma.db.attendance.findFirst({ where: { userId: user.id, checkOutAt: null }, orderBy: { checkInAt: 'desc' } });
    if (!open) throw Errors.conflict('ATTENDANCE_NOT_OPEN', 'Bạn chưa chấm công vào');
    const now = new Date();
    const cfg = await this.attendanceConfig();
    const branch = await this.branchGeo(open.branchId);
    const flags = [...(open.flags ?? [])];
    const distance = this.geoCheck(cfg, branch, dto, false, flags, 'OUT_');
    if (dto.deviceId && open.deviceId && dto.deviceId !== open.deviceId) flags.push('DEVICE_CHANGED');
    const a = await this.prisma.db.attendance.update({ where: { id: open.id }, include: { workShift: { select: SHIFT_SELECT } }, data: {
      checkOutAt: now, minutes: creditedMinutes(open.checkInAt, now, { start: open.shiftStartAt, end: open.shiftEndAt }), note: dto.note ? [open.note, dto.note].filter(Boolean).join(' · ') : open.note,
      outLatitude: dto.latitude, outLongitude: dto.longitude, outDistanceMeters: distance, flags: Array.from(new Set(flags)),
    } });
    await this.audit.log(this.prisma.db as never, { action: 'attendance.check_out', entityType: 'Attendance', entityId: a.id, after: { minutes: a.minutes, distance, flags: a.flags } });
    return a;
  }
  async current(user: RequestUser, deviceId?: string) {
    const open = await this.prisma.db.attendance.findFirst({ where: { userId: user.id, checkOutAt: null }, orderBy: { checkInAt: 'desc' }, include: { workShift: { select: SHIFT_SELECT } } });
    const since = new Date(new Date().setDate(1));
    const [month, cfg, device, branches] = await Promise.all([
      this.prisma.db.attendance.aggregate({ where: { userId: user.id, checkInAt: { gte: since } }, _sum: { minutes: true, latePenalty: true }, _count: { _all: true } }),
      this.attendanceConfig(),
      deviceId ? this.prisma.db.attendanceDevice.findFirst({ where: { deviceId }, select: { id: true, userId: true, status: true, name: true } }) : null,
      this.prisma.db.branch.findMany({ where: { isActive: true, ...(user.allBranches ? {} : { id: { in: user.branchIds } }) }, select: { id: true, name: true, latitude: true, longitude: true, radiusMeters: true }, orderBy: { name: 'asc' } }),
    ]);
    const tz = await this.timezone(user.tenantId);
    return {
      open, monthMinutes: month._sum.minutes ?? 0, monthDays: month._count._all,
      monthLate: await this.prisma.db.attendance.count({ where: { userId: user.id, checkInAt: { gte: since }, lateMinutes: { gt: 0 } } }), monthLatePenalty: Number(month._sum.latePenalty ?? 0),
      latePolicy: await this.latePolicy(),
      policy: { gpsRequired: cfg.gpsRequired, deviceLock: cfg.deviceLock, radius: cfg.radius, maxAccuracy: cfg.maxAccuracy },
      device: device ? { id: device.id, status: device.userId === user.id ? device.status : 'OTHER_USER', name: device.name } : null,
      branches: await Promise.all(branches.map(async (b) => {
        // ca gợi ý khi chấm vào lúc này (nhân viên đổi được trước khi chấm)
        const shifts = await this.shiftsFor(b.id);
        const m = shifts.length ? matchShift(shifts, new Date(), tz) : null;
        return { id: b.id, name: b.name, hasGeo: b.latitude !== null && b.longitude !== null, radius: b.radiusMeters ?? cfg.radius, shifts: shifts.map((x) => this.shiftView(x)), suggestedShiftId: m?.shift.id ?? null };
      })),
    };
  }
  async listDevices(_user: RequestUser, q: AttendanceDeviceQueryDto) {
    return this.prisma.db.attendanceDevice.findMany({ where: { ...(q.userId ? { userId: q.userId } : {}), ...(q.status ? { status: q.status } : {}) }, include: { user: { select: { id: true, fullName: true, username: true } } }, orderBy: [{ status: 'desc' }, { lastSeenAt: 'desc' }], take: 500 });
  }
  async patchDevice(user: RequestUser, id: string, dto: AttendanceDevicePatchDto) {
    const d = await this.prisma.db.attendanceDevice.findFirst({ where: { id } });
    if (!d) throw Errors.notFound('Thiết bị chấm công', id);
    const after = await this.prisma.db.attendanceDevice.update({ where: { id }, data: { status: dto.status, approvedById: user.id } });
    await this.audit.log(this.prisma.db as never, { action: 'attendance.device.' + (dto.status === 'TRUSTED' ? 'approve' : 'block'), entityType: 'AttendanceDevice', entityId: id, before: { status: d.status }, after: { status: after.status, userId: d.userId } });
    return after;
  }
  async removeDevice(user: RequestUser, id: string) {
    const d = await this.prisma.db.attendanceDevice.findFirst({ where: { id } });
    if (!d) throw Errors.notFound('Thiết bị chấm công', id);
    await this.prisma.db.attendanceDevice.delete({ where: { id } });
    await this.audit.log(this.prisma.db as never, { action: 'attendance.device.remove', entityType: 'AttendanceDevice', entityId: id, before: { userId: d.userId, status: d.status, name: d.name } });
  }
  async listAttendance(user: RequestUser, q: AttendanceQueryDto, onlyMine: boolean) {
    const where: Prisma.AttendanceWhereInput = {
      ...(onlyMine ? { userId: user.id } : q.userId ? { userId: q.userId } : {}),
      ...(q.branchId ? { branchId: q.branchId } : {}),
      ...(q.open === 'true' ? { checkOutAt: null } : {}),
      ...(q.from || q.to ? { checkInAt: { ...(q.from ? { gte: new Date(q.from) } : {}), ...(q.to ? { lte: new Date(q.to) } : {}) } } : {}),
    };
    const [rows, total, perUser] = await Promise.all([
      this.prisma.db.attendance.findMany({ where, include: { user: { select: { id: true, fullName: true, username: true } }, workShift: { select: SHIFT_SELECT } }, ...skipTake(q), orderBy: { checkInAt: 'desc' } }),
      this.prisma.db.attendance.count({ where }),
      this.prisma.db.attendance.groupBy({ by: ['userId'], where, _sum: { minutes: true, latePenalty: true }, _count: { _all: true } }),
    ]);
    const lateBy = await this.prisma.db.attendance.groupBy({ by: ['userId'], where: { ...where, lateMinutes: { gt: 0 } }, _count: { _all: true } });
    const names = await this.prisma.db.user.findMany({ where: { id: { in: perUser.map((p) => p.userId) } }, select: { id: true, fullName: true } });
    return { ...paginated(rows, total, q), summary: perUser.map((p) => ({ userId: p.userId, name: names.find((n) => n.id === p.userId)?.fullName ?? '—', sessions: p._count._all, minutes: p._sum.minutes ?? 0, hours: Math.round(((p._sum.minutes ?? 0) / 60) * 10) / 10, lateCount: lateBy.find((l) => l.userId === p.userId)?._count._all ?? 0, latePenalty: Number(p._sum.latePenalty ?? 0) })) };
  }
  async editAttendance(user: RequestUser, id: string, dto: EditAttendanceDto) {
    const a = await this.prisma.db.attendance.findFirst({ where: { id } });
    if (!a) throw Errors.notFound('Lượt chấm công', id);
    const checkInAt = dto.checkInAt ? new Date(dto.checkInAt) : a.checkInAt;
    const checkOutAt = dto.checkOutAt === undefined ? a.checkOutAt : dto.checkOutAt ? new Date(dto.checkOutAt) : null;
    if (checkOutAt && checkOutAt < checkInAt) throw Errors.validation('Giờ ra phải sau giờ vào');
    // đổi ca hoặc giờ vào → lấy lại khung giờ ca quanh giờ vào mới; chỉ sửa giờ ra → giữ khung ca cũ
    let shift: { workShiftId: string | null; window: ShiftWindow | null } = { workShiftId: a.workShiftId, window: a.shiftStartAt && a.shiftEndAt ? { start: a.shiftStartAt, end: a.shiftEndAt } : null };
    if (dto.workShiftId !== undefined || (dto.checkInAt && checkInAt.getTime() !== a.checkInAt.getTime())) {
      const chosen = dto.workShiftId !== undefined ? dto.workShiftId : a.workShiftId;
      shift = chosen ? await this.resolveShift(user.tenantId, a.branchId, checkInAt, chosen) : { workShiftId: null, window: null };
    }
    // đi trễ: tính lại khi đổi giờ vào / ca; quản lý đặt tiền phạt (0 = miễn phạt) thì dùng số đó
    const recompute = dto.workShiftId !== undefined || checkInAt.getTime() !== a.checkInAt.getTime();
    const late = recompute ? lateOf(checkInAt, shift.window, await this.latePolicy()) : { lateMinutes: a.lateMinutes, penalty: a.latePenalty === null ? null : Number(a.latePenalty) };
    const penalty = dto.latePenalty !== undefined ? dto.latePenalty : late.penalty;
    const after = await this.prisma.db.attendance.update({ where: { id }, include: { workShift: { select: SHIFT_SELECT } }, data: {
      checkInAt, checkOutAt, minutes: checkOutAt ? creditedMinutes(checkInAt, checkOutAt, shift.window) : null, note: dto.note, editedById: user.id, lateMinutes: late.lateMinutes, latePenalty: penalty,
      workShiftId: shift.workShiftId, shiftStartAt: shift.window?.start ?? null, shiftEndAt: shift.window?.end ?? null,
      ...(dto.workShiftId !== undefined || shift.workShiftId ? { flags: (a.flags ?? []).filter((f) => f !== 'OFF_SHIFT') } : {}),
    } });
    await this.audit.log(this.prisma.db as never, { action: 'attendance.edit', entityType: 'Attendance', entityId: id, before: { checkInAt: a.checkInAt, checkOutAt: a.checkOutAt, workShiftId: a.workShiftId, minutes: a.minutes, latePenalty: a.latePenalty }, after: { checkInAt, checkOutAt, workShiftId: after.workShiftId, minutes: after.minutes, latePenalty: after.latePenalty } });
    return after;
  }
  async manualAttendance(user: RequestUser, dto: ManualAttendanceDto) {
    if (!(await this.prisma.db.user.findFirst({ where: { id: dto.userId } }))) throw Errors.notFound('Nhân viên', dto.userId);
    const checkInAt = new Date(dto.checkInAt); const checkOutAt = dto.checkOutAt ? new Date(dto.checkOutAt) : null;
    if (checkOutAt && checkOutAt < checkInAt) throw Errors.validation('Giờ ra phải sau giờ vào');
    const flags: string[] = [];
    const shift = await this.resolveShift(user.tenantId, dto.branchId ?? null, checkInAt, dto.workShiftId, flags);
    const late = lateOf(checkInAt, shift.window, await this.latePolicy());
    return this.prisma.db.attendance.create({ include: { workShift: { select: SHIFT_SELECT } }, data: {
      tenantId: user.tenantId, userId: dto.userId, branchId: dto.branchId ?? null, checkInAt, checkOutAt, minutes: checkOutAt ? creditedMinutes(checkInAt, checkOutAt, shift.window) : null,
      source: 'MANUAL', note: dto.note, editedById: user.id, workShiftId: shift.workShiftId, shiftStartAt: shift.window?.start ?? null, shiftEndAt: shift.window?.end ?? null, flags,
      lateMinutes: late.lateMinutes, latePenalty: late.penalty,
    } });
  }

  // ---------------------------------------------------------------- performance (BR-152)
  async performance(user: RequestUser, q: PeriodQueryDto) {
    const from = q.from ? new Date(q.from) : new Date(new Date().setDate(1));
    const to = q.to ? new Date(q.to) : new Date();
    const scope = this.access.branchWhere(user);
    if (q.branchId) this.access.assertBranch(user, q.branchId);
    const branches = q.branchId ? [q.branchId] : scope.branchId ? scope.branchId.in : null;
    const brI = branches ? Prisma.sql`AND i.branch_id IN (${uuidList(branches)})` : Prisma.empty;
    const brS = branches ? Prisma.sql`AND s.branch_id IN (${uuidList(branches)})` : Prisma.empty;
    const userSql = q.userId ? Prisma.sql`AND i.seller_id = ${q.userId}::uuid` : Prisma.empty;
    const [sales, shifts, att, comm] = await Promise.all([
      this.prisma.raw.$queryRaw<Array<{ seller_id: string; full_name: string; invoices: bigint; revenue: Prisma.Decimal; returned: Prisma.Decimal; cost: Prisma.Decimal; items: Prisma.Decimal; customers: bigint }>>`SELECT i.seller_id, u.full_name, count(*)::bigint AS invoices, COALESCE(SUM(i.total_amount),0) AS revenue, COALESCE(SUM(i.returned_amount),0) AS returned, COALESCE(SUM(i.cost_total),0) AS cost, COALESCE(SUM((SELECT SUM(l.quantity) FROM invoice_lines l WHERE l.invoice_id = i.id)),0) AS items, count(DISTINCT i.customer_id)::bigint AS customers FROM invoices i JOIN users u ON u.id = i.seller_id WHERE i.tenant_id = ${user.tenantId}::uuid AND i.status = 'COMPLETED' AND i.imported = false AND i.invoice_date BETWEEN ${from} AND ${to} ${brI} ${userSql} GROUP BY i.seller_id, u.full_name`,
      this.prisma.raw.$queryRaw<Array<{ user_id: string; shifts: bigint; difference: Prisma.Decimal }>>`SELECT s.user_id, count(*)::bigint AS shifts, COALESCE(SUM(s.difference),0) AS difference FROM shifts s WHERE s.tenant_id = ${user.tenantId}::uuid AND s.status = 'CLOSED' AND s.opened_at BETWEEN ${from} AND ${to} ${brS} GROUP BY s.user_id`,
      this.prisma.db.attendance.groupBy({ by: ['userId'], where: { checkInAt: { gte: from, lte: to } }, _sum: { minutes: true }, _count: { _all: true } }),
      this.commissions(user, q),
    ]);
    const data = sales.map((s) => {
      const sh = shifts.find((x) => x.user_id === s.seller_id); const a = att.find((x) => x.userId === s.seller_id); const c = comm.data.find((x) => x.sellerId === s.seller_id);
      const net = D(s.revenue).minus(D(s.returned));
      return { sellerId: s.seller_id, name: s.full_name, invoices: Number(s.invoices), revenue: D(s.revenue), returned: D(s.returned), netRevenue: net, grossProfit: D(s.revenue).minus(D(s.cost)), items: D(s.items), customers: Number(s.customers), avgBasket: Number(s.invoices) ? D(s.revenue).dividedBy(Number(s.invoices)).toDecimalPlaces(0) : ZERO, shifts: Number(sh?.shifts ?? 0), cashDifference: D(sh?.difference ?? 0), attendanceSessions: a?._count._all ?? 0, attendanceMinutes: a?._sum.minutes ?? 0, commission: c?.commission ?? ZERO };
    }).sort((a, b) => b.netRevenue.comparedTo(a.netRevenue));
    return { from, to, data, totals: { sellers: data.length, revenue: data.reduce((s, r) => s.plus(r.revenue), ZERO), netRevenue: data.reduce((s, r) => s.plus(r.netRevenue), ZERO), commission: data.reduce((s, r) => s.plus(r.commission), ZERO) } };
  }
}
