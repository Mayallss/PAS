import { Body, Controller, Delete, Get, HttpCode, Param, ParseUUIDPipe, Put, Query, Req } from '@nestjs/common';
import { z } from 'zod';
import { isIsoDate, isIsoMonth, todayIn } from '../../common/dates';
import type { AppRequest } from '../../common/request-context';
import { ZodPipe } from '../../common/zod.pipe';
import { loadConfig } from '../../config';
import type { AuthUser } from '../auth/auth.types';
import { CurrentUser, RequirePermission } from '../auth/decorators';
import { TimeReportService } from './time-report.service';

const monthQuery = z.object({
  month: z.string().refine(isIsoMonth, 'ต้องเป็นเดือน YYYY-MM'),
  employeeId: z.string().uuid().optional(),
});
const viewQuery = z.object({
  date: z.string().refine(isIsoDate, 'ต้องเป็นวันที่ YYYY-MM-DD').optional(),
  employeeId: z.string().uuid().optional(),
});
const upsertBody = z
  .object({
    engagementId: z.string().uuid(),
    workDate: z.string().refine(isIsoDate, 'ต้องเป็นวันที่ YYYY-MM-DD'),
    durationMinutes: z.number().int(),
    description: z.string().max(500).nullish(),
    expectedVersion: z.number().int().positive().optional(),
  })
  .strict();
const deleteQuery = z.object({ version: z.coerce.number().int().positive() });
const weekQuery = z.object({ weekOf: z.string().refine(isIsoDate).optional() });

@Controller('time-report')
export class TimeReportController {
  constructor(private readonly service: TimeReportService) {}

  /** Weekly timesheet for the week containing `date` (default: today). `employeeId`: read-only view for managers. */
  @Get('week')
  week(@CurrentUser() user: AuthUser, @Query(new ZodPipe(viewQuery)) q: z.infer<typeof viewQuery>) {
    return this.service.week(user, q.date ?? todayIn(loadConfig().TZ_BUSINESS), q.employeeId);
  }

  /** Per-day totals for the month calendar. */
  @Get('month-summary')
  monthSummary(@CurrentUser() user: AuthUser, @Query(new ZodPipe(monthQuery)) q: z.infer<typeof monthQuery>) {
    return this.service.monthSummary(user, q.month, q.employeeId);
  }

  /** Create or update the caller's entry for one (engagement, date) cell. Idempotent for identical payloads. */
  @Put('entries')
  @RequirePermission('time.own.write')
  upsert(@CurrentUser() user: AuthUser, @Body(new ZodPipe(upsertBody)) body: z.infer<typeof upsertBody>, @Req() req: AppRequest) {
    return this.service.upsert(user, body, req);
  }

  @Delete('entries/:id')
  @HttpCode(204)
  @RequirePermission('time.own.write')
  remove(
    @CurrentUser() user: AuthUser,
    @Param('id', ParseUUIDPipe) id: string,
    @Query(new ZodPipe(deleteQuery)) q: z.infer<typeof deleteQuery>,
    @Req() req: AppRequest,
  ) {
    return this.service.remove(user, id, q.version, req);
  }

  @Get('completeness')
  completeness(@CurrentUser() user: AuthUser, @Query(new ZodPipe(weekQuery)) q: z.infer<typeof weekQuery>) {
    return this.service.completeness(user, q.weekOf ?? todayIn(loadConfig().TZ_BUSINESS));
  }
}
