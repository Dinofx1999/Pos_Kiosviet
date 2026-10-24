import { HttpStatus, Injectable, UnauthorizedException } from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';
import { Prisma } from '@prisma/client';
import * as bcrypt from 'bcryptjs';
import { createHash, randomBytes } from 'node:crypto';
import { ClsService } from 'nestjs-cls';
import { ALL_PERMISSION_CODES, TENANT_SETTING_KEYS } from '@erp/shared';
import { AppError, Errors } from '../../common/errors/app-error';
import { CTX, RequestUser } from '../../infra/cls/request-context';
import { PrismaService } from '../../infra/prisma/prisma.service';
import { ChangePasswordDto, LoginDto, RegisterTenantDto } from './dto/auth.dto';

const BCRYPT_ROUNDS = 10;

export interface TokenPair { accessToken: string; refreshToken: string; expiresIn: number; tokenType: 'Bearer' }

/** Default roles created for every new tenant. Permissions reference packages/shared. */
export const DEFAULT_ROLES: Array<{ code: string; name: string; permissions: string[]; isSystem: boolean }> = [
  { code: 'ADMIN', name: 'Quản trị viên', permissions: ['*'], isSystem: true },
  {
    code: 'MANAGER', name: 'Quản lý cửa hàng', isSystem: false,
    permissions: ALL_PERMISSION_CODES.filter((c) => !['tenant.settings.manage', 'role.manage', 'user.manage'].includes(c)),
  },
  {
    code: 'WAREHOUSE', name: 'Thủ kho', isSystem: false,
    permissions: ['dashboard.view', 'product.view', 'product.cost.view', 'inventory.view', 'inventory.movement.view', 'inventory.document.view',
      'inventory.document.create', 'inventory.document.post', 'inventory.cost.view',
      'transfer.view', 'transfer.create', 'transfer.dispatch', 'transfer.receive', 'transfer.cancel', 'stocktake.view', 'stocktake.create', 'stocktake.complete', 'stocktake.cancel',
      'supplier.view', 'purchase.order.view', 'purchase.receipt.view', 'purchase.receipt.create', 'purchase.receipt.post', 'purchase.return.view', 'purchase.return.create', 'purchase.return.post'],
  },
  {
    code: 'CASHIER', name: 'Nhân viên bán hàng', isSystem: false,
    permissions: ['order.view', 'order.create', 'order.confirm', 'order.complete', 'delivery.view', 'delivery.manage', 'promotion.view', 'dashboard.view', 'product.view', 'inventory.view', 'customer.view', 'customer.manage', 'invoice.view', 'invoice.create', 'invoice.complete', 'invoice.discount', 'invoice.pricebook.select', 'shift.view', 'shift.open', 'shift.close', 'payment.view', 'return.view', 'return.create', 'return.complete'],
  },
];

const REFRESH_REUSE_GRACE_MS = 60_000;

@Injectable()
export class AuthService {
  constructor(private readonly prisma: PrismaService, private readonly jwt: JwtService, private readonly cls: ClsService) {}

  // ---------------------------------------------------------------- tenant registration (BR-02)
  async registerTenant(dto: RegisterTenantDto) {
    const exists = await this.prisma.raw.tenant.findUnique({ where: { code: dto.tenantCode } });
    if (exists) throw Errors.duplicate('DUPLICATE_CODE', 'Mã gian hàng đã tồn tại', { tenantCode: dto.tenantCode });
    const passwordHash = await bcrypt.hash(dto.ownerPassword, BCRYPT_ROUNDS);

    const result = await this.prisma.raw.$transaction(async (tx) => {
      const tenant = await tx.tenant.create({ data: { code: dto.tenantCode, name: dto.tenantName, industry: dto.industry, status: 'TRIAL', planCode: 'FREE', trialEndsAt: new Date(Date.now() + 30 * 86400_000) } });
      const tenantId = tenant.id;
      await tx.tenantSetting.createMany({
        data: [
          { tenantId, key: TENANT_SETTING_KEYS.ALLOW_NEGATIVE_STOCK, value: false },
          { tenantId, key: TENANT_SETTING_KEYS.COSTING_METHOD, value: 'AVG' },
          { tenantId, key: TENANT_SETTING_KEYS.CURRENCY, value: 'VND' },
          { tenantId, key: TENANT_SETTING_KEYS.PRICE_INCLUDES_TAX, value: true },
          { tenantId, key: TENANT_SETTING_KEYS.PURCHASE_TAX_IN_COST, value: true },
          { tenantId, key: TENANT_SETTING_KEYS.POS_REQUIRE_SHIFT, value: false },
          { tenantId, key: TENANT_SETTING_KEYS.POS_ALLOW_CREDIT, value: true },
          { tenantId, key: TENANT_SETTING_KEYS.POS_MAX_DISCOUNT_PERCENT, value: 100 },
          { tenantId, key: TENANT_SETTING_KEYS.RETURN_MAX_DAYS, value: 0 },
        ],
      });
      const branch = await tx.branch.create({ data: { tenantId, code: 'CN01', name: 'Chi nhánh trung tâm', isDefault: true, phone: dto.phone, email: dto.email } });
      const warehouse = await tx.warehouse.create({ data: { tenantId, branchId: branch.id, code: 'KHO01', name: 'Kho chính', isDefault: true } });
      await tx.cashAccount.create({ data: { tenantId, branchId: branch.id, code: 'QT0001', name: 'Két tiền mặt - Chi nhánh trung tâm', type: 'CASH', isDefault: true } });
      await tx.documentSequence.create({ data: { tenantId, docType: 'CASH_ACCOUNT', prefix: 'QT', padding: 4, nextNumber: 2 } });
      const roles: Record<string, string> = {};
      for (const r of DEFAULT_ROLES) {
        const role = await tx.role.create({
          data: { tenantId, code: r.code, name: r.name, isSystem: r.isSystem, permissions: { create: r.permissions.map((permission) => ({ permission })) } },
        });
        roles[r.code] = role.id;
      }
      const user = await tx.user.create({
        data: {
          tenantId, username: dto.ownerUsername, passwordHash, fullName: dto.ownerFullName, email: dto.email, phone: dto.phone,
          isOwner: true, allBranches: true, roles: { create: [{ roleId: roles.ADMIN }] },
        },
      });
      await tx.auditLog.create({ data: { tenantId, userId: user.id, username: user.username, action: 'tenant.register', entityType: 'Tenant', entityId: tenantId, entityCode: tenant.code, after: { name: tenant.name } } });
      await tx.outboxEvent.create({ data: { tenantId, eventType: 'tenant.registered', aggregateType: 'Tenant', aggregateId: tenantId, payload: { code: tenant.code, name: tenant.name } } });
      return { tenant, user, branch, warehouse };
    });

    const tokens = await this.issueTokens(result.user.id, result.tenant.id, result.user.username);
    return { tenant: pickTenant(result.tenant), user: pickUser(result.user), branch: result.branch, warehouse: result.warehouse, ...tokens };
  }

  // ---------------------------------------------------------------- login
  async login(dto: LoginDto) {
    const ip = this.cls.get(CTX.ip) as string | undefined;
    const userAgent = this.cls.get(CTX.userAgent) as string | undefined;
    const tenant = await this.prisma.raw.tenant.findUnique({ where: { code: dto.tenantCode } });
    const user = tenant ? await this.prisma.raw.user.findUnique({ where: { tenantId_username: { tenantId: tenant.id, username: dto.username } } }) : null;
    const fail = async (reason: string) => {
      await this.prisma.raw.loginHistory.create({ data: { tenantId: tenant?.id, userId: user?.id, username: dto.username, success: false, reason, ip, userAgent } });
      throw new UnauthorizedException({ code: 'INVALID_CREDENTIALS', message: 'Tên đăng nhập hoặc mật khẩu không đúng' });
    };
    if (!tenant || !user) return fail('USER_NOT_FOUND');
    if (user.status !== 'ACTIVE') return fail('USER_' + user.status);
    if (tenant.status === 'SUSPENDED' || tenant.status === 'CLOSED') return fail('TENANT_' + tenant.status);
    const ok = await bcrypt.compare(dto.password, user.passwordHash);
    if (!ok) return fail('WRONG_PASSWORD');

    await this.prisma.raw.$transaction([
      this.prisma.raw.loginHistory.create({ data: { tenantId: tenant.id, userId: user.id, username: user.username, success: true, ip, userAgent } }),
      this.prisma.raw.user.update({ where: { id: user.id }, data: { lastLoginAt: new Date() } }),
    ]);
    const tokens = await this.issueTokens(user.id, tenant.id, user.username);
    return { ...tokens, user: pickUser(user), tenant: pickTenant(tenant) };
  }

  // ---------------------------------------------------------------- refresh (rotation + reuse detection)
  async refresh(refreshToken: string) {
    const tokenHash = hashToken(refreshToken);
    const existing = await this.prisma.raw.refreshToken.findUnique({ where: { tokenHash }, include: { user: { include: { tenant: true } } } });
    if (!existing) throw new UnauthorizedException({ code: 'INVALID_REFRESH_TOKEN', message: 'Refresh token không hợp lệ' });
    if (existing.revokedAt) {
      // two browser tabs can refresh with the same token within milliseconds of each other (the POS opens in a second tab):
      // a rotated token reused inside a short grace window is treated as that race and simply gets a fresh pair;
      // reuse after the window is a replay → revoke the whole family for safety (BR-05)
      const concurrent = !!existing.replacedById && Date.now() - existing.revokedAt.getTime() < REFRESH_REUSE_GRACE_MS;
      if (!concurrent) {
        await this.prisma.raw.refreshToken.updateMany({ where: { userId: existing.userId, revokedAt: null }, data: { revokedAt: new Date() } });
        throw new UnauthorizedException({ code: 'REFRESH_TOKEN_REUSED', message: 'Refresh token đã bị thu hồi' });
      }
    }
    if (existing.expiresAt < new Date()) throw new UnauthorizedException({ code: 'REFRESH_TOKEN_EXPIRED', message: 'Refresh token hết hạn' });
    if (existing.user.status !== 'ACTIVE') throw new UnauthorizedException({ code: 'UNAUTHORIZED', message: 'Tài khoản không hoạt động' });
    if (existing.user.tenant.status === 'SUSPENDED' || existing.user.tenant.status === 'CLOSED') throw new UnauthorizedException({ code: 'TENANT_SUSPENDED', message: 'Gian hàng đã bị tạm ngưng' });

    const tokens = await this.issueTokens(existing.userId, existing.user.tenantId, existing.user.username, existing.id);
    return { ...tokens, user: pickUser(existing.user), tenant: pickTenant(existing.user.tenant) };
  }

  async logout(refreshToken: string) {
    await this.prisma.raw.refreshToken.updateMany({ where: { tokenHash: hashToken(refreshToken), revokedAt: null }, data: { revokedAt: new Date() } });
  }

  // ---------------------------------------------------------------- me
  async me(user: RequestUser) {
    const [dbUser, tenant, branches, settings] = await Promise.all([
      this.prisma.db.user.findFirst({ where: { id: user.id }, include: { roles: { include: { role: { select: { id: true, code: true, name: true } } } } } }),
      this.prisma.raw.tenant.findUnique({ where: { id: user.tenantId } }),
      this.prisma.db.branch.findMany({ where: { isActive: true, ...(user.isOwner || user.allBranches ? {} : { id: { in: user.branchIds } }) }, include: { warehouses: { where: { isActive: true }, orderBy: { isDefault: 'desc' } } }, orderBy: [{ isDefault: 'desc' }, { name: 'asc' }] }),
      this.prisma.db.tenantSetting.findMany(),
    ]);
    if (!dbUser || !tenant) throw Errors.notFound('Người dùng');
    const warehouses = branches.flatMap((b) => b.warehouses.filter((w) => user.isOwner || user.warehouseIds.length === 0 || user.warehouseIds.includes(w.id)).map((w) => ({ ...w, branchName: b.name })));
    return {
      user: { ...pickUser(dbUser), roles: dbUser.roles.map((r) => r.role) },
      tenant: pickTenant(tenant),
      permissions: Array.from(user.permissions),
      branches: branches.map(({ warehouses: _w, ...b }) => b),
      warehouses,
      settings: Object.fromEntries(settings.map((s) => [s.key, s.value])),
    };
  }

  async changePassword(user: RequestUser, dto: ChangePasswordDto) {
    const dbUser = await this.prisma.raw.user.findUnique({ where: { id: user.id } });
    if (!dbUser || !(await bcrypt.compare(dto.currentPassword, dbUser.passwordHash)))
      throw new AppError('INVALID_CREDENTIALS', 'Mật khẩu hiện tại không đúng', HttpStatus.BAD_REQUEST);
    const passwordHash = await bcrypt.hash(dto.newPassword, BCRYPT_ROUNDS);
    await this.prisma.raw.$transaction([
      this.prisma.raw.user.update({ where: { id: user.id }, data: { passwordHash } }),
      this.prisma.raw.refreshToken.updateMany({ where: { userId: user.id, revokedAt: null }, data: { revokedAt: new Date() } }),
      this.prisma.raw.auditLog.create({ data: { tenantId: user.tenantId, userId: user.id, username: user.username, action: 'user.change_password', entityType: 'User', entityId: user.id } }),
    ]);
  }

  // ---------------------------------------------------------------- helpers
  static hashPassword(plain: string) {
    return bcrypt.hash(plain, BCRYPT_ROUNDS);
  }

  private async issueTokens(userId: string, tenantId: string, username: string, rotatedFromId?: string): Promise<TokenPair> {
    const ttl = Number(process.env.JWT_ACCESS_TTL ?? 900);
    const refreshDays = Number(process.env.JWT_REFRESH_TTL_DAYS ?? 30);
    const accessToken = await this.jwt.signAsync({ sub: userId, tid: tenantId, usr: username, typ: 'access' }, { expiresIn: ttl });
    const refreshToken = randomBytes(48).toString('base64url');
    const ip = this.cls.isActive() ? (this.cls.get(CTX.ip) as string | undefined) : undefined;
    const userAgent = this.cls.isActive() ? (this.cls.get(CTX.userAgent) as string | undefined) : undefined;
    await this.prisma.raw.$transaction(async (tx) => {
      const created = await tx.refreshToken.create({
        data: { userId, tokenHash: hashToken(refreshToken), expiresAt: new Date(Date.now() + refreshDays * 86400 * 1000), ip, userAgent: userAgent?.slice(0, 500) },
      });
      if (rotatedFromId) {
        // atomic rotation: only the first concurrent refresh wins; a loser means the token was presented twice → revoke the family
        const rotated = await tx.refreshToken.updateMany({ where: { id: rotatedFromId, revokedAt: null }, data: { revokedAt: new Date(), replacedById: created.id } });
        if (rotated.count !== 1) {
          // the token was already rotated by another request: inside the grace window (two tabs, BR-05b) the new pair stands;
          // otherwise it is a replay → revoke the whole family
          const prev = await tx.refreshToken.findUnique({ where: { id: rotatedFromId }, select: { revokedAt: true, replacedById: true } });
          const concurrent = !!prev?.replacedById && !!prev.revokedAt && Date.now() - prev.revokedAt.getTime() < REFRESH_REUSE_GRACE_MS;
          if (!concurrent) {
            await tx.refreshToken.updateMany({ where: { userId, revokedAt: null }, data: { revokedAt: new Date() } });
            throw new UnauthorizedException({ code: 'REFRESH_TOKEN_REUSED', message: 'Refresh token đã bị thu hồi' });
          }
        }
      }
    });
    return { accessToken, refreshToken, expiresIn: ttl, tokenType: 'Bearer' };
  }
}

export function hashToken(token: string) {
  return createHash('sha256').update(token).digest('hex');
}
export function pickUser(u: Prisma.UserGetPayload<object>) {
  return { id: u.id, username: u.username, fullName: u.fullName, email: u.email, phone: u.phone, isOwner: u.isOwner, allBranches: u.allBranches, status: u.status, lastLoginAt: u.lastLoginAt };
}
export function pickTenant(t: Prisma.TenantGetPayload<object>) {
  return { id: t.id, code: t.code, name: t.name, status: t.status, planCode: t.planCode, currency: t.currency, timezone: t.timezone };
}
