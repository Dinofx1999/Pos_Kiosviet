import { Body, Controller, Delete, Get, HttpCode, Param, ParseUUIDPipe, Post, Put, Query, UploadedFile, UseInterceptors } from '@nestjs/common';
import { FileInterceptor } from '@nestjs/platform-express';
import { ApiBearerAuth, ApiBody, ApiConsumes, ApiOperation, ApiTags } from '@nestjs/swagger';
import { plainToInstance } from 'class-transformer';
import { validate } from 'class-validator';
import { CurrentUser, RequirePermission } from '../../common/decorators';
import { Errors } from '../../common/errors/app-error';
import { RequestUser } from '../../infra/cls/request-context';
import { ImportCommitDto, ImportJobQueryDto, ImportOptionsDto, ImportPreviewBodyDto, KiotVietConnectionDto, KiotVietImportDto } from './dto/integrations.dto';
import { ImportService } from './import.service';
import { IntegrationsService } from './integrations.service';

@ApiTags('integrations') @ApiBearerAuth() @Controller('integrations')
export class IntegrationsController {
  constructor(private readonly imports: ImportService, private readonly svc: IntegrationsService) {}

  // ---- Excel import (KiotViet exports)
  @Post('import/preview') @RequirePermission('integration.manage') @UseInterceptors(FileInterceptor('file', { limits: { fileSize: 50 * 1024 * 1024 } })) @ApiConsumes('multipart/form-data')
  @ApiBody({ schema: { type: 'object', properties: { file: { type: 'string', format: 'binary' }, type: { type: 'string', enum: ['PRODUCTS', 'CUSTOMERS', 'SUPPLIERS', 'INVOICES'] }, options: { type: 'string', description: 'JSON ImportOptionsDto' } } } })
  @ApiOperation({ summary: 'Bước 1: đọc file Excel xuất từ KiotViet, nhận diện cột, xem trước' })
  async preview(@CurrentUser() u: RequestUser, @UploadedFile() file: { buffer: Buffer; originalname: string } | undefined, @Body() body: ImportPreviewBodyDto) {
    if (!file?.buffer) throw Errors.validation('Thiếu file xlsx');
    let options: ImportOptionsDto = {};
    if (body.options) {
      try { options = plainToInstance(ImportOptionsDto, JSON.parse(body.options)); } catch { throw Errors.validation('options phải là JSON hợp lệ'); }
      const errs = await validate(options, { whitelist: true });
      if (errs.length) throw Errors.validation('options không hợp lệ', { errors: errs.map((e) => Object.values(e.constraints ?? {})).flat() });
    }
    return this.imports.preview(u, body.type, file.originalname, file.buffer, options);
  }
  @Post('import/:jobId/commit') @RequirePermission('integration.manage') @HttpCode(200) @ApiOperation({ summary: 'Bước 2: thực hiện nhập với ánh xạ cột đã xác nhận' })
  commit(@CurrentUser() u: RequestUser, @Param('jobId', ParseUUIDPipe) jobId: string, @Body() dto: ImportCommitDto) { return this.imports.commit(u, jobId, dto); }
  @Get('import-jobs') @RequirePermission('integration.view') jobs(@CurrentUser() u: RequestUser, @Query() q: ImportJobQueryDto) { return this.imports.list(u, q); }
  @Get('import-jobs/:id') @RequirePermission('integration.view') job(@CurrentUser() u: RequestUser, @Param('id', ParseUUIDPipe) id: string) { return this.imports.get(u, id); }
  @Get('reconcile') @RequirePermission('integration.view') @ApiOperation({ summary: 'Số liệu đối soát sau khi nhập (so với KiotViet)' }) reconcile(@CurrentUser() u: RequestUser) { return this.imports.reconcile(u); }

  // ---- KiotViet Public API connection
  @Get('kiotviet') @RequirePermission('integration.view') getKiotViet(@CurrentUser() u: RequestUser) { return this.svc.getKiotViet(u); }
  @Put('kiotviet') @RequirePermission('integration.manage') @ApiOperation({ summary: 'Lưu Retailer / Client ID / Client Secret (người dùng tự nhập)' }) saveKiotViet(@CurrentUser() u: RequestUser, @Body() dto: KiotVietConnectionDto) { return this.svc.saveKiotViet(u, dto); }
  @Delete('kiotviet') @RequirePermission('integration.manage') removeKiotViet(@CurrentUser() u: RequestUser) { return this.svc.removeKiotViet(u); }
  @Post('kiotviet/test') @RequirePermission('integration.manage') @HttpCode(200) @ApiOperation({ summary: 'Kiểm tra kết nối: trả về danh sách chi nhánh KiotViet và kho của hệ thống' }) testKiotViet(@CurrentUser() u: RequestUser) { return this.svc.testKiotViet(u); }
  @Post('kiotviet/import') @RequirePermission('integration.manage') @HttpCode(200) @ApiOperation({ summary: 'Kéo dữ liệu từ KiotViet (hàng hóa, khách hàng, NCC, lịch sử hóa đơn) và nhập vào hệ thống' }) importKiotViet(@CurrentUser() u: RequestUser, @Body() dto: KiotVietImportDto) { return this.svc.importFromKiotViet(u, dto); }
}
