import { ApiPropertyOptional } from '@nestjs/swagger';
import { Type } from 'class-transformer';
import { IsIn, IsInt, IsISO8601, IsOptional, IsString, IsUUID, Max, MaxLength, Min } from 'class-validator';
import { PaginationQueryDto } from '../../../common/pagination';

export class NxtQueryDto extends PaginationQueryDto {
  @ApiPropertyOptional() @IsOptional() @IsISO8601() from?: string;
  @ApiPropertyOptional() @IsOptional() @IsISO8601() to?: string;
  @ApiPropertyOptional() @IsOptional() @IsUUID() warehouseId?: string;
  @ApiPropertyOptional() @IsOptional() @IsUUID() branchId?: string;
  @ApiPropertyOptional() @IsOptional() @IsUUID() categoryId?: string;
  @ApiPropertyOptional({ description: 'true = ẩn hàng không có biến động và tồn 0' }) @IsOptional() @IsIn(['true', 'false']) hideEmpty?: string;
}
export class SlowMoversQueryDto extends PaginationQueryDto {
  @ApiPropertyOptional({ default: 30 }) @IsOptional() @Type(() => Number) @IsInt() @Min(1) @Max(3650) days?: number;
  @ApiPropertyOptional() @IsOptional() @IsUUID() warehouseId?: string;
  @ApiPropertyOptional() @IsOptional() @IsUUID() branchId?: string;
  @ApiPropertyOptional() @IsOptional() @IsUUID() categoryId?: string;
}
export class TopProductsQueryDto extends PaginationQueryDto {
  @ApiPropertyOptional() @IsOptional() @IsISO8601() from?: string;
  @ApiPropertyOptional() @IsOptional() @IsISO8601() to?: string;
  @ApiPropertyOptional() @IsOptional() @IsUUID() branchId?: string;
  @ApiPropertyOptional() @IsOptional() @IsUUID() categoryId?: string;
  @ApiPropertyOptional({ enum: ['revenue', 'quantity', 'profit'], default: 'revenue' }) @IsOptional() @IsIn(['revenue', 'quantity', 'profit']) by?: string;
  @ApiPropertyOptional({ enum: ['desc', 'asc'], default: 'desc', description: 'asc = bán chậm nhất trước' }) @IsOptional() @IsIn(['desc', 'asc']) order?: string;
}
export class ProfitQueryDto {
  @ApiPropertyOptional() @IsOptional() @IsISO8601() from?: string;
  @ApiPropertyOptional() @IsOptional() @IsISO8601() to?: string;
  @ApiPropertyOptional() @IsOptional() @IsUUID() branchId?: string;
  @ApiPropertyOptional({ enum: ['day', 'month'], default: 'month' }) @IsOptional() @IsIn(['day', 'month']) groupBy?: string;
}
export class ValuationQueryDto {
  @ApiPropertyOptional() @IsOptional() @IsUUID() warehouseId?: string;
  @ApiPropertyOptional() @IsOptional() @IsUUID() branchId?: string;
  @ApiPropertyOptional({ enum: ['category', 'warehouse', 'brand'], default: 'category' }) @IsOptional() @IsIn(['category', 'warehouse', 'brand']) groupBy?: string;
}
export class ReportExportQueryDto {
  @ApiPropertyOptional({ enum: ['nxt', 'slow-movers', 'top-products', 'profit', 'valuation', 'sales', 'cashbook', 'customer-debt', 'supplier-debt'] }) @IsIn(['nxt', 'slow-movers', 'top-products', 'profit', 'valuation', 'sales', 'cashbook', 'customer-debt', 'supplier-debt']) type: string;
  @ApiPropertyOptional() @IsOptional() @IsISO8601() from?: string;
  @ApiPropertyOptional() @IsOptional() @IsISO8601() to?: string;
  @ApiPropertyOptional() @IsOptional() @IsUUID() warehouseId?: string;
  @ApiPropertyOptional() @IsOptional() @IsUUID() branchId?: string;
  @ApiPropertyOptional() @IsOptional() @IsUUID() categoryId?: string;
  @ApiPropertyOptional() @IsOptional() @IsUUID() accountId?: string;
  @ApiPropertyOptional() @IsOptional() @Type(() => Number) @IsInt() @Min(1) @Max(3650) days?: number;
  @ApiPropertyOptional() @IsOptional() @IsString() @MaxLength(20) by?: string;
  @ApiPropertyOptional({ enum: ['desc', 'asc'] }) @IsOptional() @IsIn(['desc', 'asc']) order?: string;
  @ApiPropertyOptional() @IsOptional() @IsString() @MaxLength(100) search?: string;
  @ApiPropertyOptional() @IsOptional() @IsIn(['true', 'false']) hideEmpty?: string;
  @ApiPropertyOptional({ enum: ['category', 'warehouse', 'brand'] }) @IsOptional() @IsIn(['category', 'warehouse', 'brand']) groupBy?: string;
}
export class CustomersReportQueryDto extends PaginationQueryDto {
  @ApiPropertyOptional() @IsOptional() @IsISO8601() from?: string;
  @ApiPropertyOptional() @IsOptional() @IsISO8601() to?: string;
  @ApiPropertyOptional() @IsOptional() @IsUUID() branchId?: string;
  @ApiPropertyOptional() @IsOptional() @IsString() @MaxLength(100) groupName?: string;
  @ApiPropertyOptional({ enum: ['revenue', 'invoices', 'lastPurchase', 'points', 'debt'], default: 'revenue' }) @IsOptional() @IsIn(['revenue', 'invoices', 'lastPurchase', 'points', 'debt']) by?: string;
}
export class TaxReportQueryDto {
  @ApiPropertyOptional() @IsOptional() @IsISO8601() from?: string;
  @ApiPropertyOptional() @IsOptional() @IsISO8601() to?: string;
  @ApiPropertyOptional() @IsOptional() @IsUUID() branchId?: string;
}
