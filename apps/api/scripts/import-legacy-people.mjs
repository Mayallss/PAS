#!/usr/bin/env node
/**
 * One-time import of people and teams from the legacy Time Report database dump (pasacccom_report.sql).
 *
 *   node --env-file=../../.env scripts/import-legacy-people.mjs <pasacccom_report.sql> --by <admin-email> [--apply]
 *
 * Dry run by default; `--apply` writes everything in one transaction. Idempotent (keyed on legacy ids): people,
 * teams and accounts that already exist are left as they are, so it can be re-run after a fresh dump.
 *
 * What comes over (whitelisted columns only — `password_member` and the `mail` / `pec_users` tables are NEVER read):
 *   member_table.id_member      → employee.legacy_id
 *   name_member / nickName      → full name / nickname
 *   work (1 = working)          → ACTIVE / INACTIVE                                    [ระบบเดิม]
 *   start_work                  → start date (0000-00-00 → empty)
 *   status → member_level       → level J…D; one level-history row from 2000-01-01, i.e. the legacy rule that a
 *                                 person's current level prices all their time                [ระบบเดิม]
 *   team_member → subTeam_table → team; subTeam.mainTeam_id → team_table = parent team         [ระบบเดิม]
 *   username_member             → account in "Time Report เดิม" (ACTIVE / DISABLED) — helps match Google accounts later
 * Not carried over: passwords (the new platform never stores them), e-mail (set when Google Workspace starts),
 * legacy roles `authen` — everyone gets the EMPLOYEE role; the report lists who had ADMIN / MANAGER / OWNER / IT so an
 * admin grants those deliberately (least privilege, docs/06 Q6).
 * Team leads: legacy team names carry the lead's nickname ("ทีมพี่หวาน", "คุณปรียา"); when exactly one active person has
 * that nickname they become the team's manager (leave approvals, team reports). Check the report.
 */
import { readFileSync } from 'node:fs';
import { PrismaClient } from '@prisma/client';

const args = process.argv.slice(2);
const file = args.find((a) => !a.startsWith('--') && a !== args[args.indexOf('--by') + 1]);
const apply = args.includes('--apply');
const byEmail = args[args.indexOf('--by') + 1];
if (!file || !args.includes('--by') || !byEmail) {
  console.error('usage: import-legacy-people.mjs <pasacccom_report.sql> --by <admin email> [--apply]');
  process.exit(2);
}

const MAIN_TEAM_BASE = 1000; // org_unit.legacy_id = 1000 + team_table.team_id
const SUB_TEAM_BASE = 2000; //  org_unit.legacy_id = 2000 + subTeam_table.subTeam_id
const LEGACY_SYSTEM = { key: 'LEGACY_TIMEREPORT', name: 'Time Report เดิม', identifierLabel: 'ชื่อผู้ใช้' };
const LEVEL_FROM = '2000-01-01';
const ROLE_LABEL = { 1: 'ADMIN', 2: 'MANAGER', 3: 'OWNER', 4: 'IT' };

// ---------------------------------------------------------------------------
// Dump parsing — only the tables and columns listed here are ever read.
// ---------------------------------------------------------------------------

const sql = readFileSync(file, 'utf8');

function parseValues(s) {
  const rows = [];
  let i = s.indexOf('VALUES') + 6;
  while (i < s.length) {
    while (i < s.length && s[i] !== '(') i++;
    if (i >= s.length) break;
    i++;
    const row = [];
    let cur = '';
    let inStr = false;
    let quoted = false;
    for (; i < s.length; i++) {
      const c = s[i];
      if (inStr) {
        if (c === '\\') { cur += s[++i]; continue; }
        if (c === "'") { if (s[i + 1] === "'") { cur += "'"; i++; continue; } inStr = false; continue; }
        cur += c;
      } else if (c === "'") { inStr = true; quoted = true; }
      else if (c === ',' || c === ')') {
        row.push(!quoted && cur.trim() === 'NULL' ? null : cur.trim());
        cur = '';
        quoted = false;
        if (c === ')') { i++; break; }
      } else cur += c;
    }
    rows.push(row);
  }
  return rows;
}

function table(name, keep) {
  const def = sql.match(new RegExp('CREATE TABLE `' + name + '` \\(([\\s\\S]*?)\\) ENGINE'));
  if (!def) throw new Error(`table ${name} not in dump`);
  const cols = [...def[1].matchAll(/^\s+`(\w+)`/gm)].map((c) => c[1]);
  const idx = keep.map((k) => {
    const i = cols.indexOf(k);
    if (i < 0) throw new Error(`${name}.${k} missing`);
    return i;
  });
  const out = [];
  for (const ins of sql.matchAll(new RegExp('INSERT INTO `' + name + '`[^\\n]*?VALUES[^\\n]*;', 'g'))) {
    for (const r of parseValues(ins[0])) out.push(Object.fromEntries(keep.map((k, j) => [k, r[idx[j]]])));
  }
  return out;
}

const members = table('member_table', ['id_member', 'name_member', 'nickName', 'username_member', 'authen', 'status', 'work', 'start_work', 'team_member']);
const mainTeams = table('team_table', ['team_id', 'team_name']).filter((t) => t.team_id !== '0');
const subTeams = table('subTeam_table', ['subTeam_id', 'subTeam_name', 'mainTeam_id']).filter((t) => t.subTeam_id !== '0');
const levels = table('member_level', ['lvl_id', 'lvl_code', 'lvl_name']);

const clean = (v) => (v ?? '').replace(/\s+/g, ' ').trim() || null;
const validDate = (v) => (v && /^\d{4}-\d{2}-\d{2}$/.test(v) && !v.startsWith('0000') ? v : null);
const toDate = (v) => new Date(`${v}T00:00:00Z`);
const teamName = (n) => (n.startsWith('ทีม') ? n : `ทีม${n}`);
/** "ทีมพี่หวาน" / "คุณปรียา" → "หวาน" / "ปรียา" */
const leadNick = (n) => n.replace(/^ทีม/, '').replace(/^(พี่|คุณ|น้อง)/, '').trim();

// ---------------------------------------------------------------------------

const prisma = new PrismaClient();
const by = await prisma.employee.findUnique({ where: { email: byEmail.toLowerCase() } });
if (!by) {
  console.error(`ไม่พบผู้บันทึก ${byEmail}`);
  process.exit(2);
}

const report = { teams: [], people: { create: 0, exists: 0, active: 0, inactive: 0 }, leads: [], roles: [], warnings: [] };

await prisma.$transaction(
  async (tx) => {
    // Levels: link existing J…D to the legacy ids (create any that are missing).
    const levelByLegacy = new Map();
    for (const l of levels) {
      let row = await tx.employeeLevel.findUnique({ where: { code: l.lvl_code } });
      if (!row && apply) row = await tx.employeeLevel.create({ data: { code: l.lvl_code, name: l.lvl_name, sortOrder: Number(l.lvl_id), legacyId: Number(l.lvl_id) } });
      else if (row && row.legacyId == null && apply) row = await tx.employeeLevel.update({ where: { id: row.id }, data: { legacyId: Number(l.lvl_id) } });
      levelByLegacy.set(l.lvl_id, row ?? { id: `new:${l.lvl_code}`, code: l.lvl_code });
    }

    // Teams: main teams, then sub-teams under them.
    const unitByLegacy = new Map();
    const units = [
      ...mainTeams.map((t) => ({ legacyId: MAIN_TEAM_BASE + Number(t.team_id), name: teamName(clean(t.team_name)), parent: null })),
      ...subTeams.map((t) => ({ legacyId: SUB_TEAM_BASE + Number(t.subTeam_id), name: teamName(clean(t.subTeam_name)), parent: t.mainTeam_id !== '0' ? MAIN_TEAM_BASE + Number(t.mainTeam_id) : null })),
    ];
    for (const u of units) {
      let row = await tx.orgUnit.findUnique({ where: { legacyId: u.legacyId } });
      const parentId = u.parent ? unitByLegacy.get(u.parent)?.id ?? null : null;
      if (u.parent && !unitByLegacy.has(u.parent)) report.warnings.push(`ทีมย่อย ${u.name}: ไม่พบทีมหลัก id ${u.parent - MAIN_TEAM_BASE} ในข้อมูลเดิม — สร้างเป็นทีมระดับบนสุด`);
      const status = row ? 'มีแล้ว' : 'สร้างใหม่';
      if (!row && apply) row = await tx.orgUnit.create({ data: { name: u.name, legacyId: u.legacyId, parentId: parentId?.startsWith?.('new:') ? null : parentId } });
      unitByLegacy.set(u.legacyId, row ?? { id: `new:${u.legacyId}`, name: u.name });
      report.teams.push(`${status}: ${u.parent ? '  └ ' : ''}${u.name}`);
    }

    // External system for the legacy username.
    let system = await tx.externalSystem.findUnique({ where: { key: LEGACY_SYSTEM.key } });
    if (!system && apply) system = await tx.externalSystem.create({ data: { ...LEGACY_SYSTEM, identifierUnique: true, sortOrder: 99, isActive: false } });

    const employeeRole = await tx.role.findUniqueOrThrow({ where: { key: 'EMPLOYEE' } });
    const personByLegacy = new Map();
    for (const m of members) {
      const legacyId = Number(m.id_member);
      const active = m.work === '1';
      active ? report.people.active++ : report.people.inactive++;
      const fullName = clean(m.name_member) ?? `(ไม่มีชื่อ #${legacyId})`;
      const nickname = clean(m.nickName);
      if (active && m.authen !== '0' && ROLE_LABEL[m.authen]) report.roles.push(`${fullName}${nickname ? ` (${nickname})` : ''}: ${ROLE_LABEL[m.authen]}`);

      let person = await tx.employee.findUnique({ where: { legacyId } });
      if (person) {
        report.people.exists++;
        personByLegacy.set(legacyId, { ...person, active });
        continue;
      }
      report.people.create++;
      const sub = m.team_member !== '0' ? unitByLegacy.get(SUB_TEAM_BASE + Number(m.team_member)) : null;
      if (m.team_member !== '0' && !sub) report.warnings.push(`${fullName}: ทีมย่อย id ${m.team_member} ไม่มีในข้อมูลเดิม — ไม่ใส่ทีม`);
      const level = levelByLegacy.get(m.status);
      const start = validDate(m.start_work);
      if (!apply) {
        personByLegacy.set(legacyId, { id: `new:${legacyId}`, fullName, nickname, active });
        continue;
      }
      person = await tx.employee.create({
        data: {
          legacyId,
          fullName,
          nickname,
          status: active ? 'ACTIVE' : 'INACTIVE',
          startDate: start ? toDate(start) : null,
          orgUnitId: sub && !String(sub.id).startsWith('new:') ? sub.id : null,
          levelId: level && !String(level.id).startsWith('new:') ? level.id : null,
          roleAssignments: { create: { roleId: employeeRole.id } },
        },
      });
      if (person.levelId) await tx.employeeLevelHistory.create({ data: { employeeId: person.id, levelId: person.levelId, effectiveFrom: toDate(LEVEL_FROM), createdById: by.id } });
      const username = clean(m.username_member);
      if (username && system) {
        const taken = await tx.externalAccount.findFirst({ where: { systemId: system.id, identifier: { equals: username, mode: 'insensitive' } } });
        if (!taken) {
          await tx.externalAccount.create({
            data: { systemId: system.id, employeeId: person.id, identifier: username, status: active ? 'ACTIVE' : 'DISABLED', note: 'นำเข้าจาก Time Report เดิม (ไม่มีรหัสผ่าน)' },
          });
        }
      }
      personByLegacy.set(legacyId, { ...person, active });
    }

    // Team leads from the team names.
    const activePeople = [...personByLegacy.values()].filter((p) => p.active);
    for (const [legacyUnitId, unit] of unitByLegacy) {
      const nick = leadNick(unit.name);
      const hits = activePeople.filter((p) => (p.nickname ?? '').trim() === nick);
      if (hits.length === 1) {
        report.leads.push(`${unit.name} → หัวหน้า: ${hits[0].fullName} (${nick})`);
        if (apply && !String(unit.id).startsWith('new:') && !unit.managerId) await tx.orgUnit.update({ where: { id: unit.id }, data: { managerId: hits[0].id } });
      } else {
        report.leads.push(`${unit.name} → ${hits.length ? `ชื่อเล่น “${nick}” ซ้ำ ${hits.length} คน` : `ไม่พบพนักงานชื่อเล่น “${nick}”`} — ตั้งหัวหน้าเองในหน้าพนักงานและสิทธิ์`);
      }
      void legacyUnitId;
    }

    if (apply) {
      await tx.auditEvent.create({
        data: {
          actorId: by.id,
          action: 'import.legacy_people',
          resourceType: 'employee',
          after: { file: file.split(/[\\/]/).pop(), created: report.people.create, existing: report.people.exists, teams: units.length },
        },
      });
    }
  },
  { timeout: 120_000 },
);

console.log(apply ? '# นำเข้าแล้ว' : '# ทดลอง (dry run) — ยังไม่ได้เขียนข้อมูล ใส่ --apply เพื่อนำเข้าจริง');
console.log(`\nพนักงาน: ทั้งหมด ${members.length} (ทำงานอยู่ ${report.people.active}, พ้นสภาพ ${report.people.inactive}) — สร้างใหม่ ${report.people.create}, มีอยู่แล้ว ${report.people.exists}`);
console.log(`\nทีม (${report.teams.length}):\n  ${report.teams.join('\n  ')}`);
console.log(`\nหัวหน้าทีม (จากชื่อทีม):\n  ${report.leads.join('\n  ')}`);
console.log(`\nสิทธิ์เดิมที่ไม่ได้ให้อัตโนมัติ (ทุกคนได้ “พนักงาน” — ให้ Admin มอบบทบาทเอง):\n  ${report.roles.join('\n  ') || '-'}`);
if (report.warnings.length) console.log(`\nข้อควรตรวจ:\n  ${report.warnings.join('\n  ')}`);
await prisma.$disconnect();
