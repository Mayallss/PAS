// Shows the SHAPE of a TRCLOUD read endpoint's answer, to map its fields — values are masked.
//   node --env-file=../../.env scripts/trcloud-probe.mjs <group> <command> ['{"json":"params"}']
//   e.g. node --env-file=../../.env scripts/trcloud-probe.mjs contact search '{}'
// Read commands only (search / read). Never prints the passkey or Encrypt Head.
import { createHash } from 'node:crypto';

const [group, command = 'search', rawParams = '{}'] = process.argv.slice(2);
if (!group || !/^[a-z0-9_]+$/.test(group) || !['search', 'read'].includes(command)) {
  console.error('usage: trcloud-probe.mjs <group> <search|read> [params-json]');
  process.exit(2);
}
const env = process.env;
for (const k of ['TRCLOUD_BASE_URL', 'TRCLOUD_COMPANY_ID', 'TRCLOUD_PASSKEY', 'TRCLOUD_ENCRYPT_HEAD', 'TRCLOUD_ORIGIN']) {
  if (!env[k]) {
    console.error(`${k} is not set in .env`);
    process.exit(2);
  }
}
const timestamp = Math.floor(Date.now() / 1000);
const json = {
  ...JSON.parse(rawParams),
  company_id: env.TRCLOUD_COMPANY_ID,
  passkey: env.TRCLOUD_PASSKEY,
  timestamp,
  securekey: createHash('md5').update(`${env.TRCLOUD_ENCRYPT_HEAD}t${timestamp}`).digest('hex'),
};
const body = new FormData();
body.append('json', JSON.stringify(json));
const url = `${env.TRCLOUD_BASE_URL.replace(/\/+$/, '')}/application/api-connector2/end-point/${group}/${command}.php`;
const res = await fetch(url, { method: 'POST', headers: { Origin: env.TRCLOUD_ORIGIN }, body, signal: AbortSignal.timeout(30_000) });
const text = await res.text();
let data;
try {
  data = JSON.parse(text);
} catch {
  console.log(`HTTP ${res.status} — not JSON:`, text.slice(0, 300));
  process.exit(1);
}

/** Strings → "‹text len›" with the first 2 characters, numbers → "‹number›", so the structure shows but not the data. */
function mask(v, depth = 0) {
  if (Array.isArray(v)) return v.length ? [mask(v[0], depth + 1), `… ${v.length} items`] : [];
  if (v && typeof v === 'object') return Object.fromEntries(Object.entries(v).map(([k, x]) => [k, mask(x, depth + 1)]));
  if (typeof v === 'string') return v === '' ? '' : `‹text ${v.length}: ${v.slice(0, 2)}…›`;
  if (typeof v === 'number') return '‹number›';
  return v;
}
console.log(`HTTP ${res.status} · success=${data.success} · message=${JSON.stringify(data.message ?? '')}`);
const { success, message, ...rest } = data;
console.log(JSON.stringify(mask(rest), null, 2));
