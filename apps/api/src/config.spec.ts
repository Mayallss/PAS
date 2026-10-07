import { generateKeyPairSync } from 'crypto';
import { loadConfig, resetConfigForTests } from './config';

/** Optional integrations must never stop the API from starting (docs/09 §6). */
const base = { DATABASE_URL: 'postgresql://x@localhost/x', NODE_ENV: 'test' } as NodeJS.ProcessEnv;
const key = generateKeyPairSync('rsa', { modulusLength: 2048 }).privateKey.export({ type: 'pkcs8', format: 'pem' }).toString();

afterEach(() => resetConfigForTests());
afterAll(() => resetConfigForTests());

const load = (env: Record<string, string>) => {
  resetConfigForTests();
  const warn = jest.spyOn(console, 'warn').mockImplementation(() => undefined);
  try {
    return loadConfig({ ...base, ...env });
  } finally {
    warn.mockRestore();
  }
};

it('an invalid integration setting switches that integration off instead of crashing', () => {
  const c = load({ MONDAY_HANDOFF_BOARD_ID: 'not-a-number', CALENDAR_SYNC_INTERVAL_MS: '-5', GOOGLE_SA_EMAIL: 'x@p.iam.gserviceaccount.com', GOOGLE_SA_PRIVATE_KEY: key.replace(/\n/g, '\\n') });
  expect(c.MONDAY_HANDOFF_BOARD_ID).toBe('1862570548'); // back to the default
  expect(c.integrationIssues.map((i) => i.setting).sort()).toEqual(['CALENDAR_SYNC_INTERVAL_MS', 'MONDAY_HANDOFF_BOARD_ID']);
  expect(c.googleCalendarEnabled).toBe(false); // its interval setting was wrong → whole integration off
});

it('a broken Google key or account disables Google Calendar only', () => {
  const bad = load({ GOOGLE_SA_EMAIL: 'x@p.iam.gserviceaccount.com', GOOGLE_SA_PRIVATE_KEY: 'not a key' });
  expect(bad.googleCalendarEnabled).toBe(false);
  expect(bad.integrationIssues).toEqual([expect.objectContaining({ integration: 'google_calendar', setting: 'GOOGLE_SA_PRIVATE_KEY' })]);
  const ok = load({ GOOGLE_SA_EMAIL: 'x@p.iam.gserviceaccount.com', GOOGLE_SA_PRIVATE_KEY: key.replace(/\n/g, '\\n') });
  expect(ok.googleCalendarEnabled).toBe(true);
  expect(ok.integrationIssues).toEqual([]);
  expect(load({}).googleCalendarEnabled).toBe(false); // not set at all = simply off, not an error
});

it('core settings stay strict', () => {
  resetConfigForTests();
  expect(() => loadConfig({ NODE_ENV: 'test' } as NodeJS.ProcessEnv)).toThrow(); // no DATABASE_URL
  expect(() => load({ APP_ORIGIN: 'not a url' })).toThrow();
});
