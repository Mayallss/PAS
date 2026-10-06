'use client';

import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Archive, KeyRound, Pencil, Plus, RefreshCw, RotateCw, ShieldAlert, Unplug } from 'lucide-react';
import Link from 'next/link';
import { useMemo, useState } from 'react';
import { toast } from 'sonner';
import { Alert, Badge, Button, Card, Dialog, Loading, Progress } from '@/components/ui';
import { api, errorMessage } from '@/lib/api';
import { thaiDateShort } from '@/lib/format';
import { type LicenseDetail, type LicenseList, type LicenseRow, METRIC_LABEL, type SoftwareRow, STATE_META, stateText, TYPE_LABEL } from '@/lib/licenses';
import { AddSeats, LicenseForm, RenewForm, SoftwareForm } from './license-forms';

/** Licences span years: "9 ก.ค. 70". */
const d = (iso: string) => `${thaiDateShort(iso)} ${String((Number(iso.slice(0, 4)) + 543) % 100).padStart(2, '0')}`;

const baht = (n: number) => new Intl.NumberFormat('th-TH', { style: 'currency', currency: 'THB', maximumFractionDigits: 2 }).format(n);
const period = (l: { startDate: string | null; endDate: string | null }) =>
  l.startDate || l.endDate ? `${l.startDate ? d(l.startDate) : '…'} – ${l.endDate ? d(l.endDate) : 'ไม่มีวันหมดอายุ'}` : '–';

type Filter = 'current' | 'expiring' | 'expired' | 'all';

/** IT/Admin tab: software catalogue, licences, seats per machine. */
export function Licenses({ canWrite }: { canWrite: boolean }) {
  const qc = useQueryClient();
  const [filter, setFilter] = useState<Filter>('current');
  const [showUncovered, setShowUncovered] = useState(false);
  const [openId, setOpenId] = useState<string | null>(null);
  const [form, setForm] = useState<{ kind: 'license'; license?: LicenseRow } | { kind: 'software'; software?: SoftwareRow; thenLicense?: boolean } | null>(null);

  const list = useQuery({ queryKey: ['licenses', filter === 'all'], queryFn: () => api<LicenseList>('/licenses', { query: { archived: filter === 'all' ? 'true' : undefined } }) });
  const software = useQuery({ queryKey: ['software'], queryFn: () => api<SoftwareRow[]>('/software') });
  const refresh = () => {
    void qc.invalidateQueries({ queryKey: ['licenses'] });
    void qc.invalidateQueries({ queryKey: ['license'] });
    void qc.invalidateQueries({ queryKey: ['software'] });
    void qc.invalidateQueries({ queryKey: ['asset-licenses'] });
  };

  const rows = useMemo(() => {
    const all = list.data?.licenses ?? [];
    const pick = all.filter((l) => {
      if (filter === 'all') return true;
      if (filter === 'expiring') return l.state === 'EXPIRING';
      // Expired and not renewed yet = needs attention; expired & renewed = history.
      if (filter === 'expired') return l.state === 'EXPIRED' && !l.renewedBy;
      return l.state !== 'EXPIRED' || !l.renewedBy;
    });
    const groups = new Map<string, LicenseRow[]>();
    for (const l of pick) groups.set(l.software.name, [...(groups.get(l.software.name) ?? []), l]);
    return [...groups.entries()];
  }, [list.data, filter]);

  const o = list.data?.overview;
  const tile = (key: Filter | 'uncovered', label: string, value: number | undefined, tone: string, hint: string) => {
    const active = key === 'uncovered' ? showUncovered : filter === key && !showUncovered;
    return (
      <button
        type="button"
        onClick={() => (key === 'uncovered' ? setShowUncovered((v) => !v) : (setShowUncovered(false), setFilter(key)))}
        className={`rounded-xl bg-white p-3.5 text-left shadow-card ring-1 transition ${active ? 'ring-2 ring-brand-500' : 'ring-gray-200/80 hover:ring-gray-300'}`}
        title={hint}
      >
        <p className="text-[12px] font-medium text-gray-500">{label}</p>
        <p className={`mt-1 text-2xl font-semibold tabular-nums ${tone}`}>{value ?? '–'}</p>
      </button>
    );
  };

  return (
    <div>
      <div className="mb-4 grid grid-cols-2 gap-3 lg:grid-cols-4">
        {tile('current', 'ไลเซนส์ที่ใช้อยู่', list.data?.licenses.filter((l) => l.state !== 'EXPIRED').length, 'text-gray-900', 'ไม่รวมปีที่หมดอายุและต่ออายุแล้ว')}
        {tile('expiring', `ใกล้หมดอายุ (${list.data?.expiringDays ?? 30} วัน)`, o?.expiring, o?.expiring ? 'text-amber-600' : 'text-gray-900', 'ควรต่ออายุหรือเตรียมงบ')}
        {tile('expired', 'หมดอายุ ยังไม่ต่อ', o?.expired, o?.expired ? 'text-rose-600' : 'text-gray-900', 'หมดอายุแล้วและยังไม่มีไลเซนส์ปีใหม่')}
        {tile('uncovered', 'เครื่องที่ยังไม่มีแอนตี้ไวรัส', o?.withoutAntivirus.length, o?.withoutAntivirus.length ? 'text-rose-600' : 'text-gray-900', 'Notebook/PC/Server ที่ใช้งานอยู่แต่ไม่มีสิทธิ์ซอฟต์แวร์หมวด “แอนตี้ไวรัส” ที่ยังไม่หมดอายุ')}
      </div>

      {showUncovered && o && (
        <Card className="mb-4" title={<span className="flex items-center gap-2"><ShieldAlert className="h-4 w-4 text-rose-600" /> เครื่องที่ใช้งานอยู่แต่ยังไม่มีแอนตี้ไวรัส</span>}>
          {o.withoutAntivirus.length === 0 ? (
            <p className="text-[13px] text-gray-500">ทุกเครื่องมีแอนตี้ไวรัสแล้ว</p>
          ) : (
            <div className="flex flex-wrap gap-1.5">
              {o.withoutAntivirus.map((a) => (
                <Link key={a.code} href={`/it-assets/${encodeURIComponent(a.code)}`} className="rounded-md bg-rose-50 px-2 py-1 font-mono text-[12px] text-rose-700 ring-1 ring-rose-200 hover:bg-rose-100">
                  {a.code}
                </Link>
              ))}
            </div>
          )}
        </Card>
      )}

      <Card
        title={<span className="flex items-center gap-2"><KeyRound className="h-4 w-4 text-brand-600" /> ซอฟต์แวร์และไลเซนส์</span>}
        description="แต่ละเครื่องใช้โปรแกรมอะไร ภายใต้ไลเซนส์ไหน — ต่ออายุแล้วประวัติปีเดิมยังอยู่"
        actions={
          <>
            <select aria-label="ตัวกรอง" className="h-8 rounded-lg bg-white px-2 text-[13px] ring-1 ring-gray-200" value={filter} onChange={(e) => (setShowUncovered(false), setFilter(e.target.value as Filter))}>
              <option value="current">ที่ใช้อยู่</option>
              <option value="expiring">ใกล้หมดอายุ</option>
              <option value="expired">หมดอายุ ยังไม่ต่อ</option>
              <option value="all">ทั้งหมด (รวมประวัติ/เก็บแล้ว)</option>
            </select>
            {canWrite && (
              <>
                <Button size="sm" variant="secondary" onClick={() => setForm({ kind: 'software' })}>
                  <Plus className="h-3.5 w-3.5" /> ซอฟต์แวร์
                </Button>
                <Button size="sm" variant="primary" onClick={() => setForm({ kind: 'license' })}>
                  <Plus className="h-3.5 w-3.5" /> ไลเซนส์
                </Button>
              </>
            )}
          </>
        }
        bodyClassName="p-0"
      >
        {list.isLoading ? (
          <div className="p-5"><Loading rows={4} /></div>
        ) : list.error ? (
          <div className="p-5"><Alert tone="error">{errorMessage(list.error)}</Alert></div>
        ) : rows.length === 0 ? (
          <p className="px-5 py-8 text-center text-[13px] text-gray-500">ไม่มีไลเซนส์ในมุมมองนี้</p>
        ) : (
          <div className="overflow-x-auto">
            <table className="min-w-full text-[13px]">
              <thead className="border-b border-gray-200 text-left text-[12px] text-gray-500">
                <tr>
                  <th className="px-5 py-2 font-medium">ไลเซนส์</th>
                  <th className="px-3 py-2 font-medium">ประเภท</th>
                  <th className="px-3 py-2 font-medium">ใช้ / สิทธิ์</th>
                  <th className="px-3 py-2 font-medium">ช่วงเวลา</th>
                  <th className="px-3 py-2 font-medium">สถานะ</th>
                </tr>
              </thead>
              {rows.map(([name, ls]) => (
                <tbody key={name}>
                  <tr className="bg-gray-50/80">
                    <td colSpan={5} className="px-5 py-1.5 text-[12px] font-semibold text-gray-600">
                      {name}
                      {ls[0].software.category && <span className="ml-2 font-normal text-gray-400">{ls[0].software.category}</span>}
                    </td>
                  </tr>
                  {ls.map((l) => (
                    <tr key={l.id} className="cursor-pointer border-b border-gray-100 hover:bg-brand-50/40" onClick={() => setOpenId(l.id)}>
                      <td className="px-5 py-2.5">
                        <p className="font-medium text-gray-900">{l.name}</p>
                        <p className="text-[12px] text-gray-500">{[l.edition, l.reference, l.vendor?.name].filter(Boolean).join(' · ') || '–'}</p>
                      </td>
                      <td className="px-3 py-2.5 text-gray-600">
                        {TYPE_LABEL[l.type]}
                        <span className="block text-[12px] text-gray-400">{METRIC_LABEL[l.metric]}</span>
                      </td>
                      <td className="w-44 px-3 py-2.5">
                        <p className="tabular-nums text-gray-800">
                          {l.used} / {l.seats ?? '∞'}
                        </p>
                        {l.seats !== null && (
                          <Progress value={l.used} max={l.seats} className="mt-1 h-1.5" barClassName={l.used >= l.seats ? 'bg-amber-500' : 'bg-brand-500'} />
                        )}
                      </td>
                      <td className="px-3 py-2.5 text-gray-600">{period(l)}</td>
                      <td className="px-3 py-2.5">
                        <div className="flex flex-wrap items-center gap-1">
                          <Badge tone={STATE_META[l.state].tone}>{stateText(l)}</Badge>
                          {l.autoRenew && l.state !== 'EXPIRED' && (
                            <span title="ต่ออายุอัตโนมัติ" className="text-sky-600">
                              <RotateCw className="h-3.5 w-3.5" />
                            </span>
                          )}
                          {l.renewedBy && <Badge>ต่ออายุแล้ว</Badge>}
                          {l.archivedAt && <Badge>เก็บแล้ว</Badge>}
                        </div>
                      </td>
                    </tr>
                  ))}
                </tbody>
              ))}
            </table>
          </div>
        )}
      </Card>

      {openId && <LicenseDialog id={openId} canWrite={canWrite} software={software.data ?? []} onClose={() => setOpenId(null)} onOpen={setOpenId} onChanged={refresh} />}

      {form?.kind === 'software' && (
        <SoftwareForm
          software={form.software}
          onClose={() => setForm(null)}
          onSaved={() => {
            toast.success('บันทึกซอฟต์แวร์แล้ว');
            refresh();
            setForm(form.thenLicense ? { kind: 'license' } : null);
          }}
        />
      )}
      {form?.kind === 'license' && (
        <LicenseForm
          license={form.license}
          software={software.data ?? []}
          onClose={() => setForm(null)}
          onNewSoftware={() => setForm({ kind: 'software', thenLicense: true })}
          onSaved={(id) => {
            toast.success('บันทึกไลเซนส์แล้ว');
            refresh();
            setForm(null);
            setOpenId(id);
          }}
        />
      )}
    </div>
  );
}

// ---------------------------------------------------------------------------

function LicenseDialog({ id, canWrite, software, onClose, onOpen, onChanged }: {
  id: string;
  canWrite: boolean;
  software: SoftwareRow[];
  onClose: () => void;
  onOpen: (id: string) => void;
  onChanged: () => void;
}) {
  const q = useQuery({ queryKey: ['license', id], queryFn: () => api<LicenseDetail>(`/licenses/${id}`) });
  const [sub, setSub] = useState<'add' | 'renew' | 'edit' | null>(null);
  const [showHistory, setShowHistory] = useState(false);
  const l = q.data;
  const act = useMutation({
    mutationFn: (v: { path: string; body?: object }) => api(`/licenses/${id}${v.path}`, { method: 'POST', body: v.body ?? {} }),
    onSuccess: () => {
      onChanged();
      void q.refetch();
    },
    onError: (e) => toast.error(errorMessage(e)),
  });

  if (sub === 'add' && l) return <AddSeats license={l} onClose={() => setSub(null)} onSaved={(n) => (toast.success(`เพิ่ม ${n} เครื่องแล้ว`), onChanged(), void q.refetch(), setSub(null))} />;
  if (sub === 'renew' && l) return <RenewForm license={l} onClose={() => setSub(null)} onSaved={(nid) => (toast.success('สร้างไลเซนส์ปีใหม่แล้ว'), onChanged(), onOpen(nid), setSub(null))} />;
  if (sub === 'edit' && l) return <LicenseForm license={l} software={software} onClose={() => setSub(null)} onNewSoftware={() => undefined} onSaved={() => (toast.success('บันทึกแล้ว'), onChanged(), void q.refetch(), setSub(null))} />;

  const active = l?.seatsList.filter((s) => !s.endDate) ?? [];
  const history = l?.seatsList.filter((s) => s.endDate) ?? [];
  const expired = l?.state === 'EXPIRED';

  return (
    <Dialog open wide onClose={onClose} title={l ? l.name : 'ไลเซนส์'} footer={<Button onClick={onClose}>ปิด</Button>}>
      {!l ? (
        q.error ? <Alert tone="error">{errorMessage(q.error)}</Alert> : <Loading rows={4} />
      ) : (
        <>
          <div className="flex flex-wrap items-center gap-1.5">
            <Badge tone={STATE_META[l.state].tone}>{stateText(l)}</Badge>
            <Badge>{TYPE_LABEL[l.type]}</Badge>
            <Badge>{METRIC_LABEL[l.metric]}</Badge>
            {l.autoRenew && <Badge tone="sky">ต่ออายุอัตโนมัติ</Badge>}
            {l.renewedFrom && (
              <button type="button" onClick={() => onOpen(l.renewedFrom!.id)} className="text-[12px] text-brand-700 underline">
                ต่อจาก {l.renewedFrom.name}
              </button>
            )}
            {l.renewedBy && (
              <button type="button" onClick={() => onOpen(l.renewedBy!.id)} className="text-[12px] text-brand-700 underline">
                ต่ออายุเป็น {l.renewedBy.name}
              </button>
            )}
          </div>
          <dl className="grid grid-cols-2 gap-x-4 gap-y-2 text-[13px] sm:grid-cols-3">
            <div><dt className="text-gray-500">ซอฟต์แวร์</dt><dd className="font-medium">{l.software.name}</dd></div>
            <div><dt className="text-gray-500">ช่วงเวลา</dt><dd>{period(l)}</dd></div>
            <div><dt className="text-gray-500">ใช้ / สิทธิ์</dt><dd className="tabular-nums">{l.used} / {l.seats ?? 'ไม่จำกัด'}</dd></div>
            {l.edition && <div><dt className="text-gray-500">รุ่น</dt><dd>{l.edition}</dd></div>}
            {l.reference && <div><dt className="text-gray-500">อ้างอิง</dt><dd>{l.reference}</dd></div>}
            {l.vendor && <div><dt className="text-gray-500">ผู้จำหน่าย</dt><dd>{l.vendor.name}</dd></div>}
            {l.cost !== null && <div><dt className="text-gray-500">ราคา</dt><dd>{baht(l.cost)}</dd></div>}
            {l.keyHint && <div><dt className="text-gray-500">ท้ายคีย์</dt><dd className="font-mono">{l.keyHint}</dd></div>}
            {Object.entries(l.attributes).map(([k, v]) => (
              <div key={k}><dt className="text-gray-500">{k}</dt><dd className="break-words">{v}</dd></div>
            ))}
          </dl>
          {l.notes && <p className="whitespace-pre-line rounded-lg bg-gray-50 px-3 py-2 text-[12.5px] text-gray-600">{l.notes}</p>}

          {canWrite && !l.archivedAt && (
            <div className="flex flex-wrap gap-2">
              <Button size="sm" variant="primary" disabled={expired} title={expired ? 'หมดอายุแล้ว — ต่ออายุก่อน' : undefined} onClick={() => setSub('add')}>
                <Plus className="h-3.5 w-3.5" /> เพิ่มเครื่อง
              </Button>
              {!l.renewedBy && (
                <Button size="sm" variant="secondary" onClick={() => setSub('renew')}>
                  <RefreshCw className="h-3.5 w-3.5" /> ต่ออายุ
                </Button>
              )}
              <Button size="sm" variant="ghost" onClick={() => setSub('edit')}>
                <Pencil className="h-3.5 w-3.5" /> แก้ไข
              </Button>
              <Button
                size="sm"
                variant="ghost"
                className="text-gray-500"
                onClick={() => window.confirm(`เก็บ “${l.name}” ออกจากรายการ? (เครื่องที่ใช้อยู่ ${active.length} เครื่องจะถูกปลดวันนี้)`) && act.mutate({ path: '/archive' })}
              >
                <Archive className="h-3.5 w-3.5" /> เก็บ
              </Button>
            </div>
          )}

          <div>
            <p className="mb-1.5 text-[13px] font-medium text-gray-700">เครื่องที่ใช้อยู่ ({active.length})</p>
            {active.length === 0 ? (
              <p className="rounded-lg bg-gray-50 px-3 py-3 text-[13px] text-gray-500">ยังไม่มีเครื่อง</p>
            ) : (
              <ul className="max-h-72 divide-y divide-gray-100 overflow-y-auto rounded-lg ring-1 ring-gray-200">
                {active.map((s) => (
                  <li key={s.id} className="flex items-center gap-3 px-3 py-2">
                    <div className="min-w-0 flex-1">
                      <p className="text-[13px]">
                        {s.asset ? (
                          <Link href={`/it-assets/${encodeURIComponent(s.asset.code)}`} className="font-mono font-medium text-brand-700 hover:underline">{s.asset.code}</Link>
                        ) : (
                          <span className="font-medium">{s.employee?.fullName}</span>
                        )}
                        {s.asset && <span className="text-gray-500"> · {s.asset.category}{s.asset.model ? ` · ${s.asset.model}` : ''}</span>}
                        {s.seatLabel && <span className="ml-1 text-[12px] text-gray-400">({s.seatLabel})</span>}
                      </p>
                      <p className="truncate text-[12px] text-gray-500" title={s.note ?? ''}>
                        {s.installedOn ? `ติดตั้ง ${d(s.installedOn)}` : 'ยังไม่ระบุวันติดตั้ง'}
                        {s.note ? ` · ${s.note}` : ''}
                      </p>
                    </div>
                    {canWrite && (
                      <Button
                        size="sm"
                        variant="ghost"
                        className="text-gray-500"
                        onClick={() => {
                          const why = window.prompt(`ปลดสิทธิ์จาก ${s.asset?.code ?? s.employee?.fullName}? ระบุเหตุผล (ไม่บังคับ)`, '');
                          if (why !== null) act.mutate({ path: `/seats/${s.id}/end`, body: { note: why || null } });
                        }}
                      >
                        <Unplug className="h-3.5 w-3.5" /> ปลด
                      </Button>
                    )}
                  </li>
                ))}
              </ul>
            )}
          </div>

          {history.length > 0 && (
            <div>
              <button type="button" className="text-[13px] text-brand-700" onClick={() => setShowHistory((v) => !v)}>
                {showHistory ? 'ซ่อน' : 'ดู'}ประวัติ ({history.length})
              </button>
              {showHistory && (
                <ul className="mt-1.5 divide-y divide-gray-100 rounded-lg ring-1 ring-gray-200">
                  {history.map((s) => (
                    <li key={s.id} className="px-3 py-2 text-[12.5px] text-gray-600">
                      <span className="font-mono text-gray-800">{s.asset?.code ?? s.employee?.fullName}</span> · {d(s.startDate)} – {s.endDate && d(s.endDate)}
                      {s.note && <span className="text-gray-400"> · {s.note}</span>}
                    </li>
                  ))}
                </ul>
              )}
            </div>
          )}
        </>
      )}
    </Dialog>
  );
}
