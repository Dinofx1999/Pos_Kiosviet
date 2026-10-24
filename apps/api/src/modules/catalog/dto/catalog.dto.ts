import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { Type } from 'class-transformer';
import { ArrayMaxSize, ArrayMinSize, IsArray, IsBoolean, IsIn, IsInt, IsISO8601, IsObject, IsOptional, IsString, IsUUID, Matches, Max, MaxLength, Min, MinLength, ValidateIf, ValidateNested } from 'class-validator';
import { IsDecimalStr, Trim, TrimToUndefined } from '../../../common/validators';
import { PaginationQueryDto } from '../../../common/pagination';

// ---------- categories / brands / units
export class CreateCategoryDto {
  @ApiProperty() @IsString() @MinLength(1) @MaxLength(200) name: string;
  @ApiPropertyOptional() @IsOptional() @IsUUID() parentId?: string;
  @ApiPropertyOptional() @IsOptional() @IsInt() sortOrder?: number;
}
export class UpdateCategoryDto {
  @ApiPropertyOptional() @IsOptional() @IsString() @MinLength(1) @MaxLength(200) name?: string;
  @ApiPropertyOptional({ nullable: true }) @IsOptional() @ValidateIf((_o, v) => v !== null) @IsUUID() parentId?: string | null;
  @ApiPropertyOptional() @IsOptional() @IsInt() sortOrder?: number;
  @ApiPropertyOptional() @IsOptional() @IsBoolean() isActive?: boolean;
}
export class NameDto {
  @ApiProperty() @IsString() @MinLength(1) @MaxLength(200) name: string;
  @ApiPropertyOptional() @IsOptional() @IsBoolean() isActive?: boolean;
}

// ---------- products
export class VariantInputDto {
  @ApiPropertyOptional({ description: 'Id khi cập nhật biến thể hiện có' }) @IsOptional() @IsUUID() id?: string;
  @ApiPropertyOptional() @IsOptional() @TrimToUndefined() @IsString() @Matches(/^[A-Za-z0-9._/-]{1,80}$/) sku?: string;
  @ApiPropertyOptional() @IsOptional() @TrimToUndefined() @IsString() @MaxLength(80) barcode?: string;
  @ApiPropertyOptional({ example: { 'Màu sắc': 'Đỏ', Size: 'M' } }) @IsOptional() @IsObject() attributes?: Record<string, string>;
  @ApiProperty({ example: '150000' }) @IsDecimalStr({ min: 0 }) sellPrice: string;
  @ApiPropertyOptional({ example: '90000', description: 'Giá vốn khởi tạo (chỉ áp dụng khi chưa có biến động kho)' }) @IsOptional() @IsDecimalStr({ min: 0 }) costPrice?: string;
  @ApiPropertyOptional() @IsOptional() @IsDecimalStr({ min: 0 }) minStock?: string;
  @ApiPropertyOptional() @IsOptional() @IsDecimalStr({ min: 0 }) maxStock?: string;
  @ApiPropertyOptional() @IsOptional() @IsString() @MaxLength(1000) imageUrl?: string;
  @ApiPropertyOptional() @IsOptional() @IsBoolean() isActive?: boolean;
}
export class ProductUnitInputDto {
  @ApiPropertyOptional() @IsOptional() @IsUUID() id?: string;
  @ApiProperty({ example: 'Thùng' }) @IsString() @MinLength(1) @MaxLength(50) unitName: string;
  @ApiProperty({ example: '24' }) @IsDecimalStr({ positive: true }) conversionFactor: string;
  @ApiPropertyOptional() @IsOptional() @TrimToUndefined() @IsString() @MaxLength(80) sku?: string;
  @ApiPropertyOptional() @IsOptional() @TrimToUndefined() @IsString() @MaxLength(80) barcode?: string;
  @ApiPropertyOptional() @IsOptional() @IsDecimalStr({ min: 0 }) sellPrice?: string;
}
export class ComboItemInputDto {
  @ApiProperty() @IsUUID() componentVariantId: string;
  @ApiProperty({ example: '2' }) @IsDecimalStr({ positive: true }) quantity: string;
}
export class ProductImageInputDto {
  @ApiProperty({ example: '/uploads/products/<tenantId>/<uuid>.jpg', description: 'URL trả về từ POST /uploads/images hoặc URL http(s) ngoài' }) @Trim() @IsString() @MaxLength(1000) url: string;
  @ApiPropertyOptional() @IsOptional() @IsInt() @Min(0) sortOrder?: number;
  @ApiPropertyOptional({ description: 'Gắn ảnh cho một biến thể cụ thể (tùy chọn)' }) @IsOptional() @IsUUID() variantId?: string;
}
export class InitialStockDto {
  @ApiProperty() @IsUUID() warehouseId: string;
  @ApiPropertyOptional({ description: 'Bỏ trống = biến thể mặc định / theo thứ tự variants' }) @IsOptional() @IsInt() @Min(0) variantIndex?: number;
  @ApiProperty({ example: '10' }) @IsDecimalStr({ positive: true }) quantity: string;
  @ApiProperty({ example: '90000' }) @IsDecimalStr({ min: 0 }) unitCost: string;
}
export class CreateProductDto {
  @ApiPropertyOptional({ description: 'Bỏ trống để tự sinh (SP000001)' }) @IsOptional() @TrimToUndefined() @IsString() @Matches(/^[A-Za-z0-9._/-]{1,50}$/) code?: string;
  @ApiProperty() @Trim() @IsString() @MinLength(1) @MaxLength(300) name: string;
  @ApiPropertyOptional({ enum: ['GOODS', 'SERVICE', 'COMBO'], default: 'GOODS' }) @IsOptional() @IsIn(['GOODS', 'SERVICE', 'COMBO']) type?: 'GOODS' | 'SERVICE' | 'COMBO';
  @ApiPropertyOptional() @IsOptional() @IsUUID() categoryId?: string;
  @ApiPropertyOptional() @IsOptional() @IsUUID() brandId?: string;
  @ApiPropertyOptional({ example: 'Cái' }) @IsOptional() @IsString() @MaxLength(50) baseUnit?: string;
  @ApiPropertyOptional() @IsOptional() @IsString() description?: string;
  @ApiPropertyOptional({ example: '10' }) @IsOptional() @IsDecimalStr({ min: 0, max: 100 }) taxRate?: string;
  @ApiPropertyOptional() @IsOptional() @IsDecimalStr({ min: 0 }) weight?: string;
  @ApiPropertyOptional() @IsOptional() @IsBoolean() trackBatch?: boolean;
  @ApiPropertyOptional() @IsOptional() @IsBoolean() allowSale?: boolean;
  @ApiPropertyOptional({ type: [String], example: ['Màu sắc', 'Size'] }) @IsOptional() @IsArray() @IsString({ each: true }) attributeNames?: string[];
  @ApiPropertyOptional() @IsOptional() @IsString() @MaxLength(1000) imageUrl?: string;
  @ApiPropertyOptional({ type: [ProductImageInputDto], description: 'Danh sách ảnh theo thứ tự; ảnh đầu là ảnh đại diện (tối đa 20)' }) @IsOptional() @IsArray() @ArrayMaxSize(20) @ValidateNested({ each: true }) @Type(() => ProductImageInputDto) images?: ProductImageInputDto[];
  @ApiProperty({ type: [VariantInputDto], description: 'Ít nhất 1 biến thể; hàng không thuộc tính gửi 1 phần tử' }) @IsArray() @ArrayMinSize(1) @ValidateNested({ each: true }) @Type(() => VariantInputDto) variants: VariantInputDto[];
  @ApiPropertyOptional({ type: [ProductUnitInputDto] }) @IsOptional() @IsArray() @ValidateNested({ each: true }) @Type(() => ProductUnitInputDto) units?: ProductUnitInputDto[];
  @ApiPropertyOptional({ type: [ComboItemInputDto] }) @IsOptional() @IsArray() @ValidateNested({ each: true }) @Type(() => ComboItemInputDto) comboItems?: ComboItemInputDto[];
  @ApiPropertyOptional({ type: [InitialStockDto], description: 'Tồn đầu kỳ: tạo phiếu nhập kho khác đã ghi sổ' }) @IsOptional() @IsArray() @ValidateNested({ each: true }) @Type(() => InitialStockDto) initialStock?: InitialStockDto[];
}
export class UpdateProductDto {
  @ApiPropertyOptional() @IsOptional() @IsString() @MinLength(1) @MaxLength(300) name?: string;
  @ApiPropertyOptional({ nullable: true }) @IsOptional() @ValidateIf((_o, v) => v !== null) @IsUUID() categoryId?: string | null;
  @ApiPropertyOptional({ nullable: true }) @IsOptional() @ValidateIf((_o, v) => v !== null) @IsUUID() brandId?: string | null;
  @ApiPropertyOptional() @IsOptional() @IsString() @MaxLength(50) baseUnit?: string;
  @ApiPropertyOptional() @IsOptional() @IsString() description?: string;
  @ApiPropertyOptional() @IsOptional() @IsDecimalStr({ min: 0, max: 100 }) taxRate?: string;
  @ApiPropertyOptional() @IsOptional() @IsDecimalStr({ min: 0 }) weight?: string;
  @ApiPropertyOptional() @IsOptional() @IsBoolean() trackBatch?: boolean;
  @ApiPropertyOptional() @IsOptional() @IsBoolean() allowSale?: boolean;
  @ApiPropertyOptional() @IsOptional() @IsBoolean() isActive?: boolean;
  @ApiPropertyOptional({ type: [String] }) @IsOptional() @IsArray() @IsString({ each: true }) attributeNames?: string[];
  @ApiPropertyOptional() @IsOptional() @IsString() @MaxLength(1000) imageUrl?: string;
  @ApiPropertyOptional({ type: [ProductImageInputDto], description: 'Thay thế toàn bộ danh sách ảnh (gửi [] để xóa hết)' }) @IsOptional() @IsArray() @ArrayMaxSize(20) @ValidateNested({ each: true }) @Type(() => ProductImageInputDto) images?: ProductImageInputDto[];
  @ApiPropertyOptional({ type: [VariantInputDto], description: 'Upsert: có id → cập nhật, không id → tạo mới; biến thể không có trong danh sách giữ nguyên' }) @IsOptional() @IsArray() @ValidateNested({ each: true }) @Type(() => VariantInputDto) variants?: VariantInputDto[];
  @ApiPropertyOptional({ type: [ProductUnitInputDto], description: 'Thay thế toàn bộ danh sách đơn vị quy đổi' }) @IsOptional() @IsArray() @ValidateNested({ each: true }) @Type(() => ProductUnitInputDto) units?: ProductUnitInputDto[];
  @ApiPropertyOptional({ type: [ComboItemInputDto] }) @IsOptional() @IsArray() @ValidateNested({ each: true }) @Type(() => ComboItemInputDto) comboItems?: ComboItemInputDto[];
}
export class ProductQueryDto extends PaginationQueryDto {
  @ApiPropertyOptional() @IsOptional() @IsUUID() categoryId?: string;
  @ApiPropertyOptional() @IsOptional() @IsUUID() brandId?: string;
  @ApiPropertyOptional({ enum: ['GOODS', 'SERVICE', 'COMBO'] }) @IsOptional() @IsIn(['GOODS', 'SERVICE', 'COMBO']) type?: string;
  @ApiPropertyOptional({ description: 'true/false; bỏ trống = tất cả' }) @IsOptional() @IsIn(['true', 'false']) isActive?: string;
  @ApiPropertyOptional({ enum: ['in', 'out', 'low', 'over'] }) @IsOptional() @IsIn(['in', 'out', 'low', 'over']) stockStatus?: 'in' | 'out' | 'low' | 'over';
  @ApiPropertyOptional() @IsOptional() @IsUUID() warehouseId?: string;
}
export class CreateBatchDto {
  @ApiProperty() @IsString() @MinLength(1) @MaxLength(100) batchNo: string;
  @ApiPropertyOptional() @IsOptional() @IsISO8601() mfgDate?: string;
  @ApiPropertyOptional() @IsOptional() @IsISO8601() expiryDate?: string;
}
// ---------- price books
export class CreatePriceBookDto {
  @ApiProperty() @IsString() @Matches(/^[A-Za-z0-9_-]{1,50}$/) code: string;
  @ApiProperty() @IsString() @MinLength(1) @MaxLength(200) name: string;
  @ApiPropertyOptional() @IsOptional() @IsInt() @Min(-1000) @Max(1000) priority?: number;
  @ApiPropertyOptional() @IsOptional() @IsISO8601() startsAt?: string;
  @ApiPropertyOptional() @IsOptional() @IsISO8601() endsAt?: string;
  @ApiPropertyOptional({ type: [String] }) @IsOptional() @IsArray() @IsUUID('4', { each: true }) branchIds?: string[];
  @ApiPropertyOptional({ type: [String], description: 'Nhóm khách hàng được áp dụng; rỗng = mọi khách' }) @IsOptional() @IsArray() @IsString({ each: true }) @MaxLength(100, { each: true }) customerGroups?: string[];
}
export class UpdatePriceBookDto {
  @ApiPropertyOptional() @IsOptional() @IsString() @MinLength(1) @MaxLength(200) name?: string;
  @ApiPropertyOptional({ enum: ['ACTIVE', 'INACTIVE'] }) @IsOptional() @IsIn(['ACTIVE', 'INACTIVE']) status?: 'ACTIVE' | 'INACTIVE';
  @ApiPropertyOptional() @IsOptional() @IsInt() @Min(-1000) @Max(1000) priority?: number;
  @ApiPropertyOptional({ nullable: true }) @IsOptional() @ValidateIf((_o, v) => v !== null) @IsISO8601() startsAt?: string | null;
  @ApiPropertyOptional({ nullable: true }) @IsOptional() @ValidateIf((_o, v) => v !== null) @IsISO8601() endsAt?: string | null;
  @ApiPropertyOptional({ type: [String] }) @IsOptional() @IsArray() @IsUUID('4', { each: true }) branchIds?: string[];
  @ApiPropertyOptional({ type: [String] }) @IsOptional() @IsArray() @IsString({ each: true }) @MaxLength(100, { each: true }) customerGroups?: string[];
}
export class PriceBookItemInputDto {
  @ApiProperty() @IsUUID() variantId: string;
  @ApiProperty() @IsDecimalStr({ min: 0 }) price: string;
  @ApiPropertyOptional({ default: '1' }) @IsOptional() @IsDecimalStr({ positive: true }) minQuantity?: string;
}
export class SetPriceBookItemsDto {
  @ApiProperty({ type: [PriceBookItemInputDto] }) @IsArray() @ValidateNested({ each: true }) @Type(() => PriceBookItemInputDto) items: PriceBookItemInputDto[];
}
