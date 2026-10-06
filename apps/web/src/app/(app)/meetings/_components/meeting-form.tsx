'use client';

import { useMutation, useQueryClient } from '@tanstack/react-query';
import { AlertTriangle, RefreshCcw, Save } from 'lucide-react';
import dynamic from 'next/dynamic';
import { useRouter } from 'next/navigation';
import { useState } from 'react';
import { toast } from 'sonner';
import { Alert, Button, Field, inputClass, PageHeader } from '@/components/ui';
import { api, ApiError, errorMessage } from '@/lib/api';
import { todayBangkok } from '@/lib/format';
import type { MeetingDetail } from '@/lib/types';

// The editor (Tiptap/ProseMirror) is only downloaded on this page.
const RichEditor = dynamic(() => import('./rich-editor'), { ssr: false, loading: () => <div className="skeleton h-[380px] rounded-xl" /> });

/** Create (no `meeting`) or publish a new version of existing minutes. */
export function MeetingForm({ meeting }: { meeting?: MeetingDetail }) {
  const router = useRouter();
  const qc = useQueryClient();
  const [title, setTitle] = useState(meeting?.title ?? '');
  const [date, setDate] = useState(meeting?.meetingDate ?? todayBangkok());
  const [start, setStart] = useState(meeting?.startTime ?? '09:00');
  const [end, setEnd] = useState(meeting?.endTime ?? '');
  const [location, setLocation] = useState(meeting?.location ?? '');
  const [body, setBody] = useState(meeting?.bodyHtml ?? '');
  const [changeNote, setChangeNote] = useState('');
  const [recertify, setRecertify] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const editing = !!meeting;

  const save = useMutation({
    mutationFn: () => {
      const base = { title, meetingDate: date, startTime: start || null, endTime: end || null, location: location || null, bodyHtml: body };
      return editing
        ? api<{ id: string; version: number }>(`/meetings/${meeting.id}`, {
            method: 'PUT',
            body: { ...base, expectedVersion: meeting.version, changeNote: changeNote || null, requiresRecertification: recertify },
          })
        : api<{ id: string; version: number }>('/meetings', { method: 'POST', body: base });
    },
    onSuccess: (res) => {
      toast.success(editing ? `เผยแพร่ฉบับที่ ${res.version} แล้ว` : 'บันทึกรายงานการประชุมแล้ว');
      void qc.invalidateQueries({ queryKey: ['meetings'] });
      void qc.invalidateQueries({ queryKey: ['meeting', res.id] });
      void qc.invalidateQueries({ queryKey: ['notifications'] });
      router.push(`/meetings/${res.id}`);
    },
    onError: (e) => {
      setError(errorMessage(e));
      if (e instanceof ApiError && e.status === 409) toast.error('มีคนแก้ไขรายงานนี้ก่อนคุณ — กรุณาโหลดใหม่');
    },
  });

  const valid = title.trim() && date && body.replace(/<[^>]+>/g, '').trim() && (!editing || !recertify || changeNote.trim());

  return (
    <div className="mx-auto max-w-4xl">
      <PageHeader
        title={editing ? `แก้ไขรายงาน — ฉบับที่ ${meeting.version + 1}` : 'บันทึกรายงานการประชุม'}
        description={editing ? 'การแก้ไขจะสร้างฉบับใหม่ ฉบับเดิมเก็บไว้ครบ และผู้อ่านจะเห็นส่วนที่เปลี่ยนเป็นไฮไลต์' : 'พนักงานทุกคนที่ทำงานอยู่ ณ วันประชุมจะได้รับแจ้งให้รับรองรายงาน'}
      />
      <form
        className="space-y-5"
        onSubmit={(e) => {
          e.preventDefault();
          setError(null);
          if (valid) save.mutate();
        }}
      >
        <div className="grid gap-4 rounded-2xl bg-white p-5 shadow-card ring-1 ring-gray-200/80 sm:grid-cols-6">
          <div className="sm:col-span-6">
            <Field label="หัวเรื่อง">
              <input className={inputClass} required maxLength={200} value={title} onChange={(e) => setTitle(e.target.value)} placeholder="เช่น ประชุมประจำเดือน ตุลาคม 2569" />
            </Field>
          </div>
          <div className="sm:col-span-2">
            <Field label="วันที่ประชุม">
              <input className={inputClass} type="date" required value={date} onChange={(e) => setDate(e.target.value)} />
            </Field>
          </div>
          <div className="sm:col-span-1">
            <Field label="เริ่ม">
              <input className={inputClass} type="time" value={start} onChange={(e) => setStart(e.target.value)} />
            </Field>
          </div>
          <div className="sm:col-span-1">
            <Field label="สิ้นสุด">
              <input className={inputClass} type="time" value={end} onChange={(e) => setEnd(e.target.value)} />
            </Field>
          </div>
          <div className="sm:col-span-2">
            <Field label="สถานที่">
              <input className={inputClass} maxLength={120} value={location} onChange={(e) => setLocation(e.target.value)} placeholder="ห้องประชุม / ออนไลน์" />
            </Field>
          </div>
        </div>

        <RichEditor value={body} onChange={setBody} />

        {editing && (
          <div className="space-y-4 rounded-2xl bg-white p-5 shadow-card ring-1 ring-gray-200/80">
            <Field label="สรุปสิ่งที่แก้ไข" hint="แสดงให้ทุกคนเห็นคู่กับไฮไลต์ เช่น “แก้กำหนดส่งตามที่คุณ ก. แย้ง”">
              <textarea className={inputClass} rows={2} maxLength={1000} value={changeNote} onChange={(e) => setChangeNote(e.target.value)} />
            </Field>
            <fieldset className="grid gap-2 sm:grid-cols-2">
              <legend className="mb-1.5 text-[13px] font-medium text-gray-700">ผลต่อการรับรอง</legend>
              <label className={`flex cursor-pointer gap-3 rounded-xl p-3 ring-1 ${recertify ? 'bg-amber-50/60 ring-amber-300' : 'ring-gray-200'}`}>
                <input type="radio" name="recert" className="mt-1" checked={recertify} onChange={() => setRecertify(true)} />
                <span>
                  <span className="flex items-center gap-1.5 text-[13px] font-medium text-gray-900">
                    <RefreshCcw className="h-3.5 w-3.5" /> แก้ไขเนื้อหา — ทุกคนต้องรับรองใหม่
                  </span>
                  <span className="text-[12px] text-gray-500">ใช้เมื่อข้อสรุป ตัวเลข หรือมติเปลี่ยน (รวมถึงแก้ตามข้อโต้แย้ง)</span>
                </span>
              </label>
              <label className={`flex cursor-pointer gap-3 rounded-xl p-3 ring-1 ${!recertify ? 'bg-brand-50/60 ring-brand-300' : 'ring-gray-200'}`}>
                <input type="radio" name="recert" className="mt-1" checked={!recertify} onChange={() => setRecertify(false)} />
                <span>
                  <span className="text-[13px] font-medium text-gray-900">แก้เล็กน้อย — ไม่ต้องรับรองใหม่</span>
                  <span className="block text-[12px] text-gray-500">คำผิด การจัดรูปแบบ — ยังแสดงไฮไลต์และบันทึกประวัติเหมือนเดิม</span>
                </span>
              </label>
            </fieldset>
            {recertify && !changeNote.trim() && (
              <p className="flex items-center gap-1.5 text-[12px] text-amber-700">
                <AlertTriangle className="h-3.5 w-3.5" /> กรุณาสรุปสิ่งที่แก้ไข เพื่อให้ผู้รับรองตรวจได้ง่าย
              </p>
            )}
          </div>
        )}

        {error && <Alert tone="error">{error}</Alert>}
        <div className="flex justify-end gap-2">
          <Button variant="ghost" onClick={() => router.back()}>
            ยกเลิก
          </Button>
          <Button type="submit" variant="primary" loading={save.isPending} disabled={!valid}>
            <Save className="h-4 w-4" /> {editing ? `เผยแพร่ฉบับที่ ${meeting.version + 1}` : 'บันทึกและแจ้งให้รับรอง'}
          </Button>
        </div>
      </form>
    </div>
  );
}
