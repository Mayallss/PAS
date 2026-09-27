import { INestApplication } from '@nestjs/common';
import { PrismaClient } from '@prisma/client';
import request from 'supertest';
import { createApp } from '../src/bootstrap';

export const prisma = new PrismaClient();

export async function startApp(): Promise<INestApplication> {
  const app = await createApp();
  await app.init();
  return app;
}

export interface Session {
  agent: ReturnType<typeof request.agent>;
  csrf: string;
  userId: string;
}

/** Logs in through the real dev-login endpoint and returns a cookie-carrying agent + CSRF token. */
export async function login(app: INestApplication, email: string): Promise<Session> {
  const agent = request.agent(app.getHttpServer());
  await agent.post('/api/auth/dev-login').send({ email }).expect(204);
  const me = await agent.get('/api/auth/me').expect(200);
  return { agent, csrf: me.body.csrfToken, userId: me.body.user.id };
}

export async function engagementId(customerCode: string, legacyCategoryId: number) {
  const e = await prisma.engagement.findFirstOrThrow({
    where: { customer: { code: customerCode }, workCategory: { legacyId: legacyCategoryId } },
  });
  return e.id;
}
