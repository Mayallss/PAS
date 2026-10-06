import { CheckCheck, Clock, MessageSquareReply, MessageSquareWarning, RefreshCcw } from 'lucide-react';
import type { PersonStatus } from '@/lib/types';

export const PERSON_STATUS: Record<PersonStatus, { label: string; short: string; className: string; icon: typeof Clock }> = {
  PENDING: { label: 'รอคุณรับรอง', short: 'รอรับรอง', className: 'bg-amber-50 text-amber-700 ring-amber-200', icon: Clock },
  OUTDATED: { label: 'ถูกแก้ไขหลังคุณรับรอง — กรุณารับรองใหม่', short: 'ต้องรับรองใหม่', className: 'bg-amber-50 text-amber-700 ring-amber-200', icon: RefreshCcw },
  ACCEPTED: { label: 'คุณรับรองแล้วว่าถูกต้อง', short: 'รับรองแล้ว', className: 'bg-emerald-50 text-emerald-700 ring-emerald-200', icon: CheckCheck },
  OBJECTION: { label: 'คุณแย้งไว้ — รอผู้บันทึกแก้ไขหรือตอบ', short: 'แย้งไว้', className: 'bg-rose-50 text-rose-700 ring-rose-200', icon: MessageSquareWarning },
  OBJECTION_REPLIED: { label: 'ผู้บันทึกตอบข้อโต้แย้งแล้ว — กรุณาพิจารณา', short: 'ผู้บันทึกตอบแล้ว', className: 'bg-sky-50 text-sky-700 ring-sky-200', icon: MessageSquareReply },
};

export function StatusPill({ status, long = false }: { status: PersonStatus; long?: boolean }) {
  const s = PERSON_STATUS[status];
  return (
    <span className={`inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-[12px] font-medium ring-1 ring-inset ${s.className}`}>
      <s.icon className="h-3.5 w-3.5" /> {long ? s.label : s.short}
    </span>
  );
}
