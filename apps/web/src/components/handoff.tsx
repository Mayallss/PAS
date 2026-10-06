'use client';

/**
 * รับ–ส่งเอกสาร — ticket details and the signing form, shared by the portal page (/handoff)
 * and the share-link page (/sign). Ported from DELIPAS handoff-app.tsx.
 */

import {
  CalendarDays,
  Check,
  CheckCheck,
  ChevronDown,
  CircleCheck,
  CircleX,
  ClipboardCheck,
  Clock3,
  FileText,
  Hash,
  Layers,
  MapPin,
  Paperclip,
  PenLine,
  Phone,
  RefreshCw,
  RotateCcw,
  ShieldCheck,
  Signature,
  TriangleAlert,
  User,
} from 'lucide-react';
import { useEffect, useRef, useState } from 'react';
import { Alert, Button, inputClass } from '@/components/ui';
import { ApiError, errorMessage } from '@/lib/api';
import { type HandoffItem, type Outcome, OUTCOMES, type SaveBody, type SaveResult, statusTone } from '@/lib/handoffs';

const OUTCOME_ICON = { '1': CircleCheck, '0': TriangleAlert, '2': CircleX } as const;
const TONE = {
  done: 'bg-emerald-50 text-emerald-700 ring-emerald-200',
  issue: 'bg-amber-50 text-amber-800 ring-amber-200',
  open: 'bg-gray-100 text-gray-600 ring-gray-200',
};

export function StatusPill({ status, children }: { status: string; children?: React.ReactNode }) {
  const tone = statusTone(status);
  const Icon = tone === 'done' ? CircleCheck : tone === 'issue' ? TriangleAlert : Clock3;
  return (
    <span className={`inline-flex max-w-full items-center gap-1 rounded-full px-2 py-0.5 text-[11.5px] font-medium ring-1 ring-inset ${TONE[tone]}`}>
      <Icon className="h-3.5 w-3.5 shrink-0" aria-hidden />
      <span className="truncate">{children ?? (status || 'ยังไม่ระบุสถานะ')}</span>
    </span>
  );
}

function Chip({ icon: Icon, children }: { icon: typeof Hash; children: React.ReactNode }) {
  return (
    <span className="inline-flex items-center gap-1 rounded-md bg-gray-100 px-2 py-0.5 text-[12px] text-gray-700">
      <Icon className="h-3.5 w-3.5 text-gray-400" aria-hidden />
      {children}
    </span>
  );
}

/** Left column: what is being handed over. Collapsed by default on phones so the signature pad is near the top. */
export function ItemDetails({ item, status }: { item: HandoffItem; status?: string }) {
  const [wide, setWide] = useState(true);
  useEffect(() => setWide(window.matchMedia('(min-width: 1024px)').matches), []);
  const meta: [typeof Hash, string, string][] = [
    [Layers, 'ประเภทงาน', item.type],
    [Clock3, 'ช่วงเวลา', item.period],
    [Phone, 'ผู้ติดต่อ', item.contact],
    [MapPin, 'สถานที่เพิ่มเติม', item.location],
  ];
  return (
    <section className="rounded-xl bg-white shadow-card ring-1 ring-gray-200/80">
      <div className="space-y-3 p-5">
        <p className="flex items-center gap-1.5 text-[11px] font-semibold tracking-wider text-brand-600 uppercase">
          <FileText className="h-3.5 w-3.5" aria-hidden /> รายละเอียดรายการ
        </p>
        <h2 className="text-lg leading-snug font-semibold text-gray-900">{item.customer}</h2>
        <div className="flex flex-wrap items-center gap-1.5">
          <Chip icon={Hash}>{item.id}</Chip>
          <Chip icon={CalendarDays}>{item.date || 'ไม่ระบุวันที่'}</Chip>
          {item.period && <Chip icon={Clock3}>{item.period}</Chip>}
          <StatusPill status={status ?? item.status} />
        </div>
      </div>
      <details className="group border-t border-gray-100" open={wide} key={String(wide)}>
        <summary className="flex cursor-pointer list-none items-center justify-between px-5 py-3 text-[13px] font-medium text-gray-700 hover:bg-gray-50">
          <span className="flex items-center gap-1.5">
            <ClipboardCheck className="h-4 w-4 text-gray-400" aria-hidden /> รายละเอียดทั้งหมด
          </span>
          <ChevronDown className="h-4 w-4 text-gray-400 transition-transform group-open:rotate-180" aria-hidden />
        </summary>
        <div className="space-y-4 px-5 pb-5">
          <dl className="grid grid-cols-[auto_1fr] gap-x-4 gap-y-1.5 text-[13px]">
            {meta
              .filter(([, label, value]) => value || label !== 'สถานที่เพิ่มเติม')
              .map(([Icon, label, value]) => (
                <div key={label} className="contents">
                  <dt className="flex items-center gap-1.5 text-gray-500">
                    <Icon className="h-3.5 w-3.5" aria-hidden /> {label}
                  </dt>
                  <dd className="text-gray-900">{value || '—'}</dd>
                </div>
              ))}
          </dl>
          {item.documents.length > 0 && (
            <div>
              <h3 className="mb-2 text-[12px] font-semibold text-gray-500">เอกสารในรายการ</h3>
              <ul className="divide-y divide-gray-100 rounded-lg ring-1 ring-gray-200">
                {item.documents.map((d) => (
                  <li key={d.title} className="flex items-start gap-2.5 px-3 py-2">
                    <FileText className="mt-0.5 h-4 w-4 shrink-0 text-brand-500" aria-hidden />
                    <div className="min-w-0 text-[13px]">
                      <p className="font-medium text-gray-900">{d.title}</p>
                      <p className="break-words text-gray-600">
                        {d.detail || '—'}
                        {d.quantity && <span className="text-gray-500"> · จำนวน {d.quantity}</span>}
                      </p>
                    </div>
                  </li>
                ))}
              </ul>
            </div>
          )}
          {item.note && (
            <div>
              <h3 className="mb-1.5 flex items-center gap-1.5 text-[12px] font-semibold text-gray-500">
                <PenLine className="h-3.5 w-3.5" aria-hidden /> หมายเหตุจาก monday
              </h3>
              <p className="rounded-lg bg-amber-50/60 px-3 py-2 text-[13px] whitespace-pre-line text-gray-800">{item.note}</p>
            </div>
          )}
        </div>
      </details>
      <p className="flex items-center gap-1.5 border-t border-gray-100 px-5 py-2.5 text-[12px] text-gray-500">
        <Paperclip className="h-3.5 w-3.5" aria-hidden /> หลักฐานเดิม {item.files.length} ไฟล์
      </p>
    </section>
  );
}

interface Draft {
  name: string;
  outcome: Outcome;
  signature: string;
  /** The exact body already sent once: a retry re-sends it so the API can recognise the replay. */
  pending: SaveBody | null;
}
const draftKey = (id: string) => `handoff-draft-${id}`;
function readDraft(id: string): Draft | null {
  try {
    return JSON.parse(localStorage.getItem(draftKey(id)) || 'null');
  } catch {
    return null;
  }
}
const haptic = (pattern: number | number[] = 10) => {
  try {
    navigator.vibrate?.(pattern);
  } catch {}
};

/**
 * Outcome + signer name + signature pad. The draft (and a request already sent once) survives a
 * reload in localStorage, so a dropped connection on a phone never loses a signature or applies it twice.
 * Key this component by item id.
 */
export function SignForm({
  item,
  context,
  save,
  onReopen,
  onSaved,
  done,
}: {
  item: HandoffItem;
  context: string;
  save: (body: SaveBody) => Promise<SaveResult>;
  /** Discard the draft and load the ticket again (after it changed in monday or the token expired). */
  onReopen: () => void;
  onSaved?: (status: string) => void;
  /** What to show under the receipt (e.g. a "back to list" button). */
  done?: React.ReactNode;
}) {
  const [initial] = useState(() => readDraft(item.id));
  const [name, setName] = useState(initial?.name ?? '');
  const [outcome, setOutcome] = useState<Outcome>(initial?.outcome ?? '1');
  const [signed, setSigned] = useState(!!initial?.signature);
  const [pending, setPending] = useState<SaveBody | null>(initial?.pending ?? null);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<{ message: string; stale: boolean } | null>(null);
  const [storageError, setStorageError] = useState(false);
  const [success, setSuccess] = useState<string | null>(null);
  const [inking, setInking] = useState(false);

  const canvas = useRef<HTMLCanvasElement>(null);
  const signature = useRef(initial?.signature ?? '');
  const drawing = useRef(false);
  const ink = useRef(0);
  const busy = useRef(false);
  const timer = useRef<ReturnType<typeof setTimeout>>(undefined);

  function writeDraft(draft: Draft) {
    try {
      localStorage.setItem(draftKey(item.id), JSON.stringify(draft));
      setStorageError(false);
    } catch {
      setStorageError(true);
    }
  }
  function saveDraft(next: Partial<Draft> = {}, now = false) {
    clearTimeout(timer.current);
    const draft: Draft = { name, outcome, signature: signature.current, pending, ...next };
    if (now) writeDraft(draft);
    else timer.current = setTimeout(() => writeDraft(draft), 350);
  }
  function clearDraft() {
    clearTimeout(timer.current);
    try {
      localStorage.removeItem(draftKey(item.id));
    } catch {}
  }

  function paint(data = '') {
    const c = canvas.current;
    if (!c) return;
    const x = c.getContext('2d')!;
    x.fillStyle = '#fff';
    x.fillRect(0, 0, c.width, c.height);
    if (data) {
      const img = new Image();
      img.onload = () => x.drawImage(img, 0, 0, c.width, c.height);
      img.src = data;
    }
  }
  // Drawing buffer at device resolution (max 2×) so a stroke lands under the finger.
  function fit() {
    const c = canvas.current;
    if (!c) return;
    const r = c.getBoundingClientRect();
    if (!r.width) return;
    const scale = Math.min(window.devicePixelRatio || 1, 2);
    const w = Math.round(r.width * scale);
    const h = Math.round(r.height * scale);
    if (c.width !== w || c.height !== h) {
      c.width = w;
      c.height = h;
    }
    paint(signature.current);
  }
  useEffect(() => {
    if (success) return;
    fit();
    window.addEventListener('resize', fit);
    window.addEventListener('orientationchange', fit);
    return () => {
      window.removeEventListener('resize', fit);
      window.removeEventListener('orientationchange', fit);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [success]);
  useEffect(() => () => clearTimeout(timer.current), []);

  function point(e: React.PointerEvent<HTMLCanvasElement>) {
    const c = e.currentTarget;
    const r = c.getBoundingClientRect();
    return [((e.clientX - r.left) * c.width) / r.width, ((e.clientY - r.top) * c.height) / r.height] as const;
  }
  function start(e: React.PointerEvent<HTMLCanvasElement>) {
    if (e.button !== 0) return;
    e.preventDefault();
    e.currentTarget.setPointerCapture(e.pointerId);
    drawing.current = true;
    setInking(true);
    const c = e.currentTarget;
    const x = c.getContext('2d')!;
    const [px, py] = point(e);
    x.beginPath();
    x.moveTo(px, py);
    x.lineWidth = Math.max(3, (3 * c.width) / c.getBoundingClientRect().width);
    x.lineCap = 'round';
    x.lineJoin = 'round';
    x.strokeStyle = '#1f2163';
  }
  function move(e: React.PointerEvent<HTMLCanvasElement>) {
    if (!drawing.current) return;
    const x = e.currentTarget.getContext('2d')!;
    const [px, py] = point(e);
    x.lineTo(px, py);
    x.stroke();
    ink.current++;
  }
  function end(e: React.PointerEvent<HTMLCanvasElement>) {
    drawing.current = false;
    setInking(false);
    if (ink.current > 2) {
      signature.current = e.currentTarget.toDataURL('image/png');
      setSigned(true);
      saveDraft({ signature: signature.current });
    }
  }
  function clearPad() {
    haptic(8);
    signature.current = '';
    ink.current = 0;
    setSigned(false);
    paint();
    saveDraft({ signature: '' });
  }

  /** The evidence uploaded to monday: a small receipt with the ticket, signer and outcome above the signature. */
  function receipt() {
    const src = canvas.current!;
    const margin = 40;
    const width = 1000;
    const inner = width - margin * 2;
    const top = 250;
    const drawn = Math.round((inner * src.height) / src.width);
    const out = document.createElement('canvas');
    out.width = width;
    out.height = top + drawn + 70;
    const c = out.getContext('2d')!;
    c.fillStyle = '#fff';
    c.fillRect(0, 0, out.width, out.height);
    c.fillStyle = '#1f2163';
    c.font = 'bold 28px Tahoma, sans-serif';
    c.fillText('หลักฐานการรับ–ส่งเอกสาร', margin, 55);
    c.font = '20px Tahoma, sans-serif';
    c.fillText(`เลขที่รายการ: ${item.id}  ·  ${item.customer}`, margin, 98, inner);
    c.fillText(`ผู้เซ็น: ${name.trim()}`, margin, 135, inner);
    c.fillText(`ผล: ${OUTCOMES.find((o) => o.value === outcome)!.full}`, margin, 174, inner);
    c.fillText(`เวลาที่อุปกรณ์บันทึก: ${new Date().toLocaleString('th-TH')}`, margin, 212);
    c.drawImage(src, margin, top, inner, drawn);
    c.font = '16px Tahoma, sans-serif';
    c.fillText('PAS · รับ–ส่งเอกสาร', margin, out.height - 26);
    return out.toDataURL('image/png');
  }

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    if (busy.current) return;
    if (!pending && (!signed || !name.trim())) return;
    busy.current = true;
    setSaving(true);
    setError(null);
    let body = pending;
    try {
      if (!body) {
        body = { itemId: item.id, name: name.trim(), outcome, signature: receipt(), context, requestId: crypto.randomUUID() };
        setPending(body);
        saveDraft({ pending: body }, true);
      }
      const res = await save(body);
      haptic([14, 70, 22]);
      clearDraft();
      setPending(null);
      setSuccess(res.status);
      onSaved?.(res.status);
    } catch (err) {
      const code = err instanceof ApiError ? err.code : '';
      // These cannot succeed by re-sending: the ticket must be opened again.
      const stale = ['CHANGED_IN_MONDAY', 'CHANGED_DURING_SAVE', 'TOKEN_EXPIRED', 'CONTEXT_MISMATCH', 'BOARD_CHANGED', 'NOT_FOUND'].includes(code);
      setError({ message: errorMessage(err), stale });
    } finally {
      busy.current = false;
      setSaving(false);
    }
  }

  if (success) {
    return (
      <section className="rounded-xl bg-white p-6 text-center shadow-card ring-1 ring-gray-200/80">
        <span className="mx-auto mb-3 flex h-14 w-14 items-center justify-center rounded-full bg-emerald-50 text-emerald-600 ring-8 ring-emerald-50/60">
          <CheckCheck className="h-7 w-7" aria-hidden />
        </span>
        <h2 className="text-lg font-semibold text-gray-900">บันทึกใน monday แล้ว</h2>
        <div className="mt-2">
          <StatusPill status={success} />
        </div>
        <dl className="mx-auto mt-5 grid max-w-sm grid-cols-[auto_1fr] gap-x-4 gap-y-2 text-left text-[13px]">
          <dt className="flex items-center gap-1.5 text-gray-500">
            <Hash className="h-3.5 w-3.5" aria-hidden /> เลขที่รายการ
          </dt>
          <dd className="font-medium text-gray-900">{item.id}</dd>
          <dt className="flex items-center gap-1.5 text-gray-500">
            <User className="h-3.5 w-3.5" aria-hidden /> ผู้เซ็น
          </dt>
          <dd className="font-medium text-gray-900">{name}</dd>
          <dt className="flex items-center gap-1.5 text-gray-500">
            <Paperclip className="h-3.5 w-3.5" aria-hidden /> หลักฐาน
          </dt>
          <dd className="text-gray-900">แนบในคอลัมน์หลักฐานของรายการ</dd>
        </dl>
        {done && <div className="mt-6">{done}</div>}
      </section>
    );
  }

  const locked = saving || !!pending;
  return (
    <form onSubmit={submit} className="rounded-xl bg-white shadow-card ring-1 ring-gray-200/80">
      <header className="flex items-center gap-3 border-b border-gray-100 px-5 py-4">
        <span className="flex h-9 w-9 items-center justify-center rounded-lg bg-brand-50 text-brand-600">
          <PenLine className="h-[18px] w-[18px]" aria-hidden />
        </span>
        <div>
          <h2 className="text-[15px] font-semibold text-gray-900">ยืนยันผลรับ–ส่ง</h2>
          <p className="text-[12.5px] text-gray-500">เลือกผลตามจริง แล้วให้ผู้เกี่ยวข้องเซ็น</p>
        </div>
      </header>
      <fieldset disabled={locked} className="space-y-5 p-5">
        <div>
          <legend className="mb-2 text-[13px] font-medium text-gray-700">ผลรับ–ส่งเอกสาร</legend>
          <div className="grid gap-2 sm:grid-cols-3" role="radiogroup">
            {OUTCOMES.map((o) => {
              const Icon = OUTCOME_ICON[o.value];
              const on = outcome === o.value;
              const tone = o.value === '1' ? 'text-emerald-600' : o.value === '0' ? 'text-amber-600' : 'text-rose-600';
              return (
                <label
                  key={o.value}
                  className={`flex cursor-pointer items-center gap-2.5 rounded-lg px-3 py-2.5 text-[13px] ring-1 transition ring-inset ${
                    on ? 'bg-brand-50/70 font-medium text-gray-900 ring-2 ring-brand-500' : 'text-gray-700 ring-gray-200 hover:bg-gray-50'
                  }`}
                >
                  <input
                    type="radio"
                    name="outcome"
                    value={o.value}
                    checked={on}
                    onChange={() => {
                      haptic(6);
                      setOutcome(o.value);
                      saveDraft({ outcome: o.value });
                    }}
                    className="sr-only"
                  />
                  <Icon className={`h-5 w-5 shrink-0 ${tone}`} aria-hidden />
                  <span>{o.label}</span>
                </label>
              );
            })}
          </div>
        </div>
        <label className="block">
          <span className="mb-1.5 block text-[13px] font-medium text-gray-700">
            ชื่อ–นามสกุลผู้เซ็น <span className="text-rose-500">*</span>
          </span>
          <input
            className={`${inputClass} h-11 text-base sm:h-10 sm:text-sm`}
            maxLength={120}
            required
            autoComplete="off"
            placeholder="ระบุชื่อผู้เซ็น"
            value={name}
            onChange={(e) => {
              setName(e.target.value);
              saveDraft({ name: e.target.value });
            }}
          />
        </label>
        <div>
          <div className="mb-1.5 flex items-center justify-between">
            <span className="text-[13px] font-medium text-gray-700">
              ลายเซ็น <span className="text-rose-500">*</span>
            </span>
            <Button variant="ghost" size="sm" onClick={clearPad} disabled={!signed || locked}>
              <RotateCcw className="h-3.5 w-3.5" aria-hidden /> เซ็นใหม่
            </Button>
          </div>
          <div className={`relative overflow-hidden rounded-xl border bg-white transition ${inking ? 'border-brand-500 ring-2 ring-brand-500/30' : 'border-gray-300'}`}>
            <canvas
              ref={canvas}
              width={1000}
              height={420}
              className="block aspect-[5/2.1] w-full cursor-crosshair touch-none"
              style={{ pointerEvents: locked ? 'none' : 'auto' }}
              aria-label="พื้นที่เซ็นด้วยนิ้ว ปากกา หรือเมาส์"
              onPointerDown={start}
              onPointerMove={move}
              onPointerUp={end}
              onPointerCancel={end}
            />
            {!signed && (
              <div className={`pointer-events-none absolute inset-0 flex flex-col items-center justify-center gap-1 text-gray-400 transition-opacity ${inking ? 'opacity-0' : ''}`}>
                <Signature className="h-7 w-7" aria-hidden />
                <span className="text-sm font-medium">เซ็นชื่อที่นี่</span>
                <span className="text-[11.5px]">ใช้นิ้ว ปากกา หรือเมาส์</span>
              </div>
            )}
            <div className="pointer-events-none absolute inset-x-8 bottom-[22%] border-b border-dashed border-gray-300" />
          </div>
        </div>
      </fieldset>
      <div className="space-y-3 border-t border-gray-100 px-5 py-4">
        <p className="flex items-center gap-2 text-[12.5px] text-gray-500">
          <ShieldCheck className="h-4 w-4 text-emerald-600" aria-hidden /> แนบหลักฐานลายเซ็นก่อน แล้วจึงเปลี่ยนสถานะใน monday
        </p>
        {error && <Alert tone="error">{error.message}{!error.stale && ' · ข้อมูลยังอยู่ในหน้านี้'}</Alert>}
        {storageError && <Alert tone="warning">เก็บฉบับร่างในเครื่องไม่ได้ กรุณาเปิดหน้านี้ไว้จนกว่าจะบันทึกสำเร็จ</Alert>}
        {pending && !saving && !error?.stale && <Alert tone="warning">ยังไม่ยืนยันว่าบันทึกครบ กดส่งซ้ำด้วยข้อมูลเดิมได้ (ไม่บันทึกซ้ำสองครั้ง)</Alert>}
        <div className="flex flex-col gap-2 sm:flex-row-reverse">
          {!error?.stale && (
            <Button type="submit" variant="primary" className="h-11 w-full sm:w-auto sm:min-w-44" loading={saving} disabled={!pending && (!name.trim() || !signed)}>
              {!saving && <Check className="h-4 w-4" aria-hidden />}
              {saving ? 'กำลังบันทึก…' : pending ? 'ส่งข้อมูลเดิมซ้ำ' : 'บันทึกใน monday'}
            </Button>
          )}
          {(error?.stale || (pending && !saving)) && (
            <Button
              className="h-11 w-full sm:w-auto"
              variant={error?.stale ? 'primary' : 'secondary'}
              onClick={() => {
                clearDraft();
                onReopen();
              }}
            >
              <RefreshCw className="h-4 w-4" aria-hidden /> เปิดข้อมูลล่าสุดแล้วเริ่มใหม่
            </Button>
          )}
        </div>
      </div>
    </form>
  );
}
