import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { Type } from 'class-transformer';
import { ArrayMaxSize, ArrayMinSize, IsArray, IsDefined, IsIn, IsInt, IsISO8601, IsNotEmptyObject, IsOptional, IsString, IsUUID, MaxLength, Min, MinLength, ValidateNested } from 'class-validator';
import { CASH_PAYMENT_METHODS, INVOICE_STATUSES, RETURN_CONDITIONS } from '@erp/shared';
import { PaginationQueryDto } from '../../../common/pagination';
import { IsDecimalStr, Trim, TrimToUndefined } from '../../../common/validators';
import { InvoiceLineDto, InvoicePaymentDto } from './sales.dto';

export class ReturnLineDto {
  @ApiProperty() @IsUUID() invoiceLineId: string;
  @ApiProperty({ description: 'Số lượng trả theo đơn vị đã bán' }) @IsDecimalStr({ positive: true }) quantity: string;
  @ApiPropertyOptional({ description: 'Giá hoàn / đơn vị; bỏ trống = số tiền khách đã trả cho đơn vị đó; khác mặc định cần return.price.edit' }) @IsOptional() @IsDecimalStr({ min: 0 }) unitPrice?: string;
  @ApiPropertyOptional({ enum: RETURN_CONDITIONS, default: 'RESTOCK', description: 'RESTOCK = nhập lại kho, DAMAGED = hàng hỏng (không nhập kho)' }) @IsOptional() @IsIn(RETURN_CONDITIONS as unknown as string[]) condition?: 'RESTOCK' | 'DAMAGED';
  @ApiPropertyOptional() @IsOptional() @TrimToUndefined() @IsString() @MaxLength(500) note?: string;
}

export class RefundDto {
  @ApiProperty({ enum: CASH_PAYMENT_METHODS }) @IsIn(CASH_PAYMENT_METHODS as unknown as string[]) method: string;
  @ApiProperty() @IsDecimalStr({ positive: true }) amount: string;
  @ApiPropertyOptional() @IsOptional() @TrimToUndefined() @IsString() @MaxLength(200) reference?: string;
}

export class CreateSalesReturnDto {
  @ApiProperty() @IsUUID() invoiceId: string;
  @ApiPropertyOptional() @IsOptional() @IsISO8601() returnDate?: string;
  @ApiPropertyOptional() @IsOptional() @TrimToUndefined() @IsString() @MaxLength(200) reason?: string;
  @ApiPropertyOptional() @IsOptional() @TrimToUndefined() @IsString() @MaxLength(1000) note?: string;
  @ApiPropertyOptional({ description: 'Phí trả hàng (trừ vào tiền hoàn)' }) @IsOptional() @IsDecimalStr({ min: 0 }) feeAmount?: string;
  @ApiProperty({ type: [ReturnLineDto] }) @IsArray() @ArrayMinSize(1) @ArrayMaxSize(200) @ValidateNested({ each: true }) @Type(() => ReturnLineDto) lines: ReturnLineDto[];
  @ApiPropertyOptional({ type: RefundDto, description: 'Hoàn tiền ngay (chỉ dùng với complete-now); không hoàn = ghi có công nợ khách' }) @IsOptional() @ValidateNested() @Type(() => RefundDto) refund?: RefundDto;
}

export class UpdateSalesReturnDto {
  @ApiProperty() @Type(() => Number) @IsInt() @Min(1) version: number;
  @ApiPropertyOptional() @IsOptional() @IsISO8601() returnDate?: string;
  @ApiPropertyOptional() @IsOptional() @TrimToUndefined() @IsString() @MaxLength(200) reason?: string;
  @ApiPropertyOptional() @IsOptional() @TrimToUndefined() @IsString() @MaxLength(1000) note?: string;
  @ApiPropertyOptional() @IsOptional() @IsDecimalStr({ min: 0 }) feeAmount?: string;
  @ApiPropertyOptional({ type: [ReturnLineDto] }) @IsOptional() @IsArray() @ArrayMinSize(1) @ArrayMaxSize(200) @ValidateNested({ each: true }) @Type(() => ReturnLineDto) lines?: ReturnLineDto[];
}

export class CompleteSalesReturnDto {
  @ApiPropertyOptional() @IsOptional() @Type(() => Number) @IsInt() @Min(1) version?: number;
  @ApiPropertyOptional({ type: RefundDto }) @IsOptional() @ValidateNested() @Type(() => RefundDto) refund?: RefundDto;
}

export class CancelSalesReturnDto {
  @ApiProperty() @Trim() @IsString() @MinLength(1) @MaxLength(500) reason: string;
}

export class ExchangeNewInvoiceDto {
  @ApiPropertyOptional() @IsOptional() @IsUUID() warehouseId?: string;
  @ApiPropertyOptional() @IsOptional() @IsUUID() sellerId?: string;
  @ApiPropertyOptional() @IsOptional() @IsUUID() priceBookId?: string;
  @ApiPropertyOptional() @IsOptional() @IsDecimalStr({ min: 0 }) discountAmount?: string;
  @ApiPropertyOptional() @IsOptional() @TrimToUndefined() @IsString() @MaxLength(1000) note?: string;
  @ApiProperty({ type: [InvoiceLineDto] }) @IsArray() @ArrayMinSize(1) @ArrayMaxSize(500) @ValidateNested({ each: true }) @Type(() => InvoiceLineDto) lines: InvoiceLineDto[];
}

/** Đổi hàng: trả hàng + mua hàng mới trong một giao dịch; chênh lệch được khách trả thêm hoặc hoàn lại. */
export class ExchangeDto {
  @ApiProperty({ type: CreateSalesReturnDto }) @IsDefined() @IsNotEmptyObject() @ValidateNested() @Type(() => CreateSalesReturnDto) return: CreateSalesReturnDto;
  @ApiProperty({ type: ExchangeNewInvoiceDto }) @IsDefined() @IsNotEmptyObject() @ValidateNested() @Type(() => ExchangeNewInvoiceDto) newInvoice: ExchangeNewInvoiceDto;
  @ApiPropertyOptional({ type: [InvoicePaymentDto], description: 'Khách trả thêm phần chênh lệch (khi hàng mới đắt hơn)' }) @IsOptional() @IsArray() @ArrayMaxSize(5) @ValidateNested({ each: true }) @Type(() => InvoicePaymentDto) payments?: InvoicePaymentDto[];
  @ApiPropertyOptional({ type: RefundDto, description: 'Hoàn lại phần chênh lệch cho khách (khi hàng mới rẻ hơn)' }) @IsOptional() @ValidateNested() @Type(() => RefundDto) refund?: RefundDto;
}

export class SalesReturnQueryDto extends PaginationQueryDto {
  @ApiPropertyOptional({ enum: INVOICE_STATUSES }) @IsOptional() @IsIn(INVOICE_STATUSES as unknown as string[]) status?: string;
  @ApiPropertyOptional() @IsOptional() @IsUUID() branchId?: string;
  @ApiPropertyOptional() @IsOptional() @IsUUID() invoiceId?: string;
  @ApiPropertyOptional() @IsOptional() @IsUUID() customerId?: string;
  @ApiPropertyOptional() @IsOptional() @IsISO8601() from?: string;
  @ApiPropertyOptional() @IsOptional() @IsISO8601() to?: string;
}
