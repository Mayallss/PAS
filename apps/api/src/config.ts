import { z } from 'zod';

const schema = z.object({
  NODE_ENV: z.enum(['development', 'test', 'production']).default('development'),
  DATABASE_URL: z.string().min(1),
  API_PORT: z.coerce.number().default(4000),
  /** 127.0.0.1 locally; 0.0.0.0 in containers (Cloud Run). */
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
  AUTH_DEV_LOGIN: z
    .string()
    .optional()
    .transform((v) => v === 'true'),
});

export type AppConfig = z.infer<typeof schema> & { oidcEnabled: boolean; secureCookies: boolean };

let cached: AppConfig | undefined;

export function loadConfig(env: NodeJS.ProcessEnv = process.env): AppConfig {
  if (cached) return cached;
  const parsed = schema.parse(env);
  if (parsed.NODE_ENV === 'production' && parsed.AUTH_DEV_LOGIN) {
    throw new Error('AUTH_DEV_LOGIN must not be enabled in production');
  }
  const oidcEnabled = Boolean(parsed.OIDC_ISSUER && parsed.OIDC_CLIENT_ID && parsed.OIDC_REDIRECT_URI);
  cached = { ...parsed, oidcEnabled, secureCookies: parsed.APP_ORIGIN.startsWith('https://') };
  return cached;
}

export function resetConfigForTests() {
  cached = undefined;
}
