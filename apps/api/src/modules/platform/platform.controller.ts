import { Body, Controller, Get, Headers, Param, ParseUUIDPipe, Patch, Query } from '@nestjs/common';
import { ApiBearerAuth, ApiHeader, ApiOperation, ApiTags } from '@nestjs/swagger';
import { ApiPropertyOptional } from '@nestjs/swagger';
import { IsIn, IsInt, IsISO8601, IsOptional, IsString, MaxLength, Min, ValidateIf } from 'class-validator';
import { Type } from 'class-transformer';
import { timingSafeEqual } from 'node:crypto';
import { PLANS } from '@erp/shared';
import { CurrentUser, Public, RequirePermission } from '../../common/decorators';
import { Errors } from '../../common/errors/app-error';
import { RequestUser } from '../../infra/cls/request-context';
import { PrismaService } from '../../infra/prisma/prisma.service';
import { PlanService } from './plan.service';

export class PlatformTenantUpdateDto {
  @ApiPropertyOptional({ enum: ['TRIAL', 'ACTIVE', 'SUSPENDED', 'CLOSED'] }) @IsOptional() @IsIn(['TRIAL', 'ACTIVE', 'SUSPENDED', 'CLOSED']) status?: 'TRIAL' | 'ACTIVE' | 'SUSPENDED' | 'CLOSED';
  @ApiPropertyOptional({ enum: Object.keys(PLANS) }) @IsOptional() @IsIn(Object.keys(PLANS)) planCode?: string;
  @ApiPropertyOptional({ nullable: true }) @IsOptional() @ValidateIf((_o, v) => v !== null) @IsISO8601() planExpiresAt?: string | null;
  @ApiPropertyOptional({ nullable: true }) @IsOptional() @ValidateIf((_o, v) => v !== null) @IsISO8601() trialEndsAt?: string | null;
  @ApiPropertyOptional() @IsOptional() @IsString() @MaxLength(500) planNote?: string;
}
export class PlatformTenantQueryDto {
  @ApiPropertyOptional() @IsOptional() @IsString() @MaxLength(100) search?: string;
  @ApiPropertyOptional() @IsOptional() @IsIn(['TRIAL', 'ACTIVE', 'SUSPENDED', 'CLOSED']) status?: string;
  @ApiPropertyOptional() @IsOptional() @Type(() => Number) @IsInt() @Min(1) page?: number;
}

/** Tenant-facing: my plan & usage. */
@ApiTags('subscription') @ApiBearerAuth() @Controller('subscription')
export class SubscriptionController {
  constructor(private readonly plans: PlanService) {}
  @Get() @RequirePermission('subscription.view') @ApiOperation({ summary: 'Gói dịch vụ, hạn mức và mức sử dụng của gian hàng' }) mine(@CurrentUser() u: RequestUser) { return this.plans.subscription(u.tenantId); }
}

/** Platform operator endpoints: no tenant user, authenticated with the PLATFORM_ADMIN_KEY header (BR-162). */
@ApiTags('platform') @Controller('platform') @Public()
export class PlatformController {
  constructor(private readonly prisma: PrismaService, private readonly plans: PlanService) {}

  private assertKey(key?: string) {
    const expected = process.env.PLATFORM_ADMIN_KEY;
    if (!expected || expected.length < 16) throw Errors.forbidden('Chưa cấu hình PLATFORM_ADMIN_KEY trên máy chủ');
    const a = Buffer.from(key ?? ''); const b = Buffer.from(expected);
    if (a.length !== b.length || !timingSafeEqual(a, b)) throw Errors.forbidden('Khóa quản trị nền tảng không hợp lệ');
  }

  @Get('tenants') @ApiHeader({ name: 'x-platform-key', required: true }) @ApiOperation({ summary: 'Danh sách gian hàng (quản trị nền tảng)' })
  async tenants(@Headers('x-platform-key') key: string | undefined, @Query() q: PlatformTenantQueryDto) {
    this.assertKey(key);
    const page = q.page ?? 1; const pageSize = 50;
    const where = { ...(q.status ? { status: q.status as never } : {}), ...(q.search ? { OR: [{ code: { contains: q.search, mode: 'insensitive' as const } }, { name: { contains: q.search, mode: 'insensitive' as const } }] } : {}) };
    const [rows, total] = await Promise.all([this.prisma.raw.tenant.findMany({ where, select: { id: true, code: true, name: true, status: true, planCode: true, trialEndsAt: true, planExpiresAt: true, planNote: true, createdAt: true, _count: { select: { users: true, branches: true, products: true, invoices: true } } }, skip: (page - 1) * pageSize, take: pageSize, orderBy: { createdAt: 'desc' } }), this.prisma.raw.tenant.count({ where })]);
    return { data: rows.map((t) => ({ ...t, readOnly: this.plans.isReadOnly(t), counts: t._count, _count: undefined })), meta: { page, pageSize, total } };
  }

  @Patch('tenants/:id') @ApiHeader({ name: 'x-platform-key', required: true }) @ApiOperation({ summary: 'Đổi gói / trạng thái / hạn của một gian hàng' })
  async update(@Headers('x-platform-key') key: string | undefined, @Param('id', ParseUUIDPipe) id: string, @Body() dto: PlatformTenantUpdateDto) {
    this.assertKey(key);
    const t = await this.prisma.raw.tenant.findFirst({ where: { id } });
    if (!t) throw Errors.notFound('Gian hàng', id);
    const after = await this.prisma.raw.tenant.update({ where: { id }, data: { status: dto.status, planCode: dto.planCode, planNote: dto.planNote, planExpiresAt: dto.planExpiresAt === undefined ? undefined : dto.planExpiresAt ? new Date(dto.planExpiresAt) : null, trialEndsAt: dto.trialEndsAt === undefined ? undefined : dto.trialEndsAt ? new Date(dto.trialEndsAt) : null } });
    await this.prisma.raw.auditLog.create({ data: { tenantId: id, action: 'platform.tenant.update', entityType: 'Tenant', entityId: id, before: { status: t.status, planCode: t.planCode } as never, after: { status: after.status, planCode: after.planCode, planExpiresAt: after.planExpiresAt, trialEndsAt: after.trialEndsAt } as never } });
    return { id: after.id, code: after.code, status: after.status, planCode: after.planCode, trialEndsAt: after.trialEndsAt, planExpiresAt: after.planExpiresAt, planNote: after.planNote, readOnly: this.plans.isReadOnly(after) };
  }
}
