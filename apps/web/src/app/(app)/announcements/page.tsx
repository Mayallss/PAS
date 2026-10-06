'use client';

import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { CheckCheck, Megaphone, Pencil, Pin, Plus, Trash2 } from 'lucide-react';
import { useEffect, useState } from 'react';
import { toast } from 'sonner';
import { Alert, Badge, Button, Dialog, Empty, Field, inputClass, Loading, PageHeader, Progress } from '@/components/ui';
import { api, errorMessage } from '@/lib/api';
import { thaiDate } from '@/lib/format';
import { can, useSession } from '@/lib/session';
import type { Announcement } from '@/lib/types';

type Draft = { id?: string; title: string; body: string; requiresAck: boolean; pinned: boolean };
const EMPTY: Draft = { title: '', body: '', requiresAck: false, pinned: false };

export default function AnnouncementsPage() {
  const me = useSession();
  const qc = useQueryClient();
  const writer = can(me, 'announcement.write');
  const [draft, setDraft] = useState<Draft | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [highlight, setHighlight] = useState<string | null>(null);
  const q = useQuery({ queryKey: ['announcements'], queryFn: () => api<Announcement[]>('/announcements', { query: { limit: 100 } }) });

  // Deep link from home / notifications: /announcements#<id>
  useEffect(() => {
    const id = window.location.hash.slice(1);
    if (!id || !q.data) return;
    setHighlight(id);
    document.getElementById(id)?.scrollIntoView({ behavior: 'smooth', block: 'center' });
    const t = setTimeout(() => setHighlight(null), 2500);
    return () => clearTimeout(t);
  }, [q.data]);

  const refresh = () => {
    void qc.invalidateQueries({ queryKey: ['announcements'] });
    void qc.invalidateQueries({ queryKey: ['home'] });
    void qc.invalidateQueries({ queryKey: ['notifications'] });
  };
  const ack = useMutation({
    mutationFn: (id: string) => api(`/announcements/${id}/ack`, { method: 'POST' }),
    onSuccess: () => {
      toast.success('รับทราบแล้ว');
      refresh();
    },
    onError: (e) => toast.error(errorMessage(e)),
  });
  const save = useMutation({
    mutationFn: (d: Draft) =>
      api(d.id ? `/announcements/${d.id}` : '/announcements', {
        method: d.id ? 'PUT' : 'POST',
        body: { title: d.title, body: d.body, requiresAck: d.requiresAck, pinned: d.pinned },
      }),
    onSuccess: () => {
      setDraft(null);
      toast.success('บันทึกประกาศแล้ว');
      refresh();
    },
    onError: (e) => setError(errorMessage(e)),
  });
  const remove = useMutation({
    mutationFn: (id: string) => api(`/announcements/${id}`, { method: 'DELETE' }),
    onSuccess: refresh,
    onError: (e) => toast.error(errorMessage(e)),
  });

  return (
    <div className="mx-auto max-w-3xl">
      <PageHeader
        title="ประกาศ"
        description="ข่าวสารและสรุปการประชุม — ประกาศที่ต้องรับทราบจะแสดงในการแจ้งเตือนจนกว่าจะกดรับทราบ"
        actions={
          writer && (
            <Button variant="primary" onClick={() => { setError(null); setDraft({ ...EMPTY }); }}>
              <Plus className="h-4 w-4" /> ประกาศใหม่
            </Button>
          )
        }
      />
      {q.isLoading ? (
        <Loading rows={4} />
      ) : !q.data?.length ? (
        <Empty icon={<Megaphone className="h-5 w-5" />} title="ยังไม่มีประกาศ" />
      ) : (
        <ol className="relative space-y-4 border-l border-gray-200 pl-6">
          {q.data.map((a, i) => (
            <li
              key={a.id}
              id={a.id}
              className={`animate-fade-up stagger relative rounded-2xl bg-white p-5 shadow-card ring-1 transition-shadow duration-500 ${highlight === a.id ? 'ring-2 ring-brand-500 shadow-pop' : 'ring-gray-200/80'}`}
              style={{ '--i': Math.min(i, 8) } as React.CSSProperties}
            >
              <span className={`absolute top-6 -left-[31px] h-3 w-3 rounded-full ring-4 ring-gray-50 ${a.requiresAck && !a.ackedAt ? 'bg-pas-yellow' : 'bg-brand-600'}`} aria-hidden />
              <div className="flex flex-wrap items-center gap-2 text-[12px] text-gray-500">
                {a.pinned && (
                  <Badge tone="brand">
                    <Pin className="h-3 w-3" /> ปักหมุด
                  </Badge>
                )}
                {a.requiresAck && <Badge tone={a.ackedAt ? 'gray' : 'amber'}>{a.ackedAt ? 'รับทราบแล้ว' : 'ต้องรับทราบ'}</Badge>}
                <span>
                  {thaiDate(a.publishedAt.slice(0, 10))} · {a.author}
                </span>
                {writer && (
                  <span className="ml-auto flex gap-1">
                    <Button size="sm" variant="ghost" aria-label="แก้ไขประกาศ" onClick={() => { setError(null); setDraft({ id: a.id, title: a.title, body: a.body, requiresAck: a.requiresAck, pinned: a.pinned }); }}>
                      <Pencil className="h-3.5 w-3.5" />
                    </Button>
                    <Button size="sm" variant="ghost" className="text-rose-600" aria-label="ลบประกาศ" onClick={() => window.confirm(`ลบประกาศ “${a.title}”?`) && remove.mutate(a.id)}>
                      <Trash2 className="h-3.5 w-3.5" />
                    </Button>
                  </span>
                )}
              </div>
              <h2 className="mt-2 text-lg font-semibold tracking-tight text-gray-900">{a.title}</h2>
              {/* Plain text only: React escapes it, line breaks preserved. */}
              <p className="mt-2 text-[14px] leading-relaxed whitespace-pre-line text-gray-700">{a.body}</p>
              <div className="mt-4 flex flex-wrap items-center gap-4">
                {a.requiresAck && !a.ackedAt && (
                  <Button variant="primary" size="sm" loading={ack.isPending && ack.variables === a.id} onClick={() => ack.mutate(a.id)}>
                    <CheckCheck className="h-4 w-4" /> รับทราบ
                  </Button>
                )}
                {a.requiresAck && a.ackedAt && (
                  <span className="inline-flex items-center gap-1 text-[12px] text-emerald-600">
                    <CheckCheck className="h-3.5 w-3.5" /> รับทราบเมื่อ {new Date(a.ackedAt).toLocaleString('th-TH', { dateStyle: 'medium', timeStyle: 'short' })}
                  </span>
                )}
                {writer && a.requiresAck && a.audience !== undefined && (
                  <span className="flex min-w-48 flex-1 items-center gap-2 text-[12px] text-gray-500">
                    <Progress className="flex-1" value={a.ackCount ?? 0} max={a.audience} />
                    รับทราบ {a.ackCount}/{a.audience} คน
                  </span>
                )}
              </div>
            </li>
          ))}
        </ol>
      )}

      <Dialog
        open={!!draft}
        onClose={() => setDraft(null)}
        title={draft?.id ? 'แก้ไขประกาศ' : 'ประกาศใหม่'}
        footer={
          <>
            <Button variant="ghost" onClick={() => setDraft(null)}>ยกเลิก</Button>
            <Button variant="primary" loading={save.isPending} disabled={!draft?.title.trim() || !draft?.body.trim()} onClick={() => draft && save.mutate(draft)}>
              เผยแพร่
            </Button>
          </>
        }
      >
        {draft && (
          <>
            <Field label="หัวข้อ">
              <input className={inputClass} maxLength={200} value={draft.title} onChange={(e) => setDraft({ ...draft, title: e.target.value })} />
            </Field>
            <Field label="เนื้อหา" hint="ข้อความธรรมดา ขึ้นบรรทัดใหม่ได้">
              <textarea className={inputClass} rows={8} maxLength={20000} value={draft.body} onChange={(e) => setDraft({ ...draft, body: e.target.value })} />
            </Field>
            <label className="flex items-center gap-2 text-[13px]">
              <input type="checkbox" checked={draft.requiresAck} onChange={(e) => setDraft({ ...draft, requiresAck: e.target.checked })} /> พนักงานต้องกด “รับทราบ”
            </label>
            <label className="flex items-center gap-2 text-[13px]">
              <input type="checkbox" checked={draft.pinned} onChange={(e) => setDraft({ ...draft, pinned: e.target.checked })} /> ปักหมุดไว้บนสุด
            </label>
            {error && <Alert tone="error">{error}</Alert>}
          </>
        )}
      </Dialog>
    </div>
  );
}
