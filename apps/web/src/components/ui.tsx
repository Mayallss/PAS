'use client';

import { Loader2 } from 'lucide-react';
import { useEffect, useRef } from 'react';

type BtnProps = React.ButtonHTMLAttributes<HTMLButtonElement> & {
  variant?: 'primary' | 'secondary' | 'danger' | 'ghost';
  size?: 'sm' | 'md' | 'icon';
  loading?: boolean;
};

export function Button({ variant = 'secondary', size = 'md', loading, className = '', children, disabled, ...props }: BtnProps) {
  const v = {
    primary: 'bg-brand-600 text-white shadow-sm hover:bg-brand-700 active:bg-brand-800 disabled:bg-gray-300 disabled:shadow-none',
    secondary: 'bg-white text-gray-800 ring-1 ring-inset ring-gray-200 shadow-card hover:bg-gray-50 disabled:text-gray-400',
    danger: 'bg-white text-rose-600 ring-1 ring-inset ring-rose-200 hover:bg-rose-50 disabled:text-gray-400',
    ghost: 'text-gray-600 hover:bg-gray-100 hover:text-gray-900 disabled:text-gray-300',
  }[variant];
  const s = { sm: 'h-8 px-2.5 text-[13px] gap-1.5', md: 'h-9 px-3.5 text-sm gap-2', icon: 'h-9 w-9' }[size];
  return (
    <button
      type="button"
      disabled={disabled || loading}
      className={`inline-flex shrink-0 items-center justify-center rounded-lg font-medium transition-colors disabled:cursor-not-allowed ${v} ${s} ${className}`}
      {...props}
    >
      {loading && <Loader2 className="h-4 w-4 animate-spin" aria-hidden />}
      {children}
    </button>
  );
}

export function Field({ label, hint, error, children }: { label: string; hint?: string; error?: string; children: React.ReactNode }) {
  return (
    <label className="block">
      <span className="mb-1.5 block text-[13px] font-medium text-gray-700">{label}</span>
      {children}
      {hint && !error && <span className="mt-1 block text-xs text-gray-500">{hint}</span>}
      {error && <span className="mt-1 block text-xs text-rose-600">{error}</span>}
    </label>
  );
}

export const inputClass =
  'block h-9 w-full rounded-lg border-0 bg-white px-3 text-sm text-gray-900 shadow-card ring-1 ring-inset ring-gray-200 placeholder:text-gray-400 focus:ring-2 focus:ring-brand-600 focus:outline-none disabled:bg-gray-50 disabled:text-gray-500 [&:is(textarea)]:h-auto [&:is(textarea)]:py-2';

export function Card({ title, description, actions, children, className = '', bodyClassName = 'p-5' }: {
  title?: React.ReactNode;
  description?: React.ReactNode;
  actions?: React.ReactNode;
  children: React.ReactNode;
  className?: string;
  bodyClassName?: string;
}) {
  return (
    <section className={`rounded-xl bg-white shadow-card ring-1 ring-gray-200/80 ${className}`}>
      {(title || actions) && (
        <header className="flex flex-wrap items-center justify-between gap-3 border-b border-gray-100 px-5 py-3.5">
          <div>
            <h2 className="text-[15px] font-semibold text-gray-900">{title}</h2>
            {description && <p className="mt-0.5 text-[13px] text-gray-500">{description}</p>}
          </div>
          <div className="flex flex-wrap items-center gap-2">{actions}</div>
        </header>
      )}
      <div className={bodyClassName}>{children}</div>
    </section>
  );
}

export function PageHeader({ title, description, actions }: { title: string; description?: React.ReactNode; actions?: React.ReactNode }) {
  return (
    <div className="mb-6 flex flex-wrap items-end justify-between gap-4">
      <div>
        <h1 className="text-2xl font-semibold tracking-tight text-gray-900">{title}</h1>
        {description && <p className="mt-1 text-sm text-gray-500">{description}</p>}
      </div>
      {actions && <div className="flex flex-wrap items-center gap-2">{actions}</div>}
    </div>
  );
}

export function Alert({ tone = 'info', children }: { tone?: 'info' | 'warning' | 'error' | 'success'; children: React.ReactNode }) {
  const t = {
    info: 'bg-sky-50 text-sky-900 ring-sky-200',
    warning: 'bg-amber-50 text-amber-900 ring-amber-200',
    error: 'bg-rose-50 text-rose-900 ring-rose-200',
    success: 'bg-emerald-50 text-emerald-900 ring-emerald-200',
  }[tone];
  return (
    <div role={tone === 'error' ? 'alert' : 'status'} className={`rounded-lg px-3.5 py-2.5 text-[13px] ring-1 ring-inset ${t}`}>
      {children}
    </div>
  );
}

export function Badge({ children, tone = 'gray' }: { children: React.ReactNode; tone?: 'gray' | 'brand' | 'amber' | 'rose' | 'sky' }) {
  const t = {
    gray: 'bg-gray-100 text-gray-600',
    brand: 'bg-brand-50 text-brand-700',
    amber: 'bg-amber-50 text-amber-700',
    rose: 'bg-rose-50 text-rose-700',
    sky: 'bg-sky-50 text-sky-700',
  }[tone];
  return <span className={`inline-flex items-center gap-1 rounded-md px-1.5 py-0.5 text-[11px] font-medium ${t}`}>{children}</span>;
}

export function Progress({ value, max, className = '', barClassName = 'bg-brand-500' }: { value: number; max: number; className?: string; barClassName?: string }) {
  const pct = max > 0 ? Math.min(100, (value / max) * 100) : 0;
  return (
    <div className={`h-1.5 overflow-hidden rounded-full bg-gray-100 ${className}`} role="progressbar" aria-valuenow={Math.round(pct)} aria-valuemin={0} aria-valuemax={100}>
      <div className={`h-full rounded-full transition-[width] duration-500 ease-out ${barClassName}`} style={{ width: `${pct}%` }} />
    </div>
  );
}

/** Content-shaped placeholder instead of a spinner. */
export function Loading({ rows = 4 }: { rows?: number; label?: string }) {
  return (
    <div className="space-y-2.5 py-2" aria-busy="true" aria-label="กำลังโหลด">
      {Array.from({ length: rows }, (_, i) => (
        <div key={i} className="skeleton h-9" style={{ opacity: 1 - i * 0.15 }} />
      ))}
    </div>
  );
}

export function Empty({ icon, title, children }: { icon?: React.ReactNode; title?: string; children?: React.ReactNode }) {
  return (
    <div className="flex flex-col items-center gap-2 py-12 text-center">
      {icon && <div className="rounded-full bg-gray-100 p-3 text-gray-400">{icon}</div>}
      {title && <p className="text-sm font-medium text-gray-900">{title}</p>}
      {children && <div className="max-w-sm text-[13px] text-gray-500">{children}</div>}
    </div>
  );
}

export function Kbd({ children }: { children: React.ReactNode }) {
  return <kbd className="rounded border border-gray-200 bg-white px-1.5 py-px font-sans text-[11px] text-gray-500 shadow-card">{children}</kbd>;
}

/** Accessible modal on native <dialog>: focus trap, Esc closes, focus returns on close. */
export function Dialog({ open, onClose, title, children, footer, wide }: { open: boolean; onClose: () => void; title: string; children: React.ReactNode; footer?: React.ReactNode; wide?: boolean }) {
  const ref = useRef<HTMLDialogElement>(null);
  useEffect(() => {
    const d = ref.current;
    if (!d) return;
    if (open && !d.open) d.showModal();
    if (!open && d.open) d.close();
  }, [open]);
  return (
    <dialog
      ref={ref}
      onClose={onClose}
      onCancel={(e) => {
        e.preventDefault();
        onClose();
      }}
      className={`m-auto ${wide ? 'w-[min(40rem,calc(100vw-2rem))]' : 'w-[min(30rem,calc(100vw-2rem))]'} max-h-[calc(100vh-2rem)] rounded-2xl p-0 shadow-pop backdrop:bg-gray-950/30 backdrop:backdrop-blur-[2px]`}
      aria-labelledby="dialog-title"
    >
      {open && (
        <div>
          <header className="px-6 pt-5">
            <h2 id="dialog-title" className="text-base font-semibold">
              {title}
            </h2>
          </header>
          <div className="space-y-4 px-6 py-4">{children}</div>
          {footer && <footer className="flex flex-wrap justify-end gap-2 rounded-b-2xl bg-gray-50 px-6 py-3">{footer}</footer>}
        </div>
      )}
    </dialog>
  );
}
