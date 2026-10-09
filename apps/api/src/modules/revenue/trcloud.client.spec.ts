import { createHash } from 'node:crypto';
import { buildRequest, explain, redact, secureKey } from './trcloud.client';

const s = { baseUrl: 'https://example.trcloud.co/', companyId: '42', passkey: 'pass-xyz', encryptHead: 'head-abc', origin: 'https://portal.example.com' };

describe('TRCLOUD request (manual §4–5)', () => {
  it('securekey = md5(Encrypt Head + "t" + timestamp)', () => {
    expect(secureKey('head-abc', 1760000000)).toBe(createHash('md5').update('head-abct1760000000').digest('hex'));
  });

  it('POST to …/end-point/{group}/{command}.php, Origin header, one multipart field "json" with the 4 base values', async () => {
    const { url, init } = buildRequest(s, 'contact', 'search', { page: 1 }, 1760000000_123);
    expect(url).toBe('https://example.trcloud.co/application/api-connector2/end-point/contact/search.php');
    expect(init.method).toBe('POST');
    expect(init.headers.Origin).toBe('https://portal.example.com');
    const fields = [...(init.body as FormData).keys()];
    expect(fields).toEqual(['json']);
    const json = JSON.parse((init.body as FormData).get('json') as string);
    expect(json).toEqual({ page: 1, company_id: '42', passkey: 'pass-xyz', timestamp: 1760000000, securekey: secureKey('head-abc', 1760000000) });
    expect(JSON.stringify(json)).not.toContain('head-abc'); // the Encrypt Head never leaves the server
  });

  it('a fresh signature per call; endpoint params cannot override the credentials', () => {
    const a = JSON.parse(buildRequest(s, 'contact', 'search', {}, 1_000_000).init.body.get('json') as string);
    const b = JSON.parse(buildRequest(s, 'contact', 'search', { passkey: 'evil', company_id: '1' }, 2_000_000).init.body.get('json') as string);
    expect(a.securekey).not.toBe(b.securekey);
    expect(b).toMatchObject({ passkey: 'pass-xyz', company_id: '42' });
  });

  it('read-only: create / update / delete are refused, and the group cannot inject a path', () => {
    expect(() => buildRequest(s, 'contact', 'delete' as 'read', {})).toThrow(/read commands/);
    expect(() => buildRequest(s, '../x', 'search', {})).toThrow(/bad TRCLOUD group/);
    expect(buildRequest(s, 'report', 'b3', {}).url).toMatch(/end-point\/report\/b3\.php$/); // the invoice report: named, read-only
    expect(() => buildRequest(s, 'contact', 'b3', {})).toThrow(/read commands/);
  });

  it('a passkey echoed back by TRCLOUD is never logged or shown', () => {
    const msg = 'Passkey Error!\nYour data is sent from X\nPasskey 7873a9b2aedb21bab21d00377354d6d4 is not matched; head head-abc; pass-xyz';
    const out = redact(msg, s);
    expect(out).not.toMatch(/7873a9b2|head-abc|pass-xyz/);
    expect(out).toContain('‹hidden›');
  });

  it('known TRCLOUD messages become actionable Thai text', () => {
    expect(explain('Secure key is expired!')).toMatch(/นาฬิกา/);
    expect(explain('Reach API usage limit (quota: 1000, usage: 1000)')).toMatch(/โควตา/);
    expect(explain('Origin Error! You did not set Origin-header.')).toMatch(/Origin/);
  });
});
