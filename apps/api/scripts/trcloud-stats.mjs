// Aggregate facts about a TRCLOUD search answer — counts and field patterns only, no names, ids or numbers.
//   node --env-file=../../.env scripts/trcloud-stats.mjs <group> ['{"params":1}']
import { createHash } from 'node:crypto';

const [group, rawParams = '{}'] = process.argv.slice(2);
const env = process.env;
const timestamp = Math.floor(Date.now() / 1000);
const body = new FormData();
body.append('json', JSON.stringify({ ...JSON.parse(rawParams), company_id: env.TRCLOUD_COMPANY_ID, passkey: env.TRCLOUD_PASSKEY, timestamp, securekey: createHash('md5').update(`${env.TRCLOUD_ENCRYPT_HEAD}t${timestamp}`).digest('hex') }));
const res = await fetch(`${env.TRCLOUD_BASE_URL.replace(/\/+$/, '')}/application/api-connector2/end-point/${group}/search.php`, { method: 'POST', headers: { Origin: env.TRCLOUD_ORIGIN }, body });
const data = await res.json();
const redact = (s) => String(s).split(env.TRCLOUD_PASSKEY).join('‹passkey›').replace(/\b[0-9a-f]{32}\b/gi, '‹hidden›');
const rows = Array.isArray(data.result) ? data.result : [];
const shape = (v) => String(v ?? '').replace(/[A-Za-z]/g, 'A').replace(/\d/g, '9').replace(/[\u0E00-\u0E7F]/g, 'ก');
const tally = (f) => Object.entries(rows.reduce((m, r) => ((m[f(r)] = (m[f(r)] ?? 0) + 1), m), {})).sort((a, b) => b[1] - a[1]).slice(0, 8);
console.log(JSON.stringify({
  params: JSON.parse(rawParams),
  success: data.success,
  message: redact(data.message ?? ''),
  topLevelKeys: Object.keys(data),
  rows: rows.length,
  title_equals_document_number: rows.filter((r) => r.title === r.document_number).length,
  title_shapes: tally((r) => shape(r.title)),
  contact_type_values: tally((r) => r.contact_type),
  obsolete_values: tally((r) => r.obsolete),
  filled: Object.fromEntries(['name', 'organization', 'tax_id', 'address', 'branch'].map((f) => [f, rows.filter((r) => String(r[f] ?? '').trim()).length])),
  ids_fingerprint: createHash('sha256').update(rows.map((r) => r.contact_id).sort().join(',')).digest('hex').slice(0, 10),
  name_vs_org: tally((r) => (String(r.name ?? '').trim() ? 'name' : '-') + '+' + (String(r.organization ?? '').trim() ? 'org' : '-') + (r.name && r.organization && r.name === r.organization ? '(same)' : '')),
  other_keys: [...new Set(rows.flatMap((r) => { try { return Object.keys(JSON.parse(r.other || '{}')); } catch { return ['(not json)']; } }))],
}, null, 1));
