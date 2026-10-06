'use client';

import { useQuery } from '@tanstack/react-query';
import { KeyRound } from 'lucide-react';
import Link from 'next/link';
import { useState } from 'react';
import { Badge, Card, Loading } from '@/components/ui';
import { api } from '@/lib/api';
import { thaiDateShort } from '@/lib/format';
import { type AssetSeat, STATE_META, stateText } from '@/lib/licenses';

/** Licences span years: "9 ก.ค. 70". */
const d = (iso: string) => `${thaiDateShort(iso)} ${String((Number(iso.slice(0, 4)) + 543) % 100).padStart(2, '0')}`;

/** "เครื่องนี้ใช้อะไรอยู่" — current licence seats of one machine, history on demand. */
export function AssetSoftware({ code }: { code: string }) {
  const q = useQuery({ queryKey: ['asset-licenses', code], queryFn: () => api<AssetSeat[]>(`/assets/${encodeURIComponent(code)}/licenses`) });
  const [history, setHistory] = useState(false);
  const current = q.data?.filter((s) => !s.endDate) ?? [];
  const past = q.data?.filter((s) => s.endDate) ?? [];

  return (
    <Card
      title={<span className="flex items-center gap-2"><KeyRound className="h-4 w-4 text-brand-600" /> ซอฟต์แวร์และไลเซนส์</span>}
      bodyClassName="px-5 py-3"
      actions={<Link href="/it-assets?tab=licenses" className="text-[12px] font-medium text-brand-600 hover:underline">จัดการ</Link>}
    >
      {q.isLoading ? (
        <Loading rows={2} />
      ) : current.length === 0 ? (
        <p className="text-[13px] text-gray-500">ยังไม่มีซอฟต์แวร์ที่บันทึกไว้ — เพิ่มเครื่องนี้เข้าไลเซนส์ได้ที่แท็บ “ซอฟต์แวร์และไลเซนส์”</p>
      ) : (
        <ul className="divide-y divide-gray-100 text-[13px]">
          {current.map((s) => (
            <li key={s.id} className="py-2">
              <div className="flex items-center justify-between gap-2">
                <span className="font-medium text-gray-900">{s.software.name}</span>
                <Badge tone={STATE_META[s.state].tone}>{stateText(s)}</Badge>
              </div>
              <p className="text-[12px] text-gray-500">
                {s.license}
                {s.installedOn ? ` · ติดตั้ง ${d(s.installedOn)}` : ''}
                {s.seatLabel ? ` · ชื่อในระบบ: ${s.seatLabel}` : ''}
              </p>
            </li>
          ))}
        </ul>
      )}
      {past.length > 0 && (
        <div className="mt-2">
          <button type="button" className="text-[12px] text-brand-700" onClick={() => setHistory((v) => !v)}>
            {history ? 'ซ่อน' : 'ดู'}ประวัติ ({past.length})
          </button>
          {history && (
            <ul className="mt-1 space-y-1 text-[12px] text-gray-500">
              {past.map((s) => (
                <li key={s.id}>
                  {s.software.name} · {s.license} · {d(s.startDate)} – {s.endDate && d(s.endDate)}
                </li>
              ))}
            </ul>
          )}
        </div>
      )}
    </Card>
  );
}
