import { CallHandler, ExecutionContext, Injectable, Logger, NestInterceptor } from '@nestjs/common';
import { randomUUID } from 'crypto';
import type { NextFunction, Request, Response } from 'express';
import { Observable, tap } from 'rxjs';
import type { AuthUser } from '../modules/auth/auth.types';

export interface AppRequest extends Request {
  id: string;
  user?: AuthUser;
  sessionId?: string;
}

const REQUEST_ID = /^[A-Za-z0-9-]{8,64}$/;

/** Assigns a request id (reusing a well-formed incoming X-Request-Id) and echoes it back. */
export function requestIdMiddleware(req: Request, res: Response, next: NextFunction) {
  const incoming = req.header('x-request-id');
  const id = incoming && REQUEST_ID.test(incoming) ? incoming : randomUUID();
  (req as AppRequest).id = id;
  res.setHeader('X-Request-Id', id);
  next();
}

/** One structured JSON log line per request. Never logs bodies, cookies or tokens. */
@Injectable()
export class AccessLogInterceptor implements NestInterceptor {
  private readonly logger = new Logger('http');

  intercept(ctx: ExecutionContext, next: CallHandler): Observable<unknown> {
    const req = ctx.switchToHttp().getRequest<AppRequest>();
    const res = ctx.switchToHttp().getResponse<Response>();
    const start = process.hrtime.bigint();
    const write = (status: number) => {
      if (process.env.NODE_ENV === 'test') return;
      this.logger.log(
        JSON.stringify({
          requestId: req.id,
          service: 'pas-api',
          method: req.method,
          route: req.route?.path ?? req.path,
          status,
          latencyMs: Number(process.hrtime.bigint() - start) / 1e6,
          userId: req.user?.id,
        }),
      );
    };
    return next.handle().pipe(
      tap({
        next: () => write(res.statusCode),
        error: (err) => write(err?.status ?? 500),
      }),
    );
  }
}

export function clientIp(req: Request): string | undefined {
  return req.ip;
}
