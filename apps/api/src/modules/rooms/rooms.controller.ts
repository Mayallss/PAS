import { Body, Controller, Get, Param, ParseUUIDPipe, Patch, Post, Put, Query, Req } from '@nestjs/common';
import { BookingMode } from '@prisma/client';
import { z } from 'zod';
import type { AppRequest } from '../../common/request-context';
import { ZodPipe } from '../../common/zod.pipe';
import type { AuthUser } from '../auth/auth.types';
import { CurrentUser, RequirePermission } from '../auth/decorators';
import { CalendarSyncService } from '../calendar-sync/calendar-sync.service';
import { BOOKING_RULES, RoomsService } from './rooms.service';

const instant = z.string().datetime({ offset: true, message: 'ต้องเป็นวันเวลา ISO พร้อมเขตเวลา' });
const httpsUrl = z
  .string()
  .trim()
  .max(500)
  .url('ลิงก์ไม่ถูกต้อง')
  .refine((u) => u.startsWith('https://'), 'ลิงก์ต้องขึ้นต้นด้วย https://');

const bookingFields = z.object({
  title: z.string().trim().min(1, 'กรุณาระบุหัวข้อ').max(200),
  mode: z.nativeEnum(BookingMode),
  roomId: z.string().uuid().nullish(),
  startsAt: instant,
  endsAt: instant,
  description: z.string().trim().max(2000).nullish(),
  meetingUrl: httpsUrl.nullish().or(z.literal('')),
  attendeeIds: z.array(z.string().uuid()).max(BOOKING_RULES.maxAttendees).optional(),
  guestEmails: z.array(z.string().trim().toLowerCase().email('อีเมลแขกไม่ถูกต้อง')).max(BOOKING_RULES.maxGuests).optional(),
  meetingId: z.string().uuid().nullish(),
});
const createBody = bookingFields.strict();
const updateBody = bookingFields.extend({ expectedVersion: z.number().int().positive() }).strict();
const cancelBody = z.object({ reason: z.string().trim().max(500).nullish(), expectedVersion: z.number().int().positive() }).strict();
const rangeQuery = z.object({ from: instant, to: instant, cancelled: z.enum(['1']).optional() });
const roomsQuery = z.object({ all: z.enum(['1']).optional() });
const roomBody = z
  .object({
    name: z.string().trim().min(1).max(80),
    location: z.string().trim().max(120).nullish(),
    capacity: z.number().int().min(1).max(1000).nullish(),
    features: z.array(z.string().trim().max(40)).max(20).optional(),
    googleResourceEmail: z.string().trim().email().max(200).nullish().or(z.literal('')),
    color: z.string().trim().max(20).nullish(),
    sortOrder: z.number().int().min(0).max(1000).optional(),
    isActive: z.boolean().optional(),
    note: z.string().trim().max(500).nullish(),
  })
  .strict();

/** Meeting rooms and bookings (docs/09). Everyone books; `room.manage` runs the rooms and may change any booking. */
@Controller('rooms')
export class RoomsController {
  constructor(
    private readonly rooms: RoomsService,
    private readonly sync: CalendarSyncService,
  ) {}

  @Get()
  list(@CurrentUser() user: AuthUser, @Query(new ZodPipe(roomsQuery)) q: z.infer<typeof roomsQuery>) {
    return this.rooms.rooms(q.all === '1' && user.permissions.includes('room.manage'));
  }

  @Post()
  @RequirePermission('room.manage')
  createRoom(@Body(new ZodPipe(roomBody)) body: z.infer<typeof roomBody>, @Req() req: AppRequest) {
    return this.rooms.saveRoom(null, body, req);
  }

  @Put(':id')
  @RequirePermission('room.manage')
  updateRoom(@Param('id', ParseUUIDPipe) id: string, @Body(new ZodPipe(roomBody)) body: z.infer<typeof roomBody>, @Req() req: AppRequest) {
    return this.rooms.saveRoom(id, body, req);
  }

  @Get('bookings')
  bookings(@CurrentUser() user: AuthUser, @Query(new ZodPipe(rangeQuery)) q: z.infer<typeof rangeQuery>) {
    return this.rooms.bookings(user, new Date(q.from), new Date(q.to), q.cancelled === '1');
  }

  @Get('bookings/mine')
  mine(@CurrentUser() user: AuthUser) {
    return this.rooms.mine(user);
  }

  @Get('bookings/:id')
  get(@CurrentUser() user: AuthUser, @Param('id', ParseUUIDPipe) id: string) {
    return this.rooms.get(user, id);
  }

  @Post('bookings')
  create(@CurrentUser() user: AuthUser, @Body(new ZodPipe(createBody)) body: z.infer<typeof createBody>, @Req() req: AppRequest) {
    return this.rooms.create(user, { ...body, meetingUrl: body.meetingUrl || null }, req);
  }

  @Patch('bookings/:id')
  update(@CurrentUser() user: AuthUser, @Param('id', ParseUUIDPipe) id: string, @Body(new ZodPipe(updateBody)) body: z.infer<typeof updateBody>, @Req() req: AppRequest) {
    return this.rooms.update(user, id, { ...body, meetingUrl: body.meetingUrl || null }, req);
  }

  @Post('bookings/:id/cancel')
  cancel(@CurrentUser() user: AuthUser, @Param('id', ParseUUIDPipe) id: string, @Body(new ZodPipe(cancelBody)) body: z.infer<typeof cancelBody>, @Req() req: AppRequest) {
    return this.rooms.cancel(user, id, body, req);
  }

  /** Google Calendar connection state (and a manual "sync now"), for whoever runs rooms or HR. */
  @Get('calendar-sync')
  @RequirePermission('room.manage', 'leave.manage')
  syncStatus() {
    return this.sync.status();
  }

  @Post('calendar-sync/run')
  @RequirePermission('room.manage', 'leave.manage')
  syncNow() {
    return this.sync.process();
  }
}
