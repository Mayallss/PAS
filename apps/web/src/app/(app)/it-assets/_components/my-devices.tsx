'use client';

import { CalendarClock, Laptop, ShieldCheck, Wrench } from 'lucide-react';
import { Badge, Button, Empty } from '@/components/ui';
import { EVENT_LABEL, KIND_LABEL, type MyDevice, STATE_META } from '@/lib/assets';
import { thaiDate } from '@/lib/format';

/** The employee's own device(s): state, specs and the life history of the machine they use. */
export function MyDevicesPanel({ devices, onReport }: { devices: MyDevice[]; onReport: (code: string) => void }) {
  if (!devices.length) {
    return (
      <div className="rounded-2xl bg-white shadow-card ring-1 ring-gray-200/80">
        <Empty icon={<Laptop className="h-5 w-5" />} title="ยังไม่มีเครื่องในชื่อคุณ">
          ถ้าคุณใช้เครื่องของบริษัทอยู่แต่ไม่แสดงที่นี่ แจ้ง IT ให้ลงทะเบียนได้จากปุ่ม “แจ้งซ่อม / ขอบริการ”
        </Empty>
      </div>
    );
  }
  return (
    <div className="space-y-4">
      {devices.map((d) => {
        const state = STATE_META[d.state];
        const specs = [...d.specFields, ...Object.keys(d.specs).filter((k) => !d.specFields.some((f) => f.key === k)).map((k) => ({ key: k, label: k }))].filter((f) => d.specs[f.key]);
        const repairs = d.history.filter((h) => h.type === 'REPAIR').length;
        return (
          <section key={d.code} className="rounded-2xl bg-white shadow-card ring-1 ring-gray-200/80">
            <header className="flex flex-wrap items-start justify-between gap-3 border-b border-gray-100 px-5 py-4">
              <div className="flex items-start gap-3">
                <span className="flex h-11 w-11 items-center justify-center rounded-xl bg-brand-50 text-brand-700"><Laptop className="h-5 w-5" /></span>
                <div>
                  <p className="flex flex-wrap items-center gap-2">
                    <span className="font-mono text-lg font-semibold text-gray-900">{d.code}</span>
                    <Badge tone={state.tone}>{state.label}</Badge>
                    {d.kind !== 'PRIMARY' && <Badge tone="amber">{KIND_LABEL[d.kind]}</Badge>}
                  </p>
                  <p className="text-[13px] text-gray-600">{[d.brand, d.model].filter(Boolean).join(' ') || d.category}</p>
                  <p className="mt-0.5 text-[12px] text-gray-500">
                    ถือตั้งแต่ {thaiDate(d.startDate)}
                    {d.dueDate && <span className={d.overdue ? 'font-medium text-rose-600' : ''}> · กำหนดคืน {thaiDate(d.dueDate)}</span>}
                  </p>
                </div>
              </div>
              <Button variant="primary" size="sm" onClick={() => onReport(d.code)}>
                <Wrench className="h-3.5 w-3.5" /> แจ้งปัญหาเครื่องนี้
              </Button>
            </header>
            <div className="grid gap-5 px-5 py-4 md:grid-cols-[16rem_minmax(0,1fr)]">
              <div>
                <h3 className="mb-2 text-[12px] font-semibold text-gray-500">สเปก</h3>
                <dl className="space-y-1 text-[13px]">
                  {specs.map((f) => (
                    <div key={f.key} className="flex justify-between gap-3">
                      <dt className="text-gray-500">{f.label}</dt>
                      <dd className="text-right text-gray-900">{d.specs[f.key]}</dd>
                    </div>
                  ))}
                  {d.serialNo && (
                    <div className="flex justify-between gap-3"><dt className="text-gray-500">Serial</dt><dd className="font-mono text-[12px] text-gray-900">{d.serialNo}</dd></div>
                  )}
                </dl>
                <div className="mt-3 space-y-1 text-[12px] text-gray-500">
                  {d.purchaseDate && <p className="flex items-center gap-1.5"><CalendarClock className="h-3.5 w-3.5" /> เริ่มใช้ {thaiDate(d.purchaseDate)}</p>}
                  {d.warrantyUntil && <p className="flex items-center gap-1.5"><ShieldCheck className="h-3.5 w-3.5" /> ประกันถึง {thaiDate(d.warrantyUntil)}</p>}
                  <p className="flex items-center gap-1.5"><Wrench className="h-3.5 w-3.5" /> ซ่อมมาแล้ว {repairs} ครั้ง</p>
                </div>
              </div>
              <div>
                <h3 className="mb-2 text-[12px] font-semibold text-gray-500">ประวัติเครื่อง</h3>
                <ol className="space-y-2.5 border-l-2 border-gray-100 pl-3">
                  {d.history.map((h) => (
                    <li key={h.id} className="text-[13px]">
                      <p className="text-[11px] text-gray-400">
                        {thaiDate(h.occurredOn)}{h.completedOn && h.completedOn !== h.occurredOn && ` – ${thaiDate(h.completedOn)}`} · {EVENT_LABEL[h.type]}
                        {h.type === 'REPAIR' && !h.completedOn && <span className="ml-1 font-medium text-amber-600">(ยังอยู่ระหว่างซ่อม)</span>}
                        {h.underWarranty && <span className="ml-1 text-sky-600">· เคลมประกัน</span>}
                      </p>
                      <p className="text-gray-900">{h.title}</p>
                      {h.specDiff && (
                        <p className="text-[12px] text-gray-600">
                          {Object.entries(h.specDiff).map(([k, [from, to]]) => `${specs.find((f) => f.key === k)?.label ?? k}: ${from ?? '–'} → ${to ?? '–'}`).join(' · ')}
                        </p>
                      )}
                      {h.detail && <p className="text-[12px] whitespace-pre-line text-gray-500">{h.detail}</p>}
                    </li>
                  ))}
                </ol>
              </div>
            </div>
          </section>
        );
      })}
    </div>
  );
}
