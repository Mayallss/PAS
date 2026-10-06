import type { NextConfig } from 'next';

const dev = process.env.NODE_ENV !== 'production';

// Public site: static pages only. No cookies, no API proxy, nothing shared with the internal portal.
const csp = [
  "default-src 'self'",
  `script-src 'self' 'unsafe-inline'${dev ? " 'unsafe-eval'" : ''}`,
  "style-src 'self' 'unsafe-inline'",
  "img-src 'self' data:",
  "font-src 'self'",
  "connect-src 'self'",
  // Google Maps is loaded only after the visitor clicks "show map".
  'frame-src https://www.google.com',
  "frame-ancestors 'none'",
  "base-uri 'self'",
  "form-action 'self'",
  "object-src 'none'",
].join('; ');

// Old PHP URLs keep working (search engines, bookmarks, printed material).
const LEGACY: Record<string, string> = {
  'index-th.php': '/th',
  'index.php': '/en',
  'About-th.php': '/th/about',
  'About.php': '/en/about',
  'Testimonials-th.php': '/th/testimonials',
  'Testimonials.php': '/en/testimonials',
  'Contact-th.php': '/th/contact',
  'Contact.php': '/en/contact',
};

const config: NextConfig = {
  poweredByHeader: false,
  reactStrictMode: true,
  images: { formats: ['image/avif', 'image/webp'] },
  async redirects() {
    return Object.entries(LEGACY).flatMap(([file, to]) => [
      { source: `/${file}`, destination: to, permanent: true },
      { source: `/pas-frontweb/${file}`, destination: to, permanent: true },
    ]);
  },
  async headers() {
    return [
      {
        source: '/:path*',
        headers: [
          { key: 'Content-Security-Policy', value: csp },
          { key: 'X-Frame-Options', value: 'DENY' },
          { key: 'X-Content-Type-Options', value: 'nosniff' },
          { key: 'Referrer-Policy', value: 'strict-origin-when-cross-origin' },
          { key: 'Permissions-Policy', value: 'camera=(), microphone=(), geolocation=(), interest-cohort=()' },
          ...(dev ? [] : [{ key: 'Strict-Transport-Security', value: 'max-age=31536000; includeSubDomains' }]),
        ],
      },
    ];
  },
};

export default config;
