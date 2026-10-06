import type { MetadataRoute } from 'next';
import { SITE_URL } from '@/lib/seo';

const PAGES = ['', '/about', '/testimonials', '/contact'];

export default function sitemap(): MetadataRoute.Sitemap {
  return PAGES.map((p) => ({
    url: `${SITE_URL}/th${p}`,
    changeFrequency: 'monthly',
    priority: p === '' ? 1 : 0.7,
    alternates: { languages: { th: `${SITE_URL}/th${p}`, en: `${SITE_URL}/en${p}` } },
  }));
}
