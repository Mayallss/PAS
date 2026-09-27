import { execSync } from 'child_process';
import { existsSync } from 'fs';
import { resolve } from 'path';
import { PrismaClient } from '@prisma/client';

/**
 * Creates a brand-new, uniquely named database for this test run (never resets an existing one),
 * applies migrations non-destructively and seeds fixtures. global-teardown drops only this database.
 */
export default async function globalSetup() {
  const envFile = resolve(__dirname, '../../../.env');
  if (existsSync(envFile)) process.loadEnvFile(envFile);
  const base = new URL(process.env.TEST_DATABASE_URL ?? 'postgresql://pas:pas_dev_only@localhost:5432/pas_test');
  if (!['localhost', '127.0.0.1'].includes(base.hostname)) throw new Error('Integration tests only run against a local PostgreSQL');

  const name = `pas_test_${Date.now()}_${process.pid}`;
  const admin = new URL(base);
  admin.pathname = '/postgres';
  const client = new PrismaClient({ datasourceUrl: admin.toString() });
  await client.$executeRawUnsafe(`CREATE DATABASE "${name}"`);
  await client.$disconnect();

  const url = new URL(base);
  url.pathname = `/${name}`;
  process.env.PAS_TEST_DB_URL = url.toString();
  process.env.PAS_TEST_DB_NAME = name;

  const prisma = `node ${resolve(__dirname, '../../../node_modules/prisma/build/index.js')}`;
  const opts = { cwd: resolve(__dirname, '../../../packages/db'), env: { ...process.env, DATABASE_URL: url.toString() }, stdio: 'pipe' as const };
  execSync(`${prisma} migrate deploy`, opts);
  execSync(`${prisma} db seed`, opts);
}
