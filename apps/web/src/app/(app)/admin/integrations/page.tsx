'use client';

import { CheckCircle2, CircleOff, TriangleAlert } from 'lucide-react';
import { Badge, Card, Loading, PageHeader } from '@/components/ui';
import { useIntegrations } from '@/lib/integrations';

const STATE = {
  ON: { label: 'เชื่อมต่อแล้ว', tone: 'brand' as const, Icon: CheckCircle2, color: 'text-emerald-600' },
  OFF: { label: 'ยังไม่เชื่อม', tone: 'gray' as const, Icon: CircleOff, color: 'text-gray-400' },
  ERROR: { label: 'มีปัญหา', tone: 'rose' as const, Icon: TriangleAlert, color: 'text-rose-600' },
};

/**
 * Optional integrations at a glance. The platform is built so that each one can be off or broken without stopping
 * anything else (docs/09 §6) — this page says what is connected, what is missing meanwhile, and why.
 */
export default function IntegrationsPage() {
  const q = useIntegrations();
  return (
    <div>
      <PageHeader title="การเชื่อมต่อระบบภายนอก" description="ส่วนเสริมที่ไม่ได้เชื่อมหรือมีปัญหา จะหายไปเฉพาะส่วนนั้น — ระบบหลักใช้งานได้ตามปกติเสมอ" />
      {q.isLoading ? (
        <Loading rows={3} />
      ) : (
        <div className="space-y-3">
          {q.data?.map((i) => {
            const s = STATE[i.state];
            return (
              <Card key={i.key}>
                <div className="flex items-start gap-3">
                  <s.Icon className={`mt-0.5 h-5 w-5 shrink-0 ${s.color}`} aria-hidden />
                  <div className="min-w-0 flex-1 space-y-1 text-[13px]">
                    <p className="flex flex-wrap items-center gap-2 text-[14px] font-medium text-gray-900">
                      {i.name} <Badge tone={s.tone}>{s.label}</Badge>
                    </p>
                    {i.state !== 'ON' && <p className="text-gray-600">ระหว่างนี้: {i.whenOff}</p>}
                    {i.pending !== undefined && (
                      <p className="text-gray-500">
                        รอส่งเข้าปฏิทิน {i.pending} รายการ · ส่งไม่สำเร็จ {i.failed ?? 0} รายการ
                      </p>
                    )}
                    {i.issues?.map((x) => (
                      <p key={x} className="text-rose-600">
                        {x}
                      </p>
                    ))}
                  </div>
                </div>
              </Card>
            );
          })}
          <p className="text-[12px] text-gray-400">วิธีตั้งค่า Google Calendar: docs/09 §4.2 · ค่าตั้งค่าอยู่ในไฟล์ .env ของเซิร์ฟเวอร์ (ไม่แสดงค่าลับในหน้านี้)</p>
        </div>
      )}
    </div>
  );
}
