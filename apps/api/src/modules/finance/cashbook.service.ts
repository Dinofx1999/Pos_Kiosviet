import { Injectable } from '@nestjs/common';
import { CashTransferStatus, PaymentDirection, Prisma } from '@prisma/client';
import { Errors } from '../../common/errors/app-error';
import { orderBy, paginated, skipTake } from '../../common/pagination';
import { D, money, ZERO } from '../../common/utils/decimal';
import { AccessService } from '../../infra/access/access.service';
import { AuditService } from '../../infra/audit/audit.service';
import { RequestUser } from '../../infra/cls/request-context';
import { NumberingService } from '../../infra/numbering/numbering.service';
import { OutboxService } from '../../infra/outbox/outbox.service';
import { PrismaService, TxClient } from '../../infra/prisma/prisma.service';
import { CashbookQueryDto, CashSummaryQueryDto, CreateCashAccountDto, CreateCashTransferDto, CreatePaymentCategoryDto, DebtOffsetDto, ReconcileCashDto, TransferQueryDto, UpdateCashAccountDto, UpdatePaymentCategoryDto } from './dto/cashbook.dto';
import { LedgerService } from './ledger.service';
import { PaymentsService } from './payments.service';

const NONE = '00000000-0000-0000-0000-000000000000';

/** Quỹ tiền, sổ quỹ, chuyển quỹ / bàn giao ca, kiểm quỹ, cấn trừ công nợ (BR-70..BR-75). */
@Injectable()
export class CashbookService {
  constructor(
    private readonly prisma: PrismaService, private readonly payments: PaymentsService, private readonly ledger: LedgerService,
    private readonly numbering: NumberingService, private readonly audit: AuditService, private readonly outbox: OutboxService, private readonly access: AccessService,
  ) {}

  // ---------------------------------------------------------------- cash accounts (quỹ)
  private accountScope(user: RequestUser): Prisma.CashAccountWhereInput {
    const scope = this.access.branchWhere(user);
    return scope.branchId ? { OR: [{ branchId: scope.branchId }, { branchId: null }] } : {};
  }

  async listAccounts(user: RequestUser, includeInactive = false) {
    return this.prisma.db.cashAccount.findMany({ where: { AND: [this.accountScope(user), includeInactive ? {} : { isActive: true }] }, include: { branch: { select: { id: true, name: true } } }, orderBy: [{ type: 'asc' }, { isDefault: 'desc' }, { name: 'asc' }] });
  }

  async getAccount(user: RequestUser, id: string) {
    const acc = await this.prisma.db.cashAccount.findFirst({ where: { AND: [{ id }, this.accountScope(user)] }, include: { branch: { select: { id: true, name: true } } } });
    if (!acc) throw Errors.notFound('Quỹ tiền', id);
    const last = await this.prisma.db.cashReconciliation.findFirst({ where: { accountId: id }, orderBy: { createdAt: 'desc' } });
    return { ...acc, lastReconciliation: last };
  }

  async createAccount(user: RequestUser, dto: CreateCashAccountDto) {
    if (dto.branchId) this.access.assertBranch(user, dto.branchId);
    return this.prisma.tx(async (tx) => {
      if (dto.branchId && !(await tx.branch.findFirst({ where: { id: dto.branchId } }))) throw Errors.notFound('Chi nhánh', dto.branchId);
      const code = dto.code ?? (await this.numbering.next(tx, 'CASH_ACCOUNT'));
      if (await tx.cashAccount.findFirst({ where: { code } })) throw Errors.duplicate('DUPLICATE_CODE', 'Mã quỹ đã tồn tại', { code });
      const opening = money(dto.openingBalance ?? 0);
      const type = dto.type ?? 'CASH';
      if (dto.isDefault) await tx.cashAccount.updateMany({ where: { type, branchId: dto.branchId ?? null, isDefault: true }, data: { isDefault: false } });
      const acc = await tx.cashAccount.create({ data: { tenantId: user.tenantId, branchId: dto.branchId ?? null, code, name: dto.name, type, bankName: dto.bankName, accountNumber: dto.accountNumber, accountHolder: dto.accountHolder, openingBalance: opening, balance: opening, isDefault: dto.isDefault ?? false } });
      await this.audit.log(tx, { action: 'cash.account.create', entityType: 'CashAccount', entityId: acc.id, entityCode: code, after: acc });
      return acc;
    });
  }

  async updateAccount(user: RequestUser, id: string, dto: UpdateCashAccountDto) {
    const before = await this.prisma.db.cashAccount.findFirst({ where: { AND: [{ id }, this.accountScope(user)] } });
    if (!before) throw Errors.notFound('Quỹ tiền', id);
    if (dto.isActive === false && !D(before.balance).isZero()) throw Errors.conflict('CASH_ACCOUNT_HAS_BALANCE', 'Quỹ còn số dư, hãy chuyển quỹ trước khi ngừng sử dụng', { balance: before.balance.toString() });
    return this.prisma.tx(async (tx) => {
      if (dto.isDefault) await tx.cashAccount.updateMany({ where: { type: before.type, branchId: before.branchId, isDefault: true }, data: { isDefault: false } });
      const after = await tx.cashAccount.update({ where: { id }, data: dto });
      await this.audit.log(tx, { action: 'cash.account.update', entityType: 'CashAccount', entityId: id, entityCode: after.code, before, after });
      return after;
    });
  }

  // ---------------------------------------------------------------- categories (loại thu/chi)
  listCategories(direction?: string, includeInactive = false) {
    return this.prisma.db.paymentCategory.findMany({ where: { ...(direction ? { direction: direction as PaymentDirection } : {}), ...(includeInactive ? {} : { isActive: true }) }, orderBy: [{ direction: 'asc' }, { name: 'asc' }] });
  }
  async createCategory(user: RequestUser, dto: CreatePaymentCategoryDto) {
    if (await this.prisma.db.paymentCategory.findFirst({ where: { direction: dto.direction, name: dto.name } })) throw Errors.duplicate('DUPLICATE_NAME', 'Loại thu/chi đã tồn tại', { name: dto.name });
    return this.prisma.db.paymentCategory.create({ data: { tenantId: user.tenantId, direction: dto.direction, name: dto.name } });
  }
  async updateCategory(user: RequestUser, id: string, dto: UpdatePaymentCategoryDto) {
    const c = await this.prisma.db.paymentCategory.findFirst({ where: { id } });
    if (!c) throw Errors.notFound('Loại thu/chi', id);
    return this.prisma.db.paymentCategory.update({ where: { id }, data: dto });
  }

  // ---------------------------------------------------------------- transfers / handover (BR-72)
  async listTransfers(user: RequestUser, q: TransferQueryDto) {
    const where: Prisma.CashTransferWhereInput = { AND: [this.access.branchWhere(user), {
      ...(q.branchId ? { branchId: q.branchId } : {}), ...(q.status ? { status: q.status as CashTransferStatus } : {}), ...(q.kind ? { kind: q.kind } : {}),
      ...(q.from || q.to ? { createdAt: { ...(q.from ? { gte: new Date(q.from) } : {}), ...(q.to ? { lte: new Date(q.to) } : {}) } } : {}),
      ...(q.search ? { OR: [{ code: { contains: q.search, mode: 'insensitive' } }, { note: { contains: q.search, mode: 'insensitive' } }] } : {}),
    }] };
    const [rows, total] = await Promise.all([
      this.prisma.db.cashTransfer.findMany({ where, include: { fromAccount: { select: { id: true, code: true, name: true } }, toAccount: { select: { id: true, code: true, name: true } }, payments: { select: { id: true, code: true, direction: true, status: true } } }, ...skipTake(q), orderBy: orderBy(q, ['createdAt', 'amount', 'code'], 'createdAt') }),
      this.prisma.db.cashTransfer.count({ where }),
    ]);
    return paginated(rows, total, q);
  }

  async transfer(user: RequestUser, dto: CreateCashTransferDto) {
    return this.prisma.tx((tx) => this.transferInTx(tx, user, dto));
  }

  /** Two TRANSFER-method vouchers (OUT from A, IN to B); accounts locked in id order; source may not go negative (BR-72). */
  async transferInTx(tx: TxClient, user: RequestUser, dto: CreateCashTransferDto, opts: { shiftId?: string | null; permissionChecked?: boolean; kind?: 'TRANSFER' | 'HANDOVER' } = {}) {
    this.access.assertBranch(user, dto.branchId);
    if (dto.fromAccountId === dto.toAccountId) throw Errors.validation('Quỹ nguồn và quỹ đích phải khác nhau');
    const amount = money(dto.amount);
    const ids = [dto.fromAccountId, dto.toAccountId].sort();
    for (const id of ids) await tx.$queryRaw`SELECT id FROM cash_accounts WHERE id = ${id}::uuid AND tenant_id = ${user.tenantId}::uuid FOR NO KEY UPDATE`;
    const [from, to] = await Promise.all([tx.cashAccount.findFirst({ where: { id: dto.fromAccountId, isActive: true } }), tx.cashAccount.findFirst({ where: { id: dto.toAccountId, isActive: true } })]);
    if (!from) throw Errors.notFound('Quỹ nguồn', dto.fromAccountId);
    if (!to) throw Errors.notFound('Quỹ đích', dto.toAccountId);
    for (const acc of [from, to]) if (acc.branchId && acc.branchId !== dto.branchId) this.access.assertBranch(user, acc.branchId);
    if (D(from.balance).lessThan(amount)) throw Errors.conflict('CASH_INSUFFICIENT', `Quỹ ${from.name} không đủ số dư`, { balance: from.balance.toString(), requested: amount.toString() });
    const code = await this.numbering.next(tx, 'CASH_TRANSFER');
    const outCode = await this.payments.nextCode(tx, 'OUT');
    const inCode = await this.payments.nextCode(tx, 'IN');
    const shiftId = opts.shiftId === undefined ? (await tx.$queryRaw<{ id: string }[]>`SELECT id FROM shifts WHERE tenant_id = ${user.tenantId}::uuid AND branch_id = ${dto.branchId}::uuid AND user_id = ${user.id}::uuid AND status = 'OPEN' FOR SHARE`)[0]?.id ?? null : opts.shiftId;
    const transfer = await tx.cashTransfer.create({ data: { tenantId: user.tenantId, branchId: dto.branchId, code, fromAccountId: from.id, toAccountId: to.id, amount, shiftId, kind: opts.kind ?? 'TRANSFER', note: dto.note, createdById: user.id } });
    await this.payments.createInTx(tx, user, { branchId: dto.branchId, direction: 'OUT', method: 'TRANSFER', amount, cashAccountId: from.id, transferId: transfer.id, shiftId, note: `Chuyển quỹ ${code} → ${to.name}`, code: outCode, allowOffset: true, permissionChecked: true });
    await this.payments.createInTx(tx, user, { branchId: dto.branchId, direction: 'IN', method: 'TRANSFER', amount, cashAccountId: to.id, transferId: transfer.id, shiftId, note: `Nhận chuyển quỹ ${code} ← ${from.name}`, code: inCode, allowOffset: true, permissionChecked: true });
    await this.audit.log(tx, { action: 'cash.transfer', entityType: 'CashTransfer', entityId: transfer.id, entityCode: code, after: { from: from.code, to: to.code, amount: amount.toString() } });
    await this.outbox.enqueue(tx, { eventType: 'cash.transferred', aggregateType: 'CashTransfer', aggregateId: transfer.id, payload: { code, from: from.id, to: to.id, amount: amount.toString() } });
    return tx.cashTransfer.findFirstOrThrow({ where: { id: transfer.id }, include: { fromAccount: true, toAccount: true, payments: true } });
  }

  async cancelTransfer(user: RequestUser, id: string, reason: string) {
    return this.prisma.tx(async (tx) => {
      const rows = await tx.$queryRaw<{ id: string }[]>`SELECT id FROM cash_transfers WHERE id = ${id}::uuid AND tenant_id = ${user.tenantId}::uuid FOR UPDATE`;
      if (!rows[0]) throw Errors.notFound('Phiếu chuyển quỹ', id);
      const t = await tx.cashTransfer.findFirstOrThrow({ where: { id }, include: { payments: true } });
      this.access.assertBranch(user, t.branchId);
      if (t.status !== 'POSTED') throw Errors.conflict('DOCUMENT_NOT_POSTED', 'Phiếu chuyển quỹ đã hủy');
      for (const p of [...t.payments].sort((a, b) => (a.id < b.id ? -1 : 1))) if (p.status === 'POSTED') await this.payments.cancelInTx(tx, user, p.id, `Hủy chuyển quỹ ${t.code}: ${reason}`, { viaTransfer: true });
      const after = await tx.cashTransfer.update({ where: { id }, data: { status: 'CANCELLED', cancelledAt: new Date(), cancelReason: reason }, include: { fromAccount: true, toAccount: true, payments: true } });
      await this.audit.log(tx, { action: 'cash.transfer.cancel', entityType: 'CashTransfer', entityId: id, entityCode: t.code, after: { reason } });
      return after;
    });
  }

  // ---------------------------------------------------------------- reconciliation (kiểm quỹ, BR-73)
  async reconcile(user: RequestUser, accountId: string, dto: ReconcileCashDto) {
    return this.prisma.tx(async (tx) => {
      const rows = await tx.$queryRaw<{ balance: Prisma.Decimal; branch_id: string | null; code: string }[]>`SELECT balance, branch_id, code FROM cash_accounts WHERE id = ${accountId}::uuid AND tenant_id = ${user.tenantId}::uuid FOR NO KEY UPDATE`;
      if (!rows[0]) throw Errors.notFound('Quỹ tiền', accountId);
      if (rows[0].branch_id) this.access.assertBranch(user, rows[0].branch_id);
      const counted = money(dto.countedBalance);
      const book = D(rows[0].balance);
      const rec = await tx.cashReconciliation.create({ data: { tenantId: user.tenantId, accountId, bookBalance: book, countedBalance: counted, difference: counted.minus(book), note: dto.note, createdById: user.id } });
      await this.audit.log(tx, { action: 'cash.reconcile', entityType: 'CashAccount', entityId: accountId, entityCode: rows[0].code, after: { book: book.toString(), counted: counted.toString(), difference: counted.minus(book).toString() } });
      return rec;
    });
  }

  listReconciliations(user: RequestUser, accountId: string) {
    return this.prisma.db.cashReconciliation.findMany({ where: { accountId }, orderBy: { createdAt: 'desc' }, take: 50 });
  }

  // ---------------------------------------------------------------- cash book (sổ quỹ, BR-71)
  /** Voucher lines with a running balance for one fund (opening + Σ signed amounts in date order; cancelled / OFFSET excluded). */
  async cashbook(user: RequestUser, q: CashbookQueryDto) {
    if (!q.accountId) {
      // no account: plain voucher list across accessible funds, no running balance
      const scope = this.access.branchWhere(user);
      const where: Prisma.PaymentWhereInput = { AND: [scope, { status: 'POSTED', method: { notIn: ['OFFSET', 'POINTS'] }, ...(q.branchId ? { branchId: q.branchId } : {}), ...(q.direction ? { direction: q.direction as PaymentDirection } : {}), ...(q.from || q.to ? { paymentDate: { ...(q.from ? { gte: new Date(q.from) } : {}), ...(q.to ? { lte: new Date(q.to) } : {}) } } : {}) }] };
      const [rows, total] = await Promise.all([this.prisma.db.payment.findMany({ where, include: { cashAccount: { select: { code: true, name: true } }, category: { select: { name: true } } }, ...skipTake(q), orderBy: [{ paymentDate: 'desc' }, { createdAt: 'desc' }] }), this.prisma.db.payment.count({ where })]);
      return { account: null, openingBalance: null, ...paginated(rows, total, q) };
    }
    const acc = await this.getAccount(user, q.accountId);
    const from = q.from ? new Date(q.from) : null;
    const to = q.to ? new Date(q.to) : null;
    const tenant = user.tenantId;
    const fromSql = from ? Prisma.sql`AND payment_date >= ${from}` : Prisma.empty;
    const toSql = to ? Prisma.sql`AND payment_date <= ${to}` : Prisma.empty;
    const dirSql = q.direction ? Prisma.sql`AND direction = ${q.direction}::"PaymentDirection"` : Prisma.empty;
    const before = from ? (await this.prisma.raw.$queryRaw<{ s: Prisma.Decimal }[]>`SELECT COALESCE(SUM(CASE WHEN direction = 'IN' THEN amount ELSE -amount END),0) AS s FROM payments WHERE tenant_id = ${tenant}::uuid AND cash_account_id = ${acc.id}::uuid AND status = 'POSTED' AND method NOT IN ('OFFSET', 'POINTS') AND payment_date < ${from}`)[0].s : ZERO;
    const openingBalance = D(acc.openingBalance).plus(D(before));
    const rows = await this.prisma.raw.$queryRaw<Array<{ id: string; code: string; direction: string; method: string; amount: Prisma.Decimal; payment_date: Date; note: string | null; party_type: string | null; party_id: string | null; category_id: string | null; running: Prisma.Decimal }>>`
      SELECT id, code, direction::text AS direction, method::text AS method, amount, payment_date, note, party_type::text AS party_type, party_id, category_id,
             SUM(CASE WHEN direction = 'IN' THEN amount ELSE -amount END) OVER (ORDER BY payment_date, created_at ROWS UNBOUNDED PRECEDING) AS running
      FROM payments WHERE tenant_id = ${tenant}::uuid AND cash_account_id = ${acc.id}::uuid AND status = 'POSTED' AND method NOT IN ('OFFSET', 'POINTS') ${fromSql} ${toSql}
      ORDER BY payment_date, created_at`;
    const filtered = q.direction ? rows.filter((r) => r.direction === q.direction) : rows;
    void dirSql;
    const total = filtered.length;
    const page = filtered.slice().reverse().slice((q.page - 1) * q.pageSize, q.page * q.pageSize);
    const totalIn = rows.filter((r) => r.direction === 'IN').reduce((s, r) => s.plus(D(r.amount)), ZERO);
    const totalOut = rows.filter((r) => r.direction === 'OUT').reduce((s, r) => s.plus(D(r.amount)), ZERO);
    const [suppliers, customers, cats] = await Promise.all([
      this.prisma.db.supplier.findMany({ where: { id: { in: page.filter((r) => r.party_type === 'SUPPLIER').map((r) => r.party_id!) } }, select: { id: true, name: true } }),
      this.prisma.db.customer.findMany({ where: { id: { in: page.filter((r) => r.party_type === 'CUSTOMER').map((r) => r.party_id!) } }, select: { id: true, name: true } }),
      this.prisma.db.paymentCategory.findMany({ where: { id: { in: page.map((r) => r.category_id).filter((x): x is string => !!x) } }, select: { id: true, name: true } }),
    ]);
    const nameOf = (type: string | null, id: string | null) => (type === 'SUPPLIER' ? suppliers : customers).find((x) => x.id === id)?.name ?? null;
    return {
      account: { id: acc.id, code: acc.code, name: acc.name, type: acc.type, balance: acc.balance },
      openingBalance, totalIn, totalOut, closingBalance: openingBalance.plus(totalIn).minus(totalOut),
      data: page.map((r) => ({ id: r.id, code: r.code, direction: r.direction, method: r.method, amount: r.amount, paymentDate: r.payment_date, note: r.note, partyType: r.party_type, partyId: r.party_id, partyName: nameOf(r.party_type, r.party_id), categoryName: cats.find((c) => c.id === r.category_id)?.name ?? null, balanceAfter: openingBalance.plus(D(r.running)) })),
      meta: { page: q.page, pageSize: q.pageSize, total },
    };
  }

  /** Totals per fund and per category/type over a period (BR-71). */
  async summary(user: RequestUser, q: CashSummaryQueryDto) {
    const scope = this.access.branchWhere(user);
    const branchIds = q.branchId ? [q.branchId] : scope.branchId ? (scope.branchId.in.length ? scope.branchId.in : [NONE]) : null;
    const from = q.from ? new Date(q.from) : new Date(new Date().setHours(0, 0, 0, 0));
    const to = q.to ? new Date(q.to) : new Date();
    const tenant = user.tenantId;
    const branchSql = branchIds ? Prisma.sql`AND p.branch_id IN (${Prisma.join(branchIds.map((id) => Prisma.sql`${id}::uuid`))})` : Prisma.empty;
    const accSql = q.accountId ? Prisma.sql`AND p.cash_account_id = ${q.accountId}::uuid` : Prisma.empty;
    const [byAccount, byKind] = await Promise.all([
      this.prisma.raw.$queryRaw<Array<{ account_id: string | null; code: string | null; name: string | null; total_in: Prisma.Decimal; total_out: Prisma.Decimal; balance: Prisma.Decimal | null }>>`SELECT a.id AS account_id, a.code, a.name, a.balance,
          COALESCE(SUM(p.amount) FILTER (WHERE p.direction = 'IN'),0) AS total_in, COALESCE(SUM(p.amount) FILTER (WHERE p.direction = 'OUT'),0) AS total_out
        FROM payments p LEFT JOIN cash_accounts a ON a.id = p.cash_account_id
        WHERE p.tenant_id = ${tenant}::uuid AND p.status = 'POSTED' AND p.method NOT IN ('OFFSET', 'POINTS') AND p.payment_date BETWEEN ${from} AND ${to} ${branchSql} ${accSql}
        GROUP BY a.id, a.code, a.name, a.balance ORDER BY a.code NULLS LAST`,
      this.prisma.raw.$queryRaw<Array<{ direction: string; kind: string; label: string | null; amount: Prisma.Decimal; count: bigint }>>`SELECT p.direction::text AS direction,
          CASE WHEN p.transfer_id IS NOT NULL THEN 'TRANSFER' WHEN p.party_type = 'CUSTOMER' THEN 'CUSTOMER' WHEN p.party_type = 'SUPPLIER' THEN 'SUPPLIER' WHEN p.category_id IS NOT NULL THEN 'CATEGORY' ELSE 'WALKIN' END AS kind,
          c.name AS label, COALESCE(SUM(p.amount),0) AS amount, count(*)::bigint AS count
        FROM payments p LEFT JOIN payment_categories c ON c.id = p.category_id
        WHERE p.tenant_id = ${tenant}::uuid AND p.status = 'POSTED' AND p.method NOT IN ('OFFSET', 'POINTS') AND p.payment_date BETWEEN ${from} AND ${to} ${branchSql} ${accSql}
        GROUP BY 1,2,3 ORDER BY 1,2,3`,
    ]);
    const sum = (dir: string) => byKind.filter((k) => k.direction === dir && k.kind !== 'TRANSFER').reduce((s, k) => s.plus(D(k.amount)), ZERO);
    return {
      from, to,
      totals: { in: sum('IN'), out: sum('OUT'), net: sum('IN').minus(sum('OUT')) },
      byAccount: byAccount.map((a) => ({ accountId: a.account_id, code: a.code, name: a.name ?? 'Không gắn quỹ', balance: a.balance === null ? null : D(a.balance), totalIn: D(a.total_in), totalOut: D(a.total_out) })),
      byKind: byKind.map((k) => ({ direction: k.direction, kind: k.kind, label: k.label, amount: D(k.amount), count: Number(k.count) })),
    };
  }

  // ---------------------------------------------------------------- debt offset customer ↔ supplier (BR-74)
  async debtOffset(user: RequestUser, dto: DebtOffsetDto) {
    return this.prisma.tx(async (tx) => {
      this.access.assertBranch(user, dto.branchId);
      const amount = money(dto.amount);
      const [customer, supplier] = await Promise.all([tx.customer.findFirst({ where: { id: dto.customerId } }), tx.supplier.findFirst({ where: { id: dto.supplierId } })]);
      if (!customer) throw Errors.notFound('Khách hàng', dto.customerId);
      if (!supplier) throw Errors.notFound('Nhà cung cấp', dto.supplierId);
      const inCode = await this.payments.nextCode(tx, 'IN');
      const outCode = await this.payments.nextCode(tx, 'OUT');
      const custBal = await this.ledger.lockBalance(tx, user.tenantId, 'CUSTOMER', customer.id);
      const supBal = await this.ledger.lockBalance(tx, user.tenantId, 'SUPPLIER', supplier.id);
      if (custBal.lessThan(amount)) throw Errors.conflict('OFFSET_EXCEEDS_DEBT', `Khách hàng chỉ còn nợ ${custBal.toString()}`, { customerBalance: custBal.toString() });
      if (supBal.lessThan(amount)) throw Errors.conflict('OFFSET_EXCEEDS_DEBT', `Chỉ còn nợ nhà cung cấp ${supBal.toString()}`, { supplierBalance: supBal.toString() });
      const note = dto.note ?? `Cấn trừ công nợ ${customer.name} ↔ ${supplier.name}`;
      const reference = `CT:${inCode}`; // pairs the two legs so the offset can be undone as one
      const pIn = await this.payments.createInTx(tx, user, { branchId: dto.branchId, direction: 'IN', method: 'OFFSET', partyType: 'CUSTOMER', partyId: customer.id, amount, note, reference, code: inCode, allowOffset: true, permissionChecked: true });
      const pOut = await this.payments.createInTx(tx, user, { branchId: dto.branchId, direction: 'OUT', method: 'OFFSET', partyType: 'SUPPLIER', partyId: supplier.id, amount, note, reference, code: outCode, allowOffset: true, permissionChecked: true });
      await this.audit.log(tx, { action: 'debt.offset', entityType: 'Payment', entityId: pIn.id, entityCode: `${pIn.code}+${pOut.code}`, after: { customerId: customer.id, supplierId: supplier.id, amount: amount.toString() } });
      return { amount, paymentId: pIn.id, customer: { id: customer.id, code: customer.code, name: customer.name, balanceAfter: custBal.minus(amount) }, supplier: { id: supplier.id, code: supplier.code, name: supplier.name, balanceAfter: supBal.minus(amount) }, vouchers: [pIn.code, pOut.code] };
    });
  }

  /** Undoes a debt offset: both OFFSET legs (paired by reference) are cancelled together; exchange OFFSET legs are not reachable here. */
  async cancelDebtOffset(user: RequestUser, paymentId: string, reason: string) {
    return this.prisma.tx(async (tx) => {
      const p = await tx.payment.findFirst({ where: { id: paymentId }, include: { allocations: { select: { id: true } } } });
      if (!p) throw Errors.notFound('Phiếu cấn trừ', paymentId);
      if (p.method !== 'OFFSET' || p.allocations.length || !p.reference?.startsWith('CT:')) throw Errors.validation('Phiếu này không phải phiếu cấn trừ công nợ', { paymentId });
      this.access.assertBranch(user, p.branchId);
      const legs = await tx.payment.findMany({ where: { method: 'OFFSET', reference: p.reference }, select: { id: true, status: true, code: true }, orderBy: { id: 'asc' } });
      if (!legs.some((l) => l.status === 'POSTED')) throw Errors.conflict('PAYMENT_NOT_POSTED', 'Phiếu cấn trừ đã được hủy trước đó');
      for (const l of legs) if (l.status === 'POSTED') await this.payments.cancelInTx(tx, user, l.id, `Hủy cấn trừ công nợ: ${reason}`);
      await this.audit.log(tx, { action: 'debt.offset.cancel', entityType: 'Payment', entityId: paymentId, entityCode: legs.map((l) => l.code).join('+'), after: { reason } });
      return { cancelled: legs.map((l) => l.code) };
    });
  }
}
