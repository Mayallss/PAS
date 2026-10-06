'use client';

import { useQuery, useQueryClient } from '@tanstack/react-query';
import { Plus, Wrench } from 'lucide-react';
import Link from 'next/link';
import { useRouter, useSearchParams } from 'next/navigation';
import { Suspense, useState } from 'react';
import { toast } from 'sonner';
import { Badge, Button, Loading, PageHeader } from '@/components/ui';
import { api } from '@/lib/api';
import { type ItRequest, type MyDevice, requestNo } from '@/lib/assets';
import { can, useSession } from '@/lib/session';
import { HolderMatch, type HolderSuggestions } from './_components/holder-match';
import { Licenses } from './_components/licenses';
import { MyDevicesPanel } from './_components/my-devices';
import { Register } from './_components/register';
import { RequestDialog } from './_components/request-form';
import { MyRequests, RequestQueue } from './_components/requests';

type Tab = 'devices' | 'licenses' | 'requests' | 'match' | 'mine';

export default function ItAssetsPage() {
  return (
    <Suspense fallback={<Loading rows={6} />}>
      <ItAssets />
    </Suspense>
  );
}

/**
 * Everyone: "เครื่องของฉัน" (own device, its history) + requests to IT.
 * IT/Admin (asset.read): the full register and the request queue as extra tabs.
 */
function ItAssets() {
  const me = useSession();
  const router = useRouter();
  const params = useSearchParams();
  const qc = useQueryClient();
  const isIt = can(me, 'asset.read');
  const tab: Tab = isIt ? ((params.get('tab') as Tab) ?? 'devices') : 'mine';
  const [reporting, setReporting] = useState<{ code?: string } | null>(null);

  const mine = useQuery({ queryKey: ['my-devices'], queryFn: () => api<MyDevice[]>('/assets/mine') });
  const queue = useQuery({ queryKey: ['it-requests', 'OPEN'], queryFn: () => api<ItRequest[]>('/it-requests', { query: { scope: 'OPEN' } }), enabled: isIt });
  const waiting = queue.data?.filter((r) => r.status === 'SUBMITTED').length ?? 0;
  const suggestions = useQuery({ queryKey: ['holder-suggestions'], queryFn: () => api<HolderSuggestions>('/assets/holder-suggestions'), enabled: can(me, 'asset.write') });
  const unlinked = suggestions.data?.rows.filter((r) => !r.vacant).length ?? 0;
  const devices = (mine.data ?? []).map((d) => ({ code: d.code, label: `${d.code} · ${[d.brand, d.model].filter(Boolean).join(' ') || d.category}` }));

  const setTab = (t: Tab) => router.replace(t === 'devices' ? '/it-assets' : `/it-assets?tab=${t}`, { scroll: false });

  return (
    <div>
      <PageHeader
        title={isIt ? 'IT Asset' : 'อุปกรณ์ IT ของฉัน'}
        description={isIt ? 'ทะเบียนอุปกรณ์ ใครถือเครื่องไหน ประวัติซ่อม/อัปเกรด และคำขอจากพนักงาน' : 'เครื่องที่คุณใช้อยู่ ประวัติการซ่อม และแจ้งปัญหาถึงฝ่าย IT'}
        actions={
          <>
            <Button variant={isIt ? 'secondary' : 'primary'} onClick={() => setReporting({})}>
              <Wrench className="h-4 w-4" /> แจ้งซ่อม / ขอบริการ
            </Button>
            {can(me, 'asset.write') && (
              <Link href="/it-assets/new" className="inline-flex h-9 items-center gap-2 rounded-lg bg-brand-600 px-3.5 text-sm font-medium text-white shadow-sm hover:bg-brand-700">
                <Plus className="h-4 w-4" /> ลงทะเบียนอุปกรณ์
              </Link>
            )}
          </>
        }
      />

      {isIt && (
        <div role="tablist" className="mb-4 inline-flex rounded-lg bg-gray-100 p-1">
          {(
            [
              ['devices', 'ทะเบียนอุปกรณ์'],
              ['licenses', 'ซอฟต์แวร์และไลเซนส์'],
              ['requests', 'คำขอจากพนักงาน'],
              ...(can(me, 'asset.write') && (unlinked > 0 || tab === 'match') ? [['match', 'จับคู่ผู้ใช้'] as [Tab, string]] : []),
              ['mine', 'เครื่องของฉัน'],
            ] as [Tab, string][]
          ).map(([k, label]) => (
            <button key={k} role="tab" type="button" aria-selected={tab === k} onClick={() => setTab(k)} className={`inline-flex h-8 items-center gap-1.5 rounded-md px-3 text-[13px] font-medium ${tab === k ? 'bg-white shadow-card' : 'text-gray-500'}`}>
              {label}
              {k === 'requests' && waiting > 0 && <Badge tone="rose">{waiting}</Badge>}
              {k === 'match' && unlinked > 0 && <Badge tone="amber">{unlinked}</Badge>}
            </button>
          ))}
        </div>
      )}

      {tab === 'devices' && <Register />}
      {tab === 'licenses' && <Licenses canWrite={can(me, 'asset.write')} />}
      {tab === 'requests' && <RequestQueue canHandle={can(me, 'asset.write')} />}
      {tab === 'match' && can(me, 'asset.write') && <HolderMatch />}
      {tab === 'mine' && (
        <div className="grid gap-4 xl:grid-cols-[minmax(0,1fr)_26rem]">
          {mine.isLoading ? <Loading rows={4} /> : <MyDevicesPanel devices={mine.data ?? []} onReport={(code) => setReporting({ code })} />}
          <MyRequests />
        </div>
      )}

      {reporting && (
        <RequestDialog
          devices={devices}
          fixedAssetCode={reporting.code}
          onClose={() => setReporting(null)}
          onDone={(r) => {
            setReporting(null);
            toast.success(`ส่งคำขอ ${requestNo(r.number)} แล้ว — IT จะติดต่อกลับ`);
            void qc.invalidateQueries({ queryKey: ['it-requests'] });
            void qc.invalidateQueries({ queryKey: ['my-devices'] });
            if (isIt && tab === 'devices') setTab('mine');
          }}
        />
      )}
    </div>
  );
}
