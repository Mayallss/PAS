import { HttpStatus, Injectable } from '@nestjs/common';
import { BookingMode, BookingStatus, EmploymentStatus, Prisma } from '@prisma/client';
import { conflict, DomainError, forbidden, notFound } from '../../common/errors';
import { PrismaService } from '../../common/prisma.service';
import type { AppRequest } from '../../common/request-context';
import { AuditService } from '../audit/audit.service';
import type { AuthUser } from '../auth/auth.types';
import { CalendarSyncService } from '../calendar-sync/calendar-sync.service';

type Tx = Prisma.TransactionClient;

/** [ข้อเสนอ] defaults — docs/09 §2. */
export const BOOKING_RULES = {
  stepMinutes: 5,
  minMinutes: 15,
  maxMinutes: 12 * 60,
  aheadDays: 180,
  maxAttendees: 100,
  maxGuests: 50,
};

export interface BookingInput {
  title: string;
  mode: BookingMode;
  roomId?: string | null;
  startsAt: string;
  endsAt: string;
  description?: string | null;
  meetingUrl?: string | null;
  attendeeIds?: string[];
  guestEmails?: string[];
  meetingId?: string | null;
}

export interface RoomInput {
  name: string;
  location?: string | null;
  capacity?: number | null;
  features?: string[];
  googleResourceEmail?: string | null;
  color?: string | null;
  sortOrder?: number;
  isActive?: boolean;
  note?: string | null;
}

const bookingInclude = {
  room: { select: { id: true, name: true, location: true, color: true, capacity: true } },
  organizer: { select: { id: true, fullName: true, nickname: true } },
  attendees: { include: { employee: { select: { id: true, fullName: true, nickname: true } } } },
  meeting: { select: { id: true, title: true } },
  cancelledBy: { select: { fullName: true } },
} satisfies Prisma.RoomBookingInclude;
type BookingRow = Prisma.RoomBookingGetPayload<{ include: typeof bookingInclude }>;

const clean = (v: string | null | undefined) => v?.trim() || null;

@Injectable()
export class RoomsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
    private readonly sync: CalendarSyncService,
  ) {}

  private canManage(user: AuthUser) {
    return user.permissions.includes('room.manage');
  }

  private dto(b: BookingRow, user: AuthUser, syncState?: { status: string; lastError: string | null } | null) {
    const ended = b.endsAt.getTime() <= Date.now();
    return {
      id: b.id,
      title: b.title,
      mode: b.mode,
      room: b.room,
      startsAt: b.startsAt.toISOString(),
      endsAt: b.endsAt.toISOString(),
      organizer: b.organizer,
      description: b.description,
      meetingUrl: b.meetingUrl,
      status: b.status,
      cancelledAt: b.cancelledAt,
      cancelledBy: b.cancelledBy?.fullName ?? null,
      cancelReason: b.cancelReason,
      attendees: b.attendees.map((a) => (a.employee ? { employeeId: a.employee.id, name: a.employee.nickname ? `${a.employee.nickname} (${a.employee.fullName})` : a.employee.fullName } : { email: a.email! })),
      meeting: b.meeting,
      version: b.version,
      canEdit: b.status === BookingStatus.CONFIRMED && !ended && (b.organizer.id === user.id || this.canManage(user)),
      calendar: syncState ?? null,
    };
  }

  // -------------------------------------------------------------------------
  // Rooms
  // -------------------------------------------------------------------------

  rooms(all: boolean) {
    return this.prisma.meetingRoom.findMany({ where: all ? {} : { isActive: true }, orderBy: [{ sortOrder: 'asc' }, { name: 'asc' }] });
  }

  async saveRoom(id: string | null, input: RoomInput, req: AppRequest) {
    const data = {
      name: input.name.trim(),
      location: clean(input.location),
      capacity: input.capacity ?? null,
      features: (input.features ?? []).map((f) => f.trim()).filter(Boolean),
      googleResourceEmail: clean(input.googleResourceEmail)?.toLowerCase() ?? null,
      color: clean(input.color),
      note: clean(input.note),
      ...(input.sortOrder !== undefined ? { sortOrder: input.sortOrder } : {}),
      ...(input.isActive !== undefined ? { isActive: input.isActive } : {}),
    };
    try {
      return await this.prisma.$transaction(async (tx) => {
        const before = id ? await tx.meetingRoom.findUnique({ where: { id } }) : null;
        if (id && !before) throw notFound('ห้อง');
        const room = id ? await tx.meetingRoom.update({ where: { id }, data }) : await tx.meetingRoom.create({ data });
        await this.audit.record({ action: id ? 'room.update' : 'room.create', resourceType: 'meeting_room', resourceId: room.id, before, after: data }, req, tx);
        return room;
      });
    } catch (e) {
      if (e instanceof Prisma.PrismaClientKnownRequestError && e.code === 'P2002') throw new DomainError('DUPLICATE', 'มีห้องชื่อนี้หรืออีเมลปฏิทินห้องนี้แล้ว', HttpStatus.CONFLICT);
      throw e;
    }
  }

  // -------------------------------------------------------------------------
  // Bookings
  // -------------------------------------------------------------------------

  /** Everything booked between two instants (the client sends its local day / week boundaries). */
  async bookings(user: AuthUser, from: Date, to: Date, includeCancelled = false) {
    if (to.getTime() - from.getTime() > 62 * 86_400_000) throw new DomainError('RANGE_TOO_LONG', 'ดูได้ครั้งละไม่เกิน 2 เดือน', 400);
    const rows = await this.prisma.roomBooking.findMany({
      where: { startsAt: { lt: to }, endsAt: { gt: from }, ...(includeCancelled ? {} : { status: BookingStatus.CONFIRMED }) },
      orderBy: { startsAt: 'asc' },
      include: bookingInclude,
    });
    return rows.map((b) => this.dto(b, user));
  }

  /** Upcoming bookings I organise or am invited to. */
  async mine(user: AuthUser) {
    const rows = await this.prisma.roomBooking.findMany({
      where: {
        status: BookingStatus.CONFIRMED,
        endsAt: { gt: new Date() },
        OR: [{ organizerId: user.id }, { attendees: { some: { employeeId: user.id } } }],
      },
      orderBy: { startsAt: 'asc' },
      take: 50,
      include: bookingInclude,
    });
    return rows.map((b) => this.dto(b, user));
  }

  async get(user: AuthUser, id: string) {
    const b = await this.prisma.roomBooking.findUnique({ where: { id }, include: bookingInclude });
    if (!b) throw notFound('การจอง');
    const sync = await this.prisma.calendarSync.findUnique({ where: { kind_resourceId: { kind: 'room_booking', resourceId: id } }, select: { status: true, lastError: true } });
    return this.dto(b, user, sync);
  }

  private validateTimes(starts: Date, ends: Date, opts: { creating: boolean; startChanged: boolean }) {
    const ms = ends.getTime() - starts.getTime();
    const step = BOOKING_RULES.stepMinutes * 60_000;
    if (Number.isNaN(ms)) throw new DomainError('VALIDATION_FAILED', 'เวลาไม่ถูกต้อง', 400);
    if (ms <= 0) throw new DomainError('VALIDATION_FAILED', 'เวลาสิ้นสุดต้องหลังเวลาเริ่ม', 400);
    if (starts.getTime() % step !== 0 || ends.getTime() % step !== 0) throw new DomainError('VALIDATION_FAILED', `เวลาต้องลงที่ทุก ${BOOKING_RULES.stepMinutes} นาที`, 400);
    if (ms < BOOKING_RULES.minMinutes * 60_000) throw new DomainError('TOO_SHORT', `จองอย่างน้อย ${BOOKING_RULES.minMinutes} นาที`, 422);
    if (ms > BOOKING_RULES.maxMinutes * 60_000) throw new DomainError('TOO_LONG', `จองได้ไม่เกิน ${BOOKING_RULES.maxMinutes / 60} ชั่วโมงต่อครั้ง`, 422);
    if ((opts.creating || opts.startChanged) && starts.getTime() < Date.now() - 5 * 60_000) throw new DomainError('IN_PAST', 'จองย้อนหลังไม่ได้', 422);
    if (starts.getTime() > Date.now() + BOOKING_RULES.aheadDays * 86_400_000) throw new DomainError('FUTURE_LIMIT', `จองล่วงหน้าได้ไม่เกิน ${BOOKING_RULES.aheadDays} วัน`, 422);
  }

  private async assertRoomFree(tx: Tx, roomId: string, starts: Date, ends: Date, exceptId?: string) {
    const clash = await tx.roomBooking.findFirst({
      where: { roomId, status: BookingStatus.CONFIRMED, startsAt: { lt: ends }, endsAt: { gt: starts }, ...(exceptId ? { id: { not: exceptId } } : {}) },
      include: { organizer: { select: { fullName: true } } },
    });
    if (clash) {
      throw new DomainError('ROOM_TAKEN', `ห้องนี้ถูกจองแล้ว: "${clash.title}" โดย ${clash.organizer.fullName}`, HttpStatus.CONFLICT, {
        conflict: { id: clash.id, title: clash.title, startsAt: clash.startsAt.toISOString(), endsAt: clash.endsAt.toISOString() },
      });
    }
  }

  private async resolveRoom(tx: Tx, mode: BookingMode, roomId: string | null | undefined) {
    if (mode === BookingMode.ONLINE) return null;
    if (!roomId) throw new DomainError('ROOM_REQUIRED', 'กรุณาเลือกห้องประชุม', 400);
    const room = await tx.meetingRoom.findUnique({ where: { id: roomId } });
    if (!room || !room.isActive) throw notFound('ห้องประชุม');
    return room;
  }

  private async attendeeRows(tx: Tx, organizerId: string, ids: string[] = [], guests: string[] = []) {
    const uniqueIds = [...new Set(ids)].filter((id) => id !== organizerId);
    if (uniqueIds.length > BOOKING_RULES.maxAttendees) throw new DomainError('TOO_MANY', `ผู้เข้าร่วมไม่เกิน ${BOOKING_RULES.maxAttendees} คน`, 400);
    const found = await tx.employee.findMany({ where: { id: { in: uniqueIds }, status: EmploymentStatus.ACTIVE }, select: { id: true } });
    if (found.length !== uniqueIds.length) throw notFound('ผู้เข้าร่วมบางคน');
    const emails = [...new Set(guests.map((g) => g.trim().toLowerCase()).filter(Boolean))];
    if (emails.length > BOOKING_RULES.maxGuests) throw new DomainError('TOO_MANY', `แขกภายนอกไม่เกิน ${BOOKING_RULES.maxGuests} คน`, 400);
    return [...uniqueIds.map((employeeId) => ({ employeeId })), ...emails.map((email) => ({ email }))];
  }

  /** The DB exclusion constraint is the last line against a double booking racing the check above. */
  private mapOverlap(e: unknown): never {
    if (e instanceof Error && /23P01|room_booking_no_overlap/.test(e.message)) {
      throw new DomainError('ROOM_TAKEN', 'ห้องนี้เพิ่งถูกจองในช่วงเวลานี้ กรุณาเลือกเวลาอื่น', HttpStatus.CONFLICT);
    }
    throw e;
  }

  async create(user: AuthUser, input: BookingInput, req: AppRequest) {
    const starts = new Date(input.startsAt);
    const ends = new Date(input.endsAt);
    this.validateTimes(starts, ends, { creating: true, startChanged: true });
    let id: string;
    try {
      id = await this.prisma.$transaction(async (tx) => {
        const room = await this.resolveRoom(tx, input.mode, input.roomId);
        if (room) await this.assertRoomFree(tx, room.id, starts, ends);
        const attendees = await this.attendeeRows(tx, user.id, input.attendeeIds, input.guestEmails);
        const b = await tx.roomBooking.create({
          data: {
            title: input.title.trim(),
            mode: input.mode,
            roomId: room?.id ?? null,
            startsAt: starts,
            endsAt: ends,
            organizerId: user.id,
            description: clean(input.description),
            meetingUrl: input.mode === BookingMode.ONSITE ? null : clean(input.meetingUrl),
            meetingId: input.meetingId ?? null,
            createdById: user.id,
            attendees: { create: attendees },
          },
        });
        await this.sync.markPending(tx, 'room_booking', b.id);
        await this.audit.record({ action: 'room_booking.create', resourceType: 'room_booking', resourceId: b.id, after: { ...input, attendeeCount: attendees.length } }, req, tx);
        return b.id;
      });
    } catch (e) {
      this.mapOverlap(e);
    }
    return this.get(user, id);
  }

  async update(user: AuthUser, id: string, input: BookingInput & { expectedVersion: number }, req: AppRequest) {
    try {
      await this.prisma.$transaction(async (tx) => {
        const before = await tx.roomBooking.findUnique({ where: { id }, include: { attendees: true } });
        if (!before) throw notFound('การจอง');
        if (before.organizerId !== user.id && !this.canManage(user)) throw forbidden('แก้ไขได้เฉพาะผู้จองหรือผู้ดูแลห้องประชุม');
        if (before.status !== BookingStatus.CONFIRMED) throw new DomainError('CANCELLED', 'การจองนี้ถูกยกเลิกแล้ว', HttpStatus.CONFLICT);
        if (before.endsAt.getTime() <= Date.now()) throw new DomainError('ENDED', 'การประชุมจบไปแล้ว แก้ไขไม่ได้', 422);
        if (before.version !== input.expectedVersion) throw conflict();
        const starts = new Date(input.startsAt);
        const ends = new Date(input.endsAt);
        this.validateTimes(starts, ends, { creating: false, startChanged: starts.getTime() !== before.startsAt.getTime() });
        const room = await this.resolveRoom(tx, input.mode, input.roomId);
        if (room) await this.assertRoomFree(tx, room.id, starts, ends, id);
        const attendees = await this.attendeeRows(tx, before.organizerId, input.attendeeIds, input.guestEmails);
        await tx.roomBookingAttendee.deleteMany({ where: { bookingId: id } });
        await tx.roomBooking.update({
          where: { id },
          data: {
            title: input.title.trim(),
            mode: input.mode,
            roomId: room?.id ?? null,
            startsAt: starts,
            endsAt: ends,
            description: clean(input.description),
            meetingUrl: input.mode === BookingMode.ONSITE ? null : clean(input.meetingUrl),
            meetingId: input.meetingId === undefined ? before.meetingId : input.meetingId,
            version: { increment: 1 },
            attendees: { create: attendees },
          },
        });
        await this.sync.markPending(tx, 'room_booking', id);
        await this.audit.record(
          { action: 'room_booking.update', resourceType: 'room_booking', resourceId: id, before: { title: before.title, roomId: before.roomId, startsAt: before.startsAt, endsAt: before.endsAt }, after: input },
          req,
          tx,
        );
      });
    } catch (e) {
      this.mapOverlap(e);
    }
    return this.get(user, id);
  }

  async cancel(user: AuthUser, id: string, input: { reason?: string | null; expectedVersion: number }, req: AppRequest) {
    await this.prisma.$transaction(async (tx) => {
      const b = await tx.roomBooking.findUnique({ where: { id } });
      if (!b) throw notFound('การจอง');
      if (b.organizerId !== user.id && !this.canManage(user)) throw forbidden('ยกเลิกได้เฉพาะผู้จองหรือผู้ดูแลห้องประชุม');
      if (b.status !== BookingStatus.CONFIRMED) throw new DomainError('CANCELLED', 'การจองนี้ถูกยกเลิกแล้ว', HttpStatus.CONFLICT);
      if (b.endsAt.getTime() <= Date.now()) throw new DomainError('ENDED', 'การประชุมจบไปแล้ว ยกเลิกไม่ได้', 422);
      if (b.version !== input.expectedVersion) throw conflict();
      const reason = clean(input.reason);
      await tx.roomBooking.update({
        where: { id },
        data: { status: BookingStatus.CANCELLED, cancelledAt: new Date(), cancelledById: user.id, cancelReason: reason, version: { increment: 1 } },
      });
      await this.sync.markPending(tx, 'room_booking', id);
      await this.audit.record({ action: 'room_booking.cancel', resourceType: 'room_booking', resourceId: id, after: { reason } }, req, tx);
    });
    return this.get(user, id);
  }
}
