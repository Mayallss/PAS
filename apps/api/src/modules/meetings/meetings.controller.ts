import { Body, Controller, Delete, Get, HttpCode, Param, ParseUUIDPipe, Post, Put, Query, Req } from '@nestjs/common';
import { CertificationStatus } from '@prisma/client';
import { z } from 'zod';
import { isIsoDate } from '../../common/dates';
import type { AppRequest } from '../../common/request-context';
import { ZodPipe } from '../../common/zod.pipe';
import type { AuthUser } from '../auth/auth.types';
import { CurrentUser, RequirePermission } from '../auth/decorators';
import { MeetingsService } from './meetings.service';

const time = z
  .string()
  .regex(/^([01]\d|2[0-3]):[0-5]\d$/, 'เวลาต้องเป็น HH:MM')
  .nullish();
const meetingBase = {
  title: z.string().trim().min(1).max(200),
  meetingDate: z.string().refine(isIsoDate, 'ต้องเป็นวันที่ YYYY-MM-DD'),
  startTime: time,
  endTime: time,
  location: z.string().trim().max(120).nullish(),
  /** Rich text; sanitised on the server with an allow-list. */
  bodyHtml: z.string().min(1).max(500_000),
};
const timesValid = (b: { startTime?: string | null; endTime?: string | null }) => !b.startTime || !b.endTime || b.endTime > b.startTime;
const createBody = z.object(meetingBase).strict().refine(timesValid, 'เวลาสิ้นสุดต้องหลังเวลาเริ่ม');
const reviseBody = z
  .object({
    ...meetingBase,
    expectedVersion: z.number().int().positive(),
    changeNote: z.string().trim().max(1000).nullish(),
    requiresRecertification: z.boolean(),
  })
  .strict()
  .refine(timesValid, 'เวลาสิ้นสุดต้องหลังเวลาเริ่ม');
const certifyBody = z
  .object({
    version: z.number().int().positive(),
    status: z.nativeEnum(CertificationStatus),
    quote: z.string().max(1000).nullish(),
    note: z.string().max(2000).nullish(),
  })
  .strict();
const replyBody = z.object({ version: z.number().int().positive(), reply: z.string().trim().min(1).max(1000) }).strict();
const listQuery = z.object({ limit: z.coerce.number().int().min(1).max(200).default(60) });
const detailQuery = z.object({ compare: z.coerce.number().int().positive().optional() });

/** Meeting minutes (legacy meet / meet_agree) with versioning, objections and re-certification. */
@Controller('meetings')
export class MeetingsController {
  constructor(private readonly meetings: MeetingsService) {}

  @Get()
  list(@CurrentUser() user: AuthUser, @Query(new ZodPipe(listQuery)) q: z.infer<typeof listQuery>) {
    return this.meetings.list(user, q.limit);
  }

  @Get(':id')
  detail(@CurrentUser() user: AuthUser, @Param('id', ParseUUIDPipe) id: string, @Query(new ZodPipe(detailQuery)) q: z.infer<typeof detailQuery>) {
    return this.meetings.detail(user, id, q.compare);
  }

  @Post()
  @RequirePermission('meeting.write')
  create(@CurrentUser() user: AuthUser, @Body(new ZodPipe(createBody)) body: z.infer<typeof createBody>, @Req() req: AppRequest) {
    return this.meetings.create(user, body, req);
  }

  @Put(':id')
  @RequirePermission('meeting.write')
  revise(@CurrentUser() user: AuthUser, @Param('id', ParseUUIDPipe) id: string, @Body(new ZodPipe(reviseBody)) body: z.infer<typeof reviseBody>, @Req() req: AppRequest) {
    return this.meetings.revise(user, id, body, req);
  }

  @Delete(':id')
  @HttpCode(204)
  @RequirePermission('meeting.write')
  remove(@Param('id', ParseUUIDPipe) id: string, @Req() req: AppRequest) {
    return this.meetings.remove(id, req);
  }

  /** "รับรอง" (ACCEPTED) or "แย้ง" (OBJECTION with quote + note) for the current version. */
  @Post(':id/certify')
  certify(@CurrentUser() user: AuthUser, @Param('id', ParseUUIDPipe) id: string, @Body(new ZodPipe(certifyBody)) body: z.infer<typeof certifyBody>, @Req() req: AppRequest) {
    return this.meetings.certify(user, id, body, req);
  }

  @Post(':id/objections/:employeeId/reply')
  @RequirePermission('meeting.write')
  reply(
    @CurrentUser() user: AuthUser,
    @Param('id', ParseUUIDPipe) id: string,
    @Param('employeeId', ParseUUIDPipe) employeeId: string,
    @Body(new ZodPipe(replyBody)) body: z.infer<typeof replyBody>,
    @Req() req: AppRequest,
  ) {
    return this.meetings.reply(user, id, employeeId, body, req);
  }
}
