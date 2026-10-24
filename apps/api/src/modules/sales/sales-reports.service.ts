import { Injectable } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { D, ZERO } from '../../common/utils/decimal';
import { AccessService } from '../../infra/access/access.service';
import { RequestUser } from '../../infra/cls/request-context';
import { PrismaService } from '../../infra/prisma/prisma.service';
import { SalesReportQueryDto } from './dto/sales.dto';

const NONE = '00000000-0000-0000-0000-000000000000';

/** Revenue / COGS / gross profit from COMPLETED invoices (Module 10 foundation). */
@Injectable()
export class SalesReportsService {
  constructor(private readonly prisma: PrismaService, private readonly access: AccessService) {}

  async summary(user: RequestUser, q: SalesReportQueryDto) {
    const scope = this.access.branchWhere(user);
    if (q.branchId && scope.branchId && !scope.branchId.in.includes(q.branchId)) return this.empty();
    const branchIds = q.branchId ? [q.branchId] : scope.branchId ? (scope.branchId.in.length ? scope.branchId.in : [NONE]) : null;
    const from = q.from ? new Date(q.from) : new Date(new Date().setHours(0, 0, 0, 0));
    const to = q.to ? new Date(q.to) : new Date();
    const bucket = q.groupBy === 'month' ? 'month' : 'day';
    const tenant = user.tenantId;
    const branchIn = (col: string) => (branchIds ? Prisma.sql`AND ${Prisma.raw(col)} IN (${Prisma.join(branchIds.map((id) => Prisma.sql`${id}::uuid`))})` : Prisma.empty);
    const sellerEq = (col: string) => (q.sellerId ? Prisma.sql`AND ${Prisma.raw(col)} = ${q.sellerId}::uuid` : Prisma.empty);

    const [byPeriod, bySeller, byProduct, byMethod, byBranch, totalsRow] = await Promise.all([
      this.prisma.raw.$queryRaw<Array<{ period: Date; count: bigint; revenue: Prisma.Decimal; cost: Prisma.Decimal; discount: Prisma.Decimal; paid: Prisma.Decimal }>>`SELECT date_trunc(${bucket}, invoice_date) AS period, count(*)::bigint AS count, COALESCE(SUM(total_amount),0) AS revenue, COALESCE(SUM(cost_total),0) AS cost, COALESCE(SUM(discount_amount + promotion_discount),0) AS discount, COALESCE(SUM(paid_amount),0) AS paid
        FROM invoices WHERE tenant_id = ${tenant}::uuid AND status = 'COMPLETED' AND invoice_date BETWEEN ${from} AND ${to} ${branchIn('branch_id')} ${sellerEq('seller_id')} GROUP BY 1 ORDER BY 1`,
      this.prisma.raw.$queryRaw<Array<{ seller_id: string | null; full_name: string | null; count: bigint; revenue: Prisma.Decimal; cost: Prisma.Decimal }>>`SELECT i.seller_id, u.full_name, count(*)::bigint AS count, COALESCE(SUM(i.total_amount),0) AS revenue, COALESCE(SUM(i.cost_total),0) AS cost
        FROM invoices i LEFT JOIN users u ON u.id = i.seller_id WHERE i.tenant_id = ${tenant}::uuid AND i.status = 'COMPLETED' AND i.invoice_date BETWEEN ${from} AND ${to} ${branchIn('i.branch_id')} ${sellerEq('i.seller_id')} GROUP BY 1,2 ORDER BY revenue DESC LIMIT 50`,
      this.prisma.raw.$queryRaw<Array<{ variant_id: string; sku: string; name: string; quantity: Prisma.Decimal; revenue: Prisma.Decimal; cost: Prisma.Decimal }>>`SELECT v.id AS variant_id, v.sku, v.name, COALESCE(SUM(l.base_quantity),0) AS quantity, COALESCE(SUM(l.line_total * (1 - (i.discount_amount + i.promotion_discount) / NULLIF(i.subtotal, 0))),0) AS revenue, COALESCE(SUM(l.cost_total),0) AS cost
        FROM invoice_lines l JOIN invoices i ON i.id = l.invoice_id JOIN product_variants v ON v.id = l.variant_id
        WHERE i.tenant_id = ${tenant}::uuid AND i.status = 'COMPLETED' AND i.invoice_date BETWEEN ${from} AND ${to} ${branchIn('i.branch_id')} ${sellerEq('i.seller_id')} GROUP BY v.id, v.sku, v.name ORDER BY revenue DESC LIMIT 20`,
      this.prisma.raw.$queryRaw<Array<{ method: string; amount: Prisma.Decimal; count: bigint }>>`SELECT method::text AS method, COALESCE(SUM(amount),0) AS amount, count(*)::bigint AS count
        FROM payments WHERE tenant_id = ${tenant}::uuid AND status = 'POSTED' AND direction = 'IN' AND (party_type = 'CUSTOMER' OR party_type IS NULL) AND payment_date BETWEEN ${from} AND ${to} ${branchIn('branch_id')} GROUP BY 1 ORDER BY amount DESC`,
      this.prisma.raw.$queryRaw<Array<{ branch_id: string; name: string; count: bigint; revenue: Prisma.Decimal; cost: Prisma.Decimal }>>`SELECT b.id AS branch_id, b.name, count(i.id)::bigint AS count, COALESCE(SUM(i.total_amount),0) AS revenue, COALESCE(SUM(i.cost_total),0) AS cost
        FROM invoices i JOIN branches b ON b.id = i.branch_id WHERE i.tenant_id = ${tenant}::uuid AND i.status = 'COMPLETED' AND i.invoice_date BETWEEN ${from} AND ${to} ${branchIn('i.branch_id')} ${sellerEq('i.seller_id')} GROUP BY b.id, b.name ORDER BY revenue DESC`,
      this.prisma.raw.$queryRaw<Array<{ count: bigint; revenue: Prisma.Decimal; cost: Prisma.Decimal; discount: Prisma.Decimal; paid: Prisma.Decimal; cancelled: bigint }>>`SELECT count(*) FILTER (WHERE status = 'COMPLETED')::bigint AS count, COALESCE(SUM(total_amount) FILTER (WHERE status = 'COMPLETED'),0) AS revenue, COALESCE(SUM(cost_total) FILTER (WHERE status = 'COMPLETED'),0) AS cost, COALESCE(SUM(discount_amount + promotion_discount) FILTER (WHERE status = 'COMPLETED'),0) AS discount, COALESCE(SUM(paid_amount) FILTER (WHERE status = 'COMPLETED'),0) AS paid, count(*) FILTER (WHERE status = 'CANCELLED')::bigint AS cancelled
        FROM invoices WHERE tenant_id = ${tenant}::uuid AND invoice_date BETWEEN ${from} AND ${to} ${branchIn('branch_id')} ${sellerEq('seller_id')}`,
    ]);
    const t = totalsRow[0];
    const revenue = D(t?.revenue ?? 0); const cost = D(t?.cost ?? 0);
    const retRow = (await this.prisma.raw.$queryRaw<Array<{ count: bigint; refund: Prisma.Decimal; restock: Prisma.Decimal; damaged: Prisma.Decimal }>>`SELECT count(*)::bigint AS count, COALESCE(SUM(total_refund),0) AS refund, COALESCE(SUM(restock_value),0) AS restock, COALESCE(SUM(damaged_value),0) AS damaged
        FROM sales_returns WHERE tenant_id = ${tenant}::uuid AND status = 'COMPLETED' AND return_date BETWEEN ${from} AND ${to} ${branchIn('branch_id')}`)[0];
    const returned = D(retRow?.refund ?? 0); const restocked = D(retRow?.restock ?? 0);
    return {
      from, to, groupBy: bucket,
      totals: { invoices: Number(t?.count ?? 0), cancelled: Number(t?.cancelled ?? 0), revenue, cost, grossProfit: revenue.minus(cost), discount: D(t?.discount ?? 0), paid: D(t?.paid ?? 0), debt: revenue.minus(D(t?.paid ?? 0)),
        returns: Number(retRow?.count ?? 0), returned, damaged: D(retRow?.damaged ?? 0), netRevenue: revenue.minus(returned), netGrossProfit: revenue.minus(returned).minus(cost).plus(restocked) },
      byPeriod: byPeriod.map((r) => ({ period: r.period, invoices: Number(r.count), revenue: D(r.revenue), cost: D(r.cost), grossProfit: D(r.revenue).minus(D(r.cost)), discount: D(r.discount), paid: D(r.paid) })),
      bySeller: bySeller.map((r) => ({ sellerId: r.seller_id, name: r.full_name ?? '—', invoices: Number(r.count), revenue: D(r.revenue), grossProfit: D(r.revenue).minus(D(r.cost)) })),
      byBranch: byBranch.map((r) => ({ branchId: r.branch_id, name: r.name, invoices: Number(r.count), revenue: D(r.revenue), grossProfit: D(r.revenue).minus(D(r.cost)) })),
      byProduct: byProduct.map((r) => ({ variantId: r.variant_id, sku: r.sku, name: r.name, quantity: D(r.quantity), revenue: D(r.revenue), grossProfit: D(r.revenue).minus(D(r.cost)) })),
      byMethod: byMethod.map((r) => ({ method: r.method, amount: D(r.amount), count: Number(r.count) })),
    };
  }

  private empty() {
    return { from: null, to: null, groupBy: 'day', totals: { invoices: 0, cancelled: 0, revenue: ZERO, cost: ZERO, grossProfit: ZERO, discount: ZERO, paid: ZERO, debt: ZERO, returns: 0, returned: ZERO, damaged: ZERO, netRevenue: ZERO, netGrossProfit: ZERO }, byPeriod: [], bySeller: [], byBranch: [], byProduct: [], byMethod: [] };
  }
}
