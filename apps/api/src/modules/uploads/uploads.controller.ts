import { Controller, Delete, HttpCode, Post, Query, UploadedFiles, UseInterceptors } from '@nestjs/common';
import { FilesInterceptor } from '@nestjs/platform-express';
import { ApiBearerAuth, ApiBody, ApiConsumes, ApiOperation, ApiTags } from '@nestjs/swagger';
import { hasPermission } from '@erp/shared';
import { CurrentUser } from '../../common/decorators';
import { Errors } from '../../common/errors/app-error';
import { RequestUser } from '../../infra/cls/request-context';
import { MAX_IMAGE_BYTES, MAX_IMAGES_PER_REQUEST, UploadsService } from './uploads.service';

@ApiTags('uploads') @ApiBearerAuth() @Controller('uploads')
export class UploadsController {
  constructor(private readonly svc: UploadsService) {}

  @Post('images')
  @UseInterceptors(FilesInterceptor('files', MAX_IMAGES_PER_REQUEST, { limits: { fileSize: MAX_IMAGE_BYTES, files: MAX_IMAGES_PER_REQUEST } }))
  @ApiConsumes('multipart/form-data') @ApiBody({ schema: { type: 'object', properties: { files: { type: 'array', items: { type: 'string', format: 'binary' } } } } })
  @ApiOperation({ summary: 'Tải lên tối đa 10 ảnh sản phẩm (JPEG/PNG/GIF/WebP, ≤5MB mỗi ảnh); trả về danh sách URL' })
  upload(@CurrentUser() u: RequestUser, @UploadedFiles() files: Array<{ buffer: Buffer; originalname: string; size: number }> = []) {
    if (!hasPermission(u.permissions, 'product.create') && !hasPermission(u.permissions, 'product.update')) throw Errors.forbidden('Thiếu quyền: product.create hoặc product.update');
    return this.svc.saveImages(u, files);
  }

  @Delete('images') @HttpCode(204)
  async remove(@CurrentUser() u: RequestUser, @Query('url') url?: string) {
    if (!hasPermission(u.permissions, 'product.update')) throw Errors.forbidden('Thiếu quyền: product.update');
    if (!url) throw Errors.validation('Thiếu url');
    await this.svc.deleteImage(u, url);
  }
}
