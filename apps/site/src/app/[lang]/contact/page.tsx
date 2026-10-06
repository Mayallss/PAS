import { ArrowUpRight, Clock, Mail, MapPin, Phone } from 'lucide-react';
import type { Metadata } from 'next';
import { FacebookIcon, LineIcon, LinkedInIcon, TikTokIcon } from '@/components/icons';
import { MapEmbed } from '@/components/map-embed';
import { Reveal } from '@/components/reveal';
import { PageHero } from '@/components/sections';
import { company, contactPage, isLocale, t, ui, type Locale } from '@/content/site';

export async function generateMetadata({ params }: { params: Promise<{ lang: string }> }): Promise<Metadata> {
  const { lang } = await params;
  if (!isLocale(lang)) return {};
  return {
    title: t(contactPage.title, lang),
    description: `${t(contactPage.lead, lang)} — ${t(company.address, lang)} · ${company.phone} · ${company.email}`,
    alternates: { canonical: `/${lang}/contact`, languages: { th: '/th/contact', en: '/en/contact' } },
  };
}

export default async function ContactPage({ params }: { params: Promise<{ lang: string }> }) {
  const { lang: raw } = await params;
  const lang = (isLocale(raw) ? raw : 'th') as Locale;
  const days = lang === 'th' ? ['จันทร์', 'อังคาร', 'พุธ', 'พฤหัสบดี', 'ศุกร์'] : ['Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday'];
  const channels = [
    { Icon: Mail, label: t(contactPage.email, lang), value: company.email, href: `mailto:${company.email}`, tone: 'bg-brand-50 text-brand-600' },
    { Icon: Phone, label: t(contactPage.phone, lang), value: company.phone, href: `tel:${company.phoneTel}`, tone: 'bg-brand-50 text-brand-600' },
    { Icon: LineIcon, label: 'LINE', value: company.line.name, href: company.line.url, tone: 'bg-[#06C755]/10 text-[#06C755]', external: true },
    { Icon: FacebookIcon, label: 'Facebook', value: 'pas.acc', href: company.facebook, tone: 'bg-[#1877F2]/10 text-[#1877F2]', external: true },
    { Icon: TikTokIcon, label: 'TikTok', value: company.tiktok.handle, href: company.tiktok.url, tone: 'bg-gray-100 text-gray-900', external: true },
    { Icon: LinkedInIcon, label: 'LinkedIn', value: 'Professional Accounting Service', href: company.linkedin, tone: 'bg-[#0A66C2]/10 text-[#0A66C2]', external: true },
  ];

  return (
    <>
      <PageHero eyebrow={t(contactPage.office, lang)} title={t(contactPage.title, lang)} lead={t(contactPage.lead, lang)} />

      <section className="mx-auto grid max-w-7xl gap-8 px-4 py-20 sm:px-6 lg:grid-cols-[1fr_1.15fr] lg:px-8">
        <div className="space-y-6">
          <Reveal className="rounded-3xl border border-gray-200 p-7">
            <h2 className="flex items-center gap-2 text-lg font-bold text-gray-900">
              <MapPin className="h-5 w-5 text-gold-500" aria-hidden /> {t(contactPage.office, lang)}
            </h2>
            <address className="mt-3 not-italic leading-7 text-gray-600">
              {t(company.name, lang)}
              <br />
              {t(company.address, lang)}
            </address>
          </Reveal>

          <Reveal i={1} className="rounded-3xl border border-gray-200 p-7">
            <h2 className="flex items-center gap-2 text-lg font-bold text-gray-900">
              <Clock className="h-5 w-5 text-gold-500" aria-hidden /> {t(contactPage.hours, lang)}
            </h2>
            <dl className="mt-4 divide-y divide-gray-100 text-[15px]">
              {days.map((d) => (
                <div key={d} className="flex justify-between py-2">
                  <dt className="text-gray-600">{d}</dt>
                  <dd className="font-medium text-gray-900">{t(company.hours.weekdayTime, lang)}</dd>
                </div>
              ))}
              <div className="flex justify-between py-2">
                <dt className="text-gray-600">{t(company.hours.weekend, lang)}</dt>
                <dd className="font-medium text-red-600">{t(company.hours.closed, lang)}</dd>
              </div>
            </dl>
          </Reveal>
        </div>

        <Reveal i={1}>
          <MapEmbed lang={lang} />
        </Reveal>
      </section>

      <section className="bg-surface-low py-20">
        <div className="mx-auto max-w-7xl px-4 sm:px-6 lg:px-8">
          <Reveal>
            <h2 className="font-display text-3xl font-bold text-gray-900">{t(contactPage.channels, lang)}</h2>
          </Reveal>
          <ul className="mt-10 grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
            {channels.map(({ Icon, label, value, href, tone, external }, i) => (
              <Reveal as="li" key={label} i={i % 3}>
                <a
                  href={href}
                  {...(external ? { target: '_blank', rel: 'noopener noreferrer' } : {})}
                  className="group flex items-center gap-4 rounded-2xl bg-white p-5 ring-1 ring-gray-200 transition hover:-translate-y-0.5 hover:shadow-lg hover:ring-brand-200"
                >
                  <span className={`grid h-12 w-12 shrink-0 place-items-center rounded-xl ${tone}`}>
                    <Icon className="h-6 w-6" />
                  </span>
                  <span className="min-w-0">
                    <span className="block text-[13px] text-gray-500">{label}</span>
                    <span className="block truncate font-semibold text-gray-900 group-hover:text-brand-600">{value}</span>
                  </span>
                </a>
              </Reveal>
            ))}
          </ul>

          <Reveal className="mt-12 flex flex-col items-start justify-between gap-6 rounded-3xl bg-brand-600 p-8 text-white sm:flex-row sm:items-center lg:p-10">
            <div>
              <h2 className="font-display text-2xl font-bold">{t(contactPage.formTitle, lang)}</h2>
              <p className="mt-2 text-white/75">{t(contactPage.formLead, lang)}</p>
            </div>
            <div className="flex flex-wrap gap-3">
              <a href={company.requestForm} target="_blank" rel="noopener noreferrer" className="inline-flex items-center gap-2 rounded-full bg-gold-300 px-6 py-3 font-semibold text-brand-900 transition hover:-translate-y-0.5">
                {t(ui.requestQuote, lang)} <ArrowUpRight className="h-4 w-4" aria-hidden />
              </a>
              <a href={company.requestForm} target="_blank" rel="noopener noreferrer" className="inline-flex items-center gap-2 rounded-full px-6 py-3 font-medium ring-1 ring-white/30 transition hover:bg-white/10">
                {t(ui.registerTraining, lang)}
              </a>
            </div>
          </Reveal>
        </div>
      </section>
    </>
  );
}
