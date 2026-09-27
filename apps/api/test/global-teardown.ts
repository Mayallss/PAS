import { PrismaClient } from '@prisma/client';

/** Drops only the ephemeral database created by global-setup for this run. */
export default async function globalTeardown() {
  const name = process.env.PAS_TEST_DB_NAME;
  const url = process.env.PAS_TEST_DB_URL;
  if (!name || !url || !/^pas_test_\d+_\d+$/.test(name)) return;
  const admin = new URL(url);
  admin.pathname = '/postgres';
  const client = new PrismaClient({ datasourceUrl: admin.toString() });
  await client.$executeRawUnsafe(`DROP DATABASE IF EXISTS "${name}" WITH (FORCE)`);
  await client.$disconnect();
}
