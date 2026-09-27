import 'server-only';
import { cookies, headers } from 'next/headers';

const API_URL = process.env.API_INTERNAL_URL ?? 'http://127.0.0.1:4000';

export class UnauthenticatedError extends Error {}

/**
 * Server-side (RSC) call to the API, forwarding the user's session cookie.
 * Runs next to the API (same host / VPC), so the first paint needs no browser round trips.
 */
export async function serverApi<T>(path: string): Promise<T> {
  const [cookieStore, h] = await Promise.all([cookies(), headers()]);
  const res = await fetch(`${API_URL}/api${path}`, {
    headers: {
      cookie: cookieStore.toString(),
      accept: 'application/json',
      ...(h.get('x-request-id') ? { 'x-request-id': h.get('x-request-id')! } : {}),
    },
    cache: 'no-store',
  });
  if (res.status === 401) throw new UnauthenticatedError();
  if (!res.ok) throw new Error(`API ${res.status} ${path}`);
  return res.json() as Promise<T>;
}
