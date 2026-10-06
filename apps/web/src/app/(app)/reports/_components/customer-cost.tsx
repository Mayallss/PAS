'use client';

import { keepPreviousData, useQuery } from '@tanstack/react-query';
import { AlertTriangle, Inbox } from 'lucide-react';
import Link from 'next/link';
import { useState } from 'react';
import { Alert, Card, Dialog, Empty, inputClass, Loading, Progress } from '@/components/ui';
import { api, errorMessage } from '@/lib/api';
import { currentMonth, hours, thaiDateShort, todayBangkok } from '@/lib/format';
import { can, useSession } from '@/lib/session';

type Basis = 'CURRENT' | 'AT_DATE';
interface Bucket {
  minutes: number;
  cost: number;
  unpricedMinutes: number;
}
interface CostReport {
  levels: { code: string; name: string }[];
  units: string[];
  customers: (Bucket & { id: string; code: string; name: string; accountOwner: string | null; byLevel: Record<string, Bucket> })[];
  internal: (Bucket & { type: 'INTERNAL' | 'MEETING' | 'LEAVE' })[];
  total: Bucket;
  missing: { NO_LEVEL: number; NO_RATE: number };
}
interface CostDetail {
  customer: { code: string; name: string; accountOwner: string | null };
  rows: { id: string; date: string; activity: string; employee: string; level: string; minutes: number; rate: { amount: number; unit: 'HOUR' | 'DAY'; minutesPerDay: number } | null; cost: number | null }[];
}

const INTERNAL_LABEL = { INTERNAL: 'งานภายใน', MEETING: 'ประชุม', LEAVE: 'ลา' } as const;
const baht = (n: number) => n.toLocaleString('th-TH', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
const unitLabel = (u: string) => (u === 'HOUR' ? 'ต่อชั่วโมง' : `ต่อวัน (${Number(u.split('/')[1]) / 60} ชม.)`);

/** Hours and money per customer (cost.read). Internal work / meetings / leave are shown apart — docs/06 Q4 is open. */
export function CustomerCost() {
  const me = useSession();
  const [from, setFrom] = useState(`${currentMonth()}-01`);
  const [to, setTo] = useState(todayBangkok());
  const [basis, setBasis] = useState<Basis>('CURRENT');
  const [detailOf, setDetailOf] = useState<string | null>(null);
  const valid = !!from && !!to && from <= to;
  const q = useQuery({
    queryKey: ['customer-cost', from, to, basis],
    enabled: valid,
    placeholderData: keepPreviousData,
    queryFn: () => api<CostReport>('/reports/customer-cost', { query: { from, to, basis } }),
  });
  const d = q.data;
  const max = Math.max(1, ...(d?.customers.map((c) => c.cost) ?? [1]));
  const unpriced = (d?.missing.NO_LEVEL ?? 0) + (d?.missing.NO_RATE ?? 0);

  return (
    <div className="space-y-4">
      <Card
        title="ต้นทุนตามลูกค้า"
        description={d?.units.length ? `อัตรา: ${d.units.map(unitLabel).join(', ')} · ${basis === 'CURRENT' ? 'คิดด้วยระดับปัจจุบัน (แบบระบบเดิม)' : 'คิดด้วยระดับ ณ วันที่ทำงาน'}` : 'ยังไม่ได้กำหนดอัตราต้นทุน'}
        actions={
          <>
            <div className="flex items-center gap-2">
              <input type="date" aria-label="ตั้งแต่" className={`${inputClass} w-40`} value={from} onChange={(e) => setFrom(e.target.value)} />
              <span className="text-gray-400">–</span>
              <input type="date" aria-label="ถึง" className={`${inputClass} w-40`} value={to} onChange={(e) => setTo(e.target.value)} />
            </div>
            <select aria-label="ระดับที่ใช้คิด" className={`${inputClass} w-52`} value={basis} onChange={(e) => setBasis(e.target.value as Basis)}>
              <option value="CURRENT">ระดับปัจจุบัน (แบบระบบเดิม)</option>
              <option value="AT_DATE">ระดับ ณ วันที่ทำงาน</option>
            </select>
          </>
        }
        bodyClassName={q.isPlaceholderData ? 'opacity-60' : 'p-0'}
      >
        {!d?.units.length && !q.isLoading && (
          <div className="p-4">
            <Alert tone="warning">
              ยังไม่มีอัตราต้นทุน — {can(me, 'cost.write') ? <Link href="/admin/employees#cost-rates" className="font-medium underline">กำหนดอัตราตามระดับ</Link> : 'ให้ Admin กำหนดอัตราตามระดับ'} แล้วรายงานจะแสดงจำนวนเงิน
            </Alert>
          </div>
        )}
        {unpriced > 0 && !!d?.units.length && (
          <div className="p-4 pb-0">
            <Alert tone="warning">
              <span className="inline-flex items-center gap-1.5">
                <AlertTriangle className="h-4 w-4" /> มี {hours(unpriced)} ชม. ที่คิดต้นทุนไม่ได้
                {d!.missing.NO_LEVEL > 0 && ` (ไม่มีระดับ ${hours(d!.missing.NO_LEVEL)} ชม.)`}
                {d!.missing.NO_RATE > 0 && ` (ระดับยังไม่มีอัตรา ${hours(d!.missing.NO_RATE)} ชม.)`}
              </span>
            </Alert>
          </div>
        )}
        {q.isLoading ? (
          <div className="p-5"><Loading /></div>
        ) : q.error ? (
          <div className="p-5"><Alert tone="error">{errorMessage(q.error)}</Alert></div>
        ) : !d?.customers.length && !d?.internal.length ? (
          <Empty icon={<Inbox className="h-5 w-5" />} title="ไม่มีข้อมูลในช่วงนี้" />
        ) : (
          <div className="overflow-x-auto">
            <table className="min-w-full text-[13px]">
              <thead className="text-left text-[12px] text-gray-500">
                <tr className="border-b border-gray-200">
                  <th className="px-5 py-2 font-medium">ลูกค้า</th>
                  <th className="px-3 py-2 font-medium">ผู้ดูแล</th>
                  {d!.levels.map((l) => (
                    <th key={l.code} className="px-3 py-2 text-right font-medium" title={l.name}>{l.code}</th>
                  ))}
                  <th className="px-3 py-2 text-right font-medium">ชม.</th>
                  <th className="w-64 px-5 py-2 text-right font-medium">ต้นทุน (บาท)</th>
                </tr>
              </thead>
              <tbody>
                {d!.customers.map((c) => (
                  <tr key={c.id} className="cursor-pointer border-b border-gray-100 hover:bg-gray-50/60" onClick={() => setDetailOf(c.id)}>
                    <td className="px-5 py-2.5">
                      <span className="font-mono text-[12px] text-gray-500">{c.code}</span> <span className="text-gray-900 underline-offset-2 hover:underline">{c.name}</span>
                    </td>
                    <td className="px-3 py-2.5 text-gray-600">{c.accountOwner ?? '–'}</td>
                    {d!.levels.map((l) => (
                      <td key={l.code} className="px-3 py-2.5 text-right text-gray-600 tabular-nums" title={c.byLevel[l.code] ? `${baht(c.byLevel[l.code].cost)} บาท` : undefined}>
                        {hours(c.byLevel[l.code]?.minutes ?? 0)}
                      </td>
                    ))}
                    <td className="px-3 py-2.5 text-right tabular-nums">{hours(c.minutes)}</td>
                    <td className="px-5 py-2.5">
                      <div className="flex items-center justify-end gap-3">
                        <Progress className="w-20" value={c.cost} max={max} />
                        <span className="w-24 text-right font-semibold tabular-nums">{baht(c.cost)}</span>
                        {c.unpricedMinutes > 0 && <span title={`${hours(c.unpricedMinutes)} ชม. ไม่มีอัตรา`}><AlertTriangle className="h-3.5 w-3.5 text-amber-500" /></span>}
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
              {!!d!.internal.length && (
                <tbody className="border-t-2 border-gray-200 bg-gray-50/60">
                  <tr>
                    <td colSpan={d!.levels.length + 4} className="px-5 pt-3 pb-1 text-[12px] font-medium text-gray-500">
                      ไม่ใช่งานลูกค้า — แสดงแยก (ยังไม่ได้ตัดสินใจว่านับเป็นต้นทุนหรือไม่)
                    </td>
                  </tr>
                  {d!.internal.map((i) => (
                    <tr key={i.type} className="text-gray-600">
                      <td className="px-5 py-2" colSpan={d!.levels.length + 2}>{INTERNAL_LABEL[i.type]}</td>
                      <td className="px-3 py-2 text-right tabular-nums">{hours(i.minutes)}</td>
                      <td className="px-5 py-2 text-right tabular-nums">{baht(i.cost)}</td>
                    </tr>
                  ))}
                </tbody>
              )}
            </table>
          </div>
        )}
      </Card>
      {detailOf && <DetailDialog customerId={detailOf} from={from} to={to} basis={basis} onClose={() => setDetailOf(null)} />}
    </div>
  );
}

function DetailDialog({ customerId, from, to, basis, onClose }: { customerId: string; from: string; to: string; basis: Basis; onClose: () => void }) {
  const q = useQuery({ queryKey: ['customer-cost-detail', customerId, from, to, basis], queryFn: () => api<CostDetail>(`/reports/customer-cost/${customerId}`, { query: { from, to, basis } }) });
  const total = q.data?.rows.reduce((a, r) => a + (r.cost ?? 0), 0) ?? 0;
  return (
    <Dialog wide open onClose={onClose} title={q.data ? `${q.data.customer.code} ${q.data.customer.name}` : 'รายละเอียด'}>
      {q.isLoading ? (
        <Loading rows={4} />
      ) : q.error ? (
        <Alert tone="error">{errorMessage(q.error)}</Alert>
      ) : (
        <div className="max-h-[60vh] overflow-y-auto">
          <p className="mb-2 text-[12px] text-gray-500">ผู้ดูแล: {q.data!.customer.accountOwner ?? '–'}</p>
          <table className="min-w-full text-[12px]">
            <thead className="sticky top-0 bg-white text-left text-gray-500">
              <tr className="border-b border-gray-200">
                <th className="py-1.5 pr-2 font-medium">วันที่</th>
                <th className="py-1.5 pr-2 font-medium">Activity</th>
                <th className="py-1.5 pr-2 font-medium">ผู้ทำ</th>
                <th className="py-1.5 pr-2 font-medium">ระดับ</th>
                <th className="py-1.5 pr-2 text-right font-medium">ชม.</th>
                <th className="py-1.5 pr-2 text-right font-medium">อัตรา</th>
                <th className="py-1.5 text-right font-medium">ต้นทุน</th>
              </tr>
            </thead>
            <tbody>
              {q.data!.rows.map((r) => (
                <tr key={r.id} className="border-b border-gray-100">
                  <td className="py-1.5 pr-2 whitespace-nowrap">{thaiDateShort(r.date)}</td>
                  <td className="py-1.5 pr-2">{r.activity}</td>
                  <td className="py-1.5 pr-2">{r.employee}</td>
                  <td className="py-1.5 pr-2">{r.level}</td>
                  <td className="py-1.5 pr-2 text-right tabular-nums">{hours(r.minutes)}</td>
                  <td className="py-1.5 pr-2 text-right tabular-nums">{r.rate ? `${baht(r.rate.amount)}/${r.rate.unit === 'HOUR' ? 'ชม.' : 'วัน'}` : <span className="text-amber-600">ไม่มี</span>}</td>
                  <td className="py-1.5 text-right tabular-nums">{r.cost === null ? '–' : baht(r.cost)}</td>
                </tr>
              ))}
            </tbody>
            <tfoot>
              <tr className="font-semibold">
                <td colSpan={6} className="py-2 text-right">รวม</td>
                <td className="py-2 text-right tabular-nums">{baht(total)}</td>
              </tr>
            </tfoot>
          </table>
        </div>
      )}
    </Dialog>
  );
}
