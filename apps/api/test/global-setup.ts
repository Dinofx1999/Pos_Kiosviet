import { execSync } from 'node:child_process';
import * as path from 'node:path';
import * as dotenv from 'dotenv';

/** Runs once before the integration project: migrate the TEST database and clear its data. */
export default async function globalSetup() {
  dotenv.config({ path: path.resolve(__dirname, '../.env') });
  const url = process.env.DATABASE_URL_TEST;
  if (!url) throw new Error('DATABASE_URL_TEST is required for integration tests');
  process.env.NODE_ENV = 'test';
  execSync('npx prisma migrate deploy', { cwd: path.resolve(__dirname, '..'), env: { ...process.env, DATABASE_URL: url }, stdio: 'pipe' });
  const { PrismaClient } = await import('@prisma/client');
  const prisma = new PrismaClient({ datasources: { db: { url } } });
  // tenants cascade to everything else
  await prisma.$executeRawUnsafe('TRUNCATE TABLE tenants CASCADE');
  await prisma.$disconnect();
}
