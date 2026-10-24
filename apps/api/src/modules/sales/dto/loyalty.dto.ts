import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { Type } from 'class-transformer';
import { IsInt, IsOptional, IsString, Matches, Max, MaxLength, Min, MinLength } from 'class-validator';
import { Trim } from '../../../common/validators';

export class AdjustPointsDto {
  @ApiProperty({ example: '-50', description: 'Số điểm cộng (+) hoặc trừ (−)' }) @Matches(/^-?\d{1,9}(\.\d{1,2})?$/) points: string;
  @ApiProperty() @Trim() @IsString() @MinLength(1) @MaxLength(500) note: string;
}
export class BirthdayQueryDto {
  @ApiPropertyOptional({ description: '1–12; mặc định tháng hiện tại' }) @IsOptional() @Type(() => Number) @IsInt() @Min(1) @Max(12) month?: number;
  @ApiPropertyOptional({ description: 'Ngày trong tháng (lọc đúng ngày)' }) @IsOptional() @Type(() => Number) @IsInt() @Min(1) @Max(31) day?: number;
}
