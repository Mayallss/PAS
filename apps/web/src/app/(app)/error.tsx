'use client';

import { RefreshCw, TriangleAlert } from 'lucide-react';
import { Button, Empty } from '@/components/ui';

export default function AppError({ reset }: { error: Error; reset: () => void }) {
  return (
    <Empty icon={<TriangleAlert className="h-5 w-5" />} title="โหลดข้อมูลไม่สำเร็จ">
      <p>ระบบไม่สามารถเชื่อมต่อได้ชั่วคราว กรุณาลองใหม่อีกครั้ง</p>
      <Button className="mt-4" variant="primary" onClick={reset}>
        <RefreshCw className="h-4 w-4" /> ลองใหม่
      </Button>
    </Empty>
  );
}
