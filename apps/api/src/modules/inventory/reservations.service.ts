import { Injectable } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { Errors } from '../../common/errors/app-error';
import { paginated, skipTake } from '../../common/pagination';
import { D, qty as toQty } from '../../common/utils/decimal';
import { AccessService } from '../../infra/access/access.service';
import { AuditService } from '../../infra/audit/audit.service';
import { RequestUser } from '../../infra/cls/request-context';
import { PrismaService, TxClient } from '../../infra/prisma/prisma.service';
import { CreateReservationDto, ReservationQueryDto } from './dto/inventory.dto';
import { StockEngineService } from './stock-engine.service';

/** Stock reservations (BR-21): reserve/release change `reserved`, never `on_hand`. */
@Injectable()
export class ReservationsService {
  constructor(private readonly prisma: PrismaService, private readonly engine: StockEngineService, private readonly access: AccessService, private readonly audit: AuditService) {}

  async list(user: RequestUser, q: ReservationQueryDto) {
    const whWhere = await this.access.warehouseWhere(user);
    const where: Prisma.StockReservationWhereInput = { AND: [whWhere, { ...(q.warehouseId ? { warehouseId: q.warehouseId } : {}), ...(q.variantId ? { variantId: q.variantId } : {}), ...(q.status ? { status: q.status as any } : {}) }] };
    const [rows, total] = await Promise.all([
      this.prisma.db.stockReservation.findMany({ where, include: { variant: { select: { sku: true, name: true } }, warehouse: { select: { name: true } } }, ...skipTake(q), orderBy: { createdAt: 'desc' } }),
      this.prisma.db.stockReservation.count({ where }),
    ]);
    return paginated(rows, total, q);
  }

  async create(user: RequestUser, dto: CreateReservationDto) {
    await this.access.assertWarehouse(user, dto.warehouseId);
    return this.prisma.tx((tx) => this.reserveInTx(tx, user, { ...dto, quantity: toQty(dto.quantity) }));
  }

  async reserveInTx(tx: TxClient, user: RequestUser, p: { warehouseId: string; variantId: string; batchId?: string | null; quantity: Prisma.Decimal; documentType: string; documentId: string; expiresAt?: Date }) {
    if (!p.quantity.greaterThan(0)) throw Errors.validation('Số lượng giữ phải lớn hơn 0');
    await this.engine.lockAndValidateVariant(tx, user.tenantId, p.variantId, p.batchId); // same GOODS/batch rules as apply()
    const bal = await this.engine.lockBalance(tx, user.tenantId, p.warehouseId, p.variantId, p.batchId ?? null);
    const available = D(bal.on_hand).minus(D(bal.reserved));
    const allowNegative = await this.engine.allowNegative(tx);
    if (!allowNegative && available.lessThan(p.quantity)) throw Errors.insufficientStock({ variantId: p.variantId, warehouseId: p.warehouseId, available: available.toString(), requested: p.quantity.toString() });
    await tx.$executeRaw`UPDATE stock_balances SET reserved = reserved + ${p.quantity.toString()}::numeric, updated_at = now() WHERE id = ${bal.id}::uuid`;
    const r = await tx.stockReservation.create({ data: { tenantId: user.tenantId, warehouseId: p.warehouseId, variantId: p.variantId, batchId: p.batchId ?? null, quantity: p.quantity, documentType: p.documentType, documentId: p.documentId, expiresAt: p.expiresAt } });
    await this.audit.log(tx, { action: 'inventory.reservation.create', entityType: 'StockReservation', entityId: r.id, after: { variantId: p.variantId, quantity: p.quantity.toString(), documentType: p.documentType, documentId: p.documentId } });
    return r;
  }

  async release(user: RequestUser, id: string) {
    return this.prisma.tx((tx) => this.releaseInTx(tx, user, id, 'RELEASED'));
  }

  /** status RELEASED (cancelled order) or CONSUMED (order shipped – caller also applies the stock change with skipAvailabilityCheck). */
  async releaseInTx(tx: TxClient, user: RequestUser, id: string, status: 'RELEASED' | 'CONSUMED') {
    const rows = await tx.$queryRaw<{ id: string }[]>`SELECT id FROM stock_reservations WHERE id = ${id}::uuid AND tenant_id = ${user.tenantId}::uuid FOR UPDATE`;
    if (!rows[0]) throw Errors.notFound('Giữ tồn', id);
    const r = await tx.stockReservation.findFirstOrThrow({ where: { id } });
    await this.access.assertWarehouse(user, r.warehouseId, undefined, tx);
    if (r.status !== 'ACTIVE') throw Errors.conflict('RESERVATION_NOT_ACTIVE', 'Giữ tồn không còn hiệu lực', { status: r.status });
    await this.engine.lockVariant(tx, user.tenantId, r.variantId);
    const bal = await this.engine.lockBalance(tx, user.tenantId, r.warehouseId, r.variantId, r.batchId);
    await tx.$executeRaw`UPDATE stock_balances SET reserved = GREATEST(reserved - ${r.quantity.toString()}::numeric, 0), updated_at = now() WHERE id = ${bal.id}::uuid`;
    const updated = await tx.stockReservation.update({ where: { id }, data: { status, releasedAt: new Date() } });
    await this.audit.log(tx, { action: `inventory.reservation.${status.toLowerCase()}`, entityType: 'StockReservation', entityId: id, before: { status: 'ACTIVE' }, after: { status } });
    return updated;
  }
}
