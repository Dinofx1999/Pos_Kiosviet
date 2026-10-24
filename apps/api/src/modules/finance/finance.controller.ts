import { Body, Controller, Get, HttpCode, Param, ParseBoolPipe, ParseUUIDPipe, Patch, Post, Query } from '@nestjs/common';
import { ApiBearerAuth, ApiHeader, ApiTags } from '@nestjs/swagger';
import { CurrentUser, Idempotent, RequirePermission } from '../../common/decorators';
import { Errors } from '../../common/errors/app-error';
import { RequestUser } from '../../infra/cls/request-context';
import { CancelPaymentDto, CreatePaymentDto, PaymentQueryDto } from './dto/finance.dto';
import { PaymentsService } from './payments.service';
import { CashbookService } from './cashbook.service';
import { CancelTransferDto, CashbookQueryDto, CashSummaryQueryDto, CreateCashAccountDto, CreateCashTransferDto, CreatePaymentCategoryDto, DebtOffsetDto, ReconcileCashDto, TransferQueryDto, UpdateCashAccountDto, UpdatePaymentCategoryDto } from './dto/cashbook.dto';

@ApiTags('payments') @ApiBearerAuth() @Controller('payments')
export class PaymentsController {
  constructor(private readonly svc: PaymentsService) {}
  @Get() @RequirePermission('payment.view') list(@CurrentUser() u: RequestUser, @Query() q: PaymentQueryDto) { return this.svc.list(u, q); }
  @Post('reconcile') @RequirePermission('payment.view') @HttpCode(200) reconcile(@CurrentUser() u: RequestUser) {
    if (!u.isOwner && !u.permissions.has('*')) throw Errors.forbidden('Chỉ quản trị viên mới chạy đối soát công nợ');
    return this.svc.reconcile(u);
  }
  @Get(':id') @RequirePermission('payment.view') get(@CurrentUser() u: RequestUser, @Param('id', ParseUUIDPipe) id: string) { return this.svc.get(u, id); }
  @Post() @RequirePermission('payment.create') @Idempotent() @ApiHeader({ name: 'Idempotency-Key', required: false })
  create(@CurrentUser() u: RequestUser, @Body() dto: CreatePaymentDto) { return this.svc.create(u, dto); }
  @Post(':id/cancel') @RequirePermission('payment.cancel') @Idempotent() @HttpCode(200)
  cancel(@CurrentUser() u: RequestUser, @Param('id', ParseUUIDPipe) id: string, @Body() dto: CancelPaymentDto) { return this.svc.cancel(u, id, dto.reason); }
}

@ApiTags('cashbook') @ApiBearerAuth() @Controller('cash')
export class CashbookController {
  constructor(private readonly svc: CashbookService) {}
  // quỹ tiền
  @Get('accounts') @RequirePermission('cash.view') accounts(@CurrentUser() u: RequestUser, @Query('includeInactive', new ParseBoolPipe({ optional: true })) inactive?: boolean) { return this.svc.listAccounts(u, inactive ?? false); }
  @Get('accounts/:id') @RequirePermission('cash.view') account(@CurrentUser() u: RequestUser, @Param('id', ParseUUIDPipe) id: string) { return this.svc.getAccount(u, id); }
  @Post('accounts') @RequirePermission('cash.account.manage') createAccount(@CurrentUser() u: RequestUser, @Body() dto: CreateCashAccountDto) { return this.svc.createAccount(u, dto); }
  @Patch('accounts/:id') @RequirePermission('cash.account.manage') updateAccount(@CurrentUser() u: RequestUser, @Param('id', ParseUUIDPipe) id: string, @Body() dto: UpdateCashAccountDto) { return this.svc.updateAccount(u, id, dto); }
  @Get('accounts/:id/reconciliations') @RequirePermission('cash.view') reconciliations(@CurrentUser() u: RequestUser, @Param('id', ParseUUIDPipe) id: string) { return this.svc.listReconciliations(u, id); }
  @Post('accounts/:id/reconcile') @RequirePermission('cash.reconcile') reconcile(@CurrentUser() u: RequestUser, @Param('id', ParseUUIDPipe) id: string, @Body() dto: ReconcileCashDto) { return this.svc.reconcile(u, id, dto); }
  // loại thu / chi
  @Get('categories') @RequirePermission('payment.view') categories(@Query('direction') direction?: string, @Query('includeInactive', new ParseBoolPipe({ optional: true })) inactive?: boolean) { return this.svc.listCategories(direction, inactive ?? false); }
  @Post('categories') @RequirePermission('cash.account.manage') createCategory(@CurrentUser() u: RequestUser, @Body() dto: CreatePaymentCategoryDto) { return this.svc.createCategory(u, dto); }
  @Patch('categories/:id') @RequirePermission('cash.account.manage') updateCategory(@CurrentUser() u: RequestUser, @Param('id', ParseUUIDPipe) id: string, @Body() dto: UpdatePaymentCategoryDto) { return this.svc.updateCategory(u, id, dto); }
  // chuyển quỹ / bàn giao
  @Get('transfers') @RequirePermission('cash.view') transfers(@CurrentUser() u: RequestUser, @Query() q: TransferQueryDto) { return this.svc.listTransfers(u, q); }
  @Post('transfers') @RequirePermission('cash.transfer') @Idempotent() @ApiHeader({ name: 'Idempotency-Key', required: false }) transfer(@CurrentUser() u: RequestUser, @Body() dto: CreateCashTransferDto) { return this.svc.transfer(u, dto); }
  @Post('transfers/:id/cancel') @RequirePermission('cash.transfer') @Idempotent() @HttpCode(200) cancelTransfer(@CurrentUser() u: RequestUser, @Param('id', ParseUUIDPipe) id: string, @Body() dto: CancelTransferDto) { return this.svc.cancelTransfer(u, id, dto.reason); }
  // sổ quỹ
  @Get('book') @RequirePermission('cash.view') book(@CurrentUser() u: RequestUser, @Query() q: CashbookQueryDto) { return this.svc.cashbook(u, q); }
  @Get('summary') @RequirePermission('cash.view') summary(@CurrentUser() u: RequestUser, @Query() q: CashSummaryQueryDto) { return this.svc.summary(u, q); }
  // cấn trừ công nợ
  @Post('debt-offset') @RequirePermission('debt.offset') @Idempotent() @HttpCode(201) debtOffset(@CurrentUser() u: RequestUser, @Body() dto: DebtOffsetDto) { return this.svc.debtOffset(u, dto); }
  @Post('debt-offset/:paymentId/cancel') @RequirePermission('debt.offset') @Idempotent() @HttpCode(200) cancelDebtOffset(@CurrentUser() u: RequestUser, @Param('paymentId', ParseUUIDPipe) id: string, @Body() dto: CancelTransferDto) { return this.svc.cancelDebtOffset(u, id, dto.reason); }
}
