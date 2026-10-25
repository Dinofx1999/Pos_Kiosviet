import { Body, Controller, Get, Headers, HttpCode, Param, ParseUUIDPipe, Post, Put, Query, Res } from '@nestjs/common';
import { ApiBearerAuth, ApiHeader, ApiOperation, ApiTags } from '@nestjs/swagger';
import type { Response } from 'express';
import { hasPermission, VIETQR_BANKS } from '@erp/shared';
import { CurrentUser, Public, RequirePermission } from '../../common/decorators';
import { AppError, Errors } from '../../common/errors/app-error';
import { RequestUser } from '../../infra/cls/request-context';
import { BankTransfersService } from './bank-transfers.service';
import { ApplyBankTransactionDto, BankRequestQueryDto, BankTransactionQueryDto, CreateBankRequestDto, IgnoreBankTransactionDto, SepayConfigDto } from './dto/bank-transfers.dto';

/** Cấu hình SePay (Tích hợp → SePay). */
@ApiTags('sepay') @ApiBearerAuth() @Controller('integrations/sepay')
export class SepayConfigController {
  constructor(private readonly svc: BankTransfersService) {}
  @Get() @RequirePermission('integration.view') @ApiOperation({ summary: 'Cấu hình nhận tiền chuyển khoản tự động (SePay), đường dẫn webhook, thống kê 30 ngày' }) get() { return this.svc.getConfig(); }
  @Put() @RequirePermission('integration.manage') save(@CurrentUser() u: RequestUser, @Body() dto: SepayConfigDto) { return this.svc.saveConfig(u, dto); }
  @Post('key') @RequirePermission('integration.manage') @HttpCode(200) @ApiOperation({ summary: 'Sinh khóa API cho webhook (chỉ hiện một lần; khóa cũ hết hiệu lực)' }) rotate(@CurrentUser() u: RequestUser) { return this.svc.rotateKey(u); }
}

const canPoll = (u: RequestUser) => ['invoice.create', 'payment.create', 'cash.view'].some((p) => hasPermission(u.permissions, p));

/** Yêu cầu thanh toán chuyển khoản (VietQR) và giao dịch ngân hàng nhận qua webhook. */
@ApiTags('bank-transfers') @ApiBearerAuth() @Controller('bank-transfers')
export class BankTransfersController {
  constructor(private readonly svc: BankTransfersService) {}
  @Get('banks') @ApiOperation({ summary: 'Ngân hàng hỗ trợ VietQR' }) banks() { return VIETQR_BANKS; }
  @Get('status') @ApiOperation({ summary: 'Màn bán hàng / thu tiền có dùng được QR chuyển khoản không (không lộ cấu hình)' })
  status(@CurrentUser() u: RequestUser) { if (!canPoll(u)) throw Errors.forbidden(); return this.svc.status(); }
  @Post('requests') @HttpCode(201) @ApiOperation({ summary: 'Tạo mã thanh toán + ảnh VietQR (POS: invoice.create; hóa đơn / đơn đặt hàng: payment.create)' })
  create(@CurrentUser() u: RequestUser, @Body() dto: CreateBankRequestDto) { return this.svc.createRequest(u, dto); }
  @Get('requests') @RequirePermission('cash.view') list(@CurrentUser() u: RequestUser, @Query() q: BankRequestQueryDto) { return this.svc.listRequests(u, q); }
  @Get('requests/:id') @ApiOperation({ summary: 'Trạng thái yêu cầu (POS hỏi định kỳ khi chờ khách chuyển khoản)' })
  get(@CurrentUser() u: RequestUser, @Param('id', ParseUUIDPipe) id: string) { if (!canPoll(u)) throw Errors.forbidden(); return this.svc.getRequest(u, id); }
  @Post('requests/:id/cancel') @HttpCode(200) cancel(@CurrentUser() u: RequestUser, @Param('id', ParseUUIDPipe) id: string) { if (!canPoll(u)) throw Errors.forbidden(); return this.svc.cancelRequest(u, id); }
  @Get('transactions') @RequirePermission('cash.view') @ApiOperation({ summary: 'Giao dịch chuyển khoản nhận từ SePay (lọc theo trạng thái khớp)' }) transactions(@CurrentUser() u: RequestUser, @Query() q: BankTransactionQueryDto) { return this.svc.listTransactions(u, q); }
  @Post('transactions/:id/apply') @HttpCode(200) @ApiOperation({ summary: 'Gắn giao dịch chưa khớp vào hóa đơn / đơn đặt hàng / khách hàng (lập phiếu thu)' })
  apply(@CurrentUser() u: RequestUser, @Param('id', ParseUUIDPipe) id: string, @Body() dto: ApplyBankTransactionDto) { return this.svc.applyTransaction(u, id, dto); }
  @Post('transactions/:id/ignore') @HttpCode(200) ignore(@CurrentUser() u: RequestUser, @Param('id', ParseUUIDPipe) id: string, @Body() dto: IgnoreBankTransactionDto) { return this.svc.ignoreTransaction(u, id, dto.note); }
}

/**
 * Webhook SePay: POST {id, gateway, transactionDate, accountNumber, code, content, transferType, transferAmount, accumulated, subAccount, referenceCode, description}
 * Header `Authorization: Apikey <khóa>`. Trả 200 {"success": true} cho mọi giao dịch đã lưu (kể cả trùng / bỏ qua) để SePay không gửi lại;
 * 401 khi khóa sai; lỗi tạm thời (deadlock) trả 5xx để SePay tự gửi lại.
 */
@ApiTags('webhooks') @Controller('webhooks') @Public()
export class SepayWebhookController {
  constructor(private readonly svc: BankTransfersService) {}
  @Post('sepay') @HttpCode(200) @ApiHeader({ name: 'Authorization', description: 'Apikey <khóa sinh ở Tích hợp → SePay>' })
  async sepay(@Headers('authorization') auth: string | undefined, @Body() body: Record<string, unknown>, @Res({ passthrough: true }) res: Response) {
    try {
      const r = await this.svc.handleSepayWebhook(auth, body ?? {});
      return { success: true, ...r };
    } catch (e) {
      if (e instanceof AppError && e.getStatus() === 401) { res.status(401); return { success: false, message: e.message }; }
      throw e;
    }
  }
}
