import { INestApplication } from '@nestjs/common';
import { NestExpressApplication } from '@nestjs/platform-express';
import { Test } from '@nestjs/testing';
import * as os from 'node:os';
import * as path from 'node:path';
import * as dotenv from 'dotenv';
import request from 'supertest';
import { AppModule } from '../src/app.module';
import { configureApp } from '../src/app.setup';
import { PrismaService } from '../src/infra/prisma/prisma.service';
import { OutboxService } from '../src/infra/outbox/outbox.service';

dotenv.config({ path: path.resolve(__dirname, '../.env') });
process.env.NODE_ENV = 'test';
process.env.OUTBOX_DISABLED = 'true';
// keep test uploads out of the dev uploads folder
process.env.UPLOAD_DIR = path.join(os.tmpdir(), 'erp-test-uploads');

export interface TestApp {
  app: INestApplication;
  http: () => ReturnType<typeof request>;
  prisma: PrismaService;
  outbox: OutboxService;
  close: () => Promise<void>;
}

export async function createTestApp(): Promise<TestApp> {
  const moduleRef = await Test.createTestingModule({ imports: [AppModule] }).compile();
  const app = moduleRef.createNestApplication<NestExpressApplication>({ logger: ['error', 'warn'] });
  configureApp(app);
  await app.init();
  return {
    app,
    http: () => request(app.getHttpServer()),
    prisma: app.get(PrismaService),
    outbox: app.get(OutboxService),
    close: () => app.close(),
  };
}

let counter = 0;
export function uniqueCode(prefix = 't') {
  counter++;
  return `${prefix}${Date.now().toString(36)}${process.pid.toString(36)}${counter}`.toLowerCase().slice(0, 40); // pid: các worker song song không trùng mã cùng mili-giây
}

export interface Session {
  token: string;
  refreshToken: string;
  tenantId: string;
  tenantCode: string;
  userId: string;
  branchId: string;
  warehouseId: string;
  auth: { Authorization: string };
}

/** Registers a tenant. Tests get the unlimited ENTERPRISE plan unless `plan` is given (the SaaS tests keep FREE to exercise limits). */
export async function registerTenant(t: TestApp, overrides: Partial<{ tenantCode: string; ownerUsername: string; ownerPassword: string; plan: 'FREE' | 'BASIC' | 'PRO' | 'ENTERPRISE' }> = {}): Promise<Session> {
  const tenantCode = overrides.tenantCode ?? uniqueCode('shop');
  const res = await t.http().post('/api/v1/auth/register-tenant').send({
    tenantCode, tenantName: `Shop ${tenantCode}`, ownerUsername: overrides.ownerUsername ?? 'owner', ownerPassword: overrides.ownerPassword ?? 'Secret123', ownerFullName: 'Owner',
  });
  if (res.status !== 201) throw new Error(`register failed: ${res.status} ${JSON.stringify(res.body)}`);
  const plan = overrides.plan ?? 'ENTERPRISE';
  if (plan !== 'FREE') await t.prisma.raw.tenant.update({ where: { id: res.body.tenant.id }, data: { planCode: plan } });
  return {
    token: res.body.accessToken, refreshToken: res.body.refreshToken, tenantId: res.body.tenant.id, tenantCode, userId: res.body.user.id,
    branchId: res.body.branch.id, warehouseId: res.body.warehouse.id, auth: { Authorization: `Bearer ${res.body.accessToken}` },
  };
}

export async function login(t: TestApp, tenantCode: string, username: string, password: string) {
  const res = await t.http().post('/api/v1/auth/login').send({ tenantCode, username, password });
  return res;
}

/** Creates a simple GOODS product with one variant; returns { productId, variantId, code }. */
export async function createProduct(t: TestApp, s: Session, body: Record<string, unknown> = {}) {
  const res = await t.http().post('/api/v1/products').set(s.auth).send({ name: `SP ${uniqueCode('p')}`, variants: [{ sellPrice: '100000', costPrice: '60000' }], ...body });
  if (res.status !== 201) throw new Error(`createProduct failed: ${res.status} ${JSON.stringify(res.body)}`);
  return { productId: res.body.id as string, variantId: res.body.variants[0].id as string, code: res.body.code as string, body: res.body };
}

export async function postReceipt(t: TestApp, s: Session, lines: Array<{ variantId: string; quantity: string; unitCost: string; batchId?: string }>, extra: Record<string, unknown> = {}, headers: Record<string, string> = {}) {
  return t.http().post('/api/v1/inventory/documents/post-now').set(s.auth).set(headers).send({ type: 'RECEIPT', branchId: s.branchId, warehouseId: s.warehouseId, lines, ...extra });
}

export async function postIssue(t: TestApp, s: Session, lines: Array<{ variantId: string; quantity: string; batchId?: string }>, extra: Record<string, unknown> = {}, headers: Record<string, string> = {}) {
  return t.http().post('/api/v1/inventory/documents/post-now').set(s.auth).set(headers).send({ type: 'ISSUE', reason: 'OTHER', branchId: s.branchId, warehouseId: s.warehouseId, lines, ...extra });
}

export async function balanceOf(t: TestApp, s: Session, variantId: string, warehouseId = s.warehouseId) {
  const row = await t.prisma.raw.stockBalance.findFirst({ where: { tenantId: s.tenantId, variantId, warehouseId } });
  const variant = await t.prisma.raw.productVariant.findUniqueOrThrow({ where: { id: variantId } });
  return { onHand: row ? row.onHand.toString() : '0', reserved: row ? row.reserved.toString() : '0', costPrice: variant.costPrice.toString(), onHandTotal: variant.onHandTotal.toString() };
}
