import { CallHandler, ExecutionContext, HttpStatus, Injectable, Logger, NestInterceptor } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { Prisma } from '@prisma/client';
import { createHash } from 'node:crypto';
import type { Request, Response } from 'express';
import { from, lastValueFrom, Observable } from 'rxjs';
import { IDEMPOTENT_KEY } from '../../common/decorators';
import { AppError } from '../../common/errors/app-error';
import { PrismaService } from '../prisma/prisma.service';
import { RequestUser } from '../cls/request-context';

const TTL_HOURS = 24;

/**
 * Implements BR-29. Handlers decorated with @Idempotent() honour the `Idempotency-Key` header:
 *  - first call: a key row is inserted (locked), the handler runs, the response is stored;
 *  - replay with identical payload: stored response is returned with `Idempotent-Replayed: true`;
 *  - same key, different payload: 409 IDEMPOTENCY_KEY_REUSED;
 *  - concurrent duplicate while first is running: 409 IDEMPOTENCY_IN_PROGRESS;
 *  - handler failure: key row is removed so the client may retry.
 */
@Injectable()
export class IdempotencyInterceptor implements NestInterceptor {
  private readonly logger = new Logger(IdempotencyInterceptor.name);
  constructor(private readonly reflector: Reflector, private readonly prisma: PrismaService) {}

  intercept(context: ExecutionContext, next: CallHandler): Observable<unknown> {
    const meta = this.reflector.getAllAndOverride<string | boolean | undefined>(IDEMPOTENT_KEY, [context.getHandler(), context.getClass()]);
    if (!meta) return next.handle();
    const req = context.switchToHttp().getRequest<Request & { user?: RequestUser }>();
    const key = req.header('Idempotency-Key');
    if (!key || !req.user) return next.handle();
    if (key.length > 200) throw new AppError('VALIDATION_ERROR', 'Idempotency-Key quá dài', HttpStatus.BAD_REQUEST);
    return from(this.run(context, next, req, key));
  }

  private async run(context: ExecutionContext, next: CallHandler, req: Request & { user?: RequestUser }, key: string) {
    const res = context.switchToHttp().getResponse<Response>();
    const user = req.user as RequestUser;
    // scope = user + method + concrete path: a key is private to the user who first used it (replays never bypass another user's checks)
    const scope = `${user.id} ${req.method} ${req.route?.path ?? req.path}`.replace(/:(\w+)/g, (_m, p) => String(req.params?.[p] ?? `:${p}`));
    const requestHash = createHash('sha256').update(JSON.stringify(req.body ?? {})).digest('hex');
    const expiresAt = new Date(Date.now() + TTL_HOURS * 3600 * 1000);

    // INSERT … ON CONFLICT DO NOTHING: no exception noise, returns 1 when this request owns the key
    // expired keys are reclaimed first so a stale row never blocks or replays a new request
    await this.prisma.raw.$executeRaw`DELETE FROM idempotency_keys WHERE tenant_id = ${user.tenantId}::uuid AND scope = ${scope} AND key = ${key} AND expires_at < now()`;
    const affected = await this.prisma.raw.$executeRaw`INSERT INTO idempotency_keys (id, tenant_id, scope, key, request_hash, locked_at, expires_at)
      VALUES (gen_random_uuid(), ${user.tenantId}::uuid, ${scope}, ${key}, ${requestHash}, now(), ${expiresAt}) ON CONFLICT (tenant_id, scope, key) DO NOTHING`;
    const inserted = affected === 1;

    if (!inserted) {
      const existing = await this.prisma.raw.idempotencyKey.findUnique({ where: { tenantId_scope_key: { tenantId: user.tenantId, scope, key } } });
      if (!existing) throw new AppError('IDEMPOTENCY_IN_PROGRESS', 'Yêu cầu trùng đang được xử lý', HttpStatus.CONFLICT);
      if (existing.requestHash !== requestHash)
        throw new AppError('IDEMPOTENCY_KEY_REUSED', 'Idempotency-Key đã được dùng cho một yêu cầu khác', HttpStatus.CONFLICT);
      if (!existing.completedAt) throw new AppError('IDEMPOTENCY_IN_PROGRESS', 'Yêu cầu trùng đang được xử lý', HttpStatus.CONFLICT);
      res.setHeader('Idempotent-Replayed', 'true');
      res.status(existing.statusCode ?? 200);
      return existing.responseBody;
    }

    let body: unknown;
    try {
      body = await lastValueFrom(next.handle(), { defaultValue: undefined });
    } catch (err) {
      // handler failed (nothing committed) → release the key so the client can retry
      await this.prisma.raw.idempotencyKey.deleteMany({ where: { tenantId: user.tenantId, scope, key } }).catch(() => undefined);
      throw err;
    }
    // handler succeeded: the key must stay locked even if storing the response fails (never allow a double-apply)
    try {
      await this.prisma.raw.idempotencyKey.update({
        where: { tenantId_scope_key: { tenantId: user.tenantId, scope, key } },
        data: { statusCode: res.statusCode, responseBody: body === undefined ? Prisma.JsonNull : (JSON.parse(JSON.stringify(body)) as Prisma.InputJsonValue), completedAt: new Date() },
      });
    } catch (err) {
      this.logger.error(`Failed to store idempotent response for key ${key}: ${(err as Error).message}`);
    }
    return body;
  }
}
