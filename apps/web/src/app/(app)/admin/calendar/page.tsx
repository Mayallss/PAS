'use client';

import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useEffect, useState } from 'react';
import { Alert, Button, Card, Dialog, Empty, Field, inputClass, Loading, PageHeader } from '@/components/ui';
import { api, errorMessage } from '@/lib/api';
import { currentMonth, thaiDate, thaiMonth } from '@/lib/format';
import type { Policy } from '@/lib/types';

interface Holiday {
  id: string;
  date: string;
  minutes: number;
  description: string;
}

export default function CalendarAdminPage() {
  return (
    <div className="space-y-4">
      <PageHeader title="วันหยุดและนโยบาย" description="วันหยุดบริษัท การปิดงวด และกติกาการบันทึกเวลา" />
      <div className="grid gap-4 xl:grid-cols-[2fr_1fr]">
        <Holidays />
        <div className="space-y-4">
          <Locks />
          <PolicyForm />
        </div>
      </div>
    </div>
  );
}

function Holidays() {
  const qc = useQueryClient();
  const [year, setYear] = useState(Number(currentMonth().slice(0, 4)));
  const [editing, setEditing] = useState<Partial<Holiday> | null>(null);
  const [error, setError] = useState<string | null>(null);
  const q = useQuery({ queryKey: ['holidays', year], queryFn: () => api<Holiday[]>('/calendar/holidays', { query: { from: `${year}-01-01`, to: `${year}-12-31` } }) });

  const save = useMutation({
    mutationFn: (h: Partial<Holiday>) =>
      api(h.id ? `/calendar/holidays/${h.id}` : '/calendar/holidays', {
        method: h.id ? 'PUT' : 'POST',
        body: { date: h.date, minutes: Number(h.minutes ?? 540), description: h.description },
      }),
    onSuccess: () => {
      setEditing(null);
      void qc.invalidateQueries({ queryKey: ['holidays'] });
      void qc.invalidateQueries({ queryKey: ['week'] });
      void qc.invalidateQueries({ queryKey: ['month-summary'] });
    },
    onError: (e) => setError(errorMessage(e)),
  });
  const remove = useMutation({
    mutationFn: (id: string) => api(`/calendar/holidays/${id}`, { method: 'DELETE' }),
    onSuccess: () => void qc.invalidateQueries({ queryKey: ['holidays'] }),
    onError: (e) => setError(errorMessage(e)),
  });

  return (
    <Card
      title={`วันหยุดบริษัท ปี ${year + 543}`}
      actions={
        <>
          <Button size="sm" onClick={() => setYear(year - 1)} aria-label="ปีก่อนหน้า">
            ‹
          </Button>
          <Button size="sm" onClick={() => setYear(year + 1)} aria-label="ปีถัดไป">
            ›
          </Button>
          <Button
            size="sm"
            variant="primary"
            onClick={() => {
              setError(null);
              setEditing({ date: `${year}-01-01`, minutes: 540, description: '' });
            }}
          >
            + เพิ่มวันหยุด
          </Button>
        </>
      }
    >
      {error && !editing && <Alert tone="error">{error}</Alert>}
      {q.isLoading ? (
        <Loading />
      ) : !q.data?.length ? (
        <Empty>ยังไม่มีวันหยุดในปีนี้</Empty>
      ) : (
        <table className="min-w-full text-sm">
          <thead className="border-b text-left">
            <tr>
              <th className="py-1">วันที่</th>
              <th className="py-1">รายละเอียด</th>
              <th className="py-1 text-right">ชม. ที่หยุด</th>
              <th />
            </tr>
          </thead>
          <tbody>
            {q.data.map((h) => (
              <tr key={h.id} className="border-b border-gray-100">
                <td className="py-1.5">{thaiDate(h.date)}</td>
                <td className="py-1.5">{h.description}</td>
                <td className="py-1.5 text-right">{h.minutes / 60}</td>
                <td className="py-1.5 text-right whitespace-nowrap">
                  <Button size="sm" variant="ghost" onClick={() => { setError(null); setEditing(h); }}>
                    แก้ไข
                  </Button>
                  <Button size="sm" variant="ghost" className="text-red-700" onClick={() => window.confirm(`ลบวันหยุด ${h.description}?`) && remove.mutate(h.id)}>
                    ลบ
                  </Button>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
      <Dialog
        open={!!editing}
        onClose={() => setEditing(null)}
        title={editing?.id ? 'แก้ไขวันหยุด' : 'เพิ่มวันหยุด'}
        footer={
          <>
            <Button variant="ghost" onClick={() => setEditing(null)}>
              ยกเลิก
            </Button>
            <Button variant="primary" disabled={save.isPending || !editing?.date || !editing?.description} onClick={() => editing && save.mutate(editing)}>
              บันทึก
            </Button>
          </>
        }
      >
        {editing && (
          <>
            <Field label="วันที่">
              <input type="date" className={inputClass} value={editing.date ?? ''} onChange={(e) => setEditing({ ...editing, date: e.target.value })} />
            </Field>
            <Field label="รายละเอียด">
              <input className={inputClass} maxLength={150} value={editing.description ?? ''} onChange={(e) => setEditing({ ...editing, description: e.target.value })} />
            </Field>
            <Field label="ชั่วโมงที่หยุด" hint="9 = หยุดทั้งวัน, 4.5 = ครึ่งวัน">
              <select className={inputClass} value={editing.minutes ?? 540} onChange={(e) => setEditing({ ...editing, minutes: Number(e.target.value) })}>
                <option value={540}>ทั้งวัน (9 ชม.)</option>
                <option value={270}>ครึ่งวัน (4.5 ชม.)</option>
              </select>
            </Field>
            {error && <Alert tone="error">{error}</Alert>}
          </>
        )}
      </Dialog>
    </Card>
  );
}

function Locks() {
  const qc = useQueryClient();
  const [month, setMonth] = useState(currentMonth());
  const [error, setError] = useState<string | null>(null);
  const q = useQuery({ queryKey: ['locks'], queryFn: () => api<{ month: string; lockedAt: string; reason: string | null }[]>('/calendar/locks') });
  const refresh = () => {
    setError(null);
    void qc.invalidateQueries({ queryKey: ['locks'] });
    void qc.invalidateQueries({ queryKey: ['week'] });
      void qc.invalidateQueries({ queryKey: ['month-summary'] });
  };
  const lock = useMutation({ mutationFn: () => api(`/calendar/locks/${month}`, { method: 'PUT', body: {} }), onSuccess: refresh, onError: (e) => setError(errorMessage(e)) });
  const unlock = useMutation({ mutationFn: (m: string) => api(`/calendar/locks/${m}`, { method: 'DELETE' }), onSuccess: refresh, onError: (e) => setError(errorMessage(e)) });

  return (
    <Card title="ปิดงวด (ล็อกการแก้ไข)">
      <div className="space-y-3">
        <Alert tone="info">ระบบเดิมไม่มีการปิดงวด — ยังไม่มีงวดใดถูกปิดโดยอัตโนมัติ รอกำหนดนโยบาย</Alert>
        <div className="flex items-end gap-2">
          <Field label="เดือน">
            <input type="month" className={inputClass} value={month} onChange={(e) => setMonth(e.target.value)} />
          </Field>
          <Button variant="primary" disabled={!month || lock.isPending} onClick={() => window.confirm(`ปิดงวด ${thaiMonth(month)}? พนักงานจะแก้ไขเวลาในเดือนนี้ไม่ได้`) && lock.mutate()}>
            ปิดงวด
          </Button>
        </div>
        {error && <Alert tone="error">{error}</Alert>}
        <ul className="divide-y divide-gray-100 text-sm">
          {(q.data ?? []).map((l) => (
            <li key={l.month} className="flex items-center justify-between py-1.5">
              <span>🔒 {thaiMonth(l.month)}</span>
              <Button size="sm" variant="ghost" onClick={() => window.confirm(`เปิดงวด ${thaiMonth(l.month)} ให้แก้ไขได้อีกครั้ง?`) && unlock.mutate(l.month)}>
                เปิดงวด
              </Button>
            </li>
          ))}
          {q.data?.length === 0 && <li className="py-1.5 text-gray-500">ไม่มีงวดที่ปิด</li>}
        </ul>
      </div>
    </Card>
  );
}

function PolicyForm() {
  const qc = useQueryClient();
  const q = useQuery({ queryKey: ['policy'], queryFn: () => api<Policy>('/calendar/policy') });
  const [form, setForm] = useState<Record<keyof Policy, string> | null>(null);
  const [msg, setMsg] = useState<{ tone: 'success' | 'error'; text: string } | null>(null);
  useEffect(() => {
    if (q.data) {
      setForm({
        dailyTargetMinutes: String(q.data.dailyTargetMinutes / 60),
        incrementMinutes: String(q.data.incrementMinutes),
        maxEntryMinutes: String(q.data.maxEntryMinutes / 60),
        maxDailyMinutes: q.data.maxDailyMinutes == null ? '' : String(q.data.maxDailyMinutes / 60),
        backdateDays: q.data.backdateDays == null ? '' : String(q.data.backdateDays),
        futureDays: String(q.data.futureDays),
      });
    }
  }, [q.data]);
  const save = useMutation({
    mutationFn: () =>
      api('/calendar/policy', {
        method: 'PUT',
        body: {
          dailyTargetMinutes: Math.round(Number(form!.dailyTargetMinutes) * 60),
          incrementMinutes: Number(form!.incrementMinutes),
          maxEntryMinutes: Math.round(Number(form!.maxEntryMinutes) * 60),
          maxDailyMinutes: form!.maxDailyMinutes === '' ? null : Math.round(Number(form!.maxDailyMinutes) * 60),
          backdateDays: form!.backdateDays === '' ? null : Number(form!.backdateDays),
          futureDays: Number(form!.futureDays),
        },
      }),
    onSuccess: () => {
      setMsg({ tone: 'success', text: 'บันทึกแล้ว' });
      void qc.invalidateQueries({ queryKey: ['policy'] });
      void qc.invalidateQueries({ queryKey: ['week'] });
      void qc.invalidateQueries({ queryKey: ['month-summary'] });
    },
    onError: (e) => setMsg({ tone: 'error', text: errorMessage(e) }),
  });
  if (!form) return <Card title="นโยบายเวลา"><Loading /></Card>;
  const set = (k: keyof Policy) => (e: React.ChangeEvent<HTMLInputElement | HTMLSelectElement>) => setForm({ ...form, [k]: e.target.value });
  return (
    <Card title="นโยบายเวลา">
      <form
        className="space-y-3"
        onSubmit={(e) => {
          e.preventDefault();
          setMsg(null);
          save.mutate();
        }}
      >
        <Alert tone="warning">ค่าเริ่มต้นเท่ากับระบบเดิม — รอยืนยันนโยบายจากฝ่ายบริหาร (docs/06 Q2–Q4)</Alert>
        <Field label="เป้าหมายต่อวัน (ชม.)">
          <input className={inputClass} type="number" step="0.5" min="1" max="12" value={form.dailyTargetMinutes} onChange={set('dailyTargetMinutes')} />
        </Field>
        <Field label="หน่วยย่อย (นาที)">
          <select className={inputClass} value={form.incrementMinutes} onChange={set('incrementMinutes')}>
            {[5, 6, 10, 15, 30, 60].map((m) => (
              <option key={m} value={m}>
                {m}
              </option>
            ))}
          </select>
        </Field>
        <Field label="สูงสุดต่อรายการ (ชม.)">
          <input className={inputClass} type="number" step="0.5" min="0.5" max="24" value={form.maxEntryMinutes} onChange={set('maxEntryMinutes')} />
        </Field>
        <Field label="สูงสุดต่อวัน (ชม.)" hint="ว่าง = ไม่บล็อก แค่แสดงสีเตือน (เหมือนระบบเดิม)">
          <input className={inputClass} type="number" step="0.5" min="1" max="24" value={form.maxDailyMinutes} onChange={set('maxDailyMinutes')} />
        </Field>
        <Field label="บันทึกย้อนหลังได้ (วัน)" hint="ว่าง = ไม่จำกัด (เหมือนระบบเดิม)">
          <input className={inputClass} type="number" min="0" value={form.backdateDays} onChange={set('backdateDays')} />
        </Field>
        <Field label="บันทึกล่วงหน้าได้ (วัน)">
          <input className={inputClass} type="number" min="0" max="366" value={form.futureDays} onChange={set('futureDays')} />
        </Field>
        {msg && <Alert tone={msg.tone}>{msg.text}</Alert>}
        <Button type="submit" variant="primary" disabled={save.isPending}>
          บันทึกนโยบาย
        </Button>
      </form>
    </Card>
  );
}
