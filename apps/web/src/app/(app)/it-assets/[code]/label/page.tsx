'use client';

import { useQuery } from '@tanstack/react-query';
import { ArrowLeft, Printer } from 'lucide-react';
import Link from 'next/link';
import QRCode from 'qrcode';
import { use, useEffect, useState } from 'react';
import { Alert, Button, Loading } from '@/components/ui';
import { api, errorMessage } from '@/lib/api';
import type { AssetDetail } from '@/lib/assets';

/** Sticker for the device: scanning the QR opens its page (login required), so the label itself carries no private data. */
export default function AssetLabelPage({ params }: { params: Promise<{ code: string }> }) {
  const { code: raw } = use(params);
  const code = decodeURIComponent(raw);
  const q = useQuery({ queryKey: ['asset', code], queryFn: () => api<AssetDetail>(`/assets/${encodeURIComponent(code)}`) });
  const [qr, setQr] = useState<string | null>(null);

  useEffect(() => {
    const url = `${window.location.origin}/it-assets/${encodeURIComponent(code)}`;
    void QRCode.toDataURL(url, { margin: 1, width: 360, errorCorrectionLevel: 'M' }).then(setQr);
  }, [code]);

  if (q.isLoading || !qr) return <Loading rows={3} />;
  if (q.error || !q.data) return <Alert tone="error">{errorMessage(q.error)}</Alert>;
  const a = q.data;

  return (
    <div>
      <div className="mb-6 flex items-center justify-between print:hidden">
        <Link href={`/it-assets/${encodeURIComponent(a.code)}`} className="inline-flex items-center gap-1 text-[13px] text-gray-500 hover:text-gray-800">
          <ArrowLeft className="h-4 w-4" /> {a.code}
        </Link>
        <Button variant="primary" onClick={() => window.print()}>
          <Printer className="h-4 w-4" /> พิมพ์
        </Button>
      </div>
      <div className="mx-auto flex w-[9cm] items-center gap-3 rounded-lg border border-gray-300 bg-white p-3 print:rounded-none print:border-black">
        {/* eslint-disable-next-line @next/next/no-img-element -- generated data URL */}
        <img src={qr} alt={`QR ${a.code}`} className="h-[3cm] w-[3cm]" />
        <div className="min-w-0">
          <p className="text-[10px] font-medium tracking-wider text-gray-500 uppercase">PAS · IT Asset</p>
          <p className="font-mono text-xl leading-tight font-bold text-gray-900">{a.code}</p>
          <p className="mt-1 truncate text-[11px] text-gray-700">{[a.brand, a.model].filter(Boolean).join(' ') || a.category.name}</p>
          {a.serialNo && <p className="truncate font-mono text-[10px] text-gray-500">S/N {a.serialNo}</p>}
          <p className="mt-1 text-[9px] text-gray-400">แจ้งปัญหาเครื่อง: IT Requests</p>
        </div>
      </div>
      <p className="mt-4 text-center text-[12px] text-gray-500 print:hidden">สแกน QR เพื่อเปิดหน้าประวัติเครื่อง (ต้องเข้าสู่ระบบ)</p>
    </div>
  );
}
