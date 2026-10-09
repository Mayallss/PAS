'use client';

import { useQuery } from '@tanstack/react-query';
import { Clock3, LinkIcon, ShieldCheck } from 'lucide-react';
import { useSearchParams } from 'next/navigation';
import { Suspense } from 'react';
import { PasLogo } from '@/components/brand';
import { ItemDetails, SignForm } from '@/components/handoff';
import { Alert, Loading } from '@/components/ui';
import { ApiError, errorMessage } from '@/lib/api';
import { type HandoffDetail, publicApi, type SaveResult } from '@/lib/handoffs';

export default function SignPage() {
  return (
    <div className="min-h-screen bg-canvas">
      <header className="sticky top-0 z-10 border-b border-gray-300 bg-white/95 backdrop-blur">
        <div className="mx-auto flex max-w-5xl items-center gap-3 px-4 py-2.5">
          <PasLogo className="h-8 w-auto shrink-0" priority />
          <div className="min-w-0 leading-tight">
            <p className="text-[13px] font-semibold text-gray-900">รับ–ส่งเอกสาร</p>
            <p className="text-[12px] text-gray-600">PAS Accounting</p>
          </div>
          <span className="ml-auto inline-flex shrink-0 items-center gap-1 rounded-full bg-emerald-50 px-2 py-0.5 text-[12px] font-medium text-emerald-800 ring-1 ring-emerald-200 ring-inset">
            <ShieldCheck className="h-3.5 w-3.5" aria-hidden /> ลิงก์เฉพาะรายการ
          </span>
        </div>
      </header>
      <main className="mx-auto max-w-5xl px-3 py-5 sm:px-4">
        <Suspense fallback={<Loading rows={6} />}>
          <Sign />
        </Suspense>
      </main>
    </div>
  );
}

/**
 * Public by exception: the holder of a share link signs THAT ticket only, without logging in.
 * The API checks the signed link (item + expiry) on every call.
 */
function Sign() {
  const params = useSearchParams();
  const item = params.get('item') ?? '';
  const share = params.get('share') ?? '';
  const valid = /^\d{1,20}$/.test(item) && share.length >= 10;
  const detail = useQuery({
    queryKey: ['public-handoff', item, share],
    queryFn: () => publicApi<HandoffDetail>(`/handoffs/${item}?share=${encodeURIComponent(share)}`),
    enabled: valid,
    retry: (n, e) => !(e instanceof ApiError && e.status < 500) && n < 2,
    refetchOnWindowFocus: false,
    staleTime: Infinity,
  });

  if (!valid) return <Invalid message="ลิงก์ไม่ครบถ้วน กรุณาขอลิงก์ใหม่จากเจ้าหน้าที่" />;
  if (detail.isLoading) return <Loading rows={6} />;
  if (detail.isError) {
    const e = detail.error;
    const expired = e instanceof ApiError && (e.code === 'TOKEN_EXPIRED' || e.code === 'LINK_MISMATCH');
    return <Invalid message={expired ? 'ลิงก์นี้หมดอายุหรือไม่ถูกต้อง กรุณาขอลิงก์ใหม่จากเจ้าหน้าที่' : errorMessage(e)} />;
  }
  const d = detail.data!;
  const until = d.expiresAt ? new Date(d.expiresAt).toLocaleTimeString('th-TH', { hour: '2-digit', minute: '2-digit' }) : null;
  return (
    <div className="space-y-4">
      <div>
        <h1 className="text-xl font-semibold tracking-tight text-gray-900">บันทึกผลรับ–ส่งเอกสาร</h1>
        {until && (
          <p className="mt-1 flex items-center gap-1 text-[13px] text-gray-600">
            <Clock3 className="h-3.5 w-3.5" aria-hidden /> ลิงก์ใช้ได้ถึง {until} น.
          </p>
        )}
      </div>
      {/* grid-cols-1 = minmax(0,1fr): long monday text wraps instead of widening the signer's phone screen. */}
      <div className="grid grid-cols-1 items-start gap-4 lg:grid-cols-[minmax(0,5fr)_minmax(0,7fr)]">
        <ItemDetails item={d.item} />
        <SignForm
          key={detail.dataUpdatedAt}
          item={d.item}
          context={d.context}
          save={(body) => publicApi<SaveResult>('/handoffs', { method: 'POST', body })}
          onReopen={() => void detail.refetch()}
          done={<p className="text-[13px] text-gray-600">ขอบคุณครับ/ค่ะ ปิดหน้านี้ได้เลย</p>}
        />
      </div>
    </div>
  );
}

function Invalid({ message }: { message: string }) {
  return (
    <div className="mx-auto max-w-md space-y-3 py-16 text-center">
      <span className="mx-auto flex h-12 w-12 items-center justify-center rounded-full bg-white text-gray-500 ring-1 ring-gray-300">
        <LinkIcon className="h-6 w-6" aria-hidden />
      </span>
      <Alert tone="warning">{message}</Alert>
    </div>
  );
}
