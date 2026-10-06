'use client';

import { useCallback } from 'react';

/** Wraps a group of `.spot` cards; a soft gold light follows the cursor over the hovered card. */
export function SpotlightGroup({ children, className = '' }: { children: React.ReactNode; className?: string }) {
  const onMove = useCallback((e: React.PointerEvent<HTMLDivElement>) => {
    if (e.pointerType !== 'mouse') return;
    const card = (e.target as HTMLElement).closest<HTMLElement>('.spot');
    if (!card) return;
    const r = card.getBoundingClientRect();
    card.style.setProperty('--x', `${e.clientX - r.left}px`);
    card.style.setProperty('--y', `${e.clientY - r.top}px`);
  }, []);
  return (
    <div className={className} onPointerMove={onMove}>
      {children}
    </div>
  );
}
