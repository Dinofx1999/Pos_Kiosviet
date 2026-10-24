import { Body, Controller, Delete, Get, HttpCode, Param, ParseUUIDPipe, Patch, Post, Query } from '@nestjs/common';
import { ApiBearerAuth, ApiHeader, ApiOperation, ApiTags } from '@nestjs/swagger';
import { CurrentUser, Idempotent, RequirePermission } from '../../common/decorators';
import { RequestUser } from '../../infra/cls/request-context';
import { PaginationQueryDto } from '../../common/pagination';
import { LedgerQueryDto } from '../finance/dto/finance.dto';
import { CustomersService } from './customers.service';
import { LoyaltyService } from './loyalty.service';
import { D } from '../../common/utils/decimal';
import { AdjustPointsDto, BirthdayQueryDto } from './dto/loyalty.dto';
import { CancelInvoiceDto, CloseShiftDto, CompleteInvoiceDto, CreateCustomerDto, CreateInvoiceDto, CustomerQueryDto, InvoiceQueryDto, OpenShiftDto, PosPriceQueryDto, SalesReportQueryDto, ShiftQueryDto, UpdateCustomerDto, UpdateInvoiceDto } from './dto/sales.dto';
import { InvoicesService } from './invoices.service';
import { SalesReportsService } from './sales-reports.service';
import { ShiftsService } from './shifts.service';
import { SalesReturnsService } from './sales-returns.service';
import { CancelSalesReturnDto, CompleteSalesReturnDto, CreateSalesReturnDto, ExchangeDto, SalesReturnQueryDto, UpdateSalesReturnDto } from './dto/returns.dto';
import { PromotionsService } from './promotions.service';
import { OrdersService } from './orders.service';
import { DeliveriesService } from './deliveries.service';
import { CancelOrderDto, CodCollectionDto, CompleteOrderDto, ConfirmOrderDto, CreateDeliveryDto, CreateSalesOrderDto, DeliveryQueryDto, DeliveryStatusDto, DepositDto, SalesOrderQueryDto, UpdateDeliveryDto, UpdateSalesOrderDto } from './dto/orders.dto';
import { CreatePromotionDto, CreateVouchersDto, PromotionQueryDto, PromotionReportQueryDto, UpdatePromotionDto, UpdateVoucherDto, VoucherLookupQueryDto, VoucherQueryDto } from './dto/promotions.dto';

@ApiTags('customers') @ApiBearerAuth() @Controller('customers')
export class CustomersController {
  constructor(private readonly svc: CustomersService, private readonly loyalty: LoyaltyService) {}
  @Get() @RequirePermission('customer.view') list(@CurrentUser() u: RequestUser, @Query() q: CustomerQueryDto) { return this.svc.list(u, q); }
  @Get('search') @RequirePermission('customer.view') search(@CurrentUser() u: RequestUser, @Query('q') q = '') { return this.svc.quickSearch(u, q); }
  @Get('groups') @RequirePermission('customer.view') groups() { return this.svc.groups(); }
  @Get('debt') @RequirePermission('customer.debt.view') debt(@CurrentUser() u: RequestUser) { return this.svc.debt(u); }
  @Get('birthdays') @RequirePermission('customer.view') @ApiOperation({ summary: 'Khách hàng có sinh nhật trong tháng (mặc định tháng này)' }) birthdays(@CurrentUser() u: RequestUser, @Query() q: BirthdayQueryDto) { return this.svc.birthdays(u, q.month, q.day); }
  @Get(':id') @RequirePermission('customer.view') get(@CurrentUser() u: RequestUser, @Param('id', ParseUUIDPipe) id: string) { return this.svc.get(u, id); }
  @Get(':id/history') @RequirePermission('customer.view') history(@CurrentUser() u: RequestUser, @Param('id', ParseUUIDPipe) id: string) { return this.svc.history(u, id); }
  @Get(':id/ledger') @RequirePermission('customer.debt.view') ledger(@CurrentUser() u: RequestUser, @Param('id', ParseUUIDPipe) id: string, @Query() q: LedgerQueryDto) { return this.svc.ledgerEntries(u, id, q); }
  @Post() @RequirePermission('customer.manage') create(@CurrentUser() u: RequestUser, @Body() dto: CreateCustomerDto) { return this.svc.create(u, dto); }
  @Patch(':id') @RequirePermission('customer.manage') update(@CurrentUser() u: RequestUser, @Param('id', ParseUUIDPipe) id: string, @Body() dto: UpdateCustomerDto) { return this.svc.update(u, id, dto); }
  @Get(':id/points') @RequirePermission('customer.view') points(@CurrentUser() u: RequestUser, @Param('id', ParseUUIDPipe) id: string, @Query() q: PaginationQueryDto) { return this.loyalty.ledger(u, id, q); }
  @Post(':id/points/adjust') @RequirePermission('loyalty.manage') @HttpCode(201) adjustPoints(@CurrentUser() u: RequestUser, @Param('id', ParseUUIDPipe) id: string, @Body() dto: AdjustPointsDto) { return this.loyalty.adjust(u, id, D(dto.points), dto.note); }
}

@ApiTags('shifts') @ApiBearerAuth() @Controller('shifts')
export class ShiftsController {
  constructor(private readonly svc: ShiftsService) {}
  @Get() @RequirePermission('shift.view') list(@CurrentUser() u: RequestUser, @Query() q: ShiftQueryDto) { return this.svc.list(u, q); }
  @Get('current') @RequirePermission('shift.view') current(@CurrentUser() u: RequestUser, @Query('branchId', ParseUUIDPipe) branchId: string) { return this.svc.current(u, branchId); }
  @Get(':id') @RequirePermission('shift.view') get(@CurrentUser() u: RequestUser, @Param('id', ParseUUIDPipe) id: string) { return this.svc.get(u, id); }
  @Post('open') @RequirePermission('shift.open') open(@CurrentUser() u: RequestUser, @Body() dto: OpenShiftDto) { return this.svc.open(u, dto); }
  @Post(':id/close') @RequirePermission('shift.close') @HttpCode(200) close(@CurrentUser() u: RequestUser, @Param('id', ParseUUIDPipe) id: string, @Body() dto: CloseShiftDto) { return this.svc.close(u, id, dto); }
}

@ApiTags('invoices') @ApiBearerAuth() @Controller('invoices')
export class InvoicesController {
  constructor(private readonly svc: InvoicesService) {}
  @Get() @RequirePermission('invoice.view') list(@CurrentUser() u: RequestUser, @Query() q: InvoiceQueryDto) { return this.svc.list(u, q); }
  @Get('price') @RequirePermission('invoice.create') @ApiOperation({ summary: 'Giá niêm yết cho POS (bảng giá / đơn vị quy đổi)' }) price(@CurrentUser() u: RequestUser, @Query() q: PosPriceQueryDto) { return this.svc.price(u, q); }
  @Get('price-books') @RequirePermission('invoice.create') @ApiOperation({ summary: 'Bảng giá áp dụng được cho chi nhánh / khách hàng' }) priceBooks(@CurrentUser() u: RequestUser, @Query('branchId', ParseUUIDPipe) branchId: string, @Query('customerId') customerId?: string) { return this.svc.applicablePriceBooks(u, branchId, customerId || undefined); }
  @Get(':id') @RequirePermission('invoice.view') get(@CurrentUser() u: RequestUser, @Param('id', ParseUUIDPipe) id: string) { return this.svc.get(u, id); }
  @Post('preview') @RequirePermission('invoice.create') @HttpCode(200) @ApiOperation({ summary: 'Tính thử giỏ hàng: giá, khuyến mãi tự động, voucher, hàng tặng, tổng tiền (không lưu)' }) preview(@CurrentUser() u: RequestUser, @Body() dto: CreateInvoiceDto) { return this.svc.preview(u, dto); }
  @Post() @RequirePermission('invoice.create') @Idempotent() @ApiOperation({ summary: 'Giữ đơn (tạo hóa đơn nháp)' }) create(@CurrentUser() u: RequestUser, @Body() dto: CreateInvoiceDto) { return this.svc.create(u, dto); }
  @Post('checkout') @RequirePermission('invoice.create', 'invoice.complete') @Idempotent() @ApiHeader({ name: 'Idempotency-Key', required: false })
  @ApiOperation({ summary: 'Thanh toán POS: tạo + hoàn thành hóa đơn trong một transaction (xuất kho, công nợ, phiếu thu)' })
  checkout(@CurrentUser() u: RequestUser, @Body() dto: CreateInvoiceDto) { return this.svc.checkout(u, dto); }
  @Patch(':id') @RequirePermission('invoice.create') update(@CurrentUser() u: RequestUser, @Param('id', ParseUUIDPipe) id: string, @Body() dto: UpdateInvoiceDto) { return this.svc.update(u, id, dto); }
  @Delete(':id') @RequirePermission('invoice.create') @HttpCode(204) async remove(@CurrentUser() u: RequestUser, @Param('id', ParseUUIDPipe) id: string) { await this.svc.remove(u, id); }
  @Post(':id/complete') @RequirePermission('invoice.complete') @Idempotent() @HttpCode(200) @ApiHeader({ name: 'Idempotency-Key', required: false })
  complete(@CurrentUser() u: RequestUser, @Param('id', ParseUUIDPipe) id: string, @Body() dto: CompleteInvoiceDto) { return this.svc.complete(u, id, dto ?? {}); }
  @Post(':id/cancel') @RequirePermission('invoice.cancel') @Idempotent() @HttpCode(200) cancel(@CurrentUser() u: RequestUser, @Param('id', ParseUUIDPipe) id: string, @Body() dto: CancelInvoiceDto) { return this.svc.cancel(u, id, dto.reason); }
}

@ApiTags('sales-reports') @ApiBearerAuth() @Controller('sales/reports')
export class SalesReportsController {
  constructor(private readonly svc: SalesReportsService) {}
  @Get('summary') @RequirePermission('sales.report.view') summary(@CurrentUser() u: RequestUser, @Query() q: SalesReportQueryDto) { return this.svc.summary(u, q); }
}

@ApiTags('sales-returns') @ApiBearerAuth() @Controller('sales-returns')
export class SalesReturnsController {
  constructor(private readonly svc: SalesReturnsService) {}
  @Get() @RequirePermission('return.view') list(@CurrentUser() u: RequestUser, @Query() q: SalesReturnQueryDto) { return this.svc.list(u, q); }
  @Get('returnable/:invoiceId') @RequirePermission('return.view') @ApiOperation({ summary: 'Các dòng còn có thể trả của hóa đơn kèm giá hoàn mặc định' })
  returnable(@CurrentUser() u: RequestUser, @Param('invoiceId', ParseUUIDPipe) invoiceId: string) { return this.svc.returnableLines(u, invoiceId); }
  @Get(':id') @RequirePermission('return.view') get(@CurrentUser() u: RequestUser, @Param('id', ParseUUIDPipe) id: string) { return this.svc.get(u, id); }
  @Post() @RequirePermission('return.create') @Idempotent() create(@CurrentUser() u: RequestUser, @Body() dto: CreateSalesReturnDto) { return this.svc.create(u, dto); }
  @Post('complete-now') @RequirePermission('return.create', 'return.complete') @Idempotent() @ApiHeader({ name: 'Idempotency-Key', required: false })
  @ApiOperation({ summary: 'Tạo + hoàn thành phiếu trả hàng (nhập lại kho / hàng hỏng, hoàn tiền hoặc ghi có công nợ)' })
  completeNow(@CurrentUser() u: RequestUser, @Body() dto: CreateSalesReturnDto) { return this.svc.completeNow(u, dto); }
  @Post('exchange') @RequirePermission('return.create', 'return.complete', 'invoice.create', 'invoice.complete') @Idempotent() @ApiHeader({ name: 'Idempotency-Key', required: false })
  @ApiOperation({ summary: 'Đổi hàng: trả hàng + hóa đơn mới, cấn trừ chênh lệch trong một giao dịch' })
  exchange(@CurrentUser() u: RequestUser, @Body() dto: ExchangeDto) { return this.svc.exchange(u, dto); }
  @Patch(':id') @RequirePermission('return.create') update(@CurrentUser() u: RequestUser, @Param('id', ParseUUIDPipe) id: string, @Body() dto: UpdateSalesReturnDto) { return this.svc.update(u, id, dto); }
  @Delete(':id') @RequirePermission('return.create') @HttpCode(204) async remove(@CurrentUser() u: RequestUser, @Param('id', ParseUUIDPipe) id: string) { await this.svc.remove(u, id); }
  @Post(':id/complete') @RequirePermission('return.complete') @Idempotent() @HttpCode(200) complete(@CurrentUser() u: RequestUser, @Param('id', ParseUUIDPipe) id: string, @Body() dto: CompleteSalesReturnDto) { return this.svc.complete(u, id, dto?.refund, dto?.version); }
  @Post(':id/cancel') @RequirePermission('return.cancel') @Idempotent() @HttpCode(200) cancel(@CurrentUser() u: RequestUser, @Param('id', ParseUUIDPipe) id: string, @Body() dto: CancelSalesReturnDto) { return this.svc.cancel(u, id, dto); }
}

@ApiTags('promotions') @ApiBearerAuth() @Controller('promotions')
export class PromotionsController {
  constructor(private readonly svc: PromotionsService) {}
  @Get() @RequirePermission('promotion.view') list(@CurrentUser() u: RequestUser, @Query() q: PromotionQueryDto) { return this.svc.list(u, q); }
  @Get('report') @RequirePermission('promotion.view') report(@CurrentUser() u: RequestUser, @Query() q: PromotionReportQueryDto) { return this.svc.report(u, q); }
  @Get('vouchers/lookup') @RequirePermission('invoice.create') @ApiOperation({ summary: 'POS: kiểm tra mã voucher' }) lookup(@CurrentUser() u: RequestUser, @Query() q: VoucherLookupQueryDto) { return this.svc.lookupVoucher(u, q.code, q.branchId, q.customerId); }
  @Patch('vouchers/:voucherId') @RequirePermission('promotion.manage') updateVoucher(@CurrentUser() u: RequestUser, @Param('voucherId', ParseUUIDPipe) id: string, @Body() dto: UpdateVoucherDto) { return this.svc.updateVoucher(u, id, dto); }
  @Get(':id') @RequirePermission('promotion.view') get(@CurrentUser() u: RequestUser, @Param('id', ParseUUIDPipe) id: string) { return this.svc.get(u, id); }
  @Post() @RequirePermission('promotion.manage') create(@CurrentUser() u: RequestUser, @Body() dto: CreatePromotionDto) { return this.svc.create(u, dto); }
  @Patch(':id') @RequirePermission('promotion.manage') update(@CurrentUser() u: RequestUser, @Param('id', ParseUUIDPipe) id: string, @Body() dto: UpdatePromotionDto) { return this.svc.update(u, id, dto); }
  @Delete(':id') @RequirePermission('promotion.manage') @HttpCode(204) async remove(@CurrentUser() u: RequestUser, @Param('id', ParseUUIDPipe) id: string) { await this.svc.remove(u, id); }
  @Get(':id/vouchers') @RequirePermission('promotion.view') vouchers(@CurrentUser() u: RequestUser, @Param('id', ParseUUIDPipe) id: string, @Query() q: VoucherQueryDto) { return this.svc.listVouchers(u, id, q); }
  @Post(':id/vouchers') @RequirePermission('promotion.manage') createVouchers(@CurrentUser() u: RequestUser, @Param('id', ParseUUIDPipe) id: string, @Body() dto: CreateVouchersDto) { return this.svc.createVouchers(u, id, dto); }
}

@ApiTags('orders') @ApiBearerAuth() @Controller('orders')
export class OrdersController {
  constructor(private readonly svc: OrdersService) {}
  @Get() @RequirePermission('order.view') list(@CurrentUser() u: RequestUser, @Query() q: SalesOrderQueryDto) { return this.svc.list(u, q); }
  @Get(':id') @RequirePermission('order.view') get(@CurrentUser() u: RequestUser, @Param('id', ParseUUIDPipe) id: string) { return this.svc.get(u, id); }
  @Post() @RequirePermission('order.create') @Idempotent() @ApiHeader({ name: 'Idempotency-Key', required: false }) @ApiOperation({ summary: 'Tạo đơn đặt hàng (mặc định xác nhận & giữ tồn ngay; có thể kèm cọc và vận đơn)' }) create(@CurrentUser() u: RequestUser, @Body() dto: CreateSalesOrderDto) { return this.svc.create(u, dto); }
  @Patch(':id') @RequirePermission('order.create') update(@CurrentUser() u: RequestUser, @Param('id', ParseUUIDPipe) id: string, @Body() dto: UpdateSalesOrderDto) { return this.svc.update(u, id, dto); }
  @Delete(':id') @RequirePermission('order.create') @HttpCode(204) async remove(@CurrentUser() u: RequestUser, @Param('id', ParseUUIDPipe) id: string) { await this.svc.remove(u, id); }
  @Post(':id/confirm') @RequirePermission('order.confirm') @Idempotent() @HttpCode(200) confirm(@CurrentUser() u: RequestUser, @Param('id', ParseUUIDPipe) id: string, @Body() dto: ConfirmOrderDto) { return this.svc.confirm(u, id, dto.version); }
  @Post(':id/unconfirm') @RequirePermission('order.confirm') @HttpCode(200) unconfirm(@CurrentUser() u: RequestUser, @Param('id', ParseUUIDPipe) id: string) { return this.svc.unconfirm(u, id); }
  @Post(':id/deposit') @RequirePermission('order.create') @Idempotent() @HttpCode(201) @ApiHeader({ name: 'Idempotency-Key', required: false }) deposit(@CurrentUser() u: RequestUser, @Param('id', ParseUUIDPipe) id: string, @Body() dto: DepositDto) { return this.svc.deposit(u, id, dto); }
  @Post(':id/complete') @RequirePermission('order.complete') @Idempotent() @HttpCode(200) @ApiHeader({ name: 'Idempotency-Key', required: false }) @ApiOperation({ summary: 'Hoàn tất đơn → hóa đơn (cọc chuyển sang hóa đơn, xuất kho)' }) complete(@CurrentUser() u: RequestUser, @Param('id', ParseUUIDPipe) id: string, @Body() dto: CompleteOrderDto) { return this.svc.complete(u, id, dto); }
  @Post(':id/cancel') @RequirePermission('order.cancel') @Idempotent() @HttpCode(200) cancel(@CurrentUser() u: RequestUser, @Param('id', ParseUUIDPipe) id: string, @Body() dto: CancelOrderDto) { return this.svc.cancel(u, id, dto); }
}

@ApiTags('deliveries') @ApiBearerAuth() @Controller('deliveries')
export class DeliveriesController {
  constructor(private readonly svc: DeliveriesService) {}
  @Get() @RequirePermission('delivery.view') list(@CurrentUser() u: RequestUser, @Query() q: DeliveryQueryDto) { return this.svc.list(u, q); }
  @Get(':id') @RequirePermission('delivery.view') get(@CurrentUser() u: RequestUser, @Param('id', ParseUUIDPipe) id: string) { return this.svc.get(u, id); }
  @Post() @RequirePermission('delivery.manage') @Idempotent() @ApiHeader({ name: 'Idempotency-Key', required: false }) create(@CurrentUser() u: RequestUser, @Body() dto: CreateDeliveryDto) { return this.svc.create(u, dto); }
  @Patch(':id') @RequirePermission('delivery.manage') update(@CurrentUser() u: RequestUser, @Param('id', ParseUUIDPipe) id: string, @Body() dto: UpdateDeliveryDto) { return this.svc.update(u, id, dto); }
  @Post(':id/status') @RequirePermission('delivery.manage') @Idempotent() @HttpCode(200) @ApiOperation({ summary: 'Chuyển trạng thái (PENDING → PICKING → DELIVERING → DELIVERED | RETURNING → RETURNED; hủy); DELIVERED có thể kèm thu hộ' }) setStatus(@CurrentUser() u: RequestUser, @Param('id', ParseUUIDPipe) id: string, @Body() dto: DeliveryStatusDto) { return this.svc.setStatus(u, id, dto); }
  @Post(':id/collect-cod') @RequirePermission('delivery.manage') @Idempotent() @HttpCode(200) collectCod(@CurrentUser() u: RequestUser, @Param('id', ParseUUIDPipe) id: string, @Body() dto: CodCollectionDto) { return this.svc.collectCodLater(u, id, dto); }
}
