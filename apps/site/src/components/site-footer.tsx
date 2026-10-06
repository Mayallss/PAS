import { BadgeCheck, Clock, Mail, MapPin, Phone, ShieldCheck } from 'lucide-react';
import Image from 'next/image';
import Link from 'next/link';
import { company, home, href, nav, services, t, ui, type Locale } from '@/content/site';
import { FacebookIcon, LineIcon, LinkedInIcon, TikTokIcon } from './icons';

export function SocialLinks({ tone = 'dark' }: { tone?: 'dark' | 'light' }) {
  const cls =
    tone === 'dark'
      ? 'bg-white/5 text-brand-200 ring-1 ring-white/10 hover:bg-gold-300 hover:text-brand-900'
      : 'bg-brand-50 text-brand-700 hover:bg-brand-800 hover:text-gold-200';
  const items = [
    { href: company.line.url, label: 'LINE', Icon: LineIcon },
    { href: company.facebook, label: 'Facebook', Icon: FacebookIcon },
    { href: company.tiktok.url, label: 'TikTok', Icon: TikTokIcon },
    { href: company.linkedin, label: 'LinkedIn', Icon: LinkedInIcon },
  ];
  return (
    <div className="flex gap-2">
      {items.map(({ href: to, label, Icon }) => (
        <a key={label} href={to} target="_blank" rel="noopener noreferrer" aria-label={label} className={`grid h-10 w-10 place-items-center rounded-lg transition hover:-translate-y-0.5 ${cls}`}>
          <Icon className="h-[18px] w-[18px]" />
        </a>
      ))}
    </div>
  );
}

export function SiteFooter({ lang }: { lang: Locale }) {
  const year = new Date().getFullYear();
  const heading = 'eyebrow text-[12px] font-semibold text-gold-200';
  return (
    <footer className="relative overflow-hidden bg-brand-800 text-brand-200">
      <div className="pointer-events-none absolute -right-40 -top-40 h-96 w-96 rounded-full bg-gold-300/10 blur-3xl" />
      <div className="h-[2px] bg-gradient-to-r from-transparent via-gold-400/70 to-transparent" />
      <div className="relative mx-auto grid max-w-[1240px] gap-12 px-4 py-16 sm:px-6 md:grid-cols-2 lg:grid-cols-12">
        <div className="lg:col-span-4">
          <div className="flex items-center gap-3">
            <span className="grid h-12 w-16 place-items-center rounded-lg bg-white">
              <Image src="/img/pas-logo.png" alt="PAS" width={480} height={298} className="h-9 w-auto" />
            </span>
            <span className="font-semibold uppercase tracking-wider text-gold-200">Professional Accounting Service</span>
          </div>
          <p className="mt-5 text-[14px] leading-7">{t(home.office, lang)}</p>
          <div className="mt-6">
            <SocialLinks />
          </div>
        </div>

        <div className="lg:col-span-3">
          <p className={heading}>{t(home.servicesTitle, lang)}</p>
          <ul className="mt-5 space-y-2.5 text-[14px]">
            {services.map((s) => (
              <li key={s.icon}>
                <Link href={href(lang, '/#services')} className="transition-colors hover:text-white">
                  {t(s.title, lang)}
                </Link>
              </li>
            ))}
          </ul>
        </div>

        <div className="lg:col-span-2">
          <p className={heading}>{t(ui.menu, lang)}</p>
          <ul className="mt-5 space-y-2.5 text-[14px]">
            {nav.map((item) => (
              <li key={item.href}>
                <Link href={href(lang, item.href)} className="transition-colors hover:text-white">
                  {t(item.label, lang)}
                </Link>
              </li>
            ))}
            <li>
              <a href={company.coachBeaver} target="_blank" rel="noopener noreferrer" className="transition-colors hover:text-white">
                {t(ui.training, lang)} · Coach Beaver
              </a>
            </li>
          </ul>
        </div>

        <div className="lg:col-span-3">
          <p className={heading}>{t(ui.certifiedBy, lang)}</p>
          <div className="mt-5 space-y-3">
            <div className="flex items-center gap-3 rounded-lg bg-white/5 p-3 ring-1 ring-white/10">
              <BadgeCheck className="h-6 w-6 shrink-0 text-gold-300" aria-hidden />
              <div>
                <p className="text-[13px] font-semibold text-white">{lang === 'th' ? 'สำนักงานบัญชีคุณภาพ' : 'Certified Quality Accounting Practice'}</p>
                <p className="text-[12px]">{lang === 'th' ? 'กรมพัฒนาธุรกิจการค้า' : 'Department of Business Development'}</p>
              </div>
            </div>
            <div className="flex items-center gap-3 rounded-lg bg-white/5 p-3 ring-1 ring-white/10">
              <ShieldCheck className="h-6 w-6 shrink-0 text-gold-300" aria-hidden />
              <div>
                <p className="text-[13px] font-semibold text-white">ISO 9001:2015</p>
                <p className="text-[12px]">United Registrar of Systems</p>
              </div>
            </div>
          </div>
          <ul className="mt-6 space-y-2.5 text-[13px]">
            <li className="flex gap-2.5">
              <MapPin className="mt-0.5 h-4 w-4 shrink-0 text-gold-300" aria-hidden />
              {t(company.address, lang)}
            </li>
            <li className="flex gap-2.5">
              <Phone className="mt-0.5 h-4 w-4 shrink-0 text-gold-300" aria-hidden />
              <a href={`tel:${company.phoneTel}`} className="hover:text-white">{company.phone}</a>
            </li>
            <li className="flex gap-2.5">
              <Mail className="mt-0.5 h-4 w-4 shrink-0 text-gold-300" aria-hidden />
              <a href={`mailto:${company.email}`} className="hover:text-white">{company.email}</a>
            </li>
            <li className="flex gap-2.5">
              <Clock className="mt-0.5 h-4 w-4 shrink-0 text-gold-300" aria-hidden />
              {t(company.hours.weekdays, lang)} {t(company.hours.weekdayTime, lang)}
            </li>
          </ul>
        </div>
      </div>
      <div className="relative border-t border-white/10">
        <div className="mx-auto flex max-w-[1240px] flex-col items-center justify-between gap-3 px-4 py-6 text-[13px] text-brand-300 sm:px-6 md:flex-row">
          <p>
            © 1996–{year} {t(company.name, lang)} (PAS) · {t(ui.copyright, lang)}
          </p>
          <div className="flex gap-6">
            <Link href={href(lang, '/about')} className="hover:text-gold-200">{t(nav[1].label, lang)}</Link>
            <Link href={href(lang, '/contact')} className="hover:text-gold-200">{t(nav[4].label, lang)}</Link>
            <a href={company.requestForm} target="_blank" rel="noopener noreferrer" className="hover:text-gold-200">{t(ui.registerTraining, lang)}</a>
          </div>
        </div>
      </div>
    </footer>
  );
}
