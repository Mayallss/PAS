import { Injectable, Logger, OnModuleDestroy, OnModuleInit } from '@nestjs/common';
import { BookingMode, BookingStatus, CalendarSync, CalendarSyncStatus, LeaveRequestStatus, LeaveUnit, Prisma } from '@prisma/client';
import { loadConfig } from '../../config';
import { addDays, todayIn, toIsoDate } from '../../common/dates';
import { PrismaService } from '../../common/prisma.service';
import { CalendarEventBody, GoogleCalendarClient, GoogleCalendarError } from './google-calendar.client';

type Db = PrismaService | Prisma.TransactionClient;
export type SyncKind = 'room_booking' | 'leave_request';

const MAX_ATTEMPTS = 8;
const BATCH = 20;

/**
 * Mirror of room bookings and approved leave in Google Calendar (docs/09).
 * The portal stays the system of record; Google is where people see it on their phone.
 * Not configured → rows wait as PENDING and go out once a service account is set.
 */
@Injectable()
export class CalendarSyncService implements OnModuleInit, OnModuleDestroy {
  private readonly log = new Logger('CalendarSync');
  private timer: NodeJS.Timeout | null = null;
  private running = false;
  private google: GoogleCalendarClient | null = null;

  constructor(private readonly prisma: PrismaService) {}

  onModuleInit() {
    const c = loadConfig();
    if (!c.googleCalendarEnabled || c.CALENDAR_SYNC_INTERVAL_MS <= 0) return;
    this.timer = setInterval(() => void this.process().catch((e) => this.log.error(e)), c.CALENDAR_SYNC_INTERVAL_MS);
    this.timer.unref();
  }

  onModuleDestroy() {
    if (this.timer) clearInterval(this.timer);
  }

  /** Call inside the transaction that changed the resource: the mirror will catch up with its latest state. */
  async markPending(db: Db, kind: SyncKind, resourceId: string) {
    await db.calendarSync.upsert({
      where: { kind_resourceId: { kind, resourceId } },
      create: { kind, resourceId },
      update: { status: CalendarSyncStatus.PENDING, nextAttemptAt: new Date(), attempts: 0, lastError: null },
    });
  }

  async status() {
    const c = loadConfig();
    const groups = await this.prisma.calendarSync.groupBy({ by: ['status'], _count: { _all: true } });
    const count = (s: CalendarSyncStatus) => groups.find((g) => g.status === s)?._count._all ?? 0;
    const lastFailure = await this.prisma.calendarSync.findFirst({ where: { status: CalendarSyncStatus.FAILED }, orderBy: { updatedAt: 'desc' }, select: { kind: true, lastError: true, updatedAt: true } });
    return {
      configured: c.googleCalendarEnabled,
      companyCalendar: Boolean(c.GOOGLE_COMPANY_CALENDAR_ID),
      pending: count(CalendarSyncStatus.PENDING),
      done: count(CalendarSyncStatus.DONE),
      failed: count(CalendarSyncStatus.FAILED),
      lastFailure,
    };
  }

  /** Overridable in tests (fake Google). */
  client(): GoogleCalendarClient {
    const c = loadConfig();
    this.google ??= new GoogleCalendarClient(c.GOOGLE_SA_EMAIL, c.GOOGLE_SA_PRIVATE_KEY);
    return this.google;
  }

  /** One pass over due rows. Safe with several API instances: each row is claimed by a conditional update. */
  async process(): Promise<{ configured: boolean; synced: number; failed: number }> {
    if (!loadConfig().googleCalendarEnabled) return { configured: false, synced: 0, failed: 0 };
    if (this.running) return { configured: true, synced: 0, failed: 0 };
    this.running = true;
    let synced = 0;
    let failed = 0;
    try {
      const rows = await this.prisma.calendarSync.findMany({
        where: { status: { in: [CalendarSyncStatus.PENDING, CalendarSyncStatus.FAILED] }, nextAttemptAt: { lte: new Date() }, attempts: { lt: MAX_ATTEMPTS } },
        orderBy: { nextAttemptAt: 'asc' },
        take: BATCH,
      });
      for (const row of rows) {
        const claim = await this.prisma.calendarSync.updateMany({ where: { id: row.id, updatedAt: row.updatedAt }, data: { attempts: { increment: 1 } } });
        if (claim.count === 0) continue; // another instance took it, or it changed again
        const claimed = await this.prisma.calendarSync.findUniqueOrThrow({ where: { id: row.id } });
        try {
          const target = await this.syncOne(claimed);
          // DONE only if nothing changed while we were talking to Google; otherwise it stays PENDING for the next pass.
          await this.prisma.calendarSync.update({ where: { id: row.id }, data: { calendarId: target.calendarId, externalId: target.externalId } });
          await this.prisma.calendarSync.updateMany({
            where: { id: row.id, attempts: claimed.attempts, status: claimed.status, nextAttemptAt: claimed.nextAttemptAt },
            data: { status: CalendarSyncStatus.DONE, lastError: null, syncedAt: new Date() },
          });
          synced++;
        } catch (e) {
          failed++;
          const retryable = !(e instanceof GoogleCalendarError) || e.retryable;
          const waitMin = retryable ? Math.min(2 ** claimed.attempts, 360) : 360;
          await this.prisma.calendarSync.update({
            where: { id: row.id },
            data: { status: CalendarSyncStatus.FAILED, lastError: String((e as Error).message).slice(0, 500), nextAttemptAt: new Date(Date.now() + waitMin * 60_000) },
          });
          this.log.warn(`${row.kind} ${row.resourceId}: ${(e as Error).message}`);
        }
      }
    } finally {
      this.running = false;
    }
    return { configured: true, synced, failed };
  }

  /** Push the resource's CURRENT state. Returns where it now lives (null = not in Google). */
  private async syncOne(row: CalendarSync): Promise<{ calendarId: string | null; externalId: string | null }> {
    const desired = row.kind === 'room_booking' ? await this.bookingEvent(row.resourceId) : await this.leaveEvent(row.resourceId);
    const google = this.client();
    if (!desired.body) {
      if (row.externalId && row.calendarId && desired.subject) await google.remove(desired.subject, row.calendarId, row.externalId);
      return { calendarId: null, externalId: null };
    }
    if (!desired.subject) throw new GoogleCalendarError(400, 'ไม่มีอีเมลองค์กรของผู้จัด/ผู้ลา — สร้างในปฏิทินไม่ได้');
    const calendarId = 'primary';
    const event = row.externalId ? await google.update(desired.subject, calendarId, row.externalId, desired.body) : await google.insert(desired.subject, calendarId, desired.body);
    if (row.kind === 'room_booking' && event.hangoutLink) {
      // Google created the Meet link: show it in the portal too (never overwrite a link someone typed).
      await this.prisma.roomBooking.updateMany({ where: { id: row.resourceId, meetingUrl: null }, data: { meetingUrl: event.hangoutLink } });
    }
    return { calendarId, externalId: event.id };
  }

  private async bookingEvent(id: string): Promise<{ subject: string | null; body: CalendarEventBody | null }> {
    const c = loadConfig();
    const b = await this.prisma.roomBooking.findUnique({
      where: { id },
      include: { organizer: { select: { email: true } }, room: true, attendees: { include: { employee: { select: { email: true } } } } },
    });
    if (!b) return { subject: null, body: null };
    const subject = b.organizer.email;
    const stillRelevant = b.endsAt.getTime() > Date.now() - 86_400_000;
    if (b.status !== BookingStatus.CONFIRMED || !stillRelevant) return { subject, body: null };

    const emails = new Set<string>();
    for (const a of b.attendees) {
      const email = a.employee?.email ?? a.email;
      if (email && email !== subject) emails.add(email.toLowerCase());
    }
    const attendees: CalendarEventBody['attendees'] = [...emails].map((email) => ({ email }));
    if (b.room?.googleResourceEmail) attendees.push({ email: b.room.googleResourceEmail, resource: true });
    if (c.GOOGLE_COMPANY_CALENDAR_ID) attendees.push({ email: c.GOOGLE_COMPANY_CALENDAR_ID, optional: true });

    const wantsMeet = b.mode !== BookingMode.ONSITE && !b.meetingUrl;
    const lines = [b.description, b.meetingUrl ? `ลิงก์ประชุม: ${b.meetingUrl}` : null, 'จองผ่าน PAS Portal'].filter(Boolean);
    return {
      subject,
      body: {
        summary: b.title,
        description: lines.join('\n\n'),
        location: b.room ? [b.room.name, b.room.location].filter(Boolean).join(' · ') : (b.meetingUrl ?? undefined),
        start: { dateTime: b.startsAt.toISOString(), timeZone: c.TZ_BUSINESS },
        end: { dateTime: b.endsAt.toISOString(), timeZone: c.TZ_BUSINESS },
        attendees,
        reminders: { useDefault: false, overrides: c.GOOGLE_REMINDER_MINUTES.slice(0, 5).map((minutes) => ({ method: 'popup' as const, minutes })) },
        ...(wantsMeet ? { conferenceData: { createRequest: { requestId: `${b.id}-${b.version}`, conferenceSolutionKey: { type: 'hangoutsMeet' as const } } } } : {}),
        extendedProperties: { private: { pasKind: 'room_booking', pasId: b.id } },
      },
    };
  }

  /**
   * Approved full-day leave → "Out of office" on the person's own calendar: Google declines new invitations for
   * those days. The type is not shown (sick leave is health data). Hourly leave has no clock time, so it is not mirrored.
   */
  private async leaveEvent(id: string): Promise<{ subject: string | null; body: CalendarEventBody | null }> {
    const c = loadConfig();
    const r = await this.prisma.leaveRequest.findUnique({ where: { id }, include: { employee: { select: { email: true } } } });
    if (!r) return { subject: null, body: null };
    const subject = r.employee.email;
    const end = toIsoDate(r.endDate);
    const relevant = end >= addDays(todayIn(c.TZ_BUSINESS), -1);
    if (r.status !== LeaveRequestStatus.APPROVED || r.unit !== LeaveUnit.DAYS || !relevant) return { subject, body: null };
    return {
      subject,
      body: {
        summary: 'ลา (PAS)',
        eventType: 'outOfOffice',
        start: { dateTime: `${toIsoDate(r.startDate)}T00:00:00`, timeZone: c.TZ_BUSINESS },
        end: { dateTime: `${addDays(end, 1)}T00:00:00`, timeZone: c.TZ_BUSINESS },
        outOfOfficeProperties: { autoDeclineMode: 'declineOnlyNewConflictingInvitations', declineMessage: 'อยู่ระหว่างลา จะติดต่อกลับเมื่อกลับมาทำงาน' },
        transparency: 'opaque',
        extendedProperties: { private: { pasKind: 'leave_request', pasId: r.id } },
      },
    };
  }
}
