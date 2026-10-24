import { Injectable, Logger, OnModuleDestroy, OnModuleInit } from '@nestjs/common';
import { EventEmitter2 } from '@nestjs/event-emitter';
import { Prisma } from '@prisma/client';
import { ClsService } from 'nestjs-cls';
import { CTX } from '../cls/request-context';
import { DbClient, PrismaService } from '../prisma/prisma.service';

export interface OutboxEventInput {
  eventType: string;
  aggregateType: string;
  aggregateId: string;
  payload: Record<string, unknown>;
}

interface OutboxRow { id: string; tenant_id: string; event_type: string; aggregate_type: string; aggregate_id: string; payload: unknown; attempts: number }

/**
 * Transactional outbox. `enqueue` writes within the caller's transaction; the poller publishes after commit
 * through EventEmitter2 (`outbox.<eventType>`) – webhooks/queues subscribe there (Module 13).
 */
@Injectable()
export class OutboxService implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger(OutboxService.name);
  private timer?: NodeJS.Timeout;
  private running = false;

  constructor(private readonly prisma: PrismaService, private readonly cls: ClsService, private readonly emitter: EventEmitter2) {}

  async enqueue(tx: DbClient, event: OutboxEventInput, tenantIdOverride?: string): Promise<void> {
    const tenantId = tenantIdOverride ?? (this.cls.get(CTX.tenantId) as string);
    await tx.outboxEvent.create({
      data: {
        tenantId,
        eventType: event.eventType,
        aggregateType: event.aggregateType,
        aggregateId: event.aggregateId,
        payload: JSON.parse(JSON.stringify(event.payload)) as Prisma.InputJsonValue,
      },
    });
  }

  onModuleInit() {
    if (process.env.OUTBOX_DISABLED === 'true') return;
    const interval = Number(process.env.OUTBOX_POLL_INTERVAL_MS ?? 2000);
    this.timer = setInterval(() => void this.runOnce().catch((e) => this.logger.error(e)), interval);
    this.timer.unref();
  }

  onModuleDestroy() {
    if (this.timer) clearInterval(this.timer);
  }

  /** Publishes up to `limit` pending events. Safe to run from multiple instances (SKIP LOCKED). Returns count published. */
  async runOnce(limit = 50): Promise<number> {
    if (this.running) return 0;
    this.running = true;
    try {
      return await this.prisma.raw.$transaction(async (tx) => {
        const rows = await tx.$queryRaw<OutboxRow[]>`SELECT id, tenant_id, event_type, aggregate_type, aggregate_id, payload, attempts
          FROM outbox_events WHERE status = 'PENDING' AND available_at <= now()
          ORDER BY created_at ASC LIMIT ${limit} FOR UPDATE SKIP LOCKED`;
        let published = 0;
        for (const row of rows) {
          try {
            await this.emitter.emitAsync(`outbox.${row.event_type}`, {
              id: row.id, tenantId: row.tenant_id, eventType: row.event_type,
              aggregateType: row.aggregate_type, aggregateId: row.aggregate_id, payload: row.payload,
            });
            await tx.$executeRaw`UPDATE outbox_events SET status = 'PUBLISHED', published_at = now(), attempts = attempts + 1 WHERE id = ${row.id}::uuid`;
            published++;
          } catch (err) {
            const attempts = row.attempts + 1;
            const backoffSec = Math.min(3600, 2 ** attempts);
            const status = attempts >= 10 ? 'FAILED' : 'PENDING';
            await tx.$executeRaw`UPDATE outbox_events SET attempts = ${attempts}, status = ${status}::"OutboxStatus",
              available_at = now() + (${backoffSec} || ' seconds')::interval, last_error = ${String((err as Error).message).slice(0, 1000)} WHERE id = ${row.id}::uuid`;
          }
        }
        return published;
      });
    } finally {
      this.running = false;
    }
  }
}
