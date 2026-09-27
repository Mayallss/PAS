import { Injectable } from '@nestjs/common';
import { EmploymentStatus, WorkCategoryType } from '@prisma/client';
import ExcelJS from 'exceljs';
import { isWeekend, isoWeekday, monthRange, toDate, toIsoDate } from '../../common/dates';
import { PrismaService } from '../../common/prisma.service';
import { AccessService } from '../authorization/access.service';
import type { AuthUser } from '../auth/auth.types';
import { CalendarService } from '../calendar/calendar.service';
import { dayStatusFor } from '../time-report/policy';
import { ScheduleService } from '../calendar/schedule.service';

const THAI_WEEKDAY = ['', 'จ', 'อ', 'พ', 'พฤ', 'ศ', 'ส', 'อา'];

@Injectable()
export class ReportsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly access: AccessService,
    private readonly calendar: CalendarService,
    private readonly schedules: ScheduleService,
  ) {}

  /** Employee × day totals for a month (legacy list_report.php / list_export.php). */
  async timesheet(user: AuthUser, month: string) {
    const scope = await this.access.reportScope(user);
    const { from, to, days } = monthRange(month);
    const range = { gte: toDate(from), lte: toDate(to) };
    const [holidays, sums] = await Promise.all([
      this.calendar.holidays(from, to),
      this.prisma.timeEntry.groupBy({
        by: ['employeeId', 'workDate'],
        _sum: { durationMinutes: true },
        where: { deletedAt: null, workDate: range, employeeId: this.access.employeeFilter(scope) },
      }),
    ]);
    const withEntries = [...new Set(sums.map((s) => s.employeeId))];
    // Active employees plus anyone (e.g. since resigned) who recorded time in the month — same as legacy.
    const employees = await this.prisma.employee.findMany({
      where: {
        AND: [
          { id: this.access.employeeFilter(scope) },
          { OR: [{ status: EmploymentStatus.ACTIVE }, { id: { in: withEntries } }] },
        ],
      },
      select: { id: true, fullName: true, nickname: true, orgUnitId: true, orgUnit: { select: { name: true } } },
      orderBy: { fullName: 'asc' },
    });
    const minutes = new Map(sums.map((s) => [`${s.employeeId}|${toIsoDate(s.workDate)}`, s._sum.durationMinutes ?? 0]));
    const holidayByDate = new Map(holidays.map((h) => [h.date, h]));
    const required = await this.schedules.required(employees, days, new Map(holidays.map((h) => [h.date, h.minutes])));
    return {
      month,
      days: days.map((d) => ({ date: d, weekday: isoWeekday(d), weekend: isWeekend(d), holiday: holidayByDate.get(d)?.description ?? null })),
      employees: employees.map((e) => {
        const daily = days.map((d) => {
          const m = minutes.get(`${e.id}|${d}`) ?? 0;
          const req = required.get(e.id)?.get(d) ?? 0;
          return { date: d, minutes: m, requiredMinutes: req, status: dayStatusFor(m, req) };
        });
        const { orgUnitId: _unit, ...rest } = e;
        return { ...rest, orgUnit: e.orgUnit?.name ?? null, daily, totalMinutes: daily.reduce((a, b) => a + b.minutes, 0) };
      }),
    };
  }

  /** Hours per customer, split by employee level (legacy report_job.php). Cost is omitted until the rate unit is confirmed (docs/06 Q5). */
  async customerEffort(user: AuthUser, from: string, to: string) {
    const scope = await this.access.reportScope(user);
    const entries = await this.prisma.timeEntry.findMany({
      where: { deletedAt: null, workDate: { gte: toDate(from), lte: toDate(to) }, employeeId: this.access.employeeFilter(scope) },
      select: {
        durationMinutes: true,
        employee: { select: { level: { select: { code: true } } } },
        engagement: { select: { customer: { select: { id: true, code: true, name: true, accountOwner: { select: { fullName: true } } } } } },
      },
    });
    const levels = await this.prisma.employeeLevel.findMany({ orderBy: { sortOrder: 'asc' }, select: { code: true, name: true } });
    const byCustomer = new Map<string, { id: string; code: string; name: string; accountOwner: string | null; totalMinutes: number; byLevel: Record<string, number> }>();
    for (const e of entries) {
      const c = e.engagement.customer;
      let row = byCustomer.get(c.id);
      if (!row) {
        row = { id: c.id, code: c.code, name: c.name, accountOwner: c.accountOwner?.fullName ?? null, totalMinutes: 0, byLevel: {} };
        byCustomer.set(c.id, row);
      }
      const level = e.employee.level?.code ?? '-';
      row.totalMinutes += e.durationMinutes;
      row.byLevel[level] = (row.byLevel[level] ?? 0) + e.durationMinutes;
    }
    return { from, to, levels, customers: [...byCustomer.values()].sort((a, b) => a.code.localeCompare(b.code)) };
  }

  /** Leave entries (legacy report_leave.php). */
  async leave(user: AuthUser, from: string, to: string) {
    const scope = await this.access.reportScope(user);
    const rows = await this.prisma.timeEntry.findMany({
      where: {
        deletedAt: null,
        workDate: { gte: toDate(from), lte: toDate(to) },
        employeeId: this.access.employeeFilter(scope),
        engagement: { workCategory: { type: WorkCategoryType.LEAVE } },
      },
      orderBy: [{ workDate: 'asc' }],
      select: {
        id: true,
        workDate: true,
        durationMinutes: true,
        description: true,
        createdAt: true,
        employee: { select: { id: true, fullName: true } },
        engagement: { select: { workCategory: { select: { name: true } } } },
      },
    });
    return rows.map((r) => ({
      id: r.id,
      workDate: toIsoDate(r.workDate),
      durationMinutes: r.durationMinutes,
      description: r.description,
      createdAt: r.createdAt,
      employee: r.employee,
      leaveType: r.engagement.workCategory.name,
    }));
  }

  /** Excel in the legacy layout: title rows, day-number header (weekends red), one row per employee, hours per day. */
  async timesheetXlsx(user: AuthUser, month: string): Promise<{ buffer: Buffer; rows: number }> {
    const data = await this.timesheet(user, month);
    const wb = new ExcelJS.Workbook();
    wb.creator = 'PAS Platform';
    const ws = wb.addWorksheet(`TimeReport ${month}`);
    const lastCol = data.days.length + 3;
    ws.mergeCells(1, 1, 1, lastCol);
    ws.getCell(1, 1).value = `รายงานเวลาทำงาน ประจำเดือน ${month}`;
    ws.getCell(1, 1).font = { bold: true, size: 14 };
    ws.getCell(2, 1).value = `ส่งออกโดย ${user.fullName} เมื่อ ${new Date().toISOString()}`;

    const weekdayRow = ws.getRow(4);
    const header = ws.getRow(5);
    header.getCell(1).value = 'ลำดับ';
    header.getCell(2).value = 'ชื่อ-สกุล';
    data.days.forEach((d, i) => {
      weekdayRow.getCell(i + 3).value = THAI_WEEKDAY[d.weekday];
      header.getCell(i + 3).value = Number(d.date.slice(8));
      if (d.weekend || d.holiday) {
        weekdayRow.getCell(i + 3).font = { bold: true, color: { argb: 'FFFF0000' } };
        header.getCell(i + 3).font = { bold: true, color: { argb: 'FFFF0000' } };
      }
    });
    header.getCell(lastCol).value = 'รวม (ชม.)';
    header.font = { bold: true };

    data.employees.forEach((e, idx) => {
      const row = ws.getRow(6 + idx);
      row.getCell(1).value = idx + 1;
      row.getCell(2).value = e.fullName;
      e.daily.forEach((d, i) => {
        if (d.minutes > 0) row.getCell(i + 3).value = d.minutes / 60;
      });
      row.getCell(lastCol).value = e.totalMinutes / 60;
    });
    ws.getColumn(2).width = 30;
    for (let c = 3; c <= lastCol; c++) {
      ws.getColumn(c).width = c === lastCol ? 10 : 5;
      ws.getColumn(c).alignment = { horizontal: 'center' };
      ws.getColumn(c).numFmt = '0.0';
    }
    ws.views = [{ state: 'frozen', xSplit: 2, ySplit: 5 }];
    return { buffer: Buffer.from(await wb.xlsx.writeBuffer()), rows: data.employees.length };
  }
}
