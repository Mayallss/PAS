import { NextResponse, type NextRequest } from 'next/server';

/**
 * Optimistic auth check at the edge of the app: no session cookie → straight to /login,
 * before any page code or API call runs. The API still validates every request.
 */
export function proxy(request: NextRequest) {
  const hasSession = request.cookies.has('pas_sid') || request.cookies.has('__Host-pas_sid');
  if (hasSession) return NextResponse.next();
  const url = request.nextUrl.clone();
  url.pathname = '/login';
  url.search = `?next=${encodeURIComponent(request.nextUrl.pathname + request.nextUrl.search)}`;
  return NextResponse.redirect(url);
}

export const config = {
  // Everything except the login page, the public signing page (/sign, share link), set-password (one-time link), the API proxy and static assets (public/brand, any file with an image/font extension).
  // Static files must bypass this check: the image optimizer fetches them without the user's cookie.
  matcher: ['/((?!login|sign|set-password|api|_next/static|_next/image|brand/|favicon.ico|.*\\.(?:png|jpe?g|webp|avif|svg|ico|woff2?)$).*)'],
};
