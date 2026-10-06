import type { Metadata } from 'next';
import Image from 'next/image';
import { Reveal } from '@/components/reveal';
import { ContactCta, PageHero, TestimonialCard } from '@/components/sections';
import { clients, home, isLocale, t, testimonials, testimonialsPage, yearsSinceFounded, type Locale } from '@/content/site';

export async function generateMetadata({ params }: { params: Promise<{ lang: string }> }): Promise<Metadata> {
  const { lang } = await params;
  if (!isLocale(lang)) return {};
  return {
    title: t(testimonialsPage.title, lang),
    description: t(testimonialsPage.lead, lang),
    alternates: { canonical: `/${lang}/testimonials`, languages: { th: '/th/testimonials', en: '/en/testimonials' } },
  };
}

export default async function TestimonialsPage({ params }: { params: Promise<{ lang: string }> }) {
  const { lang: raw } = await params;
  const lang = (isLocale(raw) ? raw : 'th') as Locale;

  return (
    <>
      <PageHero eyebrow={lang === 'th' ? 'ลูกค้าของเรา' : 'Our clients'} title={t(testimonialsPage.title, lang)} lead={t(testimonialsPage.lead, lang)} />

      <section className="mx-auto max-w-7xl px-4 py-20 sm:px-6 lg:px-8">
        <div className="columns-1 gap-6 md:columns-2 [&>*]:mb-6 [&>*]:break-inside-avoid">
          {testimonials.map((x, i) => (
            <TestimonialCard key={x.name} lang={lang} i={i % 2} {...x} />
          ))}
        </div>
      </section>

      <section className="bg-surface-low py-20">
        <Reveal className="mx-auto max-w-7xl px-4 text-center sm:px-6 lg:px-8">
          <h2 className="font-display text-2xl font-bold text-gray-900 sm:text-3xl">{t(home.clientsTitle, lang).replace('{years}', String(yearsSinceFounded()))}</h2>
        </Reveal>
        <ul className="mx-auto mt-12 grid max-w-6xl grid-cols-2 gap-4 px-4 sm:grid-cols-3 sm:px-6 lg:grid-cols-6 lg:px-8">
          {clients.map((c, i) => (
            <Reveal as="li" key={c.src} i={i % 6} className="grid h-28 place-items-center rounded-2xl bg-white p-5 ring-1 ring-gray-200 transition hover:-translate-y-1 hover:shadow-lg">
              <Image src={c.src} alt={c.alt} width={c.w} height={c.h} className="max-h-16 w-auto object-contain" />
            </Reveal>
          ))}
        </ul>
      </section>

      <ContactCta lang={lang} />
    </>
  );
}
