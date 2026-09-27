import { existsSync } from 'fs';
import { resolve } from 'path';

const envFile = resolve(__dirname, '../../../.env');
if (existsSync(envFile)) process.loadEnvFile(envFile);

process.env.NODE_ENV = 'test';
if (!process.env.PAS_TEST_DB_URL) throw new Error('Run tests through jest (global-setup creates the test database)');
process.env.DATABASE_URL = process.env.PAS_TEST_DB_URL;
process.env.AUTH_DEV_LOGIN = 'true';
process.env.APP_ORIGIN = 'http://localhost:3000';
process.env.OIDC_ISSUER = '';
process.env.LOGIN_RATE_LIMIT = '30';
