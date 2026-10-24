import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { Type } from 'class-transformer';
import { ArrayMaxSize, ArrayMinSize, IsArray, IsBoolean, IsEmail, IsIn, IsInt, IsISO8601, IsOptional, IsString, IsUUID, Matches, MaxLength, Min, MinLength, ValidateIf, ValidateNested } from 'class-validator';
import { INVOICE_STATUSES, CASH_PAYMENT_METHODS, SHIFT_STATUSES } from '@erp/shared';
import { PaginationQueryDto } from '../../../common/pagination';
import { IsDecimalStr, Trim, TrimToUndefined } from '../../../common/validators';

// ---------------- customers
export class CreateCustomerDto {
  @ApiPropertyOptional({ description: 'Bỏ trống để tự sinh (KH000001)' }) @IsOptional() @TrimToUndefined() @IsString() @Matches(/^[A-Za-z0-9._-]{1,50}$/) code?: string;
  @ApiProperty() @Trim() @IsString() @MinLength(1) @MaxLength(300) name: string;
  @ApiPropertyOptional() @IsOptional() @TrimToUndefined() @IsString() @MaxLength(30) phone?: string;
  @ApiPropertyOptional() @IsOptional() @TrimToUndefined() @IsEmail() email?: string;
  @ApiPropertyOptional() @IsOptional() @TrimToUndefined() @IsString() @MaxLength(500) address?: string;
  @ApiPropertyOptional({ enum: ['MALE', 'FEMALE', 'OTHER'] }) @IsOptional() @IsIn(['MALE', 'FEMALE', 'OTHER']) gender?: string;
  @ApiPropertyOptional() @IsOptional() @IsISO8601() birthday?: string;
  @ApiPropertyOptional() @IsOptional() @TrimToUndefined() @IsString() @MaxLength(50) taxCode?: string;
  @ApiPropertyOptional() @IsOptional() @TrimToUndefined() @IsString() @MaxLength(100) groupName?: string;
  @ApiPropertyOptional() @IsOptional() @TrimToUndefined() @IsString() @MaxLength(1000) note?: string;
  @ApiPropertyOptional({ description: 'Hạn mức nợ; bỏ trống = không giới hạn' }) @IsOptional() @IsDecimalStr({ min: 0 }) creditLimit?: string;
  @ApiPropertyOptional({ description: 'Công nợ đầu kỳ (dương = khách đang nợ)' }) @IsOptional() @IsDecimalStr() openingBalance?: string;
}
export class UpdateCustomerDto {
  @ApiPropertyOptional() @IsOptional() @Trim() @IsString() @MinLength(1) @MaxLength(300) name?: string;
  @ApiPropertyOptional() @IsOptional() @TrimToUndefined() @IsString() @MaxLength(30) phone?: string;
  @ApiPropertyOptional() @IsOptional() @TrimToUndefined() @IsEmail() email?: string;
  @ApiPropertyOptional() @IsOptional() @TrimToUndefined() @IsString() @MaxLength(500) address?: string;
  @ApiPropertyOptional({ enum: ['MALE', 'FEMALE', 'OTHER'] }) @IsOptional() @IsIn(['MALE', 'FEMALE', 'OTHER']) gender?: string;
  @ApiPropertyOptional() @IsOptional() @IsISO8601() birthday?: string;
  @ApiPropertyOptional() @IsOptional() @TrimToUndefined() @IsString() @MaxLength(50) taxCode?: string;
  @ApiPropertyOptional() @IsOptional() @TrimToUndefined() @IsString() @MaxLength(100) groupName?: string;
  @ApiPropertyOptional() @IsOptional() @TrimToUndefined() @IsString() @MaxLength(1000) note?: string;
  @ApiPropertyOptional({ nullable: true }) @IsOptional() @ValidateIf((_o, v) => v !== null) @IsDecimalStr({ min: 0 }) creditLimit?: string | null;
  @ApiPropertyOptional() @IsOptional() @IsBoolean() isActive?: boolean;
}
export class CustomerQueryDto extends PaginationQueryDto {
  @ApiPropertyOptional({ enum: ['true', 'false'] }) @IsOptional() @IsIn(['true', 'false']) isActive?: string;
  @ApiPropertyOptional({ enum: ['true', 'false'] }) @IsOptional() @IsIn(['true', 'false']) hasDebt?: string;
  @ApiPropertyOptional() @IsOptional() @TrimToUndefined() @IsString() @MaxLength(100) groupName?: string;
}

// ---------------- shifts
export class OpenShiftDto {
  @ApiProperty() @IsUUID() branchId: string;
  @ApiPropertyOptional({ default: '0' }) @IsOptional() @IsDecimalStr({ min: 0 }) openingCash?: string;
  @ApiPropertyOptional() @IsOptional() @TrimToUndefined() @IsString() @MaxLength(1000) note?: string;
}
export class CloseShiftDto {
  @ApiProperty() @IsDecimalStr({ min: 0 }) countedCash: string;
  @ApiPropertyOptional() @IsOptional() @TrimToUndefined() @IsString() @MaxLength(1000) note?: string;
  @ApiPropertyOptional({ description: 'Bàn giao ca: số tiền chuyển từ két chi nhánh sang quỹ đích' }) @IsOptional() @IsDecimalStr({ positive: true }) handoverAmount?: string;
  @ApiPropertyOptional({ description: 'Quỹ nhận bàn giao (két sắt / ngân hàng); bắt buộc khi có handoverAmount' }) @IsOptional() @IsUUID() handoverToAccountId?: string;
}
export class ShiftQueryDto extends PaginationQueryDto {
  @ApiPropertyOptional({ enum: SHIFT_STATUSES }) @IsOptional() @IsIn(SHIFT_STATUSES as unknown as string[]) status?: string;
  @ApiPropertyOptional() @IsOptional() @IsUUID() branchId?: string;
  @ApiPropertyOptional() @IsOptional() @IsUUID() userId?: string;
  @ApiPropertyOptional() @IsOptional() @IsISO8601() from?: string;
  @ApiPropertyOptional() @IsOptional() @IsISO8601() to?: string;
}

// ---------------- invoices
export class InvoiceLineDto {
  @ApiProperty() @IsUUID() variantId: string;
  @ApiPropertyOptional() @IsOptional() @IsUUID() batchId?: string;
  @ApiPropertyOptional({ description: 'Bán theo đơn vị quy đổi (product_units.id); bỏ trống = đơn vị cơ bản' }) @IsOptional() @IsUUID() productUnitId?: string;
  @ApiProperty() @IsDecimalStr({ positive: true }) quantity: string;
  @ApiPropertyOptional({ description: 'Giá bán / đơn vị; bỏ trống = giá niêm yết (bảng giá hoặc giá hàng hóa); khác giá niêm yết cần quyền invoice.price.edit' }) @IsOptional() @IsDecimalStr({ min: 0 }) unitPrice?: string;
  @ApiPropertyOptional({ description: 'Giảm giá dòng (số tiền)' }) @IsOptional() @IsDecimalStr({ min: 0 }) discountAmount?: string;
  @ApiPropertyOptional({ description: 'Dòng hàng tặng của một khuyến mãi (giá 0, cần promotionId)' }) @IsOptional() @IsBoolean() isGift?: boolean;
  @ApiPropertyOptional({ description: 'Khuyến mãi tặng dòng này' }) @IsOptional() @IsUUID() promotionId?: string;
  @ApiPropertyOptional() @IsOptional() @TrimToUndefined() @IsString() @MaxLength(500) note?: string;
}
export class InvoicePaymentDto {
  @ApiProperty({ enum: CASH_PAYMENT_METHODS }) @IsIn(CASH_PAYMENT_METHODS as unknown as string[]) method: string;
  @ApiProperty() @IsDecimalStr({ positive: true }) amount: string;
  @ApiPropertyOptional() @IsOptional() @TrimToUndefined() @IsString() @MaxLength(200) reference?: string;
  @ApiPropertyOptional({ description: 'Quỹ nhận tiền (bỏ trống = quỹ mặc định theo phương thức)' }) @IsOptional() @IsUUID() cashAccountId?: string;
}
export class CreateInvoiceDto {
  @ApiProperty() @IsUUID() branchId: string;
  @ApiProperty() @IsUUID() warehouseId: string;
  @ApiPropertyOptional() @IsOptional() @IsUUID() customerId?: string;
  @ApiPropertyOptional({ description: 'Nhân viên bán; bỏ trống = người đăng nhập' }) @IsOptional() @IsUUID() sellerId?: string;
  @ApiPropertyOptional() @IsOptional() @IsUUID() priceBookId?: string;
  @ApiPropertyOptional() @IsOptional() @IsISO8601() invoiceDate?: string;
  @ApiPropertyOptional({ description: 'Giảm giá toàn hóa đơn (số tiền)' }) @IsOptional() @IsDecimalStr({ min: 0 }) discountAmount?: string;
  @ApiPropertyOptional({ description: 'Mã voucher áp dụng' }) @IsOptional() @TrimToUndefined() @IsString() @MaxLength(50) voucherCode?: string;
  @ApiPropertyOptional({ type: [String], description: 'Khuyến mãi tự động mà thu ngân bỏ qua' }) @IsOptional() @IsArray() @ArrayMaxSize(50) @IsUUID('4', { each: true }) excludePromotionIds?: string[];
  @ApiPropertyOptional({ default: true, description: 'false = không áp dụng khuyến mãi tự động' }) @IsOptional() @IsBoolean() applyPromotions?: boolean;
  @ApiPropertyOptional({ description: 'Số điểm khách dùng để thanh toán (cần khách hàng và tích điểm bật)' }) @IsOptional() @IsDecimalStr({ min: 0 }) redeemPoints?: string;
  @ApiPropertyOptional() @IsOptional() @TrimToUndefined() @IsString() @MaxLength(1000) note?: string;
  @ApiProperty({ type: [InvoiceLineDto] }) @IsArray() @ArrayMinSize(1) @ArrayMaxSize(500) @ValidateNested({ each: true }) @Type(() => InvoiceLineDto) lines: InvoiceLineDto[];
  @ApiPropertyOptional({ type: [InvoicePaymentDto], description: 'Thanh toán (nhiều phương thức); chỉ dùng với checkout / complete' }) @IsOptional() @IsArray() @ArrayMaxSize(5) @ValidateNested({ each: true }) @Type(() => InvoicePaymentDto) payments?: InvoicePaymentDto[];
}
export class UpdateInvoiceDto {
  @ApiProperty() @Type(() => Number) @IsInt() @Min(1) version: number;
  @ApiPropertyOptional({ description: 'Mã voucher (null = bỏ voucher)' }) @IsOptional() @ValidateIf((_, v) => v !== null) @IsString() @MaxLength(50) voucherCode?: string | null;
  @ApiPropertyOptional({ type: [String] }) @IsOptional() @IsArray() @ArrayMaxSize(50) @IsUUID('4', { each: true }) excludePromotionIds?: string[];
  @ApiPropertyOptional() @IsOptional() @IsBoolean() applyPromotions?: boolean;
  @ApiPropertyOptional({ description: 'Số điểm dùng (0 = bỏ dùng điểm)' }) @IsOptional() @IsDecimalStr({ min: 0 }) redeemPoints?: string;
  @ApiPropertyOptional() @IsOptional() @IsUUID() warehouseId?: string;
  @ApiPropertyOptional({ nullable: true }) @IsOptional() @ValidateIf((_o, v) => v !== null) @IsUUID() customerId?: string | null;
  @ApiPropertyOptional() @IsOptional() @IsUUID() sellerId?: string;
  @ApiPropertyOptional({ nullable: true }) @IsOptional() @ValidateIf((_o, v) => v !== null) @IsUUID() priceBookId?: string | null;
  @ApiPropertyOptional() @IsOptional() @IsDecimalStr({ min: 0 }) discountAmount?: string;
  @ApiPropertyOptional() @IsOptional() @TrimToUndefined() @IsString() @MaxLength(1000) note?: string;
  @ApiPropertyOptional({ type: [InvoiceLineDto] }) @IsOptional() @IsArray() @ArrayMinSize(1) @ArrayMaxSize(500) @ValidateNested({ each: true }) @Type(() => InvoiceLineDto) lines?: InvoiceLineDto[];
}
export class CompleteInvoiceDto {
  @ApiPropertyOptional({ description: 'Optimistic lock: phiên bản đơn đang giữ mà client đang hiển thị' }) @IsOptional() @Type(() => Number) @IsInt() @Min(1) version?: number;
  @ApiPropertyOptional({ type: [InvoicePaymentDto] }) @IsOptional() @IsArray() @ArrayMaxSize(5) @ValidateNested({ each: true }) @Type(() => InvoicePaymentDto) payments?: InvoicePaymentDto[];
}
export class CancelInvoiceDto {
  @ApiProperty() @Trim() @IsString() @MinLength(1) @MaxLength(500) reason: string;
}
export class InvoiceQueryDto extends PaginationQueryDto {
  @ApiPropertyOptional({ enum: INVOICE_STATUSES }) @IsOptional() @IsIn(INVOICE_STATUSES as unknown as string[]) status?: string;
  @ApiPropertyOptional() @IsOptional() @IsUUID() branchId?: string;
  @ApiPropertyOptional() @IsOptional() @IsUUID() warehouseId?: string;
  @ApiPropertyOptional() @IsOptional() @IsUUID() customerId?: string;
  @ApiPropertyOptional() @IsOptional() @IsUUID() sellerId?: string;
  @ApiPropertyOptional() @IsOptional() @IsUUID() shiftId?: string;
  @ApiPropertyOptional({ enum: ['true', 'false'], description: 'Chỉ hóa đơn còn nợ' }) @IsOptional() @IsIn(['true', 'false']) unpaid?: string;
  @ApiPropertyOptional() @IsOptional() @IsISO8601() from?: string;
  @ApiPropertyOptional() @IsOptional() @IsISO8601() to?: string;
}
export class PosPriceQueryDto {
  @ApiProperty() @IsUUID() variantId: string;
  @ApiPropertyOptional() @IsOptional() @IsUUID() priceBookId?: string;
  @ApiPropertyOptional() @IsOptional() @IsUUID() productUnitId?: string;
  @ApiPropertyOptional({ default: '1' }) @IsOptional() @IsDecimalStr({ positive: true }) quantity?: string;
}

// ---------------- reports
export class SalesReportQueryDto {
  @ApiPropertyOptional() @IsOptional() @IsISO8601() from?: string;
  @ApiPropertyOptional() @IsOptional() @IsISO8601() to?: string;
  @ApiPropertyOptional() @IsOptional() @IsUUID() branchId?: string;
  @ApiPropertyOptional() @IsOptional() @IsUUID() sellerId?: string;
  @ApiPropertyOptional({ enum: ['day', 'month'], default: 'day' }) @IsOptional() @IsIn(['day', 'month']) groupBy?: 'day' | 'month';
}
