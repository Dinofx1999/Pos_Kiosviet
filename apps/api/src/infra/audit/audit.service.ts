import { Injectable } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { ClsService } from 'nestjs-cls';
import { CTX, RequestUser } from '../cls/request-context';
import { DbClient } from '../prisma/prisma.service';

export interface AuditEntry {
  action: string;          // e.g. product.create, inventory.document.post
  entityType: string;      // e.g. Product, InventoryDocument
  entityId?: string | null;
  entityCode?: string | null;
  before?: unknown;
  after?: unknown;
  metadata?: Record<string, unknown>;
}

@Injectable()
export class AuditService {
  constructor(private readonly cls: ClsService) {}

  /** Writes an audit row using the given client (pass the transaction client to keep it atomic). */
  async log(db: DbClient, entry: AuditEntry): Promise<void> {
    const user: RequestUser | undefined = this.cls.isActive() ? this.cls.get(CTX.user) : undefined;
    const tenantId: string | undefined = this.cls.isActive() ? this.cls.get(CTX.tenantId) : undefined;
    if (!tenantId) return;
    await db.auditLog.create({
      data: {
        tenantId,
        userId: user?.id ?? null,
        username: user?.username ?? null,
        action: entry.action,
        entityType: entry.entityType,
        entityId: entry.entityId ?? null,
        entityCode: entry.entityCode ?? null,
        before: entry.before === undefined ? Prisma.JsonNull : (sanitize(entry.before) as Prisma.InputJsonValue),
        after: entry.after === undefined ? Prisma.JsonNull : (sanitize(entry.after) as Prisma.InputJsonValue),
        metadata: entry.metadata ? (sanitize(entry.metadata) as Prisma.InputJsonValue) : Prisma.JsonNull,
        ip: this.cls.isActive() ? this.cls.get(CTX.ip) ?? null : null,
      },
    });
  }
}

/** Converts Decimal/BigInt/Date into JSON-safe values and strips secrets. */
export function sanitize(value: unknown): unknown {
  return JSON.parse(
    JSON.stringify(value, (key, v) => {
      if (key === 'passwordHash' || key === 'password' || key === 'tokenHash') return undefined;
      if (typeof v === 'bigint') return v.toString();
      return v;
    }),
  );
}
