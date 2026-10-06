/**
 * Google Calendar REST client for a Workspace service account with domain-wide delegation (docs/09).
 * Every call acts AS a person (`subject`): the organizer of a booking, or the employee on leave — so invites,
 * reminders and out-of-office land on their own calendar exactly as if they had created the event.
 * Scope needed in Admin console → Security → API controls → Domain-wide delegation:
 *   https://www.googleapis.com/auth/calendar
 */
import { createSign } from 'node:crypto';

const TOKEN_URL = 'https://oauth2.googleapis.com/token';
const API = 'https://www.googleapis.com/calendar/v3';
const SCOPE = 'https://www.googleapis.com/auth/calendar';

export class GoogleCalendarError extends Error {
  constructor(
    readonly status: number,
    message: string,
  ) {
    super(message);
  }
  /** Worth retrying later (rate limit, Google outage, network). */
  get retryable() {
    return this.status === 0 || this.status === 429 || this.status >= 500;
  }
}

export interface CalendarEventBody {
  summary: string;
  description?: string;
  location?: string;
  start: { dateTime: string; timeZone?: string } | { date: string };
  end: { dateTime: string; timeZone?: string } | { date: string };
  attendees?: { email: string; resource?: boolean; optional?: boolean }[];
  reminders?: { useDefault: boolean; overrides?: { method: 'popup' | 'email'; minutes: number }[] };
  conferenceData?: { createRequest: { requestId: string; conferenceSolutionKey: { type: 'hangoutsMeet' } } };
  eventType?: 'default' | 'outOfOffice';
  outOfOfficeProperties?: { autoDeclineMode: 'declineNone' | 'declineAllConflictingInvitations' | 'declineOnlyNewConflictingInvitations'; declineMessage?: string };
  transparency?: 'opaque' | 'transparent';
  visibility?: 'default' | 'public' | 'private';
  extendedProperties?: { private: Record<string, string> };
}

export interface CalendarEvent {
  id: string;
  htmlLink?: string;
  hangoutLink?: string;
}

const b64url = (v: string | Buffer) => Buffer.from(v).toString('base64url');

export class GoogleCalendarClient {
  private tokens = new Map<string, { token: string; exp: number }>();

  constructor(
    private readonly serviceAccountEmail: string,
    privateKey: string,
    private readonly transport: typeof fetch = fetch,
  ) {
    // .env files hold the PEM on one line with literal "\n".
    this.privateKey = privateKey.replace(/\\n/g, '\n');
  }
  private readonly privateKey: string;

  /** OAuth access token for `subject`, via a signed JWT assertion (RFC 7523). Cached until shortly before expiry. */
  async token(subject: string): Promise<string> {
    const cached = this.tokens.get(subject);
    if (cached && cached.exp > Date.now() + 60_000) return cached.token;
    const iat = Math.floor(Date.now() / 1000);
    const header = b64url(JSON.stringify({ alg: 'RS256', typ: 'JWT' }));
    const claims = b64url(JSON.stringify({ iss: this.serviceAccountEmail, sub: subject, scope: SCOPE, aud: TOKEN_URL, iat, exp: iat + 3600 }));
    const signer = createSign('RSA-SHA256');
    signer.update(`${header}.${claims}`);
    const assertion = `${header}.${claims}.${b64url(signer.sign(this.privateKey))}`;
    const res = await this.send(TOKEN_URL, {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({ grant_type: 'urn:ietf:params:oauth:grant-type:jwt-bearer', assertion }).toString(),
    });
    const data = (await res.json().catch(() => ({}))) as { access_token?: string; expires_in?: number; error?: string; error_description?: string };
    if (!res.ok || !data.access_token) {
      // unauthorized_client = delegation not granted for this scope; invalid_grant = the person has no Workspace account.
      throw new GoogleCalendarError(res.status, `token for ${subject}: ${data.error ?? res.status} ${data.error_description ?? ''}`.trim());
    }
    this.tokens.set(subject, { token: data.access_token, exp: Date.now() + (data.expires_in ?? 3600) * 1000 });
    return data.access_token;
  }

  private async send(url: string, init: RequestInit): Promise<Response> {
    try {
      return await this.transport(url, { ...init, signal: AbortSignal.timeout(20_000) });
    } catch (e) {
      throw new GoogleCalendarError(0, `network: ${(e as Error).message}`);
    }
  }

  private async call<T>(subject: string, method: string, path: string, body?: unknown): Promise<T | null> {
    const res = await this.send(`${API}${path}`, {
      method,
      headers: { Authorization: `Bearer ${await this.token(subject)}`, 'Content-Type': 'application/json' },
      body: body === undefined ? undefined : JSON.stringify(body),
    });
    if (res.status === 204) return null;
    const data = (await res.json().catch(() => ({}))) as T & { error?: { message?: string } };
    if (!res.ok) throw new GoogleCalendarError(res.status, data.error?.message ?? `HTTP ${res.status}`);
    return data;
  }

  private static path(calendarId: string, eventId?: string) {
    return `/calendars/${encodeURIComponent(calendarId)}/events${eventId ? `/${encodeURIComponent(eventId)}` : ''}`;
  }

  /** sendUpdates=all: attendees get the invitation / change / cancellation e-mail and the reminder on their phone. */
  insert(subject: string, calendarId: string, body: CalendarEventBody) {
    return this.call<CalendarEvent>(subject, 'POST', `${GoogleCalendarClient.path(calendarId)}?conferenceDataVersion=1&sendUpdates=all`, body) as Promise<CalendarEvent>;
  }

  update(subject: string, calendarId: string, eventId: string, body: CalendarEventBody) {
    return this.call<CalendarEvent>(subject, 'PUT', `${GoogleCalendarClient.path(calendarId, eventId)}?conferenceDataVersion=1&sendUpdates=all`, body) as Promise<CalendarEvent>;
  }

  /** Already gone (404 / 410) counts as deleted. */
  async remove(subject: string, calendarId: string, eventId: string) {
    try {
      await this.call(subject, 'DELETE', `${GoogleCalendarClient.path(calendarId, eventId)}?sendUpdates=all`);
    } catch (e) {
      if (e instanceof GoogleCalendarError && (e.status === 404 || e.status === 410)) return;
      throw e;
    }
  }
}
