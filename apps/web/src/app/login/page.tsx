'use client';

import { useQuery } from '@tanstack/react-query';
import { BellRing, LayoutGrid, ShieldCheck, Zap } from 'lucide-react';
import Image from 'next/image';
import { PasLogo } from '@/components/brand';
import { useSearchParams } from 'next/navigation';
import { Suspense, useState } from 'react';
import { Alert, Button, Field, inputClass } from '@/components/ui';
import { api, errorMessage } from '@/lib/api';

/** Only same-site relative paths are allowed as post-login redirects (no open redirect). */
function safeNext(next: string | null) {
  return next && next.startsWith('/') && !next.startsWith('//') && !next.startsWith('/\\') ? next : '/time-report';
}

function LoginForm() {
  const params = useSearchParams();
  const config = useQuery({ queryKey: ['auth-config'], queryFn: () => api<{ sso: boolean; password: boolean; devLogin: boolean }>('/auth/config') });
  const [email, setEmail] = useState('');
  const [username, setUsername] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState<string | null>(
    params.get('error') === 'sso_unavailable'
      ? 'ติดต่อ Google ไม่ได้ชั่วคราว กรุณาลองใหม่อีกครั้งในไม่กี่นาที (ผู้ที่เข้าสู่ระบบอยู่แล้วยังใช้งานได้ตามปกติ)'
      : params.get('error')
        ? 'เข้าสู่ระบบด้วย SSO ไม่สำเร็จ หรือบัญชีนี้ไม่มีสิทธิ์ใช้งาน'
        : null,
  );
  const [busy, setBusy] = useState(false);

  async function devLogin(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true);
    setError(null);
    try {
      await api('/auth/dev-login', { method: 'POST', body: { email } });
      window.location.href = safeNext(params.get('next'));
    } catch (err) {
      setError(errorMessage(err));
      setBusy(false);
    }
  }

  async function passwordLogin(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true);
    setError(null);
    try {
      await api('/auth/password-login', { method: 'POST', body: { username, password } });
      window.location.href = safeNext(params.get('next'));
    } catch (err) {
      setError(errorMessage(err));
      setPassword('');
      setBusy(false);
    }
  }

  return (
    <div className="w-full max-w-sm space-y-6">
      <div className="space-y-2">
        <PasLogo className="mb-6 h-14 w-auto" priority />
        <h1 className="text-2xl font-semibold tracking-tight">เข้าสู่ระบบ</h1>
        <p className="text-sm text-gray-500">เข้าใช้งาน PAS Employee Portal</p>
      </div>
      {error && <Alert tone="error">{error}</Alert>}
      {config.isLoading && <div className="skeleton h-10" />}
      {config.data?.sso && (
        <Button variant="primary" className="h-11 w-full" onClick={() => (window.location.href = '/api/auth/login')}>
          <ShieldCheck className="h-4 w-4" /> เข้าสู่ระบบด้วยบัญชีองค์กร (SSO)
        </Button>
      )}
      {config.data?.password && (
        <>
          {config.data.sso && (
            <div className="flex items-center gap-3 text-[12px] text-gray-400">
              <span className="h-px flex-1 bg-gray-200" /> หรือใช้ชื่อผู้ใช้ <span className="h-px flex-1 bg-gray-200" />
            </div>
          )}
          <form onSubmit={passwordLogin} className="space-y-3">
            <Field label="ชื่อผู้ใช้" hint="ชื่อเดียวกับที่ใช้เข้า Time Report เดิม">
              <input className={`${inputClass} h-11`} required autoComplete="username" autoCapitalize="none" spellCheck={false} value={username} onChange={(e) => setUsername(e.target.value)} />
            </Field>
            <Field label="รหัสผ่าน">
              <input className={`${inputClass} h-11`} type="password" required autoComplete="current-password" value={password} onChange={(e) => setPassword(e.target.value)} />
            </Field>
            <Button type="submit" variant={config.data.sso ? 'secondary' : 'primary'} className="h-11 w-full" loading={busy}>
              เข้าสู่ระบบ
            </Button>
            <p className="text-[12px] text-gray-500">ยังไม่มีรหัสผ่าน หรือลืมรหัส? ขอ “ลิงก์ตั้งรหัสผ่าน” จาก Admin / IT — ระบบใหม่ไม่ใช้รหัสผ่านของ Time Report เดิม</p>
          </form>
        </>
      )}
      {config.data && !config.data.sso && !config.data.password && !config.data.devLogin && <Alert tone="warning">ยังไม่ได้เปิดวิธีเข้าสู่ระบบ กรุณาติดต่อฝ่าย IT</Alert>}
      {config.data?.devLogin && (
        <form onSubmit={devLogin} className="space-y-3 rounded-xl border border-dashed border-amber-300 bg-amber-50/50 p-4">
          <p className="text-[12px] font-medium text-amber-800">โหมดพัฒนา — ปิดอัตโนมัติใน Production</p>
          <Field label="อีเมลผู้ใช้ทดสอบ" hint="employee@pas.test · manager@pas.test · admin@pas.test">
            <input className={inputClass} type="email" required autoComplete="username" value={email} onChange={(e) => setEmail(e.target.value)} />
          </Field>
          <Button type="submit" className="w-full" loading={busy}>
            เข้าสู่ระบบ (ทดสอบ)
          </Button>
        </form>
      )}
    </div>
  );
}

export default function LoginPage() {
  return (
    <main className="grid min-h-screen lg:grid-cols-2">
      <section className="relative isolate hidden overflow-hidden bg-brand-900 p-12 text-white lg:flex lg:flex-col">
        <Image src="/brand/office.webp" alt="" fill priority sizes="50vw" className="-z-20 animate-ken-burns object-cover" />
        <div className="absolute inset-0 -z-10 bg-gradient-to-t from-brand-900 via-brand-900/80 to-brand-900/30" aria-hidden />
        <svg className="absolute right-0 bottom-0 -z-10 h-48 w-full animate-swoosh opacity-80" viewBox="0 0 600 160" fill="none" preserveAspectRatio="none" aria-hidden>
          <path d="M0 150 C 180 90, 360 40, 600 10 L 600 22 C 380 60, 200 110, 40 160 Z" fill="#0e9747" />
          <path d="M60 160 C 240 110, 420 60, 600 34 L 600 42 C 430 72, 260 118, 110 160 Z" fill="#fccb0f" />
        </svg>
        <p className="animate-fade-up text-[13px] font-medium tracking-wider text-white/70 uppercase">Professional Accounting Service</p>
        <div className="relative mt-auto mb-16 max-w-md space-y-8">
          <h2 className="animate-fade-up stagger text-3xl leading-tight font-semibold tracking-tight" style={{ '--i': 1 } as React.CSSProperties}>
            ทุกระบบของ PAS ในที่เดียว
          </h2>
          <ul className="space-y-4 text-[15px] text-white/90">
            {[
              [Zap, 'บันทึกเวลาในตารางสัปดาห์ พิมพ์แล้วบันทึกอัตโนมัติ'],
              [BellRing, 'แจ้งเตือนสิ่งที่ต้องทำ และประกาศที่ต้องรับทราบ'],
              [LayoutGrid, 'เข้าทุกแอปของออฟฟิศได้จากหน้าเดียว'],
              [ShieldCheck, 'ข้อมูลเห็นเฉพาะผู้มีสิทธิ์ ทุกการเปลี่ยนแปลงมีประวัติ'],
            ].map(([Icon, text], i) => {
              const I = Icon as typeof Zap;
              return (
                <li key={i} className="animate-fade-up stagger flex gap-3" style={{ '--i': i + 2 } as React.CSSProperties}>
                  <I className="mt-0.5 h-5 w-5 shrink-0 text-pas-yellow" /> {text as string}
                </li>
              );
            })}
          </ul>
        </div>
      </section>
      <section className="flex items-center justify-center p-6">
        <Suspense>
          <LoginForm />
        </Suspense>
      </section>
    </main>
  );
}
