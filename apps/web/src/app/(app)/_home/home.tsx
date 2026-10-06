'use client';

import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { ArrowRight, ArrowUpRight, CalendarDays, CheckCheck, ChevronRight, Clock3, Laptop, Megaphone, Pin, Sparkles } from 'lucide-react';
import Image from 'next/image';
import Link from 'next/link';
import { toast } from 'sonner';
import { AppIcon } from '@/components/brand';
import { attentionText } from '@/components/notification-bell';
import { Badge } from '@/components/ui';
import { api, errorMessage } from '@/lib/api';
import { KIND_LABEL, type MyDevice, STATE_META } from '@/lib/assets';
import { hours, STATUS_STYLE, THAI_WEEKDAY_LONG, THAI_WEEKDAY_SHORT, thaiDate, thaiDateShort } from '@/lib/format';
import { can, useSession } from '@/lib/session';
import type { AppLink, HomeData } from '@/lib/types';
import { useCountUp, useMounted } from './motion';

const fade = (i: number) => ({ className: 'animate-fade-up stagger', style: { '--i': i } as React.CSSProperties });

function greeting(now = new Date()) {
  const h = Number(new Intl.DateTimeFormat('en-GB', { timeZone: 'Asia/Bangkok', hour: 'numeric', hour12: false }).format(now));
  if (h < 11) return 'อรุณสวัสดิ์';
  if (h < 13) return 'สวัสดีตอนเที่ยง';
  if (h < 17) return 'สวัสดีตอนบ่าย';
  return 'สวัสดีตอนเย็น';
}

export function Home({ initial }: { initial: HomeData }) {
  // Server-rendered first paint; refreshed in the background when the user comes back to the tab.
  const { data } = useQuery({ queryKey: ['home'], queryFn: () => api<HomeData>('/home'), initialData: initial, staleTime: 30_000, refetchOnWindowFocus: true });
  const weekday = new Date(`${data.today}T00:00:00Z`).getUTCDay() || 7;

  return (
    <div className="space-y-6">
      <Hero data={data} weekday={weekday} />
      <div className="grid gap-6 lg:grid-cols-3">
        <div className="space-y-6 lg:col-span-2">
          <Attention data={data} />
          <WeekChart data={data} />
        </div>
        <div className="space-y-6">
          <Announcements data={data} />
          <MyDevices />
        </div>
      </div>
      <Launcher apps={data.apps.filter((a) => !a.isAdmin)} />
    </div>
  );
}

// ---------------------------------------------------------------------------

function Hero({ data, weekday }: { data: HomeData; weekday: number }) {
  const name = data.profile.nickname || data.profile.fullName.split(' ')[0];
  const todayRow = data.week.days.find((d) => d.date === data.today);
  return (
    <section className="relative isolate overflow-hidden rounded-3xl bg-brand-900 text-white shadow-pop">
      <Image
        src="/brand/office.webp"
        alt=""
        fill
        priority
        sizes="(min-width: 1024px) 1200px, 100vw"
        className="-z-20 animate-ken-burns object-cover object-[center_30%]"
      />
      {/* Phones: photo shows at the top, text sits on solid brand colour below. Desktop: photo on the right. */}
      <div className="absolute inset-0 -z-10 bg-gradient-to-t from-brand-900 from-45% via-brand-900/85 to-brand-900/20 lg:bg-gradient-to-r lg:from-brand-900 lg:from-0% lg:via-brand-900/85 lg:to-brand-800/25" aria-hidden />
      {/* The logo's green & yellow swoosh, drawn in on load */}
      <svg className="absolute -bottom-6 left-0 -z-10 hidden h-40 w-[70%] animate-swoosh opacity-90 lg:block" viewBox="0 0 600 160" fill="none" preserveAspectRatio="none" aria-hidden>
        <path d="M0 150 C 180 90, 360 40, 600 10 L 600 22 C 380 60, 200 110, 40 160 Z" fill="#0e9747" />
        <path d="M60 160 C 240 110, 420 60, 600 34 L 600 42 C 430 72, 260 118, 110 160 Z" fill="#fccb0f" />
      </svg>

      <div className="grid gap-8 p-6 pt-28 sm:p-8 sm:pt-32 lg:grid-cols-[1fr_auto] lg:items-center lg:p-10">
        <div className="max-w-xl">
          <p {...fade(0)} className="animate-fade-up stagger text-[13px] font-medium text-white/70">
            วัน{THAI_WEEKDAY_LONG[weekday]}ที่ {thaiDate(data.today)}
          </p>
          <h1 {...fade(1)} className="animate-fade-up stagger mt-2 text-3xl font-semibold tracking-tight sm:text-4xl" suppressHydrationWarning>
            {greeting()}, {name}
          </h1>
          <p {...fade(2)} className="animate-fade-up stagger mt-2 text-[15px] text-white/75">
            {[data.profile.orgUnit, data.profile.level].filter(Boolean).join(' · ') || 'PAS — Account as a Consult'}
          </p>
          <div {...fade(3)} className="animate-fade-up stagger mt-6 flex flex-wrap gap-3">
            <Link
              href="/time-report"
              className="group inline-flex h-11 items-center gap-2 rounded-xl bg-pas-yellow px-5 text-sm font-semibold text-gray-900 shadow-lg shadow-black/20 transition hover:-translate-y-0.5 hover:shadow-xl"
            >
              <Clock3 className="h-4 w-4" />
              {todayRow && todayRow.requiredMinutes > todayRow.totalMinutes ? 'บันทึกเวลาวันนี้' : 'เปิดตารางเวลา'}
              <ArrowRight className="h-4 w-4 transition group-hover:translate-x-0.5" />
            </Link>
            <Link href="/time-report?view=month" className="inline-flex h-11 items-center gap-2 rounded-xl bg-white/10 px-5 text-sm font-medium text-white ring-1 ring-white/25 backdrop-blur transition hover:bg-white/20">
              <CalendarDays className="h-4 w-4" /> ปฏิทินเดือนนี้
            </Link>
          </div>
        </div>
        <div {...fade(2)} className="animate-fade-up stagger">
          <WeekRing data={data} />
        </div>
      </div>
    </section>
  );
}

function WeekRing({ data }: { data: HomeData }) {
  const mounted = useMounted();
  const { recordedMinutes: rec, requiredMinutes: req } = data.week;
  const pct = req > 0 ? Math.min(1, rec / req) : rec > 0 ? 1 : 0;
  const shown = useCountUp(rec / 60);
  const R = 52;
  const C = 2 * Math.PI * R;
  return (
    <div className="flex items-center gap-5 rounded-2xl bg-white/10 p-5 ring-1 ring-white/20 backdrop-blur-md">
      <div className="relative h-32 w-32 shrink-0">
        <svg viewBox="0 0 120 120" className="h-full w-full -rotate-90" aria-hidden>
          <circle cx="60" cy="60" r={R} stroke="rgb(255 255 255 / 0.15)" strokeWidth="10" fill="none" />
          <circle
            cx="60"
            cy="60"
            r={R}
            stroke={rec > req && req > 0 ? '#fb7185' : '#fccb0f'}
            strokeWidth="10"
            strokeLinecap="round"
            fill="none"
            strokeDasharray={C}
            strokeDashoffset={mounted ? C * (1 - pct) : C}
            style={{ transition: 'stroke-dashoffset 1.2s cubic-bezier(0.22, 1, 0.36, 1)' }}
          />
        </svg>
        <div className="absolute inset-0 grid place-items-center text-center" role="img" aria-label={`สัปดาห์นี้ ${hours(rec) || 0} จาก ${hours(req) || 0} ชั่วโมง`}>
          <div>
            <p className="text-2xl font-semibold tabular-nums">{Math.round(shown * 10) / 10}</p>
            <p className="text-[11px] text-white/70">/ {hours(req) || 0} ชม.</p>
          </div>
        </div>
      </div>
      <div>
        <p className="text-[13px] font-medium">สัปดาห์นี้</p>
        <div className="mt-3 flex gap-1.5">
          {data.week.days.map((d) => (
            <div key={d.date} className="flex flex-col items-center gap-1" title={`${thaiDateShort(d.date)} · ${hours(d.totalMinutes) || 0}/${hours(d.requiredMinutes) || 0} ชม.`}>
              <span
                className={`h-6 w-2 rounded-full ${
                  d.requiredMinutes === 0 && !d.totalMinutes ? 'bg-white/15' : d.date > data.today && !d.totalMinutes ? 'bg-white/25' : STATUS_STYLE[d.status].bar
                } ${d.date === data.today ? 'ring-2 ring-white/70 ring-offset-1 ring-offset-brand-800' : ''}`}
              />
              <span className="text-[10px] text-white/60">{THAI_WEEKDAY_SHORT[d.weekday].replace('.', '')}</span>
            </div>
          ))}
        </div>
        <p className="mt-3 text-[12px] text-white/70">
          เดือนนี้ครบ {data.monthToDate.completeDays}/{data.monthToDate.dueDays} วัน
        </p>
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------

function Attention({ data }: { data: HomeData }) {
  return (
    <section {...fade(3)} className="animate-fade-up stagger rounded-2xl bg-white shadow-card ring-1 ring-gray-200/80">
      <header className="flex items-center justify-between px-5 pt-5 pb-3">
        <h2 className="text-[15px] font-semibold">สิ่งที่ต้องทำ</h2>
        {data.attention.length > 0 && <Badge tone="amber">{data.attention.length} รายการ</Badge>}
      </header>
      {data.attention.length === 0 ? (
        <div className="flex items-center gap-4 px-5 pb-6">
          <span className="grid h-12 w-12 shrink-0 place-items-center rounded-2xl bg-emerald-50 text-emerald-600">
            <CheckCheck className="h-6 w-6" />
          </span>
          <div>
            <p className="text-sm font-medium">เรียบร้อยทั้งหมด</p>
            <p className="text-[13px] text-gray-500">กรอกเวลาครบและรับทราบประกาศแล้ว — เยี่ยมมาก</p>
          </div>
        </div>
      ) : (
        <ul className="divide-y divide-gray-100 pb-2">
          {data.attention.slice(0, 6).map((i, n) => {
            const t = attentionText(i);
            return (
              <li key={i.id} {...fade(4 + n)}>
                <Link href={i.href} className="group flex items-center gap-3 px-5 py-3 transition hover:bg-gray-50">
                  <span className={`grid h-9 w-9 shrink-0 place-items-center rounded-xl ${t.tone}`}>
                    <t.icon className="h-4 w-4" />
                  </span>
                  <span className="min-w-0 flex-1">
                    <span className="block truncate text-[13px] font-medium text-gray-900">{t.title}</span>
                    <span className="block truncate text-[12px] text-gray-500">{t.detail}</span>
                  </span>
                  <ChevronRight className="h-4 w-4 text-gray-300 transition group-hover:translate-x-0.5 group-hover:text-gray-500" />
                </Link>
              </li>
            );
          })}
          {data.attention.length > 6 && <li className="px-5 py-2 text-[12px] text-gray-500">และอีก {data.attention.length - 6} รายการ — ดูทั้งหมดที่กระดิ่งแจ้งเตือน</li>}
        </ul>
      )}
    </section>
  );
}

function WeekChart({ data }: { data: HomeData }) {
  const mounted = useMounted();
  const max = Math.max(60, ...data.week.days.map((d) => Math.max(d.totalMinutes, d.requiredMinutes)));
  const mtdHours = useCountUp(data.monthToDate.recordedMinutes / 60);
  return (
    <section {...fade(5)} className="animate-fade-up stagger rounded-2xl bg-white p-5 shadow-card ring-1 ring-gray-200/80">
      <header className="mb-5 flex flex-wrap items-end justify-between gap-2">
        <div>
          <h2 className="text-[15px] font-semibold">ชั่วโมงสัปดาห์นี้</h2>
          <p className="text-[12px] text-gray-500">เส้นประ = ชั่วโมงที่ต้องกรอกตามตารางงานของคุณ</p>
        </div>
        <div className="text-right">
          <p className="text-[12px] text-gray-500">เดือนนี้ถึงวันนี้</p>
          <p className="text-lg font-semibold tabular-nums">
            {Math.round(mtdHours * 10) / 10} <span className="text-[13px] font-normal text-gray-400">/ {hours(data.monthToDate.requiredMinutes) || 0} ชม.</span>
          </p>
        </div>
      </header>
      <div className="flex h-40 items-end gap-2 sm:gap-4" role="list">
        {data.week.days.map((d, i) => {
          const s = STATUS_STYLE[d.status];
          const isToday = d.date === data.today;
          return (
            <Link key={d.date} href={`/time-report?date=${d.date}`} role="listitem" className="group flex h-full flex-1 flex-col items-center gap-2" aria-label={`${thaiDate(d.date)}: ${hours(d.totalMinutes) || 0} ชม.`}>
              <div className="relative flex w-full flex-1 items-end justify-center">
                {d.requiredMinutes > 0 && (
                  <span className="absolute inset-x-1 border-t-2 border-dashed border-gray-300" style={{ bottom: `${(d.requiredMinutes / max) * 100}%` }} aria-hidden />
                )}
                <span
                  className={`w-full max-w-10 rounded-t-lg transition-[height] duration-700 ease-out group-hover:opacity-80 ${d.totalMinutes ? s.bar : 'bg-gray-100'}`}
                  style={{ height: mounted ? `${Math.max(3, (d.totalMinutes / max) * 100)}%` : '3%', transitionDelay: `${i * 60}ms` }}
                />
              </div>
              <span className={`text-[12px] tabular-nums ${d.totalMinutes ? 'font-semibold text-gray-900' : 'text-gray-400'}`}>{hours(d.totalMinutes) || '–'}</span>
              <span className={`grid h-6 w-6 place-items-center rounded-full text-[11px] ${isToday ? 'bg-brand-600 font-semibold text-white' : 'text-gray-500'}`}>
                {THAI_WEEKDAY_SHORT[d.weekday].replace('.', '')}
              </span>
            </Link>
          );
        })}
      </div>
    </section>
  );
}

// ---------------------------------------------------------------------------

function Announcements({ data }: { data: HomeData }) {
  const qc = useQueryClient();
  const ack = useMutation({
    mutationFn: (id: string) => api(`/announcements/${id}/ack`, { method: 'POST' }),
    onSuccess: () => {
      toast.success('รับทราบแล้ว');
      void qc.invalidateQueries({ queryKey: ['home'] });
      void qc.invalidateQueries({ queryKey: ['notifications'] });
      void qc.invalidateQueries({ queryKey: ['announcements'] });
    },
    onError: (e) => toast.error(errorMessage(e)),
  });
  return (
    <section {...fade(4)} className="animate-fade-up stagger flex flex-col rounded-2xl bg-white shadow-card ring-1 ring-gray-200/80">
      <header className="flex items-center justify-between px-5 pt-5 pb-3">
        <h2 className="flex items-center gap-2 text-[15px] font-semibold">
          <Megaphone className="h-4 w-4 text-brand-600" /> ประกาศ
        </h2>
        <Link href="/announcements" className="text-[12px] font-medium text-brand-600 hover:underline">
          ดูทั้งหมด
        </Link>
      </header>
      {data.announcements.length === 0 ? (
        <p className="px-5 pb-6 text-[13px] text-gray-500">ยังไม่มีประกาศ</p>
      ) : (
        <ul className="flex-1 divide-y divide-gray-100">
          {data.announcements.map((a, n) => (
            <li key={a.id} {...fade(5 + n)} className="animate-fade-up stagger px-5 py-4">
              <div className="flex items-center gap-2 text-[11px] text-gray-500">
                {a.pinned && (
                  <span className="inline-flex items-center gap-1 font-medium text-brand-600">
                    <Pin className="h-3 w-3" /> ปักหมุด
                  </span>
                )}
                <span>{thaiDate(a.publishedAt.slice(0, 10))}</span>
              </div>
              <Link href={`/announcements#${a.id}`} className="mt-1 block text-[14px] font-medium text-gray-900 hover:text-brand-700">
                {a.title}
              </Link>
              <p className="mt-1 line-clamp-2 text-[13px] whitespace-pre-line text-gray-600">{a.excerpt}</p>
              {a.requiresAck &&
                (a.ackedAt ? (
                  <p className="mt-2 inline-flex items-center gap-1 text-[12px] text-emerald-600">
                    <CheckCheck className="h-3.5 w-3.5" /> รับทราบแล้ว
                  </p>
                ) : (
                  <button
                    type="button"
                    disabled={ack.isPending}
                    onClick={() => ack.mutate(a.id)}
                    className="mt-3 inline-flex h-8 items-center gap-1.5 rounded-lg bg-brand-600 px-3 text-[12px] font-medium text-white transition hover:bg-brand-700 disabled:opacity-60"
                  >
                    <CheckCheck className="h-3.5 w-3.5" /> รับทราบ
                  </button>
                ))}
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}

// ---------------------------------------------------------------------------

/** Devices the user holds (IT Asset). Hidden when they hold none. */
function MyDevices() {
  const me = useSession();
  const { data } = useQuery({ queryKey: ['my-devices'], queryFn: () => api<MyDevice[]>('/assets/mine'), staleTime: 60_000 });
  if (!data?.length) return null;
  const hrefOf = (code: string) => (can(me, 'asset.read') ? `/it-assets/${encodeURIComponent(code)}` : '/it-assets');
  return (
    <section {...fade(6)} className="animate-fade-up stagger rounded-2xl bg-white shadow-card ring-1 ring-gray-200/80">
      <header className="px-5 pt-5 pb-2">
        <h2 className="flex items-center gap-2 text-[15px] font-semibold">
          <Laptop className="h-4 w-4 text-brand-600" /> อุปกรณ์ของฉัน
        </h2>
      </header>
      <ul className="divide-y divide-gray-100 px-5 pb-3">
        {data.map((d) => (
          <li key={d.code} className="py-2.5">
            <div className="flex items-center justify-between gap-2">
              <Link href={hrefOf(d.code)} className="font-mono text-[13px] font-medium text-brand-700 hover:underline">{d.code}</Link>
              <Badge tone={STATE_META[d.state].tone}>{STATE_META[d.state].label}</Badge>
            </div>
            <p className="text-[12px] text-gray-600">{[d.brand, d.model].filter(Boolean).join(' ') || d.category}</p>
            <p className="text-[11px] text-gray-500">
              {KIND_LABEL[d.kind]} · ตั้งแต่ {thaiDateShort(d.startDate)}
              {d.dueDate && <span className={d.overdue ? 'font-medium text-rose-600' : ''}> · คืนภายใน {thaiDate(d.dueDate)}</span>}
            </p>
          </li>
        ))}
      </ul>
      <Link href="/it-assets" className="block px-5 pb-4 text-[12px] font-medium text-brand-600 hover:underline">ดูประวัติเครื่อง / แจ้งซ่อม</Link>
    </section>
  );
}

// ---------------------------------------------------------------------------

function Launcher({ apps }: { apps: AppLink[] }) {
  const groups = [...new Set(apps.map((a) => a.category))];
  let n = 0;
  return (
    <section {...fade(6)} className="animate-fade-up stagger">
      <div className="mb-4 flex items-end justify-between">
        <div>
          <h2 className="text-lg font-semibold tracking-tight">แอปและระบบ</h2>
          <p className="text-[13px] text-gray-500">ทุกระบบของ PAS ในที่เดียว — แสดงตามสิทธิ์ของคุณ</p>
        </div>
      </div>
      <div className="space-y-6">
        {groups.map((g) => (
          <div key={g}>
            <p className="mb-2.5 text-[11px] font-semibold tracking-wider text-gray-400 uppercase">{g}</p>
            <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4">
              {apps
                .filter((a) => a.category === g)
                .map((a) => (
                  <AppTile key={a.id} app={a} index={n++} />
                ))}
            </div>
          </div>
        ))}
      </div>
    </section>
  );
}

function AppTile({ app, index }: { app: AppLink; index: number }) {
  const planned = app.kind === 'PLANNED';
  const external = app.kind === 'EXTERNAL';
  const inner = (
    <>
      <span
        className={`grid h-11 w-11 shrink-0 place-items-center rounded-xl transition duration-300 group-hover:scale-110 group-hover:rotate-[-4deg] ${
          planned ? 'bg-gray-100 text-gray-400' : app.kind === 'INTERNAL' ? 'bg-brand-600 text-white shadow-md shadow-brand-600/25' : 'bg-brand-50 text-brand-600'
        }`}
      >
        <AppIcon icon={app.icon} className="h-5 w-5" />
      </span>
      <span className="min-w-0 flex-1">
        <span className="flex items-center gap-1.5 text-[14px] font-medium text-gray-900">
          <span className="truncate">{app.name}</span>
          {planned && (
            <Badge>
              <Sparkles className="h-3 w-3" /> เร็ว ๆ นี้
            </Badge>
          )}
        </span>
        <span className="block truncate text-[12px] text-gray-500">{app.description}</span>
      </span>
      {external && <ArrowUpRight className="h-4 w-4 shrink-0 text-gray-300 transition group-hover:-translate-y-0.5 group-hover:translate-x-0.5 group-hover:text-brand-600" aria-label="เปิดในแท็บใหม่" />}
    </>
  );
  const cls = `group flex items-center gap-3.5 rounded-2xl p-4 transition duration-300 animate-fade-up stagger ${
    planned
      ? 'cursor-default border border-dashed border-gray-300 bg-gray-50/60'
      : 'bg-white shadow-card ring-1 ring-gray-200/80 hover:-translate-y-1 hover:shadow-pop hover:ring-brand-200'
  }`;
  const style = { '--i': Math.min(index, 12) } as React.CSSProperties;
  if (planned || !app.url) return <div className={cls} style={style} aria-disabled="true">{inner}</div>;
  if (external) {
    return (
      <a href={app.url} target="_blank" rel="noopener noreferrer" className={cls} style={style}>
        {inner}
      </a>
    );
  }
  return (
    <Link href={app.url} className={cls} style={style}>
      {inner}
    </Link>
  );
}
