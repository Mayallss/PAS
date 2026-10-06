'use client';

import { useMutation, useQuery } from '@tanstack/react-query';
import { KeyRound, ShieldCheck } from 'lucide-react';
import { useSearchParams } from 'next/navigation';
import { Suspense, useState } from 'react';
import { PasLogo } from '@/components/brand';
import { Alert, Button, Field, inputClass, Loading } from '@/components/ui';
import { api, errorMessage } from '@/lib/api';

export default function SetPasswordPage() {
  return (
    <main className="flex min-h-screen items-center justify-center bg-gray-50 p-6">
      <div className="w-full max-w-sm space-y-6 rounded-2xl bg-white p-6 shadow-card ring-1 ring-gray-200/80">
        <PasLogo className="h-12 w-auto" priority />
        <Suspense fallback={<Loading rows={3} />}>
          <SetPassword />
        </Suspense>
      </div>
    </main>
  );
}

/** One-time link from an administrator: the employee chooses their own password (admins never see it). */
function SetPassword() {
  const token = useSearchParams().get('token') ?? '';
  const [password, setPassword] = useState('');
  const [confirm, setConfirm] = useState('');
  const info = useQuery({
    queryKey: ['password-setup', token],
    queryFn: () => api<{ username: string; fullName: string; expiresAt: string }>('/auth/password-setup', { query: { token } }),
    enabled: token.length >= 20,
    retry: false,
  });
  const save = useMutation({
    mutationFn: () => api('/auth/password-setup', { method: 'POST', body: { token, password } }),
    onSuccess: () => {
      window.location.href = '/';
    },
  });

  if (token.length < 20) return <Alert tone="warning">ลิงก์ไม่ครบ — ขอลิงก์ตั้งรหัสผ่านใหม่จาก Admin / IT</Alert>;
  if (info.isLoading) return <Loading rows={3} />;
  if (info.isError) return <Alert tone="warning">{errorMessage(info.error)}</Alert>;
  const d = info.data!;
  const long = password.length >= 10;
  const same = password.length > 0 && password === confirm;
  return (
    <form
      className="space-y-4"
      onSubmit={(e) => {
        e.preventDefault();
        if (long && same) save.mutate();
      }}
    >
      <div>
        <h1 className="flex items-center gap-2 text-xl font-semibold text-gray-900">
          <KeyRound className="h-5 w-5 text-brand-600" /> ตั้งรหัสผ่าน
        </h1>
        <p className="mt-1 text-[13px] text-gray-600">
          {d.fullName} · ชื่อผู้ใช้ <b className="font-mono text-gray-900">{d.username}</b>
        </p>
      </div>
      <input type="text" autoComplete="username" value={d.username} readOnly hidden />
      <Field label="รหัสผ่านใหม่" hint="อย่างน้อย 10 ตัวอักษร — ประโยคยาว ๆ ภาษาไทยก็ได้ จำง่ายและปลอดภัยกว่ารหัสสั้นที่ซับซ้อน">
        <input className={`${inputClass} h-11`} type="password" autoComplete="new-password" required value={password} onChange={(e) => setPassword(e.target.value)} autoFocus />
      </Field>
      <Field label="ยืนยันรหัสผ่าน" error={confirm && !same ? 'รหัสผ่านไม่ตรงกัน' : undefined}>
        <input className={`${inputClass} h-11`} type="password" autoComplete="new-password" required value={confirm} onChange={(e) => setConfirm(e.target.value)} />
      </Field>
      {save.isError && <Alert tone="error">{errorMessage(save.error)}</Alert>}
      <Button type="submit" variant="primary" className="h-11 w-full" disabled={!long || !same} loading={save.isPending}>
        ตั้งรหัสผ่านและเข้าสู่ระบบ
      </Button>
      <p className="flex items-start gap-1.5 text-[12px] text-gray-500">
        <ShieldCheck className="mt-0.5 h-3.5 w-3.5 shrink-0 text-emerald-600" /> ลิงก์นี้ใช้ได้ครั้งเดียว · ไม่มีใคร (รวมถึง Admin) เห็นรหัสผ่านของคุณ · อย่าใช้รหัสเดียวกับ Time Report เดิมหรืออีเมล
      </p>
    </form>
  );
}
