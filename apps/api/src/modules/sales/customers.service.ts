import { Injectable } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { Errors } from '../../common/errors/app-error';
import { orderBy, paginated, skipTake } from '../../common/pagination';
import { D, money, ZERO } from '../../common/utils/decimal';
import { AccessService } from '../../infra/access/access.service';
import { AuditService } from '../../infra/audit/audit.service';
import { RequestUser } from '../../infra/cls/request-context';
import { NumberingService } from '../../infra/numbering/numbering.service';
import { PrismaService } from '../../infra/prisma/prisma.service';
import { LedgerQueryDto } from '../finance/dto/finance.dto';
import { LedgerService } from '../finance/ledger.service';
import { CreateCustomerDto, CustomerQueryDto, UpdateCustomerDto } from './dto/sales.dto';

/** Minimal CRM (Module 07 foundation): profile, group, credit limit, debt via the party ledger. */
@Injectable()
export class CustomersService {
  constructor(private readonly prisma: PrismaService, private readonly numbering: NumberingService, private readonly audit: AuditService, private readonly ledger: LedgerService, private readonly access: AccessService) {}

  private canSeeDebt(user: RequestUser) {
    return user.permissions.has('*') || user.permissions.has('customer.debt.view');
  }

  async list(user: RequestUser, q: CustomerQueryDto) {
    let debtIds: string[] | null = null;
    if (q.hasDebt === 'true') debtIds = (await this.prisma.db.partyBalance.findMany({ where: { partyType: 'CUSTOMER', balance: { not: 0 } }, select: { partyId: true } })).map((b) => b.partyId);
    const where: Prisma.CustomerWhereInput = {
      ...(q.isActive ? { isActive: q.isActive === 'true' } : {}),
      ...(q.groupName ? { groupName: q.groupName } : {}),
      ...(debtIds ? { id: { in: debtIds } } : {}),
      ...(q.search ? { OR: [{ code: { contains: q.search, mode: 'insensitive' } }, { name: { contains: q.search, mode: 'insensitive' } }, { phone: { contains: q.search } }, { email: { contains: q.search, mode: 'insensitive' } }] } : {}),
    };
    const [rows, total] = await Promise.all([
      this.prisma.db.customer.findMany({ where, ...skipTake(q), orderBy: orderBy(q, ['createdAt', 'code', 'name'], 'createdAt') }),
      this.prisma.db.customer.count({ where }),
    ]);
    const balances = await this.ledger.balances(this.prisma.db, 'CUSTOMER', rows.map((r) => r.id));
    const canSee = this.canSeeDebt(user);
    return paginated(rows.map((r) => ({ ...r, balance: canSee ? (balances.get(r.id) ?? ZERO) : undefined })), total, q);
  }

  /** Quick lookup for POS (phone / name / code), max 10 rows. */
  async quickSearch(user: RequestUser, qstr: string) {
    const term = qstr.trim();
    if (!term) return [];
    const rows = await this.prisma.db.customer.findMany({ where: { isActive: true, OR: [{ phone: { contains: term } }, { name: { contains: term, mode: 'insensitive' } }, { code: { contains: term, mode: 'insensitive' } }] }, take: 10, orderBy: { name: 'asc' } });
    const balances = this.canSeeDebt(user) ? await this.ledger.balances(this.prisma.db, 'CUSTOMER', rows.map((r) => r.id)) : new Map();
    return rows.map((r) => ({ id: r.id, code: r.code, name: r.name, phone: r.phone, groupName: r.groupName, creditLimit: r.creditLimit, balance: this.canSeeDebt(user) ? (balances.get(r.id) ?? ZERO) : undefined }));
  }

  async groups() {
    const rows = await this.prisma.db.customer.groupBy({ by: ['groupName'], where: { groupName: { not: null } }, _count: { _all: true } });
    return rows.map((r) => ({ name: r.groupName, count: r._count._all }));
  }

  async get(user: RequestUser, id: string) {
    const c = await this.prisma.db.customer.findFirst({ where: { id } });
    if (!c) throw Errors.notFound('Khách hàng', id);
    const scope = this.access.branchWhere(user);
    const [balance, agg, last] = await Promise.all([
      this.ledger.balance(this.prisma.db, 'CUSTOMER', id),
      this.prisma.db.invoice.aggregate({ where: { customerId: id, status: 'COMPLETED', ...scope }, _sum: { totalAmount: true }, _count: { _all: true } }),
      this.prisma.db.invoice.findFirst({ where: { customerId: id, status: 'COMPLETED', ...scope }, orderBy: { invoiceDate: 'desc' }, select: { code: true, invoiceDate: true, totalAmount: true } }),
    ]);
    return { ...c, balance: this.canSeeDebt(user) ? balance : undefined, stats: { invoices: agg._count._all, revenue: D(agg._sum.totalAmount), lastInvoice: last } };
  }

  async create(user: RequestUser, dto: CreateCustomerDto) {
    if (dto.code) {
      const dup = await this.prisma.db.customer.findFirst({ where: { code: dto.code } });
      if (dup) throw Errors.duplicate('DUPLICATE_CODE', 'Mã khách hàng đã tồn tại', { code: dto.code });
    }
    return this.prisma.tx(async (tx) => {
      let code = dto.code ?? (await this.numbering.next(tx, 'CUSTOMER'));
      if (!dto.code) for (let i = 0; i < 5 && (await tx.customer.findFirst({ where: { code } })); i++) code = await this.numbering.next(tx, 'CUSTOMER');
      let c;
      try {
        c = await tx.customer.create({ data: { tenantId: user.tenantId, code, name: dto.name, phone: dto.phone, email: dto.email, address: dto.address, gender: dto.gender, birthday: dto.birthday ? new Date(dto.birthday) : null, taxCode: dto.taxCode, groupName: dto.groupName, note: dto.note, creditLimit: dto.creditLimit !== undefined ? money(dto.creditLimit) : null, createdById: user.id } });
      } catch (e) {
        if (e instanceof Prisma.PrismaClientKnownRequestError && e.code === 'P2002') throw Errors.duplicate('DUPLICATE_CODE', 'Mã khách hàng đã tồn tại', { code });
        throw e;
      }
      const opening = money(dto.openingBalance ?? 0);
      if (!opening.isZero()) {
        if (!this.canSeeDebt(user)) throw Errors.forbidden('Thiếu quyền: customer.debt.view (công nợ đầu kỳ)');
        await this.ledger.post(tx, { tenantId: user.tenantId, partyType: 'CUSTOMER', partyId: c.id, type: 'OPENING', amount: opening, documentType: 'CUSTOMER', documentId: c.id, documentCode: c.code, note: 'Công nợ đầu kỳ', userId: user.id });
      }
      await this.audit.log(tx, { action: 'customer.create', entityType: 'Customer', entityId: c.id, entityCode: c.code, after: { ...c, openingBalance: opening.toString() } });
      return { ...c, balance: opening };
    });
  }

  async update(user: RequestUser, id: string, dto: UpdateCustomerDto) {
    const before = await this.prisma.db.customer.findFirst({ where: { id } });
    if (!before) throw Errors.notFound('Khách hàng', id);
    if (dto.creditLimit !== undefined && dto.creditLimit !== null && !/^\d{1,15}(\.\d{1,4})?$/.test(dto.creditLimit)) throw Errors.validation('Hạn mức nợ không hợp lệ');
    return this.prisma.tx(async (tx) => {
      const after = await tx.customer.update({ where: { id }, data: { ...dto, birthday: dto.birthday === undefined ? undefined : dto.birthday ? new Date(dto.birthday) : null, creditLimit: dto.creditLimit === undefined ? undefined : dto.creditLimit === null ? null : money(dto.creditLimit) } });
      await this.audit.log(tx, { action: 'customer.update', entityType: 'Customer', entityId: id, entityCode: after.code, before, after });
      return after;
    });
  }

  async history(user: RequestUser, id: string) {
    await this.get(user, id);
    const scope = this.access.branchWhere(user);
    const [invoices, payments, returns] = await Promise.all([
      this.prisma.db.invoice.findMany({ where: { customerId: id, ...scope }, orderBy: { invoiceDate: 'desc' }, take: 50, select: { id: true, code: true, status: true, invoiceDate: true, totalAmount: true, paidAmount: true, returnedAmount: true, branch: { select: { name: true } } } }),
      this.prisma.db.payment.findMany({ where: { partyType: 'CUSTOMER', partyId: id, ...scope }, orderBy: { paymentDate: 'desc' }, take: 50, select: { id: true, code: true, status: true, direction: true, method: true, paymentDate: true, amount: true, allocated: true } }),
      this.prisma.db.salesReturn.findMany({ where: { customerId: id, ...scope }, orderBy: { returnDate: 'desc' }, take: 50, select: { id: true, code: true, status: true, returnDate: true, totalRefund: true, refundedAmount: true, invoice: { select: { code: true } }, exchangeInvoice: { select: { code: true } } } }),
    ]);
    return { invoices, payments, returns };
  }

  async ledgerEntries(user: RequestUser, id: string, q: LedgerQueryDto) {
    await this.get(user, id);
    const scope = this.access.branchWhere(user);
    const where: Prisma.PartyLedgerEntryWhereInput = {
      partyType: 'CUSTOMER', partyId: id,
      ...(scope.branchId ? { OR: [{ branchId: scope.branchId }, { branchId: null }] } : {}),
      ...(q.from || q.to ? { createdAt: { ...(q.from ? { gte: new Date(q.from) } : {}), ...(q.to ? { lte: new Date(q.to) } : {}) } } : {}),
    };
    const [rows, total] = await Promise.all([
      this.prisma.db.partyLedgerEntry.findMany({ where, ...skipTake(q), orderBy: [{ createdAt: 'desc' }, { id: 'desc' }] }),
      this.prisma.db.partyLedgerEntry.count({ where }),
    ]);
    return paginated(rows, total, q);
  }

  /** Customer debt overview (balances ≠ 0). */
  async debt(user: RequestUser) {
    if (!this.canSeeDebt(user)) throw Errors.forbidden('Thiếu quyền: customer.debt.view');
    const balances = await this.prisma.db.partyBalance.findMany({ where: { partyType: 'CUSTOMER', balance: { not: 0 } } });
    const ids = balances.map((b) => b.partyId);
    const customers = ids.length ? await this.prisma.db.customer.findMany({ where: { id: { in: ids } }, select: { id: true, code: true, name: true, phone: true, creditLimit: true } }) : [];
    const stats = ids.length ? await this.prisma.db.invoice.groupBy({ by: ['customerId'], where: { customerId: { in: ids }, status: 'COMPLETED', ...this.access.branchWhere(user) }, _count: { _all: true }, _sum: { totalAmount: true, paidAmount: true } }) : [];
    const sMap = new Map(stats.map((u) => [u.customerId, u]));
    const rows = customers.map((c) => { const b = balances.find((x) => x.partyId === c.id)!; const u = sMap.get(c.id); return { ...c, balance: D(b.balance), invoices: u?._count._all ?? 0, revenue: D(u?._sum.totalAmount), paid: D(u?._sum.paidAmount) }; }).sort((a, b) => b.balance.comparedTo(a.balance));
    return { total: rows.reduce((s, r) => s.plus(r.balance), ZERO), customers: rows };
  }

  /** Customers whose birthday falls in the month (and day) — for greetings / birthday promotions (BR-144). */
  async birthdays(user: RequestUser, month?: number, day?: number) {
    const m = month ?? new Date().getMonth() + 1;
    const rows = await this.prisma.raw.$queryRaw<Array<{ id: string; code: string; name: string; phone: string | null; birthday: Date; group_name: string | null; points: Prisma.Decimal }>>`SELECT id, code, name, phone, birthday, group_name, points FROM customers WHERE tenant_id = ${user.tenantId}::uuid AND is_active = true AND birthday IS NOT NULL AND EXTRACT(MONTH FROM birthday) = ${m} ${day ? Prisma.sql`AND EXTRACT(DAY FROM birthday) = ${day}` : Prisma.empty} ORDER BY EXTRACT(DAY FROM birthday), name`;
    return { month: m, day: day ?? null, customers: rows.map((r) => ({ id: r.id, code: r.code, name: r.name, phone: r.phone, birthday: r.birthday, groupName: r.group_name, points: D(r.points), day: new Date(r.birthday).getDate() })) };
  }
}
