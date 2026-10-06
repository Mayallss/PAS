import { NextResponse, type NextRequest } from 'next/server';

/** "/" → "/th" or "/en" from the browser language (Thai by default). Everything else is static. */
export function proxy(req: NextRequest) {
  const accept = req.headers.get('accept-language') ?? '';
  const first = accept.split(',')[0]?.trim().toLowerCase() ?? '';
  const lang = first && !first.startsWith('th') ? 'en' : 'th';
  const res = NextResponse.redirect(new URL(`/${lang}`, req.url), 307);
  res.headers.set('Vary', 'Accept-Language');
  return res;
}

export const config = { matcher: '/' };
