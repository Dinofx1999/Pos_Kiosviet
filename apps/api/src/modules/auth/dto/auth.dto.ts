import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { IsEmail, IsOptional, IsString, Matches, MaxLength, MinLength } from 'class-validator';

export class RegisterTenantDto {
  @ApiProperty({ example: 'myshop' }) @IsString() @Matches(/^[a-z0-9-]{3,50}$/, { message: 'Mã gian hàng chỉ gồm chữ thường, số, dấu gạch ngang (3-50 ký tự)' }) tenantCode: string;
  @ApiProperty({ example: 'Cửa hàng mỹ phẩm ABC' }) @IsString() @MinLength(2) @MaxLength(200) tenantName: string;
  @ApiProperty({ example: 'admin' }) @IsString() @Matches(/^[a-zA-Z0-9._-]{3,100}$/) ownerUsername: string;
  @ApiProperty({ example: 'Secret123' }) @IsString() @MinLength(6) @MaxLength(100) ownerPassword: string;
  @ApiProperty({ example: 'Nguyễn Văn A' }) @IsString() @MinLength(1) @MaxLength(200) ownerFullName: string;
  @ApiPropertyOptional() @IsOptional() @IsEmail() email?: string;
  @ApiPropertyOptional() @IsOptional() @IsString() @MaxLength(30) phone?: string;
  @ApiPropertyOptional({ example: 'Mỹ phẩm' }) @IsOptional() @IsString() @MaxLength(100) industry?: string;
}

export class LoginDto {
  @ApiProperty({ example: 'myshop' }) @IsString() @MaxLength(50) tenantCode: string;
  @ApiProperty({ example: 'admin' }) @IsString() @MaxLength(100) username: string;
  @ApiProperty({ example: 'Secret123' }) @IsString() @MaxLength(100) password: string;
}

export class RefreshDto {
  @ApiProperty() @IsString() @MaxLength(512) refreshToken: string;
}

export class ChangePasswordDto {
  @ApiProperty() @IsString() currentPassword: string;
  @ApiProperty() @IsString() @MinLength(6) @MaxLength(100) newPassword: string;
}
