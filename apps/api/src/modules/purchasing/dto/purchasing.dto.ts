import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { Type } from 'class-transformer';
import { ArrayMaxSize, ArrayMinSize, IsArray, IsBoolean, IsEmail, IsIn, IsInt, IsISO8601, IsOptional, IsString, IsUUID, Matches, MaxLength, Min, MinLength, ValidateNested } from 'class-validator';
import { COST_ALLOCATION_METHODS, CASH_PAYMENT_METHODS, PURCHASE_DOC_STATUSES, PURCHASE_ORDER_STATUSES } from '@erp/shared';
import { PaginationQueryDto } from '../../../common/pagination';
import { IsDecimalStr, Trim, TrimToUndefined } from '../../../common/validators';

// ---------------- suppliers
export class CreateSupplierDto {
  @ApiPropertyOptional({ description: 'Bỏ trống để tự sinh (NCC000001)' }) @IsOptional() @TrimToUndefined() @IsString() @Matches(/^[A-Za-z0-9._-]{1,50}$/) code?: string;
  @ApiProperty() @Trim() @IsString() @MinLength(1) @MaxLength(300) name: string;
  @ApiPropertyOptional() @IsOptional() @TrimToUndefined() @IsString() @MaxLength(30) phone?: string;
  @ApiPropertyOptional() @IsOptional() @TrimToUndefined() @IsEmail() email?: string;
  @ApiPropertyOptional() @IsOptional() @TrimToUndefined() @IsString() @MaxLength(500) address?: string;
  @ApiPropertyOptional() @IsOptional() @TrimToUndefined() @IsString() @MaxLength(50) taxCode?: string;
  @ApiPropertyOptional() @IsOptional() @TrimToUndefined() @IsString() @MaxLength(200) contactName?: string;
  @ApiPropertyOptional() @IsOptional() @TrimToUndefined() @IsString() @MaxLength(100) groupName?: string;
  @ApiPropertyOptional() @IsOptional() @TrimToUndefined() @IsString() @MaxLength(1000) note?: string;
  @ApiPropertyOptional({ description: 'Công nợ đầu kỳ (dương = đang nợ NCC)' }) @IsOptional() @IsDecimalStr() openingBalance?: string;
}
export class UpdateSupplierDto {
  @ApiPropertyOptional() @IsOptional() @Trim() @IsString() @MinLength(1) @MaxLength(300) name?: string;
  @ApiPropertyOptional() @IsOptional() @TrimToUndefined() @IsString() @MaxLength(30) phone?: string;
  @ApiPropertyOptional() @IsOptional() @TrimToUndefined() @IsEmail() email?: string;
  @ApiPropertyOptional() @IsOptional() @TrimToUndefined() @IsString() @MaxLength(500) address?: string;
  @ApiPropertyOptional() @IsOptional() @TrimToUndefined() @IsString() @MaxLength(50) taxCode?: string;
  @ApiPropertyOptional() @IsOptional() @TrimToUndefined() @IsString() @MaxLength(200) contactName?: string;
  @ApiPropertyOptional() @IsOptional() @TrimToUndefined() @IsString() @MaxLength(100) groupName?: string;
  @ApiPropertyOptional() @IsOptional() @TrimToUndefined() @IsString() @MaxLength(1000) note?: string;
  @ApiPropertyOptional() @IsOptional() @IsBoolean() isActive?: boolean;
}
export class SupplierQueryDto extends PaginationQueryDto {
  @ApiPropertyOptional({ enum: ['true', 'false'] }) @IsOptional() @IsIn(['true', 'false']) isActive?: string;
  @ApiPropertyOptional({ enum: ['true'], description: 'Chỉ NCC đang có công nợ' }) @IsOptional() @IsIn(['true', 'false']) hasDebt?: string;
  @ApiPropertyOptional() @IsOptional() @TrimToUndefined() @IsString() @MaxLength(100) groupName?: string;
}

// ---------------- purchase orders
export class OrderLineDto {
  @ApiProperty() @IsUUID() variantId: string;
  @ApiProperty() @IsDecimalStr({ positive: true }) quantity: string;
  @ApiProperty() @IsDecimalStr({ min: 0 }) unitPrice: string;
  @ApiPropertyOptional({ description: 'Chiết khấu dòng (số tiền)' }) @IsOptional() @IsDecimalStr({ min: 0 }) discountAmount?: string;
  @ApiPropertyOptional() @IsOptional() @IsDecimalStr({ min: 0, max: 100 }) taxRate?: string;
  @ApiPropertyOptional() @IsOptional() @TrimToUndefined() @IsString() @MaxLength(500) note?: string;
}
export class CreateOrderDto {
  @ApiProperty() @IsUUID() branchId: string;
  @ApiProperty() @IsUUID() warehouseId: string;
  @ApiProperty() @IsUUID() supplierId: string;
  @ApiPropertyOptional() @IsOptional() @IsISO8601() orderDate?: string;
  @ApiPropertyOptional() @IsOptional() @IsISO8601() expectedDate?: string;
  @ApiPropertyOptional() @IsOptional() @IsDecimalStr({ min: 0 }) discountAmount?: string;
  @ApiPropertyOptional() @IsOptional() @TrimToUndefined() @IsString() @MaxLength(1000) note?: string;
  @ApiProperty({ type: [OrderLineDto] }) @IsArray() @ArrayMinSize(1) @ArrayMaxSize(500) @ValidateNested({ each: true }) @Type(() => OrderLineDto) lines: OrderLineDto[];
}
export class UpdateOrderDto {
  @ApiProperty() @Type(() => Number) @IsInt() @Min(1) version: number;
  @ApiPropertyOptional() @IsOptional() @IsUUID() warehouseId?: string;
  @ApiPropertyOptional() @IsOptional() @IsUUID() supplierId?: string;
  @ApiPropertyOptional() @IsOptional() @IsISO8601() expectedDate?: string;
  @ApiPropertyOptional() @IsOptional() @IsDecimalStr({ min: 0 }) discountAmount?: string;
  @ApiPropertyOptional() @IsOptional() @TrimToUndefined() @IsString() @MaxLength(1000) note?: string;
  @ApiPropertyOptional({ type: [OrderLineDto] }) @IsOptional() @IsArray() @ArrayMinSize(1) @ArrayMaxSize(500) @ValidateNested({ each: true }) @Type(() => OrderLineDto) lines?: OrderLineDto[];
}
export class OrderQueryDto extends PaginationQueryDto {
  @ApiPropertyOptional({ enum: PURCHASE_ORDER_STATUSES }) @IsOptional() @IsIn(PURCHASE_ORDER_STATUSES as unknown as string[]) status?: string;
  @ApiPropertyOptional() @IsOptional() @IsUUID() supplierId?: string;
  @ApiPropertyOptional() @IsOptional() @IsUUID() branchId?: string;
  @ApiPropertyOptional() @IsOptional() @IsUUID() warehouseId?: string;
  @ApiPropertyOptional() @IsOptional() @IsISO8601() from?: string;
  @ApiPropertyOptional() @IsOptional() @IsISO8601() to?: string;
}

// ---------------- purchase receipts
export class ReceiptLineDto {
  @ApiProperty() @IsUUID() variantId: string;
  @ApiPropertyOptional() @IsOptional() @IsUUID() batchId?: string;
  @ApiPropertyOptional({ description: 'Dòng đơn đặt hàng được nhập (khi nhập từ PDN)' }) @IsOptional() @IsUUID() orderLineId?: string;
  @ApiProperty() @IsDecimalStr({ positive: true }) quantity: string;
  @ApiProperty() @IsDecimalStr({ min: 0 }) unitPrice: string;
  @ApiPropertyOptional() @IsOptional() @IsDecimalStr({ min: 0 }) discountAmount?: string;
  @ApiPropertyOptional() @IsOptional() @IsDecimalStr({ min: 0, max: 100 }) taxRate?: string;
  @ApiPropertyOptional() @IsOptional() @TrimToUndefined() @IsString() @MaxLength(500) note?: string;
}
export class ReceiptCostDto {
  @ApiProperty({ example: 'Vận chuyển' }) @Trim() @IsString() @MinLength(1) @MaxLength(200) name: string;
  @ApiProperty() @IsDecimalStr({ min: 0 }) amount: string;
  @ApiPropertyOptional({ enum: COST_ALLOCATION_METHODS, default: 'BY_VALUE' }) @IsOptional() @IsIn(COST_ALLOCATION_METHODS as unknown as string[]) allocationMethod?: 'BY_VALUE' | 'BY_QUANTITY';
  @ApiPropertyOptional({ default: true, description: 'true = trả cho NCC (cộng vào công nợ), false = trả bên thứ ba' }) @IsOptional() @IsBoolean() payToSupplier?: boolean;
}
export class ImmediatePaymentDto {
  @ApiProperty() @IsDecimalStr({ positive: true }) amount: string;
  @ApiPropertyOptional({ enum: CASH_PAYMENT_METHODS, default: 'CASH' }) @IsOptional() @IsIn(CASH_PAYMENT_METHODS as unknown as string[]) method?: string;
  @ApiPropertyOptional() @IsOptional() @TrimToUndefined() @IsString() @MaxLength(200) reference?: string;
}
export class CreateReceiptDto {
  @ApiProperty() @IsUUID() branchId: string;
  @ApiProperty() @IsUUID() warehouseId: string;
  @ApiProperty() @IsUUID() supplierId: string;
  @ApiPropertyOptional({ description: 'Nhập từ đơn đặt hàng' }) @IsOptional() @IsUUID() orderId?: string;
  @ApiPropertyOptional() @IsOptional() @IsISO8601() receiptDate?: string;
  @ApiPropertyOptional() @IsOptional() @TrimToUndefined() @IsString() @MaxLength(100) supplierInvoiceNo?: string;
  @ApiPropertyOptional({ description: 'Chiết khấu toàn phiếu (số tiền)' }) @IsOptional() @IsDecimalStr({ min: 0 }) discountAmount?: string;
  @ApiPropertyOptional() @IsOptional() @TrimToUndefined() @IsString() @MaxLength(1000) note?: string;
  @ApiProperty({ type: [ReceiptLineDto] }) @IsArray() @ArrayMinSize(1) @ArrayMaxSize(500) @ValidateNested({ each: true }) @Type(() => ReceiptLineDto) lines: ReceiptLineDto[];
  @ApiPropertyOptional({ type: [ReceiptCostDto] }) @IsOptional() @IsArray() @ArrayMaxSize(20) @ValidateNested({ each: true }) @Type(() => ReceiptCostDto) costs?: ReceiptCostDto[];
  @ApiPropertyOptional({ type: ImmediatePaymentDto, description: 'Thanh toán ngay khi hoàn thành (chỉ dùng với post-now)' }) @IsOptional() @ValidateNested() @Type(() => ImmediatePaymentDto) payment?: ImmediatePaymentDto;
}
export class UpdateReceiptDto {
  @ApiProperty() @Type(() => Number) @IsInt() @Min(1) version: number;
  @ApiPropertyOptional() @IsOptional() @IsUUID() warehouseId?: string;
  @ApiPropertyOptional() @IsOptional() @IsUUID() supplierId?: string;
  @ApiPropertyOptional() @IsOptional() @IsISO8601() receiptDate?: string;
  @ApiPropertyOptional() @IsOptional() @TrimToUndefined() @IsString() @MaxLength(100) supplierInvoiceNo?: string;
  @ApiPropertyOptional() @IsOptional() @IsDecimalStr({ min: 0 }) discountAmount?: string;
  @ApiPropertyOptional() @IsOptional() @TrimToUndefined() @IsString() @MaxLength(1000) note?: string;
  @ApiPropertyOptional({ type: [ReceiptLineDto] }) @IsOptional() @IsArray() @ArrayMinSize(1) @ArrayMaxSize(500) @ValidateNested({ each: true }) @Type(() => ReceiptLineDto) lines?: ReceiptLineDto[];
  @ApiPropertyOptional({ type: [ReceiptCostDto] }) @IsOptional() @IsArray() @ArrayMaxSize(20) @ValidateNested({ each: true }) @Type(() => ReceiptCostDto) costs?: ReceiptCostDto[];
}
export class PostReceiptDto {
  @ApiPropertyOptional({ type: ImmediatePaymentDto }) @IsOptional() @ValidateNested() @Type(() => ImmediatePaymentDto) payment?: ImmediatePaymentDto;
}
export class ReceiptQueryDto extends PaginationQueryDto {
  @ApiPropertyOptional({ enum: PURCHASE_DOC_STATUSES }) @IsOptional() @IsIn(PURCHASE_DOC_STATUSES as unknown as string[]) status?: string;
  @ApiPropertyOptional() @IsOptional() @IsUUID() supplierId?: string;
  @ApiPropertyOptional() @IsOptional() @IsUUID() branchId?: string;
  @ApiPropertyOptional() @IsOptional() @IsUUID() warehouseId?: string;
  @ApiPropertyOptional() @IsOptional() @IsUUID() orderId?: string;
  @ApiPropertyOptional({ enum: ['true'], description: 'Chỉ phiếu còn nợ' }) @IsOptional() @IsIn(['true', 'false']) unpaid?: string;
  @ApiPropertyOptional() @IsOptional() @IsISO8601() from?: string;
  @ApiPropertyOptional() @IsOptional() @IsISO8601() to?: string;
}
export class CancelDto {
  @ApiProperty() @Trim() @IsString() @MinLength(1) @MaxLength(500) reason: string;
}

// ---------------- purchase returns
export class ReturnLineDto {
  @ApiProperty() @IsUUID() receiptLineId: string;
  @ApiProperty() @IsDecimalStr({ positive: true }) quantity: string;
  @ApiPropertyOptional({ description: 'Đơn giá trả; bỏ trống = giá nhập ròng của dòng' }) @IsOptional() @IsDecimalStr({ min: 0 }) unitPrice?: string;
  @ApiPropertyOptional() @IsOptional() @TrimToUndefined() @IsString() @MaxLength(500) note?: string;
}
export class CreateReturnDto {
  @ApiProperty() @IsUUID() receiptId: string;
  @ApiPropertyOptional() @IsOptional() @IsISO8601() returnDate?: string;
  @ApiPropertyOptional() @IsOptional() @TrimToUndefined() @IsString() @MaxLength(200) reason?: string;
  @ApiPropertyOptional() @IsOptional() @TrimToUndefined() @IsString() @MaxLength(1000) note?: string;
  @ApiProperty({ type: [ReturnLineDto] }) @IsArray() @ArrayMinSize(1) @ArrayMaxSize(500) @ValidateNested({ each: true }) @Type(() => ReturnLineDto) lines: ReturnLineDto[];
  @ApiPropertyOptional({ type: ImmediatePaymentDto, description: 'NCC hoàn tiền ngay (chỉ dùng với post-now)' }) @IsOptional() @ValidateNested() @Type(() => ImmediatePaymentDto) refund?: ImmediatePaymentDto;
}
export class UpdateReturnDto {
  @ApiProperty() @Type(() => Number) @IsInt() @Min(1) version: number;
  @ApiPropertyOptional() @IsOptional() @IsISO8601() returnDate?: string;
  @ApiPropertyOptional() @IsOptional() @TrimToUndefined() @IsString() @MaxLength(200) reason?: string;
  @ApiPropertyOptional() @IsOptional() @TrimToUndefined() @IsString() @MaxLength(1000) note?: string;
  @ApiPropertyOptional({ type: [ReturnLineDto] }) @IsOptional() @IsArray() @ArrayMinSize(1) @ArrayMaxSize(500) @ValidateNested({ each: true }) @Type(() => ReturnLineDto) lines?: ReturnLineDto[];
}
export class PostReturnDto {
  @ApiPropertyOptional({ type: ImmediatePaymentDto }) @IsOptional() @ValidateNested() @Type(() => ImmediatePaymentDto) refund?: ImmediatePaymentDto;
}
export class ReturnQueryDto extends PaginationQueryDto {
  @ApiPropertyOptional({ enum: PURCHASE_DOC_STATUSES }) @IsOptional() @IsIn(PURCHASE_DOC_STATUSES as unknown as string[]) status?: string;
  @ApiPropertyOptional() @IsOptional() @IsUUID() supplierId?: string;
  @ApiPropertyOptional() @IsOptional() @IsUUID() receiptId?: string;
  @ApiPropertyOptional() @IsOptional() @IsUUID() branchId?: string;
  @ApiPropertyOptional() @IsOptional() @IsISO8601() from?: string;
  @ApiPropertyOptional() @IsOptional() @IsISO8601() to?: string;
}

// ---------------- reports
export class PurchaseReportQueryDto {
  @ApiPropertyOptional() @IsOptional() @IsISO8601() from?: string;
  @ApiPropertyOptional() @IsOptional() @IsISO8601() to?: string;
  @ApiPropertyOptional() @IsOptional() @IsUUID() supplierId?: string;
  @ApiPropertyOptional() @IsOptional() @IsUUID() branchId?: string;
  @ApiPropertyOptional({ enum: ['day', 'month'], default: 'day' }) @IsOptional() @IsIn(['day', 'month']) groupBy?: 'day' | 'month';
}
