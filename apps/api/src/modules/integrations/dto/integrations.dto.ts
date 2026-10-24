import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { Type } from 'class-transformer';
import { ArrayMinSize, ArrayUnique, IsArray, IsBoolean, IsIn, IsISO8601, IsObject, IsOptional, IsString, IsUUID, MaxLength, MinLength, ValidateNested } from 'class-validator';
import { PaginationQueryDto } from '../../../common/pagination';
import { TrimToUndefined } from '../../../common/validators';

export const IMPORT_TYPES = ['PRODUCTS', 'CUSTOMERS', 'SUPPLIERS', 'INVOICES'] as const;

export class StockColumnDto {
  @ApiProperty({ example: 'Tồn kho' }) @IsString() @MinLength(1) @MaxLength(200) header: string;
  @ApiProperty() @IsUUID() warehouseId: string;
}
export class ImportOptionsDto {
  @ApiPropertyOptional({ type: [StockColumnDto], description: 'Cột tồn kho → kho nhận' }) @IsOptional() @IsArray() @ValidateNested({ each: true }) @Type(() => StockColumnDto) stockColumns?: StockColumnDto[];
  @ApiPropertyOptional({ description: 'Kho nhận tồn khi file chỉ có một cột "Tồn kho"' }) @IsOptional() @IsUUID() defaultWarehouseId?: string;
  @ApiPropertyOptional({ default: false, description: 'Đưa công nợ của KH/NCC đã có về đúng số trong file' }) @IsOptional() @IsBoolean() syncDebt?: boolean;
  @ApiPropertyOptional({ default: true }) @IsOptional() @IsBoolean() updateExisting?: boolean;
  @ApiPropertyOptional({ default: true }) @IsOptional() @IsBoolean() importStock?: boolean;
  @ApiPropertyOptional({ description: 'Hóa đơn: tên chi nhánh KiotViet → id chi nhánh' }) @IsOptional() @IsObject() branchMap?: Record<string, string>;
  @ApiPropertyOptional() @IsOptional() @IsUUID() defaultBranchId?: string;
  @ApiPropertyOptional({ description: 'Bỏ qua hóa đơn trước ngày này' }) @IsOptional() @IsISO8601() invoicesFrom?: string;
}
export class ImportPreviewBodyDto {
  @ApiProperty({ enum: IMPORT_TYPES }) @IsIn(IMPORT_TYPES as unknown as string[]) type: (typeof IMPORT_TYPES)[number];
  @ApiPropertyOptional({ description: 'JSON chuỗi của ImportOptionsDto (multipart)' }) @IsOptional() @IsString() options?: string;
}
export class ImportCommitDto {
  @ApiPropertyOptional({ description: 'Ghi đè ánh xạ cột: { field: header }' }) @IsOptional() @IsObject() mapping?: Record<string, string>;
  @ApiPropertyOptional({ type: ImportOptionsDto }) @IsOptional() @ValidateNested() @Type(() => ImportOptionsDto) options?: ImportOptionsDto;
}
export class ImportJobQueryDto extends PaginationQueryDto {
  @ApiPropertyOptional({ enum: IMPORT_TYPES }) @IsOptional() @IsIn(IMPORT_TYPES as unknown as string[]) type?: string;
}
export class KiotVietConnectionDto {
  @ApiPropertyOptional({ example: 'tenmyphamcuaban', description: 'Tên gian hàng (Retailer) trong KiotViet — bắt buộc khi tạo mới' }) @IsOptional() @TrimToUndefined() @IsString() @MinLength(1) @MaxLength(100) retailer?: string;
  @ApiPropertyOptional({ description: 'Bắt buộc khi tạo mới; bỏ trống để giữ Client ID đã lưu' }) @IsOptional() @TrimToUndefined() @IsString() @MinLength(8) @MaxLength(200) clientId?: string;
  @ApiPropertyOptional({ description: 'Bắt buộc khi tạo mới; bỏ trống để giữ Client Secret đã lưu' }) @IsOptional() @TrimToUndefined() @IsString() @MinLength(8) @MaxLength(500) clientSecret?: string;
  @ApiPropertyOptional({ description: 'Tên chi nhánh KiotViet → id kho nhận tồn' }) @IsOptional() @IsObject() branchMap?: Record<string, string>;
}
export class KiotVietImportDto {
  @ApiProperty({ enum: IMPORT_TYPES, isArray: true }) @IsArray() @ArrayMinSize(1) @ArrayUnique() @IsIn(IMPORT_TYPES as unknown as string[], { each: true }) entities: Array<(typeof IMPORT_TYPES)[number]>;
  @ApiPropertyOptional({ description: 'Tên chi nhánh KiotViet → id kho; bỏ trống dùng branchMap đã lưu' }) @IsOptional() @IsObject() branchMap?: Record<string, string>;
  @ApiPropertyOptional() @IsOptional() @IsUUID() defaultWarehouseId?: string;
  @ApiPropertyOptional() @IsOptional() @IsUUID() defaultBranchId?: string;
  @ApiPropertyOptional({ default: true }) @IsOptional() @IsBoolean() syncDebt?: boolean;
  @ApiPropertyOptional({ default: true }) @IsOptional() @IsBoolean() updateExisting?: boolean;
  @ApiPropertyOptional({ default: true }) @IsOptional() @IsBoolean() importStock?: boolean;
  @ApiPropertyOptional() @IsOptional() @IsISO8601() invoicesFrom?: string;
  @ApiPropertyOptional() @IsOptional() @IsISO8601() invoicesTo?: string;
}
