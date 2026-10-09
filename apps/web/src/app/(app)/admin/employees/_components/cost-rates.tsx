'use client';

import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Coins, History, Pencil } from 'lucide-react';
import { useState } from 'react';
import { Alert, Badge, Button, Card, Dialog, Field, inputClass, Loading } from '@/components/ui';
import { api, errorMessage } from '@/lib/api';
import { thaiDate, todayBangkok } from '@/lib/format';
import { can, useSession } from '@/lib/session';

type Unit = 'HOUR' | 'DAY';
interface Period {
  id: string;
  amount: number;
  unit: Unit;
  minutesPerDay: number;
  effectiveFrom: string;
  effectiveTo: string | null;
}
interface Rates {
  today: string;
  legacy: Record<string, number>;
  levels: { id: string; code: string; name: string; activeEmployees: number; current: Period | null; periods: Period[] }[];
}

const baht = (n: number) => n.toLocaleString('th-TH', { maximumFractionDigits: 2 });
const unitText = (p: Pick<Period, 'unit' | 'minutesPerDay'>) => (p.unit === 'HOUR' ? 'ต่อชั่วโมง' : `ต่อวัน (${p.minutesPerDay / 60} ชม.)`);

/** Cost rate per level, effective-dated: raising a rate never changes past reports. */
export function CostRates() {
  const me = useSession();
  const qc = useQueryClient();
  const writer = can(me, 'cost.write');
  const q = useQuery({ queryKey: ['cost-rates'], queryFn: () => api<Rates>('/cost-rates') });
  const [editing, setEditing] = useState<Rates['levels'][number] | null>(null);
  const [importing, setImporting] = useState(false);
  const [historyOf, setHistoryOf] = useState<string | null>(null);
  const done = () => {
    setEditing(null);
    setImporting(false);
    void qc.invalidateQueries({ queryKey: ['cost-rates'] });
    void qc.invalidateQueries({ queryKey: ['analytics'] });
  };
  const empty = q.data && q.data.levels.every((l) => !l.periods.length);

  return (
    <Card
      title={<span id="cost-rates" className="flex items-center gap-2"><Coins className="h-4 w-4 text-brand-600" /> อัตราต้นทุนตามระดับ</span>}
      description="ใช้คิดต้นทุนในรายงาน “ต้นทุนตามลูกค้า” — เปลี่ยนอัตราโดยระบุวันที่มีผล ตัวเลขเดือนก่อนหน้าจะไม่เปลี่ยน"
      actions={writer && <Button size="sm" onClick={() => setImporting(true)}>ใส่อัตราจากระบบเดิม</Button>}
      bodyClassName="p-0"
    >
      {!q.data ? (
        <div className="p-5"><Loading rows={3} /></div>
      ) : (
        <>
          {empty && (
            <div className="p-4 pb-0">
              <Alert tone="warning">
                ยังไม่ได้กำหนดอัตรา — ระบบเดิมใช้ {Object.entries(q.data.legacy).map(([k, v]) => `${k} ${baht(v)}`).join(' · ')} แต่<strong>ไม่ชัดเจนว่าเป็นต่อชั่วโมงหรือต่อวัน</strong> (สองหน้าจอเดิมคิดต่างกัน 9 เท่า) กรุณายืนยันกับผู้บริหารก่อนใส่
              </Alert>
            </div>
          )}
          <table className="mt-1 min-w-full text-[13px]">
            <thead className="text-left text-[12px] text-gray-500">
              <tr className="border-b border-gray-200">
                <th className="px-5 py-2 font-medium">ระดับ</th>
                <th className="px-3 py-2 text-right font-medium">พนักงาน</th>
                <th className="px-3 py-2 text-right font-medium">อัตราปัจจุบัน</th>
                <th className="px-3 py-2 font-medium">หน่วย</th>
                <th className="px-3 py-2 font-medium">มีผลตั้งแต่</th>
                <th className="px-3 py-2 font-medium text-gray-400">ระบบเดิม</th>
                <th />
              </tr>
            </thead>
            <tbody>
              {q.data.levels.map((l) => (
                <tr key={l.id} className="border-b border-gray-100">
                  <td className="px-5 py-2.5"><span className="font-mono font-medium">{l.code}</span> <span className="text-gray-600">{l.name}</span></td>
                  <td className="px-3 py-2.5 text-right tabular-nums text-gray-600">{l.activeEmployees}</td>
                  <td className="px-3 py-2.5 text-right font-semibold tabular-nums">{l.current ? baht(l.current.amount) : <span className="font-normal text-amber-600">ยังไม่มี</span>}</td>
                  <td className="px-3 py-2.5 text-gray-600">{l.current ? unitText(l.current) : '–'}</td>
                  <td className="px-3 py-2.5 text-gray-600">{l.current ? thaiDate(l.current.effectiveFrom) : '–'}</td>
                  <td className="px-3 py-2.5 text-gray-400 tabular-nums">{q.data.legacy[l.code] ? baht(q.data.legacy[l.code]) : '–'}</td>
                  <td className="px-3 py-2.5 text-right whitespace-nowrap">
                    {l.periods.length > 1 && (
                      <Button size="sm" variant="ghost" onClick={() => setHistoryOf(historyOf === l.id ? null : l.id)} aria-label={`ประวัติอัตรา ${l.code}`}><History className="h-3.5 w-3.5" /></Button>
                    )}
                    {writer && <Button size="sm" variant="ghost" onClick={() => setEditing(l)}><Pencil className="h-3.5 w-3.5" /> กำหนด</Button>}
                    {historyOf === l.id && (
                      <ul className="mt-1 space-y-0.5 text-left text-[11px] text-gray-500">
                        {l.periods.map((p) => (
                          <li key={p.id}>{baht(p.amount)} {unitText(p)} · {thaiDate(p.effectiveFrom)} – {p.effectiveTo ? thaiDate(p.effectiveTo) : 'ปัจจุบัน'}</li>
                        ))}
                      </ul>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </>
      )}
      {editing && <RateDialog level={editing} onClose={() => setEditing(null)} onDone={done} />}
      {importing && q.data && <LegacyDialog legacy={q.data.legacy} onClose={() => setImporting(false)} onDone={done} />}
    </Card>
  );
}

function UnitFields({ unit, setUnit, minutesPerDay, setMinutesPerDay }: { unit: Unit | ''; setUnit: (u: Unit) => void; minutesPerDay: string; setMinutesPerDay: (v: string) => void }) {
  return (
    <div className="grid grid-cols-2 gap-3">
      <Field label="หน่วย">
        <select className={inputClass} value={unit} onChange={(e) => setUnit(e.target.value as Unit)}>
          <option value="" disabled>— เลือก —</option>
          <option value="HOUR">ต่อชั่วโมง</option>
          <option value="DAY">ต่อวัน</option>
        </select>
      </Field>
      {unit === 'DAY' && (
        <Field label="1 วัน = กี่ชั่วโมง" hint="ระบบเดิมหารด้วย 540 นาที (9 ชม.)">
          <input type="number" min="1" max="24" step="0.5" className={inputClass} value={minutesPerDay} onChange={(e) => setMinutesPerDay(e.target.value)} />
        </Field>
      )}
    </div>
  );
}

function RateDialog({ level, onClose, onDone }: { level: Rates['levels'][number]; onClose: () => void; onDone: () => void }) {
  const [amount, setAmount] = useState(level.current ? String(level.current.amount) : '');
  const [unit, setUnit] = useState<Unit | ''>(level.current?.unit ?? '');
  const [hoursPerDay, setHoursPerDay] = useState(String((level.current?.minutesPerDay ?? 540) / 60));
  const [effectiveFrom, setEffectiveFrom] = useState(todayBangkok());
  const [error, setError] = useState<string | null>(null);
  const save = useMutation({
    mutationFn: () =>
      api('/cost-rates', { method: 'POST', body: { levelId: level.id, amount: Number(amount), unit, minutesPerDay: Math.round(Number(hoursPerDay) * 60), effectiveFrom } }),
    onSuccess: onDone,
    onError: (e) => setError(errorMessage(e)),
  });
  return (
    <Dialog
      open
      onClose={onClose}
      title={`อัตราต้นทุน ${level.code} ${level.name}`}
      footer={
        <>
          <Button variant="ghost" onClick={onClose}>ยกเลิก</Button>
          <Button variant="primary" loading={save.isPending} disabled={amount === '' || !unit || !effectiveFrom} onClick={() => save.mutate()}>บันทึก</Button>
        </>
      }
    >
      <Field label="จำนวนเงิน (บาท)"><input type="number" min="0" step="0.01" className={inputClass} value={amount} onChange={(e) => setAmount(e.target.value)} /></Field>
      <UnitFields unit={unit} setUnit={setUnit} minutesPerDay={hoursPerDay} setMinutesPerDay={setHoursPerDay} />
      <Field label="มีผลตั้งแต่วันที่" hint={level.current ? `อัตราเดิมจะสิ้นสุดวันก่อนหน้า · วันเดียวกับอัตราปัจจุบัน (${thaiDate(level.current.effectiveFrom)}) = แก้ไขค่าที่ใส่ผิด` : undefined}>
        <input type="date" className={inputClass} value={effectiveFrom} onChange={(e) => setEffectiveFrom(e.target.value)} />
      </Field>
      {error && <Alert tone="error">{error}</Alert>}
    </Dialog>
  );
}

function LegacyDialog({ legacy, onClose, onDone }: { legacy: Record<string, number>; onClose: () => void; onDone: () => void }) {
  const [unit, setUnit] = useState<Unit | ''>('');
  const [hoursPerDay, setHoursPerDay] = useState('9');
  const [effectiveFrom, setEffectiveFrom] = useState('2019-01-01');
  const [error, setError] = useState<string | null>(null);
  const save = useMutation({
    mutationFn: () => api('/cost-rates/legacy', { method: 'POST', body: { unit, effectiveFrom, minutesPerDay: Math.round(Number(hoursPerDay) * 60) } }),
    onSuccess: onDone,
    onError: (e) => setError(errorMessage(e)),
  });
  return (
    <Dialog
      open
      onClose={onClose}
      title="ใส่อัตราจากระบบเดิม"
      footer={
        <>
          <Button variant="ghost" onClick={onClose}>ยกเลิก</Button>
          <Button variant="primary" loading={save.isPending} disabled={!unit || !effectiveFrom} onClick={() => save.mutate()}>ใส่อัตรา</Button>
        </>
      }
    >
      <div className="flex flex-wrap gap-1">{Object.entries(legacy).map(([k, v]) => <Badge key={k}>{k} {baht(v)}</Badge>)}</div>
      <Alert tone="warning">ระบบเดิมหน้า “รายงานบริษัท” คิดแบบ<strong>ต่อชั่วโมง</strong> แต่หน้ารายละเอียดลูกค้าคิดแบบ<strong>ต่อวัน (9 ชม.)</strong> — ต่างกัน 9 เท่า เลือกหน่วยที่ผู้บริหารยืนยัน</Alert>
      <UnitFields unit={unit} setUnit={setUnit} minutesPerDay={hoursPerDay} setMinutesPerDay={setHoursPerDay} />
      <Field label="มีผลตั้งแต่วันที่" hint="ใส่วันเริ่มของข้อมูลเก่า เพื่อให้รายงานย้อนหลังคิดได้"><input type="date" className={inputClass} value={effectiveFrom} onChange={(e) => setEffectiveFrom(e.target.value)} /></Field>
      {error && <Alert tone="error">{error}</Alert>}
    </Dialog>
  );
}
