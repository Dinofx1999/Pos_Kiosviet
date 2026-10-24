import { Injectable } from '@nestjs/common';
import { Prisma, TransferStatus } from '@prisma/client';
import { Errors } from '../../common/errors/app-error';
import { orderBy, paginated, skipTake } from '../../common/pagination';
import { D, qty as toQty, ZERO } from '../../common/utils/decimal';
import { AccessService } from '../../infra/access/access.service';
import { AuditService } from '../../infra/audit/audit.service';
import { RequestUser } from '../../infra/cls/request-context';
import { NumberingService } from '../../infra/numbering/numbering.service';
import { OutboxService } from '../../infra/outbox/outbox.service';
import { PrismaService, TxClient } from '../../infra/prisma/prisma.service';
import { CreateTransferDto, ReceiveTransferDto, TransferLineDto, TransferQueryDto, UpdateTransferDto } from './dto/transfers.dto';
import { StockEngineService } from './stock-engine.service';

const DOC_TYPE = 'STOCK_TRANSFER';

const transferInclude = {
  lines: { orderBy: { lineNo: 'asc' as const }, include: { variant: { select: { id: true, sku: true, barcode: true, name: true, costPrice: true, product: { select: { id: true, code: true, name: true, baseUnit: true, trackBatch: true } } } }, batch: { select: { id: true, batchNo: true, expiryDate: true } } } },
  fromWarehouse: { select: { id: true, code: true, name: true } },
  toWarehouse: { select: { id: true, code: true, name: true } },
  fromBranch: { select: { id: true, code: true, name: true } },
  toBranch: { select: { id: true, code: true, name: true } },
} satisfies Prisma.StockTransferInclude;

interface NormalizedLine { variantId: string; batchId: string | null; quantity: Prisma.Decimal; unitCost: Prisma.Decimal; totalCost: Prisma.Decimal; note: string | null }

/**
 * Chuyển kho (BR-80..BR-83): DRAFT → IN_TRANSIT (TRANSFER_OUT at the source, `incoming` at the destination)
 * → RECEIVED (TRANSFER_IN for what arrived; shortage written off or returned to the source) / CANCELLED (in transit → reversed).
 */
@Injectable()
export class TransfersService {
  constructor(
    private readonly prisma: PrismaService, private readonly engine: StockEngineService, private readonly numbering: NumberingService,
    private readonly audit: AuditService, private readonly outbox: OutboxService, private readonly access: AccessService,
  ) {}

  // ---------------------------------------------------------------- queries
  private scope(user: RequestUser): Prisma.StockTransferWhereInput {
    const s = this.access.branchWhere(user);
    if (!s.branchId) return {};
    return { OR: [{ fromBranchId: s.branchId }, { toBranchId: s.branchId }] };
  }

  async list(user: RequestUser, q: TransferQueryDto) {
    // "my side" = the branch asked for, else every branch the user belongs to (owners see all → the branch filter is required for in/out)
    const mine = q.branchId ? { in: [q.branchId] } : this.access.branchWhere(user).branchId;
    const filters: Prisma.StockTransferWhereInput = {
      ...(q.status ? { status: q.status as TransferStatus } : {}),
      ...(q.fromWarehouseId ? { fromWarehouseId: q.fromWarehouseId } : {}),
      ...(q.toWarehouseId ? { toWarehouseId: q.toWarehouseId } : {}),
      ...(q.branchId && !q.direction ? { OR: [{ fromBranchId: q.branchId }, { toBranchId: q.branchId }] } : {}),
      ...(q.direction === 'in' && mine ? { toBranchId: mine } : {}),
      ...(q.direction === 'out' && mine ? { fromBranchId: mine } : {}),
      ...(q.from || q.to ? { createdAt: { ...(q.from ? { gte: new Date(q.from) } : {}), ...(q.to ? { lte: new Date(q.to) } : {}) } } : {}),
      ...(q.search ? { OR: [{ code: { contains: q.search, mode: 'insensitive' } }, { note: { contains: q.search, mode: 'insensitive' } }, { lines: { some: { variant: { OR: [{ sku: { contains: q.search, mode: 'insensitive' } }, { name: { contains: q.search, mode: 'insensitive' } }] } } } }] } : {}),
    };
    const where: Prisma.StockTransferWhereInput = { AND: [this.scope(user), filters] };
    const [rows, total] = await Promise.all([
      this.prisma.db.stockTransfer.findMany({ where, include: { fromWarehouse: { select: { id: true, name: true } }, toWarehouse: { select: { id: true, name: true } }, fromBranch: { select: { id: true, name: true } }, toBranch: { select: { id: true, name: true } }, _count: { select: { lines: true } } }, ...skipTake(q), orderBy: orderBy(q, ['createdAt', 'code', 'status', 'totalQuantity', 'dispatchedAt', 'receivedAt'], 'createdAt') }),
      this.prisma.db.stockTransfer.count({ where }),
    ]);
    return paginated(rows, total, q);
  }

  async get(user: RequestUser, id: string) {
    const t = await this.prisma.db.stockTransfer.findFirst({ where: { AND: [{ id }, this.scope(user)] }, include: transferInclude });
    if (!t) throw Errors.notFound('Phiếu chuyển kho', id);
    const movements = t.status === 'DRAFT' ? [] : await this.prisma.db.stockMovement.findMany({ where: { documentType: DOC_TYPE, documentId: id }, orderBy: { createdAt: 'asc' } });
    const canCost = user.permissions.has('*') || user.permissions.has('inventory.cost.view');
    return { ...t, totalCost: canCost ? t.totalCost : undefined, shortageValue: canCost ? t.shortageValue : undefined, lines: t.lines.map((l) => ({ ...l, unitCost: canCost ? l.unitCost : undefined, totalCost: canCost ? l.totalCost : undefined, variant: { ...l.variant, costPrice: canCost ? l.variant.costPrice : undefined } })), movements: canCost ? movements : movements.map((m) => ({ ...m, unitCost: undefined, totalCost: undefined })) };
  }

  // ---------------------------------------------------------------- drafts
  async create(user: RequestUser, dto: CreateTransferDto) {
    const id = await this.prisma.tx(async (tx) => (await this.createInTx(tx, user, dto)).id);
    return this.get(user, id);
  }

  private async createInTx(tx: TxClient, user: RequestUser, dto: CreateTransferDto) {
    if (dto.fromWarehouseId === dto.toWarehouseId) throw Errors.validation('Kho nguồn và kho đích phải khác nhau');
    const from = await this.access.assertWarehouse(user, dto.fromWarehouseId, undefined, tx);
    if (!from.isActive) throw Errors.validation('Kho nguồn không hoạt động', { warehouseId: from.id });
    const to = await tx.warehouse.findFirst({ where: { id: dto.toWarehouseId }, select: { id: true, branchId: true, isActive: true } });
    if (!to) throw Errors.notFound('Kho đích', dto.toWarehouseId);
    if (!to.isActive) throw Errors.validation('Kho đích không hoạt động', { warehouseId: to.id });
    const lines = await this.normalizeLines(tx, dto.lines);
    const code = await this.numbering.next(tx, 'TRANSFER');
    const t = await tx.stockTransfer.create({
      data: {
        tenantId: user.tenantId, code, fromBranchId: from.branchId, fromWarehouseId: from.id, toBranchId: to.branchId, toWarehouseId: to.id, note: dto.note, createdById: user.id,
        totalQuantity: lines.reduce((s, l) => s.plus(l.quantity), ZERO), totalCost: lines.reduce((s, l) => s.plus(l.totalCost), ZERO),
        lines: { create: lines.map((l, i) => ({ tenantId: user.tenantId, lineNo: i + 1, variantId: l.variantId, batchId: l.batchId, quantity: l.quantity, unitCost: l.unitCost, totalCost: l.totalCost, note: l.note })) },
      },
    });
    await this.audit.log(tx, { action: 'transfer.create', entityType: 'StockTransfer', entityId: t.id, entityCode: code, after: { from: from.id, to: to.id, lines: lines.length } });
    return t;
  }

  async update(user: RequestUser, id: string, dto: UpdateTransferDto) {
    await this.prisma.tx(async (tx) => {
      const t = await this.lock(tx, user, id, 'from');
      if (t.status !== 'DRAFT') throw Errors.conflict('DOCUMENT_NOT_EDITABLE', 'Chỉ sửa được phiếu chuyển kho ở trạng thái phiếu tạm', { status: t.status });
      if (t.version !== dto.version) throw Errors.conflict('VERSION_CONFLICT', 'Phiếu đã được người khác thay đổi, vui lòng tải lại', { current: t.version });
      let toBranchId = t.toBranchId; let toWarehouseId = t.toWarehouseId;
      if (dto.toWarehouseId && dto.toWarehouseId !== t.toWarehouseId) {
        if (dto.toWarehouseId === t.fromWarehouseId) throw Errors.validation('Kho nguồn và kho đích phải khác nhau');
        const to = await tx.warehouse.findFirst({ where: { id: dto.toWarehouseId, isActive: true }, select: { id: true, branchId: true } });
        if (!to) throw Errors.notFound('Kho đích', dto.toWarehouseId);
        toBranchId = to.branchId; toWarehouseId = to.id;
      }
      const lines = dto.lines ? await this.normalizeLines(tx, dto.lines) : null;
      await tx.stockTransfer.update({
        where: { id },
        data: {
          toBranchId, toWarehouseId, note: dto.note === undefined ? undefined : dto.note, version: { increment: 1 },
          ...(lines ? { totalQuantity: lines.reduce((s, l) => s.plus(l.quantity), ZERO), totalCost: lines.reduce((s, l) => s.plus(l.totalCost), ZERO), lines: { deleteMany: {}, create: lines.map((l, i) => ({ tenantId: user.tenantId, lineNo: i + 1, variantId: l.variantId, batchId: l.batchId, quantity: l.quantity, unitCost: l.unitCost, totalCost: l.totalCost, note: l.note })) } } : {}),
        },
      });
      await this.audit.log(tx, { action: 'transfer.update', entityType: 'StockTransfer', entityId: id, entityCode: t.code, before: { version: t.version }, after: { version: t.version + 1 } });
    });
    return this.get(user, id);
  }

  async remove(user: RequestUser, id: string) {
    await this.prisma.tx(async (tx) => {
      const t = await this.lock(tx, user, id, 'from');
      if (t.status !== 'DRAFT') throw Errors.conflict('DOCUMENT_NOT_EDITABLE', 'Chỉ xóa được phiếu tạm', { status: t.status });
      await tx.stockTransfer.delete({ where: { id } });
      await this.audit.log(tx, { action: 'transfer.delete', entityType: 'StockTransfer', entityId: id, entityCode: t.code });
    });
  }

  // ---------------------------------------------------------------- dispatch (xuất chuyển kho, BR-81)
  async dispatchNow(user: RequestUser, dto: CreateTransferDto) {
    const id = await this.prisma.tx(async (tx) => {
      const t = await this.createInTx(tx, user, dto);
      await this.dispatchInTx(tx, user, t.id, undefined);
      return t.id;
    });
    return this.get(user, id);
  }

  async dispatch(user: RequestUser, id: string, version?: number) {
    await this.prisma.tx((tx) => this.dispatchInTx(tx, user, id, version));
    return this.get(user, id);
  }

  private async dispatchInTx(tx: TxClient, user: RequestUser, id: string, expectedVersion: number | undefined) {
    const t = await this.lock(tx, user, id, 'from');
    if (t.status !== 'DRAFT') throw Errors.conflict('DOCUMENT_NOT_DRAFT', 'Phiếu không ở trạng thái phiếu tạm', { status: t.status });
    if (expectedVersion !== undefined && t.version !== expectedVersion) throw Errors.conflict('VERSION_CONFLICT', 'Phiếu đã được thay đổi ở nơi khác, vui lòng tải lại', { current: t.version });
    const [from, to] = await Promise.all([tx.warehouse.findFirst({ where: { id: t.fromWarehouseId } }), tx.warehouse.findFirst({ where: { id: t.toWarehouseId } })]);
    if (!from?.isActive) throw Errors.validation('Kho nguồn không hoạt động');
    if (!to?.isActive) throw Errors.validation('Kho đích không hoạt động');
    const allowNegative = await this.engine.allowNegative(tx);
    const lines = (await tx.stockTransferLine.findMany({ where: { transferId: id } })).sort(StockEngineService.sortKey);
    let totalCost = ZERO;
    for (const l of lines) {
      // source: out at the current moving average; destination: incoming += qty (goods are in transit, not on hand anywhere)
      const r = await this.engine.apply(tx, { tenantId: user.tenantId, warehouseId: t.fromWarehouseId, variantId: l.variantId, batchId: l.batchId, quantity: D(l.quantity).negated(), unitCost: null, type: 'TRANSFER_OUT', documentType: DOC_TYPE, documentId: id, documentCode: t.code, lineId: l.id, note: l.note, userId: user.id, allowNegative });
      await this.bumpIncoming(tx, user.tenantId, t.toWarehouseId, l.variantId, l.batchId, D(l.quantity));
      await tx.stockTransferLine.update({ where: { id: l.id }, data: { unitCost: r.unitCost, totalCost: r.totalCost } });
      totalCost = totalCost.plus(r.totalCost);
    }
    await tx.stockTransfer.update({ where: { id }, data: { status: 'IN_TRANSIT', dispatchedAt: new Date(), dispatchedById: user.id, totalCost, version: { increment: 1 } } });
    await this.audit.log(tx, { action: 'transfer.dispatch', entityType: 'StockTransfer', entityId: id, entityCode: t.code, after: { status: 'IN_TRANSIT', totalCost: totalCost.toString(), lines: lines.length } });
    await this.outbox.enqueue(tx, { eventType: 'transfer.dispatched', aggregateType: 'StockTransfer', aggregateId: id, payload: { code: t.code, fromWarehouseId: t.fromWarehouseId, toWarehouseId: t.toWarehouseId, totalQuantity: t.totalQuantity.toString() } });
  }

  // ---------------------------------------------------------------- receive (nhận hàng, BR-82)
  async receive(user: RequestUser, id: string, dto: ReceiveTransferDto) {
    await this.prisma.tx(async (tx) => {
      const t = await this.lock(tx, user, id, 'to');
      if (t.status !== 'IN_TRANSIT') throw Errors.conflict('TRANSFER_NOT_IN_TRANSIT', 'Chỉ nhận được phiếu đang chuyển', { status: t.status });
      if (dto.version !== undefined && t.version !== dto.version) throw Errors.conflict('VERSION_CONFLICT', 'Phiếu đã được thay đổi ở nơi khác, vui lòng tải lại', { current: t.version });
      const to = await tx.warehouse.findFirst({ where: { id: t.toWarehouseId } });
      if (!to?.isActive) throw Errors.validation('Kho đích không hoạt động');
      const action = dto.shortageAction ?? 'WRITE_OFF';
      const lines = (await tx.stockTransferLine.findMany({ where: { transferId: id } })).sort(StockEngineService.sortKey);
      const byId = new Map(lines.map((l) => [l.id, l]));
      const received = new Map<string, { qty: Prisma.Decimal; note?: string }>();
      for (const r of dto.lines ?? []) {
        const l = byId.get(r.lineId);
        if (!l) throw Errors.validation('Dòng không thuộc phiếu chuyển kho', { lineId: r.lineId });
        const q = toQty(r.receivedQuantity);
        if (q.greaterThan(D(l.quantity))) throw Errors.validation(`Số lượng nhận vượt số lượng gửi (${l.quantity.toString()})`, { lineId: r.lineId, sent: l.quantity.toString(), received: q.toString() });
        received.set(l.id, { qty: q, note: r.note });
      }
      // receipts never need the negative-stock setting (goods only come in; the shortage write-off has no movement)
      let receivedQty = ZERO; let shortageQty = ZERO; let shortageValue = ZERO;
      for (const l of lines) {
        const got = received.get(l.id)?.qty ?? D(l.quantity);
        const shortage = D(l.quantity).minus(got);
        await this.engine.lockAndValidateVariant(tx, user.tenantId, l.variantId, l.batchId);
        if (got.greaterThan(0)) await this.engine.apply(tx, { tenantId: user.tenantId, warehouseId: t.toWarehouseId, variantId: l.variantId, batchId: l.batchId, quantity: got, unitCost: D(l.unitCost), type: 'TRANSFER_IN', documentType: DOC_TYPE, documentId: id, documentCode: t.code, lineId: l.id, note: received.get(l.id)?.note ?? l.note, userId: user.id, allowNegative: true });
        await this.bumpIncoming(tx, user.tenantId, t.toWarehouseId, l.variantId, l.batchId, D(l.quantity).negated());
        if (shortage.greaterThan(0)) {
          if (action === 'RETURN_TO_SOURCE') {
            await this.engine.apply(tx, { tenantId: user.tenantId, warehouseId: t.fromWarehouseId, variantId: l.variantId, batchId: l.batchId, quantity: shortage, unitCost: D(l.unitCost), type: 'TRANSFER_IN', documentType: DOC_TYPE, documentId: id, documentCode: t.code, lineId: l.id, reason: 'SHORTAGE_RETURNED', note: 'Phần thiếu trả về kho nguồn', userId: user.id, allowNegative: true });
          } else {
            shortageValue = shortageValue.plus(shortage.times(D(l.unitCost)).toDecimalPlaces(4));
          }
          shortageQty = shortageQty.plus(shortage);
        }
        receivedQty = receivedQty.plus(got);
        await tx.stockTransferLine.update({ where: { id: l.id }, data: { receivedQuantity: got, ...(received.get(l.id)?.note ? { note: received.get(l.id)!.note } : {}) } });
      }
      await tx.stockTransfer.update({ where: { id }, data: { status: 'RECEIVED', receivedAt: new Date(), receivedById: user.id, receivedQuantity: receivedQty, shortageQuantity: shortageQty, shortageValue, shortageAction: shortageQty.greaterThan(0) ? action : null, receiveNote: dto.note, version: { increment: 1 } } });
      await this.audit.log(tx, { action: 'transfer.receive', entityType: 'StockTransfer', entityId: id, entityCode: t.code, after: { status: 'RECEIVED', received: receivedQty.toString(), shortage: shortageQty.toString(), shortageValue: shortageValue.toString(), action } });
      await this.outbox.enqueue(tx, { eventType: 'transfer.received', aggregateType: 'StockTransfer', aggregateId: id, payload: { code: t.code, received: receivedQty.toString(), shortage: shortageQty.toString() } });
    });
    return this.get(user, id);
  }

  // ---------------------------------------------------------------- cancel (BR-83)
  async cancel(user: RequestUser, id: string, reason: string) {
    await this.prisma.tx(async (tx) => {
      const t = await this.lock(tx, user, id, 'from');
      if (t.status === 'RECEIVED') throw Errors.conflict('TRANSFER_RECEIVED', 'Phiếu đã nhận hàng, không hủy được — hãy tạo phiếu chuyển ngược lại');
      if (t.status === 'CANCELLED') throw Errors.conflict('DOCUMENT_NOT_POSTED', 'Phiếu đã hủy trước đó');
      if (t.status === 'IN_TRANSIT') {
        // goods come back to the source at the cost they left with; destination incoming is released
        const movements = (await tx.stockMovement.findMany({ where: { documentType: DOC_TYPE, documentId: id, type: 'TRANSFER_OUT' } })).sort(StockEngineService.sortKey);
        for (const m of movements) {
          await this.engine.apply(tx, { tenantId: user.tenantId, warehouseId: m.warehouseId, variantId: m.variantId, batchId: m.batchId, quantity: D(m.quantity).negated(), unitCost: D(m.unitCost), type: 'REVERSAL', documentType: DOC_TYPE, documentId: id, documentCode: t.code, lineId: m.lineId, reason: 'CANCEL', note: reason, userId: user.id, allowNegative: true });
          await this.bumpIncoming(tx, user.tenantId, t.toWarehouseId, m.variantId, m.batchId, D(m.quantity)); // m.quantity is negative → incoming −= |qty|
        }
      }
      await tx.stockTransfer.update({ where: { id }, data: { status: 'CANCELLED', cancelledAt: new Date(), cancelledById: user.id, cancelReason: reason, version: { increment: 1 } } });
      await this.audit.log(tx, { action: 'transfer.cancel', entityType: 'StockTransfer', entityId: id, entityCode: t.code, before: { status: t.status }, after: { status: 'CANCELLED', reason } });
      await this.outbox.enqueue(tx, { eventType: 'transfer.cancelled', aggregateType: 'StockTransfer', aggregateId: id, payload: { code: t.code, reason } });
    });
    return this.get(user, id);
  }

  // ---------------------------------------------------------------- helpers
  /** Locks the transfer row; `side` decides which branch the user must have access to. */
  private async lock(tx: TxClient, user: RequestUser, id: string, side: 'from' | 'to') {
    const rows = await tx.$queryRaw<{ id: string }[]>`SELECT id FROM stock_transfers WHERE id = ${id}::uuid AND tenant_id = ${user.tenantId}::uuid FOR UPDATE`;
    if (!rows[0]) throw Errors.notFound('Phiếu chuyển kho', id);
    const t = await tx.stockTransfer.findFirstOrThrow({ where: { id } });
    await this.access.assertWarehouse(user, side === 'from' ? t.fromWarehouseId : t.toWarehouseId, undefined, tx);
    return t;
  }

  /** `incoming` on the destination balance (goods in transit); the caller already holds the variant lock (engine order variant → balance). */
  private async bumpIncoming(tx: TxClient, tenantId: string, warehouseId: string, variantId: string, batchId: string | null, delta: Prisma.Decimal) {
    const bal = await this.engine.lockBalance(tx, tenantId, warehouseId, variantId, batchId);
    await tx.$executeRaw`UPDATE stock_balances SET incoming = GREATEST(incoming + ${delta.toString()}::numeric, 0), updated_at = now() WHERE id = ${bal.id}::uuid`;
  }

  private async normalizeLines(tx: TxClient, input: TransferLineDto[]): Promise<NormalizedLine[]> {
    const variants = await tx.productVariant.findMany({ where: { id: { in: Array.from(new Set(input.map((l) => l.variantId))) }, deletedAt: null }, include: { product: { select: { type: true, trackBatch: true } } } });
    const vById = new Map(variants.map((v) => [v.id, v]));
    const merged = new Map<string, NormalizedLine>();
    input.forEach((l, i) => {
      const v = vById.get(l.variantId);
      if (!v) throw Errors.notFound('Hàng hóa', l.variantId);
      if (v.product.type !== 'GOODS') throw Errors.validation(`Dòng ${i + 1}: chỉ chuyển kho được hàng hóa (GOODS)`, { variantId: l.variantId });
      if (v.product.trackBatch && !l.batchId) throw Errors.validation(`Dòng ${i + 1}: hàng theo lô phải chọn lô`, { variantId: l.variantId });
      const quantity = toQty(l.quantity);
      if (quantity.lessThanOrEqualTo(0)) throw Errors.validation(`Dòng ${i + 1}: số lượng phải lớn hơn 0`);
      const key = `${l.variantId}|${l.batchId ?? ''}`;
      const prev = merged.get(key);
      const unitCost = D(v.costPrice);
      const q = prev ? prev.quantity.plus(quantity) : quantity;
      merged.set(key, { variantId: l.variantId, batchId: l.batchId ?? null, quantity: q, unitCost, totalCost: q.times(unitCost).toDecimalPlaces(4), note: l.note ?? prev?.note ?? null });
    });
    return Array.from(merged.values());
  }
}
