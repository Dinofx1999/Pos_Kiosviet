import { Injectable } from '@nestjs/common';
import { MovementType, Prisma } from '@prisma/client';
import { TENANT_SETTING_KEYS } from '@erp/shared';
import { Errors } from '../../common/errors/app-error';
import { D, qty as toQty, ZERO } from '../../common/utils/decimal';
import { TxClient } from '../../infra/prisma/prisma.service';
import { applyCost } from './costing';

export interface StockChange {
  tenantId: string;
  warehouseId: string;
  variantId: string;
  batchId?: string | null;
  /** signed quantity in base unit (+ in, − out) */
  quantity: Prisma.Decimal;
  /** explicit unit cost (receipts, reversals); null → current moving average */
  unitCost: Prisma.Decimal | null;
  type: MovementType;
  documentType: string;
  documentId: string;
  documentCode: string;
  lineId?: string | null;
  reason?: string | null;
  note?: string | null;
  userId?: string | null;
  allowNegative: boolean;
  /** when true, the reserved floor is ignored (used when consuming a reservation: the caller releases the reservation in the same tx) */
  skipAvailabilityCheck?: boolean;
}

export interface StockChangeResult {
  movementId: string;
  unitCost: Prisma.Decimal;
  totalCost: Prisma.Decimal;
  balanceAfter: Prisma.Decimal;
  onHandBefore: Prisma.Decimal;
  avgCostAfter: Prisma.Decimal;
}

interface VariantRow { id: string; cost_price: Prisma.Decimal; on_hand_total: Prisma.Decimal; product_id: string; type: string; track_batch: boolean; is_active: boolean; deleted_at: Date | null }
interface BalanceRow { id: string; on_hand: Prisma.Decimal; reserved: Prisma.Decimal }

/**
 * The single place that mutates stock (BR-20..BR-28). Every caller is inside a transaction.
 * Lock order: product_variants row → stock_balances row (callers must process lines sorted by variantId, batchKey).
 */
@Injectable()
export class StockEngineService {
  /** Sort key used by all callers so concurrent transactions acquire locks in the same order (BR-24). */
  static sortKey(a: { variantId: string; batchId?: string | null }, b: { variantId: string; batchId?: string | null }) {
    const ka = `${a.variantId}|${a.batchId ?? ''}`;
    const kb = `${b.variantId}|${b.batchId ?? ''}`;
    return ka < kb ? -1 : ka > kb ? 1 : 0;
  }

  async allowNegative(tx: TxClient): Promise<boolean> {
    const row = await tx.tenantSetting.findFirst({ where: { key: TENANT_SETTING_KEYS.ALLOW_NEGATIVE_STOCK } });
    return row?.value === true;
  }

  /**
   * FOR NO KEY UPDATE (not FOR UPDATE): rows inserted by other transactions that reference the variant through a foreign key
   * (invoice_lines, receipt lines…) hold KEY SHARE on it; FOR UPDATE would conflict with those and deadlock when a document is
   * created (lines inserted) before its stock is posted. NO KEY UPDATE still serialises every stock change on the variant.
   */
  async lockVariant(tx: TxClient, tenantId: string, variantId: string): Promise<VariantRow> {
    const rows = await tx.$queryRaw<VariantRow[]>`SELECT v.id, v.cost_price, v.on_hand_total, v.product_id, p.type::text AS type, p.track_batch, v.is_active, v.deleted_at
      FROM product_variants v JOIN products p ON p.id = v.product_id
      WHERE v.id = ${variantId}::uuid AND v.tenant_id = ${tenantId}::uuid FOR NO KEY UPDATE OF v`;
    if (!rows[0]) throw Errors.notFound('Hàng hóa', variantId);
    return rows[0];
  }

  async lockBalance(tx: TxClient, tenantId: string, warehouseId: string, variantId: string, batchId: string | null): Promise<BalanceRow> {
    const batchKey = batchId ?? '';
    await tx.$executeRaw`INSERT INTO stock_balances (id, tenant_id, warehouse_id, variant_id, batch_id, batch_key, on_hand, reserved, incoming, updated_at)
      VALUES (gen_random_uuid(), ${tenantId}::uuid, ${warehouseId}::uuid, ${variantId}::uuid, ${batchId}::uuid, ${batchKey}, 0, 0, 0, now())
      ON CONFLICT (tenant_id, warehouse_id, variant_id, batch_key) DO NOTHING`;
    const rows = await tx.$queryRaw<BalanceRow[]>`SELECT id, on_hand, reserved FROM stock_balances
      WHERE tenant_id = ${tenantId}::uuid AND warehouse_id = ${warehouseId}::uuid AND variant_id = ${variantId}::uuid AND batch_key = ${batchKey} FOR UPDATE`;
    return rows[0];
  }

  /** Locks the variant and validates it can carry stock with the given batch (shared by apply() and reservations). */
  async lockAndValidateVariant(tx: TxClient, tenantId: string, variantId: string, batchId: string | null | undefined): Promise<VariantRow> {
    const variant = await this.lockVariant(tx, tenantId, variantId);
    if (variant.type !== 'GOODS') throw Errors.validation('Chỉ hàng hóa (GOODS) mới theo dõi tồn kho', { variantId, type: variant.type });
    if (variant.deleted_at) throw Errors.validation('Hàng hóa đã bị xóa', { variantId });
    if (variant.track_batch && !batchId) throw Errors.conflict('BATCH_REQUIRED', 'Hàng hóa này bắt buộc chọn lô', { variantId });
    if (!variant.track_batch && batchId) throw Errors.conflict('BATCH_NOT_ALLOWED', 'Hàng hóa này không theo dõi lô', { variantId });
    if (batchId) {
      const batch = await tx.productBatch.findFirst({ where: { id: batchId, variantId } });
      if (!batch) throw Errors.notFound('Lô hàng', batchId);
    }
    return variant;
  }

  /** Applies one signed quantity change: balance, movement, cost ledger, variant cost/on-hand. */
  async apply(tx: TxClient, c: StockChange): Promise<StockChangeResult> {
    const quantity = toQty(c.quantity);
    if (quantity.isZero()) throw Errors.validation('Số lượng phải khác 0', { variantId: c.variantId });

    const variant = await this.lockAndValidateVariant(tx, c.tenantId, c.variantId, c.batchId);
    const bal = await this.lockBalance(tx, c.tenantId, c.warehouseId, c.variantId, c.batchId ?? null);
    const onHandBefore = D(bal.on_hand);
    const onHandAfter = onHandBefore.plus(quantity);
    // BR-21/BR-25: outflows may not take stock below what is reserved (available = on_hand − reserved)
    const floor = c.skipAvailabilityCheck ? ZERO : D(bal.reserved);
    if (quantity.lessThan(0) && !c.allowNegative && onHandAfter.lessThan(floor)) {
      throw Errors.insufficientStock({ variantId: c.variantId, warehouseId: c.warehouseId, batchId: c.batchId ?? null, onHand: onHandBefore.toString(), reserved: D(bal.reserved).toString(), available: onHandBefore.minus(D(bal.reserved)).toString(), requested: quantity.abs().toString() });
    }

    const cost = applyCost({ qty: D(variant.on_hand_total), avgCost: D(variant.cost_price) }, quantity, c.unitCost);

    await tx.$executeRaw`UPDATE stock_balances SET on_hand = ${onHandAfter.toString()}::numeric, updated_at = now() WHERE id = ${bal.id}::uuid`;
    const movement = await tx.stockMovement.create({
      data: {
        tenantId: c.tenantId, warehouseId: c.warehouseId, variantId: c.variantId, batchId: c.batchId ?? null,
        type: c.type, quantity, unitCost: cost.unitCost, totalCost: cost.valueDelta.abs(), balanceAfter: onHandAfter,
        documentType: c.documentType, documentId: c.documentId, documentCode: c.documentCode, lineId: c.lineId ?? null,
        reason: c.reason ?? null, note: c.note ?? null, createdById: c.userId ?? null,
      },
      select: { id: true },
    });
    await tx.costLedgerEntry.create({
      data: {
        tenantId: c.tenantId, variantId: c.variantId, movementId: movement.id, quantityDelta: quantity, unitCost: cost.unitCost, valueDelta: cost.valueDelta,
        qtyBefore: D(variant.on_hand_total), qtyAfter: cost.qtyAfter, avgCostBefore: D(variant.cost_price), avgCostAfter: cost.avgAfter,
      },
    });
    await tx.$executeRaw`UPDATE product_variants SET cost_price = ${cost.avgAfter.toString()}::numeric, on_hand_total = ${cost.qtyAfter.toString()}::numeric,
      ${c.type === 'PURCHASE' && quantity.greaterThan(0) ? Prisma.sql`last_purchase_price = ${cost.unitCost.toString()}::numeric,` : Prisma.empty} updated_at = now()
      WHERE id = ${c.variantId}::uuid`;

    return { movementId: movement.id, unitCost: cost.unitCost, totalCost: cost.valueDelta.abs(), balanceAfter: onHandAfter, onHandBefore, avgCostAfter: cost.avgAfter };
  }

  /**
   * On-hand for a (warehouse, variant, batch) read UNDER the row locks (variant → balance), so the value cannot change
   * before a subsequent apply() in the same transaction – used by ADJUSTMENT with actualQuantity (BR-23/BR-24).
   */
  async lockedOnHand(tx: TxClient, tenantId: string, warehouseId: string, variantId: string, batchId: string | null): Promise<Prisma.Decimal> {
    await this.lockAndValidateVariant(tx, tenantId, variantId, batchId);
    const bal = await this.lockBalance(tx, tenantId, warehouseId, variantId, batchId);
    return D(bal.on_hand);
  }
}
