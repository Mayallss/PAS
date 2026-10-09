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
  MONDAY_HANDOFF_BOARD_ID: z.string().regex(/^\d+$/).default('1862570548'),
  /** Text columns that receive the signer's name and the Thai save time. Column ids differ per board (monday assigns them). */
  MONDAY_HANDOFF_SIGNER_COLUMN: z.string().regex(/^[a-z0-9_]{1,64}$/).default('text_mm7xtpds'),
  MONDAY_HANDOFF_SIGNED_AT_COLUMN: z.string().regex(/^[a-z0-9_]{1,64}$/).default('text_mm7x9rpf'),
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
  /**
   * TRCLOUD (accounting) — contacts and sales invoices are pulled from here (revenue). All four values come from
   * TRCLOUD → RESTFUL API → Setting → API Key. Empty = not connected; Excel import still works.
   */
  TRCLOUD_BASE_URL: z.string().optional().default(''),
  TRCLOUD_COMPANY_ID: z.string().optional().default(''),
  TRCLOUD_PASSKEY: z.string().optional().default(''),
  /** Second secret: only used to compute securekey = md5(encryptHead + "t" + timestamp); never sent. */
  TRCLOUD_ENCRYPT_HEAD: z.string().optional().default(''),
  /** Sent as the Origin header; must equal the API key's Origin in TRCLOUD (or the key is set to ANY). */
  TRCLOUD_ORIGIN: z.string().optional().default(''),
  /**
   * The group's other companies on the same TRCLOUD (user decision 2026-10-09: PAS, PC, PA). TRCLOUD_COMPANY_ID /
   * PASSKEY / ENCRYPT_HEAD above are PAS; PC and PA each have their own API key. Empty = that company is not synced.
   */
  TRCLOUD_PC_COMPANY_ID: z.string().optional().default(''),
  TRCLOUD_PC_PASSKEY: z.string().optional().default(''),
  TRCLOUD_PC_ENCRYPT_HEAD: z.string().optional().default(''),
  TRCLOUD_PA_COMPANY_ID: z.string().optional().default(''),
  TRCLOUD_PA_PASSKEY: z.string().optional().default(''),
  TRCLOUD_PA_ENCRYPT_HEAD: z.string().optional().default(''),
  /** Tax ids of the group's own companies (comma separated): invoices between them are not revenue and they never become customers. */
  TRCLOUD_GROUP_TAX_IDS: z
    .string()
    .default('')
    .transform((v) => v.split(',').map((x) => x.replace(/\D/g, '')).filter((x) => x.length === 13)),
  /** Contacts → customers, then the last 12 months of revenue, run on their own this often (also when the customers or
   *  revenue page opens and the last run is older than 10 minutes); 0 = never on a timer. */
  TRCLOUD_SYNC_INTERVAL_MS: z.coerce.number().min(0).default(60 * 60 * 1000),
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
  integration: 'google_login' | 'google_calendar' | 'monday' | 'trcloud';
  setting: string;
  message: string;
}

/** The group's companies on TRCLOUD. */
export type TrcloudCompanyKey = 'PAS' | 'PC' | 'PA';
export const TRCLOUD_COMPANY_KEYS: TrcloudCompanyKey[] = ['PAS', 'PC', 'PA'];
export interface TrcloudCompany {
  key: TrcloudCompanyKey;
  companyId: string;
  passkey: string;
  encryptHead: string;
}

export type AppConfig = z.infer<typeof schema> & {
  oidcEnabled: boolean;
  secureCookies: boolean;
  googleCalendarEnabled: boolean;
  trcloudEnabled: boolean;
  /** Companies with a complete API key, in priority order (PAS first: its codes and names win). */
  trcloudCompanies: TrcloudCompany[];
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
  TRCLOUD_BASE_URL: 'trcloud',
  TRCLOUD_COMPANY_ID: 'trcloud',
  TRCLOUD_PASSKEY: 'trcloud',
  TRCLOUD_ENCRYPT_HEAD: 'trcloud',
  TRCLOUD_ORIGIN: 'trcloud',
  TRCLOUD_PC_COMPANY_ID: 'trcloud',
  TRCLOUD_PC_PASSKEY: 'trcloud',
  TRCLOUD_PC_ENCRYPT_HEAD: 'trcloud',
  TRCLOUD_PA_COMPANY_ID: 'trcloud',
  TRCLOUD_PA_PASSKEY: 'trcloud',
  TRCLOUD_PA_ENCRYPT_HEAD: 'trcloud',
  TRCLOUD_GROUP_TAX_IDS: 'trcloud',
  TRCLOUD_SYNC_INTERVAL_MS: 'trcloud',
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

  const trcloudSet = [parsed.TRCLOUD_BASE_URL, parsed.TRCLOUD_COMPANY_ID, parsed.TRCLOUD_PASSKEY, parsed.TRCLOUD_ENCRYPT_HEAD, parsed.TRCLOUD_ORIGIN];
  let trcloudEnabled = trcloudSet.every(Boolean) && !off('trcloud');
  if (trcloudSet.some(Boolean) && !trcloudSet.every(Boolean)) {
    issues.push({ integration: 'trcloud', setting: 'TRCLOUD_*', message: 'ตั้งค่าไม่ครบ 5 ค่า (BASE_URL, COMPANY_ID, PASSKEY, ENCRYPT_HEAD, ORIGIN) — ปิดการเชื่อมต่อ TRCLOUD ไว้' });
  }
  if (trcloudEnabled && !/^https:\/\/[^/\s]+\/?$/.test(parsed.TRCLOUD_BASE_URL)) {
    issues.push({ integration: 'trcloud', setting: 'TRCLOUD_BASE_URL', message: 'ต้องเป็น https://<โดเมน> เท่านั้น (ไม่ต้องมี path)' });
    trcloudEnabled = false;
  }

  const trcloudCompanies: TrcloudCompany[] = [];
  if (trcloudEnabled) {
    trcloudCompanies.push({ key: 'PAS', companyId: parsed.TRCLOUD_COMPANY_ID, passkey: parsed.TRCLOUD_PASSKEY, encryptHead: parsed.TRCLOUD_ENCRYPT_HEAD });
    for (const key of ['PC', 'PA'] as const) {
      const set = [parsed[`TRCLOUD_${key}_COMPANY_ID`], parsed[`TRCLOUD_${key}_PASSKEY`], parsed[`TRCLOUD_${key}_ENCRYPT_HEAD`]];
      if (set.every(Boolean)) trcloudCompanies.push({ key, companyId: set[0], passkey: set[1], encryptHead: set[2] });
      else if (set.some(Boolean)) issues.push({ integration: 'trcloud', setting: `TRCLOUD_${key}_*`, message: `ตั้งค่าบริษัท ${key} ไม่ครบ 3 ค่า (COMPANY_ID, PASSKEY, ENCRYPT_HEAD) — ยังไม่ซิงก์บริษัทนี้` });
    }
  }

  cached = { ...parsed, oidcEnabled, secureCookies: parsed.APP_ORIGIN.startsWith('https://'), googleCalendarEnabled, trcloudEnabled, trcloudCompanies, integrationIssues: issues };
  for (const i of issues) console.warn(`[config] ${i.integration}: ${i.setting} — ${i.message}`);
  return cached;
}

export function resetConfigForTests() {
  cached = undefined;
}
