import { Body, Controller, Delete, Get, HttpCode, Param, ParseUUIDPipe, Post, Put, Query, Req } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { z } from 'zod';
import { isIsoDate, isIsoMonth, toDate } from '../../common/dates';
import { DomainError, notFound } from '../../common/errors';
import { PrismaService } from '../../common/prisma.service';
import type { AppRequest } from '../../common/request-context';
import { ZodPipe } from '../../common/zod.pipe';
import { AuditService } from '../audit/audit.service';
import { RequirePermission } from '../auth/decorators';
import { CalendarService } from './calendar.service';

const isoDate = z.string().refine(isIsoDate, 'ต้องเป็นวันที่ YYYY-MM-DD');
const month = z.string().refine(isIsoMonth, 'ต้องเป็นเดือน YYYY-MM');

const holidaySchema = z.object({
  date: isoDate,
  minutes: z.number().int().min(30).max(540).default(540),
  description: z.string().trim().min(1).max(150),
});
const rangeSchema = z.object({ from: isoDate, to: isoDate });
const lockSchema = z.object({ reason: z.string().trim().max(200).optional() });
const policySchema = z.object({
  incrementMinutes: z.number().int().refine((v) => [5, 6, 10, 15, 30, 60].includes(v), 'ค่าที่รองรับ: 5, 6, 10, 15, 30, 60'),
  maxEntryMinutes: z.number().int().min(30).max(1440),
  maxDailyMinutes: z.number().int().min(60).max(1440).nullable(),
  backdateDays: z.number().int().min(0).max(3650).nullable(),
  futureDays: z.number().int().min(0).max(366),
});

@Controller('calendar')
export class CalendarController {
  constructor(
    private readonly prisma: PrismaService,
    private readonly calendar: CalendarService,
    private readonly audit: AuditService,
  ) {}

  @Get('holidays')
  holidays(@Query(new ZodPipe(rangeSchema)) q: z.infer<typeof rangeSchema>) {
    return this.calendar.holidays(q.from, q.to);
  }

  @Post('holidays')
  @RequirePermission('calendar.write')
  async createHoliday(@Body(new ZodPipe(holidaySchema)) body: z.infer<typeof holidaySchema>, @Req() req: AppRequest) {
    return this.prisma.$transaction(async (tx) => {
      const exists = await tx.holiday.findUnique({ where: { date: toDate(body.date) } });
      if (exists) throw new DomainError('DUPLICATE', 'มีวันหยุดวันนี้อยู่แล้ว', 409);
      const h = await tx.holiday.create({ data: { ...body, date: toDate(body.date) } });
      await this.audit.record({ action: 'holiday.create', resourceType: 'holiday', resourceId: h.id, after: body }, req, tx);
      return h;
    });
  }

  @Put('holidays/:id')
  @RequirePermission('calendar.write')
  async updateHoliday(@Param('id', ParseUUIDPipe) id: string, @Body(new ZodPipe(holidaySchema)) body: z.infer<typeof holidaySchema>, @Req() req: AppRequest) {
    return this.prisma.$transaction(async (tx) => {
      const before = await tx.holiday.findUnique({ where: { id } });
      if (!before) throw notFound('วันหยุด');
      const h = await tx.holiday.update({ where: { id }, data: { ...body, date: toDate(body.date) } });
      await this.audit.record({ action: 'holiday.update', resourceType: 'holiday', resourceId: id, before, after: body }, req, tx);
      return h;
    });
  }

  @Delete('holidays/:id')
  @HttpCode(204)
  @RequirePermission('calendar.write')
  async deleteHoliday(@Param('id', ParseUUIDPipe) id: string, @Req() req: AppRequest) {
    await this.prisma.$transaction(async (tx) => {
      const before = await tx.holiday.findUnique({ where: { id } });
      if (!before) throw notFound('วันหยุด');
      await tx.holiday.delete({ where: { id } });
      await this.audit.record({ action: 'holiday.delete', resourceType: 'holiday', resourceId: id, before }, req, tx);
    });
  }

  @Get('locks')
  locks() {
    return this.prisma.periodLock.findMany({ orderBy: { month: 'desc' } });
  }

  @Put('locks/:month')
  @RequirePermission('calendar.write')
  async lock(@Param('month', new ZodPipe(month)) m: string, @Body(new ZodPipe(lockSchema)) body: z.infer<typeof lockSchema>, @Req() req: AppRequest) {
    return this.prisma.$transaction(async (tx) => {
      const lock = await tx.periodLock.upsert({
        where: { month: m },
        update: {},
        create: { month: m, lockedById: req.user!.id, reason: body.reason },
      });
      await this.audit.record({ action: 'period.lock', resourceType: 'period', resourceId: m, after: body }, req, tx);
      return lock;
    });
  }

  @Delete('locks/:month')
  @HttpCode(204)
  @RequirePermission('calendar.write')
  async unlock(@Param('month', new ZodPipe(month)) m: string, @Req() req: AppRequest) {
    await this.prisma.$transaction(async (tx) => {
      await tx.periodLock.deleteMany({ where: { month: m } });
      await this.audit.record({ action: 'period.unlock', resourceType: 'period', resourceId: m }, req, tx);
    });
  }

  @Get('policy')
  policy() {
    return this.calendar.policy();
  }

  @Put('policy')
  @RequirePermission('calendar.write')
  async updatePolicy(@Body(new ZodPipe(policySchema)) body: z.infer<typeof policySchema>, @Req() req: AppRequest) {
    if (body.maxEntryMinutes % body.incrementMinutes !== 0) {
      throw new DomainError('VALIDATION_FAILED', 'ชั่วโมงสูงสุดต่อรายการต้องหารด้วยหน่วยย่อยลงตัว', 400);
    }
    return this.prisma.$transaction(async (tx: Prisma.TransactionClient) => {
      const before = await this.calendar.policy(tx);
      const after = await tx.timePolicy.upsert({ where: { id: 1 }, update: body, create: { id: 1, ...body } });
      await this.audit.record({ action: 'policy.update', resourceType: 'time_policy', resourceId: '1', before, after: body }, req, tx);
      return after;
    });
  }
}
