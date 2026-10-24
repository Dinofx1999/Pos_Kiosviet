import { Injectable } from '@nestjs/common';
import { Prisma, StocktakeStatus } from '@prisma/client';
import { Errors } from '../../common/errors/app-error';
import { orderBy, paginated, skipTake } from '../../common/pagination';
import { D, qty as toQty, ZERO } from '../../common/utils/decimal';
import { AccessService } from '../../infra/access/access.service';
import { AuditService } from '../../infra/audit/audit.service';
import { RequestUser } from '../../infra/cls/request-context';
import { NumberingService } from '../../infra/numbering/numbering.service';
import { OutboxService } from '../../infra/outbox/outbox.service';
import { PrismaService, TxClient } from '../../infra/prisma/prisma.service';
import { CompleteStocktakeDto, CreateStocktakeDto, StocktakeLineDto, StocktakeQueryDto, UpdateStocktakeDto } from './dto/transfers.dto';
import { StockEngineService } from './stock-engine.service';

const DOC_TYPE = 'STOCKTAKE';

const stocktakeInclude = {
  lines: { orderBy: [{ variant: { name: 'asc' as const } }, { batchKey: 'asc' as const }], include: { variant: { select: { id: true, sku: true, barcode: true, name: true, product: { select: { id: true, code: true, name: true, baseUnit: true, trackBatch: true, categoryId: true } } } }, batch: { select: { id: true, batchNo: true, expiryDate: true } } } },
  warehouse: { select: { id: true, code: true, name: true } },
  branch: { select: { id: true, code: true, name: true } },
} satisfies Prisma.StocktakeInclude;

/**
 * Kiểm kho (BR-84..BR-87): lines snapshot the system quantity when they are added; counting is a per-line upsert so several
 * people can count at once; completion posts STOCKTAKE movements for `counted − snapshot` (sales/receipts made while counting
 * are therefore not double-counted) and is blocked if that would make the current on-hand negative.
 */
@Injectable()
export class StocktakesService {
  constructor(
    private readonly prisma: PrismaService, private readonly engine: StockEngineService, private readonly numbering: NumberingService,
    private readonly audit: AuditService, private readonly outbox: OutboxService, private readonly access: AccessService,
  ) {}

  // ---------------------------------------------------------------- queries
  async list(user: RequestUser, q: StocktakeQueryDto) {
    const filters: Prisma.StocktakeWhereInput = {
      ...(q.status ? { status: q.status as StocktakeStatus } : {}),
      ...(q.warehouseId ? { warehouseId: q.warehouseId } : {}),
      ...(q.branchId ? { branchId: q.branchId } : {}),
      ...(q.from || q.to ? { createdAt: { ...(q.from ? { gte: new Date(q.from) } : {}), ...(q.to ? { lte: new Date(q.to) } : {}) } } : {}),
      ...(q.search ? { OR: [{ code: { contains: q.search, mode: 'insensitive' } }, { note: { contains: q.search, mode: 'insensitive' } }] } : {}),
    };
    const where: Prisma.StocktakeWhereInput = { AND: [this.access.branchWhere(user), filters] };
    const [rows, total] = await Promise.all([
      this.prisma.db.stocktake.findMany({ where, include: { warehouse: { select: { id: true, name: true } }, branch: { select: { id: true, name: true } } }, ...skipTake(q), orderBy: orderBy(q, ['createdAt', 'code', 'status', 'completedAt'], 'createdAt') }),
      this.prisma.db.stocktake.count({ where }),
    ]);
    const canCost = user.permissions.has('*') || user.permissions.has('inventory.cost.view');
    return paginated(rows.map((r) => (canCost ? r : { ...r, increaseValue: undefined, decreaseValue: undefined })), total, q);
  }

  async get(user: RequestUser, id: string) {
    const s = await this.prisma.db.stocktake.findFirst({ where: { id, ...this.access.branchWhere(user) }, include: stocktakeInclude });
    if (!s) throw Errors.notFound('Phiếu kiểm kho', id);
    const canCost = user.permissions.has('*') || user.permissions.has('inventory.cost.view');
    const movements = s.status === 'COMPLETED' || s.status === 'CANCELLED' ? await this.prisma.db.stockMovement.findMany({ where: { documentType: DOC_TYPE, documentId: id }, orderBy: { createdAt: 'asc' } }) : [];
    // live on-hand lets the counter see what moved since the snapshot
    const balances = s.status === 'DRAFT' ? await this.prisma.db.stockBalance.findMany({ where: { warehouseId: s.warehouseId, variantId: { in: s.lines.map((l) => l.variantId) } }, select: { variantId: true, batchKey: true, onHand: true } }) : [];
    const live = new Map(balances.map((b) => [`${b.variantId}|${b.batchKey}`, b.onHand]));
    return {
      ...s, increaseValue: canCost ? s.increaseValue : undefined, decreaseValue: canCost ? s.decreaseValue : undefined,
      lines: s.lines.map((l) => ({ ...l, unitCost: canCost ? l.unitCost : undefined, deltaValue: canCost ? l.deltaValue : undefined, currentOnHand: s.status === 'DRAFT' ? live.get(`${l.variantId}|${l.batchKey}`) ?? ZERO : undefined, pendingDelta: l.countedQuantity === null ? null : D(l.countedQuantity).minus(D(l.systemQuantity)) })),
      movements: canCost ? movements : movements.map((m) => ({ ...m, unitCost: undefined, totalCost: undefined })),
    };
  }

  // ---------------------------------------------------------------- create / count
  async create(user: RequestUser, dto: CreateStocktakeDto) {
    const id = await this.prisma.tx(async (tx) => {
      const wh = await this.access.assertWarehouse(user, dto.warehouseId, undefined, tx);
      if (!wh.isActive) throw Errors.validation('Kho không hoạt động', { warehouseId: wh.id });
      const code = await this.numbering.next(tx, 'STOCKTAKE');
      const s = await tx.stocktake.create({ data: { tenantId: user.tenantId, branchId: wh.branchId, warehouseId: wh.id, code, scope: dto.scope ?? 'SELECTED', note: dto.note, createdById: user.id } });
      if ((dto.scope ?? 'SELECTED') === 'ALL') {
        const balances = await tx.stockBalance.findMany({ where: { warehouseId: wh.id, ...(dto.categoryId ? { variant: { product: { categoryId: dto.categoryId } } } : {}), variant: { deletedAt: null, product: { type: 'GOODS', ...(dto.categoryId ? { categoryId: dto.categoryId } : {}) } } }, select: { variantId: true, batchId: true, batchKey: true, onHand: true, variant: { select: { costPrice: true } } } });
        if (balances.length) await tx.stocktakeLine.createMany({ data: balances.map((b) => ({ tenantId: user.tenantId, stocktakeId: s.id, variantId: b.variantId, batchId: b.batchId, batchKey: b.batchKey, systemQuantity: b.onHand, unitCost: b.variant.costPrice })) });
      }
      if (dto.lines?.length) await this.upsertLines(tx, user, s.id, wh.id, dto.lines);
      await this.refreshCounters(tx, s.id);
      await this.audit.log(tx, { action: 'stocktake.create', entityType: 'Stocktake', entityId: s.id, entityCode: code, after: { warehouseId: wh.id, scope: dto.scope ?? 'SELECTED' } });
      return s.id;
    });
    return this.get(user, id);
  }

  async update(user: RequestUser, id: string, dto: UpdateStocktakeDto) {
    await this.prisma.tx(async (tx) => {
      const s = await this.lock(tx, user, id);
      if (s.status !== 'DRAFT') throw Errors.conflict('DOCUMENT_NOT_EDITABLE', 'Phiếu kiểm kho đã chốt', { status: s.status });
      if (s.version !== dto.version) throw Errors.conflict('VERSION_CONFLICT', 'Phiếu đã được người khác thay đổi', { current: s.version });
      await tx.stocktake.update({ where: { id }, data: { note: dto.note, version: { increment: 1 } } });
    });
    return this.get(user, id);
  }

  /** Add lines / record counts. Serialised per stocktake by the row lock; no version needed so several counters can work in parallel. */
  async count(user: RequestUser, id: string, lines: StocktakeLineDto[]) {
    await this.prisma.tx(async (tx) => {
      const s = await this.lock(tx, user, id);
      if (s.status !== 'DRAFT') throw Errors.conflict('DOCUMENT_NOT_EDITABLE', 'Phiếu kiểm kho đã chốt, không nhập số đếm được', { status: s.status });
      await this.upsertLines(tx, user, id, s.warehouseId, lines);
      await this.refreshCounters(tx, id);
      await this.audit.log(tx, { action: 'stocktake.count', entityType: 'Stocktake', entityId: id, entityCode: s.code, after: { lines: lines.length } });
    });
    return this.get(user, id);
  }

  async removeLine(user: RequestUser, id: string, lineId: string) {
    await this.prisma.tx(async (tx) => {
      const s = await this.lock(tx, user, id);
      if (s.status !== 'DRAFT') throw Errors.conflict('DOCUMENT_NOT_EDITABLE', 'Phiếu kiểm kho đã chốt', { status: s.status });
      const line = await tx.stocktakeLine.findFirst({ where: { id: lineId, stocktakeId: id } });
      if (!line) throw Errors.notFound('Dòng kiểm kho', lineId);
      await tx.stocktakeLine.delete({ where: { id: lineId } });
      await this.refreshCounters(tx, id);
    });
    return this.get(user, id);
  }

  /** Re-reads the system quantity of every line (use before counting starts again; counted values are kept). */
  async refreshSnapshot(user: RequestUser, id: string) {
    await this.prisma.tx(async (tx) => {
      const s = await this.lock(tx, user, id);
      if (s.status !== 'DRAFT') throw Errors.conflict('DOCUMENT_NOT_EDITABLE', 'Phiếu kiểm kho đã chốt', { status: s.status });
      const lines = await tx.stocktakeLine.findMany({ where: { stocktakeId: id } });
      const balances = await tx.stockBalance.findMany({ where: { warehouseId: s.warehouseId, variantId: { in: lines.map((l) => l.variantId) } }, select: { variantId: true, batchKey: true, onHand: true } });
      const live = new Map(balances.map((b) => [`${b.variantId}|${b.batchKey}`, b.onHand]));
      for (const l of lines) await tx.stocktakeLine.update({ where: { id: l.id }, data: { systemQuantity: live.get(`${l.variantId}|${l.batchKey}`) ?? ZERO } });
      await tx.stocktake.update({ where: { id }, data: { snapshotAt: new Date(), version: { increment: 1 } } });
      await this.refreshCounters(tx, id);
      await this.audit.log(tx, { action: 'stocktake.refresh', entityType: 'Stocktake', entityId: id, entityCode: s.code, after: { lines: lines.length } });
    });
    return this.get(user, id);
  }

  // ---------------------------------------------------------------- complete (cân bằng kho, BR-86)
  async complete(user: RequestUser, id: string, dto: CompleteStocktakeDto) {
    await this.prisma.tx(async (tx) => {
      const s = await this.lock(tx, user, id);
      if (s.status !== 'DRAFT') throw Errors.conflict('DOCUMENT_NOT_DRAFT', 'Phiếu kiểm kho không ở trạng thái phiếu tạm', { status: s.status });
      if (dto.version !== undefined && s.version !== dto.version) throw Errors.conflict('VERSION_CONFLICT', 'Phiếu đã được thay đổi ở nơi khác, vui lòng tải lại', { current: s.version });
      const wh = await tx.warehouse.findFirst({ where: { id: s.warehouseId } });
      if (!wh?.isActive) throw Errors.validation('Kho không hoạt động');
      const uncountedAs = dto.uncountedAs ?? 'SKIP';
      const allowNegative = await this.engine.allowNegative(tx);
      const lines = (await tx.stocktakeLine.findMany({ where: { stocktakeId: id } })).sort(StockEngineService.sortKey);
      if (!lines.length) throw Errors.validation('Phiếu kiểm kho chưa có dòng nào');
      let incQ = ZERO; let decQ = ZERO; let incV = ZERO; let decV = ZERO; let posted = 0;
      for (const l of lines) {
        const counted = l.countedQuantity !== null ? D(l.countedQuantity) : uncountedAs === 'ZERO' ? ZERO : null;
        if (counted === null) continue;
        const delta = toQty(counted.minus(D(l.systemQuantity)));
        if (delta.isZero()) { await tx.stocktakeLine.update({ where: { id: l.id }, data: { countedQuantity: counted, deltaQuantity: ZERO, deltaValue: ZERO } }); continue; }
        const r = await this.engine.apply(tx, { tenantId: user.tenantId, warehouseId: s.warehouseId, variantId: l.variantId, batchId: l.batchId, quantity: delta, unitCost: null, type: 'STOCKTAKE', documentType: DOC_TYPE, documentId: id, documentCode: s.code, lineId: l.id, reason: 'STOCKTAKE', note: l.note, userId: user.id, allowNegative });
        const value = r.totalCost; // signed with the movement direction in the engine? totalCost is |qty| × cost
        await tx.stocktakeLine.update({ where: { id: l.id }, data: { countedQuantity: counted, deltaQuantity: delta, unitCost: r.unitCost, deltaValue: delta.isNegative() ? D(value).abs().negated() : D(value).abs() } });
        if (delta.isNegative()) { decQ = decQ.plus(delta.abs()); decV = decV.plus(D(value).abs()); } else { incQ = incQ.plus(delta); incV = incV.plus(D(value).abs()); }
        posted++;
      }
      await tx.stocktake.update({ where: { id }, data: { status: 'COMPLETED', completedAt: new Date(), completedById: user.id, uncountedAs, increaseQuantity: incQ, decreaseQuantity: decQ, increaseValue: incV, decreaseValue: decV, version: { increment: 1 } } });
      await this.refreshCounters(tx, id);
      await this.audit.log(tx, { action: 'stocktake.complete', entityType: 'Stocktake', entityId: id, entityCode: s.code, after: { status: 'COMPLETED', posted, increaseQuantity: incQ.toString(), decreaseQuantity: decQ.toString(), increaseValue: incV.toString(), decreaseValue: decV.toString(), uncountedAs } });
      await this.outbox.enqueue(tx, { eventType: 'stocktake.completed', aggregateType: 'Stocktake', aggregateId: id, payload: { code: s.code, warehouseId: s.warehouseId, posted, increaseQuantity: incQ.toString(), decreaseQuantity: decQ.toString() } });
    });
    return this.get(user, id);
  }

  // ---------------------------------------------------------------- cancel (BR-87)
  async cancel(user: RequestUser, id: string, reason: string) {
    await this.prisma.tx(async (tx) => {
      const s = await this.lock(tx, user, id);
      if (s.status === 'CANCELLED') throw Errors.conflict('DOCUMENT_NOT_POSTED', 'Phiếu đã hủy trước đó');
      if (s.status === 'COMPLETED') {
        const allowNegative = await this.engine.allowNegative(tx);
        const movements = (await tx.stockMovement.findMany({ where: { documentType: DOC_TYPE, documentId: id, type: { not: 'REVERSAL' } } })).sort(StockEngineService.sortKey);
        for (const m of movements) await this.engine.apply(tx, { tenantId: user.tenantId, warehouseId: m.warehouseId, variantId: m.variantId, batchId: m.batchId, quantity: D(m.quantity).negated(), unitCost: D(m.unitCost), type: 'REVERSAL', documentType: DOC_TYPE, documentId: id, documentCode: s.code, lineId: m.lineId, reason: 'CANCEL', note: reason, userId: user.id, allowNegative });
      }
      await tx.stocktake.update({ where: { id }, data: { status: 'CANCELLED', cancelledAt: new Date(), cancelledById: user.id, cancelReason: reason, version: { increment: 1 } } });
      await this.audit.log(tx, { action: 'stocktake.cancel', entityType: 'Stocktake', entityId: id, entityCode: s.code, before: { status: s.status }, after: { status: 'CANCELLED', reason } });
      await this.outbox.enqueue(tx, { eventType: 'stocktake.cancelled', aggregateType: 'Stocktake', aggregateId: id, payload: { code: s.code, reason } });
    });
    return this.get(user, id);
  }

  // ---------------------------------------------------------------- helpers
  private async lock(tx: TxClient, user: RequestUser, id: string) {
    const rows = await tx.$queryRaw<{ id: string }[]>`SELECT id FROM stocktakes WHERE id = ${id}::uuid AND tenant_id = ${user.tenantId}::uuid FOR UPDATE`;
    if (!rows[0]) throw Errors.notFound('Phiếu kiểm kho', id);
    const s = await tx.stocktake.findFirstOrThrow({ where: { id } });
    await this.access.assertWarehouse(user, s.warehouseId, s.branchId, tx);
    return s;
  }

  private async upsertLines(tx: TxClient, user: RequestUser, stocktakeId: string, warehouseId: string, input: StocktakeLineDto[]) {
    const variants = await tx.productVariant.findMany({ where: { id: { in: Array.from(new Set(input.map((l) => l.variantId))) }, deletedAt: null }, include: { product: { select: { type: true, trackBatch: true } } } });
    const vById = new Map(variants.map((v) => [v.id, v]));
    for (const [i, l] of input.entries()) {
      const v = vById.get(l.variantId);
      if (!v) throw Errors.notFound('Hàng hóa', l.variantId);
      if (v.product.type !== 'GOODS') throw Errors.validation(`Dòng ${i + 1}: chỉ kiểm kho hàng hóa (GOODS)`, { variantId: l.variantId });
      if (v.product.trackBatch && !l.batchId) throw Errors.validation(`Dòng ${i + 1}: hàng theo lô phải chọn lô`, { variantId: l.variantId });
      if (l.batchId) {
        const b = await tx.productBatch.findFirst({ where: { id: l.batchId, variantId: l.variantId }, select: { id: true } });
        if (!b) throw Errors.validation(`Dòng ${i + 1}: lô không thuộc hàng hóa`, { batchId: l.batchId });
      }
      const batchKey = l.batchId ?? '';
      const counted = l.countedQuantity !== undefined ? toQty(l.countedQuantity) : undefined;
      const existing = await tx.stocktakeLine.findFirst({ where: { stocktakeId, variantId: l.variantId, batchKey } });
      if (existing) {
        await tx.stocktakeLine.update({ where: { id: existing.id }, data: { ...(counted !== undefined ? { countedQuantity: counted, countedById: user.id, countedAt: new Date() } : {}), ...(l.note !== undefined ? { note: l.note } : {}) } });
      } else {
        const bal = await tx.stockBalance.findFirst({ where: { warehouseId, variantId: l.variantId, batchKey }, select: { onHand: true } });
        await tx.stocktakeLine.create({ data: { tenantId: user.tenantId, stocktakeId, variantId: l.variantId, batchId: l.batchId ?? null, batchKey, systemQuantity: bal?.onHand ?? ZERO, unitCost: v.costPrice, ...(counted !== undefined ? { countedQuantity: counted, countedById: user.id, countedAt: new Date() } : {}), note: l.note ?? null } });
      }
    }
  }

  private async refreshCounters(tx: TxClient, id: string) {
    const [total, counted] = await Promise.all([tx.stocktakeLine.count({ where: { stocktakeId: id } }), tx.stocktakeLine.count({ where: { stocktakeId: id, countedQuantity: { not: null } } })]);
    await tx.stocktake.update({ where: { id }, data: { totalLines: total, countedLines: counted } });
  }
}
