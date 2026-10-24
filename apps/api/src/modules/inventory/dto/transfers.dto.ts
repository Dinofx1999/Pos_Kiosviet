import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { Type } from 'class-transformer';
import { ArrayMaxSize, ArrayMinSize, IsArray, IsIn, IsInt, IsISO8601, IsOptional, IsString, IsUUID, MaxLength, Min, MinLength, ValidateIf, ValidateNested } from 'class-validator';
import { PaginationQueryDto } from '../../../common/pagination';
import { IsDecimalStr, Trim, TrimToUndefined } from '../../../common/validators';

// ------------------------------------------------------------------ chuyển kho
export class TransferLineDto {
  @ApiProperty() @IsUUID() variantId: string;
  @ApiPropertyOptional() @IsOptional() @IsUUID() batchId?: string;
  @ApiProperty({ description: 'Số lượng gửi (đơn vị cơ bản)' }) @IsDecimalStr({ positive: true }) quantity: string;
  @ApiPropertyOptional() @IsOptional() @TrimToUndefined() @IsString() @MaxLength(500) note?: string;
}
export class CreateTransferDto {
  @ApiProperty() @IsUUID() fromWarehouseId: string;
  @ApiProperty() @IsUUID() toWarehouseId: string;
  @ApiPropertyOptional() @IsOptional() @TrimToUndefined() @IsString() @MaxLength(1000) note?: string;
  @ApiProperty({ type: [TransferLineDto] }) @IsArray() @ArrayMinSize(1) @ArrayMaxSize(500) @ValidateNested({ each: true }) @Type(() => TransferLineDto) lines: TransferLineDto[];
}
export class UpdateTransferDto {
  @ApiProperty() @Type(() => Number) @IsInt() @Min(1) version: number;
  @ApiPropertyOptional() @IsOptional() @IsUUID() toWarehouseId?: string;
  @ApiPropertyOptional({ nullable: true, description: 'null hoặc chuỗi rỗng = xóa ghi chú' }) @IsOptional() @ValidateIf((_o, v) => v !== null) @Trim() @IsString() @MaxLength(1000) note?: string | null;
  @ApiPropertyOptional({ type: [TransferLineDto] }) @IsOptional() @IsArray() @ArrayMinSize(1) @ArrayMaxSize(500) @ValidateNested({ each: true }) @Type(() => TransferLineDto) lines?: TransferLineDto[];
}
export class DispatchTransferDto {
  @ApiPropertyOptional() @IsOptional() @Type(() => Number) @IsInt() @Min(1) version?: number;
}
export class ReceiveLineDto {
  @ApiProperty() @IsUUID() lineId: string;
  @ApiProperty({ description: '0 ≤ nhận ≤ gửi' }) @IsDecimalStr({ min: 0 }) receivedQuantity: string;
  @ApiPropertyOptional() @IsOptional() @TrimToUndefined() @IsString() @MaxLength(500) note?: string;
}
export class ReceiveTransferDto {
  @ApiPropertyOptional() @IsOptional() @Type(() => Number) @IsInt() @Min(1) version?: number;
  @ApiPropertyOptional({ type: [ReceiveLineDto], description: 'Bỏ trống = nhận đủ như đã gửi' }) @IsOptional() @IsArray() @ArrayMaxSize(500) @ValidateNested({ each: true }) @Type(() => ReceiveLineDto) lines?: ReceiveLineDto[];
  @ApiPropertyOptional({ enum: ['WRITE_OFF', 'RETURN_TO_SOURCE'], default: 'WRITE_OFF', description: 'Xử lý phần thiếu: ghi nhận thất thoát hoặc trả về kho nguồn' }) @IsOptional() @IsIn(['WRITE_OFF', 'RETURN_TO_SOURCE']) shortageAction?: 'WRITE_OFF' | 'RETURN_TO_SOURCE';
  @ApiPropertyOptional() @IsOptional() @TrimToUndefined() @IsString() @MaxLength(1000) note?: string;
}
export class CancelTransferDto {
  @ApiProperty() @Trim() @IsString() @MinLength(1) @MaxLength(500) reason: string;
}
export class TransferQueryDto extends PaginationQueryDto {
  @ApiPropertyOptional({ enum: ['DRAFT', 'IN_TRANSIT', 'RECEIVED', 'CANCELLED'] }) @IsOptional() @IsIn(['DRAFT', 'IN_TRANSIT', 'RECEIVED', 'CANCELLED']) status?: string;
  @ApiPropertyOptional() @IsOptional() @IsUUID() fromWarehouseId?: string;
  @ApiPropertyOptional() @IsOptional() @IsUUID() toWarehouseId?: string;
  @ApiPropertyOptional({ description: 'Chi nhánh gửi hoặc nhận' }) @IsOptional() @IsUUID() branchId?: string;
  @ApiPropertyOptional({ enum: ['in', 'out'], description: 'in = phiếu gửi đến kho của tôi, out = phiếu tôi gửi đi' }) @IsOptional() @IsIn(['in', 'out']) direction?: string;
  @ApiPropertyOptional() @IsOptional() @IsISO8601() from?: string;
  @ApiPropertyOptional() @IsOptional() @IsISO8601() to?: string;
}

// ------------------------------------------------------------------ kiểm kho
export class StocktakeLineDto {
  @ApiProperty() @IsUUID() variantId: string;
  @ApiPropertyOptional() @IsOptional() @IsUUID() batchId?: string;
  @ApiPropertyOptional({ description: 'Số đếm thực tế; bỏ trống = thêm dòng chưa đếm' }) @IsOptional() @IsDecimalStr({ min: 0 }) countedQuantity?: string;
  @ApiPropertyOptional() @IsOptional() @TrimToUndefined() @IsString() @MaxLength(500) note?: string;
}
export class CreateStocktakeDto {
  @ApiProperty() @IsUUID() warehouseId: string;
  @ApiPropertyOptional({ enum: ['SELECTED', 'ALL'], default: 'SELECTED', description: 'ALL = chụp toàn bộ hàng có số dư trong kho' }) @IsOptional() @IsIn(['SELECTED', 'ALL']) scope?: 'SELECTED' | 'ALL';
  @ApiPropertyOptional({ description: 'Chỉ dùng với scope=ALL: giới hạn theo nhóm hàng' }) @IsOptional() @IsUUID() categoryId?: string;
  @ApiPropertyOptional() @IsOptional() @TrimToUndefined() @IsString() @MaxLength(1000) note?: string;
  @ApiPropertyOptional({ type: [StocktakeLineDto] }) @IsOptional() @IsArray() @ArrayMaxSize(2000) @ValidateNested({ each: true }) @Type(() => StocktakeLineDto) lines?: StocktakeLineDto[];
}
export class UpdateStocktakeDto {
  @ApiProperty() @Type(() => Number) @IsInt() @Min(1) version: number;
  @ApiPropertyOptional() @IsOptional() @TrimToUndefined() @IsString() @MaxLength(1000) note?: string;
}
export class CountStocktakeDto {
  @ApiProperty({ type: [StocktakeLineDto], description: 'Thêm / cập nhật số đếm theo (variantId, batchId); nhiều người có thể gửi song song' }) @IsArray() @ArrayMinSize(1) @ArrayMaxSize(500) @ValidateNested({ each: true }) @Type(() => StocktakeLineDto) lines: StocktakeLineDto[];
}
export class CompleteStocktakeDto {
  @ApiPropertyOptional() @IsOptional() @Type(() => Number) @IsInt() @Min(1) version?: number;
  @ApiPropertyOptional({ enum: ['SKIP', 'ZERO'], default: 'SKIP', description: 'Dòng chưa đếm: SKIP = giữ nguyên tồn, ZERO = coi như đếm được 0' }) @IsOptional() @IsIn(['SKIP', 'ZERO']) uncountedAs?: 'SKIP' | 'ZERO';
}
export class CancelStocktakeDto {
  @ApiProperty() @Trim() @IsString() @MinLength(1) @MaxLength(500) reason: string;
}
export class StocktakeQueryDto extends PaginationQueryDto {
  @ApiPropertyOptional({ enum: ['DRAFT', 'COMPLETED', 'CANCELLED'] }) @IsOptional() @IsIn(['DRAFT', 'COMPLETED', 'CANCELLED']) status?: string;
  @ApiPropertyOptional() @IsOptional() @IsUUID() warehouseId?: string;
  @ApiPropertyOptional() @IsOptional() @IsUUID() branchId?: string;
  @ApiPropertyOptional() @IsOptional() @IsISO8601() from?: string;
  @ApiPropertyOptional() @IsOptional() @IsISO8601() to?: string;
}
