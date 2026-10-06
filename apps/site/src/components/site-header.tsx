'use client';

import { ArrowRight, BadgeCheck, Mail, MapPin, Menu, Phone, X } from 'lucide-react';
import Image from 'next/image';
import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { useEffect, useState } from 'react';
import { company, href, landing, nav, t, ui, type Locale } from '@/content/site';

export function SiteHeader({ lang }: { lang: Locale }) {
  const pathname = usePathname();
  const [scrolled, setScrolled] = useState(false);
  const [open, setOpen] = useState(false);

  useEffect(() => {
    const onScroll = () => setScrolled(window.scrollY > 40);
    onScroll();
    window.addEventListener('scroll', onScroll, { passive: true });
    return () => window.removeEventListener('scroll', onScroll);
  }, []);

  useEffect(() => setOpen(false), [pathname]);

  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => e.key === 'Escape' && setOpen(false);
    document.addEventListener('keydown', onKey);
    document.body.style.overflow = 'hidden';
    return () => {
      document.removeEventListener('keydown', onKey);
      document.body.style.overflow = '';
    };
  }, [open]);

  const other: Locale = lang === 'th' ? 'en' : 'th';
  const langHref = (l: Locale) => pathname.replace(/^\/(th|en)(?=\/|$)/, `/${l}`);
  const isActive = (path: string) =>
    path === '' ? pathname === `/${lang}` : !path.startsWith('/#') && pathname.startsWith(href(lang, path));

  return (
    <header className="fixed inset-x-0 top-0 z-50">
      {/* Utility bar — collapses once the page is scrolled */}
      <div
        className={`overflow-hidden bg-brand-800 text-[12px] text-brand-200 transition-[height] duration-300 ${scrolled ? 'h-0' : 'h-9'}`}
      >
        <div className="mx-auto flex h-9 max-w-[1240px] items-center justify-between gap-4 px-4 sm:px-6">
          <div className="flex items-center gap-4">
            <a href={`tel:${company.phoneTel}`} className="flex items-center gap-1.5 transition-colors hover:text-gold-200">
              <Phone className="h-3.5 w-3.5 text-gold-300" aria-hidden />
              {company.phone}
            </a>
            <span className="hidden text-gold-300/40 sm:inline">•</span>
            <a href={`mailto:${company.email}`} className="hidden items-center gap-1.5 transition-colors hover:text-gold-200 sm:flex">
              <Mail className="h-3.5 w-3.5 text-gold-300" aria-hidden />
              {company.email}
            </a>
            <span className="hidden text-gold-300/40 md:inline">•</span>
            <span className="hidden items-center gap-1.5 md:flex">
              <MapPin className="h-3.5 w-3.5 text-gold-300" aria-hidden />
              {t(landing.utilityLocation, lang)}
            </span>
          </div>
          <div className="flex items-center gap-4">
            <span className="hidden items-center gap-1.5 text-[11px] text-gold-200 lg:flex">
              <BadgeCheck className="h-3.5 w-3.5" aria-hidden />
              {t(landing.utilityBadge, lang)}
            </span>
            <span className="hidden text-gold-300/40 lg:inline">•</span>
            <div className="flex items-center gap-1 text-[11px] font-semibold tracking-wider">
              {(['th', 'en'] as const).map((l, i) => (
                <span key={l} className="flex items-center gap-1">
                  {i > 0 && <span className="text-brand-400">|</span>}
                  <Link
                    href={langHref(l)}
                    hrefLang={l}
                    aria-current={l === lang ? 'true' : undefined}
                    className={`rounded px-2 py-0.5 transition-colors ${l === lang ? 'bg-gold-300/15 text-gold-200' : 'hover:text-white'}`}
                  >
                    {l.toUpperCase()}
                  </Link>
                </span>
              ))}
            </div>
          </div>
        </div>
      </div>

      {/* Main navigation */}
      <div className={`relative border-b border-brand-100 bg-white/95 backdrop-blur-xl transition-shadow ${scrolled ? 'shadow-[0_6px_24px_-12px_rgb(15_30_54/0.25)]' : ''}`}>
        <div className={`mx-auto flex max-w-[1240px] items-center justify-between gap-6 px-4 transition-[height] duration-300 sm:px-6 ${scrolled ? 'h-16' : 'h-16 lg:h-20'}`}>
          <Link href={`/${lang}`} className="group flex shrink-0 items-center gap-3" aria-label={company.name[lang]}>
            <span className="grid h-11 w-14 place-items-center rounded-lg bg-white shadow-sm ring-1 ring-brand-100 transition-transform duration-300 group-hover:scale-105">
              <Image src="/img/pas-logo.png" alt="PAS" width={480} height={298} className="h-8 w-auto" priority />
            </span>
            <span className="flex min-w-0 flex-col leading-tight">
              <span className="text-[17px] font-bold tracking-wider text-brand-800">PAS</span>
              <span className="hidden text-[10px] font-medium uppercase tracking-[0.18em] text-gray-500 sm:block">Professional Accounting Service</span>
            </span>
          </Link>

          <nav className="hidden items-center gap-7 text-[13px] font-medium text-gray-600 xl:flex" aria-label="Main">
            {nav.map((item) => {
              const active = isActive(item.href);
              return (
                <Link
                  key={item.href}
                  href={href(lang, item.href)}
                  className={`group relative flex items-center gap-1.5 py-2 transition-colors hover:text-brand-800 ${active ? 'font-semibold text-brand-800' : ''}`}
                >
                  {t(item.label, lang)}
                  {item.href === '/#services' && (
                    <span className="rounded bg-gold-200/50 px-1.5 py-0.5 text-[10px] font-bold text-gold-700">{t(landing.servicesBadge, lang)}</span>
                  )}
                  <span
                    className={`absolute bottom-0 left-0 h-[2px] rounded-full bg-gold-500 transition-all duration-300 ${active ? 'w-full' : 'w-0 group-hover:w-full'}`}
                  />
                </Link>
              );
            })}
          </nav>

          <div className="flex shrink-0 items-center gap-2">
            <a
              href={company.requestForm}
              target="_blank"
              rel="noopener noreferrer"
              className="group relative hidden items-center gap-3 overflow-hidden rounded-lg border border-gold-300/30 bg-brand-800 px-5 py-2.5 text-white shadow-sm transition-colors hover:bg-brand-950 sm:inline-flex"
            >
              <span className="pointer-events-none absolute inset-y-0 left-0 w-1/3 animate-shine bg-gradient-to-r from-transparent via-white/15 to-transparent" />
              <span className="h-2 w-2 animate-pulse rounded-full bg-gold-300" />
              <span className="flex flex-col text-left leading-tight">
                <span className="text-[13px] font-bold text-gold-200">{t(ui.requestQuote, lang)}</span>
                <span className="text-[10px] font-semibold uppercase tracking-wider text-brand-300">{t(landing.quoteSub, lang)}</span>
              </span>
              <ArrowRight className="h-4 w-4 text-gold-300 transition-transform group-hover:translate-x-0.5" aria-hidden />
            </a>
            <button
              type="button"
              onClick={() => setOpen((v) => !v)}
              aria-expanded={open}
              aria-controls="mobile-menu"
              aria-label={t(open ? ui.close : ui.menu, lang)}
              className="rounded-lg p-2 text-brand-800 hover:bg-brand-50 xl:hidden"
            >
              {open ? <X className="h-6 w-6" /> : <Menu className="h-6 w-6" />}
            </button>
          </div>
        </div>
        <div className="scroll-progress absolute inset-x-0 -bottom-px h-[2px] bg-gradient-to-r from-gold-300 via-gold-500 to-gold-300" aria-hidden />
      </div>

      {open && (
        <div id="mobile-menu" className="h-[calc(100dvh-4rem)] overflow-y-auto bg-white px-4 pb-8 pt-2 xl:hidden">
          <nav className="flex flex-col" aria-label="Mobile">
            {nav.map((item, i) => (
              <Link
                key={item.href}
                href={href(lang, item.href)}
                onClick={() => setOpen(false)}
                style={{ '--i': i } as React.CSSProperties}
                className={`stagger flex animate-fade-up items-center justify-between border-b border-brand-50 py-4 text-lg font-medium ${
                  isActive(item.href) ? 'text-brand-800' : 'text-gray-700'
                }`}
              >
                {t(item.label, lang)}
                {isActive(item.href) && <span className="h-2 w-2 rounded-full bg-gold-500" />}
              </Link>
            ))}
          </nav>
          <div className="mt-6 grid gap-3">
            <a href={company.requestForm} target="_blank" rel="noopener noreferrer" className="rounded-lg bg-brand-800 py-3 text-center font-semibold text-gold-200">
              {t(ui.requestQuote, lang)}
            </a>
            <a href={company.requestForm} target="_blank" rel="noopener noreferrer" className="rounded-lg border border-brand-100 py-3 text-center font-medium text-brand-800">
              {t(ui.registerTraining, lang)}
            </a>
            <Link href={langHref(other)} hrefLang={other} className="py-2 text-center text-[14px] text-gray-500">
              {t(ui.switchLang, lang)}
            </Link>
          </div>
        </div>
      )}
    </header>
  );
}
