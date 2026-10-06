#!/usr/bin/env node
/**
 * One-time import of "สำรวจความเพียงพอของอุปกรณ์.xlsx" (docs/07 §9) into the IT asset register.
 *
 *   node --env-file=../../.env scripts/import-equipment-survey.mjs <file.xlsx> --by <it-email> [--apply]
 *
 * Dry run by default: prints what would happen. `--apply` writes everything in one transaction.
 * Idempotent: asset codes / licences / seats that already exist are skipped, so it can be re-run.
 *
 * Scope (user decision 2026-09-30): machines are NOT linked to employees yet — the sheet's user column is
 * kept in the asset note so IT can assign holders later. Only whitelisted columns are read.
 *   - tab 09.69          → Asset (NOTEBOOK / DESKTOP / SERVER) with specs, cost, vendor, status
 *   - tab จอเสริม         → Asset (MONITOR); rows whose purchase is unclear are reported, not imported
 *   - List-ESET_2026, ESET2025-2026 → Software + SoftwareLicense per year and lot + LicenseAssignment per machine
 *   - tabs 02.69–08.69, อัพเกรด 2026, ขอซื้อ NB ใหม่: not imported (history needs holders; upgrade tab has shifted rows)
 */
import ExcelJS from 'exceljs';
import { PrismaClient } from '@prisma/client';

const args = process.argv.slice(2);
const file = args.find((a) => !a.startsWith('--'));
const apply = args.includes('--apply');
const byEmail = args[args.indexOf('--by') + 1];
if (!file || !args.includes('--by') || !byEmail) {
  console.error('usage: import-equipment-survey.mjs <file.xlsx> --by <email of the IT user recording this> [--apply]');
  process.exit(2);
}

const SURVEY_TAB = '09.69';
const SURVEY_MONTH = '2026-09-01';
const MONITOR_TAB = 'จอเสริม';
const ESET_TABS = [
  { tab: 'ESET2025-2026', period: '2025–2026', lotCol: 'หมายเหตุ' },
  { tab: 'List-ESET_2026', period: '2026–2027', lotCol: 'Lot' },
];
const ESET_NAME = 'ESET Smart Security Premium';

// ---------------------------------------------------------------------------
// Cell helpers
// ---------------------------------------------------------------------------

function value(cell) {
  let v = cell?.value;
  if (v && typeof v === 'object' && !(v instanceof Date)) {
    if ('result' in v) v = v.result;
    else if ('richText' in v) v = v.richText.map((r) => r.text).join('');
    else if ('text' in v) v = v.text;
  }
  return v ?? null;
}
const text = (v) => (v === null || v === undefined ? '' : v instanceof Date ? v.toISOString().slice(0, 10) : String(v).replace(/\s+/g, ' ').trim());
const isoDate = (v) => (v instanceof Date && !Number.isNaN(v.getTime()) ? v.toISOString().slice(0, 10) : null);
const num = (v) => (typeof v === 'number' ? v : v && !Number.isNaN(Number(v)) ? Number(v) : null);
const blank = (s) => !s || s === '-' || s === 'N/A';

/** Rows of a tab as objects keyed by header text (header row = the first row containing `mustHave`). */
function rowsOf(ws, mustHave) {
  let header = null;
  const out = [];
  ws.eachRow({ includeEmpty: false }, (row, n) => {
    const cells = [];
    for (let c = 1; c <= ws.columnCount; c++) cells.push(value(row.getCell(c)));
    if (!header) {
      if (cells.some((x) => text(x) === mustHave)) header = cells.map((x) => text(x));
      return;
    }
    const obj = { _row: n };
    header.forEach((h, i) => h && !(h in obj) && (obj[h] = cells[i]));
    out.push(obj);
  });
  if (!header) throw new Error(`tab "${ws.name}": header "${mustHave}" not found`);
  return out;
}

// ---------------------------------------------------------------------------
// Normalisation
// ---------------------------------------------------------------------------

/** Same supplier spelled differently across rows → one Vendor. */
const VENDOR_ALIASES = [
  [/ชิชาง/, 'บจ.ชิชาง คอมพิวเตอร์'],
  [/ไอที\s*ซิตี้|ไอทีซิตี้|^it\s*city$/i, 'บมจ.ไอที ซิตี้'],
  [/ท[๊็]อปมาร์เก็ตติ้ง/, 'หจก.ท็อปมาร์เก็ตติ้ง'],
  [/^advice$/i, 'Advice'],
];
function vendorName(raw) {
  const s = text(raw);
  if (blank(s)) return null;
  for (const [re, name] of VENDOR_ALIASES) if (re.test(s)) return name;
  return s;
}

function categoryKey(type, userLabel, model) {
  // "เครื่อง Server" is the server; "เก็บห้องServer" only says where a spare machine is stored.
  if (/เครื่อง\s*Server/i.test(userLabel) || /poweredge/i.test(model)) return 'SERVER';
  return type === 'PC' ? 'DESKTOP' : 'NOTEBOOK';
}

/** docs/07 §11 display states: ไม่เหมาะกับการใช้งานปัจจุบันแล้ว → RETIRED, ไม่พร้อมใช้งาน → BROKEN, otherwise usable. */
function statusOf(userStatus, machineStatus) {
  if (/ไม่เหมาะกับการใช้งานปัจจุบัน/.test(userStatus)) return 'RETIRED';
  if (/ไม่พร้อมใช้งาน/.test(machineStatus)) return 'BROKEN';
  return 'ACTIVE';
}

const normCode = (s) => text(s).toUpperCase().replace(/[^A-Z0-9]/g, '');

// ---------------------------------------------------------------------------
// Read
// ---------------------------------------------------------------------------

const wb = new ExcelJS.Workbook();
await wb.xlsx.readFile(file);
const tab = (name) => {
  const ws = wb.getWorksheet(name);
  if (!ws) throw new Error(`tab "${name}" not found`);
  return ws;
};

const report = { assets: [], monitors: [], skipped: [], vendors: new Set(), eset: [], esetUnmatched: [], noAntivirusListed: [], noAntivirus: [], warnings: [] };

// --- computers (tab 09.69)
const machines = [];
for (const r of rowsOf(tab(SURVEY_TAB), 'รหัสสินทรัพย์')) {
  const code = text(r['รหัสสินทรัพย์']).toUpperCase();
  if (!code) continue;
  const userLabel = text(r['ชื่อผู้ใช้']);
  const nickname = text(r['ชื่อเล่น']);
  const userStatus = text(r['สถานะผู้ใช้งาน']);
  const machineStatus = text(r['สถานะเครื่อง']);
  const modelRaw = text(r['ชื่อรุ่น']);
  const serial = modelRaw.match(/S\/N\s*([A-Z0-9]{6,})/i)?.[1] ?? null;
  const brandRaw = text(r['ยี่ห้อ']);
  let model = modelRaw.replace(/^(Notebook\s+)?S\/N\s*[A-Z0-9]+-?/i, '').trim() || null;
  // The sheet often repeats the brand in the model ("ASUS" + "ASUS UX333FN-A4").
  if (model && brandRaw && model.toUpperCase().startsWith(`${brandRaw.toUpperCase()} `)) model = model.slice(brandRaw.length).trim();
  const type = text(r['ประเภทคอมพิวเตอร์']).toUpperCase();
  const specs = {};
  for (const [key, col] of [['cpu', 'CPU'], ['ram', 'Ram'], ['storage', 'HDD/SSD'], ['os', 'windows'], ['mailSync', 'Email']]) {
    const v = text(r[col]);
    if (!blank(v)) specs[key] = v;
  }
  const notes = [
    `ผู้ใช้ตามแบบสำรวจ ${SURVEY_TAB}: ${userLabel || '-'}${nickname && nickname !== userLabel ? ` (${nickname})` : ''} — ยังไม่ผูกกับพนักงาน`,
    userStatus && `สถานะผู้ใช้งาน (แบบสำรวจ): ${userStatus}`,
    text(r['หมายเหตุจาก IT']) && `หมายเหตุจาก IT: ${text(r['หมายเหตุจาก IT'])}`,
    machineStatus && `สถานะเครื่อง (แบบสำรวจ): ${machineStatus}`,
    text(r['ประสิทธิภาพการทํางาน']) && `ประสิทธิภาพการทำงาน: ${text(r['ประสิทธิภาพการทํางาน'])}`,
  ].filter(Boolean);
  const m = {
    code,
    nickname,
    categoryKey: categoryKey(type, userLabel, modelRaw),
    status: statusOf(userStatus, machineStatus),
    brand: blank(text(r['ยี่ห้อ'])) ? null : text(r['ยี่ห้อ']),
    model,
    serialNo: serial,
    faCode: userLabel.match(/รหัสใน\s*FA\s*([A-Z]+-\d+)/i)?.[1] ?? null,
    specs,
    purchaseDate: isoDate(r['วันที่เริ่มใช้งาน']),
    cost: num(r['ราคาทุน']),
    usefulLifeYears: num(r['อายุ']) ?? 5,
    vendor: vendorName(r['ผู้จัดจำหน่าย']),
    notes: notes.join('\n'),
    surveyRow: r._row,
  };
  if (m.vendor) report.vendors.add(m.vendor);
  machines.push(m);
}

// --- extra monitors (tab จอเสริม)
const monitors = [];
for (const r of rowsOf(tab(MONITOR_TAB), 'จอ')) {
  const code = text(r['จอ']).toUpperCase();
  if (!/^MO-\d+$/.test(code)) continue;
  const status = text(r['สถานะ']);
  const who = text(r['ผู้ใช้']);
  if (!/มีจอแล้ว|ซื้อแล้ว/.test(status)) {
    report.skipped.push(`${code}: สถานะในชีต “${status}” — ไม่แน่ใจว่าซื้อแล้ว จึงไม่นำเข้า`);
    continue;
  }
  monitors.push({ code, notes: `ผู้ใช้ตามชีตจอเสริม: ${who || '-'} — ยังไม่ผูกกับพนักงาน\nสถานะในชีต: ${status}` });
}

// --- ESET
const byNorm = new Map([...machines, ...monitors].map((m) => [normCode(m.code), m.code]));
const byNickname = new Map(machines.filter((m) => m.nickname).map((m) => [m.nickname, m.code]));
/** ESET console names that are not asset codes. */
function resolveEsetMachine(name, user) {
  const n = normCode(name);
  if (byNorm.has(n)) return { code: byNorm.get(n), how: 'code' };
  // "NB-0014-CEO03" → NB-0014 (the asset code with a suffix)
  for (const [k, code] of byNorm) if (k.length >= 6 && n.startsWith(k)) return { code, how: 'prefix' };
  // "LAPTOP-CEO-01" is a Windows name; the 09.69 row with the same user nickname is CEO-0001
  if (/^LAPTOP-CEO/i.test(name) && byNickname.has(user)) return { code: byNickname.get(user), how: `ผู้ใช้ “${user}” ตรงกับแบบสำรวจ` };
  return null;
}

const licenses = [];
for (const { tab: name, period, lotCol } of ESET_TABS) {
  const rows = rowsOf(tab(name), 'ชื่อคอมพิวเตอร์');
  const lots = new Map();
  for (const r of rows) {
    const machineName = text(r['ชื่อคอมพิวเตอร์']);
    // Skip the summary rows at the bottom ("License 38", "No License 7").
    if (!machineName || !num(r['ลำดับ'])) continue;
    // "No Anti" rows list machines WITHOUT antivirus that year — not seats of a licence.
    if (!/ESET/i.test(text(r['โปรแกรมแอนตี้ไวรัส']))) {
      report.noAntivirusListed.push(`${period}: ${machineName} (${text(r['โปรแกรมแอนตี้ไวรัส']) || 'ว่าง'})`);
      continue;
    }
    const lot = text(r[lotCol]).match(/Lot\s*\d+/i)?.[0].replace(/\s+/, ' ') ?? 'Lot ?';
    const user = text(r['ผู้ใช้งาน']);
    const installed = isoDate(r['วันติดตั้ง']);
    const expires = isoDate(r['วันหมดอายุ']);
    const autoRenewNote = /ต่ออายุอัตโนมัติ/.test(text(r['หมายเหตุ']));
    const target = resolveEsetMachine(machineName, user);
    if (!target) {
      report.esetUnmatched.push(`${name} แถว ${r._row}: “${machineName}” (ผู้ใช้ ${user || '-'})`);
      continue;
    }
    const l = lots.get(lot) ?? { name: `ESET ${period} ${lot}`, lot, period, seats: [], starts: [], ends: [], autoRenew: [] };
    l.seats.push({
      code: target.code,
      how: target.how,
      seatLabel: normCode(machineName) === normCode(target.code) ? null : machineName,
      installedOn: installed,
      note: [`ผู้ใช้ในรายการ ESET: ${user || '-'} (ยังไม่ผูกกับพนักงาน)`, !installed && text(r['วันติดตั้ง']) && `วันติดตั้งในชีต: ${text(r['วันติดตั้ง'])}`, autoRenewNote && 'ในชีต: ต่ออายุอัตโนมัติ']
        .filter(Boolean)
        .join(' · '),
    });
    if (installed) l.starts.push(installed);
    if (expires) l.ends.push(expires);
    l.autoRenew.push(autoRenewNote);
    lots.set(lot, l);
  }
  for (const l of lots.values()) {
    const allAuto = l.autoRenew.every(Boolean);
    const someAuto = l.autoRenew.some(Boolean);
    licenses.push({
      ...l,
      startDate: l.starts.sort()[0] ?? null,
      endDate: l.ends.sort().at(-1) ?? null,
      autoRenew: allAuto,
      notes: [`นำเข้าจากแท็บ ${name} — จำนวนสิทธิ์ = จำนวนเครื่องในรายการ`, someAuto && !allAuto && `ในชีตระบุ “ต่ออายุอัตโนมัติ” ${l.autoRenew.filter(Boolean).length} จาก ${l.autoRenew.length} เครื่อง — ต้องยืนยันกับ ESET`]
        .filter(Boolean)
        .join('\n'),
    });
  }
}

// Machines in use with no current antivirus seat (the sheet counted "No License").
const current = new Set(licenses.filter((l) => l.period === '2026–2027').flatMap((l) => l.seats.map((s) => s.code)));
for (const m of machines) if (m.status === 'ACTIVE' && !current.has(m.code)) report.noAntivirus.push(m.code);

// ---------------------------------------------------------------------------
// Write
// ---------------------------------------------------------------------------

const prisma = new PrismaClient();
try {
  const by = await prisma.employee.findUnique({ where: { email: byEmail } });
  if (!by) throw new Error(`no employee with e-mail ${byEmail}`);
  const categories = new Map((await prisma.assetCategory.findMany()).map((c) => [c.key, c]));
  const existing = new Set((await prisma.asset.findMany({ select: { code: true } })).map((a) => a.code));
  for (const m of [...machines, ...monitors]) if (existing.has(m.code)) report.skipped.push(`${m.code}: มีอยู่แล้วในระบบ — ข้าม`);

  await prisma.$transaction(
    async (tx) => {
      const vendorId = new Map();
      for (const name of report.vendors) {
        const v = (await tx.vendor.findUnique({ where: { name } })) ?? (apply ? await tx.vendor.create({ data: { name } }) : { id: `new:${name}` });
        vendorId.set(name, v.id);
      }
      const create = async (m, categoryKey) => {
        if (existing.has(m.code)) return;
        const category = categories.get(categoryKey);
        if (!category) throw new Error(`category ${categoryKey} missing`);
        const hostname = null;
        const data = {
          code: m.code,
          categoryId: category.id,
          status: m.status ?? 'ACTIVE',
          brand: m.brand ?? null,
          model: m.model ?? null,
          serialNo: m.serialNo ?? null,
          hostname,
          faCode: m.faCode ?? null,
          specs: m.specs ?? {},
          purchaseDate: m.purchaseDate ? new Date(`${m.purchaseDate}T00:00:00Z`) : null,
          cost: m.cost ?? null,
          usefulLifeYears: m.usefulLifeYears ?? 5,
          vendorId: m.vendor ? vendorId.get(m.vendor) : null,
          notes: m.notes,
        };
        (categoryKey === 'MONITOR' ? report.monitors : report.assets).push(`${m.code} ${categoryKey} ${data.status}${m.purchaseDate ? ` ${m.purchaseDate}` : ''}${m.cost ? ` ฿${m.cost}` : ''}`);
        if (!apply) return;
        const asset = await tx.asset.create({ data });
        await tx.assetEvent.create({
          data: {
            assetId: asset.id,
            type: 'REGISTERED',
            occurredOn: data.purchaseDate ?? new Date(`${SURVEY_MONTH}T00:00:00Z`),
            title: `ลงทะเบียน ${category.name} (นำเข้าจากแบบสำรวจความเพียงพอของอุปกรณ์)`,
            detail: m.notes,
            cost: data.cost,
            vendorId: data.vendorId,
            recordedById: by.id,
          },
        });
        existing.add(m.code);
      };
      for (const m of machines) await create(m, m.categoryKey);
      for (const m of monitors) await create(m, 'MONITOR');

      // Software + licences + seats
      const software = apply
        ? await tx.software.upsert({ where: { name: ESET_NAME }, update: {}, create: { name: ESET_NAME, publisher: 'ESET', category: 'แอนตี้ไวรัส' } })
        : { id: 'new:eset' };
      const lotLicense = new Map();
      for (const l of licenses.sort((a, b) => a.period.localeCompare(b.period))) {
        const previous = lotLicense.get(l.lot);
        let lic = apply ? await tx.softwareLicense.findFirst({ where: { softwareId: software.id, name: l.name } }) : null;
        if (!lic && apply) {
          lic = await tx.softwareLicense.create({
            data: {
              softwareId: software.id,
              name: l.name,
              edition: 'Smart Security Premium',
              type: 'SUBSCRIPTION',
              metric: 'PER_DEVICE',
              seats: l.seats.length,
              startDate: l.startDate ? new Date(`${l.startDate}T00:00:00Z`) : null,
              endDate: l.endDate ? new Date(`${l.endDate}T00:00:00Z`) : null,
              autoRenew: l.autoRenew,
              reference: l.lot,
              notes: l.notes,
              renewedFromId: previous && !previous.renewedBy ? previous.id : null,
            },
          });
          if (previous) previous.renewedBy = lic.id;
        }
        lotLicense.set(l.lot, lic ?? { id: `new:${l.name}` });
        const expired = l.endDate && l.endDate < new Date().toISOString().slice(0, 10);
        report.eset.push(`${l.name}: ${l.seats.length} เครื่อง, ${l.startDate ?? '?'} → ${l.endDate ?? '?'}${l.autoRenew ? ', ต่ออายุอัตโนมัติ' : ''}${expired ? ' (หมดอายุแล้ว — seat ถูกปิดตามวันหมดอายุ)' : ''}`);
        if (!apply) continue;
        for (const s of l.seats) {
          const asset = await tx.asset.findUnique({ where: { code: s.code } });
          if (!asset) {
            report.warnings.push(`${l.name}: ${s.code} ไม่มีในทะเบียน`);
            continue;
          }
          if (await tx.licenseAssignment.findFirst({ where: { licenseId: lic.id, assetId: asset.id } })) continue;
          const start = s.installedOn ?? l.startDate ?? SURVEY_MONTH;
          await tx.licenseAssignment.create({
            data: {
              licenseId: lic.id,
              assetId: asset.id,
              startDate: new Date(`${start}T00:00:00Z`),
              endDate: expired ? new Date(`${l.endDate}T00:00:00Z`) : null,
              installedOn: s.installedOn ? new Date(`${s.installedOn}T00:00:00Z`) : null,
              seatLabel: s.seatLabel,
              note: s.how === 'code' ? s.note : `${s.note} · จับคู่เครื่องด้วย: ${s.how}`,
              createdById: by.id,
            },
          });
          // The console name is the machine's Windows name.
          if (s.seatLabel && !expired && !asset.hostname) await tx.asset.update({ where: { id: asset.id }, data: { hostname: s.seatLabel } });
        }
      }
      if (apply) {
        await tx.auditEvent.create({
          data: {
            actorId: by.id,
            action: 'asset.import_survey',
            resourceType: 'asset',
            metadata: { file: file.split(/[\\/]/).pop(), tab: SURVEY_TAB, assets: report.assets.length, monitors: report.monitors.length, licenses: licenses.length },
          },
        });
      }
    },
    { timeout: 120_000 },
  );
} finally {
  await prisma.$disconnect();
}

// ---------------------------------------------------------------------------
// Report
// ---------------------------------------------------------------------------

const section = (title, list) => console.log(`\n## ${title} (${list.length})\n${list.map((x) => `- ${x}`).join('\n') || '- ไม่มี'}`);
console.log(apply ? '# นำเข้าแล้ว' : '# ทดลอง (dry run) — ยังไม่ได้เขียนข้อมูล ใส่ --apply เพื่อนำเข้าจริง');
section('คอมพิวเตอร์', report.assets);
section('จอเสริม', report.monitors);
section('ผู้จำหน่าย', [...report.vendors]);
section('ไลเซนส์ ESET', report.eset);
section('ข้าม', report.skipped);
section('รายการ ESET ที่จับคู่เครื่องไม่ได้', report.esetUnmatched);
section('ในชีตระบุว่าไม่มีแอนตี้ไวรัส (No Anti)', report.noAntivirusListed);
section('เครื่องที่ใช้งานอยู่แต่ไม่มี ESET ปี 2026–2027', report.noAntivirus);
section('คำเตือน', report.warnings);
