import type { Metadata, Viewport } from 'next';
import { Noto_Sans_Thai, Noto_Serif_Thai, Playfair_Display, Plus_Jakarta_Sans } from 'next/font/google';
import { notFound } from 'next/navigation';
import { SiteFooter } from '@/components/site-footer';
import { SiteHeader } from '@/components/site-header';
import { company, home, isLocale, LOCALES, t, ui } from '@/content/site';
import { SITE_URL } from '@/lib/seo';
import '../globals.css';

// Self-hosted at build time: no request to Google from the visitor's browser.
const jakarta = Plus_Jakarta_Sans({ subsets: ['latin'], variable: '--font-jakarta', display: 'swap' });
const thai = Noto_Sans_Thai({ subsets: ['thai'], variable: '--font-thai', display: 'swap' });
// Serif accents only (headline highlight, quotes) — not preloaded.
const playfair = Playfair_Display({ subsets: ['latin'], variable: '--font-playfair', display: 'swap', style: ['normal', 'italic'], weight: ['500', '600'], preload: false });
const serifThai = Noto_Serif_Thai({ subsets: ['thai'], variable: '--font-serif-thai', display: 'swap', weight: ['500', '600'], preload: false });

export const dynamicParams = false;
export function generateStaticParams() {
  return LOCALES.map((lang) => ({ lang }));
}

export async function generateMetadata({ params }: { params: Promise<{ lang: string }> }): Promise<Metadata> {
  const { lang } = await params;
  if (!isLocale(lang)) return {};
  const title = `${t(company.brand, lang)} | PAS`;
  const description =
    lang === 'th'
      ? 'บริษัท โพรเฟสชั่นแนล แอคเคาน์ติ้ง เซอร์วิส จำกัด สำนักงานบัญชี เชียงใหม่ ให้บริการด้านบัญชีคุณภาพ รับทำบัญชี ตรวจสอบบัญชี และให้คำปรึกษาธุรกิจในประเทศไทย'
      : t(home.lead, lang);
  return {
    metadataBase: new URL(SITE_URL),
    title: { default: title, template: `%s | PAS ${lang === 'th' ? 'สำนักงานบัญชี เชียงใหม่' : 'Chiang Mai'}` },
    description,
    keywords: ['Professional Accounting Service', 'สำนักงานบัญชี', 'รับทำบัญชี', 'บริษัทบัญชี', 'PAS', 'สำนักงานบัญชี เชียงใหม่', 'Chiang Mai accounting', 'audit Chiang Mai'],
    authors: [{ name: company.name[lang] }],
    alternates: { canonical: `/${lang}`, languages: { th: '/th', en: '/en', 'x-default': '/th' } },
    openGraph: {
      type: 'website',
      siteName: 'PAS — Professional Accounting Service',
      title,
      description,
      locale: lang === 'th' ? 'th_TH' : 'en_US',
      images: [{ url: '/img/office-hero.webp', width: 1024, height: 482 }],
    },
    icons: { icon: '/img/pas-mark.png' },
  };
}

export const viewport: Viewport = { themeColor: '#0F1E36' };

export default async function LangLayout({ children, params }: { children: React.ReactNode; params: Promise<{ lang: string }> }) {
  const { lang } = await params;
  if (!isLocale(lang)) notFound();
  return (
    <html lang={lang} className={`${jakarta.variable} ${thai.variable} ${playfair.variable} ${serifThai.variable}`}>
      <body className="min-h-screen font-sans text-[15px] leading-relaxed antialiased">
        <a href="#main" className="sr-only focus:not-sr-only focus:fixed focus:left-4 focus:top-4 focus:z-[100] focus:rounded-lg focus:bg-white focus:px-4 focus:py-2 focus:shadow-lg">
          {t(ui.skip, lang)}
        </a>
        <SiteHeader lang={lang} />
        <main id="main" className="overflow-x-clip">{children}</main>
        <SiteFooter lang={lang} />
      </body>
    </html>
  );
}
