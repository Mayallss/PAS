import { Body, Controller, Delete, Get, HttpCode, Param, ParseUUIDPipe, Post, Req } from '@nestjs/common';
import { z } from 'zod';
import type { AppRequest } from '../../common/request-context';
import { ZodPipe } from '../../common/zod.pipe';
import type { AuthUser } from './auth.types';
import { CurrentUser, RequirePermission } from './decorators';
import { PasswordService } from './password.service';

const linkBody = z.object({ username: z.string().trim().max(40).nullish() }).strict();

/**
 * Administrators manage password sign-in for a person without ever seeing a password: issue a one-time
 * set-password link (72 h), unlock after too many wrong attempts, or remove password sign-in.
 */
@Controller('employees/:id/credential')
export class CredentialsController {
  constructor(private readonly passwords: PasswordService) {}

  @Get()
  @RequirePermission('employee.admin')
  status(@Param('id', ParseUUIDPipe) id: string) {
    return this.passwords.status(id);
  }

  @Post('setup-link')
  @RequirePermission('employee.admin')
  link(@CurrentUser() user: AuthUser, @Param('id', ParseUUIDPipe) id: string, @Body(new ZodPipe(linkBody)) body: z.infer<typeof linkBody>, @Req() req: AppRequest) {
    return this.passwords.issueSetupLink(user, id, body.username ?? null, req);
  }

  @Post('unlock')
  @HttpCode(204)
  @RequirePermission('employee.admin')
  unlock(@Param('id', ParseUUIDPipe) id: string, @Req() req: AppRequest) {
    return this.passwords.unlock(id, req);
  }

  @Delete()
  @HttpCode(204)
  @RequirePermission('employee.admin')
  remove(@Param('id', ParseUUIDPipe) id: string, @Req() req: AppRequest) {
    return this.passwords.remove(id, req);
  }
}
