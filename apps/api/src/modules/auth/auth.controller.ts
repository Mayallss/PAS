import { Body, Controller, Get, HttpCode, HttpStatus, Post, Query, Req, Res } from '@nestjs/common';
import { Throttle } from '@nestjs/throttler';
import { EmploymentStatus, Prisma } from '@prisma/client';
import type { Response } from 'express';
import { z } from 'zod';
import { loadConfig } from '../../config';
import { DomainError } from '../../common/errors';
import { PrismaService } from '../../common/prisma.service';
import type { AppRequest } from '../../common/request-context';
import { ZodPipe } from '../../common/zod.pipe';
import { AuditService } from '../audit/audit.service';
import type { AuthUser } from './auth.types';
import { CurrentUser, Public } from './decorators';
import { OidcService, OidcTransaction } from './oidc.service';
import { PasswordService } from './password.service';
import { SessionService, sessionCookieName } from './session.service';

const OIDC_TX_COOKIE = 'pas_oidc_tx';
const devLoginSchema = z.object({ email: z.string().email().max(200) });
const passwordLoginSchema = z.object({ username: z.string().trim().min(1).max(60), password: z.string().min(1).max(200) }).strict();
const setupTokenSchema = z.object({ token: z.string().min(20).max(100) });
const setupSchema = z.object({ token: z.string().min(20).max(100), password: z.string().min(1).max(200) }).strict();
const changeSchema = z.object({ current: z.string().min(1).max(200), next: z.string().min(1).max(200) }).strict();
/** Per-IP login attempts per minute. 30: an office behind one NAT address must not lock itself out at 08:30; guessing one account is stopped by its own lock (5 wrong → 15 min). */
const LOGIN_THROTTLE = { default: { limit: Number(process.env.LOGIN_RATE_LIMIT ?? 30), ttl: 60_000 } };

@Controller('auth')
export class AuthController {
  constructor(
    private readonly prisma: PrismaService,
    private readonly sessions: SessionService,
    private readonly oidc: OidcService,
    private readonly audit: AuditService,
    private readonly passwords: PasswordService,
  ) {}

  @Public()
  @Get('config')
  config() {
    const c = loadConfig();
    return { sso: c.oidcEnabled, password: c.PASSWORD_LOGIN, devLogin: c.AUTH_DEV_LOGIN };
  }

  @Get('me')
  async me(@CurrentUser() user: AuthUser, @Req() req: AppRequest) {
    const session = await this.prisma.session.findUniqueOrThrow({ where: { id: req.sessionId! }, select: { csrfToken: true, expiresAt: true } });
    return { user, csrfToken: session.csrfToken, sessionExpiresAt: session.expiresAt };
  }

  @Public()
  @Throttle(LOGIN_THROTTLE)
  @Get('login')
  async login(@Res() res: Response) {
    const c = loadConfig();
    if (!c.oidcEnabled) throw new DomainError('SSO_NOT_CONFIGURED', 'ยังไม่ได้ตั้งค่า SSO', HttpStatus.NOT_FOUND);
    let started: Awaited<ReturnType<OidcService['authorizationUrl']>>;
    try {
      started = await this.oidc.authorizationUrl();
    } catch {
      // Google unreachable: back to the login page with a clear message instead of a raw 500. Sessions already
      // open keep working — they are ours, not Google's.
      return res.redirect(`${c.APP_ORIGIN}/login?error=sso_unavailable`);
    }
    const { url, tx } = started;
    res.cookie(OIDC_TX_COOKIE, JSON.stringify(tx), {
      httpOnly: true,
      secure: c.secureCookies,
      sameSite: 'lax',
      path: '/api/auth',
      maxAge: 10 * 60_000,
    });
    res.redirect(url);
  }

  @Public()
  @Throttle(LOGIN_THROTTLE)
  @Get('callback')
  async callback(@Req() req: AppRequest, @Res() res: Response, @Query() query: Record<string, string>) {
    const c = loadConfig();
    const fail = async (reason: string) => {
      await this.audit.record({ action: 'auth.login_failed', resourceType: 'session', metadata: { reason, method: 'oidc' } }, req);
      res.redirect(`${c.APP_ORIGIN}/login?error=${encodeURIComponent('sso_failed')}`);
    };
    let tx: OidcTransaction;
    try {
      tx = JSON.parse(req.cookies?.[OIDC_TX_COOKIE] ?? '');
    } catch {
      return fail('missing_transaction');
    }
    res.clearCookie(OIDC_TX_COOKIE, { path: '/api/auth' });
    let identity;
    try {
      identity = await this.oidc.callback(query, tx);
    } catch (e) {
      return fail(e instanceof Error ? e.message : 'callback_error');
    }
    const employee =
      (await this.prisma.employee.findUnique({ where: { oidcSubject: identity.subject } })) ??
      (await this.prisma.employee.findFirst({ where: { email: { equals: identity.email, mode: 'insensitive' }, oidcSubject: null } }));
    if (!employee || employee.status !== EmploymentStatus.ACTIVE) return fail('no_active_employee');
    if (!employee.oidcSubject) {
      await this.prisma.employee.update({ where: { id: employee.id }, data: { oidcSubject: identity.subject } });
    }
    await this.startSession(employee.id, 'oidc', req, res);
    res.redirect(`${c.APP_ORIGIN}/`);
  }

  /** Development only: sign in as a seeded user by e-mail. Disabled unless AUTH_DEV_LOGIN=true (refused in production). */
  @Public()
  @Throttle(LOGIN_THROTTLE)
  @Post('dev-login')
  @HttpCode(204)
  async devLogin(@Body(new ZodPipe(devLoginSchema)) body: z.infer<typeof devLoginSchema>, @Req() req: AppRequest, @Res({ passthrough: true }) res: Response) {
    if (!loadConfig().AUTH_DEV_LOGIN) throw new DomainError('NOT_FOUND', 'Not found', HttpStatus.NOT_FOUND);
    const employee = await this.prisma.employee.findFirst({
      where: { email: { equals: body.email, mode: Prisma.QueryMode.insensitive }, status: EmploymentStatus.ACTIVE },
    });
    if (!employee) {
      await this.audit.record({ action: 'auth.login_failed', resourceType: 'session', metadata: { method: 'dev' } }, req);
      throw new DomainError('LOGIN_FAILED', 'ไม่พบผู้ใช้', HttpStatus.UNAUTHORIZED);
    }
    await this.startSession(employee.id, 'dev', req, res);
  }

  /** Username + password (works without Google). Per-IP rate limit + per-account lock after 5 wrong passwords. */
  @Public()
  @Throttle(LOGIN_THROTTLE)
  @Post('password-login')
  @HttpCode(204)
  async passwordLogin(@Body(new ZodPipe(passwordLoginSchema)) body: z.infer<typeof passwordLoginSchema>, @Req() req: AppRequest, @Res({ passthrough: true }) res: Response) {
    const employeeId = await this.passwords.login(body.username, body.password, req);
    await this.startSession(employeeId, 'password', req, res);
  }

  /** The set-password page shows whose account the one-time link is for. */
  @Public()
  @Throttle(LOGIN_THROTTLE)
  @Get('password-setup')
  setupInfo(@Query(new ZodPipe(setupTokenSchema)) q: z.infer<typeof setupTokenSchema>) {
    return this.passwords.setupInfo(q.token);
  }

  /** Choose a password with the one-time link from an administrator; signs in straight away. */
  @Public()
  @Throttle(LOGIN_THROTTLE)
  @Post('password-setup')
  @HttpCode(204)
  async setup(@Body(new ZodPipe(setupSchema)) body: z.infer<typeof setupSchema>, @Req() req: AppRequest, @Res({ passthrough: true }) res: Response) {
    const employeeId = await this.passwords.completeSetup(body.token, body.password, req);
    await this.startSession(employeeId, 'password-setup', req, res);
  }

  @Throttle(LOGIN_THROTTLE)
  @Post('password')
  @HttpCode(204)
  async changePassword(@CurrentUser() user: AuthUser, @Body(new ZodPipe(changeSchema)) body: z.infer<typeof changeSchema>, @Req() req: AppRequest) {
    await this.passwords.change(user, body.current, body.next, req);
  }

  @Get('password')
  passwordStatus(@CurrentUser() user: AuthUser) {
    return this.passwords.status(user.id).then((s) => ({ enabled: s.enabled, username: s.username, hasPassword: s.hasPassword, passwordChangedAt: s.passwordChangedAt }));
  }

  @Post('logout')
  @HttpCode(204)
  async logout(@Req() req: AppRequest, @Res({ passthrough: true }) res: Response) {
    await this.audit.record({ action: 'auth.logout', resourceType: 'session' }, req);
    await this.sessions.destroy(req.sessionId, res);
  }

  private async startSession(employeeId: string, method: string, req: AppRequest, res: Response) {
    // Prevent session fixation: drop any session presented by this browser before issuing a new one.
    const existing = await this.sessions.resolve(req.cookies?.[sessionCookieName()]);
    if (existing) await this.sessions.destroy(existing.sessionId, res);
    await this.sessions.create(employeeId, { ip: req.ip, userAgent: req.header('user-agent') }, res);
    await this.audit.record({ action: 'auth.login', resourceType: 'session', actorId: employeeId, metadata: { method } }, req);
  }
}
