import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { Type } from 'class-transformer';
import { ArrayMinSize, IsArray, IsIn, IsInt, IsISO8601, IsOptional, IsString, IsUUID, MaxLength, Min, ValidateNested } from 'class-validator';
import { ISSUE_REASONS, MOVEMENT_TYPES } from '@erp/shared';
import { PaginationQueryDto } from '../../../common/pagination';
import { IsDecimalStr, TrimToUndefined } from '../../../common/validators';

export const RECEIPT_REASONS = ['OPENING', 'RETURN_TO_STOCK', 'OTHER'] as const;
export const ADJUSTMENT_REASONS = ['COUNT', 'OTHER'] as const;
export const DOC_REASONS = Array.from(new Set<string>([...ISSUE_REASONS, ...RECEIPT_REASONS, ...ADJUSTMENT_REASONS]));

export class DocumentLineDto {
  @ApiProperty() @IsUUID() variantId: string;
  @ApiPropertyOptional() @IsOptional() @IsUUID() batchId?: string;
  @ApiPropertyOptional({ description: 'RECEIPT/ISSUE: số lượng dương. ADJUSTMENT: chênh lệch có dấu (bỏ qua nếu gửi actualQuantity)' }) @IsOptional() @IsDecimalStr() quantity?: string;
  @ApiPropertyOptional({ description: 'ADJUSTMENT: số lượng thực tế đếm được; chênh lệch tính lúc ghi sổ' }) @IsOptional() @IsDecimalStr({ min: 0 }) actualQuantity?: string;
  @ApiPropertyOptional({ description: 'RECEIPT: đơn giá nhập; bỏ trống = giá vốn hiện tại' }) @IsOptional() @IsDecimalStr({ min: 0 }) unitCost?: string;
  @ApiPropertyOptional() @IsOptional() @TrimToUndefined() @IsString() @MaxLength(500) note?: string;
}

export class CreateDocumentDto {
  @ApiProperty({ enum: ['RECEIPT', 'ISSUE', 'ADJUSTMENT'] }) @IsIn(['RECEIPT', 'ISSUE', 'ADJUSTMENT']) type: 'RECEIPT' | 'ISSUE' | 'ADJUSTMENT';
  @ApiProperty() @IsUUID() branchId: string;
  @ApiProperty() @IsUUID() warehouseId: string;
  @ApiPropertyOptional({ enum: DOC_REASONS }) @IsOptional() @IsIn(DOC_REASONS) reason?: string;
  @ApiPropertyOptional() @IsOptional() @TrimToUndefined() @IsString() @MaxLength(1000) note?: string;
  @ApiProperty({ type: [DocumentLineDto] }) @IsArray() @ArrayMinSize(1) @ValidateNested({ each: true }) @Type(() => DocumentLineDto) lines: DocumentLineDto[];
}

export class UpdateDocumentDto {
  @ApiProperty({ description: 'Optimistic lock' }) @Type(() => Number) @IsInt() @Min(1) version: number;
  @ApiPropertyOptional() @IsOptional() @IsUUID() warehouseId?: string;
  @ApiPropertyOptional({ enum: DOC_REASONS }) @IsOptional() @IsIn(DOC_REASONS) reason?: string;
  @ApiPropertyOptional() @IsOptional() @TrimToUndefined() @IsString() @MaxLength(1000) note?: string;
  @ApiPropertyOptional({ type: [DocumentLineDto] }) @IsOptional() @IsArray() @ArrayMinSize(1) @ValidateNested({ each: true }) @Type(() => DocumentLineDto) lines?: DocumentLineDto[];
}

export class CancelDocumentDto {
  @ApiProperty() @IsString() @MaxLength(500) reason: string;
}

export class DocumentQueryDto extends PaginationQueryDto {
  @ApiPropertyOptional({ enum: ['RECEIPT', 'ISSUE', 'ADJUSTMENT'] }) @IsOptional() @IsIn(['RECEIPT', 'ISSUE', 'ADJUSTMENT']) type?: string;
  @ApiPropertyOptional({ enum: ['DRAFT', 'POSTED', 'CANCELLED'] }) @IsOptional() @IsIn(['DRAFT', 'POSTED', 'CANCELLED']) status?: string;
  @ApiPropertyOptional() @IsOptional() @IsUUID() warehouseId?: string;
  @ApiPropertyOptional() @IsOptional() @IsUUID() branchId?: string;
  @ApiPropertyOptional() @IsOptional() @IsISO8601() from?: string;
  @ApiPropertyOptional() @IsOptional() @IsISO8601() to?: string;
}

export class BalanceQueryDto extends PaginationQueryDto {
  @ApiPropertyOptional() @IsOptional() @IsUUID() warehouseId?: string;
  @ApiPropertyOptional() @IsOptional() @IsUUID() variantId?: string;
  @ApiPropertyOptional() @IsOptional() @IsUUID() productId?: string;
  @ApiPropertyOptional() @IsOptional() @IsUUID() categoryId?: string;
  @ApiPropertyOptional({ enum: ['true', 'false'] }) @IsOptional() @IsIn(['true', 'false']) lowStock?: string;
  @ApiPropertyOptional({ enum: ['true', 'false'] }) @IsOptional() @IsIn(['true', 'false']) nonZero?: string;
}

export class MovementQueryDto extends PaginationQueryDto {
  @ApiPropertyOptional() @IsOptional() @IsUUID() warehouseId?: string;
  @ApiPropertyOptional() @IsOptional() @IsUUID() variantId?: string;
  @ApiPropertyOptional() @IsOptional() @IsUUID() productId?: string;
  @ApiPropertyOptional() @IsOptional() @IsString() @MaxLength(50) documentType?: string;
  @ApiPropertyOptional() @IsOptional() @IsUUID() documentId?: string;
  @ApiPropertyOptional({ enum: MOVEMENT_TYPES }) @IsOptional() @IsIn(MOVEMENT_TYPES as unknown as string[]) type?: string;
  @ApiPropertyOptional() @IsOptional() @IsISO8601() from?: string;
  @ApiPropertyOptional() @IsOptional() @IsISO8601() to?: string;
}

export class CreateReservationDto {
  @ApiProperty() @IsUUID() warehouseId: string;
  @ApiProperty() @IsUUID() variantId: string;
  @ApiPropertyOptional() @IsOptional() @IsUUID() batchId?: string;
  @ApiProperty() @IsDecimalStr({ positive: true }) quantity: string;
  @ApiProperty({ example: 'SALES_ORDER' }) @IsString() @MaxLength(50) documentType: string;
  @ApiProperty() @IsUUID() documentId: string;
}
export class ReservationQueryDto extends PaginationQueryDto {
  @ApiPropertyOptional() @IsOptional() @IsUUID() warehouseId?: string;
  @ApiPropertyOptional() @IsOptional() @IsUUID() variantId?: string;
  @ApiPropertyOptional({ enum: ['ACTIVE', 'RELEASED', 'CONSUMED'] }) @IsOptional() @IsIn(['ACTIVE', 'RELEASED', 'CONSUMED']) status?: string;
}
