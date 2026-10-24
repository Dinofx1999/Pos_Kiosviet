import { Injectable } from '@nestjs/common';
import { PaymentMethod, Prisma, SalesOrderStatus } from '@prisma/client';
import { hasPermission } from '@erp/shared';
import { Errors } from '../../common/errors/app-error';
import { orderBy, paginated, skipTake } from '../../common/pagination';
import { D, money, ZERO } from '../../common/utils/decimal';
import { AccessService } from '../../infra/access/access.service';
import { AuditService } from '../../infra/audit/audit.service';
import { RequestUser } from '../../infra/cls/request-context';
import { NumberingService } from '../../infra/numbering/numbering.service';
import { OutboxService } from '../../infra/outbox/outbox.service';
import { PrismaService, TxClient } from '../../infra/prisma/prisma.service';
import { PaymentsService } from '../finance/payments.service';
import { ReservationsService } from '../inventory/reservations.service';
import { StockEngineService } from '../inventory/stock-engine.service';
import { DeliveriesService } from './deliveries.service';
import { CancelOrderDto, CompleteOrderDto, CreateSalesOrderDto, DepositDto, SalesOrderQueryDto, UpdateSalesOrderDto } from './dto/orders.dto';
import { InvoicePaymentDto } from './dto/sales.dto';
import { InvoicesService } from './invoices.service';

const orderInclude = {
  customer: { select: { id: true, code: true, name: true, phone: true, address: true, groupName: true } },
  branch: { select: { id: true, code: true, name: true } },
  warehouse: { select: { id: true, code: true, name: true } },
  invoice: { select: { id: true, code: true, status: true, totalAmount: true, paidAmount: true } },
  delivery: { include: { events: { orderBy: { createdAt: 'asc' as const } } } },
  lines: { orderBy: { lineNo: 'asc' as const }, include: { variant: { select: { id: true, sku: true, barcode: true, name: true, product: { select: { id: true, code: true, name: true, type: true, baseUnit: true, trackBatch: true } } } }, batch: { select: { id: true, batchNo: true } } } },
} satisfies Prisma.SalesOrderInclude;

/** Đơn đặt hàng (BR-100..BR-105): giữ tồn khi xác nhận, nhận cọc, chuyển thành hóa đơn, hủy hoàn/giữ cọc. */
@Injectable()
export class OrdersService {
  constructor(
    private readonly prisma: PrismaService, private readonly numbering: NumberingService, private readonly audit: AuditService, private readonly outbox: OutboxService,
    private readonly access: AccessService, private readonly invoices: InvoicesService, private readonly payments: PaymentsService, private readonly reservations: ReservationsService,
    private readonly engine: StockEngineService, private readonly deliveries: DeliveriesService,
  ) {}

  // ---------------------------------------------------------------- queries
  async list(user: RequestUser, q: SalesOrderQueryDto) {
    const filters: Prisma.SalesOrderWhereInput = {
      ...(q.status ? { status: q.status as SalesOrderStatus } : {}),
      ...(q.branchId ? { branchId: q.branchId } : {}),
      ...(q.customerId ? { customerId: q.customerId } : {}),
      ...(q.source ? { source: q.source } : {}),
      ...(q.from || q.to ? { orderDate: { ...(q.from ? { gte: new Date(q.from) } : {}), ...(q.to ? { lte: new Date(q.to) } : {}) } } : {}),
      ...(q.search ? { OR: [{ code: { contains: q.search, mode: 'insensitive' } }, { note: { contains: q.search, mode: 'insensitive' } }, { customer: { OR: [{ name: { contains: q.search, mode: 'insensitive' } }, { phone: { contains: q.search } }] } }, { delivery: { OR: [{ receiverName: { contains: q.search, mode: 'insensitive' } }, { receiverPhone: { contains: q.search } }, { trackingCode: { contains: q.search, mode: 'insensitive' } }] } }] } : {}),
    };
    const where: Prisma.SalesOrderWhereInput = { AND: [this.access.branchWhere(user), filters] };
    const [rowsRaw, total] = await Promise.all([
      this.prisma.db.salesOrder.findMany({ where, include: { customer: { select: { id: true, code: true, name: true, phone: true } }, branch: { select: { id: true, name: true } }, delivery: { select: { id: true, code: true, status: true, carrier: true, trackingCode: true } }, invoice: { select: { id: true, code: true } }, _count: { select: { lines: true } } }, ...skipTake(q), orderBy: orderBy(q, ['orderDate', 'createdAt', 'code', 'totalAmount', 'status', 'expectedAt'], 'orderDate') }),
      this.prisma.db.salesOrder.count({ where }),
    ]);
    const rows = rowsRaw.map((o) => ({ ...o, dueAmount: D(o.totalAmount).minus(D(o.depositAmount)) })).filter((o) => q.unpaid !== 'true' || o.dueAmount.greaterThan(0));
    return paginated(rows, total, q);
  }

  async get(user: RequestUser, id: string) {
    const o = await this.prisma.db.salesOrder.findFirst({ where: { id, ...this.access.branchWhere(user) }, include: orderInclude });
    if (!o) throw Errors.notFound('Đơn đặt hàng', id);
    return this.decorate(this.prisma.db, o);
  }

  private async decorate(db: TxClient | PrismaService['db'], o: Prisma.SalesOrderGetPayload<{ include: typeof orderInclude }>) {
    const [allocations, reservations] = await Promise.all([
      db.paymentAllocation.findMany({ where: { documentType: 'SALES_ORDER', documentId: o.id }, include: { payment: { select: { id: true, code: true, status: true, method: true, paymentDate: true, amount: true, reference: true } } } }),
      o.status === 'CONFIRMED' ? db.stockReservation.findMany({ where: { documentType: 'SALES_ORDER', documentId: o.id, status: 'ACTIVE' }, select: { id: true, variantId: true, batchId: true, quantity: true, warehouseId: true } }) : [],
    ]);
    return { ...o, dueAmount: D(o.totalAmount).minus(D(o.depositAmount)), deposits: allocations.filter((a) => a.payment.status === 'POSTED'), reservations };
  }

  // ---------------------------------------------------------------- create / update
  async create(user: RequestUser, dto: CreateSalesOrderDto) {
    const id = await this.prisma.tx(async (tx) => {
      this.access.assertBranch(user, dto.branchId);
      await this.access.assertWarehouse(user, dto.warehouseId, dto.branchId, tx);
      const customer = dto.customerId ? await this.invoices.assertCustomer(tx, dto.customerId) : null;
      const sellerId = await this.invoices.resolveSeller(tx, user, dto.sellerId);
      if (dto.priceBookId) await this.invoices.assertPriceBook(tx, user, dto.priceBookId, dto.branchId, customer?.groupName ?? null);
      if (dto.lines.some((l) => l.isGift)) throw Errors.validation('Đơn đặt hàng không có dòng hàng tặng; khuyến mãi áp dụng khi lập hóa đơn');
      const resolved = await this.invoices.resolveLines(tx, user, dto.lines, dto.priceBookId ?? null);
      const docDiscount = money(dto.discountAmount ?? 0);
      if (docDiscount.greaterThan(0) && !hasPermission(user.permissions, 'invoice.discount')) throw Errors.forbidden('Thiếu quyền: invoice.discount');
      const calc = await this.invoices.compute(tx, resolved, docDiscount);
      const code = await this.numbering.next(tx, 'SALES_ORDER');
      const o = await tx.salesOrder.create({
        data: {
          tenantId: user.tenantId, branchId: dto.branchId, warehouseId: dto.warehouseId, customerId: customer?.id ?? null, sellerId, priceBookId: dto.priceBookId ?? null, code, source: dto.source ?? 'POS',
          orderDate: dto.orderDate ? new Date(dto.orderDate) : new Date(), expectedAt: dto.expectedAt ? new Date(dto.expectedAt) : null, note: dto.note, createdById: user.id,
          subtotal: calc.subtotal, discountAmount: docDiscount, taxAmount: calc.taxAmount, totalAmount: calc.totalAmount,
          lines: { create: resolved.map((l, i) => ({ tenantId: user.tenantId, lineNo: i + 1, variantId: l.variantId, batchId: l.batchId, productUnitId: l.productUnitId, unitName: l.unitName, conversionFactor: l.conversionFactor, quantity: l.quantity, baseQuantity: l.baseQuantity, listPrice: l.listPrice, unitPrice: l.unitPrice, discountAmount: l.discountAmount, taxRate: l.taxRate, taxAmount: calc.lines[i].taxAmount, lineTotal: calc.lines[i].lineTotal, note: l.note })) },
        },
      });
      await this.audit.log(tx, { action: 'order.create', entityType: 'SalesOrder', entityId: o.id, entityCode: code, after: { totalAmount: calc.totalAmount.toString(), lines: resolved.length, source: dto.source ?? 'POS' } });
      if (dto.confirm !== false) await this.confirmInTx(tx, user, o.id, undefined);
      for (const d of dto.deposits ?? []) await this.depositInTx(tx, user, o.id, { method: d.method, amount: d.amount, reference: d.reference, cashAccountId: d.cashAccountId });
      if (dto.delivery) await this.deliveries.createInTx(tx, user, { ...dto.delivery, orderId: o.id, branchId: dto.branchId });
      return o.id;
    });
    return this.get(user, id);
  }

  async update(user: RequestUser, id: string, dto: UpdateSalesOrderDto) {
    await this.prisma.tx(async (tx) => {
      const o = await this.lock(tx, user, id);
      if (o.status !== 'DRAFT' && o.status !== 'CONFIRMED') throw Errors.conflict('DOCUMENT_NOT_EDITABLE', 'Đơn đã hoàn tất hoặc đã hủy', { status: o.status });
      if (o.version !== dto.version) throw Errors.conflict('VERSION_CONFLICT', 'Đơn đã được người khác thay đổi, vui lòng tải lại', { current: o.version });
      if (dto.lines && o.status !== 'DRAFT') throw Errors.conflict('DOCUMENT_NOT_EDITABLE', 'Đơn đã xác nhận (đang giữ tồn): hủy xác nhận hoặc hủy đơn để đổi dòng hàng', { status: o.status });
      if (dto.warehouseId && o.status !== 'DRAFT') throw Errors.conflict('DOCUMENT_NOT_EDITABLE', 'Không đổi kho của đơn đã giữ tồn');
      if (dto.warehouseId) await this.access.assertWarehouse(user, dto.warehouseId, o.branchId, tx);
      const customerId = dto.customerId === undefined ? o.customerId : dto.customerId;
      const customer = customerId ? await this.invoices.assertCustomer(tx, customerId) : null;
      if (dto.customerId !== undefined && D(o.depositAmount).greaterThan(0)) throw Errors.conflict('ORDER_HAS_DEPOSIT', 'Đơn đã nhận cọc, không đổi khách hàng');
      const sellerId = dto.sellerId ? await this.invoices.resolveSeller(tx, user, dto.sellerId) : undefined;
      const priceBookId = dto.priceBookId === undefined ? o.priceBookId : dto.priceBookId;
      if (priceBookId && dto.priceBookId !== undefined) await this.invoices.assertPriceBook(tx, user, priceBookId, o.branchId, customer?.groupName ?? null);
      let data: Prisma.SalesOrderUncheckedUpdateInput = { note: dto.note, expectedAt: dto.expectedAt === undefined ? undefined : dto.expectedAt ? new Date(dto.expectedAt) : null, sellerId, customerId: dto.customerId === undefined ? undefined : dto.customerId, priceBookId: dto.priceBookId === undefined ? undefined : dto.priceBookId, warehouseId: dto.warehouseId, version: { increment: 1 } };
      if (dto.lines || dto.discountAmount !== undefined) {
        const existing = await tx.salesOrderLine.findMany({ where: { orderId: id }, orderBy: { lineNo: 'asc' } });
        const input = dto.lines ?? existing.map((l) => ({ variantId: l.variantId, batchId: l.batchId ?? undefined, productUnitId: l.productUnitId ?? undefined, quantity: l.quantity.toString(), unitPrice: l.unitPrice.toString(), discountAmount: l.discountAmount.toString(), note: l.note ?? undefined }));
        const previous = new Map(existing.map((l) => [`${l.variantId}|${l.productUnitId ?? ''}`, { unitPrice: D(l.unitPrice), listPrice: D(l.listPrice) }]));
        const resolved = await this.invoices.resolveLines(tx, user, input, priceBookId, previous, !dto.lines);
        const docDiscount = money(dto.discountAmount ?? o.discountAmount);
        if (dto.discountAmount !== undefined && docDiscount.greaterThan(0) && !hasPermission(user.permissions, 'invoice.discount')) throw Errors.forbidden('Thiếu quyền: invoice.discount');
        const calc = await this.invoices.compute(tx, resolved, docDiscount);
        if (D(o.depositAmount).greaterThan(calc.totalAmount)) throw Errors.conflict('ORDER_HAS_DEPOSIT', 'Tổng đơn mới thấp hơn tiền đã cọc; hoàn bớt cọc trước', { deposit: o.depositAmount.toString(), total: calc.totalAmount.toString() });
        data = { ...data, subtotal: calc.subtotal, discountAmount: docDiscount, taxAmount: calc.taxAmount, totalAmount: calc.totalAmount, lines: { deleteMany: {}, create: resolved.map((l, i) => ({ tenantId: user.tenantId, lineNo: i + 1, variantId: l.variantId, batchId: l.batchId, productUnitId: l.productUnitId, unitName: l.unitName, conversionFactor: l.conversionFactor, quantity: l.quantity, baseQuantity: l.baseQuantity, listPrice: l.listPrice, unitPrice: l.unitPrice, discountAmount: l.discountAmount, taxRate: l.taxRate, taxAmount: calc.lines[i].taxAmount, lineTotal: calc.lines[i].lineTotal, note: l.note })) } };
      }
      await tx.salesOrder.update({ where: { id }, data });
      await this.audit.log(tx, { action: 'order.update', entityType: 'SalesOrder', entityId: id, entityCode: o.code, before: { version: o.version }, after: { version: o.version + 1 } });
    });
    return this.get(user, id);
  }

  async remove(user: RequestUser, id: string) {
    await this.prisma.tx(async (tx) => {
      const o = await this.lock(tx, user, id);
      if (o.status !== 'DRAFT') throw Errors.conflict('DOCUMENT_NOT_EDITABLE', 'Chỉ xóa được phiếu tạm (đơn chưa xác nhận); dùng hủy đơn', { status: o.status });
      if (D(o.depositAmount).greaterThan(0)) throw Errors.conflict('ORDER_HAS_DEPOSIT', 'Đơn đã nhận cọc: hãy hủy đơn để hoàn cọc');
      await tx.salesOrder.delete({ where: { id } });
      await this.audit.log(tx, { action: 'order.delete', entityType: 'SalesOrder', entityId: id, entityCode: o.code });
    });
  }

  // ---------------------------------------------------------------- confirm (giữ tồn, BR-101)
  async confirm(user: RequestUser, id: string, version?: number) {
    await this.prisma.tx((tx) => this.confirmInTx(tx, user, id, version));
    return this.get(user, id);
  }

  private async confirmInTx(tx: TxClient, user: RequestUser, id: string, expectedVersion: number | undefined) {
    const o = await this.lock(tx, user, id);
    if (o.status !== 'DRAFT') throw Errors.conflict('DOCUMENT_NOT_DRAFT', 'Đơn không ở trạng thái phiếu tạm', { status: o.status });
    if (expectedVersion !== undefined && o.version !== expectedVersion) throw Errors.conflict('VERSION_CONFLICT', 'Đơn đã được thay đổi ở nơi khác', { current: o.version });
    const ops = await this.reservationOps(tx, id);
    for (const op of ops) await this.reservations.reserveInTx(tx, user, { warehouseId: o.warehouseId, variantId: op.variantId, batchId: op.batchId, quantity: op.quantity, documentType: 'SALES_ORDER', documentId: id });
    await tx.salesOrder.update({ where: { id }, data: { status: 'CONFIRMED', confirmedAt: new Date(), version: { increment: 1 } } });
    await this.audit.log(tx, { action: 'order.confirm', entityType: 'SalesOrder', entityId: id, entityCode: o.code, after: { reserved: ops.length } });
    await this.outbox.enqueue(tx, { eventType: 'order.confirmed', aggregateType: 'SalesOrder', aggregateId: id, payload: { code: o.code, branchId: o.branchId, customerId: o.customerId, totalAmount: o.totalAmount.toString() } });
  }

  /** GOODS lines (combos expanded to components) merged per (variant, batch) and sorted for a stable lock order. */
  private async reservationOps(tx: TxClient, orderId: string) {
    const lines = await tx.salesOrderLine.findMany({ where: { orderId } });
    const variants = await tx.productVariant.findMany({ where: { id: { in: lines.map((l) => l.variantId) } }, include: { product: { include: { comboItems: true } } } });
    const vById = new Map(variants.map((v) => [v.id, v]));
    const merged = new Map<string, { variantId: string; batchId: string | null; quantity: Prisma.Decimal }>();
    const add = (variantId: string, batchId: string | null, q: Prisma.Decimal) => { const k = `${variantId}|${batchId ?? ''}`; const prev = merged.get(k); merged.set(k, { variantId, batchId, quantity: (prev?.quantity ?? ZERO).plus(q) }); };
    for (const l of lines) {
      const v = vById.get(l.variantId);
      if (!v) throw Errors.notFound('Hàng hóa', l.variantId);
      if (v.product.type === 'GOODS') add(l.variantId, l.batchId, D(l.baseQuantity));
      else if (v.product.type === 'COMBO') for (const ci of v.product.comboItems) add(ci.componentVariantId, null, D(l.baseQuantity).times(D(ci.quantity)));
    }
    return Array.from(merged.values()).sort(StockEngineService.sortKey);
  }

  /** Back to DRAFT: releases the reservations (lines can then be edited). */
  async unconfirm(user: RequestUser, id: string) {
    await this.prisma.tx(async (tx) => {
      const o = await this.lock(tx, user, id);
      if (o.status !== 'CONFIRMED') throw Errors.conflict('DOCUMENT_NOT_POSTED', 'Đơn chưa được xác nhận', { status: o.status });
      await this.releaseReservations(tx, user, id, 'RELEASED');
      await tx.salesOrder.update({ where: { id }, data: { status: 'DRAFT', confirmedAt: null, version: { increment: 1 } } });
      await this.audit.log(tx, { action: 'order.unconfirm', entityType: 'SalesOrder', entityId: id, entityCode: o.code });
    });
    return this.get(user, id);
  }

  private async releaseReservations(tx: TxClient, user: RequestUser, orderId: string, status: 'RELEASED' | 'CONSUMED') {
    const rs = (await tx.stockReservation.findMany({ where: { documentType: 'SALES_ORDER', documentId: orderId, status: 'ACTIVE' } })).sort(StockEngineService.sortKey);
    for (const r of rs) await this.reservations.releaseInTx(tx, user, r.id, status);
    return rs.length;
  }

  // ---------------------------------------------------------------- deposit (tiền cọc, BR-103)
  async deposit(user: RequestUser, id: string, dto: DepositDto) {
    await this.prisma.tx((tx) => this.depositInTx(tx, user, id, dto));
    return this.get(user, id);
  }

  private async depositInTx(tx: TxClient, user: RequestUser, id: string, dto: { method: string; amount: string; cashAccountId?: string; reference?: string; note?: string }) {
    const o = await this.lock(tx, user, id);
    if (o.status !== 'DRAFT' && o.status !== 'CONFIRMED') throw Errors.conflict('DOCUMENT_NOT_POSTED', 'Chỉ nhận cọc cho đơn đang xử lý', { status: o.status });
    const amount = money(dto.amount);
    const shiftRows = await tx.$queryRaw<{ id: string }[]>`SELECT id FROM shifts WHERE tenant_id = ${user.tenantId}::uuid AND branch_id = ${o.branchId}::uuid AND user_id = ${user.id}::uuid AND status = 'OPEN' FOR SHARE`;
    return this.payments.createInTx(tx, user, { branchId: o.branchId, direction: 'IN', method: dto.method as PaymentMethod, partyType: o.customerId ? 'CUSTOMER' : null, partyId: o.customerId, shiftId: shiftRows[0]?.id ?? null, amount, reference: dto.reference, note: dto.note ?? `Tiền cọc đơn ${o.code}`, cashAccountId: dto.cashAccountId, allocations: [{ documentType: 'SALES_ORDER', documentId: id, amount }], permissionChecked: true });
  }

  // ---------------------------------------------------------------- complete → invoice (BR-104)
  async complete(user: RequestUser, id: string, dto: CompleteOrderDto) {
    for (const perm of ['invoice.create', 'invoice.complete']) if (!hasPermission(user.permissions, perm)) throw Errors.forbidden(`Thiếu quyền: ${perm}`);
    const invoiceId = await this.prisma.tx(async (tx) => {
      const o = await this.lock(tx, user, id);
      if (o.status !== 'DRAFT' && o.status !== 'CONFIRMED') throw Errors.conflict('DOCUMENT_NOT_POSTED', 'Đơn đã hoàn tất hoặc đã hủy', { status: o.status });
      if (dto.version !== undefined && o.version !== dto.version) throw Errors.conflict('VERSION_CONFLICT', 'Đơn đã được thay đổi ở nơi khác', { current: o.version });
      const warehouseId = dto.warehouseId ?? o.warehouseId;
      if (dto.warehouseId && dto.warehouseId !== o.warehouseId && o.status === 'CONFIRMED') throw Errors.validation('Đơn đang giữ tồn ở kho khác; hủy xác nhận trước khi đổi kho xuất');
      await this.access.assertWarehouse(user, warehouseId, o.branchId, tx);
      const lines = await tx.salesOrderLine.findMany({ where: { orderId: id }, orderBy: { lineNo: 'asc' } });
      // lock order: order → sequences (invoice + payment codes) → reservations/stock → party → fund
      const invoiceCode = await this.numbering.next(tx, 'INVOICE');
      const paymentsIn: InvoicePaymentDto[] = dto.payments ?? [];
      const codes: string[] = [];
      for (let i = 0; i < paymentsIn.length; i++) codes.push(await this.payments.nextCode(tx, 'IN'));
      const draft = await this.invoices.createInTx(tx, user, {
        branchId: o.branchId, warehouseId, customerId: o.customerId ?? undefined, sellerId: o.sellerId ?? undefined, priceBookId: o.priceBookId ?? undefined, discountAmount: o.discountAmount.toString(), note: o.note ? `Đơn ${o.code}: ${o.note}` : `Từ đơn đặt hàng ${o.code}`, applyPromotions: false,
        lines: lines.map((l) => ({ variantId: l.variantId, batchId: l.batchId ?? undefined, productUnitId: l.productUnitId ?? undefined, quantity: l.quantity.toString(), unitPrice: l.unitPrice.toString(), discountAmount: l.discountAmount.toString(), note: l.note ?? undefined })),
      }, true, invoiceCode, { trustedPrices: true });
      // deposits move from the order to the invoice (same vouchers, ledger untouched)
      const deposit = D(o.depositAmount);
      if (deposit.greaterThan(0)) {
        await tx.paymentAllocation.updateMany({ where: { documentType: 'SALES_ORDER', documentId: id }, data: { documentType: 'INVOICE', documentId: draft.id } });
        await tx.invoice.update({ where: { id: draft.id }, data: { paidAmount: { increment: deposit } } });
        await tx.salesOrder.update({ where: { id }, data: { depositAmount: ZERO } });
      }
      if (o.status === 'CONFIRMED') await this.releaseReservations(tx, user, id, 'CONSUMED');
      await this.invoices.completeInTx(tx, user, draft.id, paymentsIn, undefined, codes, [], deposit);
      await tx.salesOrder.update({ where: { id }, data: { status: 'COMPLETED', completedAt: new Date(), invoiceId: draft.id, version: { increment: 1 } } });
      // the delivery (if any) follows the invoice from now on
      await tx.delivery.updateMany({ where: { orderId: id }, data: { invoiceId: draft.id } });
      await this.audit.log(tx, { action: 'order.complete', entityType: 'SalesOrder', entityId: id, entityCode: o.code, after: { invoiceId: draft.id, invoiceCode, deposit: deposit.toString() } });
      await this.outbox.enqueue(tx, { eventType: 'order.completed', aggregateType: 'SalesOrder', aggregateId: id, payload: { code: o.code, invoiceCode } });
      return draft.id;
    });
    return { order: await this.get(user, id), invoice: await this.invoices.get(user, invoiceId) };
  }

  // ---------------------------------------------------------------- cancel (BR-105)
  async cancel(user: RequestUser, id: string, dto: CancelOrderDto) {
    await this.prisma.tx(async (tx) => {
      const o = await this.lock(tx, user, id);
      if (o.status !== 'DRAFT' && o.status !== 'CONFIRMED') throw Errors.conflict('DOCUMENT_NOT_POSTED', 'Đơn đã hoàn tất hoặc đã hủy', { status: o.status });
      const delivery = await tx.delivery.findFirst({ where: { orderId: id } });
      if (delivery && ['PICKING', 'DELIVERING', 'RETURNING'].includes(delivery.status)) throw Errors.conflict('ORDER_HAS_DELIVERY', `Vận đơn ${delivery.code} đang giao; hủy vận đơn trước`, { deliveryCode: delivery.code });
      if (o.status === 'CONFIRMED') await this.releaseReservations(tx, user, id, 'RELEASED');
      const action = dto.depositAction ?? 'REFUND';
      const allocs = await tx.paymentAllocation.findMany({ where: { documentType: 'SALES_ORDER', documentId: id }, include: { payment: { select: { id: true, status: true, amount: true, allocated: true } } } });
      const posted = allocs.filter((a) => a.payment.status === 'POSTED');
      if (action === 'CREDIT') {
        if (!o.customerId) throw Errors.validation('Khách lẻ không có công nợ: tiền cọc phải được hoàn lại');
        // the voucher stays as an unallocated prepayment on the customer's account
        for (const a of posted) {
          await tx.paymentAllocation.delete({ where: { id: a.id } });
          await tx.payment.update({ where: { id: a.paymentId }, data: { allocated: { decrement: a.amount } } });
        }
        await tx.salesOrder.update({ where: { id }, data: { depositAmount: ZERO } });
      } else {
        for (const pid of Array.from(new Set(posted.map((a) => a.paymentId))).sort()) await this.payments.cancelInTx(tx, user, pid, `Hủy đơn ${o.code}: ${dto.reason}`, { onlyDocument: { type: 'SALES_ORDER', id } });
      }
      if (delivery && delivery.status === 'PENDING') await this.deliveries.setStatusInTx(tx, user, delivery.id, { status: 'CANCELLED', note: `Hủy đơn ${o.code}` });
      await tx.salesOrder.update({ where: { id }, data: { status: 'CANCELLED', cancelledAt: new Date(), cancelledById: user.id, cancelReason: dto.reason, version: { increment: 1 } } });
      await this.audit.log(tx, { action: 'order.cancel', entityType: 'SalesOrder', entityId: id, entityCode: o.code, before: { status: o.status }, after: { status: 'CANCELLED', reason: dto.reason, depositAction: action } });
      await this.outbox.enqueue(tx, { eventType: 'order.cancelled', aggregateType: 'SalesOrder', aggregateId: id, payload: { code: o.code, reason: dto.reason } });
    });
    return this.get(user, id);
  }

  // ---------------------------------------------------------------- helpers
  private async lock(tx: TxClient, user: RequestUser, id: string) {
    const rows = await tx.$queryRaw<{ id: string }[]>`SELECT id FROM sales_orders WHERE id = ${id}::uuid AND tenant_id = ${user.tenantId}::uuid FOR UPDATE`;
    if (!rows[0]) throw Errors.notFound('Đơn đặt hàng', id);
    const o = await tx.salesOrder.findFirstOrThrow({ where: { id } });
    this.access.assertBranch(user, o.branchId);
    return o;
  }
}
