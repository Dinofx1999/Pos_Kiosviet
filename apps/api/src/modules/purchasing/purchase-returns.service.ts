import { Injectable } from '@nestjs/common';
import { PaymentMethod, Prisma, PurchaseDocStatus } from '@prisma/client';
import { hasPermission } from '@erp/shared';
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
import { PaymentsService } from '../finance/payments.service';
import { StockEngineService } from '../inventory/stock-engine.service';
import { CreateReturnDto, ImmediatePaymentDto, ReturnLineDto, ReturnQueryDto, UpdateReturnDto } from './dto/purchasing.dto';
import { unitPayables } from './purchase-calc';
import { PurchaseReceiptsService } from './purchase-receipts.service';

const returnInclude = {
  supplier: { select: { id: true, code: true, name: true } },
  receipt: { select: { id: true, code: true, receiptDate: true, totalAmount: true } },
  warehouse: { select: { id: true, code: true, name: true } },
  branch: { select: { id: true, code: true, name: true } },
  lines: { orderBy: { lineNo: 'asc' as const }, include: { variant: { select: { id: true, sku: true, barcode: true, name: true, product: { select: { id: true, code: true, name: true, baseUnit: true } } } }, receiptLine: { select: { id: true, quantity: true, returnedQuantity: true, unitPrice: true, batch: { select: { batchNo: true } } } } } },
} satisfies Prisma.PurchaseReturnInclude;

type ReceiptLineRow = { id: string; lineNo: number; variantId: string; batchId: string | null; quantity: Prisma.Decimal; returnedQuantity: Prisma.Decimal; unitPrice: Prisma.Decimal; discountAmount: Prisma.Decimal; taxAmount: Prisma.Decimal; lineTotal: Prisma.Decimal };
type ReceiptHead = { discountAmount: Prisma.Decimal; lines: ReceiptLineRow[] };

/** Trả hàng nhập (BR-47): references a POSTED receipt; never exceeds received − already returned; multiple returns allowed. */
@Injectable()
export class PurchaseReturnsService {
  constructor(
    private readonly prisma: PrismaService, private readonly engine: StockEngineService, private readonly numbering: NumberingService,
    private readonly audit: AuditService, private readonly outbox: OutboxService, private readonly access: AccessService,
    private readonly ledger: LedgerService, private readonly payments: PaymentsService, private readonly receipts: PurchaseReceiptsService,
  ) {}

  async list(user: RequestUser, q: ReturnQueryDto) {
    const filters: Prisma.PurchaseReturnWhereInput = {
      ...(q.status ? { status: q.status as PurchaseDocStatus } : {}),
      ...(q.supplierId ? { supplierId: q.supplierId } : {}),
      ...(q.receiptId ? { receiptId: q.receiptId } : {}),
      ...(q.branchId ? { branchId: q.branchId } : {}),
      ...(q.from || q.to ? { returnDate: { ...(q.from ? { gte: new Date(q.from) } : {}), ...(q.to ? { lte: new Date(q.to) } : {}) } } : {}),
      ...(q.search ? { OR: [{ code: { contains: q.search, mode: 'insensitive' } }, { note: { contains: q.search, mode: 'insensitive' } }, { receipt: { code: { contains: q.search, mode: 'insensitive' } } }, { supplier: { name: { contains: q.search, mode: 'insensitive' } } }] } : {}),
    };
    const where: Prisma.PurchaseReturnWhereInput = { AND: [this.access.branchWhere(user), filters] };
    const [rows, total] = await Promise.all([
      this.prisma.db.purchaseReturn.findMany({ where, include: { supplier: { select: { id: true, code: true, name: true } }, receipt: { select: { id: true, code: true } }, warehouse: { select: { id: true, name: true } }, _count: { select: { lines: true } } }, ...skipTake(q), orderBy: orderBy(q, ['returnDate', 'createdAt', 'code', 'totalAmount'], 'returnDate') }),
      this.prisma.db.purchaseReturn.count({ where }),
    ]);
    return paginated(rows, total, q);
  }

  async get(user: RequestUser, id: string) {
    const r = await this.prisma.db.purchaseReturn.findFirst({ where: { id, ...this.access.branchWhere(user) }, include: returnInclude });
    if (!r) throw Errors.notFound('Phiếu trả hàng nhập', id);
    return this.decorate(this.prisma.db, r);
  }

  async create(user: RequestUser, dto: CreateReturnDto) {
    return this.prisma.tx((tx) => this.createInTx(tx, user, dto));
  }

  async createInTx(tx: TxClient, user: RequestUser, dto: CreateReturnDto) {
    const receipt = await tx.purchaseReceipt.findFirst({ where: { id: dto.receiptId }, include: { lines: true } });
    if (!receipt) throw Errors.notFound('Phiếu nhập hàng', dto.receiptId);
    this.access.assertBranch(user, receipt.branchId);
    await this.access.assertWarehouse(user, receipt.warehouseId, receipt.branchId, tx);
    if (receipt.status !== 'POSTED') throw Errors.conflict('DOCUMENT_NOT_POSTED', 'Chỉ trả hàng cho phiếu nhập đã hoàn thành', { status: receipt.status });
    const lines = this.normalizeLines(receipt, dto.lines);
    const code = await this.numbering.next(tx, 'PURCHASE_RETURN');
    const r = await tx.purchaseReturn.create({
      data: {
        tenantId: user.tenantId, branchId: receipt.branchId, warehouseId: receipt.warehouseId, supplierId: receipt.supplierId, receiptId: receipt.id, code,
        returnDate: dto.returnDate ? new Date(dto.returnDate) : new Date(), reason: dto.reason, note: dto.note, createdById: user.id,
        totalAmount: lines.reduce((s, l) => s.plus(l.lineTotal), ZERO),
        lines: { create: lines.map((l, i) => ({ tenantId: user.tenantId, lineNo: i + 1, ...l })) },
      },
      include: returnInclude,
    });
    await this.audit.log(tx, { action: 'purchase.return.create', entityType: 'PurchaseReturn', entityId: r.id, entityCode: code, after: { receiptId: receipt.id, lines: lines.length, totalAmount: r.totalAmount.toString() } });
    return r;
  }

  async update(user: RequestUser, id: string, dto: UpdateReturnDto) {
    return this.prisma.tx(async (tx) => {
      const r = await this.lock(tx, user, id);
      if (r.status !== 'DRAFT') throw Errors.conflict('DOCUMENT_NOT_EDITABLE', 'Chỉ sửa được phiếu nháp', { status: r.status });
      if (r.version !== dto.version) throw Errors.conflict('VERSION_CONFLICT', 'Phiếu đã được người khác thay đổi, vui lòng tải lại', { current: r.version });
      let lineData: ReturnType<PurchaseReturnsService['normalizeLines']> | null = null;
      if (dto.lines) {
        const receipt = await tx.purchaseReceipt.findFirstOrThrow({ where: { id: r.receiptId }, include: { lines: true } });
        lineData = this.normalizeLines(receipt, dto.lines);
      }
      const after = await tx.purchaseReturn.update({
        where: { id },
        data: {
          returnDate: dto.returnDate ? new Date(dto.returnDate) : undefined, reason: dto.reason, note: dto.note, version: { increment: 1 },
          ...(lineData ? { totalAmount: lineData.reduce((s, l) => s.plus(l.lineTotal), ZERO), lines: { deleteMany: {}, create: lineData.map((l, i) => ({ tenantId: user.tenantId, lineNo: i + 1, ...l })) } } : {}),
        },
        include: returnInclude,
      });
      await this.audit.log(tx, { action: 'purchase.return.update', entityType: 'PurchaseReturn', entityId: id, entityCode: r.code, before: { version: r.version }, after: { version: after.version } });
      return after;
    });
  }

  async remove(user: RequestUser, id: string) {
    await this.prisma.tx(async (tx) => {
      const r = await this.lock(tx, user, id);
      if (r.status !== 'DRAFT') throw Errors.conflict('DOCUMENT_NOT_EDITABLE', 'Chỉ xóa được phiếu nháp', { status: r.status });
      await tx.purchaseReturn.delete({ where: { id } });
      await this.audit.log(tx, { action: 'purchase.return.delete', entityType: 'PurchaseReturn', entityId: id, entityCode: r.code });
    });
  }

  async post(user: RequestUser, id: string, refund?: ImmediatePaymentDto) {
    return this.prisma.tx((tx) => this.postInTx(tx, user, id, refund));
  }

  async createAndPost(user: RequestUser, dto: CreateReturnDto) {
    return this.prisma.tx(async (tx) => {
      const r = await this.createInTx(tx, user, dto);
      return this.postInTx(tx, user, r.id, dto.refund);
    });
  }

  async postInTx(tx: TxClient, user: RequestUser, id: string, refund?: ImmediatePaymentDto) {
    const r = await this.lock(tx, user, id);
    if (r.status !== 'DRAFT') throw Errors.conflict('DOCUMENT_NOT_DRAFT', 'Phiếu không ở trạng thái nháp', { status: r.status });
    // lock the receipt so concurrent returns cannot over-return the same line
    const receipt = await this.receipts.lock(tx, user, r.receiptId);
    if (receipt.status !== 'POSTED') throw Errors.conflict('DOCUMENT_NOT_POSTED', 'Phiếu nhập gốc không còn hiệu lực', { status: receipt.status });
    // H1/M2: embedded refund is a cash voucher → needs payment.create; take its code before stock/party locks
    if (refund && !hasPermission(user.permissions, 'payment.create')) throw Errors.forbidden('Thiếu quyền: payment.create (hoàn tiền ngay)');
    const refundCode = refund ? await this.payments.nextCode(tx, 'IN') : undefined;
    // H2: total credited back can never exceed what the receipt charged
    if (D(receipt.returnedAmount).plus(D(r.totalAmount)).greaterThan(D(receipt.totalAmount))) throw Errors.conflict('RETURN_AMOUNT_EXCEEDED', 'Tổng giá trị trả hàng vượt quá giá trị phiếu nhập', { receiptTotal: receipt.totalAmount.toString(), alreadyReturned: receipt.returnedAmount.toString(), requested: r.totalAmount.toString() });
    const lines = await tx.purchaseReturnLine.findMany({ where: { returnId: id } });
    const receiptLines = await tx.purchaseReceiptLine.findMany({ where: { receiptId: r.receiptId } });
    const rlById = new Map(receiptLines.map((l) => [l.id, l]));
    const perLine = new Map<string, Prisma.Decimal>();
    for (const l of lines) perLine.set(l.receiptLineId, (perLine.get(l.receiptLineId) ?? ZERO).plus(D(l.quantity)));
    for (const [rlId, qty] of perLine) {
      const rl = rlById.get(rlId);
      if (!rl) throw Errors.validation('Dòng phiếu nhập không tồn tại', { receiptLineId: rlId });
      const returnable = D(rl.quantity).minus(D(rl.returnedQuantity));
      if (qty.greaterThan(returnable)) throw Errors.conflict('RETURN_QUANTITY_EXCEEDED', 'Số lượng trả vượt quá số lượng còn có thể trả', { receiptLineId: rlId, returnable: returnable.toString(), requested: qty.toString() });
    }
    const allowNegative = await this.engine.allowNegative(tx);
    const sorted = [...lines].sort(StockEngineService.sortKey);
    for (const l of sorted) {
      await this.engine.apply(tx, { tenantId: user.tenantId, warehouseId: r.warehouseId, variantId: l.variantId, batchId: l.batchId, quantity: D(l.quantity).negated(), unitCost: null, type: 'PURCHASE_RETURN', documentType: 'PURCHASE_RETURN', documentId: r.id, documentCode: r.code, lineId: l.id, reason: r.reason, note: l.note, userId: user.id, allowNegative });
    }
    for (const [rlId, qty] of perLine) await tx.purchaseReceiptLine.update({ where: { id: rlId }, data: { returnedQuantity: { increment: qty } } });
    await tx.purchaseReceipt.update({ where: { id: r.receiptId }, data: { returnedAmount: { increment: r.totalAmount } } });
    if (D(r.totalAmount).greaterThan(0)) await this.ledger.post(tx, { tenantId: user.tenantId, partyType: 'SUPPLIER', partyId: r.supplierId, branchId: r.branchId, type: 'PURCHASE_RETURN', amount: D(r.totalAmount).negated(), documentType: 'PURCHASE_RETURN', documentId: r.id, documentCode: r.code, note: `Trả hàng phiếu ${receipt.code}`, userId: user.id });
    await tx.purchaseReturn.update({ where: { id }, data: { status: 'POSTED', postedAt: new Date(), postedById: user.id, version: { increment: 1 } } });
    if (refund) {
      const amount = money(refund.amount);
      if (amount.greaterThan(D(r.totalAmount))) throw Errors.conflict('OVERPAYMENT', 'Số tiền hoàn vượt quá giá trị trả hàng', { total: r.totalAmount.toString(), requested: amount.toString() });
      await this.payments.createInTx(tx, user, { branchId: r.branchId, direction: 'IN', method: (refund.method ?? 'CASH') as PaymentMethod, partyType: 'SUPPLIER', partyId: r.supplierId, amount, reference: refund.reference, note: `NCC hoàn tiền phiếu trả ${r.code}`, allocations: [{ documentType: 'PURCHASE_RETURN', documentId: r.id, amount }], code: refundCode });
    }
    await this.audit.log(tx, { action: 'purchase.return.post', entityType: 'PurchaseReturn', entityId: id, entityCode: r.code, after: { status: 'POSTED', totalAmount: r.totalAmount.toString(), refundedNow: refund?.amount ?? '0' } });
    await this.outbox.enqueue(tx, { eventType: 'purchase.return.posted', aggregateType: 'PurchaseReturn', aggregateId: id, payload: { code: r.code, receiptCode: receipt.code, supplierId: r.supplierId, totalAmount: r.totalAmount.toString() } });
    return this.decorate(tx, await tx.purchaseReturn.findFirstOrThrow({ where: { id }, include: returnInclude }));
  }

  async cancel(user: RequestUser, id: string, reason: string) {
    return this.prisma.tx(async (tx) => {
      const r = await this.lock(tx, user, id);
      if (r.status !== 'POSTED') throw Errors.conflict('DOCUMENT_NOT_POSTED', 'Chỉ hủy được phiếu đã hoàn thành', { status: r.status });
      if (D(r.refundedAmount).greaterThan(0)) throw Errors.conflict('RETURN_HAS_REFUNDS', 'Phiếu đã được hoàn tiền, hãy hủy phiếu thu liên quan trước', { refundedAmount: r.refundedAmount.toString() });
      await this.receipts.lock(tx, user, r.receiptId);
      const allowNegative = await this.engine.allowNegative(tx);
      const movements = await tx.stockMovement.findMany({ where: { documentType: 'PURCHASE_RETURN', documentId: id, type: { not: 'REVERSAL' } } });
      movements.sort(StockEngineService.sortKey);
      for (const m of movements) {
        await this.engine.apply(tx, { tenantId: user.tenantId, warehouseId: m.warehouseId, variantId: m.variantId, batchId: m.batchId, quantity: D(m.quantity).negated(), unitCost: D(m.unitCost), type: 'REVERSAL', documentType: 'PURCHASE_RETURN', documentId: id, documentCode: r.code, lineId: m.lineId, reason: 'CANCEL', note: reason, userId: user.id, allowNegative });
      }
      const lines = await tx.purchaseReturnLine.findMany({ where: { returnId: id } });
      for (const l of lines) await tx.purchaseReceiptLine.update({ where: { id: l.receiptLineId }, data: { returnedQuantity: { decrement: l.quantity } } });
      await tx.purchaseReceipt.update({ where: { id: r.receiptId }, data: { returnedAmount: { decrement: r.totalAmount } } });
      await this.ledger.reverseDocument(tx, user.tenantId, 'PURCHASE_RETURN', id, r.code, `Hủy phiếu trả hàng: ${reason}`, user.id);
      await tx.purchaseReturn.update({ where: { id }, data: { status: 'CANCELLED', cancelledAt: new Date(), cancelReason: reason, version: { increment: 1 } } });
      await this.audit.log(tx, { action: 'purchase.return.cancel', entityType: 'PurchaseReturn', entityId: id, entityCode: r.code, before: { status: 'POSTED' }, after: { status: 'CANCELLED', reason } });
      await this.outbox.enqueue(tx, { eventType: 'purchase.return.cancelled', aggregateType: 'PurchaseReturn', aggregateId: id, payload: { code: r.code, reason } });
      return this.decorate(tx, await tx.purchaseReturn.findFirstOrThrow({ where: { id }, include: returnInclude }));
    });
  }

  // ---------------- helpers
  private async decorate(db: TxClient | PrismaService['db'], r: Prisma.PurchaseReturnGetPayload<{ include: typeof returnInclude }>) {
    const [movements, allocations] = await Promise.all([
      r.status === 'DRAFT' ? [] : db.stockMovement.findMany({ where: { documentType: 'PURCHASE_RETURN', documentId: r.id }, orderBy: { createdAt: 'asc' } }),
      db.paymentAllocation.findMany({ where: { documentType: 'PURCHASE_RETURN', documentId: r.id }, include: { payment: { select: { id: true, code: true, status: true, method: true, paymentDate: true, amount: true } } } }),
    ]);
    return { ...r, movements, refunds: allocations.filter((a) => a.payment.status === 'POSTED') };
  }

  private async lock(tx: TxClient, user: RequestUser, id: string) {
    const rows = await tx.$queryRaw<{ id: string }[]>`SELECT id FROM purchase_returns WHERE id = ${id}::uuid AND tenant_id = ${user.tenantId}::uuid FOR UPDATE`;
    if (!rows[0]) throw Errors.notFound('Phiếu trả hàng nhập', id);
    const r = await tx.purchaseReturn.findFirstOrThrow({ where: { id } });
    this.access.assertBranch(user, r.branchId);
    await this.access.assertWarehouse(user, r.warehouseId, r.branchId, tx);
    return r;
  }

  /**
   * Per-unit amount actually paid to the supplier for a receipt line (BR-47):
   * (lineTotal − document-discount share + tax) / qty — landed costs are not refundable.
   */
  private unitPayable(receipt: ReceiptHead): Map<string, Prisma.Decimal> {
    return unitPayables(D(receipt.discountAmount), [...receipt.lines].sort((a, b) => a.lineNo - b.lineNo));
  }

  private normalizeLines(receipt: ReceiptHead, input: ReturnLineDto[]) {
    const byId = new Map(receipt.lines.map((l) => [l.id, l]));
    const payable = this.unitPayable(receipt);
    const used = new Map<string, Prisma.Decimal>();
    return input.map((l, i) => {
      const rl = byId.get(l.receiptLineId);
      if (!rl) throw Errors.validation(`Dòng ${i + 1}: không thuộc phiếu nhập`, { receiptLineId: l.receiptLineId });
      const quantity = toQty(l.quantity);
      const already = (used.get(rl.id) ?? ZERO).plus(quantity);
      used.set(rl.id, already);
      const returnable = D(rl.quantity).minus(D(rl.returnedQuantity));
      if (already.greaterThan(returnable)) throw Errors.conflict('RETURN_QUANTITY_EXCEEDED', `Dòng ${i + 1}: vượt số lượng còn có thể trả (${returnable.toString()})`, { receiptLineId: rl.id, returnable: returnable.toString() });
      const maxUnit = payable.get(rl.id) ?? ZERO;
      const unitPrice = l.unitPrice !== undefined ? money(l.unitPrice) : maxUnit;
      if (unitPrice.greaterThan(maxUnit)) throw Errors.validation(`Dòng ${i + 1}: đơn giá trả không được vượt giá đã trả cho NCC (${maxUnit.toString()})`, { receiptLineId: rl.id, maxUnitPrice: maxUnit.toString() });
      return { receiptLineId: rl.id, variantId: rl.variantId, batchId: rl.batchId, quantity, unitPrice, lineTotal: money(quantity.times(unitPrice)), note: l.note ?? null };
    });
  }
}
