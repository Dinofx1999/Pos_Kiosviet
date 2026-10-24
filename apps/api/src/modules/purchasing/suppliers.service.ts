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
import { CreateSupplierDto, SupplierQueryDto, UpdateSupplierDto } from './dto/purchasing.dto';

@Injectable()
export class SuppliersService {
  constructor(private readonly prisma: PrismaService, private readonly numbering: NumberingService, private readonly audit: AuditService, private readonly ledger: LedgerService, private readonly access: AccessService) {}

  async list(user: RequestUser, q: SupplierQueryDto) {
    let debtIds: string[] | null = null;
    if (q.hasDebt === 'true') debtIds = (await this.prisma.db.partyBalance.findMany({ where: { partyType: 'SUPPLIER', balance: { not: 0 } }, select: { partyId: true } })).map((b) => b.partyId);
    const where: Prisma.SupplierWhereInput = {
      ...(q.isActive ? { isActive: q.isActive === 'true' } : {}),
      ...(q.groupName ? { groupName: q.groupName } : {}),
      ...(debtIds ? { id: { in: debtIds } } : {}),
      ...(q.search ? { OR: [{ code: { contains: q.search, mode: 'insensitive' } }, { name: { contains: q.search, mode: 'insensitive' } }, { phone: { contains: q.search } }, { email: { contains: q.search, mode: 'insensitive' } }] } : {}),
    };
    const [rows, total] = await Promise.all([
      this.prisma.db.supplier.findMany({ where, ...skipTake(q), orderBy: orderBy(q, ['createdAt', 'code', 'name'], 'createdAt') }),
      this.prisma.db.supplier.count({ where }),
    ]);
    const balances = await this.ledger.balances(this.prisma.db, 'SUPPLIER', rows.map((r) => r.id));
    const canSeeDebt = user.permissions.has('*') || user.permissions.has('supplier.debt.view');
    return paginated(rows.map((r) => ({ ...r, balance: canSeeDebt ? (balances.get(r.id) ?? ZERO) : undefined })), total, q);
  }

  async groups() {
    const rows = await this.prisma.db.supplier.groupBy({ by: ['groupName'], where: { groupName: { not: null } }, _count: { _all: true } });
    return rows.map((r) => ({ name: r.groupName, count: r._count._all }));
  }

  async get(user: RequestUser, id: string) {
    const s = await this.prisma.db.supplier.findFirst({ where: { id } });
    if (!s) throw Errors.notFound('Nhà cung cấp', id);
    const scope = this.access.branchWhere(user);
    const [balance, receiptAgg, lastReceipt, returnAgg] = await Promise.all([
      this.ledger.balance(this.prisma.db, 'SUPPLIER', id),
      this.prisma.db.purchaseReceipt.aggregate({ where: { supplierId: id, status: 'POSTED', ...scope }, _sum: { totalAmount: true }, _count: { _all: true } }),
      this.prisma.db.purchaseReceipt.findFirst({ where: { supplierId: id, status: 'POSTED', ...scope }, orderBy: { receiptDate: 'desc' }, select: { code: true, receiptDate: true, totalAmount: true } }),
      this.prisma.db.purchaseReturn.aggregate({ where: { supplierId: id, status: 'POSTED', ...scope }, _sum: { totalAmount: true }, _count: { _all: true } }),
    ]);
    const canSeeDebt = user.permissions.has('*') || user.permissions.has('supplier.debt.view');
    return { ...s, balance: canSeeDebt ? balance : undefined, stats: { receipts: receiptAgg._count._all, purchased: D(receiptAgg._sum.totalAmount), returns: returnAgg._count._all, returned: D(returnAgg._sum.totalAmount), lastReceipt } };
  }

  async create(user: RequestUser, dto: CreateSupplierDto) {
    if (dto.code) {
      const dup = await this.prisma.db.supplier.findFirst({ where: { code: dto.code } });
      if (dup) throw Errors.duplicate('DUPLICATE_CODE', 'Mã nhà cung cấp đã tồn tại', { code: dto.code });
    }
    return this.prisma.tx(async (tx) => {
      let code = dto.code ?? (await this.numbering.next(tx, 'SUPPLIER'));
      // an auto code may collide with a manually entered one → advance the sequence instead of failing with 500
      if (!dto.code) for (let i = 0; i < 5 && (await tx.supplier.findFirst({ where: { code } })); i++) code = await this.numbering.next(tx, 'SUPPLIER');
      let s;
      try {
        s = await tx.supplier.create({ data: { tenantId: user.tenantId, code, name: dto.name, phone: dto.phone, email: dto.email, address: dto.address, taxCode: dto.taxCode, contactName: dto.contactName, groupName: dto.groupName, note: dto.note, createdById: user.id } });
      } catch (e) {
        if (e instanceof Prisma.PrismaClientKnownRequestError && e.code === 'P2002') throw Errors.duplicate('DUPLICATE_CODE', 'Mã nhà cung cấp đã tồn tại', { code });
        throw e;
      }
      const opening = money(dto.openingBalance ?? 0);
      if (!opening.isZero()) {
        await this.ledger.post(tx, { tenantId: user.tenantId, partyType: 'SUPPLIER', partyId: s.id, type: 'OPENING', amount: opening, documentType: 'SUPPLIER', documentId: s.id, documentCode: s.code, note: 'Công nợ đầu kỳ', userId: user.id });
      }
      await this.audit.log(tx, { action: 'supplier.create', entityType: 'Supplier', entityId: s.id, entityCode: s.code, after: { ...s, openingBalance: opening.toString() } });
      return { ...s, balance: opening };
    });
  }

  async update(user: RequestUser, id: string, dto: UpdateSupplierDto) {
    const before = await this.prisma.db.supplier.findFirst({ where: { id } });
    if (!before) throw Errors.notFound('Nhà cung cấp', id);
    return this.prisma.tx(async (tx) => {
      const after = await tx.supplier.update({ where: { id }, data: dto });
      await this.audit.log(tx, { action: 'supplier.update', entityType: 'Supplier', entityId: id, entityCode: after.code, before, after });
      return after;
    });
  }

  /** Purchase history (receipts, returns, payments) for one supplier, branch-scoped. */
  async history(user: RequestUser, id: string) {
    await this.get(user, id);
    const scope = this.access.branchWhere(user);
    const [receipts, returns, payments] = await Promise.all([
      this.prisma.db.purchaseReceipt.findMany({ where: { supplierId: id, ...scope }, orderBy: { receiptDate: 'desc' }, take: 50, select: { id: true, code: true, status: true, receiptDate: true, totalAmount: true, paidAmount: true, returnedAmount: true, warehouse: { select: { name: true } } } }),
      this.prisma.db.purchaseReturn.findMany({ where: { supplierId: id, ...scope }, orderBy: { returnDate: 'desc' }, take: 50, select: { id: true, code: true, status: true, returnDate: true, totalAmount: true, refundedAmount: true, receipt: { select: { code: true } } } }),
      this.prisma.db.payment.findMany({ where: { partyType: 'SUPPLIER', partyId: id, ...scope }, orderBy: { paymentDate: 'desc' }, take: 50, select: { id: true, code: true, status: true, direction: true, method: true, paymentDate: true, amount: true, allocated: true } }),
    ]);
    return { receipts, returns, payments };
  }

  async ledgerEntries(user: RequestUser, id: string, q: LedgerQueryDto) {
    await this.get(user, id);
    const scope = this.access.branchWhere(user);
    const where: Prisma.PartyLedgerEntryWhereInput = {
      partyType: 'SUPPLIER', partyId: id,
      ...(scope.branchId ? { OR: [{ branchId: scope.branchId }, { branchId: null }] } : {}),
      ...(q.from || q.to ? { createdAt: { ...(q.from ? { gte: new Date(q.from) } : {}), ...(q.to ? { lte: new Date(q.to) } : {}) } } : {}),
    };
    const [rows, total] = await Promise.all([
      this.prisma.db.partyLedgerEntry.findMany({ where, ...skipTake(q), orderBy: [{ createdAt: 'desc' }, { id: 'desc' }] }),
      this.prisma.db.partyLedgerEntry.count({ where }),
    ]);
    return paginated(rows, total, q);
  }
}
