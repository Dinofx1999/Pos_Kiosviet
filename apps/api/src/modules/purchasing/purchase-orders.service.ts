import { Injectable } from '@nestjs/common';
import { Prisma, PurchaseOrderStatus } from '@prisma/client';
import { Errors } from '../../common/errors/app-error';
import { orderBy, paginated, skipTake } from '../../common/pagination';
import { D, money, qty as toQty, ZERO } from '../../common/utils/decimal';
import { AccessService } from '../../infra/access/access.service';
import { AuditService } from '../../infra/audit/audit.service';
import { RequestUser } from '../../infra/cls/request-context';
import { NumberingService } from '../../infra/numbering/numbering.service';
import { OutboxService } from '../../infra/outbox/outbox.service';
import { PrismaService, TxClient } from '../../infra/prisma/prisma.service';
import { CreateOrderDto, OrderLineDto, OrderQueryDto, UpdateOrderDto } from './dto/purchasing.dto';

const orderInclude = {
  supplier: { select: { id: true, code: true, name: true, phone: true } },
  warehouse: { select: { id: true, code: true, name: true } },
  branch: { select: { id: true, code: true, name: true } },
  lines: { orderBy: { lineNo: 'asc' as const }, include: { variant: { select: { id: true, sku: true, barcode: true, name: true, product: { select: { id: true, code: true, name: true, baseUnit: true, trackBatch: true } } } } } },
  receipts: { select: { id: true, code: true, status: true, receiptDate: true, totalAmount: true }, orderBy: { createdAt: 'asc' as const } },
} satisfies Prisma.PurchaseOrderInclude;

@Injectable()
export class PurchaseOrdersService {
  constructor(private readonly prisma: PrismaService, private readonly numbering: NumberingService, private readonly audit: AuditService, private readonly outbox: OutboxService, private readonly access: AccessService) {}

  async list(user: RequestUser, q: OrderQueryDto) {
    const filters: Prisma.PurchaseOrderWhereInput = {
      ...(q.status ? { status: q.status as PurchaseOrderStatus } : {}),
      ...(q.supplierId ? { supplierId: q.supplierId } : {}),
      ...(q.branchId ? { branchId: q.branchId } : {}),
      ...(q.warehouseId ? { warehouseId: q.warehouseId } : {}),
      ...(q.from || q.to ? { orderDate: { ...(q.from ? { gte: new Date(q.from) } : {}), ...(q.to ? { lte: new Date(q.to) } : {}) } } : {}),
      ...(q.search ? { OR: [{ code: { contains: q.search, mode: 'insensitive' } }, { note: { contains: q.search, mode: 'insensitive' } }, { supplier: { name: { contains: q.search, mode: 'insensitive' } } }, { lines: { some: { variant: { OR: [{ sku: { contains: q.search, mode: 'insensitive' } }, { name: { contains: q.search, mode: 'insensitive' } }] } } } }] } : {}),
    };
    const where: Prisma.PurchaseOrderWhereInput = { AND: [this.access.branchWhere(user), filters] };
    const [rows, total] = await Promise.all([
      this.prisma.db.purchaseOrder.findMany({ where, include: { supplier: { select: { id: true, code: true, name: true } }, warehouse: { select: { id: true, name: true } }, branch: { select: { id: true, name: true } }, _count: { select: { lines: true, receipts: true } } }, ...skipTake(q), orderBy: orderBy(q, ['orderDate', 'createdAt', 'code', 'totalAmount', 'status'], 'orderDate') }),
      this.prisma.db.purchaseOrder.count({ where }),
    ]);
    return paginated(rows, total, q);
  }

  async get(user: RequestUser, id: string) {
    const o = await this.prisma.db.purchaseOrder.findFirst({ where: { id, ...this.access.branchWhere(user) }, include: orderInclude });
    if (!o) throw Errors.notFound('Đơn đặt hàng nhập', id);
    return this.view(o);
  }

  async create(user: RequestUser, dto: CreateOrderDto) {
    this.access.assertBranch(user, dto.branchId);
    await this.access.assertWarehouse(user, dto.warehouseId, dto.branchId);
    return this.prisma.tx(async (tx) => {
      await this.assertSupplier(tx, dto.supplierId);
      const lines = await this.normalizeLines(tx, dto.lines);
      const totals = this.totals(lines, money(dto.discountAmount ?? 0));
      const code = await this.numbering.next(tx, 'PURCHASE_ORDER');
      const o = await tx.purchaseOrder.create({
        data: {
          tenantId: user.tenantId, branchId: dto.branchId, warehouseId: dto.warehouseId, supplierId: dto.supplierId, code, orderDate: dto.orderDate ? new Date(dto.orderDate) : new Date(), expectedDate: dto.expectedDate ? new Date(dto.expectedDate) : null, note: dto.note, createdById: user.id, ...totals,
          lines: { create: lines.map((l, i) => ({ tenantId: user.tenantId, lineNo: i + 1, ...l })) },
        },
        include: orderInclude,
      });
      await this.audit.log(tx, { action: 'purchase.order.create', entityType: 'PurchaseOrder', entityId: o.id, entityCode: code, after: { supplierId: dto.supplierId, lines: lines.length, totalAmount: totals.totalAmount.toString() } });
      return this.view(o);
    });
  }

  async update(user: RequestUser, id: string, dto: UpdateOrderDto) {
    return this.prisma.tx(async (tx) => {
      const o = await this.lock(tx, user, id);
      if (o.status !== 'DRAFT') throw Errors.conflict('DOCUMENT_NOT_EDITABLE', 'Chỉ sửa được đơn nháp', { status: o.status });
      if (o.version !== dto.version) throw Errors.conflict('VERSION_CONFLICT', 'Đơn đã được người khác thay đổi, vui lòng tải lại', { current: o.version });
      if (dto.warehouseId) await this.access.assertWarehouse(user, dto.warehouseId, o.branchId, tx);
      if (dto.supplierId) await this.assertSupplier(tx, dto.supplierId);
      const lines = dto.lines ? await this.normalizeLines(tx, dto.lines) : null;
      const current = lines ?? (await tx.purchaseOrderLine.findMany({ where: { orderId: id }, orderBy: { lineNo: 'asc' } })).map((l) => ({ variantId: l.variantId, quantity: D(l.quantity), unitPrice: D(l.unitPrice), discountAmount: D(l.discountAmount), taxRate: D(l.taxRate), lineTotal: D(l.lineTotal), note: l.note ?? undefined }));
      const totals = this.totals(current, money(dto.discountAmount ?? o.discountAmount));
      const after = await tx.purchaseOrder.update({
        where: { id },
        data: {
          warehouseId: dto.warehouseId, supplierId: dto.supplierId, expectedDate: dto.expectedDate === undefined ? undefined : dto.expectedDate ? new Date(dto.expectedDate) : null, note: dto.note, version: { increment: 1 }, ...totals,
          ...(lines ? { lines: { deleteMany: {}, create: lines.map((l, i) => ({ tenantId: user.tenantId, lineNo: i + 1, ...l })) } } : {}),
        },
        include: orderInclude,
      });
      await this.audit.log(tx, { action: 'purchase.order.update', entityType: 'PurchaseOrder', entityId: id, entityCode: o.code, before: { version: o.version }, after: { version: after.version, totalAmount: after.totalAmount } });
      return this.view(after);
    });
  }

  async remove(user: RequestUser, id: string) {
    await this.prisma.tx(async (tx) => {
      const o = await this.lock(tx, user, id);
      if (o.status !== 'DRAFT') throw Errors.conflict('DOCUMENT_NOT_EDITABLE', 'Chỉ xóa được đơn nháp', { status: o.status });
      await tx.purchaseOrder.delete({ where: { id } });
      await this.audit.log(tx, { action: 'purchase.order.delete', entityType: 'PurchaseOrder', entityId: id, entityCode: o.code });
    });
  }

  async confirm(user: RequestUser, id: string) {
    return this.prisma.tx(async (tx) => {
      const o = await this.lock(tx, user, id);
      if (o.status !== 'DRAFT') throw Errors.conflict('DOCUMENT_NOT_DRAFT', 'Đơn không ở trạng thái nháp', { status: o.status });
      const after = await tx.purchaseOrder.update({ where: { id }, data: { status: 'CONFIRMED', confirmedAt: new Date(), version: { increment: 1 } }, include: orderInclude });
      await this.audit.log(tx, { action: 'purchase.order.confirm', entityType: 'PurchaseOrder', entityId: id, entityCode: o.code, before: { status: 'DRAFT' }, after: { status: 'CONFIRMED' } });
      await this.outbox.enqueue(tx, { eventType: 'purchase.order.confirmed', aggregateType: 'PurchaseOrder', aggregateId: id, payload: { code: o.code, supplierId: o.supplierId } });
      return this.view(after);
    });
  }

  async cancel(user: RequestUser, id: string, reason: string) {
    return this.prisma.tx(async (tx) => {
      const o = await this.lock(tx, user, id);
      if (o.status === 'RECEIVED' || o.status === 'CANCELLED') throw Errors.conflict('DOCUMENT_NOT_CANCELLABLE', 'Đơn đã hoàn thành hoặc đã hủy', { status: o.status });
      const drafts = await tx.purchaseReceipt.count({ where: { orderId: id, status: 'DRAFT' } });
      if (drafts > 0) throw Errors.conflict('ORDER_HAS_DRAFT_RECEIPTS', 'Còn phiếu nhập nháp thuộc đơn này, hãy xóa trước', { drafts });
      const after = await tx.purchaseOrder.update({ where: { id }, data: { status: 'CANCELLED', cancelledAt: new Date(), cancelReason: reason, version: { increment: 1 } }, include: orderInclude });
      await this.audit.log(tx, { action: 'purchase.order.cancel', entityType: 'PurchaseOrder', entityId: id, entityCode: o.code, before: { status: o.status }, after: { status: 'CANCELLED', reason } });
      return this.view(after);
    });
  }

  /**
   * Applies received-quantity deltas (+1 when a receipt posts, −1 when it is cancelled) under the order row lock and
   * recomputes the status (BR-42). Throws PO_QUANTITY_EXCEEDED when a delta would exceed the ordered quantity.
   */
  async applyReceived(tx: TxClient, user: RequestUser, orderId: string, deltas: Array<{ orderLineId: string; quantity: Prisma.Decimal }>, direction: 1 | -1) {
    const o = await this.lock(tx, user, orderId);
    if (direction === 1 && !(o.status === 'CONFIRMED' || o.status === 'PARTIAL')) throw Errors.conflict('ORDER_NOT_RECEIVABLE', 'Đơn đặt hàng phải ở trạng thái Đã xác nhận / Nhập một phần', { status: o.status, code: o.code });
    const lines = await tx.purchaseOrderLine.findMany({ where: { orderId } });
    const byId = new Map(lines.map((l) => [l.id, l]));
    for (const d of deltas) {
      const line = byId.get(d.orderLineId);
      if (!line) throw Errors.validation('Dòng đơn đặt hàng không thuộc đơn này', { orderLineId: d.orderLineId });
      const next = D(line.receivedQuantity).plus(toQty(d.quantity).times(direction));
      if (next.greaterThan(D(line.quantity))) throw Errors.conflict('PO_QUANTITY_EXCEEDED', 'Số lượng nhập vượt quá số lượng còn lại của đơn đặt hàng', { orderLineId: d.orderLineId, ordered: line.quantity.toString(), received: line.receivedQuantity.toString(), requested: d.quantity.toString() });
      if (next.lessThan(0)) throw Errors.conflict('PO_QUANTITY_EXCEEDED', 'Số lượng đã nhận không thể âm', { orderLineId: d.orderLineId });
      line.receivedQuantity = next;
      await tx.purchaseOrderLine.update({ where: { id: line.id }, data: { receivedQuantity: next } });
    }
    const allReceived = lines.every((l) => D(l.receivedQuantity).greaterThanOrEqualTo(D(l.quantity)));
    const anyReceived = lines.some((l) => D(l.receivedQuantity).greaterThan(0));
    const status: PurchaseOrderStatus = o.status === 'CANCELLED' ? 'CANCELLED' : allReceived ? 'RECEIVED' : anyReceived ? 'PARTIAL' : 'CONFIRMED';
    if (status !== o.status) await tx.purchaseOrder.update({ where: { id: orderId }, data: { status, version: { increment: 1 } } });
    return o;
  }

  // ---------------- helpers
  private async lock(tx: TxClient, user: RequestUser, id: string) {
    const rows = await tx.$queryRaw<{ id: string }[]>`SELECT id FROM purchase_orders WHERE id = ${id}::uuid AND tenant_id = ${user.tenantId}::uuid FOR UPDATE`;
    if (!rows[0]) throw Errors.notFound('Đơn đặt hàng nhập', id);
    const o = await tx.purchaseOrder.findFirstOrThrow({ where: { id } });
    this.access.assertBranch(user, o.branchId);
    await this.access.assertWarehouse(user, o.warehouseId, o.branchId, tx);
    return o;
  }

  private async assertSupplier(tx: TxClient, supplierId: string) {
    const s = await tx.supplier.findFirst({ where: { id: supplierId } });
    if (!s) throw Errors.notFound('Nhà cung cấp', supplierId);
    if (!s.isActive) throw Errors.validation('Nhà cung cấp đã ngừng giao dịch', { supplierId });
    return s;
  }

  private async normalizeLines(tx: TxClient, input: OrderLineDto[]) {
    const ids = Array.from(new Set(input.map((l) => l.variantId)));
    const variants = await tx.productVariant.findMany({ where: { id: { in: ids }, deletedAt: null }, include: { product: { select: { type: true } } } });
    const byId = new Map(variants.map((v) => [v.id, v]));
    return input.map((l, i) => {
      const v = byId.get(l.variantId);
      if (!v) throw Errors.validation(`Dòng ${i + 1}: hàng hóa không tồn tại`, { variantId: l.variantId });
      if (v.product.type !== 'GOODS') throw Errors.validation(`Dòng ${i + 1}: chỉ hàng hóa mới đặt mua được`, { variantId: l.variantId });
      const quantity = toQty(l.quantity); const unitPrice = money(l.unitPrice); const discountAmount = money(l.discountAmount ?? 0); const taxRate = D(l.taxRate ?? 0);
      const lineTotal = money(quantity.times(unitPrice).minus(discountAmount));
      if (lineTotal.lessThan(0)) throw Errors.validation(`Dòng ${i + 1}: chiết khấu vượt quá thành tiền`);
      return { variantId: l.variantId, quantity, unitPrice, discountAmount, taxRate, lineTotal, note: l.note };
    });
  }

  private totals(lines: Array<{ lineTotal: Prisma.Decimal; taxRate: Prisma.Decimal }>, discountAmount: Prisma.Decimal) {
    const subtotal = lines.reduce((s, l) => s.plus(l.lineTotal), ZERO);
    if (discountAmount.greaterThan(subtotal)) throw Errors.validation('Chiết khấu đơn vượt quá tổng tiền hàng');
    const taxAmount = lines.reduce((s, l) => s.plus(money(l.lineTotal.times(l.taxRate).dividedBy(100))), ZERO);
    return { subtotal, discountAmount, taxAmount, totalAmount: subtotal.minus(discountAmount).plus(taxAmount) };
  }

  private view(o: Prisma.PurchaseOrderGetPayload<{ include: typeof orderInclude }>) {
    return { ...o, lines: o.lines.map((l) => ({ ...l, remainingQuantity: D(l.quantity).minus(D(l.receivedQuantity)) })) };
  }
}
