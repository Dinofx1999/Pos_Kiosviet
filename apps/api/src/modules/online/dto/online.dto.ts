import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { Type } from 'class-transformer';
import { ArrayMaxSize, ArrayMinSize, IsArray, IsBoolean, IsIn, IsInt, IsISO8601, IsOptional, IsString, IsUUID, Matches, Max, MaxLength, Min, MinLength, ValidateIf, ValidateNested } from 'class-validator';
import { IsDecimalStr, Trim, TrimToUndefined } from '../../../common/validators';

const URLISH = /^(https?:\/\/|\/)[^\s]{1,990}$/;

// ------------------------------------------------------------------ thiết lập web bán hàng
export class UpdateShopConfigDto {
  @ApiPropertyOptional() @IsOptional() @IsBoolean() enabled?: boolean;
  @ApiPropertyOptional({ description: 'Hiển thị giá trên web' }) @IsOptional() @IsBoolean() showPrice?: boolean;
  @ApiPropertyOptional({ description: 'Bật Flash Sale trên web' }) @IsOptional() @IsBoolean() flashSaleEnabled?: boolean;
  @ApiPropertyOptional() @IsOptional() @IsBoolean() allowOrder?: boolean;
  @ApiPropertyOptional() @IsOptional() @IsBoolean() showStock?: boolean;
  @ApiPropertyOptional() @IsOptional() @IsBoolean() hideOutOfStock?: boolean;
  @ApiPropertyOptional() @IsOptional() @IsBoolean() onlyWithImage?: boolean;
  @ApiPropertyOptional() @IsOptional() @ValidateIf((_, v) => v !== null) @Trim() @IsString() @MaxLength(200) shopName?: string | null;
  @ApiPropertyOptional() @IsOptional() @ValidateIf((_, v) => v !== null) @Trim() @Matches(/^[0-9+().\s-]{0,30}$/, { message: 'Số hotline không hợp lệ' }) hotline?: string | null;
  @ApiPropertyOptional({ description: 'Số Zalo hoặc link zalo.me' }) @IsOptional() @ValidateIf((_, v) => v !== null) @Trim() @IsString() @MaxLength(200) zalo?: string | null;
  @ApiPropertyOptional() @IsOptional() @ValidateIf((_, v) => v !== null && v !== '') @Trim() @Matches(URLISH, { message: 'Link Facebook phải bắt đầu bằng http(s)://' }) facebook?: string | null;
  @ApiPropertyOptional() @IsOptional() @ValidateIf((_, v) => v !== null) @Trim() @IsString() @MaxLength(500) address?: string | null;
  @ApiPropertyOptional() @IsOptional() @ValidateIf((_, v) => v !== null) @Trim() @IsString() @MaxLength(1000) intro?: string | null;
  @ApiPropertyOptional() @IsOptional() @ValidateIf((_, v) => v !== null && v !== '') @Matches(URLISH, { message: 'Ảnh bìa không hợp lệ' }) bannerUrl?: string | null;
  @ApiPropertyOptional() @IsOptional() @ValidateIf((_, v) => v !== null && v !== '') @Matches(URLISH, { message: 'Logo không hợp lệ' }) logoUrl?: string | null;
  @ApiPropertyOptional({ example: '#d6336c' }) @IsOptional() @Matches(/^#[0-9a-fA-F]{6}$/, { message: 'Màu chủ đạo dạng #RRGGBB' }) themeColor?: string;
  @ApiPropertyOptional() @IsOptional() @ValidateIf((_, v) => v !== null) @IsUUID() branchId?: string | null;
  @ApiPropertyOptional() @IsOptional() @ValidateIf((_, v) => v !== null) @IsUUID() warehouseId?: string | null;
  @ApiPropertyOptional({ type: [String], description: 'Kho tính còn hàng trên web (cộng tồn); rỗng = mọi kho' }) @IsOptional() @IsArray() @ArrayMaxSize(100) @IsUUID('all', { each: true }) stockWarehouseIds?: string[];
  @ApiPropertyOptional({ type: [String] }) @IsOptional() @IsArray() @ArrayMaxSize(500) @IsUUID('all', { each: true }) hiddenCategoryIds?: string[];
}

// ------------------------------------------------------------------ Flash Sale (quản trị)
export class FlashSaleItemDto {
  @ApiProperty() @IsUUID() variantId: string;
  @ApiProperty({ example: '99000', description: 'Giá Flash Sale (thấp hơn giá bán)' }) @IsDecimalStr({ min: 0 }) salePrice: string;
  @ApiPropertyOptional({ description: 'Số suất; bỏ trống = không giới hạn' }) @IsOptional() @ValidateIf((_, v) => v !== null) @IsInt() @Min(1) @Max(1000000) quantityLimit?: number | null;
  @ApiPropertyOptional({ description: 'Tối đa mỗi đơn; bỏ trống = không giới hạn' }) @IsOptional() @ValidateIf((_, v) => v !== null) @IsInt() @Min(1) @Max(10000) perOrderLimit?: number | null;
}
export class SaveFlashSaleDto {
  @ApiProperty() @Trim() @IsString() @MinLength(1) @MaxLength(200) name: string;
  @ApiProperty() @IsISO8601() startsAt: string;
  @ApiProperty() @IsISO8601() endsAt: string;
  @ApiPropertyOptional({ default: true }) @IsOptional() @IsBoolean() isActive?: boolean;
  @ApiPropertyOptional() @IsOptional() @TrimToUndefined() @IsString() @MaxLength(500) note?: string;
  @ApiProperty({ type: [FlashSaleItemDto] }) @IsArray() @ArrayMinSize(1, { message: 'Chọn ít nhất 1 hàng hóa' }) @ArrayMaxSize(300) @ValidateNested({ each: true }) @Type(() => FlashSaleItemDto) items: FlashSaleItemDto[];
}
export class ToggleFlashSaleDto {
  @ApiProperty() @IsBoolean() isActive: boolean;
}
export class FlashSaleQueryDto {
  @ApiPropertyOptional({ enum: ['RUNNING', 'UPCOMING', 'ENDED', 'OFF'] }) @IsOptional() @IsIn(['RUNNING', 'UPCOMING', 'ENDED', 'OFF']) state?: string;
}

// ------------------------------------------------------------------ web bán hàng (công khai)
export class ShopProductsQueryDto {
  @ApiPropertyOptional() @IsOptional() @TrimToUndefined() @IsString() @MaxLength(100) search?: string;
  @ApiPropertyOptional() @IsOptional() @IsUUID() categoryId?: string;
  @ApiPropertyOptional({ enum: ['featured', 'best', 'new', 'name', 'price_asc', 'price_desc'] }) @IsOptional() @IsIn(['featured', 'best', 'new', 'name', 'price_asc', 'price_desc']) sort?: string;
  @ApiPropertyOptional({ description: '1 = chỉ hàng còn hàng và có ảnh (dải "Bán chạy", "Hàng mới về" ở trang chủ)' }) @IsOptional() @IsIn(['0', '1', 'true', 'false']) ready?: string;
  @ApiPropertyOptional({ description: 'Bỏ một hàng khỏi danh sách (hàng đang xem ở trang chi tiết)' }) @IsOptional() @IsUUID() exclude?: string;
  @ApiPropertyOptional({ default: 1 }) @IsOptional() @Type(() => Number) @IsInt() @Min(1) @Max(1000) page?: number;
  @ApiPropertyOptional({ default: 24 }) @IsOptional() @Type(() => Number) @IsInt() @Min(1) @Max(60) pageSize?: number;
}
export class ShopOrderLineDto {
  @ApiProperty() @IsUUID() variantId: string;
  @ApiProperty() @IsInt() @Min(1) @Max(999) quantity: number;
}
export class PlaceShopOrderDto {
  @ApiProperty({ description: 'Mã do trình duyệt sinh cho mỗi lần đặt (chống gửi trùng)' }) @IsUUID() clientRef: string;
  @ApiProperty() @Trim() @IsString() @MinLength(2, { message: 'Vui lòng nhập họ tên' }) @MaxLength(200) name: string;
  @ApiProperty() @Trim() @Matches(/^[0-9+().\s-]{9,20}$/, { message: 'Số điện thoại không hợp lệ' }) phone: string;
  @ApiProperty() @Trim() @IsString() @MinLength(5, { message: 'Vui lòng nhập địa chỉ nhận hàng' }) @MaxLength(500) address: string;
  @ApiPropertyOptional() @IsOptional() @TrimToUndefined() @IsString() @MaxLength(500) note?: string;
  @ApiProperty({ type: [ShopOrderLineDto] }) @IsArray() @ArrayMinSize(1, { message: 'Giỏ hàng trống' }) @ArrayMaxSize(50) @ValidateNested({ each: true }) @Type(() => ShopOrderLineDto) lines: ShopOrderLineDto[];
  /** bẫy bot: ô ẩn, người thật để trống */
  @ApiPropertyOptional() @IsOptional() @IsString() @MaxLength(200) website?: string;
}
export class ShopOrderLookupDto {
  @ApiProperty() @Trim() @Matches(/^[0-9+().\s-]{9,20}$/, { message: 'Số điện thoại không hợp lệ' }) phone: string;
}
