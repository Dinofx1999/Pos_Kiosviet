import { Global, Injectable, Logger, Module, OnModuleDestroy } from '@nestjs/common';
import Redis from 'ioredis';

export const REDIS = 'REDIS_CLIENT';

/** Thin wrapper so the connection is closed on app shutdown (keeps tests free of open handles). */
@Injectable()
export class RedisService extends Redis implements OnModuleDestroy {
  private readonly logger = new Logger('Redis');
  constructor() {
    super(process.env.REDIS_URL ?? 'redis://localhost:6379', { lazyConnect: true, maxRetriesPerRequest: 1, enableOfflineQueue: false });
    this.on('error', (e) => this.logger.warn(`Redis unavailable: ${e.message}`));
    if (process.env.NODE_ENV !== 'test') this.connect().catch(() => undefined);
  }
  onModuleDestroy() {
    this.disconnect();
  }
}

@Global()
@Module({ providers: [RedisService, { provide: REDIS, useExisting: RedisService }], exports: [REDIS, RedisService] })
export class RedisModule {}
