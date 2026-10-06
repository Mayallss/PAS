#!/usr/bin/env node
/**
 * Decisions confirmed by the user on 2026-10-02, applied after `import-legacy-people.mjs` (docs/07 §13, Q-PPL1–3).
 *
 *   node --env-file=../../.env scripts/people-decisions-20261002.mjs <pasacccom_report.sql> --by <admin-email> [--apply]
 *
 * Dry run by default. Idempotent: re-running changes nothing that is already in place.
 *  1. Main-team leads (names come from the equipment survey, e.g. "กรรณพา ยกย่อง (พี่ยู)") + their nicknames.
 *  2. Legacy roles granted as in the old system: authen 1 → ADMIN, 2 → MANAGER, 3 → PARTNER, 4 → IT (active people only).
 *  3. People who use company machines but were missing / "not working" in Time Report: executives and two staff.
 *     Legacy `work = 0` did not always mean "resigned" — these people are in the September 2026 survey — so the
 *     existing records are reactivated rather than duplicated. Real names of คุณบีเวอร์ / คุณชัยรัตน์ are not in any
 *     source yet: created with the name known and must be completed by HR.
 */
import { readFileSync } from 'node:fs';
import { PrismaClient } from '@prisma/client';

const args = process.argv.slice(2);
const byIdx = args.indexOf('--by');
const byEmail = byIdx >= 0 ? args[byIdx + 1] : null;
const file = args.find((a, i) => !a.startsWith('--') && i !== byIdx + 1);
const apply = args.includes('--apply');
if (!file || !byEmail) {
  console.error('usage: people-decisions-20261002.mjs <pasacccom_report.sql> --by <admin email> [--apply]');
  process.exit(2);
}

const LEADS = [
  { team: 'ทีมพี่แวว', fullName: 'กุลรัศมิ์ คำออน', nickname: 'แวว' },
  { team: 'ทีมพี่แขก', fullName: 'วาริกา เทพหินลัพ', nickname: 'แขก' },
  { team: 'ทีมพี่ต้อม', fullName: 'พรรณพิไล โนจา', nickname: 'ต้อม' },
  { team: 'ทีมพี่ยู', fullName: 'กรรณพา ยกย่อง', nickname: 'ยู' },
];
const LEGACY_ROLE = { 1: 'ADMIN', 2: 'MANAGER', 3: 'PARTNER', 4: 'IT' };
const REACTIVATE = [
  { fullName: 'ปิยะพร คาร์นิยอร์', nickname: 'เปีย', employmentType: 'DIRECTOR' },
  { fullName: 'ณัฎฐณิชา บุญถึง', nickname: 'แก้ม' },
  { fullName: 'สาวินี ธงขาว', nickname: 'ออม' },
];
const CREATE = [
  { fullName: 'บีเวอร์ (รอชื่อจริง)', nickname: 'บีเวอร์', employmentType: 'DIRECTOR', leads: 'ทีมคุณบีเวอร์' },
  { fullName: 'ชัยรัตน์ (รอนามสกุล)', nickname: 'ชัยรัตน์', employmentType: 'DIRECTOR' },
];

// Legacy roles: only id_member + authen + work are read from member_table.
const sql = readFileSync(file, 'utf8');
const def = sql.match(/CREATE TABLE `member_table` \(([\s\S]*?)\) ENGINE/)[1];
const cols = [...def.matchAll(/^\s+`(\w+)`/gm)].map((c) => c[1]);
const [iId, iAuthen, iWork] = ['id_member', 'authen', 'work'].map((c) => cols.indexOf(c));
const legacyRoles = [];
for (const ins of sql.matchAll(/INSERT INTO `member_table`[^\n]*?VALUES([^\n]*);/g)) {
  for (const m of ins[1].matchAll(/\((.*?)\)(?=,\(|$)/g)) {
    const v = m[1].match(/'(?:[^'\\]|\\.)*'|[^,]+/g).map((x) => x.replace(/^'|'$/g, ''));
    if (v[iWork] === '1' && LEGACY_ROLE[v[iAuthen]]) legacyRoles.push({ legacyId: Number(v[iId]), role: LEGACY_ROLE[v[iAuthen]] });
  }
}

const prisma = new PrismaClient();
const by = await prisma.employee.findUnique({ where: { email: byEmail.toLowerCase() } });
if (!by) {
  console.error(`ไม่พบผู้บันทึก ${byEmail}`);
  process.exit(2);
}
const log = [];
const one = async (tx, where, what) => {
  const rows = await tx.employee.findMany({ where });
  if (rows.length !== 1) throw new Error(`${what}: พบ ${rows.length} คน — ต้องพบคนเดียว`);
  return rows[0];
};

await prisma.$transaction(
  async (tx) => {
    // 1. Leads.
    for (const l of LEADS) {
      const p = await one(tx, { fullName: l.fullName, status: 'ACTIVE' }, l.fullName);
      const unit = await tx.orgUnit.findFirst({ where: { name: l.team } });
      if (!unit) throw new Error(`ไม่พบ ${l.team}`);
      if (!p.nickname) {
        log.push(`ชื่อเล่น ${l.fullName} → ${l.nickname}`);
        if (apply) await tx.employee.update({ where: { id: p.id }, data: { nickname: l.nickname } });
      }
      if (unit.managerId !== p.id) {
        log.push(`หัวหน้า ${l.team} → ${l.fullName}`);
        if (apply) await tx.orgUnit.update({ where: { id: unit.id }, data: { managerId: p.id } });
      }
    }

    // 2. Legacy roles.
    for (const r of legacyRoles) {
      const p = await tx.employee.findUnique({ where: { legacyId: r.legacyId } });
      const role = await tx.role.findUniqueOrThrow({ where: { key: r.role } });
      if (!p) continue;
      const has = await tx.roleAssignment.findFirst({ where: { employeeId: p.id, roleId: role.id, orgUnitId: null } });
      if (!has) {
        log.push(`บทบาท ${r.role} → ${p.fullName}${p.nickname ? ` (${p.nickname})` : ''}`);
        if (apply) await tx.roleAssignment.create({ data: { employeeId: p.id, roleId: role.id } });
      }
    }

    // 3. People using company machines.
    const employeeRole = await tx.role.findUniqueOrThrow({ where: { key: 'EMPLOYEE' } });
    const ensureEmployeeRole = async (id) => {
      if (!(await tx.roleAssignment.findFirst({ where: { employeeId: id, roleId: employeeRole.id } }))) await tx.roleAssignment.create({ data: { employeeId: id, roleId: employeeRole.id } });
    };
    for (const r of REACTIVATE) {
      const p = await one(tx, { fullName: r.fullName }, r.fullName);
      const data = { status: 'ACTIVE', endDate: null, ...(p.nickname ? {} : { nickname: r.nickname }), ...(r.employmentType ? { employmentType: r.employmentType } : {}) };
      if (p.status !== 'ACTIVE' || (!p.nickname && r.nickname) || (r.employmentType && p.employmentType !== r.employmentType)) {
        log.push(`เปิดสถานะทำงาน ${r.fullName} (${r.nickname})${r.employmentType ? ` · ${r.employmentType}` : ''}`);
        if (apply) {
          await tx.employee.update({ where: { id: p.id }, data });
          await ensureEmployeeRole(p.id);
        }
      }
    }
    for (const c of CREATE) {
      const existing = await tx.employee.findFirst({ where: { nickname: c.nickname, employmentType: 'DIRECTOR' } });
      let id = existing?.id;
      if (!existing) {
        log.push(`เพิ่มพนักงาน ${c.fullName} (${c.nickname}) · ${c.employmentType}`);
        if (apply) {
          id = (await tx.employee.create({ data: { fullName: c.fullName, nickname: c.nickname, employmentType: c.employmentType, status: 'ACTIVE', roleAssignments: { create: { roleId: employeeRole.id } } } })).id;
        }
      }
      if (c.leads) {
        const unit = await tx.orgUnit.findFirst({ where: { name: c.leads } });
        if (unit && (!id || unit.managerId !== id)) {
          log.push(`หัวหน้า ${c.leads} → ${c.fullName}`);
          if (apply && id) await tx.orgUnit.update({ where: { id: unit.id }, data: { managerId: id } });
        }
      }
    }

    if (apply && log.length) {
      await tx.auditEvent.create({ data: { actorId: by.id, action: 'import.people_decisions', resourceType: 'employee', after: { decisions: 'Q-PPL1-3 2026-10-02', changes: log } } });
    }
  },
  { timeout: 120_000 },
);

console.log(apply ? '# บันทึกแล้ว' : '# ทดลอง (dry run) — ใส่ --apply เพื่อบันทึกจริง');
console.log(log.length ? log.map((l) => `  ${l}`).join('\n') : '  ไม่มีอะไรต้องเปลี่ยน');
await prisma.$disconnect();
