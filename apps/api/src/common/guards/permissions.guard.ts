import { CanActivate, ExecutionContext, Injectable } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { hasPermission } from '@erp/shared';
import { Errors } from '../errors/app-error';
import { IS_PUBLIC_KEY, PERMISSIONS_KEY } from '../decorators';
import { RequestUser } from '../../infra/cls/request-context';

@Injectable()
export class PermissionsGuard implements CanActivate {
  constructor(private readonly reflector: Reflector) {}

  canActivate(context: ExecutionContext): boolean {
    const isPublic = this.reflector.getAllAndOverride<boolean>(IS_PUBLIC_KEY, [context.getHandler(), context.getClass()]);
    if (isPublic) return true;
    const required = this.reflector.getAllAndOverride<string[]>(PERMISSIONS_KEY, [context.getHandler(), context.getClass()]) ?? [];
    if (required.length === 0) return true;
    const user = context.switchToHttp().getRequest().user as RequestUser | undefined;
    if (!user) throw Errors.forbidden();
    const missing = required.filter((code) => !hasPermission(user.permissions, code));
    if (missing.length) throw Errors.forbidden(`Thiếu quyền: ${missing.join(', ')}`);
    return true;
  }
}
