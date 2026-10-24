import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { IsBoolean, IsIn, IsISO8601, IsOptional, IsString, IsUUID, Matches, MaxLength, MinLength } from 'class-validator';
import { CASH_ACCOUNT_TYPES } from '@erp/shared';
import { PaginationQueryDto } from '../../../common/pagination';
import { IsDecimalStr, Trim, TrimToUndefined } from '../../../common/validators';

export class CreateCashAccountDto {
  @ApiPropertyOptional({ description: 'Bỏ trống để tự sinh (QT0002)' }) @IsOptional() @TrimToUndefined() @IsString() @Matches(/^[A-Za-z0-9._-]{1,50}$/) code?: string;
  @ApiProperty() @Trim() @IsString() @MinLength(1) @MaxLength(200) name: string;
  @ApiPropertyOptional({ enum: CASH_ACCOUNT_TYPES, default: 'CASH' }) @IsOptional() @IsIn(CASH_ACCOUNT_TYPES as unknown as string[]) type?: 'CASH' | 'BANK' | 'EWALLET';
  @ApiPropertyOptional({ description: 'Quỹ của một chi nhánh; bỏ trống = dùng chung toàn hệ thống' }) @IsOptional() @IsUUID() branchId?: string;
  @ApiPropertyOptional() @IsOptional() @TrimToUndefined() @IsString() @MaxLength(200) bankName?: string;
  @ApiPropertyOptional() @IsOptional() @TrimToUndefined() @IsString() @MaxLength(100) accountNumber?: string;
  @ApiPropertyOptional() @IsOptional() @TrimToUndefined() @IsString() @MaxLength(200) accountHolder?: string;
  @ApiPropertyOptional({ default: '0' }) @IsOptional() @IsDecimalStr({ min: 0 }) openingBalance?: string;
  @ApiPropertyOptional() @IsOptional() @IsBoolean() isDefault?: boolean;
}
export class UpdateCashAccountDto {
  @ApiPropertyOptional() @IsOptional() @Trim() @IsString() @MinLength(1) @MaxLength(200) name?: string;
  @ApiPropertyOptional() @IsOptional() @TrimToUndefined() @IsString() @MaxLength(200) bankName?: string;
  @ApiPropertyOptional() @IsOptional() @TrimToUndefined() @IsString() @MaxLength(100) accountNumber?: string;
  @ApiPropertyOptional() @IsOptional() @TrimToUndefined() @IsString() @MaxLength(200) accountHolder?: string;
  @ApiPropertyOptional() @IsOptional() @IsBoolean() isDefault?: boolean;
  @ApiPropertyOptional() @IsOptional() @IsBoolean() isActive?: boolean;
}
export class CreatePaymentCategoryDto {
  @ApiProperty({ enum: ['IN', 'OUT'] }) @IsIn(['IN', 'OUT']) direction: 'IN' | 'OUT';
  @ApiProperty({ example: 'Tiền điện nước' }) @Trim() @IsString() @MinLength(1) @MaxLength(200) name: string;
}
export class UpdatePaymentCategoryDto {
  @ApiPropertyOptional() @IsOptional() @Trim() @IsString() @MinLength(1) @MaxLength(200) name?: string;
  @ApiPropertyOptional() @IsOptional() @IsBoolean() isActive?: boolean;
}
export class CreateCashTransferDto {
  @ApiProperty() @IsUUID() branchId: string;
  @ApiProperty() @IsUUID() fromAccountId: string;
  @ApiProperty() @IsUUID() toAccountId: string;
  @ApiProperty() @IsDecimalStr({ positive: true }) amount: string;
  @ApiPropertyOptional() @IsOptional() @TrimToUndefined() @IsString() @MaxLength(1000) note?: string;
}
export class CancelTransferDto {
  @ApiProperty() @Trim() @IsString() @MinLength(1) @MaxLength(500) reason: string;
}
export class ReconcileCashDto {
  @ApiProperty() @IsDecimalStr({ min: 0 }) countedBalance: string;
  @ApiPropertyOptional() @IsOptional() @TrimToUndefined() @IsString() @MaxLength(1000) note?: string;
}
export class DebtOffsetDto {
  @ApiProperty() @IsUUID() branchId: string;
  @ApiProperty({ description: 'Khách hàng đồng thời là nhà cung cấp' }) @IsUUID() customerId: string;
  @ApiProperty() @IsUUID() supplierId: string;
  @ApiProperty() @IsDecimalStr({ positive: true }) amount: string;
  @ApiPropertyOptional() @IsOptional() @TrimToUndefined() @IsString() @MaxLength(1000) note?: string;
}
export class CashbookQueryDto extends PaginationQueryDto {
  @ApiPropertyOptional() @IsOptional() @IsUUID() accountId?: string;
  @ApiPropertyOptional() @IsOptional() @IsUUID() branchId?: string;
  @ApiPropertyOptional({ enum: ['IN', 'OUT'] }) @IsOptional() @IsIn(['IN', 'OUT']) direction?: string;
  @ApiPropertyOptional() @IsOptional() @IsISO8601() from?: string;
  @ApiPropertyOptional() @IsOptional() @IsISO8601() to?: string;
}
export class CashSummaryQueryDto {
  @ApiPropertyOptional() @IsOptional() @IsISO8601() from?: string;
  @ApiPropertyOptional() @IsOptional() @IsISO8601() to?: string;
  @ApiPropertyOptional() @IsOptional() @IsUUID() branchId?: string;
  @ApiPropertyOptional() @IsOptional() @IsUUID() accountId?: string;
}
export class TransferQueryDto extends PaginationQueryDto {
  @ApiPropertyOptional() @IsOptional() @IsUUID() branchId?: string;
  @ApiPropertyOptional({ enum: ['TRANSFER', 'HANDOVER'] }) @IsOptional() @IsIn(['TRANSFER', 'HANDOVER']) kind?: string;
  @ApiPropertyOptional({ enum: ['POSTED', 'CANCELLED'] }) @IsOptional() @IsIn(['POSTED', 'CANCELLED']) status?: string;
  @ApiPropertyOptional() @IsOptional() @IsISO8601() from?: string;
  @ApiPropertyOptional() @IsOptional() @IsISO8601() to?: string;
}
