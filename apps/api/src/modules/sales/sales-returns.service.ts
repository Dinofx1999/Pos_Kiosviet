import { Injectable } from '@nestjs/common';
import { InvoiceStatus, PaymentMethod, Prisma, ReturnCondition } from '@prisma/client';
import { hasPermission, TENANT_SETTING_KEYS } from '@erp/shared';
import { Errors } from '../../common/errors/app-error';
import { orderBy, paginated, skipTake } from '../../common/pagination';
import { D, money, qty as toQty, ZERO } from '../../common/utils/decimal';
import { AccessService } from '../../infra/access/access.service';
import { AuditService } from '../../infra/audit/audit.service';
import { RequestUser } from '../../infra/cls/request-context';
import { NumberingService } from '../../infra/numbering/numbering.service';
import { OutboxService } from '../../infra/outbox/outbox.service';
import { PrismaService, TxClient } from '../../infra/prisma/prisma.service';
import { LedgerService } from '../finance/ledger.service';
import { LoyaltyService } from './loyalty.service';
import { PaymentsService } from '../finance/payments.service';
import { StockEngineService } from '../inventory/stock-engine.service';
import { allocate } from '../purchasing/purchase-calc';
import { CancelSalesReturnDto, CreateSalesReturnDto, ExchangeDto, RefundDto, ReturnLineDto, SalesReturnQueryDto, UpdateSalesReturnDto } from './dto/returns.dto';
import { InvoicesService } from './invoices.service';
import { ShiftsService } from './shifts.service';

const returnInclude = {
  customer: { select: { id: true, code: true, name: true, phone: true } },
  invoice: { select: { id: true, code: true, invoiceDate: true, totalAmount: true, customerId: true } },
  exchangeInvoice: { select: { id: true, code: true, totalAmount: true, paidAmount: true, status: true } },
  branch: { select: { id: true, code: true, name: true } },
  warehouse: { select: { id: true, code: true, name: true } },
  lines: { orderBy: { lineNo: 'asc' as const }, include: { variant: { select: { id: true, sku: true, barcode: true, name: true, product: { select: { id: true, code: true, name: true, type: true, baseUnit: true } } } }, invoiceLine: { select: { id: true, quantity: true, returnedQuantity: true, unitPrice: true, unitName: true, conversionFactor: true } } } },
} satisfies Prisma.SalesReturnInclude;

type InvoiceWithLines = Prisma.InvoiceGetPayload<{ include: { lines: true } }>;

interface NormalizedLine {
  invoiceLineId: string; variantId: string; batchId: string | null; unitName: string | null; conversionFactor: Prisma.Decimal; quantity: Prisma.Decimal; baseQuantity: Prisma.Decimal;
  unitPrice: Prisma.Decimal; lineTotal: Prisma.Decimal; condition: ReturnCondition; unitCost: Prisma.Decimal; costTotal: Prisma.Decimal; note: string | null; productType: string;
}

/** Trả hàng / đổi hàng bán (BR-60..BR-66). */
@Injectable()
export class SalesReturnsService {
  constructor(
    private readonly prisma: PrismaService, private readonly engine: StockEngineService, private readonly numbering: NumberingService,
    private readonly audit: AuditService, private readonly outbox: OutboxService, private readonly access: AccessService,
    private readonly ledger: LedgerService, private readonly payments: PaymentsService, private readonly invoices: InvoicesService, private readonly shifts: ShiftsService, private readonly loyalty: LoyaltyService,
  ) {}

  // ---------------------------------------------------------------- queries
  async list(user: RequestUser, q: SalesReturnQueryDto) {
    const filters: Prisma.SalesReturnWhereInput = {
      ...(q.status ? { status: q.status as InvoiceStatus } : {}),
      ...(q.branchId ? { branchId: q.branchId } : {}),
      ...(q.invoiceId ? { invoiceId: q.invoiceId } : {}),
      ...(q.customerId ? { customerId: q.customerId } : {}),
      ...(q.from || q.to ? { returnDate: { ...(q.from ? { gte: new Date(q.from) } : {}), ...(q.to ? { lte: new Date(q.to) } : {}) } } : {}),
      ...(q.search ? { OR: [{ code: { contains: q.search, mode: 'insensitive' } }, { invoice: { code: { contains: q.search, mode: 'insensitive' } } }, { customer: { OR: [{ name: { contains: q.search, mode: 'insensitive' } }, { phone: { contains: q.search } }] } }] } : {}),
    };
    const where: Prisma.SalesReturnWhereInput = { AND: [this.access.branchWhere(user), filters] };
    const [rows, total] = await Promise.all([
      this.prisma.db.salesReturn.findMany({ where, include: { customer: { select: { id: true, code: true, name: true } }, invoice: { select: { id: true, code: true } }, exchangeInvoice: { select: { id: true, code: true } }, branch: { select: { id: true, name: true } }, _count: { select: { lines: true } } }, ...skipTake(q), orderBy: orderBy(q, ['returnDate', 'createdAt', 'code', 'totalRefund', 'status'], 'returnDate') }),
      this.prisma.db.salesReturn.count({ where }),
    ]);
    const canCost = user.permissions.has('*') || user.permissions.has('sales.report.view');
    return paginated(rows.map((r) => ({ ...r, dueRefund: D(r.totalRefund).minus(D(r.refundedAmount)), restockValue: canCost ? r.restockValue : undefined, damagedValue: canCost ? r.damagedValue : undefined })), total, q);
  }

  async get(user: RequestUser, id: string) {
    const r = await this.prisma.db.salesReturn.findFirst({ where: { id, ...this.access.branchWhere(user) }, include: returnInclude });
    if (!r) throw Errors.notFound('Phiếu trả hàng', id);
    return this.decorate(this.prisma.db, user, r);
  }

  private async decorate(db: TxClient | PrismaService['db'], user: RequestUser, r: Prisma.SalesReturnGetPayload<{ include: typeof returnInclude }>) {
    const [allocations, movements] = await Promise.all([
      db.paymentAllocation.findMany({ where: { documentType: 'SALES_RETURN', documentId: r.id }, include: { payment: { select: { id: true, code: true, status: true, method: true, paymentDate: true, amount: true, reference: true } } } }),
      r.status === 'DRAFT' ? [] : db.stockMovement.findMany({ where: { documentType: 'SALES_RETURN', documentId: r.id }, orderBy: { createdAt: 'asc' } }),
    ]);
    const canCost = user.permissions.has('*') || user.permissions.has('sales.report.view');
    return {
      ...r, dueRefund: D(r.totalRefund).minus(D(r.refundedAmount)), restockValue: canCost ? r.restockValue : undefined, damagedValue: canCost ? r.damagedValue : undefined,
      lines: r.lines.map((l) => ({ ...l, unitCost: canCost ? l.unitCost : undefined, costTotal: canCost ? l.costTotal : undefined })),
      refunds: allocations.filter((a) => a.payment.status === 'POSTED'), movements: canCost ? movements : undefined,
    };
  }

  /** Returnable lines of an invoice with the per-unit paid amount (default refund price). */
  async returnableLines(user: RequestUser, invoiceId: string) {
    const inv = await this.prisma.db.invoice.findFirst({ where: { id: invoiceId, ...this.access.branchWhere(user) }, include: { lines: { orderBy: { lineNo: 'asc' }, include: { variant: { select: { id: true, sku: true, name: true, product: { select: { code: true, name: true, type: true, baseUnit: true } } } } } }, customer: { select: { id: true, code: true, name: true, phone: true } } } });
    if (!inv) throw Errors.notFound('Hóa đơn', invoiceId);
    if (inv.status !== 'COMPLETED') throw Errors.conflict('DOCUMENT_NOT_POSTED', 'Chỉ trả hàng cho hóa đơn đã hoàn thành', { status: inv.status });
    const paid = await this.paidPerUnit(this.prisma.db, inv);
    return {
      invoice: { id: inv.id, code: inv.code, invoiceDate: inv.invoiceDate, totalAmount: inv.totalAmount, returnedAmount: inv.returnedAmount, customer: inv.customer, branchId: inv.branchId, warehouseId: inv.warehouseId },
      lines: inv.lines.map((l) => ({ ...l, unitCost: undefined, costTotal: undefined, returnableQuantity: D(l.quantity).minus(D(l.returnedQuantity)), refundUnitPrice: paid.get(l.id) ?? ZERO })),
      maxRefund: D(inv.totalAmount).minus(D(inv.returnedAmount)),
    };
  }

  // ---------------------------------------------------------------- drafts
  async create(user: RequestUser, dto: CreateSalesReturnDto) {
    return this.prisma.tx(async (tx) => this.decorate(tx, user, await this.createInTx(tx, user, dto)));
  }

  private async createInTx(tx: TxClient, user: RequestUser, dto: CreateSalesReturnDto, allowRefund = false) {
    if (!allowRefund && dto.refund) throw Errors.validation('Phiếu nháp không nhận hoàn tiền; dùng complete-now hoặc complete');
    const inv = await tx.invoice.findFirst({ where: { id: dto.invoiceId }, include: { lines: true } });
    if (!inv) throw Errors.notFound('Hóa đơn', dto.invoiceId);
    this.access.assertBranch(user, inv.branchId);
    await this.access.assertWarehouse(user, inv.warehouseId, inv.branchId, tx);
    if (inv.status !== 'COMPLETED') throw Errors.conflict('DOCUMENT_NOT_POSTED', 'Chỉ trả hàng cho hóa đơn đã hoàn thành', { status: inv.status });
    await this.assertReturnWindow(tx, inv);
    const lines = await this.normalizeLines(tx, user, inv, dto.lines);
    const totals = this.totals(lines, money(dto.feeAmount ?? 0));
    const code = await this.numbering.next(tx, 'SALES_RETURN');
    const r = await tx.salesReturn.create({
      data: {
        tenantId: user.tenantId, branchId: inv.branchId, warehouseId: inv.warehouseId, invoiceId: inv.id, customerId: inv.customerId, code,
        returnDate: dto.returnDate ? new Date(dto.returnDate) : new Date(), reason: dto.reason, note: dto.note, createdById: user.id, ...totals,
        lines: { create: lines.map((l, i) => ({ tenantId: user.tenantId, lineNo: i + 1, invoiceLineId: l.invoiceLineId, variantId: l.variantId, batchId: l.batchId, unitName: l.unitName, conversionFactor: l.conversionFactor, quantity: l.quantity, baseQuantity: l.baseQuantity, unitPrice: l.unitPrice, lineTotal: l.lineTotal, condition: l.condition, unitCost: l.unitCost, costTotal: l.costTotal, note: l.note })) },
      },
      include: returnInclude,
    });
    await this.audit.log(tx, { action: 'sales.return.create', entityType: 'SalesReturn', entityId: r.id, entityCode: code, after: { invoiceId: inv.id, lines: lines.length, totalRefund: totals.totalRefund.toString() } });
    return r;
  }

  async update(user: RequestUser, id: string, dto: UpdateSalesReturnDto) {
    return this.prisma.tx(async (tx) => {
      const r = await this.lock(tx, user, id);
      if (r.status !== 'DRAFT') throw Errors.conflict('DOCUMENT_NOT_EDITABLE', 'Chỉ sửa được phiếu nháp', { status: r.status });
      if (r.version !== dto.version) throw Errors.conflict('VERSION_CONFLICT', 'Phiếu đã được người khác thay đổi, vui lòng tải lại', { current: r.version });
      const inv = await tx.invoice.findFirstOrThrow({ where: { id: r.invoiceId }, include: { lines: true } });
      const existing = await tx.salesReturnLine.findMany({ where: { returnId: id }, orderBy: { lineNo: 'asc' } });
      const input: ReturnLineDto[] = dto.lines ?? existing.map((l) => ({ invoiceLineId: l.invoiceLineId, quantity: l.quantity.toString(), unitPrice: l.unitPrice.toString(), condition: l.condition, note: l.note ?? undefined }));
      const lines = await this.normalizeLines(tx, user, inv, input, dto.lines ? undefined : existing.map((l) => D(l.unitPrice)));
      const totals = this.totals(lines, money(dto.feeAmount ?? r.feeAmount));
      const after = await tx.salesReturn.update({
        where: { id },
        data: {
          returnDate: dto.returnDate ? new Date(dto.returnDate) : undefined, reason: dto.reason, note: dto.note, version: { increment: 1 }, ...totals,
          lines: { deleteMany: {}, create: lines.map((l, i) => ({ tenantId: user.tenantId, lineNo: i + 1, invoiceLineId: l.invoiceLineId, variantId: l.variantId, batchId: l.batchId, unitName: l.unitName, conversionFactor: l.conversionFactor, quantity: l.quantity, baseQuantity: l.baseQuantity, unitPrice: l.unitPrice, lineTotal: l.lineTotal, condition: l.condition, unitCost: l.unitCost, costTotal: l.costTotal, note: l.note })) },
        },
        include: returnInclude,
      });
      await this.audit.log(tx, { action: 'sales.return.update', entityType: 'SalesReturn', entityId: id, entityCode: r.code, before: { version: r.version }, after: { version: after.version, totalRefund: after.totalRefund } });
      return this.decorate(tx, user, after);
    });
  }

  async remove(user: RequestUser, id: string) {
    await this.prisma.tx(async (tx) => {
      const r = await this.lock(tx, user, id);
      if (r.status !== 'DRAFT') throw Errors.conflict('DOCUMENT_NOT_EDITABLE', 'Chỉ xóa được phiếu nháp', { status: r.status });
      await tx.salesReturn.delete({ where: { id } });
      await this.audit.log(tx, { action: 'sales.return.delete', entityType: 'SalesReturn', entityId: id, entityCode: r.code });
    });
  }

  // ---------------------------------------------------------------- complete (BR-62)
  async completeNow(user: RequestUser, dto: CreateSalesReturnDto) {
    return this.prisma.tx(async (tx) => {
      const r = await this.createInTx(tx, user, dto, true);
      return this.decorate(tx, user, await this.completeInTx(tx, user, r.id, dto.refund, undefined));
    });
  }

  async complete(user: RequestUser, id: string, refund?: RefundDto, version?: number) {
    return this.prisma.tx(async (tx) => this.decorate(tx, user, await this.completeInTx(tx, user, id, refund, version)));
  }

  /**
   * Lock order: return → original invoice → sequences (refund code) → stock (restocked lines) → party balance.
   * `opts.exchange` skips the walk-in "must refund in full" rule because the exchange settles with an OFFSET voucher.
   */
  private async completeInTx(tx: TxClient, user: RequestUser, id: string, refund: RefundDto | undefined, expectedVersion: number | undefined, opts: { exchange?: boolean; refundCode?: string } = {}) {
    const r = await this.lock(tx, user, id);
    if (r.status !== 'DRAFT') throw Errors.conflict('DOCUMENT_NOT_DRAFT', 'Phiếu không ở trạng thái nháp', { status: r.status });
    if (expectedVersion !== undefined && r.version !== expectedVersion) throw Errors.conflict('VERSION_CONFLICT', 'Phiếu đã được thay đổi ở nơi khác, vui lòng tải lại', { current: r.version });
    const inv = await this.invoices.lock(tx, user, r.invoiceId);
    if (inv.status !== 'COMPLETED') throw Errors.conflict('DOCUMENT_NOT_POSTED', 'Hóa đơn gốc không còn hiệu lực', { status: inv.status });
    await this.assertReturnWindow(tx, inv);
    const shiftId = await this.shifts.openShiftId(tx, user, r.branchId);
    const refundAmount = refund ? money(refund.amount) : ZERO;
    if (refund && !hasPermission(user.permissions, 'payment.create') && !hasPermission(user.permissions, 'return.complete')) throw Errors.forbidden('Thiếu quyền hoàn tiền');
    if ((refundAmount.greaterThan(0) || opts.exchange) && !shiftId && (await this.invoices.settings(tx)).requireShift) throw Errors.conflict('SHIFT_REQUIRED', 'Bạn cần mở ca bán hàng trước khi hoàn tiền / đổi hàng');
    const refundCode = refund ? opts.refundCode ?? (await this.payments.nextCode(tx, 'OUT')) : undefined;

    const lines = await tx.salesReturnLine.findMany({ where: { returnId: id } });
    const invLines = await tx.invoiceLine.findMany({ where: { invoiceId: inv.id } });
    const ilById = new Map(invLines.map((l) => [l.id, l]));
    // BR-61: never exceed sold − already returned, checked under the invoice lock; Σ refunds never exceed the invoice total
    const perLine = new Map<string, Prisma.Decimal>();
    for (const l of lines) perLine.set(l.invoiceLineId, (perLine.get(l.invoiceLineId) ?? ZERO).plus(D(l.quantity)));
    for (const [ilId, qty] of perLine) {
      const il = ilById.get(ilId);
      if (!il) throw Errors.validation('Dòng hóa đơn không tồn tại', { invoiceLineId: ilId });
      const returnable = D(il.quantity).minus(D(il.returnedQuantity));
      if (qty.greaterThan(returnable)) throw Errors.conflict('RETURN_QUANTITY_EXCEEDED', 'Số lượng trả vượt quá số lượng còn có thể trả', { invoiceLineId: ilId, returnable: returnable.toString(), requested: qty.toString() });
    }
    const totalRefund = D(r.totalRefund);
    if (D(inv.returnedAmount).plus(totalRefund).greaterThan(D(inv.totalAmount))) throw Errors.conflict('RETURN_AMOUNT_EXCEEDED', 'Tổng giá trị trả hàng vượt quá giá trị hóa đơn', { invoiceTotal: inv.totalAmount.toString(), alreadyReturned: inv.returnedAmount.toString(), requested: totalRefund.toString() });
    if (refundAmount.greaterThan(totalRefund)) throw Errors.conflict('OVERPAYMENT', 'Số tiền hoàn vượt quá giá trị phiếu trả', { totalRefund: totalRefund.toString(), requested: refundAmount.toString() });
    if (!inv.customerId && !opts.exchange && !refundAmount.equals(totalRefund)) throw Errors.validation('Khách lẻ không có công nợ: phải hoàn đủ tiền khi trả hàng', { totalRefund: totalRefund.toString(), refund: refundAmount.toString() });

    // stock (BR-63): RESTOCK lines come back exactly as they left — same variants (combo components included) at the
    // original SALE movement cost, pro-rated by the returned share; SERVICE lines have no movements; DAMAGED lines are written off
    const allowNegative = await this.engine.allowNegative(tx);
    const saleMoves = await tx.stockMovement.findMany({ where: { documentType: 'INVOICE', documentId: inv.id, type: 'SALE' } });
    const ops: Array<{ lineId: string; variantId: string; batchId: string | null; quantity: Prisma.Decimal; unitCost: Prisma.Decimal; note: string | null }> = [];
    const doneBase = new Map<string, Prisma.Decimal>(); // base units already returned per invoice line (earlier returns + earlier lines of this one, DAMAGED included)
    for (const l of [...lines].sort((a, b) => a.lineNo - b.lineNo)) {
      const il = ilById.get(l.invoiceLineId)!;
      const before = doneBase.get(il.id) ?? toQty(D(il.returnedQuantity).times(D(il.conversionFactor)));
      const after = before.plus(D(l.baseQuantity));
      doneBase.set(il.id, after);
      if (l.condition !== 'RESTOCK') continue;
      const sold = D(il.baseQuantity);
      for (const m of saleMoves.filter((x) => x.lineId === il.id)) {
        const abs = D(m.quantity).abs();
        const qty = toQty(abs.times(after).dividedBy(sold)).minus(toQty(abs.times(before).dividedBy(sold)));
        if (qty.greaterThan(0)) ops.push({ lineId: l.id, variantId: m.variantId, batchId: m.batchId, quantity: qty, unitCost: D(m.unitCost), note: l.note });
      }
    }
    ops.sort(StockEngineService.sortKey);
    let restockValue = ZERO; let damagedValue = ZERO;
    for (const op of ops) {
      const res = await this.engine.apply(tx, { tenantId: user.tenantId, warehouseId: r.warehouseId, variantId: op.variantId, batchId: op.batchId, quantity: op.quantity, unitCost: op.unitCost, type: 'SALE_RETURN', documentType: 'SALES_RETURN', documentId: r.id, documentCode: r.code, lineId: op.lineId, reason: r.reason, note: op.note, userId: user.id, allowNegative });
      restockValue = restockValue.plus(res.totalCost);
    }
    for (const l of lines) if (l.condition === 'DAMAGED') damagedValue = damagedValue.plus(D(l.costTotal));
    for (const [ilId, qty] of perLine) await tx.invoiceLine.update({ where: { id: ilId }, data: { returnedQuantity: { increment: qty } } });
    await tx.invoice.update({ where: { id: inv.id }, data: { returnedAmount: { increment: totalRefund } } });

    // customer ledger (BR-64): credit the customer; refund now reduces that credit through the voucher
    if (inv.customerId && totalRefund.greaterThan(0)) await this.ledger.post(tx, { tenantId: user.tenantId, partyType: 'CUSTOMER', partyId: inv.customerId, branchId: r.branchId, type: 'SALE_RETURN', amount: totalRefund.negated(), documentType: 'SALES_RETURN', documentId: r.id, documentCode: r.code, note: `Trả hàng hóa đơn ${inv.code}`, userId: user.id });
    // loyalty (BR-143): points earned on the returned share are taken back (may leave the balance negative)
    if (inv.customerId && D(inv.pointsEarned).greaterThan(0) && D(inv.totalAmount).greaterThan(0)) {
      const back = D(inv.pointsEarned).times(totalRefund).dividedBy(D(inv.totalAmount)).toDecimalPlaces(0, Prisma.Decimal.ROUND_DOWN);
      if (back.greaterThan(0)) await this.loyalty.post(tx, user, { customerId: inv.customerId, type: 'REVERSAL', points: back.negated(), documentType: 'SALES_RETURN', documentId: r.id, documentCode: r.code, note: `Trừ điểm do trả hàng ${inv.code}` });
    }
    await tx.salesReturn.update({ where: { id }, data: { status: 'COMPLETED', completedAt: new Date(), shiftId, restockValue, damagedValue, version: { increment: 1 } } });
    if (refund && refundAmount.greaterThan(0)) {
      await this.payments.createInTx(tx, user, { branchId: r.branchId, direction: 'OUT', method: refund.method as PaymentMethod, partyType: inv.customerId ? 'CUSTOMER' : null, partyId: inv.customerId, shiftId, amount: refundAmount, reference: refund.reference, note: `Hoàn tiền trả hàng ${r.code}`, allocations: [{ documentType: 'SALES_RETURN', documentId: r.id, amount: refundAmount }], code: refundCode, permissionChecked: true });
    }
    await this.audit.log(tx, { action: 'sales.return.complete', entityType: 'SalesReturn', entityId: id, entityCode: r.code, after: { status: 'COMPLETED', totalRefund: totalRefund.toString(), refunded: refundAmount.toString(), restockValue: restockValue.toString(), damagedValue: damagedValue.toString() } });
    await this.outbox.enqueue(tx, { eventType: 'sales.return.completed', aggregateType: 'SalesReturn', aggregateId: id, payload: { code: r.code, invoiceCode: inv.code, customerId: inv.customerId, totalRefund: totalRefund.toString() } });
    return tx.salesReturn.findFirstOrThrow({ where: { id }, include: returnInclude });
  }

  // ---------------------------------------------------------------- exchange (BR-65)
  async exchange(user: RequestUser, dto: ExchangeDto) {
    for (const perm of ['return.create', 'return.complete', 'invoice.create', 'invoice.complete']) if (!hasPermission(user.permissions, perm)) throw Errors.forbidden(`Thiếu quyền: ${perm}`);
    if (dto.return.refund) throw Errors.validation('Đổi hàng: phần hoàn lại ghi ở `refund` cấp ngoài, không ở phiếu trả');
    return this.prisma.tx(async (tx) => {
      const ret = await this.createInTx(tx, user, dto.return, true);
      // lock order: return (own row) → original invoice → sequences → stock → party; the lock inside completeInTx is then a no-op
      const inv = await this.invoices.lock(tx, user, ret.invoiceId);
      // pre-fetch every code before any stock/party lock (document → sequence → stock → party)
      const invoiceCode = await this.numbering.next(tx, 'INVOICE');
      const paymentCodes: string[] = [];
      for (let i = 0; i < (dto.payments?.length ?? 0); i++) paymentCodes.push(await this.payments.nextCode(tx, 'IN'));
      const offsetInCode = await this.payments.nextCode(tx, 'IN');
      const offsetOutCode = await this.payments.nextCode(tx, 'OUT');
      const refundCode = dto.refund ? await this.payments.nextCode(tx, 'OUT') : undefined;

      const completed = await this.completeInTx(tx, user, ret.id, undefined, undefined, { exchange: true });
      const R = D(completed.totalRefund);
      const shiftId = completed.shiftId;
      // new invoice for the replacement goods, settled first with the return credit (OFFSET), then with the customer's extra payment
      const draft = await this.invoices.createInTx(tx, user, { branchId: inv.branchId, warehouseId: dto.newInvoice.warehouseId ?? inv.warehouseId, customerId: inv.customerId ?? undefined, sellerId: dto.newInvoice.sellerId, priceBookId: dto.newInvoice.priceBookId, discountAmount: dto.newInvoice.discountAmount, note: dto.newInvoice.note ?? `Đổi hàng từ ${inv.code} (phiếu trả ${completed.code})`, lines: dto.newInvoice.lines }, true, invoiceCode);
      const N = D(draft.totalAmount);
      const offset = R.lessThan(N) ? R : N;
      const extra = offset.greaterThan(0) ? [{ branchId: inv.branchId, direction: 'IN' as const, method: 'OFFSET' as PaymentMethod, amount: offset, note: `Cấn trừ phiếu trả ${completed.code}`, code: offsetInCode, allowOffset: true }] : [];
      const newInvoice = await this.invoices.completeInTx(tx, user, draft.id, dto.payments ?? [], undefined, paymentCodes, extra);
      if (offset.greaterThan(0)) {
        await this.payments.createInTx(tx, user, { branchId: inv.branchId, direction: 'OUT', method: 'OFFSET', partyType: inv.customerId ? 'CUSTOMER' : null, partyId: inv.customerId, shiftId, amount: offset, note: `Cấn trừ vào hóa đơn ${newInvoice.code}`, allocations: [{ documentType: 'SALES_RETURN', documentId: ret.id, amount: offset }], code: offsetOutCode, permissionChecked: true, allowOffset: true });
      }
      const remainder = R.minus(offset); // > 0 when the new goods are cheaper than what is returned
      if (dto.refund) {
        const amt = money(dto.refund.amount);
        if (amt.greaterThan(remainder)) throw Errors.conflict('OVERPAYMENT', 'Số tiền hoàn vượt quá phần chênh lệch', { remainder: remainder.toString(), requested: amt.toString() });
        if (!inv.customerId && !amt.equals(remainder)) throw Errors.validation('Khách lẻ không có công nợ: phải hoàn đúng phần chênh lệch', { remainder: remainder.toString(), refund: amt.toString() });
        await this.payments.createInTx(tx, user, { branchId: inv.branchId, direction: 'OUT', method: dto.refund.method as PaymentMethod, partyType: inv.customerId ? 'CUSTOMER' : null, partyId: inv.customerId, shiftId, amount: amt, reference: dto.refund.reference, note: `Hoàn chênh lệch đổi hàng ${completed.code}`, allocations: [{ documentType: 'SALES_RETURN', documentId: ret.id, amount: amt }], code: refundCode, permissionChecked: true });
      } else if (remainder.greaterThan(0) && !inv.customerId) throw Errors.validation('Khách lẻ: phải hoàn lại phần chênh lệch khi hàng mới rẻ hơn', { remainder: remainder.toString() });
      await tx.salesReturn.update({ where: { id: ret.id }, data: { exchangeInvoiceId: newInvoice.id } });
      await this.audit.log(tx, { action: 'sales.exchange', entityType: 'SalesReturn', entityId: ret.id, entityCode: completed.code, after: { newInvoice: newInvoice.code, returnValue: R.toString(), newTotal: N.toString(), offset: offset.toString() } });
      const final = await tx.salesReturn.findFirstOrThrow({ where: { id: ret.id }, include: returnInclude });
      return { return: await this.decorate(tx, user, final), invoice: newInvoice, settlement: { returnValue: R, newTotal: N, offset, customerPays: N.minus(offset), refundDue: remainder } };
    });
  }

  // ---------------------------------------------------------------- cancel (BR-66)
  async cancel(user: RequestUser, id: string, dto: CancelSalesReturnDto) {
    return this.prisma.tx(async (tx) => {
      const r = await this.lock(tx, user, id);
      if (r.status !== 'COMPLETED') throw Errors.conflict('DOCUMENT_NOT_POSTED', 'Chỉ hủy được phiếu đã hoàn thành', { status: r.status });
      if (r.exchangeInvoiceId) {
        const ex = await tx.invoice.findFirst({ where: { id: r.exchangeInvoiceId } });
        if (ex && ex.status !== 'CANCELLED') throw Errors.conflict('RETURN_LINKED_EXCHANGE', `Phiếu trả thuộc giao dịch đổi hàng; hãy hủy hóa đơn ${ex.code} trước`, { exchangeInvoiceId: ex.id });
      }
      const inv = await this.invoices.lock(tx, user, r.invoiceId);
      const allocs = await tx.paymentAllocation.findMany({ where: { documentType: 'SALES_RETURN', documentId: id }, include: { payment: { select: { id: true, status: true, amount: true, allocated: true } } } });
      const posted = allocs.filter((a) => a.payment.status === 'POSTED');
      for (const a of posted) if (!D(a.payment.allocated).equals(D(a.payment.amount))) throw Errors.conflict('PAYMENT_SHARED', 'Phiếu chi hoàn tiền có phần khác, hãy hủy phiếu chi thủ công trước', { paymentId: a.paymentId });
      // same order as completion: stock → payments → ledger
      const allowNegative = await this.engine.allowNegative(tx);
      const movements = await tx.stockMovement.findMany({ where: { documentType: 'SALES_RETURN', documentId: id, type: { not: 'REVERSAL' } } });
      movements.sort(StockEngineService.sortKey);
      for (const m of movements) await this.engine.apply(tx, { tenantId: user.tenantId, warehouseId: m.warehouseId, variantId: m.variantId, batchId: m.batchId, quantity: D(m.quantity).negated(), unitCost: D(m.unitCost), type: 'REVERSAL', documentType: 'SALES_RETURN', documentId: id, documentCode: r.code, lineId: m.lineId, reason: 'CANCEL', note: dto.reason, userId: user.id, allowNegative });
      const lines = await tx.salesReturnLine.findMany({ where: { returnId: id } });
      for (const l of lines) await tx.invoiceLine.update({ where: { id: l.invoiceLineId }, data: { returnedQuantity: { decrement: l.quantity } } });
      await tx.invoice.update({ where: { id: inv.id }, data: { returnedAmount: { decrement: r.totalRefund } } });
      for (const pid of Array.from(new Set(posted.map((a) => a.paymentId))).sort()) await this.payments.cancelInTx(tx, user, pid, `Hủy phiếu trả ${r.code}: ${dto.reason}`, { onlyDocument: { type: 'SALES_RETURN', id } });
      await this.ledger.reverseDocument(tx, user.tenantId, 'SALES_RETURN', id, r.code, `Hủy phiếu trả hàng: ${dto.reason}`, user.id);
      await this.loyalty.reverseDocument(tx, user, 'SALES_RETURN', id, r.code, `Hủy phiếu trả ${r.code}`);
      await tx.salesReturn.update({ where: { id }, data: { status: 'CANCELLED', cancelledAt: new Date(), cancelledById: user.id, cancelReason: dto.reason, version: { increment: 1 } } });
      await this.audit.log(tx, { action: 'sales.return.cancel', entityType: 'SalesReturn', entityId: id, entityCode: r.code, before: { status: 'COMPLETED' }, after: { status: 'CANCELLED', reason: dto.reason } });
      await this.outbox.enqueue(tx, { eventType: 'sales.return.cancelled', aggregateType: 'SalesReturn', aggregateId: id, payload: { code: r.code, reason: dto.reason } });
      return this.decorate(tx, user, await tx.salesReturn.findFirstOrThrow({ where: { id }, include: returnInclude }));
    });
  }

  // ---------------------------------------------------------------- helpers
  private async lock(tx: TxClient, user: RequestUser, id: string) {
    const rows = await tx.$queryRaw<{ id: string }[]>`SELECT id FROM sales_returns WHERE id = ${id}::uuid AND tenant_id = ${user.tenantId}::uuid FOR UPDATE`;
    if (!rows[0]) throw Errors.notFound('Phiếu trả hàng', id);
    const r = await tx.salesReturn.findFirstOrThrow({ where: { id } });
    this.access.assertBranch(user, r.branchId);
    await this.access.assertWarehouse(user, r.warehouseId, r.branchId, tx);
    return r;
  }

  private async assertReturnWindow(tx: TxClient, inv: { invoiceDate: Date; code: string }) {
    const row = await tx.tenantSetting.findFirst({ where: { key: TENANT_SETTING_KEYS.RETURN_MAX_DAYS } });
    const days = typeof row?.value === 'number' ? row.value : 0;
    if (days > 0 && Date.now() - inv.invoiceDate.getTime() > days * 86400 * 1000) throw Errors.conflict('RETURN_WINDOW_EXPIRED', `Hóa đơn ${inv.code} đã quá hạn trả hàng (${days} ngày)`, { maxDays: days });
  }

  /** What the customer actually paid per selling unit of each invoice line (BR-62): net of document discount, incl. tax when prices exclude tax. */
  private async paidPerUnit(db: TxClient | PrismaService['db'], inv: InvoiceWithLines): Promise<Map<string, Prisma.Decimal>> {
    return (await this.paidBreakdown(db, inv)).perUnit;
  }

  /** Net amount the customer paid per invoice line and per selling unit (rounded down, so k partial refunds never exceed the line). */
  private async paidBreakdown(db: TxClient | PrismaService['db'], inv: InvoiceWithLines): Promise<{ perUnit: Map<string, Prisma.Decimal>; net: Map<string, Prisma.Decimal> }> {
    const row = await db.tenantSetting.findFirst({ where: { key: TENANT_SETTING_KEYS.PRICE_INCLUDES_TAX } });
    const includesTax = row ? row.value === true : true;
    const lines = [...inv.lines].sort((a, b) => a.lineNo - b.lineNo);
    const shares = allocate(D(inv.discountAmount).plus(D(inv.promotionDiscount)), lines.map((l) => D(l.lineTotal)));
    const net = new Map(lines.map((l, i) => [l.id, D(l.lineTotal).minus(shares[i]).plus(includesTax ? ZERO : D(l.taxAmount))]));
    const perUnit = new Map(lines.map((l) => [l.id, D(l.quantity).isZero() ? ZERO : net.get(l.id)!.dividedBy(D(l.quantity)).toDecimalPlaces(4, Prisma.Decimal.ROUND_DOWN)]));
    return { perUnit, net };
  }

  private async normalizeLines(tx: TxClient, user: RequestUser, inv: InvoiceWithLines, input: ReturnLineDto[], keepPrices?: Prisma.Decimal[]): Promise<NormalizedLine[]> {
    const byId = new Map(inv.lines.map((l) => [l.id, l]));
    const { perUnit: paid, net } = await this.paidBreakdown(tx, inv);
    // already refunded per invoice line by completed returns (drafts excluded), so the last unit returned closes the line exactly
    const prior = await tx.salesReturnLine.findMany({ where: { invoiceLineId: { in: inv.lines.map((l) => l.id) }, return: { status: 'COMPLETED' } }, select: { invoiceLineId: true, lineTotal: true } });
    const refunded = new Map<string, Prisma.Decimal>();
    for (const r of prior) refunded.set(r.invoiceLineId, (refunded.get(r.invoiceLineId) ?? ZERO).plus(D(r.lineTotal)));
    const canEdit = hasPermission(user.permissions, 'return.price.edit');
    const used = new Map<string, Prisma.Decimal>();
    const variantIds = Array.from(new Set(inv.lines.map((l) => l.variantId)));
    const variants = await tx.productVariant.findMany({ where: { id: { in: variantIds } }, include: { product: { select: { type: true } } } });
    const vById = new Map(variants.map((v) => [v.id, v]));
    return input.map((l, i) => {
      const il = byId.get(l.invoiceLineId);
      if (!il) throw Errors.validation(`Dòng ${i + 1}: không thuộc hóa đơn`, { invoiceLineId: l.invoiceLineId });
      const quantity = toQty(l.quantity);
      if (quantity.isZero()) throw Errors.validation(`Dòng ${i + 1}: số lượng trả phải lớn hơn 0`, { invoiceLineId: il.id });
      const already = (used.get(il.id) ?? ZERO).plus(quantity);
      used.set(il.id, already);
      const returnable = D(il.quantity).minus(D(il.returnedQuantity));
      if (already.greaterThan(returnable)) throw Errors.conflict('RETURN_QUANTITY_EXCEEDED', `Dòng ${i + 1}: vượt số lượng còn có thể trả (${returnable.toString()})`, { invoiceLineId: il.id, returnable: returnable.toString() });
      const maxUnit = paid.get(il.id) ?? ZERO;
      const requested = l.unitPrice !== undefined ? money(l.unitPrice) : keepPrices?.[i] ?? maxUnit;
      if (requested.greaterThan(maxUnit)) throw Errors.validation(`Dòng ${i + 1}: giá hoàn không được vượt số tiền khách đã trả (${maxUnit.toString()})`, { invoiceLineId: il.id, maxUnitPrice: maxUnit.toString() });
      if (!requested.equals(maxUnit) && !(keepPrices?.[i]?.equals(requested)) && !canEdit) throw Errors.forbidden(`Dòng ${i + 1}: cần quyền return.price.edit để đổi giá hoàn`);
      let lineTotal = money(quantity.times(requested));
      if (requested.equals(maxUnit) && already.equals(returnable)) {
        // default price and this line consumes what is left of the invoice line: refund exactly what has not been refunded yet (rounding true-up, ≤ 1 đ)
        const remaining = (net.get(il.id) ?? ZERO).minus(refunded.get(il.id) ?? ZERO);
        if (remaining.greaterThanOrEqualTo(0) && remaining.minus(lineTotal).abs().lessThanOrEqualTo(1)) lineTotal = money(remaining);
      }
      refunded.set(il.id, (refunded.get(il.id) ?? ZERO).plus(lineTotal));
      const condition = (l.condition ?? 'RESTOCK') as ReturnCondition;
      const productType = vById.get(il.variantId)?.product.type ?? 'GOODS';
      const baseQuantity = toQty(quantity.times(D(il.conversionFactor)));
      const unitCost = D(il.unitCost);
      return { invoiceLineId: il.id, variantId: il.variantId, batchId: il.batchId, unitName: il.unitName, conversionFactor: D(il.conversionFactor), quantity, baseQuantity, unitPrice: requested, lineTotal, condition, unitCost, costTotal: money(unitCost.times(baseQuantity)), note: l.note ?? null, productType };
    });
  }

  private totals(lines: NormalizedLine[], fee: Prisma.Decimal) {
    const subtotal = lines.reduce((s, l) => s.plus(l.lineTotal), ZERO);
    if (fee.greaterThan(subtotal)) throw Errors.validation('Phí trả hàng vượt quá giá trị hàng trả');
    return { subtotal, feeAmount: fee, totalRefund: subtotal.minus(fee) };
  }
}
