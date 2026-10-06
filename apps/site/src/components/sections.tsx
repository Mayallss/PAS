import { ArrowUpRight, Mail, Phone, Quote } from 'lucide-react';
import Image from 'next/image';
import { company, home, t, ui, type Locale, type T } from '@/content/site';
import { LineIcon } from './icons';
import { Reveal } from './reveal';

/** Navy band at the top of inner pages (below the fixed header). */
export function PageHero({ title, lead, eyebrow }: { title: string; lead: string; eyebrow?: string }) {
  return (
    <section className="relative isolate overflow-hidden bg-brand-900 pb-20 pt-40 text-white lg:pb-28 lg:pt-52">
      <Backdrop />
      <div className="relative mx-auto max-w-7xl px-4 sm:px-6 lg:px-8">
        {eyebrow && <p className="stagger animate-fade-up text-[13px] font-semibold eyebrow text-gold-300">{eyebrow}</p>}
        <h1 className="stagger mt-3 max-w-3xl animate-fade-up font-display text-4xl font-bold tracking-tight sm:text-5xl lg:text-6xl" style={{ '--i': 1 } as React.CSSProperties}>
          {title}
        </h1>
        <p className="stagger mt-5 max-w-2xl animate-fade-up text-lg text-white/75" style={{ '--i': 2 } as React.CSSProperties}>
          {lead}
        </p>
      </div>
      <Swoosh className="absolute -bottom-px left-0 w-full text-surface" />
    </section>
  );
}

/** Animated gradient blobs + fine grid behind dark sections. */
export function Backdrop() {
  return (
    <div className="pointer-events-none absolute inset-0 -z-10" aria-hidden>
      <div className="absolute inset-0 bg-gradient-to-br from-brand-950 via-brand-800 to-brand-600" />
      <div className="absolute -left-32 top-10 h-[28rem] w-[28rem] animate-blob rounded-full bg-brand-400/25 blur-3xl" />
      <div className="absolute -right-24 bottom-0 h-[24rem] w-[24rem] animate-blob rounded-full bg-gold-500/25 blur-3xl [animation-delay:-6s]" />
      <div className="absolute right-1/3 top-1/4 h-64 w-64 animate-blob rounded-full bg-gold-300/15 blur-3xl [animation-delay:-12s]" />
      <div className="grid-pattern absolute inset-0" />
    </div>
  );
}

/** Curved gold swoosh (echoes the PAS logo), used as a section divider. */
export function Swoosh({ className = '' }: { className?: string }) {
  return (
    <svg viewBox="0 0 1440 120" preserveAspectRatio="none" className={`h-16 lg:h-24 ${className}`} aria-hidden>
      <path d="M0 120V80C240 20 520 0 820 30s480 70 620 40v50Z" fill="currentColor" />
      <path d="M0 78C260 16 540 -4 830 26s470 70 610 40" fill="none" stroke="#C9A227" strokeWidth="4" className="animate-swoosh" />
      <path d="M0 90C300 34 560 18 840 44s460 58 600 34" fill="none" stroke="#FECE57" strokeWidth="3" className="animate-swoosh [animation-delay:250ms]" />
    </svg>
  );
}

export function SectionHeading({ eyebrow, title, lead, center = false, dark = false }: { eyebrow?: string; title: string; lead?: string; center?: boolean; dark?: boolean }) {
  return (
    <Reveal className={center ? 'mx-auto max-w-3xl text-center' : 'max-w-3xl'}>
      {eyebrow && <p className={`text-[13px] font-semibold eyebrow ${dark ? 'text-gold-300' : 'text-gold-500'}`}>{eyebrow}</p>}
      <h2 className={`mt-3 font-display text-3xl font-bold tracking-tight sm:text-4xl ${dark ? 'text-white' : 'text-gray-900'}`}>{title}</h2>
      {lead && <p className={`mt-4 text-lg ${dark ? 'text-white/70' : 'text-gray-600'}`}>{lead}</p>}
    </Reveal>
  );
}

export function TestimonialCard({
  lang,
  quote,
  name,
  role,
  photo,
  logo,
  logoAlt,
  i = 0,
  clamp = false,
}: {
  lang: Locale;
  quote: T;
  name: string;
  role: string;
  photo: string;
  logo: string;
  logoAlt: string;
  i?: number;
  clamp?: boolean;
}) {
  return (
    <Reveal as="figure" i={i} className="group relative flex h-full flex-col rounded-3xl border border-gray-200 bg-white p-7 shadow-sm transition duration-300 hover:-translate-y-1 hover:border-brand-200 hover:shadow-xl hover:shadow-brand-900/5">
      <Quote className="h-8 w-8 text-gold-300" aria-hidden />
      <blockquote className={`mt-4 flex-1 text-[15px] leading-7 text-gray-700 ${clamp ? 'line-clamp-6' : ''}`}>“{t(quote, lang)}”</blockquote>
      <figcaption className="mt-6 flex items-center gap-4 border-t border-gray-100 pt-5">
        <Image src={photo} alt={name} width={112} height={112} className="h-14 w-14 rounded-full object-cover ring-4 ring-brand-50" />
        <div className="min-w-0 flex-1">
          <p className="font-semibold text-gray-900">{name}</p>
          <p className="text-[13px] leading-snug text-gray-500">{role}</p>
        </div>
        <Image src={logo} alt={logoAlt} width={160} height={80} className="hidden h-10 w-16 object-contain opacity-70 grayscale transition group-hover:opacity-100 group-hover:grayscale-0 sm:block" />
      </figcaption>
    </Reveal>
  );
}

/** Closing call-to-action: LINE QR, phone, e-mail and the quote form. */
export function ContactCta({ lang }: { lang: Locale }) {
  return (
    <section className="px-4 py-20 sm:px-6 lg:px-8">
      <Reveal className="relative isolate mx-auto max-w-7xl overflow-hidden rounded-[2rem] px-6 py-14 text-white sm:px-12 lg:py-16">
        <Backdrop />
        <div className="grid items-center gap-10 lg:grid-cols-[1fr_auto]">
          <div>
            <h2 className="font-display text-3xl font-bold tracking-tight sm:text-4xl">{t(home.askTitle, lang)}</h2>
            <p className="mt-3 max-w-xl text-lg text-white/75">{t(home.askLead, lang)}</p>
            <div className="mt-8 flex flex-wrap gap-3">
              <a href={company.requestForm} target="_blank" rel="noopener noreferrer" className="inline-flex items-center gap-2 rounded-full bg-gold-300 px-6 py-3 font-semibold text-brand-900 shadow-lg shadow-black/20 transition hover:-translate-y-0.5">
                {t(ui.requestQuote, lang)} <ArrowUpRight className="h-4 w-4" aria-hidden />
              </a>
              <a href={`tel:${company.phoneTel}`} className="inline-flex items-center gap-2 rounded-full bg-white/10 px-6 py-3 font-medium ring-1 ring-white/20 backdrop-blur transition hover:bg-white/20">
                <Phone className="h-4 w-4" aria-hidden /> {company.phoneLocal}
              </a>
              <a href={`mailto:${company.email}`} className="inline-flex items-center gap-2 rounded-full bg-white/10 px-6 py-3 font-medium ring-1 ring-white/20 backdrop-blur transition hover:bg-white/20">
                <Mail className="h-4 w-4" aria-hidden /> {company.email}
              </a>
            </div>
          </div>
          <a href={company.line.url} target="_blank" rel="noopener noreferrer" className="group flex items-center gap-5 rounded-3xl bg-white p-4 pr-6 text-gray-800 shadow-2xl transition hover:-translate-y-1">
            <Image src="/img/line-qr.png" alt="LINE QR" width={180} height={180} className="h-28 w-28 rounded-xl" />
            <div>
              <span className="inline-flex items-center gap-1.5 rounded-full bg-[#06C755] px-3 py-1 text-[13px] font-semibold text-white">
                <LineIcon className="h-4 w-4" /> LINE
              </span>
              <p className="mt-2 font-semibold">{company.line.name}</p>
              <p className="text-[13px] text-gray-500">{t(home.lineScan, lang)}</p>
            </div>
          </a>
        </div>
      </Reveal>
    </section>
  );
}
