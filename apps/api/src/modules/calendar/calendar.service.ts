import { Injectable } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { toDate, toIsoDate } from '../../common/dates';
import { PrismaService } from '../../common/prisma.service';
import { LEGACY_POLICY, PolicyValues } from '../time-report/policy';

type Db = PrismaService | Prisma.TransactionClient;

@Injectable()
export class CalendarService {
  constructor(private readonly prisma: PrismaService) {}

  async policy(db: Db = this.prisma): Promise<PolicyValues> {
    const row = await db.timePolicy.findUnique({ where: { id: 1 } });
    if (!row) return LEGACY_POLICY;
    const { id: _id, ...values } = row;
    return values;
  }

  async holidays(from: string, to: string, db: Db = this.prisma) {
    const rows = await db.holiday.findMany({ where: { date: { gte: toDate(from), lte: toDate(to) } }, orderBy: { date: 'asc' } });
    return rows.map((h) => ({ id: h.id, date: toIsoDate(h.date), minutes: h.minutes, description: h.description }));
  }

  async holidayMinutes(from: string, to: string, db: Db = this.prisma): Promise<Map<string, number>> {
    return new Map((await this.holidays(from, to, db)).map((h) => [h.date, h.minutes]));
  }

  async isLocked(month: string, db: Db = this.prisma): Promise<boolean> {
    return (await db.periodLock.count({ where: { month } })) > 0;
  }
}
