import { Body, Controller, Get, Param, ParseUUIDPipe, Patch, Post, Req } from '@nestjs/common';
import { ExternalAccountStatus, TaskStatus } from '@prisma/client';
import { z } from 'zod';
import { isIsoDate } from '../../common/dates';
import type { AppRequest } from '../../common/request-context';
import { ZodPipe } from '../../common/zod.pipe';
import type { AuthUser } from '../auth/auth.types';
import { CurrentUser, RequirePermission } from '../auth/decorators';
import { OnboardingService } from './onboarding.service';

const isoDate = z.string().refine(isIsoDate, 'ต้องเป็นวันที่ YYYY-MM-DD');
const taskBody = z
  .object({
    status: z.nativeEnum(TaskStatus),
    note: z.string().trim().max(1000).nullish(),
    identifier: z.string().trim().max(200).nullish(),
    assetCode: z.string().trim().max(40).nullish(),
    assignKind: z.enum(['PRIMARY', 'LOAN']).optional(),
    dueDate: isoDate.nullish(),
  })
  .strict();
const accountBody = z
  .object({
    systemId: z.string().uuid(),
    identifier: z.string().trim().min(1).max(200),
    status: z.enum([ExternalAccountStatus.ACTIVE, ExternalAccountStatus.PENDING]).default(ExternalAccountStatus.ACTIVE),
    activatedOn: isoDate.nullish(),
    note: z.string().trim().max(500).nullish(),
  })
  .strict();
const accountPatch = z
  .object({
    identifier: z.string().trim().min(1).max(200).optional(),
    status: z.nativeEnum(ExternalAccountStatus).optional(),
    note: z.string().trim().max(500).nullish(),
    date: isoDate.nullish(),
  })
  .strict();

/** New-employee checklist and accounts in other systems (docs/07). */
@Controller('onboarding')
export class OnboardingController {
  constructor(private readonly onboarding: OnboardingService) {}

  @Get('options')
  @RequirePermission('employee.admin', 'onboarding.manage')
  options() {
    return this.onboarding.options();
  }

  @Get('tasks')
  @RequirePermission('onboarding.manage')
  tasks() {
    return this.onboarding.openTasks();
  }

  @Post('tasks/:id')
  @RequirePermission('onboarding.manage')
  updateTask(@CurrentUser() user: AuthUser, @Param('id', ParseUUIDPipe) id: string, @Body(new ZodPipe(taskBody)) body: z.infer<typeof taskBody>, @Req() req: AppRequest) {
    return this.onboarding.updateTask(user, id, body, req);
  }

  @Post('employees/:id/accounts')
  @RequirePermission('onboarding.manage')
  addAccount(@Param('id', ParseUUIDPipe) id: string, @Body(new ZodPipe(accountBody)) body: z.infer<typeof accountBody>, @Req() req: AppRequest) {
    return this.onboarding.addAccount(id, body, req);
  }

  @Patch('accounts/:id')
  @RequirePermission('onboarding.manage')
  updateAccount(@Param('id', ParseUUIDPipe) id: string, @Body(new ZodPipe(accountPatch)) body: z.infer<typeof accountPatch>, @Req() req: AppRequest) {
    return this.onboarding.updateAccount(id, body, req);
  }
}
