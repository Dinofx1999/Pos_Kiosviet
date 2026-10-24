import { Controller, Get, Module, Query } from '@nestjs/common';
import { ApiOperation, ApiPropertyOptional } from '@nestjs/swagger';
import { IsOptional, IsUUID } from 'class-validator';
import { DashboardHomeService } from './dashboard-home.service';
import { ApiBearerAuth, ApiTags } from '@nestjs/swagger';
import { CurrentUser, RequirePermission } from '../../common/decorators';
import { RequestUser } from '../../infra/cls/request-context';
import { Prisma } from '@prisma/client';
import { AccessService } from '../../infra/access/access.service';
import { PrismaService } from '../../infra/prisma/prisma.service';
import { InventoryModule } from '../inventory/inventory.module';
import { StockQueryService } from '../inventory/stock-query.service';
import { SalesModule } from '../sales/sales.module';
import { SalesReportsService } from '../sales/sales-reports.service';
import { hasPermission } from '@erp/shared';

export class HomeQueryDto { @ApiPropertyOptional({ description: 'Chỉ xem một chi nhánh (phải thuộc phạm vi của người dùng)' }) @IsOptional() @IsUUID() branchId?: string }

@ApiTags('dashboard') @ApiBearerAuth() @Controller('dashboard')
export class DashboardController {
  constructor(private readonly prisma: PrismaService, private readonly stock: StockQueryService, private readonly access: AccessService, private readonly sales: SalesReportsService, private readonly home: DashboardHomeService) {}

  @Get('home') @RequirePermission('dashboard.view') @ApiOperation({ summary: 'Trang chủ: kết quả bán hàng hôm nay / tuần / tháng, theo giờ & ngày, hàng bán chạy, hoạt động gần đây, việc cần xử lý, tồn kho, ca đang mở' })
  homeScreen(@CurrentUser() u: RequestUser, @Query() q: HomeQueryDto) { return this.home.home(u, q.branchId); }


  @Get('overview') @RequirePermission('dashboard.view')
  async overview(@CurrentUser() u: RequestUser) {
    const since = new Date(Date.now() - 7 * 86400 * 1000);
    const branchScope = this.access.branchWhere(u);
    const branchIds = branchScope.branchId ? (branchScope.branchId.in.length ? branchScope.branchId.in : ['00000000-0000-0000-0000-000000000000']) : null;
    const branchSql = branchIds ? Prisma.sql`AND branch_id IN (${Prisma.join(branchIds.map((id) => Prisma.sql`${id}::uuid`))})` : Prisma.empty;
    const [products, variants, warehouses, summary, recentMovements, recentDocuments, docsByDay, categories] = await Promise.all([
      this.prisma.db.product.count({ where: { deletedAt: null, isActive: true } }),
      this.prisma.db.productVariant.count({ where: { deletedAt: null, isActive: true } }),
      this.prisma.db.warehouse.count({ where: { isActive: true } }),
      this.stock.summary(u),
      this.stock.movements(u, { page: 1, pageSize: 10 } as any),
      this.prisma.db.inventoryDocument.findMany({ where: { AND: [branchScope, { createdAt: { gte: since } }] }, include: { warehouse: { select: { name: true } } }, orderBy: { createdAt: 'desc' }, take: 10 }),
      this.prisma.raw.$queryRaw<Array<{ day: Date; type: string; count: bigint; total_cost: unknown }>>`SELECT date_trunc('day', created_at) AS day, type::text AS type, count(*)::bigint AS count, COALESCE(SUM(total_cost),0) AS total_cost FROM inventory_documents WHERE tenant_id = ${u.tenantId}::uuid AND status = 'POSTED' AND created_at >= ${since} ${branchSql} GROUP BY 1,2 ORDER BY 1`,
      this.prisma.db.product.groupBy({ by: ['categoryId'], where: { deletedAt: null, isActive: true }, _count: { _all: true } }),
    ]);
    const salesToday = hasPermission(u.permissions, 'sales.report.view') ? await this.sales.summary(u, {}) : null;
    const catNames = await this.prisma.db.productCategory.findMany({ where: { id: { in: categories.map((c) => c.categoryId).filter((x): x is string => !!x) } }, select: { id: true, name: true } });
    return {
      products, variants, warehouses, ...summary,
      salesToday: salesToday ? { invoices: salesToday.totals.invoices, revenue: salesToday.totals.revenue, grossProfit: salesToday.totals.grossProfit, byMethod: salesToday.byMethod } : undefined,
      recentMovements: recentMovements.data, recentDocuments,
      documentsByDay: docsByDay.map((d) => ({ day: d.day, type: d.type, count: Number(d.count), totalCost: String(d.total_cost) })),
      productsByCategory: categories.map((c) => ({ categoryId: c.categoryId, name: catNames.find((n) => n.id === c.categoryId)?.name ?? 'Chưa phân nhóm', count: c._count._all })),
    };
  }
}

@Module({ imports: [InventoryModule, SalesModule], controllers: [DashboardController], providers: [DashboardHomeService] })
export class DashboardModule {}
