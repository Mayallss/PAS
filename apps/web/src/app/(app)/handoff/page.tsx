'use client';

import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { ArrowLeft, ArrowRight, CalendarDays, Copy, FileText, Hash, Inbox, Link2, QrCode, RefreshCw, Search, X } from 'lucide-react';
import { useRouter, useSearchParams } from 'next/navigation';
import QRCode from 'qrcode';
import { Suspense, useDeferredValue, useEffect, useMemo, useState } from 'react';
import { toast } from 'sonner';
import { ItemDetails, SignForm, StatusPill } from '@/components/handoff';
import { Alert, Button, Dialog, Empty, Loading, PageHeader } from '@/components/ui';
import { ApiError, api, errorMessage } from '@/lib/api';
import { IntegrationHint } from '@/components/integration-hint';
import type { HandoffDetail, HandoffItem, HandoffList, SaveResult } from '@/lib/handoffs';

export default function HandoffPage() {
  return (
    <Suspense fallback={<Loading rows={6} />}>
      <Handoff />
    </Suspense>
  );
}

/**
 * รับ–ส่งเอกสาร (ex-DELIPAS). Tickets are created and assigned on the monday board; here staff pick
 * one, collect the signature (on this device or the signer's own phone via a one-hour link) and the
 * outcome is written back to monday.
 */
function Handoff() {
  const params = useSearchParams();
  const router = useRouter();
  const id = params.get('item');
  const tab = params.get('tab');
  const go = (q: Record<string, string | null>) => {
    const next = new URLSearchParams(params.toString());
    for (const [k, v] of Object.entries(q)) v ? next.set(k, v) : next.delete(k);
    const s = next.toString();
    return s ? `/handoff?${s}` : '/handoff';
  };
  return id && /^\d{1,20}$/.test(id) ? (
    <Detail id={id} onBack={() => router.push(go({ item: null }))} />
  ) : (
    <List tab={tab} onTab={(t) => router.replace(go({ tab: t }), { scroll: false })} onOpen={(i) => router.push(go({ item: i }))} />
  );
}

/** Case-insensitive highlight of the search term. */
function Mark({ text, term }: { text: string; term: string }) {
  if (!term || !text) return <>{text}</>;
  const parts: React.ReactNode[] = [];
  const hay = text.toLowerCase();
  const needle = term.toLowerCase();
  let from = 0;
  let at = hay.indexOf(needle);
  while (at !== -1) {
    if (at > from) parts.push(text.slice(from, at));
    parts.push(
      <mark key={at} className="rounded bg-amber-100 px-0.5 text-inherit">
        {text.slice(at, at + needle.length)}
      </mark>,
    );
    from = at + needle.length;
    at = hay.indexOf(needle, from);
  }
  if (from < text.length) parts.push(text.slice(from));
  return <>{parts}</>;
}

function List({ tab, onTab, onOpen }: { tab: string | null; onTab: (t: string) => void; onOpen: (id: string) => void }) {
  const qc = useQueryClient();
  const list = useQuery({ queryKey: ['handoffs'], queryFn: () => api<HandoffList>('/handoffs'), staleTime: 30_000 });
  const [refreshing, setRefreshing] = useState(false);
  const [search, setSearch] = useState('');
  const term = useDeferredValue(search).trim();

  async function refresh() {
    setRefreshing(true);
    try {
      qc.setQueryData(['handoffs'], await api<HandoffList>('/handoffs', { query: { fresh: 1 } }));
    } catch (e) {
      toast.error(errorMessage(e));
    } finally {
      setRefreshing(false);
    }
  }

  const groups = list.data?.groups ?? [];
  const current = groups.find((g) => g.key === tab) ?? groups[0];
  const visible = useMemo(() => {
    const items = current?.items ?? [];
    const q = term.toLowerCase();
    if (!q) return items;
    return items.filter((i) => [i.customer, i.id, i.date, i.name, i.type, i.period, i.status].join(' ').toLowerCase().includes(q));
  }, [current, term]);

  return (
    <div>
      <PageHeader
        title="รับ–ส่งเอกสาร"
        description="เลือกรายการจากบอร์ด monday แล้วเก็บลายเซ็นผู้รับ/ผู้ส่ง — ผลจะบันทึกกลับไปที่ monday"
        actions={
          <Button onClick={refresh} loading={refreshing} disabled={list.isLoading}>
            {!refreshing && <RefreshCw className="h-4 w-4" aria-hidden />} โหลดใหม่จาก monday
          </Button>
        }
      />
      <IntegrationHint integration="monday" className="mb-4" />
      {list.isError && !(list.error instanceof ApiError && list.error.code === 'NOT_CONFIGURED') && (
        <div className="mb-4">
          <Alert tone="error">{errorMessage(list.error)}</Alert>
        </div>
      )}
      {list.isLoading ? (
        <Loading rows={6} />
      ) : (
        groups.length > 0 && (
          <>
            <div className="mb-3 flex flex-col gap-3 lg:flex-row lg:items-center lg:justify-between">
              <div className="-mx-1 flex gap-1 overflow-x-auto px-1 pb-1" role="tablist" aria-label="ตารางในบอร์ด">
                {groups.map((g) => {
                  const on = g.key === current?.key;
                  return (
                    <button
                      key={g.key}
                      type="button"
                      role="tab"
                      aria-selected={on}
                      onClick={() => onTab(g.key)}
                      className={`inline-flex shrink-0 items-center gap-1.5 rounded-lg px-3 py-1.5 text-[13px] font-medium whitespace-nowrap transition ${
                        on ? 'bg-brand-600 text-white shadow-sm' : 'bg-white text-gray-600 ring-1 ring-gray-200 ring-inset hover:bg-gray-50'
                      }`}
                    >
                      {g.title}
                      <span className={`rounded-full px-1.5 text-[11px] tabular-nums ${on ? 'bg-white/20' : 'bg-gray-100 text-gray-500'}`}>{g.items.length}</span>
                    </button>
                  );
                })}
              </div>
              <div className="relative lg:w-80">
                <Search className="pointer-events-none absolute top-1/2 left-3 h-4 w-4 -translate-y-1/2 text-gray-400" aria-hidden />
                <input
                  aria-label="ค้นหาในตารางที่เลือก"
                  placeholder="ค้นหาบริษัท เลขที่ วันที่ หรือสถานะ"
                  value={search}
                  onChange={(e) => setSearch(e.target.value)}
                  className="block h-9 w-full rounded-lg border-0 bg-white pr-9 pl-9 text-sm shadow-card ring-1 ring-gray-200 ring-inset placeholder:text-gray-400 focus:ring-2 focus:ring-brand-600 focus:outline-none"
                />
                {search && (
                  <button type="button" onClick={() => setSearch('')} aria-label="ล้างคำค้นหา" className="absolute top-1/2 right-2 -translate-y-1/2 rounded p-1 text-gray-400 hover:bg-gray-100">
                    <X className="h-3.5 w-3.5" />
                  </button>
                )}
              </div>
            </div>
            <p className="mb-2 text-[12px] text-gray-500">
              <b className="font-medium text-gray-700">
                {visible.length} จาก {current?.items.length ?? 0} รายการ
              </b>
              {term && <> · ตรงกับ “{term}”</>} · สูงสุด 30 รายการล่าสุดต่อตาราง เรียงตามวันที่ดำเนินการ
            </p>
            {visible.length ? (
              <ul className="grid gap-2 md:grid-cols-2">
                {visible.map((i, n) => (
                  <li key={i.id} className="animate-fade-up" style={{ animationDelay: `${Math.min(n, 9) * 25}ms` }}>
                    <ItemCard item={i} term={term} onOpen={() => onOpen(i.id)} />
                  </li>
                ))}
              </ul>
            ) : (
              <Empty icon={<Inbox className="h-6 w-6" />} title={term ? `ไม่พบรายการที่ตรงกับ “${term}”` : 'ไม่มีรายการในตารางนี้'}>
                {term && (
                  <Button size="sm" onClick={() => setSearch('')}>
                    <X className="h-3.5 w-3.5" /> ล้างคำค้นหา
                  </Button>
                )}
              </Empty>
            )}
          </>
        )
      )}
    </div>
  );
}

function ItemCard({ item: i, term, onOpen }: { item: HandoffItem; term: string; onOpen: () => void }) {
  return (
    <button
      type="button"
      onClick={onOpen}
      className="group flex w-full items-center gap-3 rounded-xl bg-white p-3.5 text-left shadow-card ring-1 ring-gray-200/80 transition hover:-translate-y-px hover:ring-brand-300 focus-visible:ring-2 focus-visible:ring-brand-600 focus-visible:outline-none"
    >
      <span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-lg bg-brand-50 text-brand-600">
        <FileText className="h-5 w-5" aria-hidden />
      </span>
      <span className="min-w-0 flex-1 space-y-0.5">
        <span className="block truncate text-sm font-semibold text-gray-900">
          <Mark text={i.customer} term={term} />
        </span>
        <span className="flex flex-wrap items-center gap-x-2 text-[12px] text-gray-500">
          <span className="inline-flex items-center gap-0.5">
            <Hash className="h-3 w-3" aria-hidden />
            <Mark text={i.id} term={term} />
          </span>
          <span>{i.type ? <Mark text={i.type} term={term} /> : 'ไม่ระบุประเภท'}</span>
          <span className="inline-flex items-center gap-1">
            <CalendarDays className="h-3 w-3" aria-hidden />
            <Mark text={i.date} term={term} />
            {i.period && (
              <>
                {' · '}
                <Mark text={i.period} term={term} />
              </>
            )}
          </span>
        </span>
        <span className="block pt-1">
          <StatusPill status={i.status}>{i.status ? <Mark text={i.status} term={term} /> : undefined}</StatusPill>
        </span>
      </span>
      <ArrowRight className="h-4 w-4 shrink-0 text-gray-300 transition group-hover:translate-x-0.5 group-hover:text-brand-500" aria-hidden />
    </button>
  );
}

function Detail({ id, onBack }: { id: string; onBack: () => void }) {
  const qc = useQueryClient();
  const detail = useQuery({
    queryKey: ['handoff', id],
    queryFn: () => api<HandoffDetail>(`/handoffs/${id}`),
    // The save token is bound to what was seen when opening; refetch only on purpose.
    refetchOnWindowFocus: false,
    staleTime: Infinity,
    gcTime: 0,
  });
  const [status, setStatus] = useState<string | undefined>();
  useEffect(() => {
    window.scrollTo({ top: 0 });
  }, [id]);
  const [sharing, setSharing] = useState(false);
  const share = useMutation({
    mutationFn: () => api<{ url: string; expiresAt: string }>(`/handoffs/${id}/share`, { method: 'POST' }),
    onSuccess: () => setSharing(true),
    onError: (e) => toast.error(errorMessage(e)),
  });

  function saved(next: string) {
    setStatus(next);
    qc.setQueryData<HandoffList>(['handoffs'], (old) => old && { ...old, groups: old.groups.map((g) => ({ ...g, items: g.items.map((i) => (i.id === id ? { ...i, status: next } : i)) })) });
    void qc.invalidateQueries({ queryKey: ['handoffs'] });
  }

  return (
    <div>
      <div className="mb-4 flex flex-wrap items-center gap-2">
        <Button variant="ghost" onClick={onBack}>
          <ArrowLeft className="h-4 w-4" aria-hidden /> กลับรายการเอกสาร
        </Button>
        {detail.data && !status && (
          <Button className="ml-auto" onClick={() => share.mutate()} loading={share.isPending}>
            {!share.isPending && <Link2 className="h-4 w-4" aria-hidden />} ลิงก์ให้ผู้เซ็นบนมือถือ
          </Button>
        )}
      </div>
      {detail.isLoading && <Loading rows={6} />}
      {detail.isError && (
        <div className="space-y-3">
          <Alert tone="error">{errorMessage(detail.error)}</Alert>
          <Button onClick={() => void detail.refetch()}>
            <RefreshCw className="h-4 w-4" aria-hidden /> ลองอีกครั้ง
          </Button>
        </div>
      )}
      {detail.data && (
        <>
          <PageHeader title="บันทึกผลรับ–ส่งเอกสาร" description={<span className="tabular-nums">รายการ {detail.data.item.id}</span>} />
          <div className="grid items-start gap-5 lg:grid-cols-[minmax(0,5fr)_minmax(0,7fr)]">
            <ItemDetails item={detail.data.item} status={status} />
            <SignForm
              key={detail.dataUpdatedAt}
              item={detail.data.item}
              context={detail.data.context}
              save={(body) => api<SaveResult>('/handoffs', { method: 'POST', body })}
              onReopen={() => void detail.refetch()}
              onSaved={saved}
              done={
                <Button variant="primary" onClick={onBack}>
                  กลับไปเลือกรายการ <ArrowRight className="h-4 w-4" aria-hidden />
                </Button>
              }
            />
          </div>
        </>
      )}
      {share.data && <ShareDialog open={sharing} onClose={() => setSharing(false)} url={share.data.url} expiresAt={share.data.expiresAt} />}
    </div>
  );
}

function ShareDialog({ open, onClose, url, expiresAt }: { open: boolean; onClose: () => void; url: string; expiresAt: string }) {
  const [qr, setQr] = useState('');
  useEffect(() => {
    void QRCode.toDataURL(url, { margin: 1, width: 320, errorCorrectionLevel: 'L' }).then(setQr);
  }, [url]);
  const until = new Date(expiresAt).toLocaleTimeString('th-TH', { hour: '2-digit', minute: '2-digit' });
  async function copy() {
    try {
      await navigator.clipboard.writeText(url);
      toast.success('คัดลอกลิงก์แล้ว');
    } catch {
      toast.error('คัดลอกไม่ได้ — กดค้างที่ลิงก์เพื่อคัดลอกเอง');
    }
  }
  return (
    <Dialog
      open={open}
      onClose={onClose}
      title="ลิงก์ให้ผู้เซ็น"
      footer={
        <>
          <Button onClick={onClose}>ปิด</Button>
          <Button variant="primary" onClick={copy}>
            <Copy className="h-4 w-4" aria-hidden /> คัดลอกลิงก์
          </Button>
        </>
      }
    >
      <div className="space-y-4">
        <p className="text-[13px] text-gray-600">
          ให้ผู้รับ/ผู้ส่งสแกน QR หรือเปิดลิงก์บนมือถือของตัวเองเพื่อเซ็น — ไม่ต้องเข้าสู่ระบบ ใช้ได้เฉพาะรายการนี้ ถึงเวลา <b className="text-gray-900">{until} น.</b>
        </p>
        <div className="flex justify-center">
          {qr ? (
            // eslint-disable-next-line @next/next/no-img-element
            <img src={qr} alt="QR ลิงก์สำหรับเซ็น" width={220} height={220} className="rounded-lg ring-1 ring-gray-200" />
          ) : (
            <div className="flex h-[220px] w-[220px] items-center justify-center rounded-lg bg-gray-50 text-gray-300">
              <QrCode className="h-10 w-10" />
            </div>
          )}
        </div>
        <p className="rounded-lg bg-gray-50 px-3 py-2 font-mono text-[11px] break-all text-gray-500 select-all">{url}</p>
        <Alert tone="warning">ใครมีลิงก์นี้ก็เซ็นรายการนี้ได้ภายใน 1 ชั่วโมง ส่งให้เฉพาะผู้เกี่ยวข้อง</Alert>
      </div>
    </Dialog>
  );
}
