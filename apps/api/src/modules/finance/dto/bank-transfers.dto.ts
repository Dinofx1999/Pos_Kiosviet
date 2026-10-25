import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { Type } from 'class-transformer';
import { IsBoolean, IsIn, IsInt, IsOptional, IsString, IsUUID, Matches, Max, MaxLength, Min, ValidateIf } from 'class-validator';
import { IsDecimalStr, TrimToUndefined } from '../../../common/validators';
import { PaginationQueryDto } from '../../../common/pagination';

export class SepayConfigDto {
  @ApiPropertyOptional({ description: 'Bật nhận tiền tự động' }) @IsOptional() @IsBoolean() enabled?: boolean;
  @ApiPropertyOptional({ example: 'MBBank', description: 'Tên viết tắt ngân hàng theo danh sách VietQR (VIETQR_BANKS.shortName)' }) @IsOptional() @TrimToUndefined() @IsString() @MaxLength(40) bankCode?: string;
  @ApiPropertyOptional({ example: '0123456789' }) @IsOptional() @TrimToUndefined() @Matches(/^[0-9A-Za-z]{4,30}$/, { message: 'Số tài khoản chỉ gồm chữ / số (4–30 ký tự)' }) accountNumber?: string;
  @ApiPropertyOptional({ example: 'NGUYEN THI BAO AN' }) @IsOptional() @TrimToUndefined() @IsString() @MaxLength(120) accountName?: string;
  @ApiPropertyOptional({ nullable: true, description: 'Quỹ ngân hàng ghi nhận tiền về; bỏ trống = quỹ ngân hàng mặc định' }) @IsOptional() @ValidateIf((_o, v) => v !== null) @IsUUID() cashAccountId?: string | null;
  @ApiPropertyOptional({ example: 'BA', description: 'Tiền tố mã thanh toán: 2–5 chữ cái (giống cấu hình "Cấu trúc mã thanh toán" trên SePay)' }) @IsOptional() @Matches(/^[A-Za-z]{2,5}$/, { message: 'Tiền tố gồm 2–5 chữ cái' }) codePrefix?: string;
  @ApiPropertyOptional({ default: 15, description: 'Thời gian hiệu lực mã QR tại quầy (phút)' }) @IsOptional() @Type(() => Number) @IsInt() @Min(2) @Max(240) posTtlMinutes?: number;
}

export class CreateBankRequestDto {
  @ApiProperty({ enum: ['POS', 'INVOICE', 'SALES_ORDER'] }) @IsIn(['POS', 'INVOICE', 'SALES_ORDER']) purpose: 'POS' | 'INVOICE' | 'SALES_ORDER';
  @ApiPropertyOptional({ description: 'Bắt buộc với POS' }) @IsOptional() @IsUUID() branchId?: string;
  @ApiPropertyOptional({ description: 'Hóa đơn / đơn đặt hàng (INVOICE / SALES_ORDER)' }) @IsOptional() @IsUUID() documentId?: string;
  @ApiPropertyOptional({ description: 'Số tiền; bỏ trống = số còn phải thu của chứng từ' }) @IsOptional() @IsDecimalStr({ positive: true }) amount?: string;
  @ApiPropertyOptional() @IsOptional() @TrimToUndefined() @IsString() @MaxLength(500) note?: string;
}

export class BankRequestQueryDto extends PaginationQueryDto {
  @ApiPropertyOptional({ enum: ['PENDING', 'PARTIAL', 'PAID', 'CANCELLED'] }) @IsOptional() @IsIn(['PENDING', 'PARTIAL', 'PAID', 'CANCELLED']) status?: string;
  @ApiPropertyOptional({ enum: ['POS', 'INVOICE', 'SALES_ORDER'] }) @IsOptional() @IsIn(['POS', 'INVOICE', 'SALES_ORDER']) purpose?: string;
  @ApiPropertyOptional() @IsOptional() @IsUUID() documentId?: string;
}

export class BankTransactionQueryDto extends PaginationQueryDto {
  @ApiPropertyOptional({ enum: ['MATCHED', 'UNMATCHED', 'APPLIED', 'IGNORED'] }) @IsOptional() @IsIn(['MATCHED', 'UNMATCHED', 'APPLIED', 'IGNORED']) status?: string;
}

export class ApplyBankTransactionDto {
  @ApiProperty({ enum: ['INVOICE', 'SALES_ORDER', 'CUSTOMER'], description: 'Gắn vào hóa đơn / đơn đặt hàng, hoặc ghi có cho khách hàng (trả trước / trừ nợ)' }) @IsIn(['INVOICE', 'SALES_ORDER', 'CUSTOMER']) target: 'INVOICE' | 'SALES_ORDER' | 'CUSTOMER';
  @ApiPropertyOptional() @IsOptional() @IsUUID() documentId?: string;
  @ApiPropertyOptional() @IsOptional() @IsUUID() customerId?: string;
  @ApiPropertyOptional() @IsOptional() @TrimToUndefined() @IsString() @MaxLength(500) note?: string;
}

export class IgnoreBankTransactionDto {
  @ApiPropertyOptional() @IsOptional() @TrimToUndefined() @IsString() @MaxLength(500) note?: string;
}
