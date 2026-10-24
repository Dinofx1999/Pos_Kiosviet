import { Injectable } from '@nestjs/common';
import { PaymentMethod, Prisma, ShiftStatus } from '@prisma/client';
import { hasPermission } from '@erp/shared';
import { Errors } from '../../common/errors/app-error';
import { orderBy, paginated, skipTake } from '../../common/pagination';
import { D, money, ZERO } from '../../common/utils/decimal';
import { AccessService } from '../../infra/access/access.service';
import { AuditService } from '../../infra/audit/audit.service';
import { RequestUser } from '../../infra/cls/request-context';
import { NumberingService } from '../../infra/numbering/numbering.service';
import { DbClient, PrismaService, TxClient } from '../../infra/prisma/prisma.service';
import { CashbookService } from '../finance/cashbook.service';
import { CloseShiftDto, OpenShiftDto, ShiftQueryDto } from './dto/sales.dto';

const shiftInclude = { user: { select: { id: true, username: true, fullName: true } }, branch: { select: { id: true, name: true } } } satisfies Prisma.ShiftInclude;

/** Ca bán hàng (BR-55): one OPEN shift per cashier per branch; closing reconciles counted cash against expected cash. */
@Injectable()
export class ShiftsService {
  constructor(private readonly prisma: PrismaService, private readonly numbering: NumberingService, private readonly audit: AuditService, private readonly access: AccessService, private readonly cashbook: CashbookService) {}

  async list(user: RequestUser, q: ShiftQueryDto) {
    const manage = hasPermission(user.permissions, 'shift.manage');
    const filters: Prisma.ShiftWhereInput = {
      userId: manage ? q.userId : user.id, // non-managers only ever see their own shifts (M7)
      ...(q.status ? { status: q.status as ShiftStatus } : {}),
      ...(q.branchId ? { branchId: q.branchId } : {}),
      ...(q.from || q.to ? { openedAt: { ...(q.from ? { gte: new Date(q.from) } : {}), ...(q.to ? { lte: new Date(q.to) } : {}) } } : {}),
      ...(q.search ? { code: { contains: q.search, mode: 'insensitive' } } : {}),
    };
    const where: Prisma.ShiftWhereInput = { AND: [this.access.branchWhere(user), filters] };
    const [rows, total] = await Promise.all([
      this.prisma.db.shift.findMany({ where, include: { ...shiftInclude, _count: { select: { invoices: true, payments: true } } }, ...skipTake(q), orderBy: orderBy(q, ['openedAt', 'closedAt', 'code'], 'openedAt') }),
      this.prisma.db.shift.count({ where }),
    ]);
    return paginated(rows, total, q);
  }

  /** The caller's open shift at a branch (or null). */
  async current(user: RequestUser, branchId: string) {
    this.access.assertBranch(user, branchId);
    const s = await this.prisma.db.shift.findFirst({ where: { branchId, userId: user.id, status: 'OPEN' }, include: shiftInclude });
    return s ? this.summary(this.prisma.db, user, s) : null;
  }

  async get(user: RequestUser, id: string) {
    const s = await this.prisma.db.shift.findFirst({ where: { id, ...this.access.branchWhere(user) }, include: shiftInclude });
    if (!s) throw Errors.notFound('Ca bán hàng', id);
    if (s.userId !== user.id && !hasPermission(user.permissions, 'shift.manage')) throw Errors.forbidden('Chỉ xem được ca của mình');
    return this.summary(this.prisma.db, user, s);
  }

  async open(user: RequestUser, dto: OpenShiftDto) {
    this.access.assertBranch(user, dto.branchId);
    return this.prisma.tx(async (tx) => {
      // serialize per (branch,user) through the user row so two tabs cannot open two shifts
      await tx.$queryRaw`SELECT id FROM users WHERE id = ${user.id}::uuid AND tenant_id = ${user.tenantId}::uuid FOR UPDATE`;
      const existing = await tx.shift.findFirst({ where: { branchId: dto.branchId, userId: user.id, status: 'OPEN' } });
      if (existing) throw Errors.conflict('SHIFT_ALREADY_OPEN', 'Bạn đang có ca chưa đóng tại chi nhánh này', { shiftId: existing.id, code: existing.code });
      const code = await this.numbering.next(tx, 'SHIFT');
      const s = await tx.shift.create({ data: { tenantId: user.tenantId, branchId: dto.branchId, userId: user.id, code, openingCash: money(dto.openingCash ?? 0), note: dto.note }, include: shiftInclude });
      await this.audit.log(tx, { action: 'shift.open', entityType: 'Shift', entityId: s.id, entityCode: code, after: { branchId: dto.branchId, openingCash: s.openingCash.toString() } });
      return this.summary(tx, user, s);
    });
  }

  async close(user: RequestUser, id: string, dto: CloseShiftDto) {
    return this.prisma.tx(async (tx) => {
      const rows = await tx.$queryRaw<{ id: string }[]>`SELECT id FROM shifts WHERE id = ${id}::uuid AND tenant_id = ${user.tenantId}::uuid FOR UPDATE`;
      if (!rows[0]) throw Errors.notFound('Ca bán hàng', id);
      const s = await tx.shift.findFirstOrThrow({ where: { id }, include: shiftInclude });
      this.access.assertBranch(user, s.branchId);
      if (s.userId !== user.id && !hasPermission(user.permissions, 'shift.manage')) throw Errors.forbidden('Chỉ đóng được ca của mình');
      if (s.status !== 'OPEN') throw Errors.conflict('SHIFT_NOT_OPEN', 'Ca đã đóng', { closedAt: s.closedAt });
      const sum = await this.summary(tx, user, s);
      const counted = money(dto.countedCash);
      const expected = sum.expectedCash;
      let handover: { code: string; amount: Prisma.Decimal } | null = null;
      if (dto.handoverAmount) {
        // bàn giao ca: move counted cash from the branch drawer to the safe / bank (BR-72) — before the shift is marked CLOSED so the legs carry shift_id
        if (!dto.handoverToAccountId) throw Errors.validation('Thiếu quỹ nhận bàn giao (handoverToAccountId)');
        if (!hasPermission(user.permissions, 'cash.transfer')) throw Errors.forbidden('Thiếu quyền: cash.transfer (bàn giao ca)');
        const drawer = await tx.cashAccount.findFirst({ where: { branchId: s.branchId, type: 'CASH', isActive: true }, orderBy: [{ isDefault: 'desc' }, { createdAt: 'asc' }] });
        if (!drawer) throw Errors.notFound('Két tiền mặt của chi nhánh');
        const amount = money(dto.handoverAmount);
        if (amount.greaterThan(counted)) throw Errors.validation('Số tiền bàn giao vượt quá tiền mặt đếm được', { counted: counted.toString() });
        const t = await this.cashbook.transferInTx(tx, user, { branchId: s.branchId, fromAccountId: drawer.id, toAccountId: dto.handoverToAccountId, amount: amount.toString(), note: `Bàn giao ca ${s.code}` }, { shiftId: s.id, permissionChecked: true, kind: 'HANDOVER' });
        handover = { code: t.code, amount };
      }
      const closed = await tx.shift.update({ where: { id }, data: { status: 'CLOSED', closedAt: new Date(), closedById: user.id, expectedCash: expected, countedCash: counted, difference: counted.minus(expected), note: dto.note ?? s.note }, include: shiftInclude });
      await this.audit.log(tx, { action: 'shift.close', entityType: 'Shift', entityId: id, entityCode: s.code, after: { expectedCash: expected.toString(), countedCash: counted.toString(), difference: counted.minus(expected).toString(), handover } });
      const summary = await this.summary(tx, user, closed);
      return { ...summary, handover: summary.handover ?? handover };
    });
  }

  /** Finds the caller's OPEN shift at a branch inside a transaction (used when completing invoices). */
  async openShiftId(tx: TxClient, user: RequestUser, branchId: string): Promise<string | null> {
    // FOR SHARE: a concurrent close() (FOR UPDATE) waits for in-flight completes, and later completes see CLOSED (BR-56)
    const rows = await tx.$queryRaw<{ id: string }[]>`SELECT id FROM shifts WHERE tenant_id = ${user.tenantId}::uuid AND branch_id = ${branchId}::uuid AND user_id = ${user.id}::uuid AND status = 'OPEN' FOR SHARE`;
    return rows[0]?.id ?? null;
  }

  /** Cash expectation and breakdown: opening + Σ cash IN − Σ cash OUT for POSTED payments in the shift. */
  private async summary(db: DbClient, user: RequestUser, s: Prisma.ShiftGetPayload<{ include: typeof shiftInclude }>) {
    const [payments, invoices, handover] = await Promise.all([
      db.payment.groupBy({ by: ['method', 'direction'], where: { shiftId: s.id, status: 'POSTED', method: { notIn: ['OFFSET', 'TRANSFER', 'POINTS'] } }, _sum: { amount: true }, _count: { _all: true } }),
      db.invoice.aggregate({ where: { shiftId: s.id, status: 'COMPLETED' }, _sum: { totalAmount: true, paidAmount: true }, _count: { _all: true } }),
      db.cashTransfer.findFirst({ where: { shiftId: s.id, kind: 'HANDOVER', status: 'POSTED' }, select: { id: true, code: true, amount: true, toAccount: { select: { id: true, code: true, name: true } } } }),
    ]);
    const byMethod: Record<string, { in: Prisma.Decimal; out: Prisma.Decimal }> = {};
    for (const p of payments) {
      const m = byMethod[p.method] ?? (byMethod[p.method] = { in: ZERO, out: ZERO });
      if (p.direction === 'IN') m.in = m.in.plus(D(p._sum.amount)); else m.out = m.out.plus(D(p._sum.amount));
    }
    const cash = byMethod[PaymentMethod.CASH] ?? { in: ZERO, out: ZERO };
    const expectedCash = D(s.openingCash).plus(cash.in).minus(cash.out);
    void user;
    return {
      ...s,
      expectedCash: s.status === 'CLOSED' && s.expectedCash !== null ? D(s.expectedCash) : expectedCash,
      invoices: invoices._count._all,
      revenue: D(invoices._sum.totalAmount),
      collected: D(invoices._sum.paidAmount),
      byMethod: Object.entries(byMethod).map(([method, v]) => ({ method, in: v.in, out: v.out, net: v.in.minus(v.out) })),
      handover: handover ? { code: handover.code, amount: D(handover.amount), toAccount: handover.toAccount } : null,
    };
  }
}
