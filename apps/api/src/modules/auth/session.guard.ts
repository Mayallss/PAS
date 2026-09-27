import { CanActivate, ExecutionContext, HttpStatus, Injectable } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { timingSafeEqual } from 'crypto';
import { DomainError, forbidden } from '../../common/errors';
import type { AppRequest } from '../../common/request-context';
import type { Permission } from '../authorization/permissions';
import { PERMISSION_KEY, PUBLIC_KEY } from './decorators';
import { SessionService, sessionCookieName } from './session.service';

const SAFE_METHODS = new Set(['GET', 'HEAD', 'OPTIONS']);

function safeEqual(a: string, b: string) {
  const ab = Buffer.from(a);
  const bb = Buffer.from(b);
  return ab.length === bb.length && timingSafeEqual(ab, bb);
}

/**
 * Global guard — deny by default.
 * 1. Resolves the session cookie (401 if missing/expired).
 * 2. Requires X-CSRF-Token matching the session for every state-changing request.
 * 3. Enforces @RequirePermission on the route.
 */
@Injectable()
export class SessionGuard implements CanActivate {
  constructor(
    private readonly reflector: Reflector,
    private readonly sessions: SessionService,
  ) {}

  async canActivate(ctx: ExecutionContext): Promise<boolean> {
    const targets = [ctx.getHandler(), ctx.getClass()];
    if (this.reflector.getAllAndOverride<boolean>(PUBLIC_KEY, targets)) return true;

    const req = ctx.switchToHttp().getRequest<AppRequest>();
    const resolved = await this.sessions.resolve(req.cookies?.[sessionCookieName()]);
    if (!resolved) throw new DomainError('UNAUTHENTICATED', 'กรุณาเข้าสู่ระบบ', HttpStatus.UNAUTHORIZED);

    if (!SAFE_METHODS.has(req.method)) {
      const header = req.header('x-csrf-token') ?? '';
      if (!safeEqual(header, resolved.csrfToken)) throw new DomainError('CSRF_INVALID', 'CSRF token ไม่ถูกต้อง', HttpStatus.FORBIDDEN);
    }

    req.user = resolved.user;
    req.sessionId = resolved.sessionId;

    const required = this.reflector.getAllAndOverride<Permission[]>(PERMISSION_KEY, targets);
    if (required?.length && !required.some((p) => resolved.user.permissions.includes(p))) throw forbidden();
    return true;
  }
}
