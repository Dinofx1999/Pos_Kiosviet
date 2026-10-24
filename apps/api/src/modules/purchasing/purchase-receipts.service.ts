import { Injectable } from '@nestjs/common';
import { PaymentMethod, Prisma, PurchaseDocStatus } from '@prisma/client';
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
import { PaymentsService } from '../finance/payments.service';
import { StockEngineService } from '../inventory/stock-engine.service';
import { CreateReceiptDto, ImmediatePaymentDto, ReceiptCostDto, ReceiptLineDto, ReceiptQueryDto, UpdateReceiptDto } from './dto/purchasing.dto';
import { computeReceipt, unitPayables } from './purchase-calc';
import { PurchaseOrdersService } from './purchase-orders.service';

const receiptInclude = {
  supplier: { select: { id: true, code: true, name: true, phone: true } },
  order: { select: { id: true, code: true, status: true } },
  warehouse: { select: { id: true, code: true, name: true } },
  branch: { select: { id: true, code: true, name: true } },
  lines: { orderBy: { lineNo: 'asc' as const }, include: { variant: { select: { id: true, sku: true, barcode: true, name: true, product: { select: { id: true, code: true, name: true, baseUnit: true, trackBatch: true } } } }, batch: { select: { id: true, batchNo: true, expiryDate: true } } } },
  costs: true,
  returns: { select: { id: true, code: true, status: true, totalAmount: true, returnDate: true } },
} satisfies Prisma.PurchaseReceiptInclude;

/** Phiếu nhập hàng (BR-43..BR-46). */
@Injectable()
export class PurchaseReceiptsService {
  constructor(
    private readonly prisma: PrismaService, private readonly engine: StockEngineService, private readonly numbering: NumberingService,
    private readonly audit: AuditService, private readonly outbox: OutboxService, private readonly access: AccessService,
    private readonly ledger: LedgerService, private readonly payments: PaymentsService, private readonly orders: PurchaseOrdersService,
  ) {}

  // ---------------------------------------------------------------- queries
  async list(user: RequestUser, q: ReceiptQueryDto) {
    const filters: Prisma.PurchaseReceiptWhereInput = {
      ...(q.status ? { status: q.status as PurchaseDocStatus } : {}),
      ...(q.supplierId ? { supplierId: q.supplierId } : {}),
      ...(q.branchId ? { branchId: q.branchId } : {}),
      ...(q.warehouseId ? { warehouseId: q.warehouseId } : {}),
      ...(q.orderId ? { orderId: q.orderId } : {}),
      ...(q.from || q.to ? { receiptDate: { ...(q.from ? { gte: new Date(q.from) } : {}), ...(q.to ? { lte: new Date(q.to) } : {}) } } : {}),
      ...(q.search ? { OR: [{ code: { contains: q.search, mode: 'insensitive' } }, { supplierInvoiceNo: { contains: q.search, mode: 'insensitive' } }, { note: { contains: q.search, mode: 'insensitive' } }, { supplier: { name: { contains: q.search, mode: 'insensitive' } } }, { lines: { some: { variant: { OR: [{ sku: { contains: q.search, mode: 'insensitive' } }, { name: { contains: q.search, mode: 'insensitive' } }] } } } }] } : {}),
    };
    const where: Prisma.PurchaseReceiptWhereInput = { AND: [this.access.branchWhere(user), filters] };
    const include = { supplier: { select: { id: true, code: true, name: true } }, warehouse: { select: { id: true, name: true } }, branch: { select: { id: true, name: true } }, _count: { select: { lines: true } } };
    const order = orderBy(q, ['receiptDate', 'createdAt', 'code', 'totalAmount', 'status'], 'receiptDate');
    if (q.unpaid === 'true') {
      const all = await this.prisma.db.purchaseReceipt.findMany({ where: { AND: [where, { status: 'POSTED' }] }, include, orderBy: order });
      const due = all.filter((r) => D(r.totalAmount).minus(D(r.paidAmount)).greaterThan(0));
      return paginated(due.slice((q.page - 1) * q.pageSize, q.page * q.pageSize).map((r) => ({ ...r, dueAmount: D(r.totalAmount).minus(D(r.paidAmount)) })), due.length, q);
    }
    const [rows, total] = await Promise.all([
      this.prisma.db.purchaseReceipt.findMany({ where, include, ...skipTake(q), orderBy: order }),
      this.prisma.db.purchaseReceipt.count({ where }),
    ]);
    return paginated(rows.map((r) => ({ ...r, dueAmount: D(r.totalAmount).minus(D(r.paidAmount)) })), total, q);
  }

  async get(user: RequestUser, id: string) {
    const r = await this.prisma.db.purchaseReceipt.findFirst({ where: { id, ...this.access.branchWhere(user) }, include: receiptInclude });
    if (!r) throw Errors.notFound('Phiếu nhập hàng', id);
    const [movements, allocations] = await Promise.all([
      r.status === 'DRAFT' ? [] : this.prisma.db.stockMovement.findMany({ where: { documentType: 'PURCHASE_RECEIPT', documentId: id }, orderBy: { createdAt: 'asc' } }),
      this.prisma.db.paymentAllocation.findMany({ where: { documentType: 'PURCHASE_RECEIPT', documentId: id }, include: { payment: { select: { id: true, code: true, status: true, method: true, paymentDate: true, amount: true } } } }),
    ]);
    const payable = unitPayables(D(r.discountAmount), r.lines);
    return { ...r, dueAmount: D(r.totalAmount).minus(D(r.paidAmount)), lines: r.lines.map((l) => ({ ...l, returnableQuantity: D(l.quantity).minus(D(l.returnedQuantity)), returnUnitPrice: payable.get(l.id) ?? null })), movements, payments: allocations.filter((a) => a.payment.status === 'POSTED') };
  }

  // ---------------------------------------------------------------- drafts
  async create(user: RequestUser, dto: CreateReceiptDto) {
    return this.prisma.tx((tx) => this.createInTx(tx, user, dto));
  }

  async createInTx(tx: TxClient, user: RequestUser, dto: CreateReceiptDto) {
    this.access.assertBranch(user, dto.branchId);
    await this.access.assertWarehouse(user, dto.warehouseId, dto.branchId, tx);
    await this.assertSupplier(tx, dto.supplierId);
    if (!dto.orderId && dto.lines.some((l) => l.orderLineId)) throw Errors.validation('Dòng có orderLineId nhưng phiếu không gắn đơn đặt hàng');
    if (dto.orderId) await this.assertOrder(tx, user, dto.orderId, dto.supplierId, dto.lines);
    const computed = await this.compute(tx, dto.lines, dto.costs ?? [], money(dto.discountAmount ?? 0));
    const code = await this.numbering.next(tx, 'PURCHASE_RECEIPT');
    const r = await tx.purchaseReceipt.create({
      data: {
        tenantId: user.tenantId, branchId: dto.branchId, warehouseId: dto.warehouseId, supplierId: dto.supplierId, orderId: dto.orderId ?? null, code,
        receiptDate: dto.receiptDate ? new Date(dto.receiptDate) : new Date(), supplierInvoiceNo: dto.supplierInvoiceNo, note: dto.note, createdById: user.id,
        ...computed.totals,
        lines: { create: computed.lines.map((l, i) => ({ tenantId: user.tenantId, lineNo: i + 1, ...l })) },
        costs: { create: computed.costs.map((c) => ({ tenantId: user.tenantId, ...c })) },
      },
      include: receiptInclude,
    });
    await this.audit.log(tx, { action: 'purchase.receipt.create', entityType: 'PurchaseReceipt', entityId: r.id, entityCode: code, after: { supplierId: dto.supplierId, orderId: dto.orderId ?? null, lines: computed.lines.length, totalAmount: computed.totals.totalAmount.toString() } });
    return r;
  }

  async update(user: RequestUser, id: string, dto: UpdateReceiptDto) {
    return this.prisma.tx(async (tx) => {
      const r = await this.lock(tx, user, id);
      if (r.status !== 'DRAFT') throw Errors.conflict('DOCUMENT_NOT_EDITABLE', 'Chỉ sửa được phiếu nháp', { status: r.status });
      if (r.version !== dto.version) throw Errors.conflict('VERSION_CONFLICT', 'Phiếu đã được người khác thay đổi, vui lòng tải lại', { current: r.version });
      if (dto.warehouseId) await this.access.assertWarehouse(user, dto.warehouseId, r.branchId, tx);
      if (dto.supplierId) {
        if (r.orderId && dto.supplierId !== r.supplierId) throw Errors.validation('Không đổi nhà cung cấp của phiếu nhập từ đơn đặt hàng');
        await this.assertSupplier(tx, dto.supplierId);
      }
      const existingLines = await tx.purchaseReceiptLine.findMany({ where: { receiptId: id }, orderBy: { lineNo: 'asc' } });
      const existingCosts = await tx.purchaseReceiptCost.findMany({ where: { receiptId: id } });
      const lineInput: ReceiptLineDto[] = dto.lines ?? existingLines.map((l) => ({ variantId: l.variantId, batchId: l.batchId ?? undefined, orderLineId: l.orderLineId ?? undefined, quantity: l.quantity.toString(), unitPrice: l.unitPrice.toString(), discountAmount: l.discountAmount.toString(), taxRate: l.taxRate.toString(), note: l.note ?? undefined }));
      const costInput: ReceiptCostDto[] = dto.costs ?? existingCosts.map((c) => ({ name: c.name, amount: c.amount.toString(), allocationMethod: c.allocationMethod, payToSupplier: c.payToSupplier }));
      if (!r.orderId && lineInput.some((l) => l.orderLineId)) throw Errors.validation('Dòng có orderLineId nhưng phiếu không gắn đơn đặt hàng');
      if (r.orderId) await this.assertOrder(tx, user, r.orderId, dto.supplierId ?? r.supplierId, lineInput);
      const computed = await this.compute(tx, lineInput, costInput, money(dto.discountAmount ?? r.discountAmount));
      const after = await tx.purchaseReceipt.update({
        where: { id },
        data: {
          warehouseId: dto.warehouseId, supplierId: dto.supplierId, receiptDate: dto.receiptDate ? new Date(dto.receiptDate) : undefined, supplierInvoiceNo: dto.supplierInvoiceNo, note: dto.note, version: { increment: 1 },
          ...computed.totals,
          lines: { deleteMany: {}, create: computed.lines.map((l, i) => ({ tenantId: user.tenantId, lineNo: i + 1, ...l })) },
          costs: { deleteMany: {}, create: computed.costs.map((c) => ({ tenantId: user.tenantId, ...c })) },
        },
        include: receiptInclude,
      });
      await this.audit.log(tx, { action: 'purchase.receipt.update', entityType: 'PurchaseReceipt', entityId: id, entityCode: r.code, before: { version: r.version }, after: { version: after.version, totalAmount: after.totalAmount } });
      return after;
    });
  }

  async remove(user: RequestUser, id: string) {
    await this.prisma.tx(async (tx) => {
      const r = await this.lock(tx, user, id);
      if (r.status !== 'DRAFT') throw Errors.conflict('DOCUMENT_NOT_EDITABLE', 'Chỉ xóa được phiếu nháp', { status: r.status });
      await tx.purchaseReceipt.delete({ where: { id } });
      await this.audit.log(tx, { action: 'purchase.receipt.delete', entityType: 'PurchaseReceipt', entityId: id, entityCode: r.code });
    });
  }

  // ---------------------------------------------------------------- posting (BR-43)
  async post(user: RequestUser, id: string, payment?: ImmediatePaymentDto) {
    return this.prisma.tx((tx) => this.postInTx(tx, user, id, payment));
  }

  async createAndPost(user: RequestUser, dto: CreateReceiptDto) {
    return this.prisma.tx(async (tx) => {
      const r = await this.createInTx(tx, user, dto);
      return this.postInTx(tx, user, r.id, dto.payment);
    });
  }

  async postInTx(tx: TxClient, user: RequestUser, id: string, payment?: ImmediatePaymentDto) {
    const r = await this.lock(tx, user, id);
    if (r.status !== 'DRAFT') throw Errors.conflict('DOCUMENT_NOT_DRAFT', 'Phiếu không ở trạng thái nháp', { status: r.status });
    // H1: an embedded payment is a cash voucher → needs payment.create; take its code now (lock order: document → sequence → stock → party balance)
    if (payment && !hasPermission(user.permissions, 'payment.create')) throw Errors.forbidden('Thiếu quyền: payment.create (thanh toán ngay)');
    const paymentCode = payment ? await this.payments.nextCode(tx, 'OUT') : undefined;
    await this.assertSupplier(tx, r.supplierId);
    const wh = await tx.warehouse.findFirst({ where: { id: r.warehouseId } });
    if (!wh?.isActive) throw Errors.validation('Kho không hoạt động', { warehouseId: r.warehouseId });
    const lines = await tx.purchaseReceiptLine.findMany({ where: { receiptId: id }, orderBy: { lineNo: 'asc' } });
    const costs = await tx.purchaseReceiptCost.findMany({ where: { receiptId: id } });
    // recompute from stored inputs so posted figures always reflect the current tax-in-cost setting
    const computed = await this.compute(tx,
      lines.map((l) => ({ variantId: l.variantId, batchId: l.batchId ?? undefined, orderLineId: l.orderLineId ?? undefined, quantity: l.quantity.toString(), unitPrice: l.unitPrice.toString(), discountAmount: l.discountAmount.toString(), taxRate: l.taxRate.toString(), note: l.note ?? undefined })),
      costs.map((c) => ({ name: c.name, amount: c.amount.toString(), allocationMethod: c.allocationMethod, payToSupplier: c.payToSupplier })),
      D(r.discountAmount));
    for (const [i, l] of lines.entries()) await tx.purchaseReceiptLine.update({ where: { id: l.id }, data: { taxAmount: computed.lines[i].taxAmount, lineTotal: computed.lines[i].lineTotal, allocatedCost: computed.lines[i].allocatedCost, unitCost: computed.lines[i].unitCost } });

    if (r.orderId) await this.orders.applyReceived(tx, user, r.orderId, lines.filter((l) => l.orderLineId).map((l) => ({ orderLineId: l.orderLineId!, quantity: D(l.quantity) })), 1);

    const allowNegative = await this.engine.allowNegative(tx);
    const sorted = lines.map((l, i) => ({ line: l, calc: computed.lines[i] })).sort((a, b) => StockEngineService.sortKey(a.line, b.line));
    for (const { line, calc } of sorted) {
      await this.engine.apply(tx, {
        tenantId: user.tenantId, warehouseId: r.warehouseId, variantId: line.variantId, batchId: line.batchId, quantity: D(line.quantity), unitCost: calc.unitCost,
        type: 'PURCHASE', documentType: 'PURCHASE_RECEIPT', documentId: r.id, documentCode: r.code, lineId: line.id, note: line.note, userId: user.id, allowNegative,
      });
      // "giá nhập gần nhất" = the supplier's unit price (before landed-cost allocation)
      await tx.$executeRaw`UPDATE product_variants SET last_purchase_price = ${line.unitPrice.toString()}::numeric WHERE id = ${line.variantId}::uuid AND tenant_id = ${user.tenantId}::uuid`;
    }

    const total = computed.totals.totalAmount;
    if (total.greaterThan(0)) await this.ledger.post(tx, { tenantId: user.tenantId, partyType: 'SUPPLIER', partyId: r.supplierId, branchId: r.branchId, type: 'PURCHASE', amount: total, documentType: 'PURCHASE_RECEIPT', documentId: r.id, documentCode: r.code, note: r.supplierInvoiceNo ? `HĐ NCC ${r.supplierInvoiceNo}` : null, userId: user.id });

    await tx.purchaseReceipt.update({ where: { id }, data: { status: 'POSTED', postedAt: new Date(), postedById: user.id, version: { increment: 1 }, ...computed.totals } });
    if (payment) {
      const amount = money(payment.amount);
      if (amount.greaterThan(total)) throw Errors.conflict('OVERPAYMENT', 'Số tiền thanh toán vượt quá tổng phiếu', { total: total.toString(), requested: amount.toString() });
      await this.payments.createInTx(tx, user, { branchId: r.branchId, direction: 'OUT', method: (payment.method ?? 'CASH') as PaymentMethod, partyType: 'SUPPLIER', partyId: r.supplierId, amount, reference: payment.reference, note: `Thanh toán phiếu nhập ${r.code}`, allocations: [{ documentType: 'PURCHASE_RECEIPT', documentId: r.id, amount }], code: paymentCode });
    }
    await this.audit.log(tx, { action: 'purchase.receipt.post', entityType: 'PurchaseReceipt', entityId: id, entityCode: r.code, after: { status: 'POSTED', totalAmount: total.toString(), paidNow: payment?.amount ?? '0' } });
    await this.outbox.enqueue(tx, { eventType: 'purchase.receipt.posted', aggregateType: 'PurchaseReceipt', aggregateId: id, payload: { code: r.code, supplierId: r.supplierId, warehouseId: r.warehouseId, totalAmount: total.toString() } });
    return this.getInTx(tx, user, id);
  }

  // ---------------------------------------------------------------- cancel (BR-46)
  async cancel(user: RequestUser, id: string, reason: string) {
    return this.prisma.tx(async (tx) => {
      const r = await this.lock(tx, user, id);
      if (r.status !== 'POSTED') throw Errors.conflict('DOCUMENT_NOT_POSTED', 'Chỉ hủy được phiếu đã hoàn thành', { status: r.status });
      const returns = await tx.purchaseReturn.count({ where: { receiptId: id, status: 'POSTED' } });
      if (returns > 0) throw Errors.conflict('RECEIPT_HAS_RETURNS', 'Phiếu đã có trả hàng, hãy hủy các phiếu trả hàng trước', { returns });
      if (D(r.paidAmount).greaterThan(0)) throw Errors.conflict('RECEIPT_HAS_PAYMENTS', 'Phiếu đã được thanh toán, hãy hủy phiếu chi liên quan trước', { paidAmount: r.paidAmount.toString() });
      // same lock order as posting: receipt → order → variant/balance → party balance (M1)
      if (r.orderId) {
        const lines = await tx.purchaseReceiptLine.findMany({ where: { receiptId: id, orderLineId: { not: null } } });
        await this.orders.applyReceived(tx, user, r.orderId, lines.map((l) => ({ orderLineId: l.orderLineId!, quantity: D(l.quantity) })), -1);
      }
      const allowNegative = await this.engine.allowNegative(tx);
      const movements = await tx.stockMovement.findMany({ where: { documentType: 'PURCHASE_RECEIPT', documentId: id, type: { not: 'REVERSAL' } } });
      movements.sort(StockEngineService.sortKey);
      for (const m of movements) {
        await this.engine.apply(tx, { tenantId: user.tenantId, warehouseId: m.warehouseId, variantId: m.variantId, batchId: m.batchId, quantity: D(m.quantity).negated(), unitCost: D(m.unitCost), type: 'REVERSAL', documentType: 'PURCHASE_RECEIPT', documentId: id, documentCode: r.code, lineId: m.lineId, reason: 'CANCEL', note: reason, userId: user.id, allowNegative });
        // restore "giá nhập gần nhất" from the latest other posted receipt of this variant (L5)
        const prev = await tx.purchaseReceiptLine.findFirst({ where: { variantId: m.variantId, receipt: { status: 'POSTED', id: { not: id } } }, orderBy: { receipt: { postedAt: 'desc' } }, select: { unitPrice: true } });
        await tx.$executeRaw`UPDATE product_variants SET last_purchase_price = ${prev ? prev.unitPrice.toString() : null}::numeric WHERE id = ${m.variantId}::uuid AND tenant_id = ${user.tenantId}::uuid`;
      }
      await this.ledger.reverseDocument(tx, user.tenantId, 'PURCHASE_RECEIPT', id, r.code, `Hủy phiếu nhập: ${reason}`, user.id);
      await tx.purchaseReceipt.update({ where: { id }, data: { status: 'CANCELLED', cancelledAt: new Date(), cancelledById: user.id, cancelReason: reason, version: { increment: 1 } } });
      await this.audit.log(tx, { action: 'purchase.receipt.cancel', entityType: 'PurchaseReceipt', entityId: id, entityCode: r.code, before: { status: 'POSTED' }, after: { status: 'CANCELLED', reason } });
      await this.outbox.enqueue(tx, { eventType: 'purchase.receipt.cancelled', aggregateType: 'PurchaseReceipt', aggregateId: id, payload: { code: r.code, reason } });
      return this.getInTx(tx, user, id);
    });
  }

  // ---------------------------------------------------------------- helpers
  async lock(tx: TxClient, user: RequestUser, id: string) {
    const rows = await tx.$queryRaw<{ id: string }[]>`SELECT id FROM purchase_receipts WHERE id = ${id}::uuid AND tenant_id = ${user.tenantId}::uuid FOR UPDATE`;
    if (!rows[0]) throw Errors.notFound('Phiếu nhập hàng', id);
    const r = await tx.purchaseReceipt.findFirstOrThrow({ where: { id } });
    this.access.assertBranch(user, r.branchId);
    await this.access.assertWarehouse(user, r.warehouseId, r.branchId, tx);
    return r;
  }

  private async getInTx(tx: TxClient, user: RequestUser, id: string) {
    const r = await tx.purchaseReceipt.findFirstOrThrow({ where: { id }, include: receiptInclude });
    const movements = await tx.stockMovement.findMany({ where: { documentType: 'PURCHASE_RECEIPT', documentId: id }, orderBy: { createdAt: 'asc' } });
    const allocations = await tx.paymentAllocation.findMany({ where: { documentType: 'PURCHASE_RECEIPT', documentId: id }, include: { payment: { select: { id: true, code: true, status: true, method: true, paymentDate: true, amount: true } } } });
    void user;
    const payable = unitPayables(D(r.discountAmount), r.lines);
    return { ...r, dueAmount: D(r.totalAmount).minus(D(r.paidAmount)), lines: r.lines.map((l) => ({ ...l, returnableQuantity: D(l.quantity).minus(D(l.returnedQuantity)), returnUnitPrice: payable.get(l.id) ?? null })), movements, payments: allocations.filter((a) => a.payment.status === 'POSTED') };
  }

  private async assertSupplier(tx: TxClient, supplierId: string) {
    const s = await tx.supplier.findFirst({ where: { id: supplierId } });
    if (!s) throw Errors.notFound('Nhà cung cấp', supplierId);
    if (!s.isActive) throw Errors.validation('Nhà cung cấp đã ngừng giao dịch', { supplierId });
  }

  private async assertOrder(tx: TxClient, user: RequestUser, orderId: string, supplierId: string, lines: ReceiptLineDto[]) {
    const o = await tx.purchaseOrder.findFirst({ where: { id: orderId }, include: { lines: true } });
    if (!o) throw Errors.notFound('Đơn đặt hàng nhập', orderId);
    this.access.assertBranch(user, o.branchId);
    if (o.supplierId !== supplierId) throw Errors.validation('Nhà cung cấp của phiếu nhập khác với đơn đặt hàng');
    if (!(o.status === 'CONFIRMED' || o.status === 'PARTIAL')) throw Errors.conflict('ORDER_NOT_RECEIVABLE', 'Đơn đặt hàng phải ở trạng thái Đã xác nhận / Nhập một phần', { status: o.status });
    const byId = new Map(o.lines.map((l) => [l.id, l]));
    const requested = new Map<string, Prisma.Decimal>();
    for (const [i, l] of lines.entries()) {
      if (!l.orderLineId) continue;
      const ol = byId.get(l.orderLineId);
      if (!ol) throw Errors.validation(`Dòng ${i + 1}: không thuộc đơn đặt hàng`, { orderLineId: l.orderLineId });
      if (ol.variantId !== l.variantId) throw Errors.validation(`Dòng ${i + 1}: hàng hóa khác với dòng đơn đặt hàng`, { orderLineId: l.orderLineId });
      const sum = (requested.get(ol.id) ?? ZERO).plus(toQty(l.quantity));
      requested.set(ol.id, sum);
      const remaining = D(ol.quantity).minus(D(ol.receivedQuantity));
      if (sum.greaterThan(remaining)) throw Errors.conflict('PO_QUANTITY_EXCEEDED', `Dòng ${i + 1}: vượt số lượng còn lại của đơn (${remaining.toString()})`, { orderLineId: l.orderLineId, remaining: remaining.toString() });
    }
  }

  private async compute(tx: TxClient, input: ReceiptLineDto[], costInput: ReceiptCostDto[], discountAmount: Prisma.Decimal) {
    const ids = Array.from(new Set(input.map((l) => l.variantId)));
    const variants = await tx.productVariant.findMany({ where: { id: { in: ids }, deletedAt: null }, include: { product: { select: { type: true, trackBatch: true } } } });
    const byId = new Map(variants.map((v) => [v.id, v]));
    for (const [i, l] of input.entries()) {
      const v = byId.get(l.variantId);
      if (!v) throw Errors.validation(`Dòng ${i + 1}: hàng hóa không tồn tại`, { variantId: l.variantId });
      if (v.product.type !== 'GOODS') throw Errors.validation(`Dòng ${i + 1}: chỉ hàng hóa mới nhập kho được`, { variantId: l.variantId });
      if (v.product.trackBatch && !l.batchId) throw Errors.conflict('BATCH_REQUIRED', `Dòng ${i + 1}: hàng theo lô bắt buộc chọn lô`, { variantId: l.variantId });
      if (!v.product.trackBatch && l.batchId) throw Errors.conflict('BATCH_NOT_ALLOWED', `Dòng ${i + 1}: hàng không theo dõi lô`, { variantId: l.variantId });
      if (l.batchId) {
        const b = await tx.productBatch.findFirst({ where: { id: l.batchId, variantId: l.variantId } });
        if (!b) throw Errors.validation(`Dòng ${i + 1}: lô không thuộc hàng hóa này`, { batchId: l.batchId });
      }
    }
    const includeTax = (await tx.tenantSetting.findFirst({ where: { key: TENANT_SETTING_KEYS.PURCHASE_TAX_IN_COST } }))?.value !== false;
    const costs = costInput.map((c) => ({ name: c.name, amount: money(c.amount), allocationMethod: (c.allocationMethod ?? 'BY_VALUE') as 'BY_VALUE' | 'BY_QUANTITY', payToSupplier: c.payToSupplier ?? true }));
    let calc: ReturnType<typeof computeReceipt>;
    try {
      calc = computeReceipt(input.map((l) => ({ quantity: toQty(l.quantity), unitPrice: money(l.unitPrice), discountAmount: money(l.discountAmount ?? 0), taxRate: D(l.taxRate ?? 0) })), costs, discountAmount, includeTax);
    } catch (e) { throw Errors.validation((e as Error).message); }
    return {
      lines: input.map((l, i) => ({ orderLineId: l.orderLineId ?? null, variantId: l.variantId, batchId: l.batchId ?? null, quantity: toQty(l.quantity), unitPrice: money(l.unitPrice), discountAmount: money(l.discountAmount ?? 0), taxRate: D(l.taxRate ?? 0), taxAmount: calc.lines[i].taxAmount, lineTotal: calc.lines[i].lineTotal, allocatedCost: calc.lines[i].allocatedCost, unitCost: calc.lines[i].unitCost, note: l.note ?? null })),
      costs,
      totals: { subtotal: calc.subtotal, discountAmount: calc.discountAmount, taxAmount: calc.taxAmount, landedCostTotal: calc.landedCostTotal, totalAmount: calc.totalAmount },
    };
  }
}
