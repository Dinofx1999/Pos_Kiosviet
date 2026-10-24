import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { Type } from 'class-transformer';
import { IsBoolean, IsIn, IsInt, IsISO8601, IsNumber, IsOptional, IsString, IsUUID, Max, MaxLength, Min, MinLength, ValidateIf } from 'class-validator';
import { PaginationQueryDto } from '../../../common/pagination';
import { IsDecimalStr, Trim, TrimToUndefined } from '../../../common/validators';

export class CreateCommissionRuleDto {
  @ApiProperty({ example: 'Hoa hồng 2% doanh thu' }) @Trim() @IsString() @MinLength(1) @MaxLength(200) name: string;
  @ApiPropertyOptional({ description: 'Nhân viên áp dụng; bỏ trống = mọi nhân viên bán' }) @IsOptional() @IsUUID() userId?: string;
  @ApiPropertyOptional({ description: 'Chỉ tính cho nhóm hàng này' }) @IsOptional() @IsUUID() categoryId?: string;
  @ApiPropertyOptional({ description: 'Chỉ tính cho hàng hóa này' }) @IsOptional() @IsUUID() variantId?: string;
  @ApiPropertyOptional({ enum: ['REVENUE', 'GROSS_PROFIT', 'QUANTITY'], default: 'REVENUE' }) @IsOptional() @IsIn(['REVENUE', 'GROSS_PROFIT', 'QUANTITY']) basis?: 'REVENUE' | 'GROSS_PROFIT' | 'QUANTITY';
  @ApiProperty({ description: '% (REVENUE / GROSS_PROFIT) hoặc tiền mỗi đơn vị (QUANTITY)' }) @IsDecimalStr({ min: 0 }) rate: string;
  @ApiPropertyOptional({ description: 'Chỉ hưởng khi doanh thu thuần trong kỳ của nhân viên ≥ mức này' }) @IsOptional() @IsDecimalStr({ min: 0 }) minRevenue?: string;
  @ApiPropertyOptional({ default: 0 }) @IsOptional() @IsInt() @Min(-100) @Max(100) priority?: number;
  @ApiPropertyOptional() @IsOptional() @IsISO8601() startsAt?: string;
  @ApiPropertyOptional() @IsOptional() @IsISO8601() endsAt?: string;
  @ApiPropertyOptional({ default: true }) @IsOptional() @IsBoolean() isActive?: boolean;
}
export class UpdateCommissionRuleDto {
  @ApiPropertyOptional() @IsOptional() @Trim() @IsString() @MinLength(1) @MaxLength(200) name?: string;
  @ApiPropertyOptional({ nullable: true }) @IsOptional() @ValidateIf((_o, v) => v !== null) @IsUUID() userId?: string | null;
  @ApiPropertyOptional({ nullable: true }) @IsOptional() @ValidateIf((_o, v) => v !== null) @IsUUID() categoryId?: string | null;
  @ApiPropertyOptional({ nullable: true }) @IsOptional() @ValidateIf((_o, v) => v !== null) @IsUUID() variantId?: string | null;
  @ApiPropertyOptional({ enum: ['REVENUE', 'GROSS_PROFIT', 'QUANTITY'] }) @IsOptional() @IsIn(['REVENUE', 'GROSS_PROFIT', 'QUANTITY']) basis?: 'REVENUE' | 'GROSS_PROFIT' | 'QUANTITY';
  @ApiPropertyOptional() @IsOptional() @IsDecimalStr({ min: 0 }) rate?: string;
  @ApiPropertyOptional() @IsOptional() @IsDecimalStr({ min: 0 }) minRevenue?: string;
  @ApiPropertyOptional() @IsOptional() @IsInt() @Min(-100) @Max(100) priority?: number;
  @ApiPropertyOptional({ nullable: true }) @IsOptional() @ValidateIf((_o, v) => v !== null) @IsISO8601() startsAt?: string | null;
  @ApiPropertyOptional({ nullable: true }) @IsOptional() @ValidateIf((_o, v) => v !== null) @IsISO8601() endsAt?: string | null;
  @ApiPropertyOptional() @IsOptional() @IsBoolean() isActive?: boolean;
}
export class PeriodQueryDto {
  @ApiPropertyOptional() @IsOptional() @IsISO8601() from?: string;
  @ApiPropertyOptional() @IsOptional() @IsISO8601() to?: string;
  @ApiPropertyOptional() @IsOptional() @IsUUID() branchId?: string;
  @ApiPropertyOptional() @IsOptional() @IsUUID() userId?: string;
}
export class CheckInDto {
  @ApiPropertyOptional() @IsOptional() @IsUUID() branchId?: string;
  @ApiPropertyOptional() @IsOptional() @TrimToUndefined() @IsString() @MaxLength(500) note?: string;
  @ApiPropertyOptional() @IsOptional() @IsNumber() @Min(-90) @Max(90) latitude?: number;
  @ApiPropertyOptional() @IsOptional() @IsNumber() @Min(-180) @Max(180) longitude?: number;
}
export class CheckOutDto {
  @ApiPropertyOptional() @IsOptional() @TrimToUndefined() @IsString() @MaxLength(500) note?: string;
}
export class AttendanceQueryDto extends PaginationQueryDto {
  @ApiPropertyOptional() @IsOptional() @IsISO8601() from?: string;
  @ApiPropertyOptional() @IsOptional() @IsISO8601() to?: string;
  @ApiPropertyOptional() @IsOptional() @IsUUID() userId?: string;
  @ApiPropertyOptional() @IsOptional() @IsUUID() branchId?: string;
  @ApiPropertyOptional({ description: 'true = chỉ lượt chưa chấm ra' }) @IsOptional() @IsIn(['true', 'false']) open?: string;
}
export class EditAttendanceDto {
  @ApiPropertyOptional() @IsOptional() @IsISO8601() checkInAt?: string;
  @ApiPropertyOptional({ nullable: true }) @IsOptional() @ValidateIf((_o, v) => v !== null) @IsISO8601() checkOutAt?: string | null;
  @ApiPropertyOptional() @IsOptional() @TrimToUndefined() @IsString() @MaxLength(500) note?: string;
}
export class ManualAttendanceDto {
  @ApiProperty() @IsUUID() userId: string;
  @ApiPropertyOptional() @IsOptional() @IsUUID() branchId?: string;
  @ApiProperty() @IsISO8601() checkInAt: string;
  @ApiPropertyOptional() @IsOptional() @IsISO8601() checkOutAt?: string;
  @ApiPropertyOptional() @IsOptional() @TrimToUndefined() @IsString() @MaxLength(500) note?: string;
}
export class EmployeeQueryDto extends PaginationQueryDto {
  @ApiPropertyOptional() @IsOptional() @IsUUID() branchId?: string;
  @ApiPropertyOptional({ enum: ['ACTIVE', 'LOCKED', 'DISABLED'] }) @IsOptional() @IsIn(['ACTIVE', 'LOCKED', 'DISABLED']) status?: string;
}
export class PageOnlyDto { @ApiPropertyOptional() @IsOptional() @Type(() => Number) @IsInt() @Min(1) page?: number }
