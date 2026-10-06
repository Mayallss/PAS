import { Controller, Get } from '@nestjs/common';
import { CalendarSyncStatus } from '@prisma/client';
import { loadConfig, type IntegrationIssue } from '../../config';
import { PrismaService } from '../../common/prisma.service';
import type { AuthUser } from '../auth/auth.types';
import { CurrentUser } from '../auth/decorators';

type State = 'ON' | 'OFF' | 'ERROR';

/**
 * Optional integrations and what is missing while each is off. The core never depends on them: the UI reads this to
 * show "not connected — X still works, Y is unavailable" instead of failing. Details (setting names, sync errors) are
 * for administrators only.
 */
@Controller('integrations')
export class IntegrationsController {
  constructor(private readonly prisma: PrismaService) {}

  @Get()
  async list(@CurrentUser() user: AuthUser) {
    const c = loadConfig();
    const admin = user.permissions.includes('role.admin') || user.permissions.includes('employee.admin');
    const issues = (k: IntegrationIssue['integration']) => c.integrationIssues.filter((i) => i.integration === k);
    const stateOf = (k: IntegrationIssue['integration'], on: boolean): State => (issues(k).length ? 'ERROR' : on ? 'ON' : 'OFF');

    let syncFailed = 0;
    let syncPending = 0;
    try {
      const groups = await this.prisma.calendarSync.groupBy({ by: ['status'], _count: { _all: true } });
      syncFailed = groups.find((g) => g.status === CalendarSyncStatus.FAILED)?._count._all ?? 0;
      syncPending = groups.find((g) => g.status === CalendarSyncStatus.PENDING)?._count._all ?? 0;
    } catch {
      // status page itself must not fail because a count could not be read
    }

    const items = [
      {
        key: 'google_login',
        name: 'เข้าสู่ระบบด้วยบัญชี Google',
        state: stateOf('google_login', c.oidcEnabled),
        whenOff: c.PASSWORD_LOGIN
          ? 'เข้าสู่ระบบด้วยชื่อผู้ใช้ + รหัสผ่านได้ตามปกติ — ผู้ที่เข้าระบบอยู่แล้วใช้งานต่อได้'
          : 'ไม่มีวิธีเข้าสู่ระบบอื่นเปิดอยู่ (PASSWORD_LOGIN=false) — ผู้ที่เข้าระบบอยู่แล้วใช้งานต่อได้ แต่คนใหม่เข้าไม่ได้',
      },
      {
        key: 'google_calendar',
        name: 'Google Calendar (นัดประชุม, วันลา, แจ้งเตือนบนมือถือ)',
        state: syncFailed > 0 && c.googleCalendarEnabled ? ('ERROR' as State) : stateOf('google_calendar', c.googleCalendarEnabled),
        whenOff: 'จองห้องประชุม ยื่นใบลา และแผนงานใช้ได้ตามปกติบนเว็บ — แค่ไม่ขึ้นในปฏิทิน Google และไม่มีแจ้งเตือนบนมือถือ (เชื่อมเมื่อไรจะส่งรายการที่ค้างไปให้เอง)',
      },
      {
        key: 'monday',
        name: 'monday.com (รับ–ส่งเอกสาร)',
        state: stateOf('monday', Boolean(c.MONDAY_API_TOKEN && c.HANDOFF_LINK_SECRET.length >= 32)),
        whenOff: 'เมนูรับ–ส่งเอกสารใช้ไม่ได้ ส่วนอื่นใช้งานได้ตามปกติ',
      },
    ];
    return {
      items: items.map((i) => ({
        ...i,
        ...(admin
          ? {
              issues: issues(i.key as IntegrationIssue['integration']).map((x) => `${x.setting}: ${x.message}`),
              ...(i.key === 'google_calendar' ? { pending: syncPending, failed: syncFailed } : {}),
            }
          : {}),
      })),
    };
  }
}
