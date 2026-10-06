/**
 * Suggest who holds a machine from the user written in the equipment survey (asset note, import 2026-09-30).
 * IT confirms every suggestion before anything is assigned — this only ranks candidates.
 */

export interface Person {
  id: string;
  fullName: string;
  nickname: string | null;
}

export type Confidence = 'FULL_NAME' | 'FIRST_NAME' | 'NICKNAME';

export interface HolderSuggestion {
  label: string;
  vacant: boolean;
  match: { employeeId: string; how: Confidence } | null;
  candidates: { employeeId: string; how: Confidence }[];
}

const TITLES = /^(นางสาว|น\.ส\.|นาง|นาย|คุณ|พี่|น้อง|ดร\.|mr\.?|mrs\.?|ms\.?|miss)\s*/i;
const VACANT = /^(ว่าง|สำรอง|ส่วนกลาง|เครื่องกลาง|server|ห้อง)|เก็บห้อง\s*server|ไม่มีผู้ใช้/i;

/** Lower-case, no spaces / zero-width, Thai tone marks typed twice collapsed ("อิ้้ง" → "อิ้ง"). */
export function norm(s: string): string {
  return s
    .normalize('NFC')
    .replace(/[​-‍﻿]/g, '')
    .replace(/([ัิ-ฺ็-๎])\1+/g, '$1')
    .replace(/\s+/g, '')
    .toLowerCase();
}

const stripTitle = (s: string) => {
  let out = s.trim();
  for (let i = 0; i < 3 && TITLES.test(out); i++) out = out.replace(TITLES, '');
  return out.trim();
};

/** "ผู้ใช้ตามแบบสำรวจ 09.69: นางสาว อนุธิดา ปูดอก (อิ้ง) — ยังไม่ผูกกับพนักงาน" → "นางสาว อนุธิดา ปูดอก (อิ้ง)" */
export function surveyLabel(notes: string | null): string | null {
  const line = (notes ?? '').split('\n').find((l) => /^ผู้ใช้ตาม(แบบสำรวจ|ชีต)/.test(l));
  if (!line) return null;
  const label = line.slice(line.indexOf(':') + 1).split(' — ')[0].trim();
  return label && label !== '-' ? label : null;
}

/** Nicknames written in brackets after a name: "นาง กุลรัศมิ์ คำออน (พี่แวว)" → ["แวว"]. */
export function bracketNicknames(label: string): string[] {
  return [...label.matchAll(/\(([^()]+)\)/g)].map((m) => stripTitle(m[1])).filter((n) => n && n.length <= 20 && !/ลาออก|audit|server|cctv|แชร์|ว่าง/i.test(n));
}

/**
 * `aliases`: nicknames learned from other survey rows (the legacy system has none for some managers, but the survey
 * writes "กรรณพา ยกย่อง (พี่ยู)"), so a monitor labelled only "พี่ยู" can still be matched.
 */
export function suggestHolder(label: string, people: Person[], aliases: Map<string, string[]> = new Map()): HolderSuggestion {
  const base: HolderSuggestion = { label, vacant: false, match: null, candidates: [] };
  if (VACANT.test(label.trim())) return { ...base, vacant: true };
  // Never preselect someone the survey itself marks as having left.
  const unsure = /ลาออก/.test(label);

  const name = stripTitle(label.replace(/\(.*?\)/g, ' ').split(/\s[-–]\s/)[0]);
  const words = name.split(/\s+/).filter(Boolean);
  const nicknames = bracketNicknames(label);
  if (words.length === 1) nicknames.push(words[0]);

  const pick = (how: Confidence, hits: Person[], sure = true): HolderSuggestion | null => {
    if (hits.length === 1) return { ...base, match: sure && !unsure ? { employeeId: hits[0].id, how } : null, candidates: [{ employeeId: hits[0].id, how }] };
    if (hits.length > 1) return { ...base, candidates: hits.map((p) => ({ employeeId: p.id, how })) };
    return null;
  };
  const nickOf = (p: Person) => [p.nickname, ...(aliases.get(p.id) ?? [])].filter((n): n is string => !!n).map(norm);

  const fullKey = norm(words.join(''));
  const full = words.length >= 2 ? pick('FULL_NAME', people.filter((p) => norm(stripTitle(p.fullName)) === fullKey)) : null;
  if (full) return full;
  const first = words.length >= 2 ? pick('FIRST_NAME', people.filter((p) => norm(stripTitle(p.fullName).split(/\s+/)[0]) === norm(words[0]))) : null;
  if (first?.match) return first;
  // A full name was written but nobody has it: a nickname hit is probably someone else with the same nickname
  // (e.g. a newcomer not yet in the system) — offer it, do not preselect.
  const sure = words.length < 2;
  for (const nick of nicknames) {
    const hit = pick('NICKNAME', people.filter((p) => nickOf(p).includes(norm(nick))), sure);
    if (hit) return hit;
  }
  return first ?? base;
}
