import { Module } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { APP_FILTER, APP_GUARD, APP_INTERCEPTOR } from '@nestjs/core';
import { EventEmitterModule } from '@nestjs/event-emitter';
import { ThrottlerGuard, ThrottlerModule } from '@nestjs/throttler';
import { ClsModule } from 'nestjs-cls';
import { randomUUID } from 'node:crypto';
import { GlobalExceptionFilter } from './common/filters/http-exception.filter';
import { JwtAuthGuard } from './common/guards/jwt-auth.guard';
import { PermissionsGuard } from './common/guards/permissions.guard';
import { validateEnv } from './config/env';
import { AccessModule } from './infra/access/access.module';
import { AuditModule } from './infra/audit/audit.module';
import { IdempotencyInterceptor } from './infra/idempotency/idempotency.interceptor';
import { NumberingModule } from './infra/numbering/numbering.module';
import { OutboxModule } from './infra/outbox/outbox.module';
import { PrismaModule } from './infra/prisma/prisma.module';
import { RedisModule } from './infra/redis/redis.module';
import { AuthModule } from './modules/auth/auth.module';
import { CatalogModule } from './modules/catalog/catalog.module';
import { DashboardModule } from './modules/dashboard/dashboard.module';
import { InventoryModule } from './modules/inventory/inventory.module';
import { OrgModule } from './modules/org/org.module';
import { UploadsModule } from './modules/uploads/uploads.module';
import { FinanceModule } from './modules/finance/finance.module';
import { PurchasingModule } from './modules/purchasing/purchasing.module';
import { SalesModule } from './modules/sales/sales.module';
import { ReportsModule } from './modules/reports/reports.module';
import { IntegrationsModule } from './modules/integrations/integrations.module';
import { EmployeesModule } from './modules/employees/employees.module';
import { PlatformModule } from './modules/platform/platform.module';

@Module({
  imports: [
    ConfigModule.forRoot({ isGlobal: true, validate: validateEnv, envFilePath: ['.env', '../../.env'] }),
    ClsModule.forRoot({ global: true, middleware: { mount: true, generateId: true, idGenerator: () => randomUUID() } }),
    EventEmitterModule.forRoot({ wildcard: true }),
    ThrottlerModule.forRoot([{ ttl: 60000, limit: 600, skipIf: () => process.env.NODE_ENV === 'test' }]),
    PrismaModule, RedisModule, AuditModule, NumberingModule, OutboxModule, AccessModule,
    AuthModule, OrgModule, InventoryModule, CatalogModule, DashboardModule, UploadsModule, FinanceModule, PurchasingModule, SalesModule, ReportsModule, IntegrationsModule, EmployeesModule, PlatformModule,
  ],
  providers: [
    { provide: APP_FILTER, useClass: GlobalExceptionFilter },
    { provide: APP_GUARD, useClass: ThrottlerGuard },
    { provide: APP_GUARD, useClass: JwtAuthGuard },
    { provide: APP_GUARD, useClass: PermissionsGuard },
    { provide: APP_INTERCEPTOR, useClass: IdempotencyInterceptor },
  ],
})
export class AppModule {}
