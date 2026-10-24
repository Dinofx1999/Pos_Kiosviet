import { createParamDecorator, ExecutionContext, SetMetadata } from '@nestjs/common';
import type { RequestUser } from '../../infra/cls/request-context';

export const PERMISSIONS_KEY = 'required_permissions';
export const IS_PUBLIC_KEY = 'is_public';
export const IDEMPOTENT_KEY = 'idempotent';

/** All listed permissions are required (AND). */
export const RequirePermission = (...codes: string[]) => SetMetadata(PERMISSIONS_KEY, codes);
export const Public = () => SetMetadata(IS_PUBLIC_KEY, true);
/** Marks a handler as idempotent: honours the Idempotency-Key header (see IdempotencyInterceptor). */
export const Idempotent = (scope?: string) => SetMetadata(IDEMPOTENT_KEY, scope ?? true);

export const CurrentUser = createParamDecorator((_data: unknown, ctx: ExecutionContext): RequestUser => {
  const req = ctx.switchToHttp().getRequest();
  return req.user as RequestUser;
});
