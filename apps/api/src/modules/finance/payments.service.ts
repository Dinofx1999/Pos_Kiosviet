import { Injectable } from '@nestjs/common';
import { LedgerEntryType, PartyType, PaymentDirection, PaymentMethod, Prisma } from '@prisma/client';
import { hasPermission, TENANT_SETTING_KEYS } from '@erp/shared';
import { Errors } from '../../common/errors/app-error';
import { orderBy, paginated, skipTake } from '../../common/pagination';
import { D, money, ZERO } from '../../common/utils/decimal';
import { AccessService } from '../../infra/access/access.service';
import { AuditService } from '../../infra/audit/audit.service';
import { RequestUser } from '../../infra/cls/request-context';
import { NumberingService } from '../../infra/numbering/numbering.service';
import { OutboxService } from '../../infra/outbox/outbox.service';
import { PrismaService, TxClient } from '../../infra/prisma/prisma.service';
import { CreatePaymentDto, PaymentQueryDto } from './dto/finance.dto';
import { LedgerService } from './ledger.service';

export type AllocationDocType = 'PURCHASE_RECEIPT' | 'PURCHASE_RETURN' | 'INVOICE' | 'SALES_RETURN' | 'SALES_ORDER';

export interface PaymentInput {
  branchId: string;
  direction: PaymentDirection;
  method?: PaymentMethod;
  /** null/undefined = walk-in (no party, no ledger entry) */
  partyType?: PartyType | null;
  partyId?: string | null;
  shiftId?: string | null;
  amount: Prisma.Decimal;
  paymentDate?: Date;
  reference?: string | null;
  note?: string | null;
  allocations?: Array<{ documentType: AllocationDocType; documentId: string; amount: Prisma.Decimal }>;
  /** Pre-fetched voucher code (callers that already hold document/party locks take the sequence first – lock order). */
  code?: string;
  /** Caller already authorised the voucher through its own permission (e.g. invoice.complete at the POS). */
  permissionChecked?: boolean;
  /** OFFSET (cấn trừ) vouchers are only created by the system (exchange / debt netting), never from the public API. */
  allowOffset?: boolean;
  /** Quỹ tiền nhận/chi; bỏ trống = quỹ mặc định theo phương thức và chi nhánh. */
  cashAccountId?: string | null;
  /** Loại thu/chi khác – required for vouchers without a party and without allocations. */
  categoryId?: string | null;
  /** Set by CashbookService for the two legs of a cash transfer (method TRANSFER). */
  transferId?: string | null;
}

/**
 * Phiếu thu / phiếu chi with allocations (BR-48).
 * Lock order inside createInTx: allocated documents (sorted by id) → document sequence → party balance.
 * Ledger effect: SUPPLIER OUT → −amount, IN (refund) → +amount; CUSTOMER IN (thu) → −amount, OUT (hoàn) → +amount.
 */
@Injectable()
export class PaymentsService {
  constructor(
    private readonly prisma: PrismaService, private readonly ledger: LedgerService, private readonly numbering: NumberingService,
    private readonly audit: AuditService, private readonly outbox: OutboxService, private readonly access: AccessService,
  ) {}

  async list(user: RequestUser, q: PaymentQueryDto) {
    const filters: Prisma.PaymentWhereInput = {
      ...(q.direction ? { direction: q.direction as PaymentDirection } : {}),
      ...(q.partyType ? { partyType: q.partyType as PartyType } : {}),
      ...(q.partyId ? { partyId: q.partyId } : {}),
      ...(q.branchId ? { branchId: q.branchId } : {}),
      ...(q.cashAccountId ? { cashAccountId: q.cashAccountId } : {}),
      ...(q.categoryId ? { categoryId: q.categoryId } : {}),
      ...(q.method ? { method: q.method as PaymentMethod } : {}),
      ...(q.status ? { status: q.status as any } : {}),
      ...(q.from || q.to ? { paymentDate: { ...(q.from ? { gte: new Date(q.from) } : {}), ...(q.to ? { lte: new Date(q.to) } : {}) } } : {}),
      ...(q.search ? { OR: [{ code: { contains: q.search, mode: 'insensitive' } }, { reference: { contains: q.search, mode: 'insensitive' } }, { note: { contains: q.search, mode: 'insensitive' } }] } : {}),
    };
    const where: Prisma.PaymentWhereInput = { AND: [this.access.branchWhere(user), filters] };
    const [rows, total] = await Promise.all([
      this.prisma.db.payment.findMany({ where, include: { allocations: true, branch: { select: { id: true, name: true } }, shift: { select: { id: true, code: true } }, cashAccount: { select: { id: true, code: true, name: true } }, category: { select: { id: true, name: true } } }, ...skipTake(q), orderBy: orderBy(q, ['paymentDate', 'createdAt', 'amount', 'code'], 'paymentDate') }),
      this.prisma.db.payment.count({ where }),
    ]);
    const parties = await this.partyMap(rows);
    return paginated(rows.map((r) => ({ ...r, party: r.partyId ? parties.get(`${r.partyType}:${r.partyId}`) ?? null : null })), total, q);
  }

  async get(user: RequestUser, id: string) {
    const p = await this.prisma.db.payment.findFirst({ where: { id, ...this.access.branchWhere(user) }, include: { allocations: true, branch: { select: { id: true, name: true } }, shift: { select: { id: true, code: true } }, cashAccount: { select: { id: true, code: true, name: true } }, category: { select: { id: true, name: true } } } });
    if (!p) throw Errors.notFound('Phiếu thu/chi', id);
    const parties = await this.partyMap([p]);
    const docs = await Promise.all(p.allocations.map(async (a) => {
      if (a.documentType === 'PURCHASE_RECEIPT') { const d = await this.prisma.db.purchaseReceipt.findFirst({ where: { id: a.documentId }, select: { id: true, code: true, totalAmount: true, paidAmount: true } }); return { ...a, document: d }; }
      if (a.documentType === 'PURCHASE_RETURN') { const d = await this.prisma.db.purchaseReturn.findFirst({ where: { id: a.documentId }, select: { id: true, code: true, totalAmount: true, refundedAmount: true } }); return { ...a, document: d }; }
      if (a.documentType === 'INVOICE') { const d = await this.prisma.db.invoice.findFirst({ where: { id: a.documentId }, select: { id: true, code: true, totalAmount: true, paidAmount: true } }); return { ...a, document: d }; }
      if (a.documentType === 'SALES_RETURN') { const d = await this.prisma.db.salesReturn.findFirst({ where: { id: a.documentId }, select: { id: true, code: true, totalRefund: true, refundedAmount: true } }); return { ...a, document: d }; }
      return { ...a, document: null };
    }));
    return { ...p, party: p.partyId ? parties.get(`${p.partyType}:${p.partyId}`) ?? null : null, allocations: docs };
  }

  private async partyMap(rows: Array<{ partyType: PartyType | null; partyId: string | null }>) {
    const supplierIds = rows.filter((r) => r.partyType === 'SUPPLIER' && r.partyId).map((r) => r.partyId!);
    const customerIds = rows.filter((r) => r.partyType === 'CUSTOMER' && r.partyId).map((r) => r.partyId!);
    const [suppliers, customers] = await Promise.all([
      supplierIds.length ? this.prisma.db.supplier.findMany({ where: { id: { in: supplierIds } }, select: { id: true, code: true, name: true } }) : [],
      customerIds.length ? this.prisma.db.customer.findMany({ where: { id: { in: customerIds } }, select: { id: true, code: true, name: true } }) : [],
    ]);
    return new Map<string, { id: string; code: string; name: string }>([...suppliers.map((s) => [`SUPPLIER:${s.id}`, s] as const), ...customers.map((c) => [`CUSTOMER:${c.id}`, c] as const)]);
  }

  async create(user: RequestUser, dto: CreatePaymentDto) {
    return this.prisma.tx(async (tx) => this.createInTx(tx, user, {
      branchId: dto.branchId, direction: dto.direction, method: (dto.method ?? 'CASH') as PaymentMethod, partyType: dto.partyType, partyId: dto.partyId,
      // vouchers taken at the counter while a shift is open belong to that shift (BR-56); FOR SHARE blocks a concurrent close
      shiftId: (await tx.$queryRaw<{ id: string }[]>`SELECT id FROM shifts WHERE tenant_id = ${user.tenantId}::uuid AND branch_id = ${dto.branchId}::uuid AND user_id = ${user.id}::uuid AND status = 'OPEN' FOR SHARE`)[0]?.id ?? null,
      amount: money(dto.amount), paymentDate: dto.paymentDate ? new Date(dto.paymentDate) : undefined, reference: dto.reference, note: dto.note,
      cashAccountId: dto.cashAccountId, categoryId: dto.categoryId,
      allocations: dto.allocations?.map((a) => ({ documentType: a.documentType as AllocationDocType, documentId: a.documentId, amount: money(a.amount) })),
    }));
  }

  /** Takes the next PT/PC code; callers that will hold other locks before calling createInTx fetch it first (lock order). */
  nextCode(tx: TxClient, direction: PaymentDirection) {
    return this.numbering.next(tx, direction === 'OUT' ? 'CASH_PAYMENT' : 'CASH_RECEIPT');
  }

  /** Creates and posts a payment inside the caller's transaction (also used by receipt/return/invoice "pay now"). */
  async createInTx(tx: TxClient, user: RequestUser, p: PaymentInput) {
    if (!p.permissionChecked && !hasPermission(user.permissions, 'payment.create')) throw Errors.forbidden('Thiếu quyền: payment.create');
    if ((p.method === 'OFFSET' || p.method === 'TRANSFER' || p.method === 'POINTS') && !p.allowOffset) throw Errors.validation('Phương thức cấn trừ / chuyển quỹ / điểm chỉ do hệ thống tạo');
    this.access.assertBranch(user, p.branchId);
    const branch = await tx.branch.findFirst({ where: { id: p.branchId, isActive: true } });
    if (!branch) throw Errors.notFound('Chi nhánh', p.branchId);
    if (!p.amount.greaterThan(0)) throw Errors.validation('Số tiền phải lớn hơn 0');
    const partyType = p.partyType ?? null;
    const partyId = partyType ? p.partyId ?? null : null;
    if (partyType && !partyId) throw Errors.validation('Thiếu đối tác');
    if (partyType === 'SUPPLIER') {
      if (!(await tx.supplier.findFirst({ where: { id: partyId! } }))) throw Errors.notFound('Nhà cung cấp', partyId!);
    } else if (partyType === 'CUSTOMER') {
      if (!(await tx.customer.findFirst({ where: { id: partyId! } }))) throw Errors.notFound('Khách hàng', partyId!);
    }

    // merge duplicates and lock documents in a deterministic order so concurrent payments cannot deadlock
    const merged = new Map<string, { documentType: AllocationDocType; documentId: string; amount: Prisma.Decimal }>();
    for (const a of p.allocations ?? []) {
      if (!a.amount.greaterThan(0)) throw Errors.validation('Số tiền phân bổ phải lớn hơn 0');
      const key = `${a.documentType}:${a.documentId}`;
      const prev = merged.get(key);
      merged.set(key, prev ? { ...prev, amount: prev.amount.plus(a.amount) } : { ...a });
    }
    const allocations = Array.from(merged.values()).sort((a, b) => (a.documentId < b.documentId ? -1 : a.documentId > b.documentId ? 1 : 0));
    const allocated = allocations.reduce((s, a) => s.plus(a.amount), ZERO);
    if (allocated.greaterThan(p.amount)) throw Errors.validation('Tổng phân bổ vượt quá số tiền phiếu', { amount: p.amount.toString(), allocated: allocated.toString() });
    // a voucher without a party is either fully allocated to documents, a system leg (transfer/offset), or an "other income/expense" with a category
    let category: { id: string } | null = null;
    if (p.categoryId) {
      if (!p.permissionChecked && !hasPermission(user.permissions, 'payment.other')) throw Errors.forbidden('Thiếu quyền: payment.other');
      const c = await tx.paymentCategory.findFirst({ where: { id: p.categoryId, isActive: true } });
      if (!c) throw Errors.notFound('Loại thu/chi', p.categoryId);
      if (c.direction !== p.direction) throw Errors.validation('Loại thu/chi không khớp chiều phiếu', { categoryId: p.categoryId });
      category = c;
    }
    if (!partyType && allocated.lessThan(p.amount) && !category && !p.allowOffset) throw Errors.validation('Phiếu không có đối tác phải được phân bổ hết vào chứng từ hoặc chọn loại thu/chi');
    const cashAccountId = p.method === 'OFFSET' || p.method === 'POINTS' ? null : await this.resolveCashAccount(tx, p.branchId, p.method ?? 'CASH', p.cashAccountId ?? null);

    for (const a of allocations) {
      if (a.documentType === 'PURCHASE_RECEIPT') {
        if (partyType !== 'SUPPLIER' || p.direction !== 'OUT') throw Errors.validation('Phiếu nhập hàng chỉ nhận phiếu chi cho nhà cung cấp');
        await tx.$queryRaw`SELECT id FROM purchase_receipts WHERE id = ${a.documentId}::uuid AND tenant_id = ${user.tenantId}::uuid FOR UPDATE`;
        const r = await tx.purchaseReceipt.findFirst({ where: { id: a.documentId } });
        if (!r) throw Errors.notFound('Phiếu nhập hàng', a.documentId);
        this.access.assertBranch(user, r.branchId);
        if (r.supplierId !== partyId) throw Errors.validation('Phiếu nhập không thuộc nhà cung cấp này', { documentId: a.documentId });
        if (r.status !== 'POSTED') throw Errors.conflict('DOCUMENT_NOT_POSTED', 'Chỉ thanh toán cho phiếu nhập đã hoàn thành', { code: r.code });
        const due = D(r.totalAmount).minus(D(r.paidAmount));
        if (a.amount.greaterThan(due)) throw Errors.conflict('OVERPAYMENT', `Phiếu ${r.code} chỉ còn nợ ${due.toString()}`, { documentId: a.documentId, due: due.toString(), requested: a.amount.toString() });
        await tx.purchaseReceipt.update({ where: { id: r.id }, data: { paidAmount: D(r.paidAmount).plus(a.amount) } });
      } else if (a.documentType === 'PURCHASE_RETURN') {
        if (partyType !== 'SUPPLIER' || p.direction !== 'IN') throw Errors.validation('Phiếu trả hàng nhập chỉ nhận phiếu thu từ nhà cung cấp');
        await tx.$queryRaw`SELECT id FROM purchase_returns WHERE id = ${a.documentId}::uuid AND tenant_id = ${user.tenantId}::uuid FOR UPDATE`;
        const r = await tx.purchaseReturn.findFirst({ where: { id: a.documentId } });
        if (!r) throw Errors.notFound('Phiếu trả hàng nhập', a.documentId);
        this.access.assertBranch(user, r.branchId);
        if (r.supplierId !== partyId) throw Errors.validation('Phiếu trả hàng không thuộc nhà cung cấp này', { documentId: a.documentId });
        if (r.status !== 'POSTED') throw Errors.conflict('DOCUMENT_NOT_POSTED', 'Chỉ nhận hoàn tiền cho phiếu trả hàng đã hoàn thành', { code: r.code });
        const due = D(r.totalAmount).minus(D(r.refundedAmount));
        if (a.amount.greaterThan(due)) throw Errors.conflict('OVERPAYMENT', `Phiếu ${r.code} chỉ còn ${due.toString()} chưa hoàn`, { documentId: a.documentId, due: due.toString(), requested: a.amount.toString() });
        await tx.purchaseReturn.update({ where: { id: r.id }, data: { refundedAmount: D(r.refundedAmount).plus(a.amount) } });
      } else if (a.documentType === 'SALES_RETURN') {
        if (p.direction !== 'OUT') throw Errors.validation('Phiếu trả hàng bán chỉ nhận phiếu chi (hoàn tiền)');
        await tx.$queryRaw`SELECT id FROM sales_returns WHERE id = ${a.documentId}::uuid AND tenant_id = ${user.tenantId}::uuid FOR UPDATE`;
        const r = await tx.salesReturn.findFirst({ where: { id: a.documentId } });
        if (!r) throw Errors.notFound('Phiếu trả hàng', a.documentId);
        this.access.assertBranch(user, r.branchId);
        if (r.status !== 'COMPLETED') throw Errors.conflict('DOCUMENT_NOT_POSTED', 'Chỉ hoàn tiền cho phiếu trả hàng đã hoàn thành', { code: r.code });
        if (r.customerId) { if (partyType !== 'CUSTOMER' || partyId !== r.customerId) throw Errors.validation('Phiếu trả hàng không thuộc khách hàng này', { documentId: a.documentId }); }
        else if (partyType) throw Errors.validation('Phiếu trả hàng khách lẻ không gắn với khách hàng', { documentId: a.documentId });
        const due = D(r.totalRefund).minus(D(r.refundedAmount));
        if (a.amount.greaterThan(due)) throw Errors.conflict('OVERPAYMENT', `Phiếu ${r.code} chỉ còn ${due.toString()} chưa hoàn`, { documentId: a.documentId, due: due.toString(), requested: a.amount.toString() });
        await tx.salesReturn.update({ where: { id: r.id }, data: { refundedAmount: D(r.refundedAmount).plus(a.amount) } });
      } else if (a.documentType === 'SALES_ORDER') {
        // deposit (tiền cọc) on an order: counted on the order until it becomes an invoice (BR-103)
        if (p.direction !== 'IN') throw Errors.validation('Đơn đặt hàng chỉ nhận phiếu thu (tiền cọc)');
        await tx.$queryRaw`SELECT id FROM sales_orders WHERE id = ${a.documentId}::uuid AND tenant_id = ${user.tenantId}::uuid FOR UPDATE`;
        const o = await tx.salesOrder.findFirst({ where: { id: a.documentId } });
        if (!o) throw Errors.notFound('Đơn đặt hàng', a.documentId);
        this.access.assertBranch(user, o.branchId);
        if (o.status !== 'DRAFT' && o.status !== 'CONFIRMED') throw Errors.conflict('DOCUMENT_NOT_POSTED', 'Chỉ nhận cọc cho đơn đang xử lý', { code: o.code });
        if (o.customerId) { if (partyType !== 'CUSTOMER' || partyId !== o.customerId) throw Errors.validation('Đơn đặt hàng không thuộc khách hàng này', { documentId: a.documentId }); }
        else if (partyType) throw Errors.validation('Đơn đặt hàng khách lẻ không gắn với khách hàng', { documentId: a.documentId });
        const due = D(o.totalAmount).minus(D(o.depositAmount));
        if (a.amount.greaterThan(due)) throw Errors.conflict('OVERPAYMENT', `Đơn ${o.code} chỉ còn ${due.toString()} chưa cọc`, { documentId: a.documentId, due: due.toString(), requested: a.amount.toString() });
        await tx.salesOrder.update({ where: { id: o.id }, data: { depositAmount: D(o.depositAmount).plus(a.amount) } });
      } else {
        if (p.direction !== 'IN') throw Errors.validation('Hóa đơn chỉ nhận phiếu thu');
        await tx.$queryRaw`SELECT id FROM invoices WHERE id = ${a.documentId}::uuid AND tenant_id = ${user.tenantId}::uuid FOR UPDATE`;
        const inv = await tx.invoice.findFirst({ where: { id: a.documentId } });
        if (!inv) throw Errors.notFound('Hóa đơn', a.documentId);
        this.access.assertBranch(user, inv.branchId);
        if (inv.status !== 'COMPLETED') throw Errors.conflict('DOCUMENT_NOT_POSTED', 'Chỉ thu tiền cho hóa đơn đã hoàn thành', { code: inv.code });
        if (inv.customerId) { if (partyType !== 'CUSTOMER' || partyId !== inv.customerId) throw Errors.validation('Hóa đơn không thuộc khách hàng này', { documentId: a.documentId }); }
        else if (partyType) throw Errors.validation('Hóa đơn khách lẻ không gắn với khách hàng', { documentId: a.documentId });
        const due = D(inv.totalAmount).minus(D(inv.paidAmount));
        if (a.amount.greaterThan(due)) throw Errors.conflict('OVERPAYMENT', `Hóa đơn ${inv.code} chỉ còn nợ ${due.toString()}`, { documentId: a.documentId, due: due.toString(), requested: a.amount.toString() });
        await tx.invoice.update({ where: { id: inv.id }, data: { paidAmount: D(inv.paidAmount).plus(a.amount) } });
      }
    }

    const code = p.code ?? (await this.nextCode(tx, p.direction));
    const payment = await tx.payment.create({
      data: {
        tenantId: user.tenantId, branchId: p.branchId, code, direction: p.direction, method: p.method ?? 'CASH', partyType, partyId, shiftId: p.shiftId ?? null,
        cashAccountId, categoryId: category?.id ?? null, transferId: p.transferId ?? null,
        amount: p.amount, allocated, paymentDate: p.paymentDate ?? new Date(), reference: p.reference ?? null, note: p.note ?? null, createdById: user.id,
        allocations: { create: allocations.map((a) => ({ tenantId: user.tenantId, documentType: a.documentType, documentId: a.documentId, amount: a.amount })) },
      },
      include: { allocations: true },
    });
    if (partyType && partyId) {
      const signed = partyType === 'SUPPLIER' ? (p.direction === 'OUT' ? p.amount.negated() : p.amount) : (p.direction === 'IN' ? p.amount.negated() : p.amount);
      const type: LedgerEntryType = partyType === 'SUPPLIER' ? (p.direction === 'OUT' ? 'PAYMENT' : 'REFUND') : (p.direction === 'IN' ? 'RECEIPT' : 'REFUND');
      await this.ledger.post(tx, { tenantId: user.tenantId, partyType, partyId, branchId: p.branchId, type, amount: signed, documentType: 'PAYMENT', documentId: payment.id, documentCode: code, note: p.note, userId: user.id });
    }
    if (cashAccountId) await this.applyCashBalance(tx, user.tenantId, cashAccountId, p.direction === 'IN' ? p.amount : p.amount.negated());
    await this.audit.log(tx, { action: 'payment.create', entityType: 'Payment', entityId: payment.id, entityCode: code, after: { direction: p.direction, method: p.method ?? 'CASH', amount: p.amount.toString(), partyType, partyId, cashAccountId, categoryId: category?.id ?? null, allocations: allocations.length } });
    await this.outbox.enqueue(tx, { eventType: 'payment.created', aggregateType: 'Payment', aggregateId: payment.id, payload: { code, direction: p.direction, amount: p.amount.toString(), partyType, partyId } });
    return payment;
  }

  async cancel(user: RequestUser, id: string, reason: string) {
    if (!hasPermission(user.permissions, 'payment.cancel')) throw Errors.forbidden('Thiếu quyền: payment.cancel');
    return this.prisma.tx((tx) => this.cancelInTx(tx, user, id, reason, { publicApi: true }));
  }

  /** Cancels a posted payment: undoes allocations, reverses the ledger (also used when an invoice is cancelled). */
  async cancelInTx(tx: TxClient, user: RequestUser, id: string, reason: string, opts: { onlyDocument?: { type: AllocationDocType; id: string }; viaTransfer?: boolean; publicApi?: boolean } = {}) {
    const rows = await tx.$queryRaw<{ id: string }[]>`SELECT id FROM payments WHERE id = ${id}::uuid AND tenant_id = ${user.tenantId}::uuid FOR UPDATE`;
    if (!rows[0]) throw Errors.notFound('Phiếu thu/chi', id);
    const p = await tx.payment.findFirstOrThrow({ where: { id }, include: { allocations: true } });
    this.access.assertBranch(user, p.branchId);
    if (p.status !== 'POSTED') throw Errors.conflict('PAYMENT_NOT_POSTED', 'Phiếu đã bị hủy trước đó');
    // system pairs are only undone through their source document (exchange invoice cancel, debt-offset cancel, transfer cancel)
    if (opts.publicApi && (p.method === 'OFFSET' || p.method === 'POINTS')) throw Errors.conflict('PAYMENT_IS_OFFSET', 'Phiếu cấn trừ / thanh toán bằng điểm chỉ hủy được theo chứng từ gốc', { paymentId: id, code: p.code });
    if (p.transferId && !opts.viaTransfer) throw Errors.conflict('PAYMENT_IS_TRANSFER', 'Phiếu thuộc một lần chuyển quỹ; hãy hủy phiếu chuyển quỹ', { transferId: p.transferId });
    if (opts.onlyDocument) {
      const foreign = p.allocations.some((a) => a.documentType !== opts.onlyDocument!.type || a.documentId !== opts.onlyDocument!.id);
      const fullyAllocated = D(p.allocated).equals(D(p.amount));
      if (foreign || !fullyAllocated) throw Errors.conflict('PAYMENT_SHARED', `Phiếu ${p.code} còn phân bổ cho chứng từ khác hoặc có phần trả trước, hãy hủy phiếu thu/chi thủ công`, { paymentId: id, code: p.code });
    }
    const allocations = [...p.allocations].sort((a, b) => (a.documentId < b.documentId ? -1 : a.documentId > b.documentId ? 1 : 0));
    for (const a of allocations) {
      if (a.documentType === 'PURCHASE_RECEIPT') {
        await tx.$queryRaw`SELECT id FROM purchase_receipts WHERE id = ${a.documentId}::uuid AND tenant_id = ${user.tenantId}::uuid FOR UPDATE`;
        const r = await tx.purchaseReceipt.findFirstOrThrow({ where: { id: a.documentId } });
        this.access.assertBranch(user, r.branchId);
        await tx.purchaseReceipt.update({ where: { id: a.documentId }, data: { paidAmount: { decrement: a.amount } } });
      } else if (a.documentType === 'PURCHASE_RETURN') {
        await tx.$queryRaw`SELECT id FROM purchase_returns WHERE id = ${a.documentId}::uuid AND tenant_id = ${user.tenantId}::uuid FOR UPDATE`;
        const r = await tx.purchaseReturn.findFirstOrThrow({ where: { id: a.documentId } });
        this.access.assertBranch(user, r.branchId);
        await tx.purchaseReturn.update({ where: { id: a.documentId }, data: { refundedAmount: { decrement: a.amount } } });
      } else if (a.documentType === 'INVOICE') {
        await tx.$queryRaw`SELECT id FROM invoices WHERE id = ${a.documentId}::uuid AND tenant_id = ${user.tenantId}::uuid FOR UPDATE`;
        const inv = await tx.invoice.findFirstOrThrow({ where: { id: a.documentId } });
        this.access.assertBranch(user, inv.branchId);
        await tx.invoice.update({ where: { id: a.documentId }, data: { paidAmount: { decrement: a.amount } } });
      } else if (a.documentType === 'SALES_RETURN') {
        await tx.$queryRaw`SELECT id FROM sales_returns WHERE id = ${a.documentId}::uuid AND tenant_id = ${user.tenantId}::uuid FOR UPDATE`;
        const r = await tx.salesReturn.findFirstOrThrow({ where: { id: a.documentId } });
        this.access.assertBranch(user, r.branchId);
        await tx.salesReturn.update({ where: { id: a.documentId }, data: { refundedAmount: { decrement: a.amount } } });
      } else if (a.documentType === 'SALES_ORDER') {
        await tx.$queryRaw`SELECT id FROM sales_orders WHERE id = ${a.documentId}::uuid AND tenant_id = ${user.tenantId}::uuid FOR UPDATE`;
        const o = await tx.salesOrder.findFirstOrThrow({ where: { id: a.documentId } });
        this.access.assertBranch(user, o.branchId);
        await tx.salesOrder.update({ where: { id: a.documentId }, data: { depositAmount: { decrement: a.amount } } });
      }
    }
    await this.ledger.reverseDocument(tx, user.tenantId, 'PAYMENT', p.id, p.code, `Hủy phiếu: ${reason}`, user.id);
    if (p.cashAccountId) await this.applyCashBalance(tx, user.tenantId, p.cashAccountId, p.direction === 'IN' ? D(p.amount).negated() : D(p.amount));
    const cancelled = await tx.payment.update({ where: { id }, data: { status: 'CANCELLED', cancelledAt: new Date(), cancelReason: reason }, include: { allocations: true } });
    await this.audit.log(tx, { action: 'payment.cancel', entityType: 'Payment', entityId: id, entityCode: p.code, before: { status: 'POSTED' }, after: { status: 'CANCELLED', reason } });
    await this.outbox.enqueue(tx, { eventType: 'payment.cancelled', aggregateType: 'Payment', aggregateId: id, payload: { code: p.code, reason } });
    return cancelled;
  }

  /**
   * Quỹ tiền for a voucher (BR-70): explicit account (must be active and belong to the branch or be tenant-wide),
   * else the branch's default CASH drawer for cash, else the default BANK/EWALLET fund for electronic methods.
   */
  async resolveCashAccount(tx: TxClient, branchId: string, method: PaymentMethod, explicitId: string | null): Promise<string | null> {
    if (explicitId) {
      const acc = await tx.cashAccount.findFirst({ where: { id: explicitId, isActive: true } });
      if (!acc) throw Errors.notFound('Quỹ tiền', explicitId);
      if (acc.branchId && acc.branchId !== branchId) throw Errors.validation('Quỹ tiền không thuộc chi nhánh của phiếu', { cashAccountId: explicitId });
      return acc.id;
    }
    const type = method === 'CASH' ? 'CASH' : method === 'EWALLET' ? 'EWALLET' : method === 'BANK_TRANSFER' || method === 'CARD' ? 'BANK' : null;
    if (!type) return null;
    const pick = async (where: Prisma.CashAccountWhereInput) => (await tx.cashAccount.findFirst({ where: { isActive: true, ...where }, orderBy: [{ isDefault: 'desc' }, { createdAt: 'asc' }] }))?.id ?? null;
    return (await pick({ type, branchId })) ?? (await pick({ type, branchId: null })) ?? (type === 'EWALLET' ? (await pick({ type: 'BANK', branchId })) ?? (await pick({ type: 'BANK', branchId: null })) : null);
  }

  /** Adjusts a fund balance under its row lock (positive = money in). */
  async applyCashBalance(tx: TxClient, tenantId: string, accountId: string, delta: Prisma.Decimal) {
    // NO KEY UPDATE: payment rows inserted by other transactions hold FOR KEY SHARE on the fund (FK) before they reach the party lock;
    // a plain FOR UPDATE here would deadlock against them (same reasoning as the variant lock in the stock engine, BR-48)
    const rows = await tx.$queryRaw<{ balance: Prisma.Decimal }[]>`SELECT balance FROM cash_accounts WHERE id = ${accountId}::uuid AND tenant_id = ${tenantId}::uuid FOR NO KEY UPDATE`;
    if (!rows[0]) throw Errors.notFound('Quỹ tiền', accountId);
    const next = D(rows[0].balance).plus(delta);
    if (next.isNegative() && delta.isNegative()) {
      // BR-70: a fund may only go below zero when the tenant allows it (default: allowed, like KiotViet's running cash book)
      const setting = await tx.tenantSetting.findFirst({ where: { key: TENANT_SETTING_KEYS.CASH_ALLOW_NEGATIVE } });
      if (setting && setting.value === false) throw Errors.conflict('CASH_INSUFFICIENT', 'Quỹ tiền không đủ số dư cho phiếu chi này', { accountId, balance: rows[0].balance.toString(), requested: delta.abs().toString() });
    }
    await tx.$executeRaw`UPDATE cash_accounts SET balance = ${next.toString()}::numeric, updated_at = now() WHERE id = ${accountId}::uuid AND tenant_id = ${tenantId}::uuid`;
    return next;
  }

  /** BR-41 reconciliation of cached party balances against the ledger (owner / admin only). */
  async reconcile(user: RequestUser) {
    const diffs = await this.ledger.reconcile(this.prisma.raw, user.tenantId);
    return { ok: diffs.length === 0, diffs, checkedAt: new Date() };
  }
}
