import { Body, Controller, Get, Param, ParseUUIDPipe, Patch, Post, Put, Query, Req } from '@nestjs/common';
import { EmploymentType, LeaveRequestStatus, LeaveUnit } from '@prisma/client';
import { z } from 'zod';
import { loadConfig } from '../../config';
import { isIsoDate, isIsoMonth, todayIn } from '../../common/dates';
import type { AppRequest } from '../../common/request-context';
import { ZodPipe } from '../../common/zod.pipe';
import type { AuthUser } from '../auth/auth.types';
import { CurrentUser, RequirePermission } from '../auth/decorators';
import { LeaveService } from './leave.service';

const isoDate = z.string().refine(isIsoDate, 'ต้องเป็นวันที่ YYYY-MM-DD');
const year = z.coerce.number().int().min(2000).max(2100);
const MAX_YEAR_MINUTES = 366 * 540;

const target = z.object({
  employeeId: z.string().uuid().nullish(),
  leaveTypeId: z.string().uuid(),
  unit: z.nativeEnum(LeaveUnit),
  startDate: isoDate,
  endDate: isoDate,
  minutes: z.number().int().positive().max(1440).nullish(),
});
const previewBody = target.strict();
const createBody = target
  .extend({
    reason: z.string().trim().min(1, 'กรุณาระบุเหตุผลการลา').max(500),
    approve: z.boolean().optional(),
  })
  .strict()
  .refine((v) => v.unit !== LeaveUnit.HOURS || v.minutes, { message: 'ระบุจำนวนชั่วโมง', path: ['minutes'] });
const decisionBody = z
  .object({ decision: z.enum(['APPROVE', 'REJECT']), note: z.string().trim().max(500).nullish(), expectedVersion: z.number().int().positive() })
  .strict();
const cancelBody = z.object({ reason: z.string().trim().max(500).nullish(), expectedVersion: z.number().int().positive() }).strict();
const documentBody = z.object({ received: z.boolean() }).strict();
const yearQuery = z.object({ year: year.optional() });
const monthQuery = z.object({ month: z.string().refine(isIsoMonth, 'ต้องเป็นเดือน YYYY-MM') });
const listQuery = z.object({ status: z.nativeEnum(LeaveRequestStatus).optional(), year: year.optional(), employeeId: z.string().uuid().optional() });
const typesQuery = z.object({ all: z.enum(['1']).optional() });
const entitlementBody = z
  .object({
    employeeId: z.string().uuid(),
    leaveTypeId: z.string().uuid(),
    year: z.number().int().min(2000).max(2100),
    minutes: z.number().int().min(0).max(MAX_YEAR_MINUTES).nullable(),
    note: z.string().trim().max(300).nullish(),
  })
  .strict();
const typeFields = {
  name: z.string().trim().min(1).max(60),
  annualMinutes: z.number().int().min(0).max(MAX_YEAR_MINUTES).nullable(),
  minTenureMonths: z.number().int().min(0).max(120),
  paid: z.boolean(),
  allowHours: z.boolean(),
  certificateFromDays: z.number().int().min(1).max(60).nullable(),
  appliesTo: z.array(z.nativeEnum(EmploymentType)).max(10),
  color: z.string().trim().max(20).nullable(),
  source: z.string().trim().max(300).nullable(),
};
const typePatch = z.object({ ...typeFields, sortOrder: z.number().int().min(0).max(1000), isActive: z.boolean() }).partial().strict();
const typeCreate = z.object({ key: z.string().trim().regex(/^[A-Z][A-Z0-9_]{1,30}$/, 'รหัสภาษาอังกฤษตัวใหญ่ เช่น MATERNITY'), ...typeFields }).strict();

/** Calendar year in the business time zone (not the server's). */
const thisYear = () => Number(todayIn(loadConfig().TZ_BUSINESS).slice(0, 4));

/** HR — leave (docs/09). Everyone files their own; team leads decide for their teams; `leave.manage` = HR. */
@Controller('leave')
export class LeaveController {
  constructor(private readonly leave: LeaveService) {}

  @Get('types')
  types(@CurrentUser() user: AuthUser, @Query(new ZodPipe(typesQuery)) q: z.infer<typeof typesQuery>) {
    return this.leave.types(q.all === '1' && user.permissions.includes('leave.manage'));
  }

  @Get('me')
  mine(@CurrentUser() user: AuthUser, @Query(new ZodPipe(yearQuery)) q: z.infer<typeof yearQuery>) {
    return this.leave.mine(user, q.year ?? thisYear());
  }

  @Post('preview')
  preview(@CurrentUser() user: AuthUser, @Body(new ZodPipe(previewBody)) body: z.infer<typeof previewBody>) {
    return this.leave.preview(user, body);
  }

  @Post('requests')
  create(@CurrentUser() user: AuthUser, @Body(new ZodPipe(createBody)) body: z.infer<typeof createBody>, @Req() req: AppRequest) {
    return this.leave.create(user, body, req);
  }

  @Get('requests')
  @RequirePermission('leave.manage')
  list(@Query(new ZodPipe(listQuery)) q: z.infer<typeof listQuery>) {
    return this.leave.list(q);
  }

  @Get('requests/:id')
  get(@CurrentUser() user: AuthUser, @Param('id', ParseUUIDPipe) id: string) {
    return this.leave.get(user, id);
  }

  @Post('requests/:id/decision')
  decide(@CurrentUser() user: AuthUser, @Param('id', ParseUUIDPipe) id: string, @Body(new ZodPipe(decisionBody)) body: z.infer<typeof decisionBody>, @Req() req: AppRequest) {
    return this.leave.decide(user, id, body, req);
  }

  @Post('requests/:id/cancel')
  cancel(@CurrentUser() user: AuthUser, @Param('id', ParseUUIDPipe) id: string, @Body(new ZodPipe(cancelBody)) body: z.infer<typeof cancelBody>, @Req() req: AppRequest) {
    return this.leave.cancel(user, id, body, req);
  }

  @Post('requests/:id/document')
  @RequirePermission('leave.manage')
  document(@Param('id', ParseUUIDPipe) id: string, @Body(new ZodPipe(documentBody)) body: z.infer<typeof documentBody>, @Req() req: AppRequest) {
    return this.leave.setDocumentReceived(id, body.received, req);
  }

  @Get('approvals')
  approvals(@CurrentUser() user: AuthUser) {
    return this.leave.approvals(user);
  }

  @Get('calendar')
  calendar(@CurrentUser() user: AuthUser, @Query(new ZodPipe(monthQuery)) q: z.infer<typeof monthQuery>) {
    return this.leave.teamCalendar(user, q.month);
  }

  @Get('entitlements')
  @RequirePermission('leave.manage')
  entitlements(@Query(new ZodPipe(yearQuery)) q: z.infer<typeof yearQuery>) {
    return this.leave.entitlements(q.year ?? thisYear());
  }

  @Put('entitlements')
  @RequirePermission('leave.manage')
  setEntitlement(@CurrentUser() user: AuthUser, @Body(new ZodPipe(entitlementBody)) body: z.infer<typeof entitlementBody>, @Req() req: AppRequest) {
    return this.leave.setEntitlement(user, body, req);
  }

  @Post('types')
  @RequirePermission('leave.manage')
  createType(@Body(new ZodPipe(typeCreate)) body: z.infer<typeof typeCreate>, @Req() req: AppRequest) {
    return this.leave.createType(body, req);
  }

  @Patch('types/:id')
  @RequirePermission('leave.manage')
  updateType(@Param('id', ParseUUIDPipe) id: string, @Body(new ZodPipe(typePatch)) body: z.infer<typeof typePatch>, @Req() req: AppRequest) {
    return this.leave.updateType(id, body, req);
  }
}
