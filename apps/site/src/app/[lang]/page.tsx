import {
  ArrowRight,
  ArrowUpRight,
  Award,
  BadgeCheck,
  Building2,
  Check,
  ChevronRight,
  Clock,
  FileCheck2,
  GraduationCap,
  Handshake,
  History,
  Landmark,
  Laptop,
  Mail,
  MapPin,
  Phone,
  Quote,
  ShieldCheck,
  Target,
  UsersRound,
  type LucideIcon,
} from 'lucide-react';
import Image from 'next/image';
import Link from 'next/link';
import { LineIcon, SERVICE_ICONS } from '@/components/icons';
import { CountUp } from '@/components/motion';
import { Reveal } from '@/components/reveal';
import { TestimonialCard } from '@/components/sections';
import { SpotlightGroup } from '@/components/spotlight';
import { clients, company, home, href, isLocale, landing, services, t, testimonials, ui, yearsSinceFounded, type Locale } from '@/content/site';
import { jsonLd, organizationJsonLd } from '@/lib/seo';

const HIGHLIGHT = { th: 'ที่น่าไว้วางใจ', en: 'Trusted' };
const ROMAN = ['I', 'II', 'III'];
const VALUE_ICONS: LucideIcon[] = [Target, Landmark, Handshake];
const PILLAR_ICONS: Record<string, LucideIcon> = { history: History, clients: Building2, team: UsersRound };
const RIBBON_ICONS: Record<string, LucideIcon> = { badge: BadgeCheck, shield: ShieldCheck, award: Award, cap: GraduationCap, file: FileCheck2 };
const TRUST_ICONS: Record<string, LucideIcon> = { clock: Clock, badge: BadgeCheck, team: UsersRound };

const v = (i: number) => ({ '--i': i }) as React.CSSProperties;

/** Headline split into words that rise in one after another; the highlight phrase gets the gold underline. */
function AnimatedTitle({ text, mark }: { text: string; mark: string }) {
  const at = text.indexOf(mark);
  const parts =
    at < 0
      ? [{ s: text, accent: false }]
      : [
          { s: text.slice(0, at), accent: false },
          { s: mark, accent: true },
          { s: text.slice(at + mark.length), accent: false },
        ];
  let n = 0;
  const word = (key: string, content: React.ReactNode) => (
    <span key={key} className="inline-block animate-word-in" style={{ animationDelay: `${n++ * 80}ms` }}>
      {content}
    </span>
  );
  return (
    <>
      {parts.flatMap((p, pi) =>
        p.accent
          ? [word(`a${pi}`, <span className="accent">{p.s}</span>)]
          : p.s
              .split(/(\s+)/)
              .filter(Boolean)
              .map((w, wi) => (/^\s+$/.test(w) ? ' ' : word(`${pi}-${wi}`, w))),
      )}
    </>
  );
}

function Eyebrow({ children, center = false, dark = false }: { children: React.ReactNode; center?: boolean; dark?: boolean }) {
  const line = `h-px w-10 shrink-0 ${dark ? 'bg-gold-300/50' : 'bg-gold-500/50'}`;
  return (
    <div className={`flex items-center gap-3 ${center ? 'justify-center text-center' : ''}`}>
      <span className={line} />
      <span className={`eyebrow text-[11px] font-semibold ${dark ? 'text-gold-200' : 'text-gold-600'}`}>{children}</span>
      {center && <span className={line} />}
    </div>
  );
}

export default async function HomePage({ params }: { params: Promise<{ lang: string }> }) {
  const { lang: raw } = await params;
  const lang = (isLocale(raw) ? raw : 'th') as Locale;
  const years = yearsSinceFounded();
  const other: Locale = lang === 'th' ? 'en' : 'th';

  return (
    <>
      <script type="application/ld+json" dangerouslySetInnerHTML={jsonLd(organizationJsonLd(lang))} />

      {/* ── Hero ─────────────────────────────────────────────── */}
      <section className="relative isolate overflow-hidden bg-gradient-to-b from-surface via-surface-low/60 to-surface pb-20 pt-40 lg:pb-28 lg:pt-52">
        <div className="pointer-events-none absolute inset-0 -z-10" aria-hidden>
          <div className="grid-pattern-light absolute inset-0" />
          <div className="absolute -top-40 right-1/4 h-[34rem] w-[34rem] animate-blob rounded-full bg-gold-200/40 blur-[120px]" />
          <div className="absolute left-0 top-1/2 h-[30rem] w-[30rem] animate-blob rounded-full bg-brand-100/80 blur-[110px] [animation-delay:-7s]" />
        </div>

        <div className="mx-auto max-w-[1240px] px-4 sm:px-6">
          <div className="stagger animate-fade-up">
            <Eyebrow center>{t(landing.eyebrow, lang).replace('{years}', String(years))}</Eyebrow>
          </div>

          <div className="mx-auto mt-8 max-w-4xl text-center">
            <h1 className="font-display text-[34px] font-bold leading-[1.25] tracking-tight text-brand-800 sm:text-5xl lg:text-[56px] lg:leading-[1.22]">
              <AnimatedTitle text={t(home.title, lang)} mark={HIGHLIGHT[lang]} />
            </h1>
            <p className="stagger mx-auto mt-6 max-w-2xl animate-fade-up text-lg leading-8 text-gray-600" style={v(6)}>
              {t(home.lead, lang)}
            </p>
          </div>

          <div className="stagger mt-10 flex animate-fade-up flex-wrap items-center justify-center gap-4" style={v(8)}>
            <a
              href={company.requestForm}
              target="_blank"
              rel="noopener noreferrer"
              className="group relative inline-flex items-center gap-3 overflow-hidden rounded-lg bg-brand-800 px-8 py-3.5 font-semibold text-gold-200 shadow-lg shadow-brand-800/20 transition hover:-translate-y-0.5 hover:bg-brand-950"
            >
              <span className="pointer-events-none absolute inset-y-0 left-0 w-1/3 animate-shine bg-gradient-to-r from-transparent via-white/20 to-transparent" />
              {t(ui.requestQuote, lang)}
              <ArrowUpRight className="h-4 w-4 transition group-hover:-translate-y-0.5 group-hover:translate-x-0.5" aria-hidden />
            </a>
            <Link
              href={href(lang, '/#services')}
              className="group inline-flex items-center gap-2 rounded-lg bg-white px-6 py-3.5 font-semibold text-brand-800 shadow-sm ring-1 ring-brand-100 transition hover:shadow-md"
            >
              {t(ui.ourServices, lang)}
              <ArrowRight className="h-4 w-4 text-gold-500 transition-transform group-hover:translate-x-1" aria-hidden />
            </Link>
          </div>

          {/* Brand card + three pillars */}
          <SpotlightGroup className="mt-16 grid items-stretch gap-5 lg:grid-cols-12">
            <div
              className="spot stagger group relative flex animate-fade-up flex-col justify-between overflow-hidden rounded-2xl bg-white p-8 shadow-sm ring-1 ring-brand-100/70 lg:col-span-4"
              style={v(9)}
            >
              <div className="pointer-events-none absolute -bottom-10 -right-10 h-44 w-44 rounded-full bg-gold-200/40 transition-transform duration-700 group-hover:scale-125" />
              <div className="relative">
                <div className="flex items-center justify-between">
                  <span className="eyebrow text-[11px] font-semibold text-gold-600">{t(landing.brandTag, lang)}</span>
                  <ShieldCheck className="h-5 w-5 text-gold-500" aria-hidden />
                </div>
                <div className="mt-7 flex items-center gap-4">
                  <span className="grid h-16 w-20 shrink-0 place-items-center rounded-xl bg-white shadow-inner ring-1 ring-brand-100">
                    <Image src="/img/pas-logo.png" alt="PAS" width={480} height={298} className="h-11 w-auto" />
                  </span>
                  <div>
                    <p className="text-[17px] font-bold leading-snug text-brand-800">{t(company.brand, lang)}</p>
                    <p className="mt-0.5 text-[12px] font-semibold text-gold-600">{t(landing.brandSince, lang)}</p>
                  </div>
                </div>
                <ul className="mt-6 space-y-2.5">
                  {home.bullets.map((b) => (
                    <li key={b.en} className="flex gap-2.5 text-[14px] leading-6 text-gray-600">
                      <span className="mt-1 grid h-4 w-4 shrink-0 place-items-center rounded-full bg-gold-200/60 text-gold-700">
                        <Check className="h-3 w-3" strokeWidth={3} aria-hidden />
                      </span>
                      {t(b, lang)}
                    </li>
                  ))}
                </ul>
              </div>
              <div className="relative mt-7 flex items-center justify-between border-t border-brand-50 pt-5">
                <span className="text-[13px] font-medium text-brand-800">{t(landing.hq, lang)}</span>
                <span className="relative flex h-2.5 w-2.5">
                  <span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-gold-400 opacity-60" />
                  <span className="relative inline-flex h-2.5 w-2.5 rounded-full bg-gold-500" />
                </span>
              </div>
            </div>

            <div className="grid gap-5 md:grid-cols-3 lg:col-span-8">
              {landing.pillars.map((p, i) => {
                const Icon = PILLAR_ICONS[p.icon];
                const value = p.value === 'years' ? years : (p.value as number);
                return (
                  <div
                    key={p.icon}
                    className="spot stagger group relative flex animate-fade-up flex-col justify-between overflow-hidden rounded-2xl bg-white p-7 shadow-sm ring-1 ring-brand-100/70 transition duration-300 hover:-translate-y-1 hover:shadow-xl hover:shadow-brand-900/5"
                    style={v(10 + i)}
                  >
                    <span className="absolute inset-x-0 top-0 h-[3px] bg-gradient-to-r from-gold-300 to-gold-500 opacity-40 transition-opacity duration-500 group-hover:opacity-100" />
                    <div className="flex items-center justify-between text-gold-500">
                      <Icon className="h-7 w-7 transition-transform duration-500 group-hover:-rotate-8 group-hover:scale-110" aria-hidden />
                      <span className="eyebrow text-[10px] font-semibold text-gray-400">{t(p.tag, lang)}</span>
                    </div>
                    <div className="mt-8">
                      <p className="font-display text-[44px] font-bold leading-none tracking-tight text-gold-600">
                        <CountUp to={value} suffix={p.value === 'years' ? '' : '+'} />
                      </p>
                      <p className="mt-3 text-[16px] font-semibold text-brand-800">{t(p.title, lang)}</p>
                      <p className="mt-2 text-[13px] leading-5 text-gray-500">{t(p.desc, lang)}</p>
                    </div>
                    <p className="mt-6 border-t border-brand-50 pt-4 text-[11px] font-semibold tracking-wide text-gold-600">{t(p.foot, lang)}</p>
                  </div>
                );
              })}
            </div>
          </SpotlightGroup>
        </div>
      </section>

      {/* ── Accreditation ribbon (scrolling) ─────────────────── */}
      <section className="border-y border-brand-100/60 bg-surface-low/80 py-6">
        <div className="mx-auto flex max-w-[1240px] flex-col items-center gap-5 px-4 sm:px-6 lg:flex-row">
          <div className="flex shrink-0 items-center gap-2.5">
            <Award className="h-5 w-5 text-gold-500" aria-hidden />
            <span className="eyebrow text-[12px] font-semibold text-brand-800">{t(landing.ribbonTitle, lang)}</span>
          </div>
          <div className="marquee relative w-full overflow-hidden [mask-image:linear-gradient(to_right,transparent,#000_8%,#000_92%,transparent)]">
            <ul className="flex w-max animate-marquee items-center gap-12 pr-12 [animation-duration:32s]">
              {[...landing.ribbon, ...landing.ribbon].map((r, i) => {
                const Icon = RIBBON_ICONS[r.icon];
                return (
                  <li key={i} aria-hidden={i >= landing.ribbon.length} className="flex shrink-0 items-center gap-2">
                    <Icon className="h-[18px] w-[18px] text-gold-500" aria-hidden />
                    <span className="text-[13px] font-semibold text-brand-800">{t(r.title, lang)}</span>
                    <span className="text-[12px] text-gray-500">({t(r.sub, lang)})</span>
                  </li>
                );
              })}
            </ul>
          </div>
        </div>
      </section>

      {/* ── Managing director banner + 3C philosophy ─────────── */}
      <section className="mx-auto max-w-[1240px] px-4 py-24 sm:px-6">
        <Reveal className="relative overflow-hidden rounded-3xl bg-brand-800 p-8 text-white shadow-2xl shadow-brand-900/20 sm:p-12 lg:p-14">
          <div className="pointer-events-none absolute -bottom-24 -right-24 h-96 w-96 animate-blob rounded-full bg-gold-300/10 blur-3xl" />
          <div className="pointer-events-none absolute inset-y-0 left-0 w-1/4 animate-shine bg-gradient-to-r from-transparent via-white/[0.05] to-transparent [animation-duration:7s]" />
          <div className="relative grid items-center gap-10 lg:grid-cols-[auto_1fr]">
            <div className="relative mx-auto">
              <div className="absolute -inset-2 animate-spin rounded-full bg-[conic-gradient(from_0deg,transparent,rgb(254_206_87/0.9),transparent_40%)] [animation-duration:10s]" />
              <Image
                src="/img/team/koravich.webp"
                alt={t(home.md.name, lang)}
                width={480}
                height={493}
                className="relative h-44 w-44 rounded-full object-cover ring-4 ring-brand-800 lg:h-52 lg:w-52"
              />
            </div>
            <div className="text-center lg:text-left">
              <Quote className="mx-auto h-9 w-9 text-gold-300 lg:mx-0" aria-hidden />
              <h2 className="mt-4 font-serif text-3xl font-medium leading-snug text-white sm:text-4xl">{t(home.whyTitle, lang)}</h2>
              <p className="mt-4 max-w-2xl text-lg leading-8 text-brand-200">{t(home.whyLead, lang)}</p>
              <p className="mt-6 text-lg font-semibold tracking-wide text-gold-200">{t(home.md.name, lang)}</p>
              <p className="eyebrow mt-1 text-[11px] text-brand-300">
                {t(home.md.role, lang)} · {t(company.name, lang)}
              </p>
            </div>
          </div>
        </Reveal>

        <Reveal className="mx-auto mt-24 max-w-3xl text-center">
          <Eyebrow center>{t(landing.philosophyEyebrow, lang)}</Eyebrow>
          <h2 className="mt-4 font-display text-3xl font-bold tracking-tight text-brand-800 sm:text-[40px] sm:leading-[1.2]">{t(landing.philosophyTitle, lang)}</h2>
          <p className="mt-4 text-[16px] leading-7 text-gray-600">{t(landing.philosophyLead, lang)}</p>
        </Reveal>

        <SpotlightGroup className="mt-14 grid gap-6 md:grid-cols-3">
          {home.values.map((val, i) => {
            const Icon = VALUE_ICONS[i];
            return (
              <Reveal
                key={val.title.en}
                i={i}
                className="spot group flex flex-col justify-between rounded-2xl bg-white p-9 shadow-sm ring-1 ring-brand-100/70 transition duration-300 hover:-translate-y-1 hover:shadow-xl hover:shadow-brand-900/5"
              >
                <span className="absolute inset-x-8 top-0 h-[2px] bg-gold-400/40 transition-colors group-hover:bg-gold-500" />
                <div>
                  <div className="flex items-center justify-between pt-2">
                    <span className="font-serif text-3xl font-semibold tracking-widest text-gold-500">{ROMAN[i]}</span>
                    <span className="grid h-11 w-11 place-items-center rounded-full bg-brand-800 text-gold-200 transition duration-300 group-hover:rotate-12 group-hover:bg-gold-500 group-hover:text-white">
                      <Icon className="h-5 w-5" aria-hidden />
                    </span>
                  </div>
                  <h3 className="mt-7 text-xl font-bold text-brand-800">{t(val.title, lang)}</h3>
                  <p className="eyebrow mt-1 text-[11px] font-semibold text-gold-600">{t(val.title, other)}</p>
                  <p className="mt-4 text-[15px] leading-7 text-gray-600">“{t(val.quote, lang)}”</p>
                </div>
                <Link href={href(lang, '/about')} className="mt-8 inline-flex items-center gap-1 text-[13px] font-semibold text-brand-800 transition-colors group-hover:text-gold-600">
                  {t(ui.readMore, lang)}
                  <ChevronRight className="h-4 w-4 text-gold-500 transition-transform group-hover:translate-x-1" aria-hidden />
                </Link>
              </Reveal>
            );
          })}
        </SpotlightGroup>
      </section>

      {/* ── Services ─────────────────────────────────────────── */}
      <section id="services" className="bg-surface-low/70 py-24">
        <div className="mx-auto max-w-[1240px] px-4 sm:px-6">
          <Reveal className="flex flex-col justify-between gap-6 md:flex-row md:items-end">
            <div>
              <Eyebrow>{t(landing.servicesEyebrow, lang)}</Eyebrow>
              <h2 className="mt-4 font-display text-3xl font-bold tracking-tight text-brand-800 sm:text-[40px] sm:leading-[1.2]">{t(home.servicesTitle, lang)}</h2>
            </div>
            <p className="max-w-md text-[16px] leading-7 text-gray-600">{t(home.servicesLead, lang)}</p>
          </Reveal>

          <SpotlightGroup className="mt-14 grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
            {services.map((s, i) => {
              const Icon = SERVICE_ICONS[s.icon];
              return (
                <Reveal
                  key={s.icon}
                  i={i % 4}
                  className="spot group flex flex-col justify-between overflow-hidden rounded-2xl bg-white p-7 shadow-sm ring-1 ring-brand-100/70 transition duration-300 hover:-translate-y-1.5 hover:shadow-xl hover:shadow-brand-900/10"
                >
                  <span className="absolute inset-x-0 bottom-0 h-[3px] origin-left scale-x-0 bg-gradient-to-r from-gold-300 to-gold-500 transition-transform duration-500 group-hover:scale-x-100" />
                  <div>
                    <div className="flex items-center justify-between">
                      <span className="font-mono text-[13px] font-bold text-gold-600">{String(i + 1).padStart(2, '0')}</span>
                      <Icon className="h-6 w-6 text-gray-400 transition duration-300 group-hover:-rotate-6 group-hover:scale-110 group-hover:text-gold-500" aria-hidden />
                    </div>
                    <h3 className="mt-5 text-[16px] font-bold leading-snug text-brand-800 transition-colors group-hover:text-gold-700">{t(s.title, lang)}</h3>
                    <p className="mt-2 text-[13px] leading-6 text-gray-600">{t(s.desc, lang)}</p>
                  </div>
                  <a
                    href={company.requestForm}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="mt-6 inline-flex items-center gap-1 text-[12px] font-semibold text-gold-600 transition-transform group-hover:translate-x-1"
                  >
                    {t(landing.askAbout, lang)}
                    <ArrowRight className="h-3.5 w-3.5" aria-hidden />
                  </a>
                </Reveal>
              );
            })}
          </SpotlightGroup>
        </div>
      </section>

      {/* ── Clients + testimonials ───────────────────────────── */}
      <section className="py-24">
        <Reveal className="mx-auto max-w-[1240px] px-4 text-center sm:px-6">
          <Eyebrow center>{t(home.testimonialsTitle, lang)}</Eyebrow>
          <h2 className="mt-4 font-display text-2xl font-bold text-brand-800 sm:text-3xl">{t(home.clientsTitle, lang).replace('{years}', String(years))}</h2>
        </Reveal>
        <div className="marquee relative mt-12 overflow-hidden [mask-image:linear-gradient(to_right,transparent,#000_10%,#000_90%,transparent)]">
          <ul className="flex w-max animate-marquee items-center gap-14 pr-14">
            {[...clients, ...clients].map((c, i) => (
              <li key={i} aria-hidden={i >= clients.length} className="shrink-0">
                <Image
                  src={c.src}
                  alt={i >= clients.length ? '' : c.alt}
                  width={c.w}
                  height={c.h}
                  className="h-14 w-auto max-w-[170px] object-contain opacity-60 grayscale transition duration-300 hover:scale-110 hover:opacity-100 hover:grayscale-0"
                />
              </li>
            ))}
          </ul>
        </div>
        <div className="mx-auto mt-16 grid max-w-[1240px] gap-6 px-4 sm:px-6 md:grid-cols-2">
          {[testimonials[0], testimonials[1]].map((x, i) => (
            <TestimonialCard key={x.name} lang={lang} i={i} {...x} />
          ))}
        </div>
        <Reveal className="mt-10 text-center">
          <Link href={href(lang, '/testimonials')} className="group inline-flex items-center gap-2 text-[14px] font-semibold text-brand-800 hover:text-gold-600">
            {t(ui.allTestimonials, lang)} <ArrowRight className="h-4 w-4 text-gold-500 transition group-hover:translate-x-1" aria-hidden />
          </Link>
        </Reveal>
      </section>

      {/* ── Chiang Mai office ────────────────────────────────── */}
      <section className="bg-white py-24">
        <div className="mx-auto grid max-w-[1240px] items-center gap-12 px-4 sm:px-6 lg:grid-cols-2">
          <div>
            <Reveal>
              <div className="flex items-center gap-2">
                <MapPin className="h-5 w-5 text-gold-500" aria-hidden />
                <span className="eyebrow text-[11px] font-semibold text-gold-600">{t(landing.officeEyebrow, lang)}</span>
              </div>
              <h2 className="mt-4 font-display text-3xl font-bold tracking-tight text-brand-800 sm:text-[40px] sm:leading-[1.2]">{t(home.officeTitle, lang)}</h2>
              <p className="mt-5 text-lg leading-8 text-gray-600">{t(home.office, lang)}</p>
            </Reveal>

            <Reveal i={1} className="mt-8 rounded-2xl bg-surface-low p-6">
              <div className="flex items-start gap-4">
                <MapPin className="mt-1 h-5 w-5 shrink-0 text-gold-500" aria-hidden />
                <div>
                  <p className="font-semibold text-brand-800">{t(landing.addressLabel, lang)}</p>
                  <p className="mt-1 text-[14px] leading-6 text-gray-600">{t(company.address, lang)}</p>
                </div>
              </div>
              <div className="mt-5 flex flex-col gap-5 border-t border-brand-100 pt-5 sm:flex-row sm:gap-10">
                <a href={`tel:${company.phoneTel}`} className="group flex items-center gap-3">
                  <Phone className="h-5 w-5 text-gold-500 transition group-hover:rotate-12" aria-hidden />
                  <span>
                    <span className="eyebrow block text-[10px] text-gray-500">{lang === 'th' ? 'โทรศัพท์' : 'Telephone'}</span>
                    <span className="block text-[14px] font-semibold text-brand-800">
                      {company.phone} / {company.phoneLocal}
                    </span>
                  </span>
                </a>
                <a href={`mailto:${company.email}`} className="group flex items-center gap-3">
                  <Mail className="h-5 w-5 text-gold-500 transition group-hover:-rotate-12" aria-hidden />
                  <span>
                    <span className="eyebrow block text-[10px] text-gray-500">{lang === 'th' ? 'อีเมล' : 'Email'}</span>
                    <span className="block text-[14px] font-semibold text-brand-800">{company.email}</span>
                  </span>
                </a>
              </div>
            </Reveal>

            <Reveal i={2} className="mt-6 grid grid-cols-2 gap-4">
              {[
                { Icon: Building2, label: landing.inPerson },
                { Icon: Laptop, label: landing.online },
              ].map(({ Icon, label }) => (
                <div key={label.en} className="flex items-center gap-3 rounded-xl bg-white p-4 shadow-sm ring-1 ring-brand-100/70">
                  <Icon className="h-5 w-5 text-gold-500" aria-hidden />
                  <span className="text-[13px] font-semibold text-brand-800">{t(label, lang)}</span>
                </div>
              ))}
            </Reveal>
          </div>

          <Reveal i={1} className="relative overflow-hidden rounded-3xl shadow-2xl shadow-brand-900/15">
            <div className="relative h-[420px] overflow-hidden sm:h-[480px]">
              <Image
                src="/img/office-hero.webp"
                alt={lang === 'th' ? 'อาคารสำนักงาน PAS เชียงใหม่' : 'PAS office building, Chiang Mai'}
                fill
                sizes="(min-width: 1024px) 600px, 100vw"
                className="parallax-zoom object-cover"
              />
              <div className="absolute inset-0 bg-gradient-to-t from-brand-950/40 via-transparent to-transparent" />
            </div>
            <div className="absolute inset-x-5 bottom-5 flex items-center justify-between gap-4 rounded-2xl bg-white/90 p-5 shadow-lg backdrop-blur-md">
              <div>
                <p className="eyebrow text-[10px] font-semibold text-gold-600">{t(landing.officeCard, lang)}</p>
                <p className="mt-1 font-semibold text-brand-800">{t(landing.utilityLocation, lang)}</p>
                <p className="text-[13px] text-gray-500">
                  {t(company.hours.weekdays, lang)} · {t(company.hours.weekdayTime, lang)}
                </p>
              </div>
              <Link
                href={href(lang, '/contact')}
                aria-label={t(ui.contactNow, lang)}
                className="grid h-12 w-12 shrink-0 place-items-center rounded-full bg-brand-800 text-gold-200 transition hover:scale-110 hover:bg-gold-500 hover:text-white"
              >
                <ArrowUpRight className="h-5 w-5" aria-hidden />
              </Link>
            </div>
          </Reveal>
        </div>
      </section>

      {/* ── Consultation ─────────────────────────────────────── */}
      <section id="consult" className="relative isolate overflow-hidden bg-brand-800 py-24 text-white">
        <div className="pointer-events-none absolute -top-48 left-1/3 -z-10 h-[36rem] w-[36rem] animate-blob rounded-full bg-gold-300/15 blur-[140px]" aria-hidden />
        <div className="grid-pattern pointer-events-none absolute inset-0 -z-10" aria-hidden />
        <div className="mx-auto max-w-[1240px] px-4 sm:px-6">
          <Reveal className="mx-auto max-w-3xl text-center">
            <Eyebrow center dark>
              {t(landing.consultEyebrow, lang)}
            </Eyebrow>
            <h2 className="mt-4 font-serif text-3xl font-medium tracking-tight sm:text-[40px] sm:leading-[1.25]">{t(home.askTitle, lang)}</h2>
            <p className="mt-4 text-[16px] leading-7 text-brand-200">{t(home.askLead, lang)}</p>
          </Reveal>

          <Reveal i={1} className="glow-border mx-auto mt-14 max-w-4xl rounded-3xl">
            <div className="grid gap-8 rounded-3xl bg-brand-900 p-8 sm:p-10 md:grid-cols-[auto_1fr] md:items-center">
              <a
                href={company.line.url}
                target="_blank"
                rel="noopener noreferrer"
                className="group mx-auto flex flex-col items-center gap-3 rounded-2xl bg-white p-4 text-center text-gray-800 transition hover:-translate-y-1 hover:shadow-2xl"
              >
                <Image src="/img/line-qr.png" alt="LINE QR" width={180} height={180} className="h-36 w-36 rounded-lg" />
                <span className="inline-flex items-center gap-1.5 rounded-full bg-[#06C755] px-3 py-1 text-[12px] font-semibold text-white">
                  <LineIcon className="h-4 w-4" /> {company.line.name}
                </span>
                <span className="text-[12px] text-gray-500">{t(home.lineScan, lang)}</span>
              </a>

              <div className="flex flex-col gap-4">
                <a
                  href={company.requestForm}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="group relative inline-flex items-center justify-between gap-3 overflow-hidden rounded-xl bg-gold-300 px-6 py-4 font-bold text-brand-900 shadow-lg transition hover:-translate-y-0.5 hover:bg-gold-200"
                >
                  <span className="pointer-events-none absolute inset-y-0 left-0 w-1/3 animate-shine bg-gradient-to-r from-transparent via-white/40 to-transparent" />
                  {t(ui.requestQuote, lang)}
                  <ArrowUpRight className="h-5 w-5 transition group-hover:-translate-y-0.5 group-hover:translate-x-0.5" aria-hidden />
                </a>
                <a
                  href={company.requestForm}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="inline-flex items-center justify-between gap-3 rounded-xl px-6 py-4 font-semibold text-gold-200 ring-1 ring-gold-300/30 transition hover:bg-white/5"
                >
                  {t(ui.registerTraining, lang)}
                  <GraduationCap className="h-5 w-5" aria-hidden />
                </a>
                <div className="grid gap-3 sm:grid-cols-2">
                  <a href={`tel:${company.phoneTel}`} className="flex items-center gap-3 rounded-xl bg-white/5 px-4 py-3 text-[14px] ring-1 ring-white/10 transition hover:bg-white/10">
                    <Phone className="h-4 w-4 text-gold-300" aria-hidden /> {company.phoneLocal}
                  </a>
                  <a href={`mailto:${company.email}`} className="flex items-center gap-3 rounded-xl bg-white/5 px-4 py-3 text-[14px] ring-1 ring-white/10 transition hover:bg-white/10">
                    <Mail className="h-4 w-4 text-gold-300" aria-hidden /> {company.email}
                  </a>
                </div>
              </div>
            </div>
          </Reveal>

          <Reveal i={2} className="mt-14 flex flex-wrap items-center justify-center gap-x-10 gap-y-4 text-[12px] font-semibold text-brand-300">
            {landing.trust.map((x) => {
              const Icon = TRUST_ICONS[x.icon];
              return (
                <span key={x.icon} className="flex items-center gap-2">
                  <Icon className="h-4 w-4 text-gold-300" aria-hidden /> {t(x.text, lang)}
                </span>
              );
            })}
          </Reveal>
        </div>
      </section>
    </>
  );
}
