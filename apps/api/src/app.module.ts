import { Controller, Get, Global, Module } from '@nestjs/common';
import { APP_GUARD, APP_INTERCEPTOR } from '@nestjs/core';
import { ThrottlerModule } from '@nestjs/throttler';
import { PrismaService } from './common/prisma.service';
import { AccessLogInterceptor } from './common/request-context';
import { AppThrottlerGuard } from './common/throttler.guard';
import { StorageService } from './common/storage.service';
import { AssetsController } from './modules/assets/assets.controller';
import { LicensesController } from './modules/assets/licenses.controller';
import { LicensesService } from './modules/assets/licenses.service';
import { AssetsService } from './modules/assets/assets.service';
import { RequestsController } from './modules/assets/requests.controller';
import { RequestsService } from './modules/assets/requests.service';
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
import { OrgUnitsController } from './modules/employees/org-units.controller';
import { RolesController } from './modules/employees/roles.controller';
import { AnnouncementsController } from './modules/portal/announcements.controller';
import { HomeController } from './modules/portal/home.controller';
import { IntegrationsController } from './modules/portal/integrations.controller';
import { HomeService } from './modules/portal/home.service';
import { MeetingsController } from './modules/meetings/meetings.controller';
import { MeetingsService } from './modules/meetings/meetings.service';
import { OnboardingController } from './modules/onboarding/onboarding.controller';
import { OnboardingService } from './modules/onboarding/onboarding.service';
import { ReportsController } from './modules/reports/reports.controller';
import { ReportsService } from './modules/reports/reports.service';
import { CostRatesController } from './modules/reports/cost.controller';
import { CostService } from './modules/reports/cost.service';
import { TimeReportController } from './modules/time-report/time-report.controller';
import { TimeReportService } from './modules/time-report/time-report.service';
import { HandoffsController, PublicHandoffsController } from './modules/handoffs/handoffs.controller';
import { HandoffsService } from './modules/handoffs/handoffs.service';
import { TodosController } from './modules/todos/todos.controller';
import { TodosService } from './modules/todos/todos.service';
import { CalendarSyncService } from './modules/calendar-sync/calendar-sync.service';
import { LeaveController } from './modules/leave/leave.controller';
import { LeaveService } from './modules/leave/leave.service';
import { RoomsController } from './modules/rooms/rooms.controller';
import { RoomsService } from './modules/rooms/rooms.service';

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
    TodosController,
    HandoffsController,
    PublicHandoffsController,
    CalendarController,
    SchedulesController,
    CatalogController,
    EmployeesController,
    RolesController,
    OrgUnitsController,
    HomeController,
    IntegrationsController,
    AnnouncementsController,
    MeetingsController,
    ReportsController,
    CostRatesController,
    AssetsController,
    LicensesController,
    RequestsController,
    OnboardingController,
    LeaveController,
    RoomsController,
    AuditController,
  ],
  providers: [
    TimeReportService,
    TodosService,
    HandoffsService,
    ReportsService,
    CostService,
    HomeService,
    MeetingsService,
    StorageService,
    AssetsService,
    LicensesService,
    RequestsService,
    OnboardingService,
    CalendarSyncService,
    LeaveService,
    RoomsService,
    // Order matters: rate limit first, then authentication/CSRF/permissions.
    { provide: APP_GUARD, useClass: AppThrottlerGuard },
    { provide: APP_GUARD, useClass: SessionGuard },
    { provide: APP_INTERCEPTOR, useClass: AccessLogInterceptor },
  ],
})
export class AppModule {}
