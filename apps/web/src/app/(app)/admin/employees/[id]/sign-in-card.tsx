'use client';

import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Copy, KeyRound, LockOpen, QrCode } from 'lucide-react';
import QRCode from 'qrcode';
import { useEffect, useState } from 'react';
import { toast } from 'sonner';
import { Alert, Badge, Button, Card, Dialog, Field, inputClass } from '@/components/ui';
import { api, errorMessage } from '@/lib/api';
import { thaiDate } from '@/lib/format';

interface CredentialStatus {
  enabled: boolean;
  username: string | null;
  suggestedUsername: string | null;
  hasPassword: boolean;
  locked: boolean;
  setupPending: boolean;
  setupExpiresAt: string | null;
  passwordChangedAt: string | null;
}

/**
 * Username + password sign-in for one person. The administrator issues a one-time link (72 h); the employee picks
 * the password — nobody else ever sees it.
 */
export function SignInCard({ employeeId, active }: { employeeId: string; active: boolean }) {
  const qc = useQueryClient();
  const q = useQuery({ queryKey: ['credential', employeeId], queryFn: () => api<CredentialStatus>(`/employees/${employeeId}/credential`) });
  const [asking, setAsking] = useState(false);
  const [username, setUsername] = useState('');
  const [link, setLink] = useState<{ url: string; username: string; expiresAt: string } | null>(null);
  const refresh = () => void qc.invalidateQueries({ queryKey: ['credential', employeeId] });

  const issue = useMutation({
    mutationFn: () => api<{ url: string; username: string; expiresAt: string }>(`/employees/${employeeId}/credential/setup-link`, { method: 'POST', body: { username: username || null } }),
    onSuccess: (r) => {
      setAsking(false);
      setLink(r);
      refresh();
    },
    onError: (e) => toast.error(errorMessage(e)),
  });
  const unlock = useMutation({
    mutationFn: () => api(`/employees/${employeeId}/credential/unlock`, { method: 'POST' }),
    onSuccess: () => {
      toast.success('ปลดล็อกแล้ว');
      refresh();
    },
    onError: (e) => toast.error(errorMessage(e)),
  });

  const s = q.data;
  if (!s || !s.enabled) return null;
  return (
    <Card
      title={
        <span className="flex items-center gap-2">
          <KeyRound className="h-4 w-4 text-brand-600" /> การเข้าสู่ระบบ
        </span>
      }
      bodyClassName="px-5 py-3 space-y-2 text-[13px]"
    >
      <p>
        ชื่อผู้ใช้: <b className="font-mono">{s.username ?? '—'}</b>{' '}
        {s.hasPassword ? <Badge tone="brand">ตั้งรหัสแล้ว</Badge> : <Badge>ยังไม่มีรหัสผ่าน</Badge>} {s.locked && <Badge tone="rose">ถูกล็อก</Badge>}
        {s.setupPending && <Badge tone="amber">มีลิงก์รอใช้</Badge>}
      </p>
      {s.passwordChangedAt && <p className="text-[12px] text-gray-500">เปลี่ยนรหัสล่าสุด {thaiDate(s.passwordChangedAt.slice(0, 10))}</p>}
      <div className="flex flex-wrap gap-2 pt-1">
        <Button
          size="sm"
          variant={s.hasPassword ? 'secondary' : 'primary'}
          disabled={!active}
          onClick={() => {
            setUsername(s.username ?? s.suggestedUsername ?? '');
            setAsking(true);
          }}
        >
          <QrCode className="h-3.5 w-3.5" /> {s.hasPassword ? 'ลิงก์ตั้งรหัสใหม่ (ลืมรหัส)' : 'สร้างลิงก์ตั้งรหัสผ่าน'}
        </Button>
        {s.locked && (
          <Button size="sm" loading={unlock.isPending} onClick={() => unlock.mutate()}>
            <LockOpen className="h-3.5 w-3.5" /> ปลดล็อก
          </Button>
        )}
      </div>

      <Dialog
        open={asking}
        onClose={() => setAsking(false)}
        title="สร้างลิงก์ตั้งรหัสผ่าน"
        footer={
          <>
            <Button onClick={() => setAsking(false)}>ยกเลิก</Button>
            <Button variant="primary" loading={issue.isPending} onClick={() => issue.mutate()}>
              สร้างลิงก์
            </Button>
          </>
        }
      >
        <Field label="ชื่อผู้ใช้" hint="a-z 0-9 . _ - (ตั้งต้นจาก Time Report เดิม)">
          <input className={`${inputClass} font-mono`} value={username} onChange={(e) => setUsername(e.target.value.toLowerCase())} />
        </Field>
        <Alert tone="info">ลิงก์ใช้ได้ครั้งเดียวภายใน 72 ชั่วโมง ส่งให้เจ้าตัวเท่านั้น — สร้างลิงก์ใหม่จะยกเลิกลิงก์เดิม รหัสผ่านเดิม (ถ้ามี) ยังใช้ได้จนกว่าจะตั้งใหม่</Alert>
      </Dialog>

      {link && <LinkDialog link={link} onClose={() => setLink(null)} />}
    </Card>
  );
}

function LinkDialog({ link, onClose }: { link: { url: string; username: string; expiresAt: string }; onClose: () => void }) {
  const [qr, setQr] = useState('');
  useEffect(() => {
    void QRCode.toDataURL(link.url, { margin: 1, width: 300, errorCorrectionLevel: 'M' }).then(setQr);
  }, [link.url]);
  return (
    <Dialog
      open
      onClose={onClose}
      title={`ลิงก์ตั้งรหัสผ่าน — ${link.username}`}
      footer={
        <>
          <Button onClick={onClose}>ปิด</Button>
          <Button
            variant="primary"
            onClick={() =>
              navigator.clipboard.writeText(link.url).then(
                () => toast.success('คัดลอกลิงก์แล้ว'),
                () => toast.error('คัดลอกไม่ได้ — คัดลอกจากกล่องข้อความเอง'),
              )
            }
          >
            <Copy className="h-4 w-4" /> คัดลอกลิงก์
          </Button>
        </>
      }
    >
      <p className="text-[13px] text-gray-600">ให้เจ้าตัวสแกน QR หรือเปิดลิงก์ แล้วตั้งรหัสผ่านเอง — ใช้ได้ถึง {new Date(link.expiresAt).toLocaleString('th-TH', { dateStyle: 'medium', timeStyle: 'short' })}</p>
      <div className="flex justify-center">
        {/* eslint-disable-next-line @next/next/no-img-element */}
        {qr && <img src={qr} alt="QR ลิงก์ตั้งรหัสผ่าน" width={200} height={200} className="rounded-lg ring-1 ring-gray-200" />}
      </div>
      <p className="rounded-lg bg-gray-50 px-3 py-2 font-mono text-[11px] break-all text-gray-500 select-all">{link.url}</p>
      <Alert tone="warning">ห้ามส่งลิงก์ในกลุ่มแชต — ใครได้ลิงก์ก็ตั้งรหัสของบัญชีนี้ได้</Alert>
    </Dialog>
  );
}
