import { INestApplication } from '@nestjs/common';
import { NestFactory } from '@nestjs/core';
import { NestExpressApplication } from '@nestjs/platform-express';
import compression from 'compression';
import cookieParser from 'cookie-parser';
import { json } from 'express';
import helmet from 'helmet';
import { AppModule } from './app.module';
import { requestIdMiddleware } from './common/request-context';

/** Shared by main.ts and integration tests so tests exercise the real middleware stack. */
export async function createApp(): Promise<INestApplication> {
  const app = await NestFactory.create<NestExpressApplication>(AppModule, {
    logger: process.env.NODE_ENV === 'test' ? ['error'] : ['log', 'warn', 'error'],
  });
  // Behind exactly one proxy (Next.js rewrite locally, AWS Application Load Balancer → Next.js in production).
  app.set('trust proxy', 1);
  app.disable('x-powered-by');
  app.use(requestIdMiddleware);
  app.use(
    helmet({
      contentSecurityPolicy: { directives: { defaultSrc: ["'none'"], frameAncestors: ["'none'"] } },
      crossOriginResourcePolicy: { policy: 'same-origin' },
    }),
  );
  // gzip JSON responses (week payloads shrink ~5-8x); tiny responses are left alone.
  app.use(compression({ threshold: 1024 }));
  app.use(cookieParser());
  // Signature images (รับ–ส่งเอกสาร) are the only large JSON bodies; everything else stays at 100 kB.
  // Parsed first here, the global parser then skips them (body-parser checks req._body).
  for (const path of ['/api/handoffs', '/api/public/handoffs']) app.use(path, json({ limit: '2mb' }));
  app.useBodyParser('json', { limit: '100kb' });
  app.setGlobalPrefix('api');
  // No CORS: the browser reaches the API only through the same-origin /api proxy.
  app.enableShutdownHooks();
  return app;
}
