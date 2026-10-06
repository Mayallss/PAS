'use client';

import { keepPreviousData, useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { ArrowLeft, CalendarDays, CheckCheck, Clock, GitCompareArrows, History, MapPin, MessageSquareQuote, MessageSquareWarning, Pencil, Quote, Users } from 'lucide-react';
import Link from 'next/link';
import { use, useEffect, useRef, useState } from 'react';
import { toast } from 'sonner';
import { Alert, Badge, Button, Field, inputClass, Loading, Progress } from '@/components/ui';
import { api, ApiError, errorMessage } from '@/lib/api';
import { thaiDate } from '@/lib/format';
import { can, useSession } from '@/lib/session';
import type { CertificationView, MeetingDetail, PersonStatus } from '@/lib/types';
import { PERSON_STATUS, StatusPill } from '../_components/status';

const when = (iso: string) => new Date(iso).toLocaleString('th-TH', { dateStyle: 'medium', timeStyle: 'short' });

export default function MeetingPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = use(params);
  const me = useSession();
  const qc = useQueryClient();
  const writer = can(me, 'meeting.write');
  const [compare, setCompare] = useState<number | 'auto' | 'none'>('auto');
  const [quote, setQuote] = useState('');
  const [objecting, setObjecting] = useState(false);
  const panelRef = useRef<HTMLDivElement>(null);

  const q = useQuery({
    queryKey: ['meeting', id, compare],
    queryFn: () => api<MeetingDetail>(`/meetings/${id}`, { query: { compare: typeof compare === 'number' ? compare : undefined } }),
    placeholderData: keepPreviousData,
  });
  const m = q.data;

  useEffect(() => {
    if (m && window.location.hash === '#objections') document.getElementById('objections')?.scrollIntoView({ behavior: 'smooth' });
  }, [m]);

  const refresh = () => {
    void qc.invalidateQueries({ queryKey: ['meeting', id] });
    void qc.invalidateQueries({ queryKey: ['meetings'] });
    void qc.invalidateQueries({ queryKey: ['notifications'] });
    void qc.invalidateQueries({ queryKey: ['home'] });
  };
  const onConflict = (e: unknown) => {
    toast.error(errorMessage(e));
    if (e instanceof ApiError && e.status === 409) {
      setCompare('auto');
      refresh();
    }
  };

  if (q.isLoading || !m) return <Loading rows={8} />;
  if (q.error) return <Alert tone="error">{errorMessage(q.error)}</Alert>;

  const showDiff = compare !== 'none' && !!m.diff;
  const startObjection = (text: string) => {
    setQuote(text);
    setObjecting(true);
    setCompare('none'); // objections quote the current wording, not the highlighted diff
    requestAnimationFrame(() => panelRef.current?.scrollIntoView({ behavior: 'smooth', block: 'nearest' }));
  };

  return (
    <div className="mx-auto max-w-6xl">
      <Link href="/meetings" className="mb-4 inline-flex items-center gap-1.5 text-[13px] text-gray-500 hover:text-gray-900">
        <ArrowLeft className="h-4 w-4" /> รายงานการประชุมทั้งหมด
      </Link>

      <div className="grid gap-6 lg:grid-cols-[minmax(0,1fr)_22rem]">
        <div className="min-w-0 space-y-4">
          {/* Header */}
          <header className="animate-fade-up rounded-2xl bg-white p-6 shadow-card ring-1 ring-gray-200/80">
            <div className="flex flex-wrap items-start justify-between gap-3">
              <div className="min-w-0">
                <h1 className="text-2xl font-semibold tracking-tight text-gray-900">{m.title}</h1>
                <p className="mt-2 flex flex-wrap items-center gap-x-4 gap-y-1 text-[13px] text-gray-500">
                  <span className="inline-flex items-center gap-1.5"><CalendarDays className="h-4 w-4" /> {thaiDate(m.meetingDate)}</span>
                  {m.startTime && <span className="inline-flex items-center gap-1.5"><Clock className="h-4 w-4" /> {m.startTime}{m.endTime ? ` – ${m.endTime}` : ''} น.</span>}
                  {m.location && <span className="inline-flex items-center gap-1.5"><MapPin className="h-4 w-4" /> {m.location}</span>}
                </p>
                <p className="mt-1 text-[12px] text-gray-400">
                  บันทึกโดย {m.author} · ฉบับที่ {m.version} · แก้ไขล่าสุด {when(m.updatedAt)}
                </p>
              </div>
              {writer && (
                <Link href={`/meetings/${m.id}/edit`} className="inline-flex h-9 items-center gap-2 rounded-lg bg-white px-3.5 text-sm font-medium text-gray-800 shadow-card ring-1 ring-gray-200 ring-inset hover:bg-gray-50">
                  <Pencil className="h-4 w-4" /> แก้ไข (สร้างฉบับที่ {m.version + 1})
                </Link>
              )}
            </div>
          </header>

          {/* What changed */}
          {m.diff && (
            <RevisionBanner m={m} showDiff={showDiff} onToggle={() => setCompare(showDiff ? 'none' : 'auto')} />
          )}

          {/* Minutes */}
          <article className="animate-fade-up stagger rounded-2xl bg-white p-6 shadow-card ring-1 ring-gray-200/80 sm:p-8" style={{ '--i': 1 } as React.CSSProperties}>
            <div className="mb-4 flex flex-wrap items-center justify-between gap-2">
              <p className="text-[12px] text-gray-400">
                {m.myStatus && !showDiff ? 'เลือก (ลากคลุม) ข้อความที่ไม่ถูกต้องเพื่อแย้ง' : showDiff ? 'กำลังแสดงการเปลี่ยนแปลง — ปิดไฮไลต์เพื่อเลือกข้อความแย้ง' : ''}
              </p>
              {m.revisions.length > 1 && (
                <label className="flex items-center gap-2 text-[12px] text-gray-500">
                  <GitCompareArrows className="h-4 w-4" /> เปรียบเทียบกับ
                  <select
                    className="h-8 rounded-md border-0 bg-gray-50 px-2 text-[12px] ring-1 ring-gray-200"
                    value={typeof compare === 'number' ? compare : compare === 'none' ? 'none' : m.diff ? m.diff.from : 'none'}
                    onChange={(e) => setCompare(e.target.value === 'none' ? 'none' : Number(e.target.value))}
                  >
                    <option value="none">— ไม่เปรียบเทียบ —</option>
                    {m.revisions
                      .filter((r) => r.version < m.version)
                      .map((r) => (
                        <option key={r.version} value={r.version}>ฉบับที่ {r.version}</option>
                      ))}
                  </select>
                </label>
              )}
            </div>
            <SelectableMinutes html={showDiff ? m.diff!.html : m.bodyHtml} canObject={!!m.myStatus && !showDiff} onObject={startObjection} />
          </article>

          {writer && m.roster && <WriterSection m={m} onReplied={refresh} />}
        </div>

        {/* Side panel */}
        <aside className="space-y-4 lg:sticky lg:top-8 lg:self-start" ref={panelRef}>
          <CertifyPanel
            m={m}
            objecting={objecting}
            setObjecting={setObjecting}
            quote={quote}
            setQuote={setQuote}
            onDone={() => {
              setObjecting(false);
              setQuote('');
              setCompare('auto');
              refresh();
            }}
            onConflict={onConflict}
          />
          <Revisions m={m} onCompare={(v) => setCompare(v)} />
        </aside>
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------

function RevisionBanner({ m, showDiff, onToggle }: { m: MeetingDetail; showDiff: boolean; onToggle: () => void }) {
  const d = m.diff!;
  const notes = m.revisions.filter((r) => r.version > d.from && r.version <= d.to);
  const outdated = m.myStatus === 'OUTDATED';
  return (
    <section className={`animate-fade-up rounded-2xl p-5 ring-1 ${outdated ? 'bg-amber-50 ring-amber-200' : 'bg-sky-50 ring-sky-200'}`}>
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <p className={`text-[14px] font-semibold ${outdated ? 'text-amber-900' : 'text-sky-900'}`}>
            {outdated ? `รายงานถูกแก้ไขหลังคุณรับรอง (ฉบับที่ ${d.from} → ${d.to}) — กรุณาตรวจส่วนที่ไฮไลต์แล้วรับรองใหม่` : `การเปลี่ยนแปลงจากฉบับที่ ${d.from} → ${d.to}`}
          </p>
          <ul className="mt-2 space-y-1 text-[13px] text-gray-700">
            {notes.map((r) => (
              <li key={r.version}>
                <span className="font-medium">ฉบับที่ {r.version}:</span> {r.changeNote || 'ไม่ระบุ'}{' '}
                {!r.requiresRecertification && <Badge>แก้เล็กน้อย</Badge>}
              </li>
            ))}
          </ul>
          <p className="mt-3 flex flex-wrap items-center gap-3 text-[12px] text-gray-600">
            <span className="inline-flex items-center gap-1"><ins className="rounded bg-[#dcfce7] px-1 text-[#14532d] no-underline shadow-[inset_0_-2px_0_#22c55e]">ข้อความใหม่</ins> เพิ่ม/แก้เป็น</span>
            <span className="inline-flex items-center gap-1"><del className="rounded bg-[#fee2e2] px-1 text-[#7f1d1d]">ข้อความเดิม</del> ถูกลบ</span>
            <span>+{d.added} / −{d.removed} คำ</span>
          </p>
        </div>
        <Button size="sm" onClick={onToggle}>
          {showDiff ? 'ซ่อนไฮไลต์' : 'แสดงไฮไลต์'}
        </Button>
      </div>
    </section>
  );
}

/** Renders sanitised minutes; selecting text offers "แย้งข้อความนี้" right next to the selection. */
function SelectableMinutes({ html, canObject, onObject }: { html: string; canObject: boolean; onObject: (text: string) => void }) {
  const box = useRef<HTMLDivElement>(null);
  const [pick, setPick] = useState<{ text: string; x: number; y: number } | null>(null);

  const onMouseUp = () => {
    if (!canObject) return;
    const sel = window.getSelection();
    const text = sel?.toString().replace(/\s+/g, ' ').trim() ?? '';
    if (!sel || !text || sel.rangeCount === 0 || !box.current?.contains(sel.anchorNode)) return setPick(null);
    const r = sel.getRangeAt(0).getBoundingClientRect();
    const b = box.current.getBoundingClientRect();
    setPick({ text: text.slice(0, 1000), x: r.left - b.left + r.width / 2, y: r.top - b.top });
  };

  return (
    <div className="relative" onMouseUp={onMouseUp} onKeyUp={onMouseUp}>
      {/* HTML is sanitised by the API (allow-list) both on write and on read. */}
      <div ref={box} className="minutes" dangerouslySetInnerHTML={{ __html: html }} />
      {pick && (
        <button
          type="button"
          onMouseDown={(e) => e.preventDefault()}
          onClick={() => {
            onObject(pick.text);
            setPick(null);
            window.getSelection()?.removeAllRanges();
          }}
          className="absolute z-10 inline-flex -translate-x-1/2 -translate-y-[calc(100%+8px)] animate-pop-in items-center gap-1.5 rounded-lg bg-gray-900 px-3 py-1.5 text-[12px] font-medium whitespace-nowrap text-white shadow-pop"
          style={{ left: pick.x, top: pick.y }}
        >
          <MessageSquareWarning className="h-3.5 w-3.5 text-pas-yellow" /> แย้งข้อความนี้
        </button>
      )}
    </div>
  );
}

function CertifyPanel({
  m, objecting, setObjecting, quote, setQuote, onDone, onConflict,
}: {
  m: MeetingDetail;
  objecting: boolean;
  setObjecting: (v: boolean) => void;
  quote: string;
  setQuote: (v: string) => void;
  onDone: () => void;
  onConflict: (e: unknown) => void;
}) {
  const [note, setNote] = useState('');
  const certify = useMutation({
    mutationFn: (body: object) => api<{ status: PersonStatus }>(`/meetings/${m.id}/certify`, { method: 'POST', body: { version: m.version, ...body } }),
    onSuccess: (r) => {
      toast.success(r.status === 'ACCEPTED' ? 'รับรองรายงานแล้ว' : 'ส่งข้อโต้แย้งแล้ว ผู้บันทึกจะได้รับแจ้ง');
      setNote('');
      onDone();
    },
    onError: onConflict,
  });

  if (!m.myStatus) {
    return (
      <section className="rounded-2xl bg-white p-5 shadow-card ring-1 ring-gray-200/80">
        <p className="text-[13px] text-gray-600">{m.isAuthor ? 'คุณเป็นผู้บันทึกรายงานนี้ — ไม่ต้องรับรองเอง' : 'คุณไม่อยู่ในรายชื่อผู้ต้องรับรองรายงานนี้'}</p>
      </section>
    );
  }
  const latest = [...m.myHistory].sort((a, b) => b.version - a.version)[0];
  const done = m.myStatus === 'ACCEPTED';

  return (
    <section className="animate-fade-up space-y-4 rounded-2xl bg-white p-5 shadow-card ring-1 ring-gray-200/80">
      <div>
        <p className="mb-2 text-[13px] font-semibold text-gray-900">การรับรองของคุณ · ฉบับที่ {m.version}</p>
        <StatusPill status={m.myStatus} long />
      </div>

      {latest?.status === 'OBJECTION' && (
        <div className="space-y-2 rounded-xl bg-gray-50 p-3 text-[13px]">
          <p className="text-[12px] text-gray-500">ข้อโต้แย้งของคุณ (ฉบับที่ {latest.version})</p>
          <blockquote className="border-l-2 border-rose-300 pl-2 text-gray-700">“{latest.quote}”</blockquote>
          <p className="text-gray-700">{latest.note}</p>
          {latest.reply && (
            <div className="rounded-lg bg-sky-50 p-2.5 text-sky-900 ring-1 ring-sky-200">
              <p className="text-[12px] font-medium">คำตอบจาก {latest.repliedBy}</p>
              <p>{latest.reply}</p>
            </div>
          )}
        </div>
      )}

      {!objecting ? (
        <div className="grid gap-2">
          {!done && (
            <Button variant="primary" className="h-10" loading={certify.isPending} onClick={() => certify.mutate({ status: 'ACCEPTED' })}>
              <CheckCheck className="h-4 w-4" /> รับรองว่ารายงานถูกต้อง
            </Button>
          )}
          <Button variant={done ? 'secondary' : 'danger'} onClick={() => setObjecting(true)}>
            <MessageSquareWarning className="h-4 w-4" /> {done ? 'พบข้อผิดพลาด? แย้งรายงาน' : 'ไม่ถูกต้อง — แย้ง'}
          </Button>
          {done && latest && <p className="text-center text-[12px] text-gray-500">รับรองฉบับที่ {latest.version} เมื่อ {when(latest.at)}</p>}
        </div>
      ) : (
        <form
          className="space-y-3"
          onSubmit={(e) => {
            e.preventDefault();
            certify.mutate({ status: 'OBJECTION', quote, note });
          }}
        >
          <Field label="ข้อความที่ไม่ถูกต้อง" hint="ลากคลุมข้อความในรายงานเพื่อเติมอัตโนมัติ (ต้องตรงกับในรายงาน)">
            <textarea className={inputClass} rows={3} required maxLength={1000} value={quote} onChange={(e) => setQuote(e.target.value)} />
          </Field>
          <Field label="ที่ถูกต้องควรเป็น / เหตุผล">
            <textarea className={inputClass} rows={3} required maxLength={2000} value={note} onChange={(e) => setNote(e.target.value)} autoFocus={!!quote} />
          </Field>
          <div className="flex gap-2">
            <Button variant="ghost" onClick={() => setObjecting(false)}>ยกเลิก</Button>
            <Button type="submit" variant="danger" className="flex-1" loading={certify.isPending} disabled={!quote.trim() || !note.trim()}>
              ส่งข้อโต้แย้ง
            </Button>
          </div>
        </form>
      )}
    </section>
  );
}

function Revisions({ m, onCompare }: { m: MeetingDetail; onCompare: (v: number) => void }) {
  return (
    <section className="rounded-2xl bg-white p-5 shadow-card ring-1 ring-gray-200/80">
      <p className="mb-3 flex items-center gap-2 text-[13px] font-semibold text-gray-900">
        <History className="h-4 w-4 text-gray-400" /> ประวัติการแก้ไข
      </p>
      <ol className="relative space-y-4 border-l border-gray-200 pl-4">
        {m.revisions.map((r) => (
          <li key={r.version} className="relative">
            <span className={`absolute top-1 -left-[21px] h-2.5 w-2.5 rounded-full ring-4 ring-white ${r.version === m.version ? 'bg-brand-600' : 'bg-gray-300'}`} />
            <p className="text-[13px] font-medium text-gray-900">
              ฉบับที่ {r.version} {r.version === m.version && <Badge tone="brand">ล่าสุด</Badge>}{' '}
              {r.version > 1 && (r.requiresRecertification ? <Badge tone="amber">ต้องรับรองใหม่</Badge> : <Badge>แก้เล็กน้อย</Badge>)}
            </p>
            <p className="text-[12px] text-gray-500">{r.author} · {when(r.createdAt)}</p>
            {r.changeNote && <p className="mt-1 text-[12px] text-gray-700">{r.changeNote}</p>}
            {r.version < m.version && (
              <button type="button" onClick={() => onCompare(r.version)} className="mt-1 text-[12px] font-medium text-brand-600 hover:underline">
                เปรียบเทียบกับฉบับล่าสุด
              </button>
            )}
          </li>
        ))}
      </ol>
    </section>
  );
}

// ---------------------------------------------------------------------------

function WriterSection({ m, onReplied }: { m: MeetingDetail; onReplied: () => void }) {
  const roster = m.roster!;
  const count = (s: PersonStatus[]) => roster.filter((r) => s.includes(r.status)).length;
  const latestByPerson = new Map<string, CertificationView>();
  for (const o of m.objections ?? []) {
    const p = latestByPerson.get(o.employeeId);
    if (!p || o.version > p.version) latestByPerson.set(o.employeeId, o);
  }
  const open = roster.filter((r) => r.status === 'OBJECTION').map((r) => latestByPerson.get(r.employeeId)!).filter(Boolean);
  const history = (m.objections ?? []).filter((o) => !open.includes(o));

  return (
    <section id="objections" className="scroll-mt-8 space-y-4">
      <div className="rounded-2xl bg-white p-5 shadow-card ring-1 ring-gray-200/80">
        <p className="mb-3 flex items-center gap-2 text-[14px] font-semibold"><Users className="h-4 w-4 text-brand-600" /> สถานะการรับรอง (ฉบับที่ {m.version})</p>
        <div className="mb-4 flex flex-wrap items-center gap-3 text-[12px]">
          <Progress className="min-w-40 flex-1" value={count(['ACCEPTED'])} max={roster.length} />
          <Badge tone="brand">รับรอง {count(['ACCEPTED'])}</Badge>
          <Badge tone="rose">แย้ง {count(['OBJECTION'])}</Badge>
          <Badge tone="sky">ตอบแล้ว {count(['OBJECTION_REPLIED'])}</Badge>
          <Badge tone="amber">รอ {count(['PENDING', 'OUTDATED'])}</Badge>
        </div>
        <ul className="grid gap-x-6 gap-y-1.5 sm:grid-cols-2">
          {roster.map((r) => (
            <li key={r.employeeId} className="flex items-center justify-between gap-2 text-[13px]">
              <span className="truncate text-gray-800">{r.fullName}</span>
              <span className={`shrink-0 rounded-full px-2 py-0.5 text-[11px] ring-1 ring-inset ${PERSON_STATUS[r.status].className}`}>{PERSON_STATUS[r.status].short}</span>
            </li>
          ))}
        </ul>
      </div>

      <div className="rounded-2xl bg-white p-5 shadow-card ring-1 ring-gray-200/80">
        <p className="mb-3 flex items-center gap-2 text-[14px] font-semibold">
          <MessageSquareQuote className="h-4 w-4 text-rose-500" /> ข้อโต้แย้งที่รอดำเนินการ ({open.length})
        </p>
        {open.length === 0 ? (
          <p className="text-[13px] text-gray-500">ไม่มีข้อโต้แย้งค้าง</p>
        ) : (
          <ul className="space-y-4">
            {open.map((o) => (
              <ObjectionItem key={`${o.employeeId}-${o.version}`} meetingId={m.id} o={o} onReplied={onReplied} />
            ))}
          </ul>
        )}
        <p className="mt-4 text-[12px] text-gray-500">
          แก้ตามข้อโต้แย้ง → กด “แก้ไข” แล้วเลือก “ทุกคนต้องรับรองใหม่” · ไม่แก้ → ตอบเหตุผลให้ผู้แย้งพิจารณา
        </p>
        {history.length > 0 && (
          <details className="mt-4">
            <summary className="cursor-pointer text-[12px] font-medium text-gray-600">ข้อโต้แย้งที่ผ่านมา ({history.length})</summary>
            <ul className="mt-3 space-y-3">
              {history.map((o) => (
                <li key={`${o.employeeId}-${o.version}`} className="rounded-lg bg-gray-50 p-3 text-[12px] text-gray-600">
                  <p className="font-medium text-gray-800">{o.employee} · ฉบับที่ {o.version}</p>
                  <p className="mt-1">“{o.quote}” → {o.note}</p>
                  {o.reply && <p className="mt-1 text-sky-800">ตอบ: {o.reply}</p>}
                </li>
              ))}
            </ul>
          </details>
        )}
      </div>
    </section>
  );
}

function ObjectionItem({ meetingId, o, onReplied }: { meetingId: string; o: CertificationView; onReplied: () => void }) {
  const [reply, setReply] = useState('');
  const send = useMutation({
    mutationFn: () => api(`/meetings/${meetingId}/objections/${o.employeeId}/reply`, { method: 'POST', body: { version: o.version, reply } }),
    onSuccess: () => {
      toast.success('ส่งคำตอบแล้ว');
      onReplied();
    },
    onError: (e) => toast.error(errorMessage(e)),
  });
  return (
    <li className="rounded-xl p-4 ring-1 ring-rose-200">
      <p className="text-[13px] font-medium text-gray-900">
        {o.employee} <span className="font-normal text-gray-500">· ฉบับที่ {o.version} · {when(o.at)}</span>
      </p>
      <blockquote className="mt-2 flex gap-2 rounded-lg bg-rose-50 p-2.5 text-[13px] text-rose-900">
        <Quote className="h-4 w-4 shrink-0 opacity-60" /> {o.quote}
      </blockquote>
      <p className="mt-2 text-[13px] text-gray-700">
        <span className="text-gray-500">ควรเป็น:</span> {o.note}
      </p>
      <form
        className="mt-3 flex gap-2"
        onSubmit={(e) => {
          e.preventDefault();
          if (reply.trim()) send.mutate();
        }}
      >
        <input className={inputClass} placeholder="ตอบเหตุผล (กรณีไม่แก้ไขรายงาน)" maxLength={1000} value={reply} onChange={(e) => setReply(e.target.value)} />
        <Button type="submit" size="md" loading={send.isPending} disabled={!reply.trim()}>ตอบ</Button>
      </form>
    </li>
  );
}
