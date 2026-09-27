import { Controller, Get, Query, Req, Res } from '@nestjs/common';
import type { Response } from 'express';
import { z } from 'zod';
import { isIsoDate, isIsoMonth, toDate } from '../../common/dates';
import type { AppRequest } from '../../common/request-context';
import { ZodPipe } from '../../common/zod.pipe';
import { AuditService } from '../audit/audit.service';
import type { AuthUser } from '../auth/auth.types';
import { CurrentUser, RequirePermission } from '../auth/decorators';
import { ReportsService } from './reports.service';

const monthQuery = z.object({ month: z.string().refine(isIsoMonth, 'ต้องเป็นเดือน YYYY-MM') });
const rangeQuery = z
  .object({ from: z.string().refine(isIsoDate), to: z.string().refine(isIsoDate) })
  .refine((q) => q.from <= q.to, 'from ต้องไม่เกิน to')
  .refine((q) => (toDate(q.to).getTime() - toDate(q.from).getTime()) / 86400000 <= 366, 'ช่วงวันที่ต้องไม่เกิน 1 ปี');

@Controller('reports')
@RequirePermission('report.team.read', 'report.all.read')
export class ReportsController {
  constructor(
    private readonly reports: ReportsService,
    private readonly audit: AuditService,
  ) {}

  @Get('timesheet')
  timesheet(@CurrentUser() user: AuthUser, @Query(new ZodPipe(monthQuery)) q: z.infer<typeof monthQuery>) {
    return this.reports.timesheet(user, q.month);
  }

  @Get('customer-effort')
  customerEffort(@CurrentUser() user: AuthUser, @Query(new ZodPipe(rangeQuery)) q: z.infer<typeof rangeQuery>) {
    return this.reports.customerEffort(user, q.from, q.to);
  }

  @Get('leave')
  leave(@CurrentUser() user: AuthUser, @Query(new ZodPipe(rangeQuery)) q: z.infer<typeof rangeQuery>) {
    return this.reports.leave(user, q.from, q.to);
  }

  /** Sensitive export: permission-checked, scoped, audited, never cached. */
  @Get('timesheet/export')
  @RequirePermission('report.export')
  async exportTimesheet(@CurrentUser() user: AuthUser, @Query(new ZodPipe(monthQuery)) q: z.infer<typeof monthQuery>, @Req() req: AppRequest, @Res() res: Response) {
    const { buffer, rows } = await this.reports.timesheetXlsx(user, q.month);
    await this.audit.record({ action: 'report.export', resourceType: 'report', resourceId: 'timesheet', metadata: { month: q.month, rows, format: 'xlsx' } }, req);
    res.setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
    res.setHeader('Content-Disposition', `attachment; filename="timereport-${q.month}.xlsx"`);
    res.setHeader('Cache-Control', 'no-store');
    res.send(buffer);
  }
}
