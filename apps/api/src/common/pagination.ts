import { ApiPropertyOptional } from '@nestjs/swagger';
import { Type } from 'class-transformer';
import { IsIn, IsInt, IsOptional, IsString, Max, Min } from 'class-validator';

export class PaginationQueryDto {
  @ApiPropertyOptional({ default: 1 }) @IsOptional() @Type(() => Number) @IsInt() @Min(1) page: number = 1;
  @ApiPropertyOptional({ default: 20 }) @IsOptional() @Type(() => Number) @IsInt() @Min(1) @Max(200) pageSize: number = 20;
  @ApiPropertyOptional() @IsOptional() @IsString() search?: string;
  @ApiPropertyOptional() @IsOptional() @IsString() sortBy?: string;
  @ApiPropertyOptional({ enum: ['asc', 'desc'] }) @IsOptional() @IsIn(['asc', 'desc']) sortDir?: 'asc' | 'desc';
}

export interface Paginated<T> {
  data: T[];
  meta: { page: number; pageSize: number; total: number };
}

export function paginated<T>(data: T[], total: number, q: { page: number; pageSize: number }): Paginated<T> {
  return { data, meta: { page: q.page, pageSize: q.pageSize, total } };
}

export function skipTake(q: { page: number; pageSize: number }) {
  return { skip: (q.page - 1) * q.pageSize, take: q.pageSize };
}

export function orderBy(q: { sortBy?: string; sortDir?: 'asc' | 'desc' }, allowed: string[], fallback: string) {
  const field = q.sortBy && allowed.includes(q.sortBy) ? q.sortBy : fallback;
  return { [field]: q.sortDir ?? 'desc' } as Record<string, 'asc' | 'desc'>;
}
