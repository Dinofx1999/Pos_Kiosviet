import { CanActivate, ExecutionContext, Injectable, ForbiddenException, UnauthorizedException } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { JwtService } from '@nestjs/jwt';
import { ClsService } from 'nestjs-cls';
import type { Request } from 'express';
import { IS_PUBLIC_KEY } from '../decorators';
import { CTX, RequestUser } from '../../infra/cls/request-context';
import { PrismaService } from '../../infra/prisma/prisma.service';

export interface AccessTokenPayload { sub: string; tid: string; usr: string; typ: 'access' }

@Injectable()
export class JwtAuthGuard implements CanActivate {
  constructor(private readonly reflector: Reflector, private readonly jwt: JwtService, private readonly prisma: PrismaService, private readonly cls: ClsService) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const isPublic = this.reflector.getAllAndOverride<boolean>(IS_PUBLIC_KEY, [context.getHandler(), context.getClass()]);
    const req = context.switchToHttp().getRequest<Request & { user?: RequestUser }>();
    this.cls.set(CTX.ip, req.ip ?? req.socket?.remoteAddress);
    this.cls.set(CTX.userAgent, req.header('user-agent'));
    if (isPublic) return true;

    const header = req.header('authorization') ?? '';
    const token = header.startsWith('Bearer ') ? header.slice(7) : undefined;
    if (!token) throw new UnauthorizedException({ code: 'UNAUTHORIZED', message: 'Thiếu access token' });
    let payload: AccessTokenPayload;
    try {
      payload = await this.jwt.verifyAsync<AccessTokenPayload>(token);
    } catch {
      throw new UnauthorizedException({ code: 'UNAUTHORIZED', message: 'Token không hợp lệ hoặc đã hết hạn' });
    }
    if (payload.typ !== 'access') throw new UnauthorizedException({ code: 'UNAUTHORIZED', message: 'Token không hợp lệ' });

    const user = await this.prisma.raw.user.findFirst({
      where: { id: payload.sub, tenantId: payload.tid },
      include: {
        roles: { include: { role: { include: { permissions: true } } } },
        branchAccess: { select: { branchId: true } },
        warehouseAccess: { select: { warehouseId: true } },
        tenant: { select: { status: true, trialEndsAt: true, planExpiresAt: true } },
      },
    });
    if (!user || user.status !== 'ACTIVE') throw new UnauthorizedException({ code: 'UNAUTHORIZED', message: 'Tài khoản không hoạt động' });
    if (user.tenant.status === 'SUSPENDED' || user.tenant.status === 'CLOSED')
      throw new UnauthorizedException({ code: 'TENANT_SUSPENDED', message: 'Gian hàng đã bị tạm ngưng' });
    // BR-161: expired trial / expired plan (after a 7-day grace) → read-only, except auth & subscription endpoints
    const now = Date.now();
    const expired = (user.tenant.status === 'TRIAL' && user.tenant.trialEndsAt && user.tenant.trialEndsAt.getTime() < now) || (user.tenant.status === 'ACTIVE' && user.tenant.planExpiresAt && user.tenant.planExpiresAt.getTime() < now - 7 * 86400_000);
    if (expired && !['GET', 'HEAD', 'OPTIONS'].includes(req.method) && !req.path.includes('/auth/') && !req.path.includes('/subscription')) {
      throw new ForbiddenException({ code: user.tenant.status === 'TRIAL' ? 'TRIAL_EXPIRED' : 'PLAN_EXPIRED', message: user.tenant.status === 'TRIAL' ? 'Hết thời gian dùng thử: vui lòng nâng cấp gói để tiếp tục thao tác' : 'Gói dịch vụ đã hết hạn: dữ liệu chỉ đọc cho đến khi gia hạn' });
    }

    const permissions = new Set<string>();
    if (user.isOwner) permissions.add('*');
    for (const ur of user.roles) for (const p of ur.role.permissions) permissions.add(p.permission);

    const reqUser: RequestUser = {
      id: user.id, tenantId: user.tenantId, username: user.username, fullName: user.fullName,
      isOwner: user.isOwner, allBranches: user.allBranches, permissions,
      branchIds: user.branchAccess.map((b) => b.branchId), warehouseIds: user.warehouseAccess.map((w) => w.warehouseId),
    };
    req.user = reqUser;
    this.cls.set(CTX.tenantId, user.tenantId);
    this.cls.set(CTX.user, reqUser);
    return true;
  }
}
