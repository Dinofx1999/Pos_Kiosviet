import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { Type } from 'class-transformer';
import { ArrayMaxSize, ArrayMinSize, IsArray, IsBoolean, IsIn, IsInt, IsISO8601, IsOptional, IsString, IsUUID, Matches, MaxLength, Min, MinLength, ValidateIf, ValidateNested } from 'class-validator';
import { CASH_PAYMENT_METHODS, DELIVERY_STATUSES, SALES_ORDER_STATUSES } from '@erp/shared';
import { PaginationQueryDto } from '../../../common/pagination';
import { IsDecimalStr, Trim, TrimToUndefined } from '../../../common/validators';
import { InvoiceLineDto, InvoicePaymentDto } from './sales.dto';

// ------------------------------------------------------------------ đơn đặt hàng
export class DeliveryInfoDto {
  @ApiProperty() @Trim() @IsString() @MinLength(1) @MaxLength(200) receiverName: string;
  @ApiPropertyOptional() @IsOptional() @TrimToUndefined() @Matches(/^[0-9+().\s-]{6,30}$/) receiverPhone?: string;
  @ApiProperty() @Trim() @IsString() @MinLength(1) @MaxLength(500) address: string;
  @ApiPropertyOptional() @IsOptional() @TrimToUndefined() @IsString() @MaxLength(100) ward?: string;
  @ApiPropertyOptional() @IsOptional() @TrimToUndefined() @IsString() @MaxLength(100) district?: string;
  @ApiPropertyOptional() @IsOptional() @TrimToUndefined() @IsString() @MaxLength(100) province?: string;
  @ApiPropertyOptional({ example: 'GHTK' }) @IsOptional() @TrimToUndefined() @IsString() @MaxLength(100) carrier?: string;
  @ApiPropertyOptional() @IsOptional() @TrimToUndefined() @IsString() @MaxLength(100) trackingCode?: string;
  @ApiPropertyOptional({ description: 'Phí giao hàng thu của khách' }) @IsOptional() @IsDecimalStr({ min: 0 }) shippingFee?: string;
  @ApiPropertyOptional({ description: 'Chi phí trả đơn vị vận chuyển' }) @IsOptional() @IsDecimalStr({ min: 0 }) shippingCost?: string;
  @ApiPropertyOptional({ description: 'Tiền thu hộ (COD); bỏ trống = còn phải thu + phí' }) @IsOptional() @IsDecimalStr({ min: 0 }) codAmount?: string;
  @ApiPropertyOptional() @IsOptional() @IsInt() @Min(0) weightGram?: number;
  @ApiPropertyOptional() @IsOptional() @IsISO8601() expectedAt?: string;
  @ApiPropertyOptional() @IsOptional() @TrimToUndefined() @IsString() @MaxLength(1000) note?: string;
}
export class CreateSalesOrderDto {
  @ApiProperty() @IsUUID() branchId: string;
  @ApiProperty() @IsUUID() warehouseId: string;
  @ApiPropertyOptional() @IsOptional() @IsUUID() customerId?: string;
  @ApiPropertyOptional() @IsOptional() @IsUUID() sellerId?: string;
  @ApiPropertyOptional() @IsOptional() @IsUUID() priceBookId?: string;
  @ApiPropertyOptional({ enum: ['POS', 'PHONE', 'ONLINE', 'FACEBOOK', 'ZALO', 'SHOPEE', 'OTHER'], default: 'POS' }) @IsOptional() @IsIn(['POS', 'PHONE', 'ONLINE', 'FACEBOOK', 'ZALO', 'SHOPEE', 'OTHER']) source?: string;
  @ApiPropertyOptional() @IsOptional() @IsISO8601() orderDate?: string;
  @ApiPropertyOptional({ description: 'Ngày hẹn giao / lấy hàng' }) @IsOptional() @IsISO8601() expectedAt?: string;
  @ApiPropertyOptional() @IsOptional() @IsDecimalStr({ min: 0 }) discountAmount?: string;
  @ApiPropertyOptional() @IsOptional() @TrimToUndefined() @IsString() @MaxLength(1000) note?: string;
  @ApiProperty({ type: [InvoiceLineDto] }) @IsArray() @ArrayMinSize(1) @ArrayMaxSize(500) @ValidateNested({ each: true }) @Type(() => InvoiceLineDto) lines: InvoiceLineDto[];
  @ApiPropertyOptional({ default: true, description: 'Xác nhận ngay (giữ tồn kho)' }) @IsOptional() @IsBoolean() confirm?: boolean;
  @ApiPropertyOptional({ type: [InvoicePaymentDto], description: 'Tiền cọc thu ngay' }) @IsOptional() @IsArray() @ArrayMaxSize(5) @ValidateNested({ each: true }) @Type(() => InvoicePaymentDto) deposits?: InvoicePaymentDto[];
  @ApiPropertyOptional({ type: DeliveryInfoDto }) @IsOptional() @ValidateNested() @Type(() => DeliveryInfoDto) delivery?: DeliveryInfoDto;
}
export class UpdateSalesOrderDto {
  @ApiProperty() @Type(() => Number) @IsInt() @Min(1) version: number;
  @ApiPropertyOptional() @IsOptional() @IsUUID() warehouseId?: string;
  @ApiPropertyOptional({ nullable: true }) @IsOptional() @ValidateIf((_o, v) => v !== null) @IsUUID() customerId?: string | null;
  @ApiPropertyOptional() @IsOptional() @IsUUID() sellerId?: string;
  @ApiPropertyOptional({ nullable: true }) @IsOptional() @ValidateIf((_o, v) => v !== null) @IsUUID() priceBookId?: string | null;
  @ApiPropertyOptional() @IsOptional() @IsISO8601() expectedAt?: string | null;
  @ApiPropertyOptional() @IsOptional() @IsDecimalStr({ min: 0 }) discountAmount?: string;
  @ApiPropertyOptional() @IsOptional() @TrimToUndefined() @IsString() @MaxLength(1000) note?: string;
  @ApiPropertyOptional({ type: [InvoiceLineDto], description: 'Chỉ đổi được dòng khi đơn còn là phiếu tạm' }) @IsOptional() @IsArray() @ArrayMinSize(1) @ArrayMaxSize(500) @ValidateNested({ each: true }) @Type(() => InvoiceLineDto) lines?: InvoiceLineDto[];
}
export class DepositDto {
  @ApiProperty({ enum: CASH_PAYMENT_METHODS }) @IsIn(CASH_PAYMENT_METHODS as unknown as string[]) method: string;
  @ApiProperty() @IsDecimalStr({ positive: true }) amount: string;
  @ApiPropertyOptional() @IsOptional() @IsUUID() cashAccountId?: string;
  @ApiPropertyOptional() @IsOptional() @TrimToUndefined() @IsString() @MaxLength(200) reference?: string;
  @ApiPropertyOptional() @IsOptional() @TrimToUndefined() @IsString() @MaxLength(1000) note?: string;
}
export class ConfirmOrderDto {
  @ApiPropertyOptional() @IsOptional() @Type(() => Number) @IsInt() @Min(1) version?: number;
}
export class CompleteOrderDto {
  @ApiPropertyOptional() @IsOptional() @Type(() => Number) @IsInt() @Min(1) version?: number;
  @ApiPropertyOptional({ type: [InvoicePaymentDto], description: 'Thanh toán phần còn lại (ngoài tiền cọc)' }) @IsOptional() @IsArray() @ArrayMaxSize(5) @ValidateNested({ each: true }) @Type(() => InvoicePaymentDto) payments?: InvoicePaymentDto[];
  @ApiPropertyOptional({ description: 'Kho xuất (mặc định kho của đơn)' }) @IsOptional() @IsUUID() warehouseId?: string;
}
export class CancelOrderDto {
  @ApiProperty() @Trim() @IsString() @MinLength(1) @MaxLength(500) reason: string;
  @ApiPropertyOptional({ enum: ['REFUND', 'CREDIT'], default: 'REFUND', description: 'Tiền cọc: hoàn lại (hủy phiếu thu) hay giữ làm số dư có của khách' }) @IsOptional() @IsIn(['REFUND', 'CREDIT']) depositAction?: 'REFUND' | 'CREDIT';
}
export class SalesOrderQueryDto extends PaginationQueryDto {
  @ApiPropertyOptional({ enum: SALES_ORDER_STATUSES }) @IsOptional() @IsIn(SALES_ORDER_STATUSES as unknown as string[]) status?: string;
  @ApiPropertyOptional() @IsOptional() @IsUUID() branchId?: string;
  @ApiPropertyOptional() @IsOptional() @IsUUID() customerId?: string;
  @ApiPropertyOptional() @IsOptional() @IsString() @MaxLength(30) source?: string;
  @ApiPropertyOptional({ description: 'true = còn tiền chưa cọc/thanh toán' }) @IsOptional() @IsIn(['true', 'false']) unpaid?: string;
  @ApiPropertyOptional() @IsOptional() @IsISO8601() from?: string;
  @ApiPropertyOptional() @IsOptional() @IsISO8601() to?: string;
}

// ------------------------------------------------------------------ vận đơn
export class CreateDeliveryDto extends DeliveryInfoDto {
  @ApiPropertyOptional({ description: 'Gắn với đơn đặt hàng' }) @IsOptional() @IsUUID() orderId?: string;
  @ApiPropertyOptional({ description: 'Gắn với hóa đơn' }) @IsOptional() @IsUUID() invoiceId?: string;
  @ApiPropertyOptional({ description: 'Chi nhánh (mặc định theo chứng từ)' }) @IsOptional() @IsUUID() branchId?: string;
}
export class UpdateDeliveryDto {
  @ApiPropertyOptional() @IsOptional() @Trim() @IsString() @MinLength(1) @MaxLength(200) receiverName?: string;
  @ApiPropertyOptional() @IsOptional() @TrimToUndefined() @Matches(/^[0-9+().\s-]{6,30}$/) receiverPhone?: string;
  @ApiPropertyOptional() @IsOptional() @Trim() @IsString() @MinLength(1) @MaxLength(500) address?: string;
  @ApiPropertyOptional() @IsOptional() @TrimToUndefined() @IsString() @MaxLength(100) ward?: string;
  @ApiPropertyOptional() @IsOptional() @TrimToUndefined() @IsString() @MaxLength(100) district?: string;
  @ApiPropertyOptional() @IsOptional() @TrimToUndefined() @IsString() @MaxLength(100) province?: string;
  @ApiPropertyOptional() @IsOptional() @TrimToUndefined() @IsString() @MaxLength(100) carrier?: string;
  @ApiPropertyOptional() @IsOptional() @TrimToUndefined() @IsString() @MaxLength(100) trackingCode?: string;
  @ApiPropertyOptional() @IsOptional() @IsDecimalStr({ min: 0 }) shippingFee?: string;
  @ApiPropertyOptional() @IsOptional() @IsDecimalStr({ min: 0 }) shippingCost?: string;
  @ApiPropertyOptional() @IsOptional() @IsDecimalStr({ min: 0 }) codAmount?: string;
  @ApiPropertyOptional() @IsOptional() @IsInt() @Min(0) weightGram?: number;
  @ApiPropertyOptional() @IsOptional() @IsISO8601() expectedAt?: string | null;
  @ApiPropertyOptional() @IsOptional() @TrimToUndefined() @IsString() @MaxLength(1000) note?: string;
}
export class CodCollectionDto {
  @ApiProperty({ enum: CASH_PAYMENT_METHODS }) @IsIn(CASH_PAYMENT_METHODS as unknown as string[]) method: string;
  @ApiPropertyOptional({ description: 'Số tiền thực thu; mặc định = codAmount' }) @IsOptional() @IsDecimalStr({ min: 0 }) amount?: string;
  @ApiPropertyOptional() @IsOptional() @IsUUID() cashAccountId?: string;
  @ApiPropertyOptional() @IsOptional() @TrimToUndefined() @IsString() @MaxLength(200) reference?: string;
}
export class DeliveryStatusDto {
  @ApiProperty({ enum: DELIVERY_STATUSES }) @IsIn(DELIVERY_STATUSES as unknown as string[]) status: (typeof DELIVERY_STATUSES)[number];
  @ApiPropertyOptional() @IsOptional() @TrimToUndefined() @IsString() @MaxLength(500) note?: string;
  @ApiPropertyOptional({ type: CodCollectionDto, description: 'Khi DELIVERED: ghi nhận tiền thu hộ' }) @IsOptional() @ValidateNested() @Type(() => CodCollectionDto) collectCod?: CodCollectionDto;
}
export class DeliveryQueryDto extends PaginationQueryDto {
  @ApiPropertyOptional({ enum: DELIVERY_STATUSES }) @IsOptional() @IsIn(DELIVERY_STATUSES as unknown as string[]) status?: string;
  @ApiPropertyOptional() @IsOptional() @IsUUID() branchId?: string;
  @ApiPropertyOptional() @IsOptional() @IsString() @MaxLength(100) carrier?: string;
  @ApiPropertyOptional({ description: 'true = COD chưa thu' }) @IsOptional() @IsIn(['true', 'false']) codPending?: string;
  @ApiPropertyOptional() @IsOptional() @IsISO8601() from?: string;
  @ApiPropertyOptional() @IsOptional() @IsISO8601() to?: string;
}
