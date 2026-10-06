'use client';

import { CloudOff } from 'lucide-react';
import { type IntegrationKey, useIntegration } from '@/lib/integrations';

/**
 * One quiet line under a page title when an integration this page can use is off: says what still works and what
 * is missing. Shows nothing when the integration is on, or when its status cannot be read.
 */
export function IntegrationHint({ integration, className = '' }: { integration: IntegrationKey; className?: string }) {
  const i = useIntegration(integration);
  if (!i || i.state === 'ON') return null;
  return (
    <p className={`flex items-start gap-1.5 rounded-lg bg-gray-50 px-3 py-2 text-[12.5px] text-gray-600 ring-1 ring-gray-200 ring-inset ${className}`}>
      <CloudOff className="mt-0.5 h-3.5 w-3.5 shrink-0 text-gray-400" aria-hidden />
      <span>
        <b className="font-medium text-gray-700">{i.state === 'ERROR' ? 'การเชื่อมต่อมีปัญหา' : 'ยังไม่ได้เชื่อมต่อ'}: {i.name}</b> — {i.whenOff}
      </span>
    </p>
  );
}
