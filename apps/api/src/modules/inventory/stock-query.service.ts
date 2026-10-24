import { Injectable } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { paginated, skipTake } from '../../common/pagination';
import { D, ZERO } from '../../common/utils/decimal';
import { AccessService } from '../../infra/access/access.service';
import { RequestUser } from '../../infra/cls/request-context';
import { PrismaService } from '../../infra/prisma/prisma.service';
import { BalanceQueryDto, MovementQueryDto } from './dto/inventory.dto';

@Injectable()
export class StockQueryService {
  constructor(private readonly prisma: PrismaService, private readonly access: AccessService) {}

  async balances(user: RequestUser, q: BalanceQueryDto) {
    const whWhere = await this.access.warehouseWhere(user);
    const filters: Prisma.StockBalanceWhereInput = {
      ...(q.warehouseId ? { warehouseId: q.warehouseId } : {}),
      ...(q.variantId ? { variantId: q.variantId } : {}),
      ...(q.nonZero !== 'false' ? { OR: [{ onHand: { not: 0 } }, { reserved: { not: 0 } }] } : {}),
      variant: {
        deletedAt: null,
        ...(q.productId ? { productId: q.productId } : {}),
        ...(q.categoryId ? { product: { categoryId: q.categoryId } } : {}),
        ...(q.search ? { OR: [{ sku: { contains: q.search, mode: 'insensitive' } }, { name: { contains: q.search, mode: 'insensitive' } }, { barcode: { contains: q.search, mode: 'insensitive' } }] } : {}),
        ...(q.lowStock === 'true' ? { minStock: { not: null } } : {}),
      },
    };
    const where: Prisma.StockBalanceWhereInput = { AND: [whWhere, filters] }; // H1: scope cannot be overridden by query params
    const include = { variant: { select: { id: true, sku: true, barcode: true, name: true, costPrice: true, sellPrice: true, minStock: true, maxStock: true, onHandTotal: true, product: { select: { id: true, code: true, name: true, baseUnit: true } } } }, warehouse: { select: { id: true, code: true, name: true } }, batch: { select: { id: true, batchNo: true, expiryDate: true } } } satisfies Prisma.StockBalanceInclude;
    let rows = await this.prisma.db.stockBalance.findMany({ where, include, orderBy: [{ variant: { name: 'asc' } }, { warehouse: { name: 'asc' } }], ...(q.lowStock === 'true' ? {} : skipTake(q)) });
    let total: number;
    if (q.lowStock === 'true') {
      rows = rows.filter((r) => r.variant.minStock !== null && D(r.onHand).lessThanOrEqualTo(D(r.variant.minStock)));
      total = rows.length;
      rows = rows.slice((q.page - 1) * q.pageSize, q.page * q.pageSize);
    } else total = await this.prisma.db.stockBalance.count({ where });
    return paginated(rows.map((r) => ({ ...r, available: D(r.onHand).minus(D(r.reserved)), value: user.permissions.has('*') || user.permissions.has('inventory.cost.view') ? D(r.onHand).times(D(r.variant.costPrice)) : undefined })), total, q);
  }

  async summary(user: RequestUser, warehouseId?: string) {
    const whWhere = await this.access.warehouseWhere(user);
    const where: Prisma.StockBalanceWhereInput = { AND: [whWhere, { ...(warehouseId ? { warehouseId } : {}), variant: { deletedAt: null } }] };
    const rows = await this.prisma.db.stockBalance.findMany({ where, select: { onHand: true, reserved: true, variant: { select: { id: true, costPrice: true, minStock: true } } } });
    let onHandTotal = ZERO, reservedTotal = ZERO, stockValue = ZERO, lowStockCount = 0;
    const skus = new Set<string>();
    for (const r of rows) {
      const oh = D(r.onHand);
      if (!oh.isZero()) skus.add(r.variant.id);
      onHandTotal = onHandTotal.plus(oh);
      reservedTotal = reservedTotal.plus(D(r.reserved));
      stockValue = stockValue.plus(oh.times(D(r.variant.costPrice)));
      if (r.variant.minStock !== null && oh.lessThanOrEqualTo(D(r.variant.minStock))) lowStockCount++;
    }
    const canSeeCost = user.permissions.has('*') || user.permissions.has('inventory.cost.view');
    return { skuCount: skus.size, onHandTotal, reservedTotal, stockValue: canSeeCost ? stockValue : undefined, lowStockCount };
  }

  async movements(user: RequestUser, q: MovementQueryDto) {
    const whWhere = await this.access.warehouseWhere(user);
    const filters: Prisma.StockMovementWhereInput = {
      ...(q.warehouseId ? { warehouseId: q.warehouseId } : {}),
      ...(q.variantId ? { variantId: q.variantId } : {}),
      ...(q.productId ? { variant: { productId: q.productId } } : {}),
      ...(q.documentType ? { documentType: q.documentType } : {}),
      ...(q.documentId ? { documentId: q.documentId } : {}),
      ...(q.type ? { type: q.type as any } : {}),
      ...(q.from || q.to ? { createdAt: { ...(q.from ? { gte: new Date(q.from) } : {}), ...(q.to ? { lte: new Date(q.to) } : {}) } } : {}),
      ...(q.search ? { OR: [{ documentCode: { contains: q.search, mode: 'insensitive' } }, { variant: { OR: [{ sku: { contains: q.search, mode: 'insensitive' } }, { name: { contains: q.search, mode: 'insensitive' } }] } }] } : {}),
    };
    const where: Prisma.StockMovementWhereInput = { AND: [whWhere, filters] };
    const [rows, total] = await Promise.all([
      this.prisma.db.stockMovement.findMany({ where, include: { variant: { select: { id: true, sku: true, name: true, product: { select: { code: true, name: true, baseUnit: true } } } }, warehouse: { select: { id: true, name: true } }, batch: { select: { batchNo: true } } }, ...skipTake(q), orderBy: [{ createdAt: 'desc' }, { id: 'desc' }] }),
      this.prisma.db.stockMovement.count({ where }),
    ]);
    return paginated(rows, total, q);
  }

  /** On-hand per variant (optionally per warehouse) – used by product listing. */
  async variantStock(variantIds: string[], warehouseId?: string) {
    if (variantIds.length === 0) return new Map<string, { onHand: Prisma.Decimal; reserved: Prisma.Decimal }>();
    const grouped = await this.prisma.db.stockBalance.groupBy({ by: ['variantId'], where: { variantId: { in: variantIds }, ...(warehouseId ? { warehouseId } : {}) }, _sum: { onHand: true, reserved: true } });
    return new Map(grouped.map((g) => [g.variantId, { onHand: D(g._sum.onHand), reserved: D(g._sum.reserved) }]));
  }

  /** BR-20 reconciliation: compares stock_balances with Σ stock_movements and variant on_hand_total. */
  async reconcile(tenantId: string) {
    const balanceDiffs = await this.prisma.raw.$queryRaw<Array<{ warehouse_id: string; variant_id: string; batch_key: string; on_hand: Prisma.Decimal; ledger: Prisma.Decimal }>>`
      WITH ledger AS (
        SELECT warehouse_id, variant_id, COALESCE(batch_id::text, '') AS batch_key, SUM(quantity) AS ledger
        FROM stock_movements WHERE tenant_id = ${tenantId}::uuid GROUP BY 1,2,3)
      SELECT b.warehouse_id, b.variant_id, b.batch_key, b.on_hand, COALESCE(l.ledger, 0) AS ledger
      FROM stock_balances b FULL OUTER JOIN ledger l ON l.warehouse_id = b.warehouse_id AND l.variant_id = b.variant_id AND l.batch_key = b.batch_key
      WHERE b.tenant_id = ${tenantId}::uuid AND COALESCE(b.on_hand, 0) <> COALESCE(l.ledger, 0)`;
    const variantDiffs = await this.prisma.raw.$queryRaw<Array<{ variant_id: string; on_hand_total: Prisma.Decimal; balances: Prisma.Decimal }>>`
      SELECT v.id AS variant_id, v.on_hand_total, COALESCE(SUM(b.on_hand), 0) AS balances
      FROM product_variants v LEFT JOIN stock_balances b ON b.variant_id = v.id
      WHERE v.tenant_id = ${tenantId}::uuid GROUP BY v.id HAVING v.on_hand_total <> COALESCE(SUM(b.on_hand), 0)`;
    const costDiffs = await this.prisma.raw.$queryRaw<Array<{ variant_id: string; ledger_value: Prisma.Decimal; book_value: Prisma.Decimal }>>`
      SELECT v.id AS variant_id, COALESCE(SUM(c.value_delta), 0) AS ledger_value, (v.on_hand_total * v.cost_price) AS book_value
      FROM product_variants v LEFT JOIN cost_ledger_entries c ON c.variant_id = v.id
      WHERE v.tenant_id = ${tenantId}::uuid GROUP BY v.id HAVING ABS(COALESCE(SUM(c.value_delta), 0) - (v.on_hand_total * v.cost_price)) > 0.01`;
    return { ok: balanceDiffs.length === 0 && variantDiffs.length === 0, balanceDiffs, variantDiffs, costDiffs, checkedAt: new Date() };
  }
}
