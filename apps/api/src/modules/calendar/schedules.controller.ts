import { Body, Controller, Delete, Get, HttpCode, Param, ParseUUIDPipe, Post, Put, Query, Req } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { z } from 'zod';
import { addDays, isIsoDate, toDate, toIsoDate, todayIn } from '../../common/dates';
import { DomainError, notFound } from '../../common/errors';
import { PrismaService } from '../../common/prisma.service';
import type { AppRequest } from '../../common/request-context';
import { ZodPipe } from '../../common/zod.pipe';
import { loadConfig } from '../../config';
import { AuditService } from '../audit/audit.service';
import type { AuthUser } from '../auth/auth.types';
import { CurrentUser, RequirePermission } from '../auth/decorators';
import { ScheduleService } from './schedule.service';

const isoDate = z.string().refine(isIsoDate, 'ต้องเป็นวันที่ YYYY-MM-DD');
const scheduleBody = z
  .object({
    name: z.string().trim().min(1).max(80),
    /** Monday … Sunday */
    weekdayMinutes: z.array(z.number().int().min(0).max(1440)).length(7),
  })
  .strict();
const assignmentBody = z
  .object({
    scheduleId: z.string().uuid(),
    employeeId: z.string().uuid().nullish(),
    orgUnitId: z.string().uuid().nullish(),
    effectiveFrom: isoDate,
    effectiveTo: isoDate.nullish(),
  })
  .strict()
  .refine((b) => !(b.employeeId && b.orgUnitId), 'เลือกได้อย่างใดอย่างหนึ่ง: พนักงาน หรือ ทีม')
  .refine((b) => !b.effectiveTo || b.effectiveTo >= b.effectiveFrom, 'วันสิ้นสุดต้องไม่ก่อนวันเริ่ม');
const previewQuery = z.object({ employeeId: z.string().uuid().optional(), date: isoDate.optional() });

@Controller('calendar/schedules')
export class SchedulesController {
  constructor(
    private readonly prisma: PrismaService,
    private readonly schedules: ScheduleService,
    private readonly audit: AuditService,
  ) {}

  @Get()
  async list() {
    const [schedules, assignments] = await Promise.all([
      this.prisma.workSchedule.findMany({ orderBy: { name: 'asc' }, include: { _count: { select: { assignments: true } } } }),
      this.prisma.scheduleAssignment.findMany({
        orderBy: [{ effectiveFrom: 'desc' }],
        include: {
          schedule: { select: { id: true, name: true } },
          employee: { select: { id: true, fullName: true } },
          orgUnit: { select: { id: true, name: true } },
        },
      }),
    ]);
    return {
      schedules: schedules.map(({ _count, ...s }) => ({ ...s, assignmentCount: _count.assignments })),
      assignments: assignments.map((a) => ({
        id: a.id,
        schedule: a.schedule,
        scope: a.employee ? { type: 'EMPLOYEE', ...a.employee, name: a.employee.fullName } : a.orgUnit ? { type: 'ORG_UNIT', ...a.orgUnit } : { type: 'COMPANY', id: null, name: 'ทั้งบริษัท' },
        effectiveFrom: toIsoDate(a.effectiveFrom),
        effectiveTo: a.effectiveTo ? toIsoDate(a.effectiveTo) : null,
      })),
    };
  }

  /** Which schedule applies to someone on a date — for "why is my target X?" questions. */
  @Get('preview')
  async preview(@CurrentUser() user: AuthUser, @Query(new ZodPipe(previewQuery)) q: z.infer<typeof previewQuery>) {
    const employeeId = q.employeeId && user.permissions.includes('calendar.write') ? q.employeeId : user.id;
    const employee = await this.prisma.employee.findUnique({ where: { id: employeeId }, select: { id: true, orgUnitId: true } });
    if (!employee) throw notFound('พนักงาน');
    const date = q.date ?? todayIn(loadConfig().TZ_BUSINESS);
    const dates = [0, 1, 2, 3, 4, 5, 6].map((i) => addDays(date, i));
    const resolved = (await this.schedules.resolve([employee], dates)).get(employee.id)!;
    return dates.map((d) => ({ date: d, ...resolved.get(d)! }));
  }

  @Post()
  @RequirePermission('calendar.write')
  async create(@Body(new ZodPipe(scheduleBody)) body: z.infer<typeof scheduleBody>, @Req() req: AppRequest) {
    return this.prisma.$transaction(async (tx) => {
      const s = await tx.workSchedule.create({ data: body }).catch((e) => {
        if (e instanceof Prisma.PrismaClientKnownRequestError && e.code === 'P2002') throw new DomainError('DUPLICATE', 'มีชื่อตารางงานนี้แล้ว', 409);
        throw e;
      });
      await this.audit.record({ action: 'schedule.create', resourceType: 'work_schedule', resourceId: s.id, after: body }, req, tx);
      return s;
    });
  }

  /** Editing minutes changes history for every period using this schedule — create a new schedule to change going forward. */
  @Put(':id')
  @RequirePermission('calendar.write')
  async update(@Param('id', ParseUUIDPipe) id: string, @Body(new ZodPipe(scheduleBody)) body: z.infer<typeof scheduleBody>, @Req() req: AppRequest) {
    return this.prisma.$transaction(async (tx) => {
      const before = await tx.workSchedule.findUnique({ where: { id } });
      if (!before) throw notFound('ตารางงาน');
      const s = await tx.workSchedule.update({ where: { id }, data: body });
      await this.audit.record({ action: 'schedule.update', resourceType: 'work_schedule', resourceId: id, before, after: body }, req, tx);
      return s;
    });
  }

  /**
   * Assign a schedule from a date. If the same scope has an open-ended assignment that started earlier,
   * it is closed the day before — the common "from next month on, this team works 8 h" case.
   */
  @Post('assignments')
  @RequirePermission('calendar.write')
  async assign(@Body(new ZodPipe(assignmentBody)) body: z.infer<typeof assignmentBody>, @Req() req: AppRequest) {
    try {
      return await this.prisma.$transaction(async (tx) => {
        const scope = { employeeId: body.employeeId ?? null, orgUnitId: body.orgUnitId ?? null };
        const open = await tx.scheduleAssignment.findFirst({
          where: { ...scope, effectiveTo: null, effectiveFrom: { lt: toDate(body.effectiveFrom) } },
        });
        if (open) {
          await tx.scheduleAssignment.update({ where: { id: open.id }, data: { effectiveTo: toDate(addDays(body.effectiveFrom, -1)) } });
        }
        const a = await tx.scheduleAssignment.create({
          data: {
            scheduleId: body.scheduleId,
            ...scope,
            effectiveFrom: toDate(body.effectiveFrom),
            effectiveTo: body.effectiveTo ? toDate(body.effectiveTo) : null,
          },
        });
        await this.audit.record(
          { action: 'schedule.assign', resourceType: 'schedule_assignment', resourceId: a.id, after: body, metadata: { closedPrevious: open?.id ?? null } },
          req,
          tx,
        );
        return a;
      });
    } catch (e) {
      // Exclusion constraint schedule_assignment_no_overlap (SQLSTATE 23P01) — only that, nothing broader.
      if (e instanceof Error && /23P01|schedule_assignment_no_overlap/.test(e.message)) {
        throw new DomainError('SCHEDULE_OVERLAP', 'ช่วงเวลานี้ทับกับตารางงานที่กำหนดไว้แล้วสำหรับขอบเขตเดียวกัน', 409);
      }
      throw e;
    }
  }

  @Delete('assignments/:id')
  @HttpCode(204)
  @RequirePermission('calendar.write')
  async unassign(@Param('id', ParseUUIDPipe) id: string, @Req() req: AppRequest) {
    await this.prisma.$transaction(async (tx) => {
      const before = await tx.scheduleAssignment.findUnique({ where: { id } });
      if (!before) throw notFound('การกำหนดตารางงาน');
      if (!before.employeeId && !before.orgUnitId && (await tx.scheduleAssignment.count({ where: { employeeId: null, orgUnitId: null } })) <= 1) {
        throw new DomainError('LAST_DEFAULT', 'ต้องมีตารางงานค่าเริ่มต้นของบริษัทอย่างน้อยหนึ่งช่วง', 422);
      }
      await tx.scheduleAssignment.delete({ where: { id } });
      await this.audit.record({ action: 'schedule.unassign', resourceType: 'schedule_assignment', resourceId: id, before }, req, tx);
    });
  }
}
