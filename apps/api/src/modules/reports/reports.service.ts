import { Injectable } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { Errors } from '../../common/errors/app-error';
import { paginated } from '../../common/pagination';
import { D, ZERO } from '../../common/utils/decimal';
import { AccessService } from '../../infra/access/access.service';
import { RequestUser } from '../../infra/cls/request-context';
import { PrismaService } from '../../infra/prisma/prisma.service';
import { CustomersReportQueryDto, NxtQueryDto, TaxReportQueryDto, ProfitQueryDto, SlowMoversQueryDto, TopProductsQueryDto, ValuationQueryDto } from './dto/reports.dto';

const NONE = '00000000-0000-0000-0000-000000000000';
const uuidList = (ids: string[]) => Prisma.join((ids.length ? ids : [NONE]).map((id) => Prisma.sql`${id}::uuid`));

/** Báo cáo kho & lãi lỗ (Module 10): NXT, hàng tồn lâu / bán chậm, hàng bán chạy, giá trị tồn, lãi lỗ. */
@Injectable()
export class ReportsService {
  constructor(private readonly prisma: PrismaService, private readonly access: AccessService) {}

  /** Warehouses the caller may report on (null = all of the tenant). */
  private async warehouseIds(user: RequestUser, warehouseId?: string, branchId?: string): Promise<string[] | null> {
    if (warehouseId) { await this.access.assertWarehouse(user, warehouseId, branchId); return [warehouseId]; }
    const scope = await this.access.warehouseWhere(user);
    const bscope = this.access.branchWhere(user);
    if (branchId) {
      this.access.assertBranch(user, branchId);
      const whs = await this.prisma.db.warehouse.findMany({ where: { branchId, ...(scope.warehouseId ? { id: scope.warehouseId } : {}) }, select: { id: true } });
      return whs.map((w) => w.id);
    }
    if (scope.warehouseId) return scope.warehouseId.in;
    if (bscope.branchId) return (await this.prisma.db.warehouse.findMany({ where: { branchId: bscope.branchId }, select: { id: true } })).map((w) => w.id);
    return null;
  }

  private branchIds(user: RequestUser, branchId?: string): string[] | null {
    const scope = this.access.branchWhere(user);
    if (branchId) { this.access.assertBranch(user, branchId); return [branchId]; }
    return scope.branchId ? scope.branchId.in : null;
  }

  // ---------------------------------------------------------------- NXT (nhập – xuất – tồn)
  async nxt(user: RequestUser, q: NxtQueryDto) {
    const whs = await this.warehouseIds(user, q.warehouseId, q.branchId);
    const from = q.from ? new Date(q.from) : new Date(new Date().setDate(1));
    const to = q.to ? new Date(q.to) : new Date();
    if (from > to) throw Errors.validation('Khoảng thời gian không hợp lệ');
    const tenant = user.tenantId;
    const whSql = whs ? Prisma.sql`AND m.warehouse_id IN (${uuidList(whs)})` : Prisma.empty;
    const catSql = q.categoryId ? Prisma.sql`AND p.category_id = ${q.categoryId}::uuid` : Prisma.empty;
    const searchSql = q.search ? Prisma.sql`AND (v.sku ILIKE ${'%' + q.search + '%'} OR v.name ILIKE ${'%' + q.search + '%'} OR v.barcode ILIKE ${'%' + q.search + '%'})` : Prisma.empty;
    const hideEmpty = q.hideEmpty !== 'false';
    const offset = (q.page - 1) * q.pageSize;
    // movements before `from` give the opening balance; those inside give in/out; current balances are not needed (closing = opening + in − out)
    const rows = await this.prisma.raw.$queryRaw<Array<{ variant_id: string; sku: string; name: string; barcode: string | null; base_unit: string | null; category: string | null; opening_qty: Prisma.Decimal; opening_value: Prisma.Decimal; in_qty: Prisma.Decimal; in_value: Prisma.Decimal; out_qty: Prisma.Decimal; out_value: Prisma.Decimal; cost_price: Prisma.Decimal; total: bigint }>>`
      WITH mv AS (
        SELECT m.variant_id,
          SUM(CASE WHEN m.created_at < ${from} THEN m.quantity ELSE 0 END) AS opening_qty,
          SUM(CASE WHEN m.created_at < ${from} THEN m.quantity * m.unit_cost ELSE 0 END) AS opening_value,
          SUM(CASE WHEN m.created_at >= ${from} AND m.created_at <= ${to} AND m.quantity > 0 THEN m.quantity ELSE 0 END) AS in_qty,
          SUM(CASE WHEN m.created_at >= ${from} AND m.created_at <= ${to} AND m.quantity > 0 THEN m.total_cost ELSE 0 END) AS in_value,
          SUM(CASE WHEN m.created_at >= ${from} AND m.created_at <= ${to} AND m.quantity < 0 THEN -m.quantity ELSE 0 END) AS out_qty,
          SUM(CASE WHEN m.created_at >= ${from} AND m.created_at <= ${to} AND m.quantity < 0 THEN m.total_cost ELSE 0 END) AS out_value
        FROM stock_movements m WHERE m.tenant_id = ${tenant}::uuid AND m.created_at <= ${to} ${whSql}
        GROUP BY m.variant_id
      )
      SELECT v.id AS variant_id, v.sku, v.name, v.barcode, p.base_unit, c.name AS category, v.cost_price,
        COALESCE(mv.opening_qty,0) AS opening_qty, COALESCE(mv.opening_value,0) AS opening_value, COALESCE(mv.in_qty,0) AS in_qty, COALESCE(mv.in_value,0) AS in_value, COALESCE(mv.out_qty,0) AS out_qty, COALESCE(mv.out_value,0) AS out_value,
        count(*) OVER()::bigint AS total
      FROM product_variants v JOIN products p ON p.id = v.product_id LEFT JOIN product_categories c ON c.id = p.category_id LEFT JOIN mv ON mv.variant_id = v.id
      WHERE v.tenant_id = ${tenant}::uuid AND v.deleted_at IS NULL AND p.type = 'GOODS' ${catSql} ${searchSql}
        ${hideEmpty ? Prisma.sql`AND (COALESCE(mv.opening_qty,0) <> 0 OR COALESCE(mv.in_qty,0) <> 0 OR COALESCE(mv.out_qty,0) <> 0)` : Prisma.empty}
      ORDER BY v.name, v.sku LIMIT ${q.pageSize} OFFSET ${offset}`;
    const totalsRow = await this.prisma.raw.$queryRaw<Array<{ opening_qty: Prisma.Decimal; opening_value: Prisma.Decimal; in_qty: Prisma.Decimal; in_value: Prisma.Decimal; out_qty: Prisma.Decimal; out_value: Prisma.Decimal }>>`
      SELECT COALESCE(SUM(CASE WHEN m.created_at < ${from} THEN m.quantity ELSE 0 END),0) AS opening_qty,
        COALESCE(SUM(CASE WHEN m.created_at < ${from} THEN m.quantity * m.unit_cost ELSE 0 END),0) AS opening_value,
        COALESCE(SUM(CASE WHEN m.created_at >= ${from} AND m.quantity > 0 THEN m.quantity ELSE 0 END),0) AS in_qty,
        COALESCE(SUM(CASE WHEN m.created_at >= ${from} AND m.quantity > 0 THEN m.total_cost ELSE 0 END),0) AS in_value,
        COALESCE(SUM(CASE WHEN m.created_at >= ${from} AND m.quantity < 0 THEN -m.quantity ELSE 0 END),0) AS out_qty,
        COALESCE(SUM(CASE WHEN m.created_at >= ${from} AND m.quantity < 0 THEN m.total_cost ELSE 0 END),0) AS out_value
      FROM stock_movements m JOIN product_variants v ON v.id = m.variant_id JOIN products p ON p.id = v.product_id
      WHERE m.tenant_id = ${tenant}::uuid AND m.created_at <= ${to} ${whSql} ${catSql} ${searchSql}`;
    const canCost = user.permissions.has('*') || user.permissions.has('inventory.cost.view');
    const t = totalsRow[0];
    const money = (v: Prisma.Decimal) => (canCost ? D(v) : undefined);
    const data = rows.map((r) => {
      const closingQty = D(r.opening_qty).plus(D(r.in_qty)).minus(D(r.out_qty));
      const closingValue = D(r.opening_value).plus(D(r.in_value)).minus(D(r.out_value));
      return { variantId: r.variant_id, sku: r.sku, name: r.name, barcode: r.barcode, unit: r.base_unit, category: r.category, openingQty: D(r.opening_qty), inQty: D(r.in_qty), outQty: D(r.out_qty), closingQty, openingValue: money(r.opening_value), inValue: money(r.in_value), outValue: money(r.out_value), closingValue: canCost ? closingValue : undefined, costPrice: money(r.cost_price) };
    });
    return {
      from, to, ...paginated(data, Number(rows[0]?.total ?? 0), q),
      totals: { openingQty: D(t.opening_qty), inQty: D(t.in_qty), outQty: D(t.out_qty), closingQty: D(t.opening_qty).plus(D(t.in_qty)).minus(D(t.out_qty)), openingValue: money(t.opening_value), inValue: money(t.in_value), outValue: money(t.out_value), closingValue: canCost ? D(t.opening_value).plus(D(t.in_value)).minus(D(t.out_value)) : undefined },
    };
  }

  // ---------------------------------------------------------------- hàng tồn lâu / bán chậm
  async slowMovers(user: RequestUser, q: SlowMoversQueryDto) {
    const whs = await this.warehouseIds(user, q.warehouseId, q.branchId);
    const days = q.days ?? 30;
    const since = new Date(Date.now() - days * 86400_000);
    const tenant = user.tenantId;
    const whSql = whs ? Prisma.sql`AND b.warehouse_id IN (${uuidList(whs)})` : Prisma.empty;
    const whSqlM = whs ? Prisma.sql`AND m.warehouse_id IN (${uuidList(whs)})` : Prisma.empty;
    const catSql = q.categoryId ? Prisma.sql`AND p.category_id = ${q.categoryId}::uuid` : Prisma.empty;
    const searchSql = q.search ? Prisma.sql`AND (v.sku ILIKE ${'%' + q.search + '%'} OR v.name ILIKE ${'%' + q.search + '%'})` : Prisma.empty;
    const offset = (q.page - 1) * q.pageSize;
    const rows = await this.prisma.raw.$queryRaw<Array<{ variant_id: string; sku: string; name: string; category: string | null; on_hand: Prisma.Decimal; cost_price: Prisma.Decimal; value: Prisma.Decimal; last_sale_at: Date | null; last_receipt_at: Date | null; sold_in_period: Prisma.Decimal; total: bigint }>>`
      WITH bal AS (SELECT b.variant_id, SUM(b.on_hand) AS on_hand FROM stock_balances b WHERE b.tenant_id = ${tenant}::uuid ${whSql} GROUP BY b.variant_id HAVING SUM(b.on_hand) > 0),
      sales AS (SELECT m.variant_id, MAX(m.created_at) AS last_sale_at, COALESCE(SUM(CASE WHEN m.created_at >= ${since} THEN -m.quantity ELSE 0 END),0) AS sold_in_period FROM stock_movements m WHERE m.tenant_id = ${tenant}::uuid AND m.type = 'SALE' ${whSqlM} GROUP BY m.variant_id),
      rec AS (SELECT m.variant_id, MAX(m.created_at) AS last_receipt_at FROM stock_movements m WHERE m.tenant_id = ${tenant}::uuid AND m.quantity > 0 ${whSqlM} GROUP BY m.variant_id)
      SELECT v.id AS variant_id, v.sku, v.name, c.name AS category, bal.on_hand, v.cost_price, bal.on_hand * v.cost_price AS value, sales.last_sale_at, rec.last_receipt_at, COALESCE(sales.sold_in_period,0) AS sold_in_period, count(*) OVER()::bigint AS total
      FROM bal JOIN product_variants v ON v.id = bal.variant_id JOIN products p ON p.id = v.product_id LEFT JOIN product_categories c ON c.id = p.category_id LEFT JOIN sales ON sales.variant_id = v.id LEFT JOIN rec ON rec.variant_id = v.id
      WHERE v.deleted_at IS NULL ${catSql} ${searchSql} AND (sales.last_sale_at IS NULL OR sales.last_sale_at < ${since})
      ORDER BY sales.last_sale_at NULLS FIRST, value DESC LIMIT ${q.pageSize} OFFSET ${offset}`;
    const canCost = user.permissions.has('*') || user.permissions.has('inventory.cost.view');
    const now = Date.now();
    const data = rows.map((r) => ({ variantId: r.variant_id, sku: r.sku, name: r.name, category: r.category, onHand: D(r.on_hand), costPrice: canCost ? D(r.cost_price) : undefined, value: canCost ? D(r.value) : undefined, lastSaleAt: r.last_sale_at, lastReceiptAt: r.last_receipt_at, daysSinceSale: r.last_sale_at ? Math.floor((now - r.last_sale_at.getTime()) / 86400_000) : null, soldInPeriod: D(r.sold_in_period) }));
    const totalValue = canCost ? data.reduce((s, r) => s.plus(r.value ?? ZERO), ZERO) : undefined;
    return { days, since, ...paginated(data, Number(rows[0]?.total ?? 0), q), pageValue: totalValue };
  }

  // ---------------------------------------------------------------- hàng bán chạy / bán chậm theo doanh thu
  async topProducts(user: RequestUser, q: TopProductsQueryDto) {
    const branches = this.branchIds(user, q.branchId);
    const from = q.from ? new Date(q.from) : new Date(new Date().setDate(1));
    const to = q.to ? new Date(q.to) : new Date();
    const tenant = user.tenantId;
    const brSql = branches ? Prisma.sql`AND i.branch_id IN (${uuidList(branches)})` : Prisma.empty;
    const catSql = q.categoryId ? Prisma.sql`AND p.category_id = ${q.categoryId}::uuid` : Prisma.empty;
    const searchSql = q.search ? Prisma.sql`AND (v.sku ILIKE ${'%' + q.search + '%'} OR v.name ILIKE ${'%' + q.search + '%'})` : Prisma.empty;
    const orderCol = q.by === 'quantity' ? Prisma.raw('quantity') : q.by === 'profit' ? Prisma.raw('profit') : Prisma.raw('revenue');
    const dir = q.order === 'asc' ? Prisma.raw('ASC') : Prisma.raw('DESC');
    const offset = (q.page - 1) * q.pageSize;
    const rows = await this.prisma.raw.$queryRaw<Array<{ variant_id: string; sku: string; name: string; category: string | null; quantity: Prisma.Decimal; revenue: Prisma.Decimal; cost: Prisma.Decimal; profit: Prisma.Decimal; invoices: bigint; returned_qty: Prisma.Decimal; total: bigint }>>`
      SELECT v.id AS variant_id, v.sku, v.name, c.name AS category,
        COALESCE(SUM(l.quantity),0) AS quantity,
        COALESCE(SUM(l.line_total * (1 - (i.discount_amount + i.promotion_discount) / NULLIF(i.subtotal, 0))),0) AS revenue,
        COALESCE(SUM(l.cost_total),0) AS cost,
        COALESCE(SUM(l.line_total * (1 - (i.discount_amount + i.promotion_discount) / NULLIF(i.subtotal, 0))) - SUM(l.cost_total),0) AS profit,
        count(DISTINCT i.id)::bigint AS invoices, COALESCE(SUM(l.returned_quantity),0) AS returned_qty, count(*) OVER()::bigint AS total
      FROM invoice_lines l JOIN invoices i ON i.id = l.invoice_id JOIN product_variants v ON v.id = l.variant_id JOIN products p ON p.id = v.product_id LEFT JOIN product_categories c ON c.id = p.category_id
      WHERE i.tenant_id = ${tenant}::uuid AND i.status = 'COMPLETED' AND i.invoice_date BETWEEN ${from} AND ${to} ${brSql} ${catSql} ${searchSql}
      GROUP BY v.id, v.sku, v.name, c.name ORDER BY ${orderCol} ${dir}, v.name LIMIT ${q.pageSize} OFFSET ${offset}`;
    const canCost = user.permissions.has('*') || user.permissions.has('sales.report.view');
    const data = rows.map((r) => ({ variantId: r.variant_id, sku: r.sku, name: r.name, category: r.category, quantity: D(r.quantity), returnedQuantity: D(r.returned_qty), revenue: D(r.revenue), cost: canCost ? D(r.cost) : undefined, profit: canCost ? D(r.profit) : undefined, invoices: Number(r.invoices) }));
    return { from, to, ...paginated(data, Number(rows[0]?.total ?? 0), q) };
  }

  // ---------------------------------------------------------------- lãi lỗ (P&L)
  async profit(user: RequestUser, q: ProfitQueryDto) {
    const branches = this.branchIds(user, q.branchId);
    const from = q.from ? new Date(q.from) : new Date(new Date().getFullYear(), 0, 1);
    const to = q.to ? new Date(q.to) : new Date();
    const bucket = q.groupBy === 'day' ? 'day' : 'month';
    const tenant = user.tenantId;
    const brI = branches ? Prisma.sql`AND i.branch_id IN (${uuidList(branches)})` : Prisma.empty;
    const brR = branches ? Prisma.sql`AND r.branch_id IN (${uuidList(branches)})` : Prisma.empty;
    const brP = branches ? Prisma.sql`AND p.branch_id IN (${uuidList(branches)})` : Prisma.empty;
    const brT = branches ? Prisma.sql`AND t.branch_id IN (${uuidList(branches)})` : Prisma.empty;
    const brD = branches ? Prisma.sql`AND d.branch_id IN (${uuidList(branches)})` : Prisma.empty;
    const brS = branches ? Prisma.sql`AND s.branch_id IN (${uuidList(branches)})` : Prisma.empty;
    const [sales, returns, other, shortages, shipping, stocktakes] = await Promise.all([
      this.prisma.raw.$queryRaw<Array<{ period: Date; revenue: Prisma.Decimal; cost: Prisma.Decimal; discount: Prisma.Decimal; invoices: bigint }>>`SELECT date_trunc(${bucket}, i.invoice_date) AS period, COALESCE(SUM(i.total_amount),0) AS revenue, COALESCE(SUM(i.cost_total),0) AS cost, COALESCE(SUM(i.discount_amount + i.promotion_discount),0) AS discount, count(*)::bigint AS invoices FROM invoices i WHERE i.tenant_id = ${tenant}::uuid AND i.status = 'COMPLETED' AND i.invoice_date BETWEEN ${from} AND ${to} ${brI} GROUP BY 1`,
      this.prisma.raw.$queryRaw<Array<{ period: Date; refund: Prisma.Decimal; restock: Prisma.Decimal; damaged: Prisma.Decimal }>>`SELECT date_trunc(${bucket}, r.return_date) AS period, COALESCE(SUM(r.total_refund),0) AS refund, COALESCE(SUM(r.restock_value),0) AS restock, COALESCE(SUM(r.damaged_value),0) AS damaged FROM sales_returns r WHERE r.tenant_id = ${tenant}::uuid AND r.status = 'COMPLETED' AND r.return_date BETWEEN ${from} AND ${to} ${brR} GROUP BY 1`,
      this.prisma.raw.$queryRaw<Array<{ period: Date; direction: string; category: string; amount: Prisma.Decimal }>>`SELECT date_trunc(${bucket}, p.payment_date) AS period, p.direction::text AS direction, c.name AS category, COALESCE(SUM(p.amount),0) AS amount FROM payments p JOIN payment_categories c ON c.id = p.category_id WHERE p.tenant_id = ${tenant}::uuid AND p.status = 'POSTED' AND p.payment_date BETWEEN ${from} AND ${to} ${brP} GROUP BY 1, 2, 3`,
      this.prisma.raw.$queryRaw<Array<{ period: Date; amount: Prisma.Decimal }>>`SELECT date_trunc(${bucket}, t.received_at) AS period, COALESCE(SUM(t.shortage_value),0) AS amount FROM stock_transfers t WHERE t.tenant_id = ${tenant}::uuid AND t.status = 'RECEIVED' AND t.received_at BETWEEN ${from} AND ${to} ${brT} GROUP BY 1`,
      this.prisma.raw.$queryRaw<Array<{ period: Date; fee: Prisma.Decimal; cost: Prisma.Decimal }>>`SELECT date_trunc(${bucket}, d.delivered_at) AS period, COALESCE(SUM(d.shipping_fee),0) AS fee, COALESCE(SUM(d.shipping_cost),0) AS cost FROM deliveries d WHERE d.tenant_id = ${tenant}::uuid AND d.status = 'DELIVERED' AND d.delivered_at BETWEEN ${from} AND ${to} ${brD} GROUP BY 1`,
      this.prisma.raw.$queryRaw<Array<{ period: Date; increase: Prisma.Decimal; decrease: Prisma.Decimal }>>`SELECT date_trunc(${bucket}, s.completed_at) AS period, COALESCE(SUM(s.increase_value),0) AS increase, COALESCE(SUM(s.decrease_value),0) AS decrease FROM stocktakes s WHERE s.tenant_id = ${tenant}::uuid AND s.status = 'COMPLETED' AND s.completed_at BETWEEN ${from} AND ${to} ${brS} GROUP BY 1`,
    ]);
    const periods = new Map<string, { period: Date; revenue: Prisma.Decimal; refunds: Prisma.Decimal; cost: Prisma.Decimal; restock: Prisma.Decimal; damaged: Prisma.Decimal; otherIncome: Prisma.Decimal; otherExpense: Prisma.Decimal; shortage: Prisma.Decimal; shippingCost: Prisma.Decimal; stocktakeLoss: Prisma.Decimal; invoices: number; discount: Prisma.Decimal }>();
    const bucketOf = (d: Date) => { const k = d.toISOString(); if (!periods.has(k)) periods.set(k, { period: d, revenue: ZERO, refunds: ZERO, cost: ZERO, restock: ZERO, damaged: ZERO, otherIncome: ZERO, otherExpense: ZERO, shortage: ZERO, shippingCost: ZERO, stocktakeLoss: ZERO, invoices: 0, discount: ZERO }); return periods.get(k)!; };
    for (const r of sales) { const b = bucketOf(r.period); b.revenue = b.revenue.plus(D(r.revenue)); b.cost = b.cost.plus(D(r.cost)); b.invoices += Number(r.invoices); b.discount = b.discount.plus(D(r.discount)); }
    for (const r of returns) { const b = bucketOf(r.period); b.refunds = b.refunds.plus(D(r.refund)); b.restock = b.restock.plus(D(r.restock)); b.damaged = b.damaged.plus(D(r.damaged)); }
    const expenseByCategory = new Map<string, Prisma.Decimal>(); const incomeByCategory = new Map<string, Prisma.Decimal>();
    for (const r of other) {
      const b = bucketOf(r.period);
      if (r.direction === 'IN') { b.otherIncome = b.otherIncome.plus(D(r.amount)); incomeByCategory.set(r.category, (incomeByCategory.get(r.category) ?? ZERO).plus(D(r.amount))); }
      else { b.otherExpense = b.otherExpense.plus(D(r.amount)); expenseByCategory.set(r.category, (expenseByCategory.get(r.category) ?? ZERO).plus(D(r.amount))); }
    }
    for (const r of shortages) bucketOf(r.period).shortage = bucketOf(r.period).shortage.plus(D(r.amount));
    for (const r of shipping) bucketOf(r.period).shippingCost = bucketOf(r.period).shippingCost.plus(D(r.cost));
    for (const r of stocktakes) bucketOf(r.period).stocktakeLoss = bucketOf(r.period).stocktakeLoss.plus(D(r.decrease)).minus(D(r.increase));
    const rows = Array.from(periods.values()).sort((a, b) => a.period.getTime() - b.period.getTime()).map((b) => {
      const netRevenue = b.revenue.minus(b.refunds);
      const cogs = b.cost.minus(b.restock); // goods that came back are not sold
      const grossProfit = netRevenue.minus(cogs);
      const losses = b.damaged.plus(b.shortage).plus(b.stocktakeLoss);
      const netProfit = grossProfit.plus(b.otherIncome).minus(b.otherExpense).minus(losses).minus(b.shippingCost);
      return { ...b, netRevenue, cogs, grossProfit, losses, netProfit };
    });
    const sum = (k: keyof (typeof rows)[number]) => rows.reduce((s, r) => s.plus(r[k] as Prisma.Decimal), ZERO);
    const totals = { invoices: rows.reduce((s, r) => s + r.invoices, 0), revenue: sum('revenue'), refunds: sum('refunds'), netRevenue: sum('netRevenue'), discount: sum('discount'), cogs: sum('cogs'), grossProfit: sum('grossProfit'), otherIncome: sum('otherIncome'), otherExpense: sum('otherExpense'), damaged: sum('damaged'), shortage: sum('shortage'), stocktakeLoss: sum('stocktakeLoss'), shippingCost: sum('shippingCost'), losses: sum('losses'), netProfit: sum('netProfit') };
    return { from, to, groupBy: bucket, totals, byPeriod: rows, expenseByCategory: Array.from(expenseByCategory, ([name, amount]) => ({ name, amount })).sort((a, b) => b.amount.comparedTo(a.amount)), incomeByCategory: Array.from(incomeByCategory, ([name, amount]) => ({ name, amount })).sort((a, b) => b.amount.comparedTo(a.amount)) };
  }

  // ---------------------------------------------------------------- giá trị tồn kho
  async valuation(user: RequestUser, q: ValuationQueryDto) {
    const whs = await this.warehouseIds(user, q.warehouseId, q.branchId);
    const tenant = user.tenantId;
    const whSql = whs ? Prisma.sql`AND b.warehouse_id IN (${uuidList(whs)})` : Prisma.empty;
    const groupBy = q.groupBy ?? 'category';
    const grouped = groupBy === 'warehouse'
      ? await this.prisma.raw.$queryRaw<Array<{ key: string; name: string; skus: bigint; quantity: Prisma.Decimal; value: Prisma.Decimal; retail: Prisma.Decimal }>>`SELECT w.id::text AS key, w.name, count(DISTINCT v.id)::bigint AS skus, COALESCE(SUM(b.on_hand),0) AS quantity, COALESCE(SUM(b.on_hand * v.cost_price),0) AS value, COALESCE(SUM(b.on_hand * v.sell_price),0) AS retail FROM stock_balances b JOIN product_variants v ON v.id = b.variant_id JOIN warehouses w ON w.id = b.warehouse_id WHERE b.tenant_id = ${tenant}::uuid AND v.deleted_at IS NULL AND b.on_hand <> 0 ${whSql} GROUP BY w.id, w.name ORDER BY value DESC`
      : groupBy === 'brand'
        ? await this.prisma.raw.$queryRaw<Array<{ key: string; name: string; skus: bigint; quantity: Prisma.Decimal; value: Prisma.Decimal; retail: Prisma.Decimal }>>`SELECT COALESCE(br.id::text, '') AS key, COALESCE(br.name, 'Không có thương hiệu') AS name, count(DISTINCT v.id)::bigint AS skus, COALESCE(SUM(b.on_hand),0) AS quantity, COALESCE(SUM(b.on_hand * v.cost_price),0) AS value, COALESCE(SUM(b.on_hand * v.sell_price),0) AS retail FROM stock_balances b JOIN product_variants v ON v.id = b.variant_id JOIN products p ON p.id = v.product_id LEFT JOIN brands br ON br.id = p.brand_id WHERE b.tenant_id = ${tenant}::uuid AND v.deleted_at IS NULL AND b.on_hand <> 0 ${whSql} GROUP BY br.id, br.name ORDER BY value DESC`
        : await this.prisma.raw.$queryRaw<Array<{ key: string; name: string; skus: bigint; quantity: Prisma.Decimal; value: Prisma.Decimal; retail: Prisma.Decimal }>>`SELECT COALESCE(c.id::text, '') AS key, COALESCE(c.name, 'Chưa phân nhóm') AS name, count(DISTINCT v.id)::bigint AS skus, COALESCE(SUM(b.on_hand),0) AS quantity, COALESCE(SUM(b.on_hand * v.cost_price),0) AS value, COALESCE(SUM(b.on_hand * v.sell_price),0) AS retail FROM stock_balances b JOIN product_variants v ON v.id = b.variant_id JOIN products p ON p.id = v.product_id LEFT JOIN product_categories c ON c.id = p.category_id WHERE b.tenant_id = ${tenant}::uuid AND v.deleted_at IS NULL AND b.on_hand <> 0 ${whSql} GROUP BY c.id, c.name ORDER BY value DESC`;
    const data = grouped.map((r) => ({ key: r.key, name: r.name, skus: Number(r.skus), quantity: D(r.quantity), value: D(r.value), retail: D(r.retail), potentialMargin: D(r.retail).minus(D(r.value)) }));
    const distinct = await this.prisma.raw.$queryRaw<{ n: bigint }[]>`SELECT count(DISTINCT b.variant_id)::bigint AS n FROM stock_balances b JOIN product_variants v ON v.id = b.variant_id WHERE b.tenant_id = ${tenant}::uuid AND v.deleted_at IS NULL AND b.on_hand <> 0 ${whSql}`;
    return { groupBy, rows: data, totals: { skus: Number(distinct[0]?.n ?? 0), quantity: data.reduce((s, r) => s.plus(r.quantity), ZERO), value: data.reduce((s, r) => s.plus(r.value), ZERO), retail: data.reduce((s, r) => s.plus(r.retail), ZERO) } };
  }

  // ---------------------------------------------------------------- khách hàng (giá trị khách hàng, BR-144)
  async customers(user: RequestUser, q: CustomersReportQueryDto) {
    const branches = this.branchIds(user, q.branchId);
    const from = q.from ? new Date(q.from) : new Date(new Date().getFullYear(), 0, 1);
    const to = q.to ? new Date(q.to) : new Date();
    const tenant = user.tenantId;
    const brSql = branches ? Prisma.sql`AND i.branch_id IN (${uuidList(branches)})` : Prisma.empty;
    const grpSql = q.groupName ? Prisma.sql`AND c.group_name = ${q.groupName}` : Prisma.empty;
    const searchSql = q.search ? Prisma.sql`AND (c.name ILIKE ${'%' + q.search + '%'} OR c.code ILIKE ${'%' + q.search + '%'} OR c.phone ILIKE ${'%' + q.search + '%'})` : Prisma.empty;
    const orderCol = q.by === 'invoices' ? Prisma.raw('invoices DESC') : q.by === 'lastPurchase' ? Prisma.raw('last_purchase_at DESC NULLS LAST') : q.by === 'points' ? Prisma.raw('points DESC') : q.by === 'debt' ? Prisma.raw('debt DESC') : Prisma.raw('revenue DESC');
    const offset = (q.page - 1) * q.pageSize;
    const rows = await this.prisma.raw.$queryRaw<Array<{ customer_id: string; code: string; name: string; phone: string | null; group_name: string | null; points: Prisma.Decimal; debt: Prisma.Decimal; invoices: bigint; revenue: Prisma.Decimal; returned: Prisma.Decimal; last_purchase_at: Date | null; first_purchase_at: Date | null; total: bigint }>>`
      WITH sales AS (
        SELECT i.customer_id, count(*)::bigint AS invoices, COALESCE(SUM(i.total_amount),0) AS revenue, COALESCE(SUM(i.returned_amount),0) AS returned, MAX(i.invoice_date) AS last_purchase_at, MIN(i.invoice_date) AS first_purchase_at
        FROM invoices i WHERE i.tenant_id = ${tenant}::uuid AND i.status = 'COMPLETED' AND i.customer_id IS NOT NULL AND i.invoice_date BETWEEN ${from} AND ${to} ${brSql} GROUP BY i.customer_id)
      SELECT c.id AS customer_id, c.code, c.name, c.phone, c.group_name, c.points, COALESCE(pb.balance,0) AS debt, s.invoices, s.revenue, s.returned, s.last_purchase_at, s.first_purchase_at, count(*) OVER()::bigint AS total
      FROM sales s JOIN customers c ON c.id = s.customer_id LEFT JOIN party_balances pb ON pb.tenant_id = c.tenant_id AND pb.party_type = 'CUSTOMER' AND pb.party_id = c.id
      WHERE c.tenant_id = ${tenant}::uuid ${grpSql} ${searchSql}
      ORDER BY ${orderCol}, c.name LIMIT ${q.pageSize} OFFSET ${offset}`;
    const totalsRow = await this.prisma.raw.$queryRaw<Array<{ customers: bigint; revenue: Prisma.Decimal; invoices: bigint }>>`SELECT count(DISTINCT i.customer_id)::bigint AS customers, COALESCE(SUM(i.total_amount),0) AS revenue, count(*)::bigint AS invoices FROM invoices i WHERE i.tenant_id = ${tenant}::uuid AND i.status = 'COMPLETED' AND i.customer_id IS NOT NULL AND i.invoice_date BETWEEN ${from} AND ${to} ${brSql}`;
    const newCustomers = await this.prisma.db.customer.count({ where: { createdAt: { gte: from, lte: to } } });
    const walkin = await this.prisma.raw.$queryRaw<Array<{ invoices: bigint; revenue: Prisma.Decimal }>>`SELECT count(*)::bigint AS invoices, COALESCE(SUM(i.total_amount),0) AS revenue FROM invoices i WHERE i.tenant_id = ${tenant}::uuid AND i.status = 'COMPLETED' AND i.customer_id IS NULL AND i.invoice_date BETWEEN ${from} AND ${to} ${brSql}`;
    const data = rows.map((r) => ({ customerId: r.customer_id, code: r.code, name: r.name, phone: r.phone, groupName: r.group_name, points: D(r.points), debt: D(r.debt), invoices: Number(r.invoices), revenue: D(r.revenue), returned: D(r.returned), netRevenue: D(r.revenue).minus(D(r.returned)), avgBasket: Number(r.invoices) ? D(r.revenue).dividedBy(Number(r.invoices)).toDecimalPlaces(0) : ZERO, lastPurchaseAt: r.last_purchase_at, firstPurchaseAt: r.first_purchase_at, isNew: !!r.first_purchase_at && r.first_purchase_at >= from }));
    const t0 = totalsRow[0];
    return { from, to, ...paginated(data, Number(rows[0]?.total ?? 0), q), totals: { customers: Number(t0?.customers ?? 0), invoices: Number(t0?.invoices ?? 0), revenue: D(t0?.revenue ?? 0), newCustomers, walkinInvoices: Number(walkin[0]?.invoices ?? 0), walkinRevenue: D(walkin[0]?.revenue ?? 0) } };
  }

  // ---------------------------------------------------------------- thuế (Module 12): thuế GTGT đầu ra theo thuế suất, đầu vào từ phiếu nhập
  async tax(user: RequestUser, q: TaxReportQueryDto) {
    const branches = this.branchIds(user, q.branchId);
    const from = q.from ? new Date(q.from) : new Date(new Date().getFullYear(), new Date().getMonth(), 1);
    const to = q.to ? new Date(q.to) : new Date();
    const tenant = user.tenantId;
    const brI = branches ? Prisma.sql`AND i.branch_id IN (${uuidList(branches)})` : Prisma.empty;
    const brR = branches ? Prisma.sql`AND r.branch_id IN (${uuidList(branches)})` : Prisma.empty;
    const [output, input, returns] = await Promise.all([
      this.prisma.raw.$queryRaw<Array<{ tax_rate: Prisma.Decimal; invoices: bigint; taxable: Prisma.Decimal; tax: Prisma.Decimal }>>`SELECT l.tax_rate, count(DISTINCT i.id)::bigint AS invoices, COALESCE(SUM(l.line_total * (1 - (i.discount_amount + i.promotion_discount) / NULLIF(i.subtotal, 0)) - l.tax_amount * CASE WHEN COALESCE((SELECT (value)::text = 'true' FROM tenant_settings ts WHERE ts.tenant_id = i.tenant_id AND ts.key = 'pricing.priceIncludesTax'), true) THEN 1 ELSE 0 END),0) AS taxable, COALESCE(SUM(l.tax_amount),0) AS tax FROM invoice_lines l JOIN invoices i ON i.id = l.invoice_id WHERE i.tenant_id = ${tenant}::uuid AND i.status = 'COMPLETED' AND i.invoice_date BETWEEN ${from} AND ${to} ${brI} GROUP BY l.tax_rate ORDER BY l.tax_rate`,
      this.prisma.raw.$queryRaw<Array<{ tax_rate: Prisma.Decimal; receipts: bigint; taxable: Prisma.Decimal; tax: Prisma.Decimal }>>`SELECT l.tax_rate, count(DISTINCT r.id)::bigint AS receipts, COALESCE(SUM(l.line_total - l.tax_amount),0) AS taxable, COALESCE(SUM(l.tax_amount),0) AS tax FROM purchase_receipt_lines l JOIN purchase_receipts r ON r.id = l.receipt_id WHERE r.tenant_id = ${tenant}::uuid AND r.status = 'POSTED' AND r.receipt_date BETWEEN ${from} AND ${to} ${brR} GROUP BY l.tax_rate ORDER BY l.tax_rate`.catch(() => [] as never[]),
      this.prisma.raw.$queryRaw<Array<{ refund: Prisma.Decimal; count: bigint }>>`SELECT COALESCE(SUM(r.total_refund),0) AS refund, count(*)::bigint AS count FROM sales_returns r WHERE r.tenant_id = ${tenant}::uuid AND r.status = 'COMPLETED' AND r.return_date BETWEEN ${from} AND ${to} ${brR}`,
    ]);
    const out = output.map((r) => ({ taxRate: D(r.tax_rate), invoices: Number(r.invoices), taxable: D(r.taxable), tax: D(r.tax) }));
    const inp = input.map((r) => ({ taxRate: D(r.tax_rate), receipts: Number(r.receipts), taxable: D(r.taxable), tax: D(r.tax) }));
    const outputTax = out.reduce((s, r) => s.plus(r.tax), ZERO); const inputTax = inp.reduce((s, r) => s.plus(r.tax), ZERO);
    return { from, to, output: out, input: inp, returns: { count: Number(returns[0]?.count ?? 0), refund: D(returns[0]?.refund ?? 0) }, totals: { outputTaxable: out.reduce((s, r) => s.plus(r.taxable), ZERO), outputTax, inputTaxable: inp.reduce((s, r) => s.plus(r.taxable), ZERO), inputTax, payable: outputTax.minus(inputTax) }, note: 'Số liệu tham khảo cho kế toán; hoàn trả hàng ghi nhận riêng, cần đối chiếu với hóa đơn điện tử đã phát hành.' };
  }
}
