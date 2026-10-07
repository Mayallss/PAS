/**
 * First administrator on a fresh production database (no one can issue set-password links yet).
 * Creates (or reuses) an employee with EMPLOYEE + ADMIN roles and prints a one-time set-password link.
 *
 *   BOOTSTRAP_EMAIL=you@pas-acc.com BOOTSTRAP_NAME="ชื่อ นามสกุล" BOOTSTRAP_USERNAME=you \
 *   APP_ORIGIN=https://portal.example.com npx tsx prisma/bootstrap-admin.ts
 *
 * On AWS this runs as a one-off ECS task (infra/scripts/bootstrap-admin.ps1); the link appears in CloudWatch Logs.
 * The token is stored only as SHA-256, matching apps/api/src/modules/auth/password.service.ts.
 */
import { createHash, randomBytes } from 'node:crypto';
import { PrismaClient } from '@prisma/client';

const prisma = new PrismaClient();
const USERNAME_RE = /^[a-z0-9._-]{3,40}$/;
const SETUP_HOURS = 72;

async function main() {
  const email = (process.env.BOOTSTRAP_EMAIL ?? '').trim().toLowerCase();
  const fullName = (process.env.BOOTSTRAP_NAME ?? '').trim() || email;
  const username = (process.env.BOOTSTRAP_USERNAME ?? email.split('@')[0] ?? '').trim().toLowerCase();
  const origin = (process.env.APP_ORIGIN ?? 'http://localhost:3000').replace(/\/+$/, '');
  if (!/^[^@\s]+@[^@\s]+$/.test(email)) throw new Error('Set BOOTSTRAP_EMAIL');
  if (!USERNAME_RE.test(username)) throw new Error('BOOTSTRAP_USERNAME must be a-z 0-9 . _ - (3–40 chars)');

  const employee =
    (await prisma.employee.findFirst({ where: { email: { equals: email, mode: 'insensitive' } } })) ??
    (await prisma.employee.create({ data: { email, fullName, startDate: new Date() } }));

  for (const key of ['EMPLOYEE', 'ADMIN']) {
    const role = await prisma.role.findUniqueOrThrow({ where: { key } });
    const has = await prisma.roleAssignment.findFirst({ where: { employeeId: employee.id, roleId: role.id, orgUnitId: null } });
    if (!has) await prisma.roleAssignment.create({ data: { employeeId: employee.id, roleId: role.id } });
  }

  const taken = await prisma.localCredential.findUnique({ where: { username } });
  if (taken && taken.employeeId !== employee.id) throw new Error(`Username "${username}" is already used by another employee`);

  const token = randomBytes(32).toString('base64url');
  const tokenHash = createHash('sha256').update(token).digest('hex');
  const expires = new Date(Date.now() + SETUP_HOURS * 3_600_000);
  await prisma.localCredential.upsert({
    where: { employeeId: employee.id },
    create: { employeeId: employee.id, username, setupTokenHash: tokenHash, setupExpiresAt: expires },
    update: { username, setupTokenHash: tokenHash, setupExpiresAt: expires },
  });

  console.log(`[bootstrap-admin] employee=${employee.id} username=${username} (EMPLOYEE, ADMIN)`);
  console.log(`[bootstrap-admin] SET-PASSWORD LINK (valid ${SETUP_HOURS}h): ${origin}/set-password?token=${token}`);
}

main()
  .catch((e) => {
    console.error(e);
    process.exitCode = 1;
  })
  .finally(() => prisma.$disconnect());
