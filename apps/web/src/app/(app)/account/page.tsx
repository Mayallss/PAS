'use client';

import { useMutation, useQuery } from '@tanstack/react-query';
import { KeyRound } from 'lucide-react';
import { useState } from 'react';
import { toast } from 'sonner';
import { Alert, Button, Card, Field, inputClass, Loading, PageHeader } from '@/components/ui';
import { api, errorMessage } from '@/lib/api';
import { thaiDate } from '@/lib/format';
import { useSession } from '@/lib/session';

/** Own account: username and password change (signs out the other browsers). */
export default function AccountPage() {
  const me = useSession();
  const q = useQuery({ queryKey: ['my-password'], queryFn: () => api<{ enabled: boolean; username: string | null; hasPassword: boolean; passwordChangedAt: string | null }>('/auth/password') });
  const [current, setCurrent] = useState('');
  const [next, setNext] = useState('');
  const [confirm, setConfirm] = useState('');
  const change = useMutation({
    mutationFn: () => api('/auth/password', { method: 'POST', body: { current, next } }),
    onSuccess: () => {
      toast.success('เปลี่ยนรหัสผ่านแล้ว — เครื่องอื่นที่เข้าระบบค้างไว้ถูกออกจากระบบ');
      setCurrent('');
      setNext('');
      setConfirm('');
      void q.refetch();
    },
    onError: (e) => toast.error(errorMessage(e)),
  });
  const ok = next.length >= 10 && next === confirm && current.length > 0;
  return (
    <div className="max-w-xl">
      <PageHeader title="บัญชีของฉัน" description={me.user.fullName} />
      {q.isLoading ? (
        <Loading rows={3} />
      ) : !q.data?.enabled ? (
        <Alert tone="info">ระบบนี้เข้าสู่ระบบด้วยบัญชี Google ขององค์กร — จัดการรหัสผ่านที่ Google</Alert>
      ) : !q.data.hasPassword ? (
        <Alert tone="info">บัญชีนี้ยังไม่ได้ตั้งรหัสผ่าน (เข้าระบบด้วยวิธีอื่น) — ถ้าต้องการรหัสผ่าน ขอลิงก์ตั้งรหัสผ่านจาก Admin / IT</Alert>
      ) : (
        <Card title="เปลี่ยนรหัสผ่าน" description={`ชื่อผู้ใช้ ${q.data.username}${q.data.passwordChangedAt ? ` · เปลี่ยนล่าสุด ${thaiDate(q.data.passwordChangedAt.slice(0, 10))}` : ''}`}>
          <form
            className="space-y-3"
            onSubmit={(e) => {
              e.preventDefault();
              if (ok) change.mutate();
            }}
          >
            <input type="text" autoComplete="username" value={q.data.username ?? ''} readOnly hidden />
            <Field label="รหัสผ่านปัจจุบัน">
              <input className={inputClass} type="password" autoComplete="current-password" value={current} onChange={(e) => setCurrent(e.target.value)} />
            </Field>
            <Field label="รหัสผ่านใหม่" hint="อย่างน้อย 10 ตัวอักษร — ประโยคยาว ๆ จำง่ายและปลอดภัยกว่า">
              <input className={inputClass} type="password" autoComplete="new-password" value={next} onChange={(e) => setNext(e.target.value)} />
            </Field>
            <Field label="ยืนยันรหัสผ่านใหม่" error={confirm && confirm !== next ? 'รหัสผ่านไม่ตรงกัน' : undefined}>
              <input className={inputClass} type="password" autoComplete="new-password" value={confirm} onChange={(e) => setConfirm(e.target.value)} />
            </Field>
            <Button type="submit" variant="primary" disabled={!ok} loading={change.isPending}>
              <KeyRound className="h-4 w-4" /> เปลี่ยนรหัสผ่าน
            </Button>
          </form>
        </Card>
      )}
    </div>
  );
}
