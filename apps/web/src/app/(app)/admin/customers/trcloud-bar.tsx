'use client';

/**
 * TRCLOUD is the customer master. Contacts sync into customers on their own (server timer, and here when the page
 * opens and the last sync is stale): new contacts become customers, customers not in TRCLOUD are removed (internal
 * ones kept), ambiguous contacts wait to be chosen on the revenue tab.
 */

import { RefreshCw } from 'lucide-react';
import Link from 'next/link';
import { Button } from '@/components/ui';
import { errorMessage } from '@/lib/api';
import { syncedAt as when, useTrcloudSync } from '@/lib/trcloud';

export function TrcloudCustomersBar() {
  const { status, refresh } = useTrcloudSync();
  const enabled = !!status.data?.enabled;
  if (!enabled) return null;
  const last = status.data!.lastContactSync;

  return (
    <div className="flex flex-wrap items-center gap-x-4 gap-y-2 rounded-xl bg-white px-4 py-3 text-[13px] shadow-card ring-1 ring-gray-300/80">
      <div className="min-w-0 flex-1 space-y-0.5">
        <p className="font-medium text-gray-900">ลูกค้าซิงก์จาก TRCLOUD อัตโนมัติ — เพิ่ม/แก้/ลบลูกค้าที่ TRCLOUD แล้วระบบจะตามให้ เหลือแค่เปิด Activity ให้แต่ละราย · ลูกค้าที่ไม่มีใน TRCLOUD จะถูกเอาออก (ยกเว้นลูกค้าภายใน เช่น PAS)</p>
        <p className="text-gray-600">
          {refresh.isPending ? 'กำลังซิงก์…' : last ? `ซิงก์ล่าสุด ${when(last.at)}` : 'ยังไม่เคยซิงก์'}
          {refresh.isError && <span className="text-rose-700"> · ซิงก์ไม่สำเร็จ: {errorMessage(refresh.error)}</span>}
          {last && last.needsDecision > 0 && (
            <>
              {' · '}
              <Link href="/reports?tab=revenue" className="font-medium text-amber-800 underline underline-offset-2">
                มี {last.needsDecision} รายที่ชื่อคล้ายลูกค้าเดิม — เลือกเอง
              </Link>
            </>
          )}
        </p>
        {last && last.removalHeld > 0 && (
          <p className="text-amber-800">TRCLOUD ส่งรายชื่อมาขาดไป {last.removalHeld} ราย ซึ่งมากผิดปกติ — ระบบยังไม่ลบลูกค้าออก กรุณาตรวจใน TRCLOUD</p>
        )}
      </div>
      <Button size="sm" variant="ghost" onClick={() => refresh.mutate(true)} disabled={refresh.isPending}>
        <RefreshCw className={`h-4 w-4 ${refresh.isPending ? 'animate-spin' : ''}`} aria-hidden /> ซิงก์ตอนนี้
      </Button>
    </div>
  );
}
