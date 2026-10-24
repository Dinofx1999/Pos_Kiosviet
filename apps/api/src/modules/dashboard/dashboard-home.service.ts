import { Injectable } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { hasPermission } from '@erp/shared';
import { AccessService } from '../../infra/access/access.service';
import { RequestUser } from '../../infra/cls/request-context';
import { PrismaService } from '../../infra/prisma/prisma.service';
import { StockQueryService } from '../inventory/stock-query.service';

const NONE = '00000000-0000-0000-0000-000000000000';
const D = (v: unknown) => new Prisma.Decimal((v as Prisma.Decimal | null) ?? 0);
const S = (v: unknown) => D(v).toFixed(2);
const N = (v: unknown) => Number(v ?? 0);

interface PeriodRow { count: bigint; revenue: Prisma.Decimal; cost: Prisma.Decimal; customers: bigint }

/**
 * Màn hình Tổng quan (trang chủ, dùng chính trên điện thoại): một lần gọi trả về kết quả bán hàng hôm nay
 * so với hôm qua / tuần / tháng, doanh thu theo giờ và theo ngày, hàng bán chạy, hoạt động gần đây, việc cần xử lý
 * và vài con số tồn kho. Mọi truy vấn gắn tenant_id + phạm vi chi nhánh của người dùng; người không có quyền
 * xem báo cáo bán hàng chỉ thấy số liệu của chính mình (seller_id = mình). Ngày tính theo múi giờ của gian hàng.
 */
@Injectable()
export class DashboardHomeService {
  constructor(private readonly prisma: PrismaService, private readonly access: AccessService, private readonly stock: StockQueryService) {}

  async home(user: RequestUser, branchId?: string) {
    const tenant = await this.prisma.raw.tenant.findUniqueOrThrow({ where: { id: user.tenantId }, select: { timezone: true } });
    const tz = tenant.timezone || 'Asia/Ho_Chi_Minh';
    const scope = this.access.branchWhere(user);
    let branchIds: string[] | null = scope.branchId ? (scope.branchId.in.length ? scope.branchId.in : [NONE]) : null;
    if (branchId) branchIds = !branchIds || branchIds.includes(branchId) ? [branchId] : [NONE];
    const tid = Prisma.sql`${user.tenantId}::uuid`;
    const branchIn = (col: string) => (branchIds ? Prisma.sql`AND ${Prisma.raw(col)} IN (${Prisma.join(branchIds.map((id) => Prisma.sql`${id}::uuid`))})` : Prisma.empty);
    const canSales = hasPermission(user.permissions, 'sales.report.view');
    const canInvoices = canSales || hasPermission(user.permissions, 'invoice.view');
    const canProfit = hasPermission(user.permissions, 'report.profit.view') || hasPermission(user.permissions, 'inventory.cost.view');
    // without the report permission a cashier sees only what they sold themselves
    const sellerEq = (col: string) => (canSales ? Prisma.empty : Prisma.sql`AND ${Prisma.raw(col)} = ${user.id}::uuid`);
    const localDate = (col: string) => Prisma.sql`(${Prisma.raw(col)} AT TIME ZONE ${tz})::date`;
    const today = Prisma.sql`(now() AT TIME ZONE ${tz})::date`;

    const salesPromise = canInvoices ? this.sales(tid, branchIn, sellerEq, localDate, today, tz, canProfit) : Promise.resolve(null);
    const [sales, todo, inventory, shift] = await Promise.all([
      salesPromise,
      this.todo(user, tid, branchIds, branchIn, today),
      this.inventory(user, scope),
      this.openShift(user, tid),
    ]);
    return { generatedAt: new Date(), timezone: tz, sales, todo, inventory, shift };
  }

  private async sales(tid: Prisma.Sql, branchIn: (c: string) => Prisma.Sql, sellerEq: (c: string) => Prisma.Sql, localDate: (c: string) => Prisma.Sql, today: Prisma.Sql, tz: string, canProfit: boolean) {
    const base = Prisma.sql`FROM invoices WHERE tenant_id = ${tid} AND status = 'COMPLETED' ${branchIn('branch_id')} ${sellerEq('seller_id')}`;
    const period = (cond: Prisma.Sql) => Prisma.sql`count(*) FILTER (WHERE ${cond})::bigint AS count, COALESCE(SUM(total_amount) FILTER (WHERE ${cond}),0) AS revenue, COALESCE(SUM(cost_total) FILTER (WHERE ${cond}),0) AS cost, count(DISTINCT customer_id) FILTER (WHERE ${cond})::bigint AS customers`;
    const d = localDate('invoice_date');
    const [p, byHour, byDay, top, recent, unpaid, returns] = await Promise.all([
      this.prisma.raw.$queryRaw<Array<{ k: string } & PeriodRow>>`
        SELECT 'today' AS k, ${period(Prisma.sql`${d} = ${today}`)} ${base} AND invoice_date >= now() - interval '2 days'
        UNION ALL SELECT 'yesterday', ${period(Prisma.sql`${d} = ${today} - 1`)} ${base} AND invoice_date >= now() - interval '3 days'
        UNION ALL SELECT 'week', ${period(Prisma.sql`${d} > ${today} - 7`)} ${base} AND invoice_date >= now() - interval '8 days'
        UNION ALL SELECT 'lastWeek', ${period(Prisma.sql`${d} > ${today} - 14 AND ${d} <= ${today} - 7`)} ${base} AND invoice_date >= now() - interval '15 days'
        UNION ALL SELECT 'month', ${period(Prisma.sql`${d} >= date_trunc('month', ${today})::date`)} ${base} AND invoice_date >= now() - interval '32 days'
        UNION ALL SELECT 'lastMonth', ${period(Prisma.sql`${d} >= (date_trunc('month', ${today}) - interval '1 month')::date AND ${d} < date_trunc('month', ${today})::date`)} ${base} AND invoice_date >= now() - interval '63 days'`,
      this.prisma.raw.$queryRaw<Array<{ hour: number; count: bigint; revenue: Prisma.Decimal }>>`SELECT EXTRACT(HOUR FROM invoice_date AT TIME ZONE ${tz})::int AS hour, count(*)::bigint AS count, COALESCE(SUM(total_amount),0) AS revenue ${base} AND ${d} = ${today} GROUP BY 1 ORDER BY 1`,
      this.prisma.raw.$queryRaw<Array<{ day: Date; count: bigint; revenue: Prisma.Decimal; cost: Prisma.Decimal }>>`SELECT ${d} AS day, count(*)::bigint AS count, COALESCE(SUM(total_amount),0) AS revenue, COALESCE(SUM(cost_total),0) AS cost ${base} AND ${d} > ${today} - 30 GROUP BY 1 ORDER BY 1`,
      this.prisma.raw.$queryRaw<Array<{ variant_id: string; sku: string; name: string; quantity: Prisma.Decimal; revenue: Prisma.Decimal }>>`SELECT v.id AS variant_id, v.sku, v.name, COALESCE(SUM(l.base_quantity),0) AS quantity, COALESCE(SUM(l.line_total * (1 - (i.discount_amount + i.promotion_discount) / NULLIF(i.subtotal, 0))),0) AS revenue
        FROM invoice_lines l JOIN invoices i ON i.id = l.invoice_id JOIN product_variants v ON v.id = l.variant_id
        WHERE i.tenant_id = ${tid} AND i.status = 'COMPLETED' AND ${localDate('i.invoice_date')} > ${today} - 7 ${branchIn('i.branch_id')} ${sellerEq('i.seller_id')} AND NOT l.is_gift
        GROUP BY v.id, v.sku, v.name ORDER BY revenue DESC LIMIT 5`,
      this.prisma.raw.$queryRaw<Array<{ id: string; code: string; invoice_date: Date; total_amount: Prisma.Decimal; paid_amount: Prisma.Decimal; status: string; customer_name: string | null; seller_name: string | null; lines: bigint }>>`SELECT i.id, i.code, i.invoice_date, i.total_amount, i.paid_amount, i.status::text AS status, c.name AS customer_name, u.full_name AS seller_name, (SELECT count(*) FROM invoice_lines l WHERE l.invoice_id = i.id)::bigint AS lines
        FROM invoices i LEFT JOIN customers c ON c.id = i.customer_id LEFT JOIN users u ON u.id = i.seller_id
        WHERE i.tenant_id = ${tid} AND i.status IN ('COMPLETED','CANCELLED') ${branchIn('i.branch_id')} ${sellerEq('i.seller_id')} ORDER BY i.invoice_date DESC LIMIT 8`,
      this.prisma.raw.$queryRaw<Array<{ count: bigint; amount: Prisma.Decimal }>>`SELECT count(*)::bigint AS count, COALESCE(SUM(total_amount - paid_amount),0) AS amount ${base} AND paid_amount < total_amount`,
      this.prisma.raw.$queryRaw<Array<{ count: bigint; amount: Prisma.Decimal }>>`SELECT count(*)::bigint AS count, COALESCE(SUM(total_refund),0) AS amount FROM sales_returns WHERE tenant_id = ${tid} AND status = 'COMPLETED' AND ${localDate('return_date')} = ${today} ${branchIn('branch_id')}`,
    ]);
    const byKey = Object.fromEntries(p.map((r) => [r.k, r])) as Record<string, PeriodRow>;
    const pick = (k: string) => {
      const r = byKey[k];
      const revenue = D(r?.revenue); const cost = D(r?.cost);
      return { invoices: N(r?.count), revenue: revenue.toFixed(2), customers: N(r?.customers), ...(canProfit ? { grossProfit: revenue.minus(cost).toFixed(2) } : {}) };
    };
    return {
      today: pick('today'), yesterday: pick('yesterday'), week: pick('week'), lastWeek: pick('lastWeek'), month: pick('month'), lastMonth: pick('lastMonth'),
      byHour: byHour.map((h) => ({ hour: Number(h.hour), invoices: N(h.count), revenue: S(h.revenue) })),
      byDay: byDay.map((x) => ({ day: x.day instanceof Date ? x.day.toISOString().slice(0, 10) : String(x.day).slice(0, 10), invoices: N(x.count), revenue: S(x.revenue), ...(canProfit ? { grossProfit: D(x.revenue).minus(D(x.cost)).toFixed(2) } : {}) })),
      topProducts: top.map((r) => ({ variantId: r.variant_id, sku: r.sku, name: r.name, quantity: D(r.quantity).toFixed(3), revenue: S(r.revenue) })),
      recentInvoices: recent.map((r) => ({ id: r.id, code: r.code, invoiceDate: r.invoice_date, totalAmount: S(r.total_amount), paidAmount: S(r.paid_amount), status: r.status, customerName: r.customer_name, sellerName: r.seller_name, lines: N(r.lines) })),
      unpaid: { count: N(unpaid[0]?.count), amount: S(unpaid[0]?.amount) },
      returnsToday: { count: N(returns[0]?.count), amount: S(returns[0]?.amount) },
    };
  }

  private async todo(user: RequestUser, tid: Prisma.Sql, branchIds: string[] | null, branchIn: (c: string) => Prisma.Sql, today: Prisma.Sql) {
    const has = (p: string) => hasPermission(user.permissions, p);
    const branchWhere = branchIds ? { branchId: { in: branchIds } } : {};
    const [orders, deliveries, transfers, birthdays, drafts] = await Promise.all([
      has('order.view') ? this.prisma.db.salesOrder.count({ where: { status: 'CONFIRMED', ...branchWhere } }) : Promise.resolve(null),
      has('delivery.view') ? this.prisma.db.delivery.count({ where: { status: { in: ['PENDING', 'PICKING', 'DELIVERING'] }, ...branchWhere } }) : Promise.resolve(null),
      has('transfer.view') ? this.prisma.db.stockTransfer.count({ where: { status: 'IN_TRANSIT', ...(branchIds ? { toBranchId: { in: branchIds } } : {}) } }) : Promise.resolve(null),
      has('customer.view') ? this.prisma.raw.$queryRaw<Array<{ count: bigint }>>`SELECT count(*)::bigint AS count FROM customers WHERE tenant_id = ${tid} AND is_active = true AND birthday IS NOT NULL AND EXTRACT(MONTH FROM birthday) = EXTRACT(MONTH FROM ${today}) AND EXTRACT(DAY FROM birthday) = EXTRACT(DAY FROM ${today})`.then((r) => N(r[0]?.count)) : Promise.resolve(null),
      has('invoice.view') ? this.prisma.raw.$queryRaw<Array<{ count: bigint }>>`SELECT count(*)::bigint AS count FROM invoices WHERE tenant_id = ${tid} AND status = 'DRAFT' ${branchIn('branch_id')} ${has('sales.report.view') ? Prisma.empty : Prisma.sql`AND seller_id = ${user.id}::uuid`}`.then((r) => N(r[0]?.count)) : Promise.resolve(null),
    ]);
    return { pendingOrders: orders, deliveriesInProgress: deliveries, transfersToReceive: transfers, birthdaysToday: birthdays, heldInvoices: drafts };
  }

  private async inventory(user: RequestUser, scope: { branchId?: { in: string[] } }) {
    if (!hasPermission(user.permissions, 'inventory.view')) return null;
    const [summary, products, warehouses, recentDocuments] = await Promise.all([
      this.stock.summary(user),
      this.prisma.db.product.count({ where: { deletedAt: null, isActive: true } }),
      this.prisma.db.warehouse.count({ where: { isActive: true } }),
      hasPermission(user.permissions, 'inventory.document.view')
        ? this.prisma.db.inventoryDocument.findMany({ where: { AND: [scope, { status: { not: 'CANCELLED' } }] }, select: { id: true, code: true, type: true, status: true, totalCost: true, createdAt: true, warehouse: { select: { name: true } } }, orderBy: { createdAt: 'desc' }, take: 5 })
        : Promise.resolve([]),
    ]);
    return { ...summary, products, warehouses, recentDocuments };
  }

  private async openShift(user: RequestUser, tid: Prisma.Sql) {
    const shift = await this.prisma.db.shift.findFirst({ where: { userId: user.id, status: 'OPEN' }, select: { id: true, code: true, openedAt: true, openingCash: true, branch: { select: { id: true, name: true } } }, orderBy: { openedAt: 'desc' } });
    if (!shift) return null;
    const [[inv], [cash]] = await Promise.all([
      this.prisma.raw.$queryRaw<Array<{ count: bigint; revenue: Prisma.Decimal }>>`SELECT count(*)::bigint AS count, COALESCE(SUM(total_amount),0) AS revenue FROM invoices WHERE tenant_id = ${tid} AND status = 'COMPLETED' AND shift_id = ${shift.id}::uuid`,
      this.prisma.raw.$queryRaw<Array<{ cash: Prisma.Decimal }>>`SELECT COALESCE(SUM(CASE WHEN direction = 'IN' THEN amount ELSE -amount END),0) AS cash FROM payments WHERE tenant_id = ${tid} AND shift_id = ${shift.id}::uuid AND status = 'POSTED' AND method = 'CASH'`,
    ]);
    return { id: shift.id, code: shift.code, openedAt: shift.openedAt, branch: shift.branch, openingCash: S(shift.openingCash), invoices: N(inv?.count), revenue: S(inv?.revenue), cashNet: S(cash?.cash) };
  }
}
