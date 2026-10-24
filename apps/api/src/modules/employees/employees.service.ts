import { Injectable } from '@nestjs/common';
import { CommissionBasis, Prisma } from '@prisma/client';
import { Errors } from '../../common/errors/app-error';
import { paginated, skipTake } from '../../common/pagination';
import { D, money, ZERO } from '../../common/utils/decimal';
import { AccessService } from '../../infra/access/access.service';
import { AuditService } from '../../infra/audit/audit.service';
import { RequestUser } from '../../infra/cls/request-context';
import { PrismaService } from '../../infra/prisma/prisma.service';
import { AttendanceQueryDto, CheckInDto, CheckOutDto, CreateCommissionRuleDto, EditAttendanceDto, EmployeeQueryDto, ManualAttendanceDto, PeriodQueryDto, UpdateCommissionRuleDto } from './dto/employees.dto';

const NONE = '00000000-0000-0000-0000-000000000000';
const uuidList = (ids: string[]) => Prisma.join((ids.length ? ids : [NONE]).map((id) => Prisma.sql`${id}::uuid`));

interface SaleLine { seller_id: string | null; full_name: string | null; variant_id: string; category_id: string | null; invoice_id: string; net_revenue: Prisma.Decimal; net_cost: Prisma.Decimal; net_qty: Prisma.Decimal }
interface Rule { id: string; name: string; userId: string | null; categoryId: string | null; variantId: string | null; basis: CommissionBasis; rate: Prisma.Decimal; minRevenue: Prisma.Decimal; priority: number }

/** Nhân viên (BR-150..BR-153): hồ sơ, quy tắc hoa hồng + báo cáo, chấm công, hiệu suất. */
@Injectable()
export class EmployeesService {
  constructor(private readonly prisma: PrismaService, private readonly access: AccessService, private readonly audit: AuditService) {}

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
  async checkIn(user: RequestUser, dto: CheckInDto) {
    if (dto.branchId) this.access.assertBranch(user, dto.branchId);
    const open = await this.prisma.db.attendance.findFirst({ where: { userId: user.id, checkOutAt: null } });
    if (open) throw Errors.conflict('ATTENDANCE_OPEN', 'Bạn đang trong ca (chưa chấm ra)', { attendanceId: open.id, checkInAt: open.checkInAt });
    const a = await this.prisma.db.attendance.create({ data: { tenantId: user.tenantId, userId: user.id, branchId: dto.branchId ?? (user.branchIds[0] ?? null), note: dto.note, latitude: dto.latitude, longitude: dto.longitude } });
    await this.audit.log(this.prisma.db as never, { action: 'attendance.check_in', entityType: 'Attendance', entityId: a.id, after: { branchId: a.branchId } });
    return a;
  }
  async checkOut(user: RequestUser, dto: CheckOutDto) {
    const open = await this.prisma.db.attendance.findFirst({ where: { userId: user.id, checkOutAt: null }, orderBy: { checkInAt: 'desc' } });
    if (!open) throw Errors.conflict('ATTENDANCE_NOT_OPEN', 'Bạn chưa chấm công vào');
    const now = new Date();
    const a = await this.prisma.db.attendance.update({ where: { id: open.id }, data: { checkOutAt: now, minutes: Math.max(0, Math.round((now.getTime() - open.checkInAt.getTime()) / 60000)), note: dto.note ? [open.note, dto.note].filter(Boolean).join(' · ') : open.note } });
    await this.audit.log(this.prisma.db as never, { action: 'attendance.check_out', entityType: 'Attendance', entityId: a.id, after: { minutes: a.minutes } });
    return a;
  }
  async current(user: RequestUser) {
    const open = await this.prisma.db.attendance.findFirst({ where: { userId: user.id, checkOutAt: null }, orderBy: { checkInAt: 'desc' } });
    const since = new Date(new Date().setDate(1));
    const month = await this.prisma.db.attendance.aggregate({ where: { userId: user.id, checkInAt: { gte: since } }, _sum: { minutes: true }, _count: { _all: true } });
    return { open, monthMinutes: month._sum.minutes ?? 0, monthDays: month._count._all };
  }
  async listAttendance(user: RequestUser, q: AttendanceQueryDto, onlyMine: boolean) {
    const where: Prisma.AttendanceWhereInput = {
      ...(onlyMine ? { userId: user.id } : q.userId ? { userId: q.userId } : {}),
      ...(q.branchId ? { branchId: q.branchId } : {}),
      ...(q.open === 'true' ? { checkOutAt: null } : {}),
      ...(q.from || q.to ? { checkInAt: { ...(q.from ? { gte: new Date(q.from) } : {}), ...(q.to ? { lte: new Date(q.to) } : {}) } } : {}),
    };
    const [rows, total, perUser] = await Promise.all([
      this.prisma.db.attendance.findMany({ where, include: { user: { select: { id: true, fullName: true, username: true } } }, ...skipTake(q), orderBy: { checkInAt: 'desc' } }),
      this.prisma.db.attendance.count({ where }),
      this.prisma.db.attendance.groupBy({ by: ['userId'], where, _sum: { minutes: true }, _count: { _all: true } }),
    ]);
    const names = await this.prisma.db.user.findMany({ where: { id: { in: perUser.map((p) => p.userId) } }, select: { id: true, fullName: true } });
    return { ...paginated(rows, total, q), summary: perUser.map((p) => ({ userId: p.userId, name: names.find((n) => n.id === p.userId)?.fullName ?? '—', sessions: p._count._all, minutes: p._sum.minutes ?? 0, hours: Math.round(((p._sum.minutes ?? 0) / 60) * 10) / 10 })) };
  }
  async editAttendance(user: RequestUser, id: string, dto: EditAttendanceDto) {
    const a = await this.prisma.db.attendance.findFirst({ where: { id } });
    if (!a) throw Errors.notFound('Lượt chấm công', id);
    const checkInAt = dto.checkInAt ? new Date(dto.checkInAt) : a.checkInAt;
    const checkOutAt = dto.checkOutAt === undefined ? a.checkOutAt : dto.checkOutAt ? new Date(dto.checkOutAt) : null;
    if (checkOutAt && checkOutAt < checkInAt) throw Errors.validation('Giờ ra phải sau giờ vào');
    const after = await this.prisma.db.attendance.update({ where: { id }, data: { checkInAt, checkOutAt, minutes: checkOutAt ? Math.round((checkOutAt.getTime() - checkInAt.getTime()) / 60000) : null, note: dto.note, editedById: user.id } });
    await this.audit.log(this.prisma.db as never, { action: 'attendance.edit', entityType: 'Attendance', entityId: id, before: { checkInAt: a.checkInAt, checkOutAt: a.checkOutAt }, after: { checkInAt, checkOutAt } });
    return after;
  }
  async manualAttendance(user: RequestUser, dto: ManualAttendanceDto) {
    if (!(await this.prisma.db.user.findFirst({ where: { id: dto.userId } }))) throw Errors.notFound('Nhân viên', dto.userId);
    const checkInAt = new Date(dto.checkInAt); const checkOutAt = dto.checkOutAt ? new Date(dto.checkOutAt) : null;
    if (checkOutAt && checkOutAt < checkInAt) throw Errors.validation('Giờ ra phải sau giờ vào');
    return this.prisma.db.attendance.create({ data: { tenantId: user.tenantId, userId: dto.userId, branchId: dto.branchId ?? null, checkInAt, checkOutAt, minutes: checkOutAt ? Math.round((checkOutAt.getTime() - checkInAt.getTime()) / 60000) : null, source: 'MANUAL', note: dto.note, editedById: user.id } });
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
