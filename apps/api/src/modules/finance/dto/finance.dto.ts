import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { Type } from 'class-transformer';
import { IsArray, IsIn, IsISO8601, IsOptional, IsString, IsUUID, MaxLength, MinLength, ValidateNested } from 'class-validator';
import { CASH_PAYMENT_METHODS, PAYMENT_METHODS } from '@erp/shared';
import { PaginationQueryDto } from '../../../common/pagination';
import { IsDecimalStr, Trim, TrimToUndefined } from '../../../common/validators';

export class AllocationInputDto {
  @ApiProperty({ enum: ['PURCHASE_RECEIPT', 'PURCHASE_RETURN', 'INVOICE', 'SALES_RETURN', 'SALES_ORDER'] }) @IsIn(['PURCHASE_RECEIPT', 'PURCHASE_RETURN', 'INVOICE', 'SALES_RETURN', 'SALES_ORDER']) documentType: 'PURCHASE_RECEIPT' | 'PURCHASE_RETURN' | 'INVOICE' | 'SALES_RETURN';
  @ApiProperty() @IsUUID() documentId: string;
  @ApiProperty() @IsDecimalStr({ positive: true }) amount: string;
}

export class CreatePaymentDto {
  @ApiProperty() @IsUUID() branchId: string;
  @ApiProperty({ enum: ['IN', 'OUT'], description: 'OUT = phiếu chi (trả NCC), IN = phiếu thu (NCC hoàn tiền)' }) @IsIn(['IN', 'OUT']) direction: 'IN' | 'OUT';
  @ApiPropertyOptional({ enum: CASH_PAYMENT_METHODS, default: 'CASH' }) @IsOptional() @IsIn(CASH_PAYMENT_METHODS as unknown as string[]) method?: string;
  @ApiPropertyOptional({ enum: ['SUPPLIER', 'CUSTOMER'], description: 'Bỏ trống = khách lẻ (phải phân bổ hết vào hóa đơn)' }) @IsOptional() @IsIn(['SUPPLIER', 'CUSTOMER']) partyType?: 'SUPPLIER' | 'CUSTOMER';
  @ApiPropertyOptional() @IsOptional() @IsUUID() partyId?: string;
  @ApiProperty() @IsDecimalStr({ positive: true }) amount: string;
  @ApiPropertyOptional() @IsOptional() @IsISO8601() paymentDate?: string;
  @ApiPropertyOptional() @IsOptional() @TrimToUndefined() @IsString() @MaxLength(200) reference?: string;
  @ApiPropertyOptional() @IsOptional() @TrimToUndefined() @IsString() @MaxLength(1000) note?: string;
  @ApiPropertyOptional({ type: [AllocationInputDto], description: 'Phân bổ vào chứng từ; phần không phân bổ là trả trước / trừ vào công nợ chung' }) @IsOptional() @IsArray() @ValidateNested({ each: true }) @Type(() => AllocationInputDto) allocations?: AllocationInputDto[];
  @ApiPropertyOptional({ description: 'Quỹ tiền; bỏ trống = quỹ mặc định theo phương thức' }) @IsOptional() @IsUUID() cashAccountId?: string;
  @ApiPropertyOptional({ description: 'Loại thu/chi khác (phiếu không gắn đối tác)' }) @IsOptional() @IsUUID() categoryId?: string;
}

export class CancelPaymentDto {
  @ApiProperty() @Trim() @IsString() @MinLength(1) @MaxLength(500) reason: string;
}

export class PaymentQueryDto extends PaginationQueryDto {
  @ApiPropertyOptional({ enum: ['IN', 'OUT'] }) @IsOptional() @IsIn(['IN', 'OUT']) direction?: string;
  @ApiPropertyOptional({ enum: ['SUPPLIER', 'CUSTOMER'] }) @IsOptional() @IsIn(['SUPPLIER', 'CUSTOMER']) partyType?: string;
  @ApiPropertyOptional() @IsOptional() @IsUUID() partyId?: string;
  @ApiPropertyOptional() @IsOptional() @IsUUID() branchId?: string;
  @ApiPropertyOptional({ enum: ['POSTED', 'CANCELLED'] }) @IsOptional() @IsIn(['POSTED', 'CANCELLED']) status?: string;
  @ApiPropertyOptional() @IsOptional() @IsUUID() cashAccountId?: string;
  @ApiPropertyOptional() @IsOptional() @IsUUID() categoryId?: string;
  @ApiPropertyOptional({ enum: PAYMENT_METHODS }) @IsOptional() @IsIn(PAYMENT_METHODS as unknown as string[]) method?: string;
  @ApiPropertyOptional() @IsOptional() @IsISO8601() from?: string;
  @ApiPropertyOptional() @IsOptional() @IsISO8601() to?: string;
}

export class LedgerQueryDto extends PaginationQueryDto {
  @ApiPropertyOptional() @IsOptional() @IsISO8601() from?: string;
  @ApiPropertyOptional() @IsOptional() @IsISO8601() to?: string;
}
