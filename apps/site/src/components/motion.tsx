'use client';

import { useEffect, useRef, useState } from 'react';

/** Counts up from 0 once visible. Renders the final value on the server (no-JS and SEO see real numbers). */
export function CountUp({ to, suffix = '', duration = 1600 }: { to: number; suffix?: string; duration?: number }) {
  const ref = useRef<HTMLSpanElement>(null);
  const [value, setValue] = useState(to);

  useEffect(() => {
    const el = ref.current;
    if (!el || window.matchMedia('(prefers-reduced-motion: reduce)').matches) return;
    let raf = 0;
    // The real number stays on screen until the first animation frame runs, so crawlers,
    // screenshots and throttled tabs never get stuck on "0". The observer fires just before
    // the element scrolls into view (positive bottom margin), so the reset is not visible.
    const io = new IntersectionObserver(
      ([entry]) => {
        if (!entry.isIntersecting) return;
        io.disconnect();
        let start = 0;
        const tick = (now: number) => {
          start ||= now;
          const p = Math.min(1, (now - start) / duration);
          setValue(Math.round(to * (1 - Math.pow(1 - p, 3))));
          if (p < 1) raf = requestAnimationFrame(tick);
        };
        raf = requestAnimationFrame(tick);
      },
      { rootMargin: '0px 0px 15% 0px' },
    );
    io.observe(el);
    return () => {
      io.disconnect();
      cancelAnimationFrame(raf);
    };
  }, [to, duration]);

  return (
    <span ref={ref} className="tabular-nums">
      {value}
      {suffix}
    </span>
  );
}
