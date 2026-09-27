'use client';

import { useQuery } from '@tanstack/react-query';
import { CalendarCheck2, Clock3, ShieldCheck, Zap } from 'lucide-react';
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
  const config = useQuery({ queryKey: ['auth-config'], queryFn: () => api<{ sso: boolean; devLogin: boolean }>('/auth/config') });
  const [email, setEmail] = useState('');
  const [error, setError] = useState<string | null>(params.get('error') ? 'เข้าสู่ระบบด้วย SSO ไม่สำเร็จ หรือบัญชีนี้ไม่มีสิทธิ์ใช้งาน' : null);
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

  return (
    <div className="w-full max-w-sm space-y-6">
      <div className="space-y-2">
        <div className="grid h-10 w-10 place-items-center rounded-xl bg-brand-600 text-white lg:hidden">
          <Clock3 className="h-5 w-5" />
        </div>
        <h1 className="text-2xl font-semibold tracking-tight">เข้าสู่ระบบ</h1>
        <p className="text-sm text-gray-500">ใช้บัญชีองค์กรของคุณเพื่อเข้าใช้งาน PAS Time</p>
      </div>
      {error && <Alert tone="error">{error}</Alert>}
      {config.isLoading && <div className="skeleton h-10" />}
      {config.data?.sso && (
        <Button variant="primary" className="h-11 w-full" onClick={() => (window.location.href = '/api/auth/login')}>
          <ShieldCheck className="h-4 w-4" /> เข้าสู่ระบบด้วยบัญชีองค์กร (SSO)
        </Button>
      )}
      {config.data && !config.data.sso && !config.data.devLogin && <Alert tone="warning">ยังไม่ได้ตั้งค่า SSO กรุณาติดต่อฝ่าย IT</Alert>}
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
      <section className="relative hidden overflow-hidden bg-brand-900 p-12 text-white lg:flex lg:flex-col">
        <div className="absolute -top-24 -right-24 h-96 w-96 rounded-full bg-brand-600/40 blur-3xl" aria-hidden />
        <div className="absolute -bottom-32 -left-16 h-96 w-96 rounded-full bg-emerald-400/20 blur-3xl" aria-hidden />
        <div className="relative flex items-center gap-2.5">
          <span className="grid h-9 w-9 place-items-center rounded-xl bg-white/15">
            <Clock3 className="h-5 w-5" />
          </span>
          <span className="text-lg font-semibold">
            PAS <span className="font-normal text-white/70">Time</span>
          </span>
        </div>
        <div className="relative mt-auto max-w-md space-y-8">
          <h2 className="text-3xl leading-tight font-semibold tracking-tight">บันทึกเวลาทำงานให้เสร็จในไม่กี่วินาที</h2>
          <ul className="space-y-4 text-[15px] text-white/85">
            <li className="flex gap-3">
              <Zap className="mt-0.5 h-5 w-5 shrink-0 text-emerald-300" /> พิมพ์ชั่วโมงในตารางสัปดาห์ได้ทันที บันทึกอัตโนมัติ
            </li>
            <li className="flex gap-3">
              <CalendarCheck2 className="mt-0.5 h-5 w-5 shrink-0 text-emerald-300" /> งานจากสัปดาห์ก่อนเตรียมไว้ให้แล้ว ไม่ต้องเลือกใหม่
            </li>
            <li className="flex gap-3">
              <ShieldCheck className="mt-0.5 h-5 w-5 shrink-0 text-emerald-300" /> เข้าสู่ระบบด้วยบัญชีองค์กร ข้อมูลเห็นเฉพาะผู้มีสิทธิ์
            </li>
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
