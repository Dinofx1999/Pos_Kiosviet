import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { Type } from 'class-transformer';
import { ArrayUnique, IsArray, IsBoolean, IsEmail, IsIn, IsInt, IsISO8601, IsObject, IsOptional, IsString, IsUUID, Matches, Max, MaxLength, Min, MinLength, ValidateIf, ValidateNested } from 'class-validator';
import { IsDecimalStr } from '../../../common/validators';
import { PaginationQueryDto } from '../../../common/pagination';

export class CreateBranchDto {
  @ApiProperty() @IsString() @Matches(/^[A-Za-z0-9_-]{1,50}$/) code: string;
  @ApiProperty() @IsString() @MinLength(1) @MaxLength(200) name: string;
  @ApiPropertyOptional() @IsOptional() @IsString() @MaxLength(500) address?: string;
  @ApiPropertyOptional() @IsOptional() @IsString() @MaxLength(30) phone?: string;
  @ApiPropertyOptional() @IsOptional() @IsEmail() email?: string;
  @ApiPropertyOptional({ description: 'Tạo kho mặc định cho chi nhánh (mặc định true)' }) @IsOptional() @IsBoolean() createDefaultWarehouse?: boolean = true;
}
export class UpdateBranchDto {
  @ApiPropertyOptional() @IsOptional() @IsString() @MinLength(1) @MaxLength(200) name?: string;
  @ApiPropertyOptional() @IsOptional() @IsString() @MaxLength(500) address?: string;
  @ApiPropertyOptional() @IsOptional() @IsString() @MaxLength(30) phone?: string;
  @ApiPropertyOptional() @IsOptional() @IsEmail() email?: string;
  @ApiPropertyOptional() @IsOptional() @IsBoolean() isActive?: boolean;
  @ApiPropertyOptional() @IsOptional() @IsBoolean() isDefault?: boolean;
}

export class CreateWarehouseDto {
  @ApiProperty() @IsUUID() branchId: string;
  @ApiProperty() @IsString() @Matches(/^[A-Za-z0-9_-]{1,50}$/) code: string;
  @ApiProperty() @IsString() @MinLength(1) @MaxLength(200) name: string;
  @ApiPropertyOptional() @IsOptional() @IsString() @MaxLength(500) address?: string;
}
export class UpdateWarehouseDto {
  @ApiPropertyOptional() @IsOptional() @IsString() @MinLength(1) @MaxLength(200) name?: string;
  @ApiPropertyOptional() @IsOptional() @IsString() @MaxLength(500) address?: string;
  @ApiPropertyOptional() @IsOptional() @IsBoolean() isActive?: boolean;
  @ApiPropertyOptional() @IsOptional() @IsBoolean() isDefault?: boolean;
}

export class CreateUserDto {
  @ApiProperty() @IsString() @Matches(/^[a-zA-Z0-9._-]{3,100}$/) username: string;
  @ApiProperty() @IsString() @MinLength(6) @MaxLength(100) password: string;
  @ApiProperty() @IsString() @MinLength(1) @MaxLength(200) fullName: string;
  @ApiPropertyOptional() @IsOptional() @IsEmail() email?: string;
  @ApiPropertyOptional() @IsOptional() @IsString() @MaxLength(30) phone?: string;
  @ApiPropertyOptional({ type: [String] }) @IsOptional() @IsArray() @IsUUID('4', { each: true }) roleIds?: string[];
  @ApiPropertyOptional() @IsOptional() @IsBoolean() allBranches?: boolean;
  @ApiPropertyOptional({ type: [String] }) @IsOptional() @IsArray() @ArrayUnique() @IsUUID('4', { each: true }) branchIds?: string[];
  @ApiPropertyOptional({ type: [String] }) @IsOptional() @IsArray() @ArrayUnique() @IsUUID('4', { each: true }) warehouseIds?: string[];
  @ApiPropertyOptional({ example: 'Thu ngân' }) @IsOptional() @IsString() @MaxLength(100) position?: string;
  @ApiPropertyOptional() @IsOptional() @IsISO8601() hiredAt?: string;
  @ApiPropertyOptional({ description: 'Lương cơ bản (chỉ người có employee.manage xem được)' }) @IsOptional() @IsDecimalStr({ min: 0 }) baseSalary?: string;
  @ApiPropertyOptional() @IsOptional() @IsString() @MaxLength(1000) employeeNote?: string;
}
export class UpdateUserDto {
  @ApiPropertyOptional() @IsOptional() @IsString() @MinLength(1) @MaxLength(200) fullName?: string;
  @ApiPropertyOptional() @IsOptional() @IsEmail() email?: string;
  @ApiPropertyOptional() @IsOptional() @IsString() @MaxLength(30) phone?: string;
  @ApiPropertyOptional({ enum: ['ACTIVE', 'LOCKED', 'DISABLED'] }) @IsOptional() @IsIn(['ACTIVE', 'LOCKED', 'DISABLED']) status?: 'ACTIVE' | 'LOCKED' | 'DISABLED';
  @ApiPropertyOptional({ type: [String] }) @IsOptional() @IsArray() @IsUUID('4', { each: true }) roleIds?: string[];
  @ApiPropertyOptional() @IsOptional() @IsBoolean() allBranches?: boolean;
  @ApiPropertyOptional({ type: [String] }) @IsOptional() @IsArray() @ArrayUnique() @IsUUID('4', { each: true }) branchIds?: string[];
  @ApiPropertyOptional({ type: [String] }) @IsOptional() @IsArray() @ArrayUnique() @IsUUID('4', { each: true }) warehouseIds?: string[];
  @ApiPropertyOptional({ example: 'Thu ngân' }) @IsOptional() @IsString() @MaxLength(100) position?: string;
  @ApiPropertyOptional({ nullable: true, description: 'null = xóa ngày vào làm' }) @IsOptional() @ValidateIf((_o, v) => v !== null) @IsISO8601() hiredAt?: string | null;
  @ApiPropertyOptional({ description: 'Lương cơ bản (chỉ người có employee.manage xem được)' }) @IsOptional() @IsDecimalStr({ min: 0 }) baseSalary?: string;
  @ApiPropertyOptional() @IsOptional() @IsString() @MaxLength(1000) employeeNote?: string;
}
export class ResetPasswordDto {
  @ApiProperty() @IsString() @MinLength(6) @MaxLength(100) newPassword: string;
}
export class UserQueryDto extends PaginationQueryDto {
  @ApiPropertyOptional() @IsOptional() @IsIn(['ACTIVE', 'LOCKED', 'DISABLED']) status?: string;
  @ApiPropertyOptional() @IsOptional() @IsUUID() roleId?: string;
}

export class CreateRoleDto {
  @ApiProperty() @IsString() @Matches(/^[A-Z0-9_]{2,50}$/, { message: 'Mã vai trò viết hoa, không dấu' }) code: string;
  @ApiProperty() @IsString() @MinLength(1) @MaxLength(200) name: string;
  @ApiPropertyOptional() @IsOptional() @IsString() @MaxLength(500) description?: string;
  @ApiProperty({ type: [String] }) @IsArray() @IsString({ each: true }) permissions: string[];
}
export class UpdateRoleDto {
  @ApiPropertyOptional() @IsOptional() @IsString() @MinLength(1) @MaxLength(200) name?: string;
  @ApiPropertyOptional() @IsOptional() @IsString() @MaxLength(500) description?: string;
  @ApiPropertyOptional({ type: [String] }) @IsOptional() @IsArray() @IsString({ each: true }) permissions?: string[];
}

export class UpdateSettingsDto {
  @ApiProperty({ description: 'Map key → value', example: { 'inventory.allowNegativeStock': false } }) @IsObject()
  settings: Record<string, unknown>;
}
export class SequenceItemDto {
  @ApiProperty() @IsString() @MaxLength(50) docType: string;
  @ApiProperty() @IsString() @Matches(/^[A-Za-z0-9]{1,10}$/) prefix: string;
  @ApiProperty() @Type(() => Number) @IsInt() @Min(1) @Max(12) padding: number;
  @ApiProperty({ enum: ['NEVER', 'YEARLY', 'MONTHLY'] }) @IsIn(['NEVER', 'YEARLY', 'MONTHLY']) resetPolicy: 'NEVER' | 'YEARLY' | 'MONTHLY';
}
export class UpdateSequencesDto {
  @ApiProperty({ type: [SequenceItemDto] }) @IsArray() @ValidateNested({ each: true }) @Type(() => SequenceItemDto) items: SequenceItemDto[];
}
export class AuditQueryDto extends PaginationQueryDto {
  @ApiPropertyOptional() @IsOptional() @IsString() entityType?: string;
  @ApiPropertyOptional() @IsOptional() @IsString() entityId?: string;
  @ApiPropertyOptional() @IsOptional() @IsUUID() userId?: string;
  @ApiPropertyOptional() @IsOptional() @IsString() action?: string;
  @ApiPropertyOptional() @IsOptional() @IsISO8601() from?: string;
  @ApiPropertyOptional() @IsOptional() @IsISO8601() to?: string;
}
