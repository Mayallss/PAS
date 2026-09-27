import { Injectable } from '@nestjs/common';
import { EmploymentStatus } from '@prisma/client';
import { createHash, randomBytes } from 'crypto';
import type { Response } from 'express';
import { loadConfig } from '../../config';
import { PrismaService } from '../../common/prisma.service';
import { toPermissions } from '../authorization/permissions';
import type { AuthUser } from './auth.types';

const TOUCH_INTERVAL_MS = 5 * 60 * 1000;

export function sessionCookieName() {
  // __Host- prefix pins the cookie to this exact origin over HTTPS.
  return loadConfig().secureCookies ? '__Host-pas_sid' : 'pas_sid';
}

const hash = (token: string) => createHash('sha256').update(token).digest('hex');

/**
 * Opaque server-side sessions: the browser holds a random token (HttpOnly cookie),
 * the database holds only its SHA-256. Sessions are revocable and expire absolutely.
 */
@Injectable()
export class SessionService {
  constructor(private readonly prisma: PrismaService) {}

  async create(employeeId: string, meta: { ip?: string; userAgent?: string }, res: Response) {
    const config = loadConfig();
    const token = randomBytes(32).toString('base64url');
    const expiresAt = new Date(Date.now() + config.SESSION_TTL_HOURS * 3600_000);
    await this.prisma.session.create({
      data: {
        id: hash(token),
        employeeId,
        csrfToken: randomBytes(32).toString('base64url'),
        expiresAt,
        ip: meta.ip,
        userAgent: meta.userAgent?.slice(0, 200),
      },
    });
    res.cookie(sessionCookieName(), token, {
      httpOnly: true,
      secure: config.secureCookies,
      sameSite: 'lax',
      path: '/',
      expires: expiresAt,
    });
  }

  /** Returns the user for a valid session, or null. Inactive employees are rejected even with a live session. */
  async resolve(token: string | undefined): Promise<{ user: AuthUser; sessionId: string; csrfToken: string } | null> {
    if (!token || token.length > 128) return null;
    const id = hash(token);
    const session = await this.prisma.session.findUnique({
      where: { id },
      include: { employee: { include: { roleAssignments: { include: { role: { select: { key: true, permissions: true } } } } } } },
    });
    if (!session) return null;
    if (session.expiresAt <= new Date() || session.employee.status !== EmploymentStatus.ACTIVE) {
      await this.prisma.session.delete({ where: { id } }).catch(() => undefined);
      return null;
    }
    if (Date.now() - session.lastSeenAt.getTime() > TOUCH_INTERVAL_MS) {
      await this.prisma.session.update({ where: { id }, data: { lastSeenAt: new Date() } });
    }
    const e = session.employee;
    return {
      sessionId: id,
      csrfToken: session.csrfToken,
      user: {
        id: e.id,
        fullName: e.fullName,
        email: e.email,
        // Resolved on every request: role/permission edits take effect immediately.
        roles: [...new Set(e.roleAssignments.map((a) => a.role.key))].sort(),
        permissions: toPermissions(e.roleAssignments.flatMap((a) => a.role.permissions)),
        orgUnitId: e.orgUnitId,
      },
    };
  }

  async destroy(sessionId: string | undefined, res: Response) {
    if (sessionId) await this.prisma.session.delete({ where: { id: sessionId } }).catch(() => undefined);
    res.clearCookie(sessionCookieName(), { path: '/', secure: loadConfig().secureCookies, sameSite: 'lax', httpOnly: true });
  }

  /** Used when an employee is deactivated or their roles change. */
  async revokeAllFor(employeeId: string) {
    await this.prisma.session.deleteMany({ where: { employeeId } });
  }
}
