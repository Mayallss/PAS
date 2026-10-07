import { createPrivateKey } from 'node:crypto';
import { z } from 'zod';

const schema = z.object({
  NODE_ENV: z.enum(['development', 'test', 'production']).default('development'),
  DATABASE_URL: z.string().min(1),
  API_PORT: z.coerce.number().default(4000),
  /** 127.0.0.1 locally and on ECS (web container reaches it over localhost in the same task). */
  API_HOST: z.string().default('127.0.0.1'),
  APP_ORIGIN: z.string().url().default('http://localhost:3000'),
  SESSION_TTL_HOURS: z.coerce.number().min(1).max(24).default(10),
  TZ_BUSINESS: z.string().default('Asia/Bangkok'),
  OIDC_ISSUER: z.string().optional().default(''),
  OIDC_CLIENT_ID: z.string().optional().default(''),
  OIDC_CLIENT_SECRET: z.string().optional().default(''),
  OIDC_REDIRECT_URI: z.string().optional().default(''),
  /** Optional: only accept identities from this e-mail domain (e.g. pas-acc.com). */
  OIDC_ALLOWED_DOMAIN: z.string().optional().default(''),
  /** Evidence files (IT asset). Local folder in development; Amazon S3 (S3_BUCKET) in production. */
  STORAGE_DIR: z.string().default('var/uploads'),
  /** Amazon S3 bucket for evidence files. Empty = use STORAGE_DIR on local disk. */
  S3_BUCKET: z.string().optional().default(''),
  UPLOAD_MAX_MB: z.coerce.number().min(1).max(50).default(20),
  /** รับ–ส่งเอกสาร (ex-DELIPAS): board work runs with this server-side monday token. Empty = feature shows "not configured". */
  MONDAY_API_TOKEN: z.string().optional().default(''),
  /** Board that holds the document hand-over tickets. */
  MONDAY_HANDOFF_BOARD_ID: z.string().regex(/^\d+$/).default('5031213491'),
  /** Text columns that receive the signer's name and the Thai save time. Column ids differ per board (monday assigns them). */
  MONDAY_HANDOFF_SIGNER_COLUMN: z.string().regex(/^[a-z0-9_]{1,64}$/).default('text_mm7mkazh'),
  MONDAY_HANDOFF_SIGNED_AT_COLUMN: z.string().regex(/^[a-z0-9_]{1,64}$/).default('text_mm7mtsjf'),
  /** Signs share links and save tokens — separate from the monday token (DELIPAS used the token itself). */
  HANDOFF_LINK_SECRET: z.string().optional().default(''),
  /**
   * Google Calendar mirror (docs/09) — a Workspace service account with domain-wide delegation, scope
   * https://www.googleapis.com/auth/calendar. Empty = not connected: bookings and leave queue up and sync once set.
   */
  GOOGLE_SA_EMAIL: z.string().optional().default(''),
  /** PEM private key of the service account; "\n" escapes are accepted (one-line .env values). */
  GOOGLE_SA_PRIVATE_KEY: z.string().optional().default(''),
  /** Shared company calendar every room booking is added to (the "ปฏิทินบริษัท"). Optional. */
  GOOGLE_COMPANY_CALENDAR_ID: z.string().optional().default(''),
  /** Phone reminders on synced bookings, minutes before start. */
  GOOGLE_REMINDER_MINUTES: z
    .string()
    .default('1440,30')
    .transform((v) => v.split(',').map((x) => Number(x.trim())).filter((n) => Number.isInteger(n) && n >= 0 && n <= 40320)),
  /** How often the sync worker runs; 0 = never (tests run it explicitly). */
  CALENDAR_SYNC_INTERVAL_MS: z.coerce.number().min(0).default(60_000),
  /** Username + password sign-in (user decision 2026-10-02): on by default so the portal works without Google. "false" turns it off. */
  PASSWORD_LOGIN: z
    .string()
    .optional()
    .transform((v) => v !== 'false'),
  AUTH_DEV_LOGIN: z
    .string()
    .optional()
    .transform((v) => v === 'true'),
});

/** A problem with an optional integration's settings: that integration is switched off, everything else runs. */
export interface IntegrationIssue {
  integration: 'google_login' | 'google_calendar' | 'monday';
  setting: string;
  message: string;
}

export type AppConfig = z.infer<typeof schema> & {
  oidcEnabled: boolean;
  secureCookies: boolean;
  googleCalendarEnabled: boolean;
  integrationIssues: IntegrationIssue[];
};

/**
 * Settings of OPTIONAL integrations. A wrong value here must never stop the API from starting (the core — time,
 * leave, rooms, assets, … — does not need them): it is reset to its default, the integration is switched off and the
 * reason is reported (GET /api/integrations, boot log). Core settings (database, origin, …) stay strict.
 */
const INTEGRATION_SETTINGS: Record<string, IntegrationIssue['integration']> = {
  OIDC_ISSUER: 'google_login',
  OIDC_CLIENT_ID: 'google_login',
  OIDC_CLIENT_SECRET: 'google_login',
  OIDC_REDIRECT_URI: 'google_login',
  OIDC_ALLOWED_DOMAIN: 'google_login',
  MONDAY_API_TOKEN: 'monday',
  MONDAY_HANDOFF_BOARD_ID: 'monday',
  MONDAY_HANDOFF_SIGNER_COLUMN: 'monday',
  MONDAY_HANDOFF_SIGNED_AT_COLUMN: 'monday',
  HANDOFF_LINK_SECRET: 'monday',
  GOOGLE_SA_EMAIL: 'google_calendar',
  GOOGLE_SA_PRIVATE_KEY: 'google_calendar',
  GOOGLE_COMPANY_CALENDAR_ID: 'google_calendar',
  GOOGLE_REMINDER_MINUTES: 'google_calendar',
  CALENDAR_SYNC_INTERVAL_MS: 'google_calendar',
};

let cached: AppConfig | undefined;

export function loadConfig(env: NodeJS.ProcessEnv = process.env): AppConfig {
  if (cached) return cached;
  const issues: IntegrationIssue[] = [];
  const input: Record<string, string | undefined> = { ...env };
  let result = schema.safeParse(input);
  if (!result.success) {
    const bad = [...new Set(result.error.issues.map((i) => String(i.path[0])))];
    const core = bad.filter((k) => !INTEGRATION_SETTINGS[k]);
    if (core.length) throw result.error; // core settings stay strict
    for (const k of bad) {
      issues.push({ integration: INTEGRATION_SETTINGS[k], setting: k, message: 'ค่าไม่ถูกต้อง — ใช้ค่าตั้งต้นและปิดการเชื่อมต่อนี้ไว้' });
      delete input[k];
    }
    result = schema.safeParse(input);
    if (!result.success) throw result.error;
  }
  const parsed = result.data;
  if (parsed.NODE_ENV === 'production' && parsed.AUTH_DEV_LOGIN) {
    throw new Error('AUTH_DEV_LOGIN must not be enabled in production');
  }
  const off = (i: IntegrationIssue['integration']) => issues.some((x) => x.integration === i);

  let oidcEnabled = Boolean(parsed.OIDC_ISSUER && parsed.OIDC_CLIENT_ID && parsed.OIDC_REDIRECT_URI) && !off('google_login');
  if (oidcEnabled && !/^https:\/\//.test(parsed.OIDC_ISSUER) && parsed.NODE_ENV === 'production') {
    issues.push({ integration: 'google_login', setting: 'OIDC_ISSUER', message: 'ต้องเป็น https:// — ปิดการเข้าสู่ระบบด้วย Google ไว้' });
    oidcEnabled = false;
  }

  let googleCalendarEnabled = Boolean(parsed.GOOGLE_SA_EMAIL && parsed.GOOGLE_SA_PRIVATE_KEY) && !off('google_calendar');
  if (googleCalendarEnabled) {
    if (!/^[^@\s]+@[^@\s]+\.iam\.gserviceaccount\.com$/.test(parsed.GOOGLE_SA_EMAIL)) {
      issues.push({ integration: 'google_calendar', setting: 'GOOGLE_SA_EMAIL', message: 'ไม่ใช่อีเมล Service Account (…@….iam.gserviceaccount.com)' });
      googleCalendarEnabled = false;
    }
    try {
      createPrivateKey(parsed.GOOGLE_SA_PRIVATE_KEY.replace(/\\n/g, '\n'));
    } catch {
      issues.push({ integration: 'google_calendar', setting: 'GOOGLE_SA_PRIVATE_KEY', message: 'อ่าน private key ไม่ได้ (ต้องเป็น PEM จากไฟล์ key ของ Service Account)' });
      googleCalendarEnabled = false;
    }
  }

  cached = { ...parsed, oidcEnabled, secureCookies: parsed.APP_ORIGIN.startsWith('https://'), googleCalendarEnabled, integrationIssues: issues };
  for (const i of issues) console.warn(`[config] ${i.integration}: ${i.setting} — ${i.message}`);
  return cached;
}

export function resetConfigForTests() {
  cached = undefined;
}
