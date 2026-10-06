import { BadgeCheck, ChevronDown, Eye, Target } from 'lucide-react';
import type { Metadata } from 'next';
import Image from 'next/image';
import { Reveal } from '@/components/reveal';
import { ContactCta, PageHero, SectionHeading } from '@/components/sections';
import { about, certifications, isLocale, t, team, ui, type Locale } from '@/content/site';

export async function generateMetadata({ params }: { params: Promise<{ lang: string }> }): Promise<Metadata> {
  const { lang } = await params;
  if (!isLocale(lang)) return {};
  return {
    title: t(about.title, lang),
    description: t(about.lead, lang),
    alternates: { canonical: `/${lang}/about`, languages: { th: '/th/about', en: '/en/about' } },
  };
}

export default async function AboutPage({ params }: { params: Promise<{ lang: string }> }) {
  const { lang: raw } = await params;
  const lang = (isLocale(raw) ? raw : 'th') as Locale;

  return (
    <>
      <PageHero eyebrow="PAS" title={t(about.title, lang)} lead={t(about.lead, lang)} />

      {/* ── History ──────────────────────────────────────────── */}
      <section className="mx-auto grid max-w-7xl gap-14 px-4 py-20 sm:px-6 lg:grid-cols-[1.2fr_1fr] lg:px-8">
        <div>
          <SectionHeading eyebrow={lang === 'th' ? 'ตั้งแต่ปี 2539' : 'Since 1996'} title={t(about.historyTitle, lang)} />
          {about.history.map((p, i) => (
            <Reveal key={i} i={i + 1}>
              <p className="mt-5 text-[16px] leading-8 text-gray-600">{t(p, lang)}</p>
            </Reveal>
          ))}
        </div>
        <div className="relative">
          <Reveal className="relative overflow-hidden rounded-[2rem] shadow-xl">
            <Image src="/img/office-hero.webp" alt={lang === 'th' ? 'สำนักงาน PAS' : 'PAS office'} width={1024} height={482} className="aspect-[4/3] w-full object-cover" />
          </Reveal>
          <ol className="relative mt-10 space-y-6 border-l-2 border-dashed border-brand-200 pl-8">
            {about.timeline.map((m, i) => (
              <Reveal as="li" key={m.year.en} i={i} className="relative">
                <span className="absolute -left-[42px] top-1 grid h-5 w-5 place-items-center rounded-full bg-white ring-4 ring-brand-100">
                  <span className="h-2.5 w-2.5 rounded-full bg-gold-500" />
                </span>
                <p className="font-display text-2xl font-extrabold text-brand-600">{t(m.year, lang)}</p>
                <p className="text-gray-600">{t(m.text, lang)}</p>
              </Reveal>
            ))}
          </ol>
        </div>
      </section>

      {/* ── Certification ────────────────────────────────────── */}
      <section className="px-4 sm:px-6 lg:px-8">
        <Reveal className="mx-auto flex max-w-7xl flex-col items-center gap-8 rounded-[2rem] bg-gradient-to-br from-brand-50 via-white to-gold-50 p-8 ring-1 ring-brand-100 lg:flex-row lg:p-12">
          <div className="flex-1">
            <p className="flex items-center gap-2 font-semibold text-gold-500">
              <BadgeCheck className="h-5 w-5" aria-hidden /> {t(ui.certifiedBy, lang)}
            </p>
            <p className="mt-3 text-[17px] leading-8 text-gray-700">{t(about.certText, lang)}</p>
          </div>
          <div className="flex shrink-0 items-center gap-6">
            {certifications.map((c) => (
              <Image key={c.src} src={c.src} alt={t(c.alt, lang)} width={c.w} height={c.h} className="h-20 w-auto object-contain sm:h-24" />
            ))}
          </div>
        </Reveal>
      </section>

      {/* ── Mission & vision ────────────────────────────────── */}
      <section className="mx-auto grid max-w-7xl gap-6 px-4 py-20 sm:px-6 md:grid-cols-2 lg:px-8">
        {[
          { Icon: Target, title: about.missionTitle, body: about.mission, tone: 'from-brand-600 to-brand-800' },
          { Icon: Eye, title: about.visionTitle, body: about.vision, tone: 'from-gold-500 to-gold-700' },
        ].map(({ Icon, title, body, tone }, i) => (
          <Reveal key={title.en} i={i} className="group relative overflow-hidden rounded-3xl border border-gray-200 bg-white p-8 transition hover:shadow-xl hover:shadow-brand-900/5 lg:p-10">
            <span className={`grid h-14 w-14 place-items-center rounded-2xl bg-gradient-to-br ${tone} text-white shadow-lg transition group-hover:scale-110`}>
              <Icon className="h-7 w-7" aria-hidden />
            </span>
            <h2 className="mt-6 font-display text-2xl font-bold text-gray-900">{t(title, lang)}</h2>
            {body.map((p, j) => (
              <p key={j} className="mt-4 text-[15px] leading-7 text-gray-600">{t(p, lang)}</p>
            ))}
          </Reveal>
        ))}
      </section>

      {/* ── Team ─────────────────────────────────────────────── */}
      <section id="team" className="bg-surface-low py-24">
        <div className="mx-auto max-w-7xl px-4 sm:px-6 lg:px-8">
          <SectionHeading center eyebrow={lang === 'th' ? 'ทีมงาน' : 'Our people'} title={t(about.teamTitle, lang)} />
          <ul className="mt-14 grid gap-6 sm:grid-cols-2 lg:grid-cols-3">
            {team.map((m, i) => (
              <Reveal as="li" key={m.name.en} i={i % 3} className="group flex flex-col rounded-3xl border border-gray-200 bg-white p-7 text-center transition duration-300 hover:-translate-y-1 hover:shadow-xl hover:shadow-brand-900/5">
                <div className="relative mx-auto">
                  <div className="absolute -inset-1.5 rounded-full bg-gradient-to-tr from-gold-500 via-gold-300 to-brand-500 opacity-0 blur-[2px] transition duration-500 group-hover:opacity-100" />
                  <Image src={m.photo} alt={t(m.name, lang)} width={320} height={320} className="relative h-36 w-36 rounded-full bg-white object-cover object-top ring-4 ring-white" />
                  {m.yoe && (
                    <span className="absolute -right-2 bottom-1 rounded-full bg-brand-600 px-2.5 py-1 text-[12px] font-semibold text-white shadow-lg">
                      {m.yoe}+ {t(ui.yoe, lang)}
                    </span>
                  )}
                </div>
                <h3 className="mt-5 font-display text-lg font-bold text-gray-900">{t(m.name, lang)}</h3>
                <p className="text-[14px] font-medium text-brand-600">{t(m.role, lang)}</p>
                <p className="mt-3 text-[14px] text-gray-600">{t(m.qualification, lang)}</p>
                <details className="group/d mt-4 border-t border-gray-100 pt-4 text-left">
                  <summary className="flex cursor-pointer list-none items-center justify-center gap-1.5 text-[14px] font-medium text-gray-700 hover:text-brand-600 [&::-webkit-details-marker]:hidden">
                    {t(ui.experience, lang)}
                    <ChevronDown className="h-4 w-4 transition group-open/d:rotate-180" aria-hidden />
                  </summary>
                  <ul className="mt-3 space-y-2 text-[14px] leading-6 text-gray-600">
                    {m.experience.map((e) => (
                      <li key={e.en} className="flex gap-2">
                        <span className="mt-2 h-1.5 w-1.5 shrink-0 rounded-full bg-gold-500" />
                        {t(e, lang)}
                      </li>
                    ))}
                  </ul>
                </details>
              </Reveal>
            ))}
          </ul>
        </div>
      </section>

      <ContactCta lang={lang} />
    </>
  );
}
