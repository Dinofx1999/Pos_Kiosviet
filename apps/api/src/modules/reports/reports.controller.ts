import { Controller, Get, Query, Res } from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
import type { Response } from 'express';
import { CurrentUser, RequirePermission } from '../../common/decorators';
import { Errors } from '../../common/errors/app-error';
import { RequestUser } from '../../infra/cls/request-context';
import { CustomersReportQueryDto, NxtQueryDto, ProfitQueryDto, TaxReportQueryDto, ReportExportQueryDto, SlowMoversQueryDto, TopProductsQueryDto, ValuationQueryDto } from './dto/reports.dto';
import { ReportsExcelService } from './reports-excel.service';
import { ReportsService } from './reports.service';

const XLSX = 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet';
const EXPORT_PERMS: Record<string, string> = { nxt: 'inventory.view', 'slow-movers': 'inventory.view', 'top-products': 'sales.report.view', profit: 'report.profit.view', valuation: 'inventory.cost.view', sales: 'sales.report.view', cashbook: 'cash.view', 'customer-debt': 'customer.debt.view', 'supplier-debt': 'supplier.debt.view' };

@ApiTags('reports') @ApiBearerAuth() @Controller('reports')
export class ReportsController {
  constructor(private readonly svc: ReportsService, private readonly excel: ReportsExcelService) {}
  @Get('inventory/nxt') @RequirePermission('inventory.view') @ApiOperation({ summary: 'Nhập – xuất – tồn theo kỳ (giá trị chỉ khi có inventory.cost.view)' }) nxt(@CurrentUser() u: RequestUser, @Query() q: NxtQueryDto) { return this.svc.nxt(u, q); }
  @Get('inventory/slow-movers') @RequirePermission('inventory.view') @ApiOperation({ summary: 'Hàng tồn lâu / không bán được trong N ngày' }) slow(@CurrentUser() u: RequestUser, @Query() q: SlowMoversQueryDto) { return this.svc.slowMovers(u, q); }
  @Get('inventory/valuation') @RequirePermission('inventory.cost.view') @ApiOperation({ summary: 'Giá trị tồn kho theo nhóm hàng / kho / thương hiệu' }) valuation(@CurrentUser() u: RequestUser, @Query() q: ValuationQueryDto) { return this.svc.valuation(u, q); }
  @Get('sales/products') @RequirePermission('sales.report.view') @ApiOperation({ summary: 'Hàng bán chạy / bán chậm theo doanh thu, số lượng, lợi nhuận' }) top(@CurrentUser() u: RequestUser, @Query() q: TopProductsQueryDto) { return this.svc.topProducts(u, q); }
  @Get('customers') @RequirePermission('sales.report.view') @ApiOperation({ summary: 'Giá trị khách hàng: doanh thu, số hóa đơn, lần mua cuối, điểm, công nợ; khách mới trong kỳ' }) customers(@CurrentUser() u: RequestUser, @Query() q: CustomersReportQueryDto) { return this.svc.customers(u, q); }
  @Get('tax') @RequirePermission('report.profit.view') @ApiOperation({ summary: 'Thuế GTGT đầu ra theo thuế suất, đầu vào từ phiếu nhập, số phải nộp tham khảo (Module 12)' }) tax(@CurrentUser() u: RequestUser, @Query() q: TaxReportQueryDto) { return this.svc.tax(u, q); }
  @Get('profit') @RequirePermission('report.profit.view') @ApiOperation({ summary: 'Lãi lỗ: doanh thu thuần − giá vốn − chi phí khác − thất thoát + thu khác' }) profit(@CurrentUser() u: RequestUser, @Query() q: ProfitQueryDto) { return this.svc.profit(u, q); }
  @Get('export') @ApiOperation({ summary: 'Xuất Excel một báo cáo (quyền theo loại báo cáo)' })
  async export(@CurrentUser() u: RequestUser, @Query() q: ReportExportQueryDto, @Res() res: Response) {
    const perm = EXPORT_PERMS[q.type];
    if (!u.permissions.has('*') && !u.permissions.has(perm)) throw Errors.forbidden(`Thiếu quyền: ${perm}`);
    const { buffer, filename } = await this.excel.export(u, q);
    res.setHeader('Content-Type', XLSX); res.setHeader('Content-Disposition', `attachment; filename="${filename}"`); res.send(buffer);
  }
}
