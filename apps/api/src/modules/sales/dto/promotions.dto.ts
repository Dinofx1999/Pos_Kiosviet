import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { ArrayMaxSize, ArrayUnique, IsArray, IsBoolean, IsIn, IsInt, IsISO8601, IsObject, IsOptional, IsString, IsUUID, Matches, Max, MaxLength, Min, MinLength } from 'class-validator';
import { PROMOTION_TYPES } from '@erp/shared';
import { PaginationQueryDto } from '../../../common/pagination';
import { Trim, TrimToUndefined } from '../../../common/validators';

const HHMM = /^([01]\d|2[0-3]):[0-5]\d$/;

export class CreatePromotionDto {
  @ApiPropertyOptional({ description: 'Bỏ trống để tự sinh (KM0001)' }) @IsOptional() @TrimToUndefined() @IsString() @Matches(/^[A-Za-z0-9._-]{1,50}$/) code?: string;
  @ApiProperty() @Trim() @IsString() @MinLength(1) @MaxLength(200) name: string;
  @ApiProperty({ enum: PROMOTION_TYPES }) @IsIn(PROMOTION_TYPES as unknown as string[]) type: (typeof PROMOTION_TYPES)[number];
  @ApiPropertyOptional() @IsOptional() @TrimToUndefined() @IsString() @MaxLength(1000) description?: string;
  @ApiPropertyOptional({ enum: ['ACTIVE', 'INACTIVE'], default: 'ACTIVE' }) @IsOptional() @IsIn(['ACTIVE', 'INACTIVE']) status?: 'ACTIVE' | 'INACTIVE';
  @ApiPropertyOptional() @IsOptional() @IsISO8601() startsAt?: string;
  @ApiPropertyOptional() @IsOptional() @IsISO8601() endsAt?: string;
  @ApiPropertyOptional({ type: [Number], description: '0 = Chủ nhật … 6 = Thứ bảy; rỗng = mọi ngày' }) @IsOptional() @IsArray() @ArrayUnique() @IsInt({ each: true }) @Min(0, { each: true }) @Max(6, { each: true }) daysOfWeek?: number[];
  @ApiPropertyOptional({ example: '18:00' }) @IsOptional() @TrimToUndefined() @Matches(HHMM) timeFrom?: string;
  @ApiPropertyOptional({ example: '21:00' }) @IsOptional() @TrimToUndefined() @Matches(HHMM) timeTo?: string;
  @ApiPropertyOptional({ type: [String], description: 'Chi nhánh áp dụng; rỗng = tất cả' }) @IsOptional() @IsArray() @ArrayUnique() @IsUUID('4', { each: true }) branchIds?: string[];
  @ApiPropertyOptional({ type: [String], description: 'Nhóm khách hàng áp dụng; rỗng = mọi khách (kể cả khách lẻ)' }) @IsOptional() @IsArray() @ArrayMaxSize(50) @IsString({ each: true }) @MaxLength(100, { each: true }) customerGroups?: string[];
  @ApiPropertyOptional({ default: 0 }) @IsOptional() @IsInt() @Min(-1000) @Max(1000) priority?: number;
  @ApiPropertyOptional({ default: false, description: 'Áp dụng cùng các khuyến mãi khác' }) @IsOptional() @IsBoolean() stackable?: boolean;
  @ApiPropertyOptional({ description: 'Tổng số lượt áp dụng tối đa' }) @IsOptional() @IsInt() @Min(1) usageLimit?: number | null;
  @ApiPropertyOptional({ description: 'Số lượt tối đa cho mỗi khách hàng' }) @IsOptional() @IsInt() @Min(1) perCustomerLimit?: number | null;
  @ApiProperty({ description: 'Cấu hình theo loại (xem docs/api-contracts.md)' }) @IsObject() config: Record<string, unknown>;
}
export class UpdatePromotionDto {
  @ApiPropertyOptional() @IsOptional() @Trim() @IsString() @MinLength(1) @MaxLength(200) name?: string;
  @ApiPropertyOptional() @IsOptional() @TrimToUndefined() @IsString() @MaxLength(1000) description?: string;
  @ApiPropertyOptional({ enum: ['ACTIVE', 'INACTIVE'] }) @IsOptional() @IsIn(['ACTIVE', 'INACTIVE']) status?: 'ACTIVE' | 'INACTIVE';
  @ApiPropertyOptional() @IsOptional() @IsISO8601() startsAt?: string | null;
  @ApiPropertyOptional() @IsOptional() @IsISO8601() endsAt?: string | null;
  @ApiPropertyOptional({ type: [Number] }) @IsOptional() @IsArray() @ArrayUnique() @IsInt({ each: true }) @Min(0, { each: true }) @Max(6, { each: true }) daysOfWeek?: number[];
  @ApiPropertyOptional() @IsOptional() @Matches(HHMM) timeFrom?: string | null;
  @ApiPropertyOptional() @IsOptional() @Matches(HHMM) timeTo?: string | null;
  @ApiPropertyOptional({ type: [String] }) @IsOptional() @IsArray() @ArrayUnique() @IsUUID('4', { each: true }) branchIds?: string[];
  @ApiPropertyOptional({ type: [String] }) @IsOptional() @IsArray() @ArrayMaxSize(50) @IsString({ each: true }) @MaxLength(100, { each: true }) customerGroups?: string[];
  @ApiPropertyOptional() @IsOptional() @IsInt() @Min(-1000) @Max(1000) priority?: number;
  @ApiPropertyOptional() @IsOptional() @IsBoolean() stackable?: boolean;
  @ApiPropertyOptional() @IsOptional() @IsInt() @Min(1) usageLimit?: number | null;
  @ApiPropertyOptional() @IsOptional() @IsInt() @Min(1) perCustomerLimit?: number | null;
  @ApiPropertyOptional() @IsOptional() @IsObject() config?: Record<string, unknown>;
}
export class PromotionQueryDto extends PaginationQueryDto {
  @ApiPropertyOptional({ enum: ['ACTIVE', 'INACTIVE'] }) @IsOptional() @IsIn(['ACTIVE', 'INACTIVE']) status?: string;
  @ApiPropertyOptional({ enum: PROMOTION_TYPES }) @IsOptional() @IsIn(PROMOTION_TYPES as unknown as string[]) type?: string;
  @ApiPropertyOptional({ description: 'true = chỉ chương trình đang trong thời gian hiệu lực' }) @IsOptional() @IsIn(['true', 'false']) running?: string;
  @ApiPropertyOptional() @IsOptional() @IsUUID() branchId?: string;
}
export class CreateVouchersDto {
  @ApiPropertyOptional({ description: 'Số lượng mã tự sinh (1–1000); bỏ qua khi gửi `codes`' }) @IsOptional() @IsInt() @Min(1) @Max(1000) count?: number;
  @ApiPropertyOptional({ type: [String], description: 'Danh sách mã tự đặt' }) @IsOptional() @IsArray() @ArrayMaxSize(1000) @ArrayUnique() @IsString({ each: true }) @Matches(/^[A-Za-z0-9._-]{3,50}$/, { each: true }) codes?: string[];
  @ApiPropertyOptional({ example: 'SALE' }) @IsOptional() @TrimToUndefined() @Matches(/^[A-Za-z0-9._-]{0,20}$/) prefix?: string;
  @ApiPropertyOptional({ default: 1 }) @IsOptional() @IsInt() @Min(1) @Max(100000) maxUses?: number;
  @ApiPropertyOptional({ description: 'Chỉ khách hàng này dùng được' }) @IsOptional() @IsUUID() customerId?: string;
  @ApiPropertyOptional() @IsOptional() @IsISO8601() expiresAt?: string;
  @ApiPropertyOptional() @IsOptional() @TrimToUndefined() @IsString() @MaxLength(500) note?: string;
}
export class UpdateVoucherDto {
  @ApiPropertyOptional({ enum: ['ACTIVE', 'DISABLED'] }) @IsOptional() @IsIn(['ACTIVE', 'DISABLED']) status?: 'ACTIVE' | 'DISABLED';
  @ApiPropertyOptional() @IsOptional() @IsISO8601() expiresAt?: string | null;
  @ApiPropertyOptional() @IsOptional() @TrimToUndefined() @IsString() @MaxLength(500) note?: string;
}
export class VoucherQueryDto extends PaginationQueryDto {
  @ApiPropertyOptional({ enum: ['ACTIVE', 'USED', 'DISABLED'] }) @IsOptional() @IsIn(['ACTIVE', 'USED', 'DISABLED']) status?: string;
}
export class VoucherLookupQueryDto {
  @ApiProperty() @Trim() @IsString() @MinLength(1) @MaxLength(50) code: string;
  @ApiPropertyOptional() @IsOptional() @IsUUID() branchId?: string;
  @ApiPropertyOptional() @IsOptional() @IsUUID() customerId?: string;
}
export class PromotionReportQueryDto {
  @ApiPropertyOptional() @IsOptional() @IsISO8601() from?: string;
  @ApiPropertyOptional() @IsOptional() @IsISO8601() to?: string;
  @ApiPropertyOptional() @IsOptional() @IsUUID() branchId?: string;
}
