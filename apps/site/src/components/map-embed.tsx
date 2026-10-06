'use client';

import { ExternalLink, MapPin } from 'lucide-react';
import { useState } from 'react';
import { company, t, ui, type Locale } from '@/content/site';

/** Click-to-load: Google Maps sets cookies, so nothing is requested from Google until the visitor asks for it. */
export function MapEmbed({ lang }: { lang: Locale }) {
  const [show, setShow] = useState(false);
  return (
    <div className="relative aspect-[4/3] overflow-hidden rounded-3xl border border-gray-200 bg-brand-50 sm:aspect-[16/10]">
      {show ? (
        <iframe
          src={company.mapEmbed}
          title={t(company.name, lang)}
          className="h-full w-full"
          loading="lazy"
          referrerPolicy="no-referrer-when-downgrade"
          allowFullScreen
        />
      ) : (
        <div className="grid h-full place-items-center p-6 text-center">
          <div
            className="pointer-events-none absolute inset-0 opacity-40"
            style={{
              backgroundImage:
                'linear-gradient(to right, rgb(46 49 146 / 0.08) 1px, transparent 1px), linear-gradient(to bottom, rgb(46 49 146 / 0.08) 1px, transparent 1px)',
              backgroundSize: '32px 32px',
            }}
          />
          <div className="relative">
            <span className="mx-auto grid h-14 w-14 animate-float place-items-center rounded-full bg-brand-600 text-white shadow-xl shadow-brand-600/30">
              <MapPin className="h-6 w-6" aria-hidden />
            </span>
            <p className="mt-4 max-w-sm font-medium text-gray-800">{t(company.address, lang)}</p>
            <div className="mt-5 flex flex-wrap justify-center gap-2">
              <button
                type="button"
                onClick={() => setShow(true)}
                className="rounded-full bg-brand-600 px-5 py-2.5 text-[14px] font-semibold text-white transition hover:bg-brand-700"
              >
                {t(ui.showMap, lang)}
              </button>
              <a
                href={company.mapLink}
                target="_blank"
                rel="noopener noreferrer"
                className="inline-flex items-center gap-1.5 rounded-full border border-gray-300 bg-white px-5 py-2.5 text-[14px] font-medium text-gray-700 transition hover:border-brand-300"
              >
                {t(ui.openInMaps, lang)} <ExternalLink className="h-3.5 w-3.5" aria-hidden />
              </a>
            </div>
            <p className="mt-3 text-[12px] text-gray-500">{t(ui.mapNote, lang)}</p>
          </div>
        </div>
      )}
    </div>
  );
}
