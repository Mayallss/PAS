import { company, type Locale } from '@/content/site';

/** Public origin, used for canonical URLs, sitemap and structured data. */
export const SITE_URL = process.env.SITE_URL ?? 'https://pas-acc.com';

/** schema.org AccountingService — lets search engines show address, phone and hours. */
export function organizationJsonLd(lang: Locale) {
  return {
    '@context': 'https://schema.org',
    '@type': 'AccountingService',
    name: company.name[lang],
    alternateName: 'PAS',
    url: `${SITE_URL}/${lang}`,
    logo: `${SITE_URL}/img/pas-logo.png`,
    image: `${SITE_URL}/img/office-hero.webp`,
    email: company.email,
    telephone: company.phone,
    foundingDate: '1996',
    address: {
      '@type': 'PostalAddress',
      streetAddress: lang === 'th' ? '60 หมู่ 2 ต.หนองป่าครั่ง' : '60 Moo 2, Nong Pa Khrang',
      addressLocality: lang === 'th' ? 'อ.เมืองเชียงใหม่' : 'Mueang Chiang Mai',
      addressRegion: lang === 'th' ? 'เชียงใหม่' : 'Chiang Mai',
      postalCode: '50000',
      addressCountry: 'TH',
    },
    openingHoursSpecification: [
      { '@type': 'OpeningHoursSpecification', dayOfWeek: ['Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday'], opens: '08:00', closes: '18:00' },
    ],
    sameAs: [company.facebook, company.linkedin, company.tiktok.url],
  };
}

/** Serialise JSON-LD safely inside a <script> tag (no "</script>" breakout). */
export function jsonLd(data: unknown) {
  return { __html: JSON.stringify(data).replace(/</g, '\\u003c') };
}
