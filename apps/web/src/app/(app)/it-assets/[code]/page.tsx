'use client';

import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import {
  ArrowLeft,
  ArrowRightLeft,
  CircleDot,
  ClipboardList,
  Cpu,
  FileText,
  History,
  ImageIcon,
  PackageCheck,
  Paperclip,
  Pencil,
  Plus,
  QrCode,
  RotateCcw,
  Settings2,
  Trash2,
  Undo2,
  UserRound,
  Wrench,
} from 'lucide-react';
import Link from 'next/link';
import { use, useState } from 'react';
import { Alert, Badge, Button, Card, Empty, Loading } from '@/components/ui';
import { AssetSoftware } from '../_components/asset-software';
import { api, errorMessage } from '@/lib/api';
import {
  type AssetDetail,
  type AssetEvent,
  type AssetEventType,
  type AssetOptions,
  ATTACHMENT_LABEL,
  type AttachmentRow,
  EVENT_LABEL,
  fileSize,
  KIND_LABEL,
  money,
  REQUEST_STATUS_META,
  REQUEST_TYPE_LABEL,
  requestNo,
  STATE_META,
} from '@/lib/assets';
import { thaiDate } from '@/lib/format';
import { can, useSession } from '@/lib/session';
import { AssignDialog, CompleteRepairDialog, EditInfoDialog, EventDialog, ReturnDialog, StatusDialog, UploadDialog, VoidDialog } from '../_components/dialogs';

type Open =
  | { kind: 'assign' | 'return' | 'status' | 'upload' | 'edit' }
  | { kind: 'event'; type?: AssetEventType }
  | { kind: 'complete'; event: AssetEvent }
  | { kind: 'voidEvent'; event: AssetEvent }
  | { kind: 'voidFile'; file: AttachmentRow }
  | null;

const EVENT_ICON: Record<AssetEventType, typeof Wrench> = {
  REGISTERED: PackageCheck,
  ASSIGNED: ArrowRightLeft,
  RETURNED: Undo2,
  STATUS_CHANGED: CircleDot,
  ISSUE: ClipboardList,
  REPAIR: Wrench,
  UPGRADE: Cpu,
  SOFTWARE: Settings2,
  INSPECTION: ClipboardList,
  SPEC_CORRECTED: Pencil,
  NOTE: FileText,
  DISPOSED: Trash2,
};
const EVENT_COLOR: Partial<Record<AssetEventType, string>> = {
  REPAIR: 'bg-amber-100 text-amber-700',
  UPGRADE: 'bg-violet-100 text-violet-700',
  ASSIGNED: 'bg-sky-100 text-sky-700',
  RETURNED: 'bg-sky-100 text-sky-700',
  ISSUE: 'bg-rose-100 text-rose-700',
  DISPOSED: 'bg-gray-200 text-gray-700',
  REGISTERED: 'bg-brand-100 text-brand-700',
};

export default function AssetPage({ params }: { params: Promise<{ code: string }> }) {
  const { code: raw } = use(params);
  const code = decodeURIComponent(raw);
  const me = useSession();
  const writer = can(me, 'asset.write');
  const qc = useQueryClient();
  const [open, setOpen] = useState<Open>(null);
  const [voidError, setVoidError] = useState<string | null>(null);

  const q = useQuery({ queryKey: ['asset', code], queryFn: () => api<AssetDetail>(`/assets/${encodeURIComponent(code)}`) });
  const options = useQuery({ queryKey: ['asset-options'], queryFn: () => api<AssetOptions>('/assets/options'), enabled: writer });

  const done = () => {
    setOpen(null);
    setVoidError(null);
    void qc.invalidateQueries({ queryKey: ['asset', code] });
    void qc.invalidateQueries({ queryKey: ['assets'] });
  };
  const voidEvent = useMutation({
    mutationFn: ({ id, reason }: { id: string; reason: string }) => api(`/assets/${encodeURIComponent(code)}/events/${id}/void`, { method: 'POST', body: { reason, expectedVersion: q.data!.version } }),
    onSuccess: done,
    onError: (e) => setVoidError(errorMessage(e)),
  });
  const voidFile = useMutation({
    mutationFn: ({ id, reason }: { id: string; reason: string }) => api(`/assets/${encodeURIComponent(code)}/attachments/${id}/void`, { method: 'POST', body: { reason } }),
    onSuccess: done,
    onError: (e) => setVoidError(errorMessage(e)),
  });

  if (q.isLoading) return <Loading rows={8} />;
  if (q.error || !q.data) {
    return (
      <div className="mx-auto max-w-xl">
        <Alert tone="error">{errorMessage(q.error)}</Alert>
        <Link href="/it-assets" className="mt-3 inline-block text-[13px] text-brand-700 hover:underline">กลับไปรายการอุปกรณ์</Link>
      </div>
    );
  }
  const a = q.data;
  const disposed = a.status === 'DISPOSED';
  const filesByEvent = new Map<string, AttachmentRow[]>();
  for (const f of a.attachments) if (f.assetEventId) filesByEvent.set(f.assetEventId, [...(filesByEvent.get(f.assetEventId) ?? []), f]);
  const looseFiles = a.attachments.filter((f) => !f.assetEventId);
  const specFields = [...a.category.specFields, ...Object.keys(a.specs).filter((k) => !a.category.specFields.some((f) => f.key === k)).map((k) => ({ key: k, label: k }))];
  const totalCost = a.events.filter((e) => !e.voidedAt && e.type !== 'REGISTERED' && e.cost).reduce((s, e) => s + Number(e.cost), 0);

  return (
    <div>
      <Link href="/it-assets" className="mb-3 inline-flex items-center gap-1 text-[13px] text-gray-500 hover:text-gray-800">
        <ArrowLeft className="h-4 w-4" /> IT Asset
      </Link>

      <header className="mb-6 flex flex-wrap items-start justify-between gap-4">
        <div>
          <div className="flex flex-wrap items-center gap-2">
            <h1 className="font-mono text-2xl font-semibold tracking-tight text-gray-900">{a.code}</h1>
            <Badge tone={STATE_META[a.state].tone}>{STATE_META[a.state].label}</Badge>
          </div>
          <p className="mt-1 text-sm text-gray-500">
            {a.category.name} · {[a.brand, a.model].filter(Boolean).join(' ') || 'ไม่ระบุรุ่น'}
            {a.ageYears !== null && <> · อายุ {a.ageYears} ปี</>}
          </p>
        </div>
        <div className="flex flex-wrap gap-2">
          <Link href={`/it-assets/${encodeURIComponent(a.code)}/label`} className="inline-flex h-9 items-center gap-2 rounded-lg bg-white px-3 text-sm font-medium text-gray-800 shadow-card ring-1 ring-gray-200 hover:bg-gray-50">
            <QrCode className="h-4 w-4" /> ป้าย QR
          </Link>
          {writer && !disposed && (
            <>
              {a.status === 'ACTIVE' && (
                <Button onClick={() => setOpen({ kind: 'assign' })}>
                  <ArrowRightLeft className="h-4 w-4" /> {a.holder ? 'ย้ายผู้ใช้' : 'มอบเครื่อง'}
                </Button>
              )}
              {a.holder && (
                <Button onClick={() => setOpen({ kind: 'return' })}>
                  <Undo2 className="h-4 w-4" /> รับคืน
                </Button>
              )}
              <Button variant="primary" onClick={() => setOpen({ kind: 'event' })}>
                <Plus className="h-4 w-4" /> บันทึกประวัติ
              </Button>
            </>
          )}
        </div>
      </header>

      <div className="grid gap-4 lg:grid-cols-[minmax(0,1fr)_22rem]">
        {/* Timeline */}
        <Card
          title={<span className="flex items-center gap-2"><History className="h-4 w-4 text-brand-600" /> ประวัติเครื่อง</span>}
          description={totalCost > 0 ? `ค่าซ่อม/อัปเกรดรวม ${money(totalCost)} บาท` : undefined}
          actions={
            writer && !disposed && (
              <>
                <Button size="sm" variant="ghost" onClick={() => setOpen({ kind: 'event', type: 'REPAIR' })}><Wrench className="h-3.5 w-3.5" /> ซ่อม</Button>
                <Button size="sm" variant="ghost" onClick={() => setOpen({ kind: 'event', type: 'UPGRADE' })}><Cpu className="h-3.5 w-3.5" /> อัปเกรด</Button>
              </>
            )
          }
        >
          {!a.events.length ? (
            <Empty title="ยังไม่มีประวัติ" />
          ) : (
            <ol className="relative space-y-5 before:absolute before:top-2 before:bottom-2 before:left-[15px] before:w-px before:bg-gray-200">
              {a.events.map((e) => {
                const Icon = EVENT_ICON[e.type];
                const voided = !!e.voidedAt;
                const files = filesByEvent.get(e.id) ?? [];
                const manual = !['REGISTERED', 'ASSIGNED', 'RETURNED', 'STATUS_CHANGED', 'DISPOSED'].includes(e.type);
                return (
                  <li key={e.id} className="relative flex gap-3">
                    <span className={`relative z-10 flex h-8 w-8 shrink-0 items-center justify-center rounded-full ring-4 ring-white ${voided ? 'bg-gray-100 text-gray-400' : (EVENT_COLOR[e.type] ?? 'bg-gray-100 text-gray-600')}`}>
                      <Icon className="h-4 w-4" aria-hidden />
                    </span>
                    <div className="min-w-0 flex-1 pt-0.5">
                      <div className="flex flex-wrap items-baseline justify-between gap-x-3">
                        <p className={`text-[13px] font-medium ${voided ? 'text-gray-400 line-through' : 'text-gray-900'}`}>
                          <span className="mr-1.5 text-[11px] font-normal text-gray-500">{EVENT_LABEL[e.type]}</span>
                          {e.title}
                          {e.requestNumber && <span className="ml-1.5 font-mono text-[11px] font-normal text-gray-400">{requestNo(e.requestNumber)}</span>}
                        </p>
                        <p className="text-[12px] text-gray-500 tabular-nums">
                          {thaiDate(e.occurredOn)}
                          {e.completedOn && e.completedOn !== e.occurredOn && <> – {thaiDate(e.completedOn)}</>}
                        </p>
                      </div>
                      <div className={voided ? 'opacity-60' : ''}>
                        {e.detail && <p className="mt-1 text-[13px] whitespace-pre-line text-gray-600">{e.detail}</p>}
                        {e.specDiff && (
                          <table className="mt-2 text-[12px]">
                            <tbody>
                              {Object.entries(e.specDiff).map(([k, [from, to]]) => (
                                <tr key={k}>
                                  <td className="pr-3 text-gray-500">{specFields.find((f) => f.key === k)?.label ?? k}</td>
                                  <td className="pr-2 text-gray-400 line-through">{from ?? '–'}</td>
                                  <td className="pr-2 text-gray-400">→</td>
                                  <td className="font-medium text-gray-900">{to ?? '(ลบ)'}</td>
                                </tr>
                              ))}
                            </tbody>
                          </table>
                        )}
                        <div className="mt-1.5 flex flex-wrap items-center gap-1.5 text-[11px] text-gray-500">
                          {e.openRepair && <Badge tone="amber">อยู่ระหว่างซ่อม</Badge>}
                          {e.underWarranty && <Badge tone="sky">เคลมประกัน</Badge>}
                          {e.cost && Number(e.cost) > 0 && <Badge>{money(e.cost)} บาท</Badge>}
                          {e.vendor && <span>ร้าน {e.vendor}</span>}
                          {e.employee && e.type !== 'ASSIGNED' && <span className="inline-flex items-center gap-0.5"><UserRound className="h-3 w-3" /> {e.employee}</span>}
                          <span>· บันทึกโดย {e.recordedBy}</span>
                        </div>
                        {!!files.length && (
                          <ul className="mt-2 flex flex-wrap gap-2">
                            {files.map((f) => <FileChip key={f.id} code={a.code} file={f} onVoid={writer ? () => setOpen({ kind: 'voidFile', file: f }) : undefined} />)}
                          </ul>
                        )}
                      </div>
                      {voided && <p className="mt-1 text-[12px] text-rose-600">ยกเลิก: {e.voidReason}</p>}
                      {writer && !voided && !disposed && (e.openRepair || manual) && (
                        <div className="mt-1.5 flex gap-1">
                          {e.openRepair && (
                            <Button size="sm" onClick={() => setOpen({ kind: 'complete', event: e })}><RotateCcw className="h-3.5 w-3.5" /> รับเครื่องคืน</Button>
                          )}
                          {manual && (
                            <Button size="sm" variant="ghost" className="text-gray-400 hover:text-rose-600" onClick={() => { setVoidError(null); setOpen({ kind: 'voidEvent', event: e }); }}>
                              ยกเลิกรายการ
                            </Button>
                          )}
                        </div>
                      )}
                    </div>
                  </li>
                );
              })}
            </ol>
          )}
        </Card>

        <div className="space-y-4">
          {!!a.requests.length && (
            <Card title="คำขอจากผู้ใช้" bodyClassName="px-5 py-3" actions={<Link href="/it-assets?tab=requests" className="text-[12px] font-medium text-brand-600 hover:underline">ทั้งหมด</Link>}>
              <ul className="space-y-2 text-[13px]">
                {a.requests.map((r) => (
                  <li key={r.id} className="flex items-start justify-between gap-2">
                    <div className="min-w-0">
                      <p className="truncate text-gray-900">{r.title}</p>
                      <p className="text-[11px] text-gray-500"><span className="font-mono">{requestNo(r.number)}</span> · {REQUEST_TYPE_LABEL[r.type]} · {r.requester}</p>
                    </div>
                    <Badge tone={REQUEST_STATUS_META[r.status].tone}>{REQUEST_STATUS_META[r.status].label}</Badge>
                  </li>
                ))}
              </ul>
            </Card>
          )}

          <Card title="ผู้ถือปัจจุบัน">
            {a.holder ? (
              <div>
                <p className="text-[15px] font-medium text-gray-900">{a.holder.name}</p>
                <p className="mt-0.5 text-[12px] text-gray-500">
                  {KIND_LABEL[a.holder.kind]} · ตั้งแต่ {a.holder.startDate && thaiDate(a.holder.startDate)}
                </p>
                {a.holder.dueDate && <p className="mt-1 text-[12px] text-amber-700">กำหนดคืน {thaiDate(a.holder.dueDate)}</p>}
              </div>
            ) : (
              <p className="text-[13px] text-gray-500">{a.state === 'AVAILABLE' ? 'ว่าง — พร้อมมอบให้' : 'ไม่มีผู้ถือ'}</p>
            )}
          </Card>

          <Card title="สเปก" bodyClassName="px-5 py-3">
            {specFields.length ? (
              <dl className="divide-y divide-gray-100 text-[13px]">
                {specFields.map((f) => (
                  <div key={f.key} className="flex justify-between gap-3 py-1.5">
                    <dt className="text-gray-500">{f.label}</dt>
                    <dd className="text-right text-gray-900">{a.specs[f.key] ?? '–'}</dd>
                  </div>
                ))}
              </dl>
            ) : (
              <p className="text-[13px] text-gray-500">–</p>
            )}
          </Card>

          {can(me, 'asset.read') && <AssetSoftware code={a.code} />}

          <Card
            title="ข้อมูลเครื่อง"
            bodyClassName="px-5 py-3"
            actions={writer && !disposed && (
              <>
                <Button size="sm" variant="ghost" onClick={() => setOpen({ kind: 'edit' })} aria-label="แก้ไขข้อมูล"><Pencil className="h-3.5 w-3.5" /></Button>
                <Button size="sm" variant="ghost" onClick={() => setOpen({ kind: 'status' })}>สถานะ</Button>
              </>
            )}
          >
            <dl className="divide-y divide-gray-100 text-[13px]">
              {[
                ['Serial', a.serialNo],
                ['ชื่อเครื่อง', a.hostname],
                ['รหัส FA', a.faCode],
                ['เริ่มใช้งาน', a.purchaseDate && thaiDate(a.purchaseDate)],
                ['ราคาทุน', a.cost && `${money(a.cost)} บาท`],
                ['ครบอายุใช้งาน', a.usefulLifeEnds && `${thaiDate(a.usefulLifeEnds)} (${a.usefulLifeYears} ปี)`],
                ['ประกันถึง', a.warrantyUntil && thaiDate(a.warrantyUntil)],
                ['ผู้จัดจำหน่าย', a.vendor?.name],
              ].map(([k, v]) => (
                <div key={k} className="flex justify-between gap-3 py-1.5">
                  <dt className="text-gray-500">{k}</dt>
                  <dd className="text-right text-gray-900">{v || '–'}</dd>
                </div>
              ))}
            </dl>
            {a.notes && <p className="mt-2 rounded-md bg-gray-50 p-2 text-[12px] whitespace-pre-line text-gray-600">{a.notes}</p>}
          </Card>

          <Card title="ประวัติผู้ถือครอง" bodyClassName="px-5 py-3">
            {!a.assignments.length ? (
              <p className="text-[13px] text-gray-500">ยังไม่เคยมอบให้ใคร</p>
            ) : (
              <ul className="space-y-2 text-[13px]">
                {a.assignments.map((s) => (
                  <li key={s.id}>
                    <p className="text-gray-900">{s.holder} <span className="text-[11px] text-gray-400">· {KIND_LABEL[s.kind]}</span></p>
                    <p className="text-[12px] text-gray-500">
                      {s.approximate && '≈ '}
                      {thaiDate(s.startDate)} – {s.endDate ? thaiDate(s.endDate) : 'ปัจจุบัน'}
                    </p>
                  </li>
                ))}
              </ul>
            )}
          </Card>

          <Card title="ไฟล์ของเครื่อง" bodyClassName="px-5 py-3" actions={writer && !disposed && <Button size="sm" variant="ghost" onClick={() => setOpen({ kind: 'upload' })}><Paperclip className="h-3.5 w-3.5" /> แนบ</Button>}>
            {!looseFiles.length ? (
              <p className="text-[13px] text-gray-500">ใบรับประกัน ใบส่งของ ฯลฯ — ไฟล์ของการซ่อมอยู่ในประวัติ</p>
            ) : (
              <ul className="flex flex-wrap gap-2">
                {looseFiles.map((f) => <FileChip key={f.id} code={a.code} file={f} onVoid={writer ? () => setOpen({ kind: 'voidFile', file: f }) : undefined} />)}
              </ul>
            )}
          </Card>
        </div>
      </div>

      {open?.kind === 'assign' && options.data && <AssignDialog asset={a} options={options.data} onClose={() => setOpen(null)} onDone={done} />}
      {open?.kind === 'return' && <ReturnDialog asset={a} onClose={() => setOpen(null)} onDone={done} />}
      {open?.kind === 'event' && options.data && <EventDialog asset={a} options={options.data} initialType={open.type} onClose={() => setOpen(null)} onDone={done} />}
      {open?.kind === 'complete' && <CompleteRepairDialog asset={a} event={open.event} onClose={() => setOpen(null)} onDone={done} />}
      {open?.kind === 'status' && <StatusDialog asset={a} onClose={() => setOpen(null)} onDone={done} />}
      {open?.kind === 'upload' && <UploadDialog asset={a} onClose={() => setOpen(null)} onDone={done} />}
      {open?.kind === 'edit' && options.data && <EditInfoDialog asset={a} options={options.data} onClose={() => setOpen(null)} onDone={done} />}
      {open?.kind === 'voidEvent' && (
        <VoidDialog title={`ยกเลิกรายการ: ${open.event.title}`} onClose={() => setOpen(null)} pending={voidEvent.isPending} error={voidError} onConfirm={(reason) => voidEvent.mutate({ id: open.event.id, reason })} />
      )}
      {open?.kind === 'voidFile' && (
        <VoidDialog title={`ยกเลิกไฟล์: ${open.file.fileName}`} onClose={() => setOpen(null)} pending={voidFile.isPending} error={voidError} onConfirm={(reason) => voidFile.mutate({ id: open.file.id, reason })} />
      )}
    </div>
  );
}

function FileChip({ code, file, onVoid }: { code: string; file: AttachmentRow; onVoid?: () => void }) {
  const href = `/api/assets/${encodeURIComponent(code)}/attachments/${file.id}/file`;
  const image = file.mimeType.startsWith('image/') && file.mimeType !== 'image/heic';
  const voided = !!file.voidedAt;
  return (
    <li className={`group flex max-w-full items-center gap-2 rounded-lg bg-white p-1.5 pr-2 ring-1 ring-gray-200 ${voided ? 'opacity-50' : ''}`}>
      <a href={href} target="_blank" rel="noopener noreferrer" className="flex min-w-0 items-center gap-2" title={file.fileName}>
        {image ? (
          // eslint-disable-next-line @next/next/no-img-element -- authenticated file from our own API
          <img src={href} alt="" className="h-9 w-9 shrink-0 rounded object-cover" loading="lazy" />
        ) : (
          <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded bg-gray-100 text-gray-500">
            {file.mimeType === 'application/pdf' ? <FileText className="h-4 w-4" /> : <ImageIcon className="h-4 w-4" />}
          </span>
        )}
        <span className="min-w-0">
          <span className={`block max-w-44 truncate text-[12px] font-medium ${voided ? 'line-through' : 'text-gray-800'}`}>{file.fileName}</span>
          <span className="block text-[11px] text-gray-500">{ATTACHMENT_LABEL[file.kind]} · {fileSize(file.sizeBytes)}</span>
        </span>
      </a>
      {voided ? (
        <span className="text-[11px] text-rose-600" title={file.voidReason ?? ''}>ยกเลิก</span>
      ) : (
        onVoid && (
          <button type="button" onClick={onVoid} aria-label={`ยกเลิกไฟล์ ${file.fileName}`} className="text-gray-300 opacity-0 group-hover:opacity-100 hover:text-rose-600 focus:opacity-100">
            <Trash2 className="h-3.5 w-3.5" />
          </button>
        )
      )}
    </li>
  );
}
