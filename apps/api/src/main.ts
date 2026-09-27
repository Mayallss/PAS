import 'reflect-metadata';
import { existsSync } from 'fs';
import { resolve } from 'path';
import { Logger } from '@nestjs/common';
import { DocumentBuilder, SwaggerModule } from '@nestjs/swagger';
import { createApp } from './bootstrap';
import { loadConfig } from './config';

// Local development: load the repo-root .env (production injects env vars from Secret Manager).
const envFile = resolve(__dirname, '../../../.env');
if (existsSync(envFile)) process.loadEnvFile(envFile);

// Dev only: exit if the dev runner (scripts/dev.mjs) is gone, so no orphan keeps the port busy on Windows.
const devParent = Number(process.env.PAS_DEV_PARENT_PID);
if (devParent) {
  setInterval(() => {
    try {
      process.kill(devParent, 0);
    } catch {
      process.exit(0);
    }
  }, 2000).unref();
}

async function main() {
  const config = loadConfig();
  const app = await createApp();
  if (config.NODE_ENV !== 'production') {
    const doc = SwaggerModule.createDocument(app, new DocumentBuilder().setTitle('PAS Platform API').setVersion('0.1').build());
    SwaggerModule.setup('api/docs', app, doc);
  }
  await app.listen(config.API_PORT, config.API_HOST);
  Logger.log(`API listening on http://${config.API_HOST}:${config.API_PORT}/api (SSO: ${config.oidcEnabled}, dev login: ${config.AUTH_DEV_LOGIN})`, 'bootstrap');
}

void main();
