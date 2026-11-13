import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { Type } from 'class-transformer';
import { ArrayMaxSize, IsArray, IsBoolean, IsIn, IsInt, IsISO8601, IsNumber, IsOptional, IsString, IsUUID, Matches, Max, MaxLength, Min, MinLength, ValidateIf, ValidateNested } from 'class-validator';
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
  @ApiPropertyOptional({ description: 'Sai số vị trí (m) do GPS báo' }) @IsOptional() @IsNumber() @Min(0) @Max(100000) accuracy?: number;
  @ApiPropertyOptional({ description: 'Mã thiết bị do trình duyệt sinh và lưu trên máy (chống chấm công hộ)' }) @IsOptional() @IsString() @MaxLength(80) deviceId?: string;
  @ApiPropertyOptional({ description: 'Tên thiết bị / trình duyệt (hiển thị cho quản lý)' }) @IsOptional() @TrimToUndefined() @IsString() @MaxLength(200) deviceName?: string;
  @ApiPropertyOptional({ nullable: true, description: 'Ca làm việc nhân viên chọn; bỏ trống = tự nhận ca theo giờ chấm; null = chấm ngoài ca (gắn cờ OFF_SHIFT)' }) @IsOptional() @ValidateIf((_o, v) => v !== null) @IsUUID() workShiftId?: string | null;
}
export class CheckOutDto {
  @ApiPropertyOptional() @IsOptional() @TrimToUndefined() @IsString() @MaxLength(500) note?: string;
  @ApiPropertyOptional() @IsOptional() @IsNumber() @Min(-90) @Max(90) latitude?: number;
  @ApiPropertyOptional() @IsOptional() @IsNumber() @Min(-180) @Max(180) longitude?: number;
  @ApiPropertyOptional() @IsOptional() @IsNumber() @Min(0) @Max(100000) accuracy?: number;
  @ApiPropertyOptional() @IsOptional() @IsString() @MaxLength(80) deviceId?: string;
}
export class AttendanceCurrentQueryDto {
  @ApiPropertyOptional({ description: 'Mã thiết bị đang dùng – trả về trạng thái tin cậy của thiết bị' }) @IsOptional() @IsString() @MaxLength(80) deviceId?: string;
}
export class AttendanceDeviceQueryDto {
  @ApiPropertyOptional() @IsOptional() @IsUUID() userId?: string;
  @ApiPropertyOptional({ enum: ['TRUSTED', 'PENDING', 'BLOCKED'] }) @IsOptional() @IsIn(['TRUSTED', 'PENDING', 'BLOCKED']) status?: string;
}
export class AttendanceDevicePatchDto {
  @ApiProperty({ enum: ['TRUSTED', 'BLOCKED'] }) @IsIn(['TRUSTED', 'BLOCKED']) status: 'TRUSTED' | 'BLOCKED';
}
export class AttendanceQueryDto extends PaginationQueryDto {
  @ApiPropertyOptional() @IsOptional() @IsISO8601() from?: string;
  @ApiPropertyOptional() @IsOptional() @IsISO8601() to?: string;
  @ApiPropertyOptional() @IsOptional() @IsUUID() userId?: string;
  @ApiPropertyOptional() @IsOptional() @IsUUID() branchId?: string;
  @ApiPropertyOptional({ description: 'true = chỉ lượt chưa chấm ra' }) @IsOptional() @IsIn(['true', 'false']) open?: string;
}
export class EditAttendanceDto {
  @ApiPropertyOptional({ nullable: true, description: 'Quản lý đặt lại tiền phạt đi trễ của lượt (0 = miễn phạt); bỏ trống = tính lại theo cấu hình khi đổi giờ vào / ca' }) @IsOptional() @ValidateIf((_o, v) => v !== null) @IsInt() @Min(0) @Max(100000000) latePenalty?: number | null;
  @ApiPropertyOptional({ nullable: true, description: 'Đổi ca của lượt; null = không theo ca (tính cả lượt)' }) @IsOptional() @ValidateIf((_o, v) => v !== null) @IsUUID() workShiftId?: string | null;
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
  @ApiPropertyOptional({ nullable: true, description: 'Ca làm việc; bỏ trống = tự nhận ca theo giờ vào, null = không theo ca' }) @IsOptional() @ValidateIf((_o, v) => v !== null) @IsUUID() workShiftId?: string | null;
}

// ---------------------------------------------------------------- ca làm việc (BR-187)
const HHMM = /^([01]\d|2[0-3]):[0-5]\d$/;
export class CreateWorkShiftDto {
  @ApiProperty({ example: 'Ca sáng' }) @Trim() @IsString() @MinLength(1) @MaxLength(100) name: string;
  @ApiProperty({ example: '07:30', description: 'Giờ vào ca (HH:mm)' }) @Matches(HHMM, { message: 'Giờ vào ca dạng HH:mm' }) start: string;
  @ApiProperty({ example: '14:00', description: 'Giờ hết ca (HH:mm); nhỏ hơn giờ vào = ca qua đêm' }) @Matches(HHMM, { message: 'Giờ hết ca dạng HH:mm' }) end: string;
  @ApiPropertyOptional({ nullable: true, description: 'Chi nhánh áp dụng; bỏ trống = mọi chi nhánh' }) @IsOptional() @ValidateIf((_o, v) => v !== null) @IsUUID() branchId?: string | null;
  @ApiPropertyOptional() @IsOptional() @IsBoolean() isActive?: boolean;
  @ApiPropertyOptional() @IsOptional() @IsInt() @Min(0) @Max(1000) sortOrder?: number;
}
export class UpdateWorkShiftDto {
  @ApiPropertyOptional() @IsOptional() @Trim() @IsString() @MinLength(1) @MaxLength(100) name?: string;
  @ApiPropertyOptional() @IsOptional() @Matches(HHMM, { message: 'Giờ vào ca dạng HH:mm' }) start?: string;
  @ApiPropertyOptional() @IsOptional() @Matches(HHMM, { message: 'Giờ hết ca dạng HH:mm' }) end?: string;
  @ApiPropertyOptional({ nullable: true }) @IsOptional() @ValidateIf((_o, v) => v !== null) @IsUUID() branchId?: string | null;
  @ApiPropertyOptional() @IsOptional() @IsBoolean() isActive?: boolean;
  @ApiPropertyOptional() @IsOptional() @IsInt() @Min(0) @Max(1000) sortOrder?: number;
}
export class EmployeeQueryDto extends PaginationQueryDto {
  @ApiPropertyOptional() @IsOptional() @IsUUID() branchId?: string;
  @ApiPropertyOptional({ enum: ['ACTIVE', 'LOCKED', 'DISABLED'] }) @IsOptional() @IsIn(['ACTIVE', 'LOCKED', 'DISABLED']) status?: string;
}
export class PageOnlyDto { @ApiPropertyOptional() @IsOptional() @Type(() => Number) @IsInt() @Min(1) page?: number }

// ---------------------------------------------------------------- phạt đi trễ (BR-188)
export class LateTierDto {
  @ApiProperty({ example: 6, description: 'Trễ từ (phút)' }) @IsInt() @Min(1) @Max(1440) fromMinutes: number;
  @ApiProperty({ example: 20000, description: 'Tiền phạt (đ)' }) @IsInt() @Min(0) @Max(100000000) amount: number;
}
export class LatePolicyDto {
  @ApiProperty() @IsBoolean() enabled: boolean;
  @ApiProperty({ example: 5, description: 'Cho phép trễ (phút) – trễ quá mức này mới tính đi trễ' }) @IsInt() @Min(0) @Max(240) graceMinutes: number;
  @ApiProperty({ enum: ['TIERS', 'PER_MINUTE'] }) @IsIn(['TIERS', 'PER_MINUTE']) mode: 'TIERS' | 'PER_MINUTE';
  @ApiProperty({ example: 1000, description: 'Phạt mỗi phút trễ (đ) khi mode = PER_MINUTE' }) @IsInt() @Min(0) @Max(10000000) perMinute: number;
  @ApiProperty({ type: [LateTierDto] }) @IsArray() @ArrayMaxSize(10) @ValidateNested({ each: true }) @Type(() => LateTierDto) tiers: LateTierDto[];
}
