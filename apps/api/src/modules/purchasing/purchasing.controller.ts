import { Body, Controller, Delete, Get, HttpCode, Param, ParseUUIDPipe, Patch, Post, Query } from '@nestjs/common';
import { ApiBearerAuth, ApiHeader, ApiOperation, ApiTags } from '@nestjs/swagger';
import { CurrentUser, Idempotent, RequirePermission } from '../../common/decorators';
import { RequestUser } from '../../infra/cls/request-context';
import { LedgerQueryDto } from '../finance/dto/finance.dto';
import { CancelDto, CreateOrderDto, CreateReceiptDto, CreateReturnDto, CreateSupplierDto, OrderQueryDto, PostReceiptDto, PostReturnDto, PurchaseReportQueryDto, ReceiptQueryDto, ReturnQueryDto, SupplierQueryDto, UpdateOrderDto, UpdateReceiptDto, UpdateReturnDto, UpdateSupplierDto } from './dto/purchasing.dto';
import { PurchaseOrdersService } from './purchase-orders.service';
import { PurchaseReceiptsService } from './purchase-receipts.service';
import { PurchaseReturnsService } from './purchase-returns.service';
import { PurchasingReportsService } from './purchasing-reports.service';
import { SuppliersService } from './suppliers.service';

@ApiTags('suppliers') @ApiBearerAuth() @Controller('suppliers')
export class SuppliersController {
  constructor(private readonly svc: SuppliersService) {}
  @Get() @RequirePermission('supplier.view') list(@CurrentUser() u: RequestUser, @Query() q: SupplierQueryDto) { return this.svc.list(u, q); }
  @Get('groups') @RequirePermission('supplier.view') groups() { return this.svc.groups(); }
  @Get(':id') @RequirePermission('supplier.view') get(@CurrentUser() u: RequestUser, @Param('id', ParseUUIDPipe) id: string) { return this.svc.get(u, id); }
  @Get(':id/history') @RequirePermission('supplier.view') history(@CurrentUser() u: RequestUser, @Param('id', ParseUUIDPipe) id: string) { return this.svc.history(u, id); }
  @Get(':id/ledger') @RequirePermission('supplier.debt.view') ledger(@CurrentUser() u: RequestUser, @Param('id', ParseUUIDPipe) id: string, @Query() q: LedgerQueryDto) { return this.svc.ledgerEntries(u, id, q); }
  @Post() @RequirePermission('supplier.manage') create(@CurrentUser() u: RequestUser, @Body() dto: CreateSupplierDto) { return this.svc.create(u, dto); }
  @Patch(':id') @RequirePermission('supplier.manage') update(@CurrentUser() u: RequestUser, @Param('id', ParseUUIDPipe) id: string, @Body() dto: UpdateSupplierDto) { return this.svc.update(u, id, dto); }
}

@ApiTags('purchase-orders') @ApiBearerAuth() @Controller('purchase-orders')
export class PurchaseOrdersController {
  constructor(private readonly svc: PurchaseOrdersService) {}
  @Get() @RequirePermission('purchase.order.view') list(@CurrentUser() u: RequestUser, @Query() q: OrderQueryDto) { return this.svc.list(u, q); }
  @Get(':id') @RequirePermission('purchase.order.view') get(@CurrentUser() u: RequestUser, @Param('id', ParseUUIDPipe) id: string) { return this.svc.get(u, id); }
  @Post() @RequirePermission('purchase.order.create') @Idempotent() @ApiHeader({ name: 'Idempotency-Key', required: false }) create(@CurrentUser() u: RequestUser, @Body() dto: CreateOrderDto) { return this.svc.create(u, dto); }
  @Patch(':id') @RequirePermission('purchase.order.create') update(@CurrentUser() u: RequestUser, @Param('id', ParseUUIDPipe) id: string, @Body() dto: UpdateOrderDto) { return this.svc.update(u, id, dto); }
  @Delete(':id') @RequirePermission('purchase.order.create') @HttpCode(204) async remove(@CurrentUser() u: RequestUser, @Param('id', ParseUUIDPipe) id: string) { await this.svc.remove(u, id); }
  @Post(':id/confirm') @RequirePermission('purchase.order.confirm') @HttpCode(200) confirm(@CurrentUser() u: RequestUser, @Param('id', ParseUUIDPipe) id: string) { return this.svc.confirm(u, id); }
  @Post(':id/cancel') @RequirePermission('purchase.order.cancel') @HttpCode(200) cancel(@CurrentUser() u: RequestUser, @Param('id', ParseUUIDPipe) id: string, @Body() dto: CancelDto) { return this.svc.cancel(u, id, dto.reason); }
}

@ApiTags('purchase-receipts') @ApiBearerAuth() @Controller('purchase-receipts')
export class PurchaseReceiptsController {
  constructor(private readonly svc: PurchaseReceiptsService) {}
  @Get() @RequirePermission('purchase.receipt.view') list(@CurrentUser() u: RequestUser, @Query() q: ReceiptQueryDto) { return this.svc.list(u, q); }
  @Get(':id') @RequirePermission('purchase.receipt.view') get(@CurrentUser() u: RequestUser, @Param('id', ParseUUIDPipe) id: string) { return this.svc.get(u, id); }
  @Post() @RequirePermission('purchase.receipt.create') @Idempotent() @ApiHeader({ name: 'Idempotency-Key', required: false }) create(@CurrentUser() u: RequestUser, @Body() dto: CreateReceiptDto) { return this.svc.create(u, dto); }
  @Post('post-now') @RequirePermission('purchase.receipt.create', 'purchase.receipt.post') @Idempotent() @ApiHeader({ name: 'Idempotency-Key', required: false })
  @ApiOperation({ summary: 'Tạo và hoàn thành phiếu nhập hàng trong một transaction (kèm thanh toán ngay nếu có)' })
  createAndPost(@CurrentUser() u: RequestUser, @Body() dto: CreateReceiptDto) { return this.svc.createAndPost(u, dto); }
  @Patch(':id') @RequirePermission('purchase.receipt.create') update(@CurrentUser() u: RequestUser, @Param('id', ParseUUIDPipe) id: string, @Body() dto: UpdateReceiptDto) { return this.svc.update(u, id, dto); }
  @Delete(':id') @RequirePermission('purchase.receipt.create') @HttpCode(204) async remove(@CurrentUser() u: RequestUser, @Param('id', ParseUUIDPipe) id: string) { await this.svc.remove(u, id); }
  @Post(':id/post') @RequirePermission('purchase.receipt.post') @Idempotent() @HttpCode(200) @ApiHeader({ name: 'Idempotency-Key', required: false })
  post(@CurrentUser() u: RequestUser, @Param('id', ParseUUIDPipe) id: string, @Body() dto: PostReceiptDto) { return this.svc.post(u, id, dto?.payment); }
  @Post(':id/cancel') @RequirePermission('purchase.receipt.cancel') @Idempotent() @HttpCode(200) cancel(@CurrentUser() u: RequestUser, @Param('id', ParseUUIDPipe) id: string, @Body() dto: CancelDto) { return this.svc.cancel(u, id, dto.reason); }
}

@ApiTags('purchase-returns') @ApiBearerAuth() @Controller('purchase-returns')
export class PurchaseReturnsController {
  constructor(private readonly svc: PurchaseReturnsService) {}
  @Get() @RequirePermission('purchase.return.view') list(@CurrentUser() u: RequestUser, @Query() q: ReturnQueryDto) { return this.svc.list(u, q); }
  @Get(':id') @RequirePermission('purchase.return.view') get(@CurrentUser() u: RequestUser, @Param('id', ParseUUIDPipe) id: string) { return this.svc.get(u, id); }
  @Post() @RequirePermission('purchase.return.create') @Idempotent() create(@CurrentUser() u: RequestUser, @Body() dto: CreateReturnDto) { return this.svc.create(u, dto); }
  @Post('post-now') @RequirePermission('purchase.return.create', 'purchase.return.post') @Idempotent() @ApiHeader({ name: 'Idempotency-Key', required: false })
  createAndPost(@CurrentUser() u: RequestUser, @Body() dto: CreateReturnDto) { return this.svc.createAndPost(u, dto); }
  @Patch(':id') @RequirePermission('purchase.return.create') update(@CurrentUser() u: RequestUser, @Param('id', ParseUUIDPipe) id: string, @Body() dto: UpdateReturnDto) { return this.svc.update(u, id, dto); }
  @Delete(':id') @RequirePermission('purchase.return.create') @HttpCode(204) async remove(@CurrentUser() u: RequestUser, @Param('id', ParseUUIDPipe) id: string) { await this.svc.remove(u, id); }
  @Post(':id/post') @RequirePermission('purchase.return.post') @Idempotent() @HttpCode(200) post(@CurrentUser() u: RequestUser, @Param('id', ParseUUIDPipe) id: string, @Body() dto: PostReturnDto) { return this.svc.post(u, id, dto?.refund); }
  @Post(':id/cancel') @RequirePermission('purchase.return.cancel') @Idempotent() @HttpCode(200) cancel(@CurrentUser() u: RequestUser, @Param('id', ParseUUIDPipe) id: string, @Body() dto: CancelDto) { return this.svc.cancel(u, id, dto.reason); }
}

@ApiTags('purchasing-reports') @ApiBearerAuth() @Controller('purchasing/reports')
export class PurchasingReportsController {
  constructor(private readonly svc: PurchasingReportsService) {}
  @Get('summary') @RequirePermission('purchase.report.view') summary(@CurrentUser() u: RequestUser, @Query() q: PurchaseReportQueryDto) { return this.svc.summary(u, q); }
  @Get('debt') @RequirePermission('supplier.debt.view') debt(@CurrentUser() u: RequestUser) { return this.svc.debt(u); }
}
