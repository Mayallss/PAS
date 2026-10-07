/** Production-safe: create/update only the sidebar apps (IT assets, Delivery System, Document Store, …). */
import { PrismaClient } from '@prisma/client';
import { seedApps } from './apps';

const prisma = new PrismaClient();

seedApps(prisma)
  .then(async () => console.log(`[seed-apps] ${await prisma.appLink.count()} apps in app_link`))
  .catch((e) => {
    console.error(e);
    process.exitCode = 1;
  })
  .finally(() => prisma.$disconnect());
