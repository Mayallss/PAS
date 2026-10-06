'use client';

import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { CheckCircle2, CircleHelp, Link2, UserX } from 'lucide-react';
import { useEffect, useMemo, useState } from 'react';
import { toast } from 'sonner';
import { Alert, Badge, Button, Card, Empty, inputClass, Loading } from '@/components/ui';
import { api, errorMessage } from '@/lib/api';

type How = 'FULL_NAME' | 'FIRST_NAME' | 'NICKNAME';
interface Row {
  code: string;
  category: string;
  onePerPerson: boolean;
  model: string | null;
  status: string;
  canAssign: boolean;
  label: string;
  vacant: boolean;
  match: { employeeId: string; how: How } | null;
  candidates: { employeeId: string; how: How }[];
}
interface PersonOption {
  id: string;
  fullName: string;
  nickname: string | null;
  team: string | null;
  holding: string[];
}
export interface HolderSuggestions {
  rows: Row[];
  people: PersonOption[];
}

const HOW_LABEL: Record<How, string> = { FULL_NAME: 'ชื่อ-นามสกุลตรง', FIRST_NAME: 'ชื่อจริงตรง', NICKNAME: 'ชื่อเล่นตรง' };
const SURVEY_MONTH = '2026-09-01';
type Filter = 'todo' | 'review' | 'all';

/**
 * Link machines to people using the user written in the equipment survey (kept as text at import). The system
 * suggests, IT confirms: only ticked rows are handed out, each through the normal rules (1 person = 1 computer…).
 */
export function HolderMatch() {
  const qc = useQueryClient();
  const q = useQuery({ queryKey: ['holder-suggestions'], queryFn: () => api<HolderSuggestions>('/assets/holder-suggestions') });
  const [chosen, setChosen] = useState<Record<string, string>>({});
  const [ticked, setTicked] = useState<Record<string, boolean>>({});
  const [filter, setFilter] = useState<Filter>('todo');
  const [startDate, setStartDate] = useState(SURVEY_MONTH);
  const [errors, setErrors] = useState<Record<string, string>>({});

  // Preselect the confident matches once data arrives.
  useEffect(() => {
    if (!q.data) return;
    setChosen(Object.fromEntries(q.data.rows.filter((r) => r.match).map((r) => [r.code, r.match!.employeeId])));
    setTicked(Object.fromEntries(q.data.rows.filter((r) => r.match && r.canAssign).map((r) => [r.code, true])));
  }, [q.data]);

  const people = useMemo(() => new Map((q.data?.people ?? []).map((p) => [p.id, p])), [q.data]);
  const label = (p: PersonOption) => `${p.nickname ? `${p.nickname} · ` : ''}${p.fullName}${p.team ? ` (${p.team})` : ''}`;

  const rows = (q.data?.rows ?? []).filter((r) => (filter === 'all' ? true : filter === 'review' ? !r.match && !r.vacant : !r.vacant));
  const picked = Object.entries(ticked).filter(([code, on]) => on && chosen[code]);
  // Same person ticked for two computers → the second would be refused (1 person = 1 computer); warn up front.
  const perPerson = new Map<string, string[]>();
  for (const [code] of picked) {
    const r = q.data?.rows.find((x) => x.code === code);
    if (r?.onePerPerson) perPerson.set(chosen[code], [...(perPerson.get(chosen[code]) ?? []), code]);
  }
  const doubles = [...perPerson.entries()].filter(([, codes]) => codes.length > 1);

  const apply = useMutation({
    mutationFn: () => api<{ assigned: number; results: { code: string; ok: boolean; message?: string }[] }>('/assets/holder-suggestions/apply', { method: 'POST', body: { startDate, items: picked.map(([code]) => ({ code, employeeId: chosen[code] })) } }),
    onSuccess: (r) => {
      const failed = r.results.filter((x) => !x.ok);
      setErrors(Object.fromEntries(failed.map((f) => [f.code, f.message ?? 'มอบไม่ได้'])));
      toast[failed.length ? 'warning' : 'success'](`ผูกเครื่องกับพนักงานแล้ว ${r.assigned} เครื่อง${failed.length ? ` · ไม่สำเร็จ ${failed.length} (ดูในตาราง)` : ''}`);
      for (const key of ['holder-suggestions', 'assets', 'asset']) void qc.invalidateQueries({ queryKey: [key] });
    },
    onError: (e) => toast.error(errorMessage(e)),
  });

  if (q.isLoading) return <Loading rows={6} />;
  const all = q.data?.rows ?? [];
  if (!all.length) {
    return (
      <Empty icon={<CheckCircle2 className="h-5 w-5" />} title="ผูกเครื่องครบแล้ว">
        ไม่มีเครื่องจากแบบสำรวจที่ยังไม่ผูกกับพนักงาน
      </Empty>
    );
  }
  const counts = { matched: all.filter((r) => r.match).length, review: all.filter((r) => !r.match && !r.vacant).length, vacant: all.filter((r) => r.vacant).length };

  return (
    <Card
      title="จับคู่เครื่องกับพนักงาน (จากแบบสำรวจ 09.69)"
      description={`ระบบแนะนำ ${counts.matched} เครื่อง · ต้องเลือกเอง ${counts.review} · ว่าง/ใช้ร่วม ${counts.vacant} — ติ๊กเฉพาะที่ถูกต้อง แล้วกดผูก`}
      actions={
        <div role="tablist" className="inline-flex rounded-lg bg-gray-100 p-0.5">
          {(
            [
              ['todo', 'ที่มีผู้ใช้'],
              ['review', 'ต้องตรวจ'],
              ['all', 'ทั้งหมด'],
            ] as [Filter, string][]
          ).map(([k, l]) => (
            <button key={k} type="button" role="tab" aria-selected={filter === k} onClick={() => setFilter(k)} className={`h-7 rounded-md px-2.5 text-[12px] font-medium ${filter === k ? 'bg-white shadow-card' : 'text-gray-500'}`}>
              {l}
            </button>
          ))}
        </div>
      }
      bodyClassName="p-0"
    >
      <div className="overflow-x-auto">
        <table className="w-full min-w-[52rem] text-[13px]">
          <thead>
            <tr className="border-b border-gray-100 text-left text-[12px] text-gray-500">
              <th className="w-10 px-4 py-2" />
              <th className="px-2 py-2 font-medium">เครื่อง</th>
              <th className="px-2 py-2 font-medium">ผู้ใช้ตามแบบสำรวจ</th>
              <th className="px-2 py-2 font-medium">พนักงานในระบบ</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-gray-50">
            {rows.map((r) => {
              const pid = chosen[r.code] ?? '';
              const person = people.get(pid);
              const candidateIds = new Set(r.candidates.map((c) => c.employeeId));
              const holdingOther = person && r.onePerPerson ? person.holding.filter((c) => c !== r.code) : [];
              return (
                <tr key={r.code} className={`align-top ${ticked[r.code] ? 'bg-brand-50/40' : ''}`}>
                  <td className="px-4 py-2.5">
                    <input
                      type="checkbox"
                      aria-label={`เลือก ${r.code}`}
                      className="mt-1 h-4 w-4 rounded border-gray-300"
                      disabled={!r.canAssign || !pid}
                      checked={!!ticked[r.code] && !!pid}
                      onChange={(e) => setTicked((t) => ({ ...t, [r.code]: e.target.checked }))}
                    />
                  </td>
                  <td className="px-2 py-2.5">
                    <p className="font-medium text-gray-900">{r.code}</p>
                    <p className="text-[12px] text-gray-500">
                      {r.category}
                      {r.model && ` · ${r.model}`}
                    </p>
                    {!r.canAssign && <Badge tone="amber">สถานะ {r.status} — มอบไม่ได้</Badge>}
                  </td>
                  <td className="max-w-[18rem] px-2 py-2.5 break-words text-gray-700">
                    {r.label}
                    {r.vacant && (
                      <span className="mt-1 block">
                        <Badge>ว่าง / ใช้ร่วม</Badge>
                      </span>
                    )}
                  </td>
                  <td className="px-2 py-2.5">
                    <select
                      className={inputClass}
                      value={pid}
                      disabled={!r.canAssign}
                      onChange={(e) => {
                        setChosen((c) => ({ ...c, [r.code]: e.target.value }));
                        setTicked((t) => ({ ...t, [r.code]: !!e.target.value }));
                      }}
                    >
                      <option value="">— ไม่ผูก —</option>
                      {r.candidates.length > 0 && (
                        <optgroup label="แนะนำ">
                          {r.candidates.map((c) => people.get(c.employeeId)).filter((p): p is PersonOption => !!p).map((p) => (
                            <option key={p.id} value={p.id}>
                              {label(p)}
                            </option>
                          ))}
                        </optgroup>
                      )}
                      <optgroup label="พนักงานทั้งหมด">
                        {(q.data?.people ?? []).filter((p) => !candidateIds.has(p.id)).map((p) => (
                          <option key={p.id} value={p.id}>
                            {label(p)}
                          </option>
                        ))}
                      </optgroup>
                    </select>
                    <div className="mt-1 flex flex-wrap gap-1.5 text-[11.5px]">
                      {r.match && r.match.employeeId === pid && (
                        <span className="inline-flex items-center gap-1 text-emerald-700">
                          <CheckCircle2 className="h-3 w-3" /> {HOW_LABEL[r.match.how]}
                        </span>
                      )}
                      {!r.match && r.candidates.length > 0 && (
                        <span className="inline-flex items-center gap-1 text-amber-700">
                          <CircleHelp className="h-3 w-3" /> ไม่แน่ใจ — ตรวจก่อนผูก
                        </span>
                      )}
                      {!r.match && !r.candidates.length && !r.vacant && (
                        <span className="inline-flex items-center gap-1 text-gray-400">
                          <UserX className="h-3 w-3" /> ไม่พบในระบบ (เช่น ผู้บริหาร / คนใหม่)
                        </span>
                      )}
                      {holdingOther.length > 0 && <span className="text-rose-600">ถือ {holdingOther.join(', ')} อยู่แล้ว</span>}
                      {errors[r.code] && <span className="text-rose-600">{errors[r.code]}</span>}
                    </div>
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
      <div className="space-y-3 border-t border-gray-100 px-4 py-3">
        {doubles.length > 0 && (
          <Alert tone="warning">
            เลือกคนเดียวกันให้คอมพิวเตอร์หลายเครื่อง ({doubles.map(([pid, codes]) => `${people.get(pid)?.nickname ?? people.get(pid)?.fullName}: ${codes.join(', ')}`).join(' · ')}) — 1 คนถือได้ 1 เครื่อง เครื่องที่สองจะไม่ถูกผูก
          </Alert>
        )}
        <div className="flex flex-wrap items-center justify-end gap-3">
          <label className="flex items-center gap-2 text-[13px] text-gray-600">
            เริ่มถือตั้งแต่
            <input type="date" className={`${inputClass} w-40`} value={startDate} onChange={(e) => setStartDate(e.target.value)} />
          </label>
          <Button variant="primary" disabled={!picked.length} loading={apply.isPending} onClick={() => apply.mutate()}>
            <Link2 className="h-4 w-4" /> ผูก {picked.length} เครื่อง
          </Button>
        </div>
      </div>
    </Card>
  );
}
