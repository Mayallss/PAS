import { createParamDecorator, ExecutionContext, SetMetadata } from '@nestjs/common';
import type { AppRequest } from '../../common/request-context';
import type { Permission } from '../authorization/permissions';
import type { AuthUser } from './auth.types';

export const PUBLIC_KEY = 'auth:public';
export const PERMISSION_KEY = 'auth:permission';

/** Route needs no session (login, OIDC callback, health). */
export const Public = () => SetMetadata(PUBLIC_KEY, true);

/** Route requires at least one of the listed permissions. */
export const RequirePermission = (...permissions: Permission[]) => SetMetadata(PERMISSION_KEY, permissions);

export const CurrentUser = createParamDecorator((_: unknown, ctx: ExecutionContext): AuthUser => {
  const req = ctx.switchToHttp().getRequest<AppRequest>();
  return req.user!;
});
