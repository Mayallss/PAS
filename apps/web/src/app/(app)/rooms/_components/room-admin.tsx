'use client';

import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Pencil, Plus } from 'lucide-react';
import { useState } from 'react';
import { toast } from 'sonner';
import { Badge, Button, Dialog, Field, inputClass } from '@/components/ui';
import { api, errorMessage } from '@/lib/api';
import { type Room, ROOM_COLOR, roomColor } from '@/lib/rooms';

/** room.manage: rooms list + edit. The Google resource e-mail links a room to its Workspace room calendar. */
export function RoomAdmin({ onClose }: { onClose: () => void }) {
  const q = useQuery({ queryKey: ['rooms', 'all'], queryFn: () => api<Room[]>('/rooms', { query: { all: 1 } }) });
  const [editing, setEditing] = useState<Room | 'new' | null>(null);
  return (
    <Dialog
      open
      wide
      onClose={onClose}
      title="ห้องประชุม"
      footer={
        <Button variant="primary" onClick={() => setEditing('new')}>
          <Plus className="h-4 w-4" /> เพิ่มห้อง
        </Button>
      }
    >
      <ul className="divide-y divide-gray-100 rounded-lg ring-1 ring-gray-200">
        {q.data?.map((r) => (
          <li key={r.id} className={`flex items-center gap-3 px-3 py-2.5 text-[13px] ${r.isActive ? '' : 'opacity-60'}`}>
            <span className={`h-2.5 w-2.5 rounded-full ${roomColor(r.color)}`} />
            <div className="min-w-0 flex-1">
              <p className="font-medium text-gray-900">
                {r.name} {!r.isActive && <Badge>ปิดใช้งาน</Badge>}
              </p>
              <p className="truncate text-[12px] text-gray-500">
                {[r.location, r.capacity && `${r.capacity} คน`, r.features.join(', '), r.googleResourceEmail ? 'เชื่อมห้องใน Google แล้ว' : null].filter(Boolean).join(' · ')}
              </p>
            </div>
            <Button size="sm" variant="ghost" onClick={() => setEditing(r)}>
              <Pencil className="h-3.5 w-3.5" />
            </Button>
          </li>
        ))}
      </ul>
      {editing && <RoomDialog room={editing === 'new' ? null : editing} onClose={() => setEditing(null)} />}
    </Dialog>
  );
}

function RoomDialog({ room, onClose }: { room: Room | null; onClose: () => void }) {
  const qc = useQueryClient();
  const [f, setF] = useState({
    name: room?.name ?? '',
    location: room?.location ?? '',
    capacity: room?.capacity ? String(room.capacity) : '',
    features: room?.features.join(', ') ?? '',
    googleResourceEmail: room?.googleResourceEmail ?? '',
    color: room?.color ?? 'indigo',
    isActive: room?.isActive ?? true,
  });
  const set = (p: Partial<typeof f>) => setF((x) => ({ ...x, ...p }));
  const save = useMutation({
    mutationFn: () => {
      const body = {
        name: f.name,
        location: f.location || null,
        capacity: f.capacity ? Number(f.capacity) : null,
        features: f.features.split(',').map((s) => s.trim()).filter(Boolean),
        googleResourceEmail: f.googleResourceEmail || null,
        color: f.color,
        isActive: f.isActive,
      };
      return room ? api(`/rooms/${room.id}`, { method: 'PUT', body }) : api('/rooms', { method: 'POST', body });
    },
    onSuccess: () => {
      toast.success('บันทึกห้องแล้ว');
      void qc.invalidateQueries({ queryKey: ['rooms'] });
      onClose();
    },
    onError: (e) => toast.error(errorMessage(e)),
  });
  return (
    <Dialog
      open
      onClose={onClose}
      title={room ? `แก้ไข ${room.name}` : 'เพิ่มห้องประชุม'}
      footer={
        <>
          <Button onClick={onClose}>ยกเลิก</Button>
          <Button variant="primary" disabled={!f.name.trim()} loading={save.isPending} onClick={() => save.mutate()}>
            บันทึก
          </Button>
        </>
      }
    >
      <div className="grid gap-3 sm:grid-cols-2">
        <Field label="ชื่อห้อง">
          <input className={inputClass} value={f.name} onChange={(e) => set({ name: e.target.value })} />
        </Field>
        <Field label="ตำแหน่ง">
          <input className={inputClass} value={f.location} onChange={(e) => set({ location: e.target.value })} placeholder="ชั้น 2" />
        </Field>
        <Field label="ความจุ (คน)">
          <input type="number" min={1} className={inputClass} value={f.capacity} onChange={(e) => set({ capacity: e.target.value })} />
        </Field>
        <Field label="อุปกรณ์ (คั่นด้วยจุลภาค)">
          <input className={inputClass} value={f.features} onChange={(e) => set({ features: e.target.value })} placeholder="จอทีวี, กล้องประชุม" />
        </Field>
      </div>
      <Field label="อีเมลห้องใน Google Workspace (ไม่บังคับ)" hint="ได้จาก Admin console → Buildings and resources เช่น c_xxx@resource.calendar.google.com — ห้องจะรับ/ปฏิเสธการจองซ้อนใน Google เอง">
        <input className={inputClass} value={f.googleResourceEmail} onChange={(e) => set({ googleResourceEmail: e.target.value })} />
      </Field>
      <div className="flex items-center gap-4">
        <div className="flex gap-1.5">
          {Object.keys(ROOM_COLOR).map((c) => (
            <button key={c} type="button" aria-label={c} onClick={() => set({ color: c })} className={`h-6 w-6 rounded-full ${ROOM_COLOR[c]} ${f.color === c ? 'ring-2 ring-gray-900 ring-offset-2' : ''}`} />
          ))}
        </div>
        {room && (
          <label className="flex items-center gap-2 text-[13px] text-gray-700">
            <input type="checkbox" checked={f.isActive} onChange={(e) => set({ isActive: e.target.checked })} className="h-4 w-4 rounded border-gray-300" /> เปิดให้จอง
          </label>
        )}
      </div>
    </Dialog>
  );
}
