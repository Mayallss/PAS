import { Injectable } from '@nestjs/common';
import { ThrottlerGuard } from '@nestjs/throttler';
import { createHash } from 'crypto';
import { sessionCookieName } from '../modules/auth/session.service';

/**
 * Rate-limit per signed-in session rather than per IP: server-side rendering calls the API from the
 * Next.js server, so every user would otherwise share one IP bucket.
 * Authentication endpoints are ALWAYS limited per IP — otherwise a brute-force client could send a
 * random cookie on each attempt to get a fresh bucket.
 */
@Injectable()
export class AppThrottlerGuard extends ThrottlerGuard {
  protected async getTracker(req: Record<string, any>): Promise<string> {
    const path: string = req.path ?? '';
    const token: string | undefined = req.cookies?.[sessionCookieName()];
    if (token && !path.startsWith('/api/auth/')) {
      return `sid:${createHash('sha256').update(token).digest('hex').slice(0, 32)}`;
    }
    return `ip:${req.ip}`;
  }
}
