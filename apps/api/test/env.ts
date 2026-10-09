import { generateKeyPairSync } from 'crypto';
import { existsSync } from 'fs';
import { tmpdir } from 'os';
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
process.env.STORAGE_DIR = resolve(tmpdir(), `pas-test-uploads-${process.env.PAS_TEST_DB_NAME}`);
process.env.UPLOAD_MAX_MB = '1';
// Never the real monday board from tests: .env holds the live token, so override it.
process.env.MONDAY_API_TOKEN = 'test-monday-token';
process.env.MONDAY_HANDOFF_BOARD_ID = '1862570548';
process.env.HANDOFF_LINK_SECRET = 'test-link-secret-0123456789abcdef0123456789abcdef';
// Google Calendar: a throwaway service-account key so the sync code path is "configured"; tests replace the transport
// with a fake Google, and the background worker never runs (interval 0).
const { privateKey: googleKey, publicKey: googlePublicKey } = generateKeyPairSync('rsa', { modulusLength: 2048 });
process.env.GOOGLE_SA_EMAIL = 'pas-sync@pas-test.iam.gserviceaccount.com';
// One line with literal "\n", as it would sit in .env.
process.env.GOOGLE_SA_PRIVATE_KEY = googleKey.export({ type: 'pkcs8', format: 'pem' }).toString().replace(/\n/g, '\\n');
process.env.GOOGLE_TEST_PUBLIC_KEY = googlePublicKey.export({ type: 'spki', format: 'pem' }).toString();
process.env.GOOGLE_COMPANY_CALENDAR_ID = 'company@group.calendar.google.com';
process.env.CALENDAR_SYNC_INTERVAL_MS = '0';
process.env.TRCLOUD_SYNC_INTERVAL_MS = '0';
process.env.TRCLOUD_GROUP_TAX_IDS = '0105599999991';
