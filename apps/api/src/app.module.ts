import { Controller, Get, Global, Module } from '@nestjs/common';
import { APP_GUARD, APP_INTERCEPTOR } from '@nestjs/core';
import { ThrottlerModule } from '@nestjs/throttler';
import { PrismaService } from './common/prisma.service';
import { AccessLogInterceptor } from './common/request-context';
import { AppThrottlerGuard } from './common/throttler.guard';
import { AuditController } from './modules/audit/audit.controller';
import { AuditService } from './modules/audit/audit.service';
import { AuthModule } from './modules/auth/auth.module';
import { Public } from './modules/auth/decorators';
import { SessionGuard } from './modules/auth/session.guard';
import { AccessService } from './modules/authorization/access.service';
import { CalendarController } from './modules/calendar/calendar.controller';
import { CalendarService } from './modules/calendar/calendar.service';
import { ScheduleService } from './modules/calendar/schedule.service';
import { SchedulesController } from './modules/calendar/schedules.controller';
import { CatalogController } from './modules/catalog/catalog.controller';
import { EmployeesController } from './modules/employees/employees.controller';
import { RolesController } from './modules/employees/roles.controller';
import { AnnouncementsController } from './modules/portal/announcements.controller';
import { HomeController } from './modules/portal/home.controller';
import { HomeService } from './modules/portal/home.service';
import { ReportsController } from './modules/reports/reports.controller';
import { ReportsService } from './modules/reports/reports.service';
import { TimeReportController } from './modules/time-report/time-report.controller';
import { TimeReportService } from './modules/time-report/time-report.service';

@Controller('health')
class HealthController {
  constructor(private readonly prisma: PrismaService) {}

  @Public()
  @Get()
  async health() {
    await this.prisma.$queryRaw`SELECT 1`;
    return { status: 'ok' };
  }
}

/** Shared infrastructure available to every module. */
@Global()
@Module({
  providers: [PrismaService, AuditService, AccessService, CalendarService, ScheduleService],
  exports: [PrismaService, AuditService, AccessService, CalendarService, ScheduleService],
})
class SharedModule {}

@Module({
  imports: [
    SharedModule,
    AuthModule,
    ThrottlerModule.forRoot({ throttlers: [{ name: 'default', ttl: 60_000, limit: process.env.NODE_ENV === 'test' ? 10_000 : 300 }] }),
  ],
  controllers: [
    HealthController,
    TimeReportController,
    CalendarController,
    SchedulesController,
    CatalogController,
    EmployeesController,
    RolesController,
    HomeController,
    AnnouncementsController,
    ReportsController,
    AuditController,
  ],
  providers: [
    TimeReportService,
    ReportsService,
    HomeService,
    // Order matters: rate limit first, then authentication/CSRF/permissions.
    { provide: APP_GUARD, useClass: AppThrottlerGuard },
    { provide: APP_GUARD, useClass: SessionGuard },
    { provide: APP_INTERCEPTOR, useClass: AccessLogInterceptor },
  ],
})
export class AppModule {}
