import { Injectable, Logger, OnModuleDestroy, OnModuleInit } from '@nestjs/common';
import { Prisma, PrismaClient } from '@prisma/client';
import { ClsService } from 'nestjs-cls';
import { tenantExtension } from './tenant-extension';

export type TxClient = Prisma.TransactionClient;
export type DbClient = PrismaClient | Prisma.TransactionClient;

/**
 * PrismaService exposes:
 *  - `raw`: the unscoped client (login, tenant registration, system jobs).
 *  - `db`:  the tenant-scoped client (every request-scoped service must use this).
 */
@Injectable()
export class PrismaService implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger(PrismaService.name);
  readonly raw: PrismaClient;
  readonly db: PrismaClient;

  constructor(private readonly cls: ClsService) {
    const url = process.env.NODE_ENV === 'test' && process.env.DATABASE_URL_TEST ? process.env.DATABASE_URL_TEST : process.env.DATABASE_URL;
    this.raw = new PrismaClient({
      datasources: { db: { url } },
      log: process.env.PRISMA_LOG === 'query' ? ['query', 'warn', 'error'] : ['warn', 'error'],
      transactionOptions: { maxWait: 10000, timeout: 30000 },
    });
    this.db = this.raw.$extends(tenantExtension(cls)) as unknown as PrismaClient;
  }

  async onModuleInit() {
    await this.raw.$connect();
    this.logger.log('Database connected');
  }

  async onModuleDestroy() {
    await this.raw.$disconnect();
  }

  /** Run `fn` inside an interactive transaction on the tenant-scoped client. */
  tx<T>(fn: (tx: TxClient) => Promise<T>, opts?: { isolationLevel?: Prisma.TransactionIsolationLevel; timeout?: number }): Promise<T> {
    return this.db.$transaction(fn, { maxWait: 10000, timeout: opts?.timeout ?? 30000, isolationLevel: opts?.isolationLevel });
  }
}
