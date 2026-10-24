import { Injectable } from '@nestjs/common';
import { DeliveryStatus, PaymentMethod, Prisma } from '@prisma/client';
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
import { CreateDeliveryDto, DeliveryInfoDto, DeliveryQueryDto, DeliveryStatusDto, UpdateDeliveryDto } from './dto/orders.dto';

const FINAL: DeliveryStatus[] = ['DELIVERED', 'RETURNED', 'CANCELLED'];
const NEXT: Record<DeliveryStatus, DeliveryStatus[]> = {
  PENDING: ['PICKING', 'DELIVERING', 'CANCELLED'],
  PICKING: ['DELIVERING', 'PENDING', 'CANCELLED'],
  DELIVERING: ['DELIVERED', 'RETURNING', 'CANCELLED'],
  RETURNING: ['RETURNED', 'DELIVERED'],
  DELIVERED: [],
  RETURNED: [],
  CANCELLED: [],
};

const deliveryInclude = {
  order: { select: { id: true, code: true, status: true, totalAmount: true, depositAmount: true } },
  invoice: { select: { id: true, code: true, status: true, totalAmount: true, paidAmount: true } },
  customer: { select: { id: true, code: true, name: true, phone: true } },
  branch: { select: { id: true, code: true, name: true } },
  events: { orderBy: { createdAt: 'asc' as const } },
} satisfies Prisma.DeliveryInclude;

/** Vận đơn (BR-106..BR-108): trạng thái giao hàng có lịch sử, thu hộ COD về quỹ, phí giao hàng là thu khác. */
@Injectable()
export class DeliveriesService {
  constructor(private readonly prisma: PrismaService, private readonly numbering: NumberingService, private readonly audit: AuditService, private readonly outbox: OutboxService, private readonly access: AccessService, private readonly payments: PaymentsService) {}

  async list(user: RequestUser, q: DeliveryQueryDto) {
    const filters: Prisma.DeliveryWhereInput = {
      ...(q.status ? { status: q.status as DeliveryStatus } : {}),
      ...(q.branchId ? { branchId: q.branchId } : {}),
      ...(q.carrier ? { carrier: { contains: q.carrier, mode: 'insensitive' } } : {}),
      ...(q.codPending === 'true' ? { codCollected: false, codAmount: { gt: 0 }, status: { notIn: ['CANCELLED', 'RETURNED'] } } : {}),
      ...(q.from || q.to ? { createdAt: { ...(q.from ? { gte: new Date(q.from) } : {}), ...(q.to ? { lte: new Date(q.to) } : {}) } } : {}),
      ...(q.search ? { OR: [{ code: { contains: q.search, mode: 'insensitive' } }, { receiverName: { contains: q.search, mode: 'insensitive' } }, { receiverPhone: { contains: q.search } }, { trackingCode: { contains: q.search, mode: 'insensitive' } }, { address: { contains: q.search, mode: 'insensitive' } }, { order: { code: { contains: q.search, mode: 'insensitive' } } }, { invoice: { code: { contains: q.search, mode: 'insensitive' } } }] } : {}),
    };
    const where: Prisma.DeliveryWhereInput = { AND: [this.access.branchWhere(user), filters] };
    const [rows, total] = await Promise.all([
      this.prisma.db.delivery.findMany({ where, include: { order: { select: { id: true, code: true } }, invoice: { select: { id: true, code: true, totalAmount: true, paidAmount: true } }, customer: { select: { id: true, name: true, phone: true } }, branch: { select: { id: true, name: true } } }, ...skipTake(q), orderBy: orderBy(q, ['createdAt', 'code', 'status', 'expectedAt', 'deliveredAt', 'codAmount'], 'createdAt') }),
      this.prisma.db.delivery.count({ where }),
    ]);
    return paginated(rows, total, q);
  }

  async get(user: RequestUser, id: string) {
    const d = await this.prisma.db.delivery.findFirst({ where: { id, ...this.access.branchWhere(user) }, include: deliveryInclude });
    if (!d) throw Errors.notFound('Vận đơn', id);
    return { ...d, allowedNext: NEXT[d.status] };
  }

  async create(user: RequestUser, dto: CreateDeliveryDto) {
    const id = await this.prisma.tx((tx) => this.createInTx(tx, user, dto));
    return this.get(user, id);
  }

  async createInTx(tx: TxClient, user: RequestUser, dto: CreateDeliveryDto & DeliveryInfoDto): Promise<string> {
    if (!dto.orderId && !dto.invoiceId) throw Errors.validation('Vận đơn phải gắn với đơn đặt hàng hoặc hóa đơn');
    let branchId = dto.branchId; let customerId: string | null = null; let invoiceId = dto.invoiceId ?? null; let due = ZERO;
    if (dto.orderId) {
      const o = await tx.salesOrder.findFirst({ where: { id: dto.orderId } });
      if (!o) throw Errors.notFound('Đơn đặt hàng', dto.orderId);
      if (o.status === 'CANCELLED') throw Errors.conflict('DOCUMENT_NOT_POSTED', 'Đơn đã hủy');
      if (await tx.delivery.findFirst({ where: { orderId: o.id } })) throw Errors.conflict('DELIVERY_EXISTS', 'Đơn đã có vận đơn');
      branchId = branchId ?? o.branchId; customerId = o.customerId; invoiceId = invoiceId ?? o.invoiceId; due = D(o.totalAmount).minus(D(o.depositAmount));
    }
    if (invoiceId) {
      const inv = await tx.invoice.findFirst({ where: { id: invoiceId } });
      if (!inv) throw Errors.notFound('Hóa đơn', invoiceId);
      if (inv.status === 'CANCELLED') throw Errors.conflict('DOCUMENT_NOT_POSTED', 'Hóa đơn đã hủy');
      branchId = branchId ?? inv.branchId; customerId = customerId ?? inv.customerId; due = D(inv.totalAmount).minus(D(inv.paidAmount));
    }
    if (!branchId) throw Errors.validation('Thiếu chi nhánh');
    this.access.assertBranch(user, branchId);
    const fee = money(dto.shippingFee ?? 0);
    const cod = dto.codAmount !== undefined ? money(dto.codAmount) : Prisma.Decimal.max(ZERO, due).plus(fee);
    const code = await this.numbering.next(tx, 'DELIVERY');
    const d = await tx.delivery.create({
      data: {
        tenantId: user.tenantId, branchId, code, orderId: dto.orderId ?? null, invoiceId, customerId, receiverName: dto.receiverName, receiverPhone: dto.receiverPhone, address: dto.address, ward: dto.ward, district: dto.district, province: dto.province,
        carrier: dto.carrier, trackingCode: dto.trackingCode, shippingFee: fee, shippingCost: money(dto.shippingCost ?? 0), codAmount: cod, weightGram: dto.weightGram, expectedAt: dto.expectedAt ? new Date(dto.expectedAt) : null, note: dto.note, createdById: user.id,
        events: { create: { status: 'PENDING', note: 'Tạo vận đơn', createdById: user.id } },
      },
    });
    await this.audit.log(tx, { action: 'delivery.create', entityType: 'Delivery', entityId: d.id, entityCode: code, after: { orderId: dto.orderId ?? null, invoiceId, cod: cod.toString() } });
    return d.id;
  }

  async update(user: RequestUser, id: string, dto: UpdateDeliveryDto) {
    await this.prisma.tx(async (tx) => {
      const d = await this.lock(tx, user, id);
      if (FINAL.includes(d.status)) throw Errors.conflict('DOCUMENT_NOT_EDITABLE', 'Vận đơn đã kết thúc', { status: d.status });
      await tx.delivery.update({ where: { id }, data: { ...dto, shippingFee: dto.shippingFee === undefined ? undefined : money(dto.shippingFee), shippingCost: dto.shippingCost === undefined ? undefined : money(dto.shippingCost), codAmount: dto.codAmount === undefined ? undefined : money(dto.codAmount), expectedAt: dto.expectedAt === undefined ? undefined : dto.expectedAt ? new Date(dto.expectedAt) : null } });
      await this.audit.log(tx, { action: 'delivery.update', entityType: 'Delivery', entityId: id, entityCode: d.code, after: dto as Record<string, unknown> });
    });
    return this.get(user, id);
  }

  async setStatus(user: RequestUser, id: string, dto: DeliveryStatusDto) {
    await this.prisma.tx((tx) => this.setStatusInTx(tx, user, id, dto));
    return this.get(user, id);
  }

  /** Status machine with history; DELIVERED may record the COD money (invoice collection + shipping fee as other income). */
  async setStatusInTx(tx: TxClient, user: RequestUser, id: string, dto: DeliveryStatusDto) {
    const d = await this.lock(tx, user, id);
    const target = dto.status as DeliveryStatus;
    if (!NEXT[d.status].includes(target)) throw Errors.conflict('DELIVERY_TRANSITION', `Không chuyển được từ ${d.status} sang ${target}`, { from: d.status, to: target, allowed: NEXT[d.status] });
    let codPayments: string[] = [];
    if (target === 'DELIVERED' && dto.collectCod) {
      if (d.codCollected) throw Errors.conflict('COD_COLLECTED', 'Tiền thu hộ đã được ghi nhận');
      const amount = money(dto.collectCod.amount ?? d.codAmount);
      if (amount.greaterThan(0)) codPayments = await this.collectCod(tx, user, d, amount, dto.collectCod);
    }
    await tx.delivery.update({ where: { id }, data: { status: target, deliveredAt: target === 'DELIVERED' ? new Date() : undefined, codCollected: codPayments.length ? true : undefined, events: { create: { status: target, note: dto.note, createdById: user.id } } } });
    await this.audit.log(tx, { action: 'delivery.status', entityType: 'Delivery', entityId: id, entityCode: d.code, before: { status: d.status }, after: { status: target, note: dto.note, codPayments } });
    await this.outbox.enqueue(tx, { eventType: 'delivery.status_changed', aggregateType: 'Delivery', aggregateId: id, payload: { code: d.code, from: d.status, to: target } });
  }

  /** Mark COD as collected later (e.g. the carrier remits weekly). */
  async collectCodLater(user: RequestUser, id: string, dto: { method: string; amount?: string; cashAccountId?: string; reference?: string }) {
    await this.prisma.tx(async (tx) => {
      const d = await this.lock(tx, user, id);
      if (d.status !== 'DELIVERED') throw Errors.conflict('DELIVERY_NOT_DELIVERED', 'Chỉ ghi nhận thu hộ cho vận đơn đã giao', { status: d.status });
      if (d.codCollected) throw Errors.conflict('COD_COLLECTED', 'Tiền thu hộ đã được ghi nhận');
      const amount = money(dto.amount ?? d.codAmount);
      if (amount.lessThanOrEqualTo(0)) throw Errors.validation('Số tiền thu hộ phải lớn hơn 0');
      const codes = await this.collectCod(tx, user, d, amount, dto);
      await tx.delivery.update({ where: { id }, data: { codCollected: true, events: { create: { status: 'DELIVERED', note: `Thu hộ ${amount.toString()} (${codes.join(', ')})`, createdById: user.id } } } });
    });
    return this.get(user, id);
  }

  private async collectCod(tx: TxClient, user: RequestUser, d: { id: string; code: string; branchId: string; invoiceId: string | null; customerId: string | null; shippingFee: Prisma.Decimal }, amount: Prisma.Decimal, p: { method: string; cashAccountId?: string; reference?: string }) {
    const codes: string[] = [];
    let remaining = amount;
    if (d.invoiceId) {
      const inv = await tx.invoice.findFirst({ where: { id: d.invoiceId } });
      if (inv && inv.status === 'COMPLETED') {
        const due = D(inv.totalAmount).minus(D(inv.paidAmount));
        const toInvoice = Prisma.Decimal.min(remaining, Prisma.Decimal.max(ZERO, due));
        if (toInvoice.greaterThan(0)) {
          const pay = await this.payments.createInTx(tx, user, { branchId: d.branchId, direction: 'IN', method: p.method as PaymentMethod, partyType: inv.customerId ? 'CUSTOMER' : null, partyId: inv.customerId, amount: toInvoice, reference: p.reference, note: `Thu hộ COD vận đơn ${d.code} – hóa đơn ${inv.code}`, cashAccountId: p.cashAccountId, allocations: [{ documentType: 'INVOICE', documentId: inv.id, amount: toInvoice }], permissionChecked: true });
          codes.push(pay.code); remaining = remaining.minus(toInvoice);
        }
      }
    }
    if (remaining.greaterThan(0)) {
      // shipping fee collected from the customer (or an over-collection) → other income under a fixed category
      let cat = await tx.paymentCategory.findFirst({ where: { direction: 'IN', name: 'Phí giao hàng thu hộ' } });
      if (!cat) cat = await tx.paymentCategory.create({ data: { tenantId: user.tenantId, direction: 'IN', name: 'Phí giao hàng thu hộ' } });
      const pay = await this.payments.createInTx(tx, user, { branchId: d.branchId, direction: 'IN', method: p.method as PaymentMethod, partyType: null, partyId: null, amount: remaining, reference: p.reference, note: `Phí giao hàng vận đơn ${d.code}`, cashAccountId: p.cashAccountId, categoryId: cat.id, permissionChecked: true });
      codes.push(pay.code);
    }
    return codes;
  }

  private async lock(tx: TxClient, user: RequestUser, id: string) {
    const rows = await tx.$queryRaw<{ id: string }[]>`SELECT id FROM deliveries WHERE id = ${id}::uuid AND tenant_id = ${user.tenantId}::uuid FOR UPDATE`;
    if (!rows[0]) throw Errors.notFound('Vận đơn', id);
    const d = await tx.delivery.findFirstOrThrow({ where: { id } });
    this.access.assertBranch(user, d.branchId);
    return d;
  }
}
