import { Injectable } from '@nestjs/common';
import { InventoryDocStatus, InventoryDocType, MovementType, Prisma } from '@prisma/client';
import { ISSUE_REASONS } from '@erp/shared';
import { Errors } from '../../common/errors/app-error';
import { orderBy, paginated, skipTake } from '../../common/pagination';
import { D, qty as toQty, ZERO } from '../../common/utils/decimal';
import { AccessService } from '../../infra/access/access.service';
import { AuditService } from '../../infra/audit/audit.service';
import { RequestUser } from '../../infra/cls/request-context';
import { NumberingService } from '../../infra/numbering/numbering.service';
import { OutboxService } from '../../infra/outbox/outbox.service';
import { PrismaService, TxClient } from '../../infra/prisma/prisma.service';
import { CreateDocumentDto, DocumentLineDto, DocumentQueryDto, UpdateDocumentDto } from './dto/inventory.dto';
import { StockEngineService } from './stock-engine.service';

const SEQ_BY_TYPE: Record<InventoryDocType, string> = { RECEIPT: 'INVENTORY_RECEIPT', ISSUE: 'INVENTORY_ISSUE', ADJUSTMENT: 'INVENTORY_ADJUSTMENT' };
const MOVEMENT_BY_TYPE: Record<InventoryDocType, MovementType> = { RECEIPT: 'RECEIPT', ISSUE: 'ISSUE', ADJUSTMENT: 'ADJUSTMENT' };

const docInclude = {
  lines: { orderBy: { lineNo: 'asc' as const }, include: { variant: { select: { id: true, sku: true, barcode: true, name: true, product: { select: { id: true, code: true, name: true, baseUnit: true, trackBatch: true } } } }, batch: { select: { id: true, batchNo: true, expiryDate: true } } } },
  warehouse: { select: { id: true, code: true, name: true } },
  branch: { select: { id: true, code: true, name: true } },
} satisfies Prisma.InventoryDocumentInclude;

@Injectable()
export class InventoryDocumentsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly engine: StockEngineService,
    private readonly numbering: NumberingService,
    private readonly audit: AuditService,
    private readonly outbox: OutboxService,
    private readonly access: AccessService,
  ) {}

  // ------------------------------------------------------------------ queries
  async list(user: RequestUser, q: DocumentQueryDto) {
    const scope = this.access.branchWhere(user);
    const filters: Prisma.InventoryDocumentWhereInput = {
      ...(q.type ? { type: q.type as InventoryDocType } : {}),
      ...(q.status ? { status: q.status as InventoryDocStatus } : {}),
      ...(q.warehouseId ? { warehouseId: q.warehouseId } : {}),
      ...(q.branchId ? { branchId: q.branchId } : {}),
      ...(q.from || q.to ? { createdAt: { ...(q.from ? { gte: new Date(q.from) } : {}), ...(q.to ? { lte: new Date(q.to) } : {}) } } : {}),
      ...(q.search ? { OR: [{ code: { contains: q.search, mode: 'insensitive' } }, { note: { contains: q.search, mode: 'insensitive' } }, { lines: { some: { variant: { OR: [{ sku: { contains: q.search, mode: 'insensitive' } }, { name: { contains: q.search, mode: 'insensitive' } }] } } } }] } : {}),
    };
    // AND-compose so a caller-supplied branchId/warehouseId can never widen the access scope (H1)
    const where: Prisma.InventoryDocumentWhereInput = { AND: [scope, filters] };
    const [rows, total] = await Promise.all([
      this.prisma.db.inventoryDocument.findMany({ where, include: { warehouse: { select: { id: true, name: true } }, branch: { select: { id: true, name: true } }, _count: { select: { lines: true } } }, ...skipTake(q), orderBy: orderBy(q, ['createdAt', 'code', 'postedAt', 'totalCost'], 'createdAt') }),
      this.prisma.db.inventoryDocument.count({ where }),
    ]);
    return paginated(rows, total, q);
  }

  async get(user: RequestUser, id: string) {
    const doc = await this.prisma.db.inventoryDocument.findFirst({ where: { id, ...this.access.branchWhere(user) }, include: docInclude });
    if (!doc) throw Errors.notFound('Phiếu kho', id);
    const movements = doc.status === 'DRAFT' ? [] : await this.prisma.db.stockMovement.findMany({ where: { documentType: 'INVENTORY_DOCUMENT', documentId: id }, orderBy: { createdAt: 'asc' } });
    return { ...doc, movements };
  }

  // ------------------------------------------------------------------ drafts
  async create(user: RequestUser, dto: CreateDocumentDto) {
    return this.prisma.tx((tx) => this.createInTx(tx, user, dto));
  }

  async createInTx(tx: TxClient, user: RequestUser, dto: CreateDocumentDto) {
    this.access.assertBranch(user, dto.branchId);
    await this.access.assertWarehouse(user, dto.warehouseId, dto.branchId);
    if (dto.type === 'ISSUE' && !(dto.reason && (ISSUE_REASONS as readonly string[]).includes(dto.reason))) throw Errors.validation('Phiếu xuất kho phải có lý do (DAMAGE, INTERNAL_USE, LOSS, OTHER)');
    const lines = await this.normalizeLines(tx, dto.type, dto.lines);
    const code = await this.numbering.next(tx, SEQ_BY_TYPE[dto.type]);
    const doc = await tx.inventoryDocument.create({
      data: {
        tenantId: user.tenantId, branchId: dto.branchId, warehouseId: dto.warehouseId, code, type: dto.type, reason: dto.reason, note: dto.note, createdById: user.id,
        totalQuantity: lines.reduce((s, l) => s.plus(l.quantity ?? 0), ZERO),
        totalCost: lines.reduce((s, l) => s.plus(l.totalCost), ZERO),
        lines: { create: lines.map((l, i) => ({ tenantId: user.tenantId, lineNo: i + 1, variantId: l.variantId, batchId: l.batchId, quantity: l.quantity ?? ZERO, actualQuantity: l.actualQuantity, unitCost: l.unitCost, totalCost: l.totalCost, note: l.note })) },
      },
      include: docInclude,
    });
    await this.audit.log(tx, { action: 'inventory.document.create', entityType: 'InventoryDocument', entityId: doc.id, entityCode: doc.code, after: { type: doc.type, warehouseId: doc.warehouseId, lines: doc.lines.length } });
    return doc;
  }

  async update(user: RequestUser, id: string, dto: UpdateDocumentDto) {
    return this.prisma.tx(async (tx) => {
      const doc = await this.lockDoc(tx, user, id);
      if (doc.status !== 'DRAFT') throw Errors.conflict('DOCUMENT_NOT_EDITABLE', 'Chỉ sửa được phiếu nháp', { status: doc.status });
      if (doc.version !== dto.version) throw Errors.conflict('VERSION_CONFLICT', 'Phiếu đã được người khác thay đổi, vui lòng tải lại', { current: doc.version });
      if (doc.type === 'ISSUE' && dto.reason !== undefined && !(ISSUE_REASONS as readonly string[]).includes(dto.reason)) throw Errors.validation('Lý do xuất kho không hợp lệ');
      if (dto.warehouseId) await this.access.assertWarehouse(user, dto.warehouseId, doc.branchId, tx);
      const lines = dto.lines ? await this.normalizeLines(tx, doc.type, dto.lines) : null;
      const after = await tx.inventoryDocument.update({
        where: { id },
        data: {
          warehouseId: dto.warehouseId, reason: dto.reason, note: dto.note, version: { increment: 1 },
          ...(lines ? {
            totalQuantity: lines.reduce((s, l) => s.plus(l.quantity ?? 0), ZERO), totalCost: lines.reduce((s, l) => s.plus(l.totalCost), ZERO),
            lines: { deleteMany: {}, create: lines.map((l, i) => ({ tenantId: user.tenantId, lineNo: i + 1, variantId: l.variantId, batchId: l.batchId, quantity: l.quantity ?? ZERO, actualQuantity: l.actualQuantity, unitCost: l.unitCost, totalCost: l.totalCost, note: l.note })) },
          } : {}),
        },
        include: docInclude,
      });
      await this.audit.log(tx, { action: 'inventory.document.update', entityType: 'InventoryDocument', entityId: id, entityCode: after.code, before: { version: doc.version }, after: { version: after.version, lines: after.lines.length } });
      return after;
    });
  }

  async remove(user: RequestUser, id: string) {
    await this.prisma.tx(async (tx) => {
      const doc = await this.lockDoc(tx, user, id);
      if (doc.status !== 'DRAFT') throw Errors.conflict('DOCUMENT_NOT_EDITABLE', 'Chỉ xóa được phiếu nháp', { status: doc.status });
      await tx.inventoryDocument.delete({ where: { id } });
      await this.audit.log(tx, { action: 'inventory.document.delete', entityType: 'InventoryDocument', entityId: id, entityCode: doc.code, before: { type: doc.type } });
    });
  }

  // ------------------------------------------------------------------ posting (BR-23)
  async post(user: RequestUser, id: string) {
    return this.prisma.tx((tx) => this.postInTx(tx, user, id));
  }

  async createAndPost(user: RequestUser, dto: CreateDocumentDto) {
    return this.prisma.tx(async (tx) => {
      const doc = await this.createInTx(tx, user, dto);
      return this.postInTx(tx, user, doc.id);
    });
  }

  async postInTx(tx: TxClient, user: RequestUser, id: string) {
    const doc = await this.lockDoc(tx, user, id);
    if (doc.status !== 'DRAFT') throw Errors.conflict('DOCUMENT_NOT_DRAFT', 'Phiếu không ở trạng thái nháp', { status: doc.status });
    const wh = await tx.warehouse.findFirst({ where: { id: doc.warehouseId } });
    if (!wh || !wh.isActive) throw Errors.validation('Kho không hoạt động', { warehouseId: doc.warehouseId });
    const allowNegative = await this.engine.allowNegative(tx);
    const lines = await tx.inventoryDocumentLine.findMany({ where: { documentId: id } });
    lines.sort(StockEngineService.sortKey);
    const movementType = MOVEMENT_BY_TYPE[doc.type];
    let totalQuantity = ZERO;
    let totalCost = ZERO;

    for (const line of lines) {
      let delta: Prisma.Decimal;
      let systemQuantity: Prisma.Decimal | null = null;
      if (doc.type === 'RECEIPT') delta = toQty(line.quantity);
      else if (doc.type === 'ISSUE') delta = toQty(line.quantity).negated();
      else {
        // ADJUSTMENT: recompute delta against the on-hand at posting time, read under the same row locks apply() uses,
        // so a concurrent sale cannot slip between the read and the write (H2 / BR-24)
        if (line.actualQuantity !== null) {
          systemQuantity = await this.engine.lockedOnHand(tx, user.tenantId, doc.warehouseId, line.variantId, line.batchId);
          delta = toQty(line.actualQuantity).minus(systemQuantity);
        } else delta = toQty(line.quantity);
      }
      if (delta.isZero()) {
        await tx.inventoryDocumentLine.update({ where: { id: line.id }, data: { systemQuantity, quantity: ZERO, totalCost: ZERO } });
        continue;
      }
      const unitCost = doc.type === 'RECEIPT' ? D(line.unitCost) : null;
      const r = await this.engine.apply(tx, {
        tenantId: user.tenantId, warehouseId: doc.warehouseId, variantId: line.variantId, batchId: line.batchId, quantity: delta, unitCost,
        type: movementType, documentType: 'INVENTORY_DOCUMENT', documentId: doc.id, documentCode: doc.code, lineId: line.id, reason: doc.reason, note: line.note, userId: user.id, allowNegative,
      });
      await tx.inventoryDocumentLine.update({ where: { id: line.id }, data: { quantity: delta, systemQuantity, unitCost: r.unitCost, totalCost: r.totalCost } });
      totalQuantity = totalQuantity.plus(delta.abs());
      totalCost = totalCost.plus(r.totalCost);
    }

    const posted = await tx.inventoryDocument.update({ where: { id }, data: { status: 'POSTED', postedAt: new Date(), postedById: user.id, totalQuantity, totalCost, version: { increment: 1 } }, include: docInclude });
    await this.audit.log(tx, { action: 'inventory.document.post', entityType: 'InventoryDocument', entityId: id, entityCode: doc.code, after: { status: 'POSTED', totalQuantity: totalQuantity.toString(), totalCost: totalCost.toString() } });
    await this.outbox.enqueue(tx, { eventType: 'inventory.document.posted', aggregateType: 'InventoryDocument', aggregateId: id, payload: { code: doc.code, type: doc.type, warehouseId: doc.warehouseId, lines: lines.map((l) => ({ variantId: l.variantId, batchId: l.batchId })) } });
    return posted;
  }

  // ------------------------------------------------------------------ cancel = reversal (BR-26)
  async cancel(user: RequestUser, id: string, reason: string) {
    return this.prisma.tx(async (tx) => {
      const doc = await this.lockDoc(tx, user, id);
      if (doc.status !== 'POSTED') throw Errors.conflict('DOCUMENT_NOT_POSTED', 'Chỉ hủy được phiếu đã ghi sổ', { status: doc.status });
      const allowNegative = await this.engine.allowNegative(tx);
      const movements = await tx.stockMovement.findMany({ where: { documentType: 'INVENTORY_DOCUMENT', documentId: id, type: { not: 'REVERSAL' } } });
      movements.sort(StockEngineService.sortKey);
      for (const m of movements) {
        await this.engine.apply(tx, {
          tenantId: user.tenantId, warehouseId: m.warehouseId, variantId: m.variantId, batchId: m.batchId, quantity: D(m.quantity).negated(), unitCost: D(m.unitCost),
          type: 'REVERSAL', documentType: 'INVENTORY_DOCUMENT', documentId: id, documentCode: doc.code, lineId: m.lineId, reason: 'CANCEL', note: reason, userId: user.id, allowNegative,
        });
      }
      const cancelled = await tx.inventoryDocument.update({ where: { id }, data: { status: 'CANCELLED', cancelledAt: new Date(), cancelledById: user.id, cancelReason: reason, version: { increment: 1 } }, include: docInclude });
      await this.audit.log(tx, { action: 'inventory.document.cancel', entityType: 'InventoryDocument', entityId: id, entityCode: doc.code, before: { status: 'POSTED' }, after: { status: 'CANCELLED', reason } });
      await this.outbox.enqueue(tx, { eventType: 'inventory.document.cancelled', aggregateType: 'InventoryDocument', aggregateId: id, payload: { code: doc.code, reason } });
      return cancelled;
    });
  }

  // ------------------------------------------------------------------ helpers
  private async lockDoc(tx: TxClient, user: RequestUser, id: string) {
    const rows = await tx.$queryRaw<{ id: string }[]>`SELECT id FROM inventory_documents WHERE id = ${id}::uuid AND tenant_id = ${user.tenantId}::uuid FOR UPDATE`;
    if (!rows[0]) throw Errors.notFound('Phiếu kho', id);
    const doc = await tx.inventoryDocument.findFirstOrThrow({ where: { id } });
    this.access.assertBranch(user, doc.branchId);
    await this.access.assertWarehouse(user, doc.warehouseId, doc.branchId, tx); // M2: warehouse restriction applies to post/cancel/update/delete
    return doc;
  }

  private async normalizeLines(tx: TxClient, type: InventoryDocType, input: DocumentLineDto[]) {
    const variantIds = Array.from(new Set(input.map((l) => l.variantId)));
    const variants = await tx.productVariant.findMany({ where: { id: { in: variantIds }, deletedAt: null }, include: { product: { select: { type: true, trackBatch: true } } } });
    const byId = new Map(variants.map((v) => [v.id, v]));
    const out: Array<{ variantId: string; batchId: string | null; quantity: Prisma.Decimal | null; actualQuantity: Prisma.Decimal | null; unitCost: Prisma.Decimal; totalCost: Prisma.Decimal; note?: string }> = [];
    for (const [i, l] of input.entries()) {
      const v = byId.get(l.variantId);
      if (!v) throw Errors.validation(`Dòng ${i + 1}: hàng hóa không tồn tại`, { variantId: l.variantId });
      if (v.product.type !== 'GOODS') throw Errors.validation(`Dòng ${i + 1}: chỉ hàng hóa mới nhập/xuất kho được`, { variantId: l.variantId });
      if (v.product.trackBatch && !l.batchId) throw Errors.conflict('BATCH_REQUIRED', `Dòng ${i + 1}: hàng theo lô bắt buộc chọn lô`, { variantId: l.variantId });
      if (!v.product.trackBatch && l.batchId) throw Errors.conflict('BATCH_NOT_ALLOWED', `Dòng ${i + 1}: hàng không theo dõi lô`, { variantId: l.variantId });
      if (l.batchId) {
        const b = await tx.productBatch.findFirst({ where: { id: l.batchId, variantId: l.variantId } });
        if (!b) throw Errors.validation(`Dòng ${i + 1}: lô không thuộc hàng hóa này`, { batchId: l.batchId });
      }
      let quantity: Prisma.Decimal | null = l.quantity !== undefined ? toQty(l.quantity) : null;
      const actualQuantity = l.actualQuantity !== undefined ? toQty(l.actualQuantity) : null;
      if (type === 'ADJUSTMENT') {
        if (actualQuantity === null && quantity === null) throw Errors.validation(`Dòng ${i + 1}: cần actualQuantity hoặc quantity`);
        if (actualQuantity !== null && actualQuantity.lessThan(0)) throw Errors.validation(`Dòng ${i + 1}: số lượng thực tế không được âm`);
        if (actualQuantity === null && quantity !== null && quantity.isZero()) throw Errors.validation(`Dòng ${i + 1}: chênh lệch phải khác 0`);
      } else {
        if (quantity === null || !quantity.greaterThan(0)) throw Errors.validation(`Dòng ${i + 1}: số lượng phải lớn hơn 0`);
      }
      const unitCost = type === 'RECEIPT' ? D(l.unitCost ?? v.costPrice).toDecimalPlaces(4) : D(v.costPrice);
      if (unitCost.lessThan(0)) throw Errors.validation(`Dòng ${i + 1}: đơn giá không được âm`);
      quantity = quantity ?? ZERO;
      out.push({ variantId: l.variantId, batchId: l.batchId ?? null, quantity, actualQuantity, unitCost, totalCost: quantity.abs().times(unitCost).toDecimalPlaces(4), note: l.note });
    }
    return out;
  }
}
