import { Injectable } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { D, ZERO } from '../../common/utils/decimal';
import { AccessService } from '../../infra/access/access.service';
import { RequestUser } from '../../infra/cls/request-context';
import { PrismaService } from '../../infra/prisma/prisma.service';
import { PurchaseReportQueryDto } from './dto/purchasing.dto';

const NONE = '00000000-0000-0000-0000-000000000000';

@Injectable()
export class PurchasingReportsService {
  constructor(private readonly prisma: PrismaService, private readonly access: AccessService) {}

  /** Purchases / returns / payments over a period: totals, by period bucket, by supplier, top products (branch-scoped). */
  async summary(user: RequestUser, q: PurchaseReportQueryDto) {
    const scope = this.access.branchWhere(user);
    if (q.branchId && scope.branchId && !scope.branchId.in.includes(q.branchId)) return this.empty();
    const branchIds = q.branchId ? [q.branchId] : scope.branchId ? (scope.branchId.in.length ? scope.branchId.in : [NONE]) : null;
    const from = q.from ? new Date(q.from) : new Date(Date.now() - 30 * 86400 * 1000);
    const to = q.to ? new Date(q.to) : new Date();
    const bucket = q.groupBy === 'month' ? 'month' : 'day';
    const tenant = user.tenantId;
    const branchIn = (col: string) => (branchIds ? Prisma.sql`AND ${Prisma.raw(col)} IN (${Prisma.join(branchIds.map((id) => Prisma.sql`${id}::uuid`))})` : Prisma.empty);
    const supplierEq = (col: string) => (q.supplierId ? Prisma.sql`AND ${Prisma.raw(col)} = ${q.supplierId}::uuid` : Prisma.empty);

    const [receipts, returns, payments, bySupplier, topProducts] = await Promise.all([
      this.prisma.raw.$queryRaw<Array<{ period: Date; count: bigint; amount: Prisma.Decimal; paid: Prisma.Decimal }>>`SELECT date_trunc(${bucket}, receipt_date) AS period, count(*)::bigint AS count, COALESCE(SUM(total_amount),0) AS amount, COALESCE(SUM(paid_amount),0) AS paid
        FROM purchase_receipts WHERE tenant_id = ${tenant}::uuid AND status = 'POSTED' AND receipt_date BETWEEN ${from} AND ${to} ${branchIn('branch_id')} ${supplierEq('supplier_id')} GROUP BY 1 ORDER BY 1`,
      this.prisma.raw.$queryRaw<Array<{ period: Date; count: bigint; amount: Prisma.Decimal }>>`SELECT date_trunc(${bucket}, return_date) AS period, count(*)::bigint AS count, COALESCE(SUM(total_amount),0) AS amount
        FROM purchase_returns WHERE tenant_id = ${tenant}::uuid AND status = 'POSTED' AND return_date BETWEEN ${from} AND ${to} ${branchIn('branch_id')} ${supplierEq('supplier_id')} GROUP BY 1 ORDER BY 1`,
      this.prisma.raw.$queryRaw<Array<{ period: Date; direction: string; amount: Prisma.Decimal }>>`SELECT date_trunc(${bucket}, payment_date) AS period, direction::text AS direction, COALESCE(SUM(amount),0) AS amount
        FROM payments WHERE tenant_id = ${tenant}::uuid AND status = 'POSTED' AND party_type = 'SUPPLIER' AND payment_date BETWEEN ${from} AND ${to} ${branchIn('branch_id')} ${supplierEq('party_id')} GROUP BY 1,2 ORDER BY 1`,
      this.prisma.raw.$queryRaw<Array<{ supplier_id: string; code: string; name: string; receipts: bigint; amount: Prisma.Decimal; returned: Prisma.Decimal; paid: Prisma.Decimal }>>`SELECT s.id AS supplier_id, s.code, s.name, count(r.id)::bigint AS receipts, COALESCE(SUM(r.total_amount),0) AS amount, COALESCE(SUM(r.returned_amount),0) AS returned, COALESCE(SUM(r.paid_amount),0) AS paid
        FROM purchase_receipts r JOIN suppliers s ON s.id = r.supplier_id
        WHERE r.tenant_id = ${tenant}::uuid AND r.status = 'POSTED' AND r.receipt_date BETWEEN ${from} AND ${to} ${branchIn('r.branch_id')} ${supplierEq('r.supplier_id')}
        GROUP BY s.id, s.code, s.name ORDER BY amount DESC LIMIT 50`,
      this.prisma.raw.$queryRaw<Array<{ variant_id: string; sku: string; name: string; quantity: Prisma.Decimal; amount: Prisma.Decimal }>>`SELECT v.id AS variant_id, v.sku, v.name, COALESCE(SUM(l.quantity),0) AS quantity, COALESCE(SUM(l.line_total),0) AS amount
        FROM purchase_receipt_lines l JOIN purchase_receipts r ON r.id = l.receipt_id JOIN product_variants v ON v.id = l.variant_id
        WHERE r.tenant_id = ${tenant}::uuid AND r.status = 'POSTED' AND r.receipt_date BETWEEN ${from} AND ${to} ${branchIn('r.branch_id')} ${supplierEq('r.supplier_id')}
        GROUP BY v.id, v.sku, v.name ORDER BY amount DESC LIMIT 20`,
    ]);
    const sum = (rows: Array<{ amount: Prisma.Decimal }>) => rows.reduce((s, r) => s.plus(D(r.amount)), ZERO);
    const periods = Array.from(new Set([...receipts.map((r) => +r.period), ...returns.map((r) => +r.period), ...payments.map((p) => +p.period)])).sort();
    return {
      from, to, groupBy: bucket,
      totals: { receipts: receipts.reduce((s, r) => s + Number(r.count), 0), purchased: sum(receipts), returned: sum(returns), paidOut: sum(payments.filter((p) => p.direction === 'OUT')), refundedIn: sum(payments.filter((p) => p.direction === 'IN')) },
      byPeriod: periods.map((t) => ({
        period: new Date(t),
        receipts: Number(receipts.find((r) => +r.period === t)?.count ?? 0),
        purchased: D(receipts.find((r) => +r.period === t)?.amount ?? 0),
        returned: D(returns.find((r) => +r.period === t)?.amount ?? 0),
        paidOut: D(payments.find((p) => +p.period === t && p.direction === 'OUT')?.amount ?? 0),
      })),
      bySupplier: bySupplier.map((s) => ({ supplierId: s.supplier_id, code: s.code, name: s.name, receipts: Number(s.receipts), purchased: D(s.amount), returned: D(s.returned), paid: D(s.paid) })),
      topProducts: topProducts.map((p) => ({ variantId: p.variant_id, sku: p.sku, name: p.name, quantity: D(p.quantity), amount: D(p.amount) })),
    };
  }

  /** Supplier debt overview: balances ≠ 0 (tenant-wide) with receipt stats scoped to the user's branches. */
  async debt(user: RequestUser) {
    const balances = await this.prisma.db.partyBalance.findMany({ where: { partyType: 'SUPPLIER', balance: { not: 0 } } });
    const ids = balances.map((b) => b.partyId);
    const suppliers = ids.length ? await this.prisma.db.supplier.findMany({ where: { id: { in: ids } }, select: { id: true, code: true, name: true, phone: true } }) : [];
    const stats = ids.length ? await this.prisma.db.purchaseReceipt.groupBy({ by: ['supplierId'], where: { supplierId: { in: ids }, status: 'POSTED', ...this.access.branchWhere(user) }, _count: { _all: true }, _sum: { totalAmount: true, paidAmount: true } }) : [];
    const sMap = new Map(stats.map((u) => [u.supplierId, u]));
    const rows = suppliers
      .map((s) => { const b = balances.find((x) => x.partyId === s.id)!; const u = sMap.get(s.id); return { ...s, balance: D(b.balance), receipts: u?._count._all ?? 0, purchased: D(u?._sum.totalAmount), paid: D(u?._sum.paidAmount) }; })
      .sort((a, b) => b.balance.comparedTo(a.balance));
    return { total: rows.reduce((s, r) => s.plus(r.balance), ZERO), suppliers: rows };
  }

  private empty() {
    return { from: null, to: null, groupBy: 'day', totals: { receipts: 0, purchased: ZERO, returned: ZERO, paidOut: ZERO, refundedIn: ZERO }, byPeriod: [], bySupplier: [], topProducts: [] };
  }
}
