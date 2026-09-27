import { Injectable, Logger } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { PrismaService } from '../../common/prisma.service';
import type { AppRequest } from '../../common/request-context';

export interface AuditInput {
  action: string;
  resourceType: string;
  resourceId?: string | null;
  before?: unknown;
  after?: unknown;
  metadata?: Record<string, unknown>;
  actorId?: string | null;
}

const SENSITIVE_KEYS = /pass|secret|token|cookie|authorization|csrf/i;

function scrub(value: unknown): Prisma.InputJsonValue | typeof Prisma.JsonNull {
  if (value === undefined || value === null) return Prisma.JsonNull;
  return JSON.parse(
    JSON.stringify(value, (key, v) => {
      if (SENSITIVE_KEYS.test(key)) return '[REDACTED]';
      return typeof v === 'bigint' ? v.toString() : v;
    }),
  );
}

@Injectable()
export class AuditService {
  private readonly logger = new Logger('audit');

  constructor(private readonly prisma: PrismaService) {}

  /** Writes inside the caller's transaction when `tx` is given, so data change and audit commit together. */
  async record(input: AuditInput, req?: AppRequest, tx?: Prisma.TransactionClient) {
    const db = tx ?? this.prisma;
    await db.auditEvent.create({
      data: {
        actorId: input.actorId ?? req?.user?.id ?? null,
        action: input.action,
        resourceType: input.resourceType,
        resourceId: input.resourceId ?? null,
        before: scrub(input.before),
        after: scrub(input.after),
        metadata: scrub({ ...(input.metadata ?? {}), userAgent: req?.header?.('user-agent')?.slice(0, 200) }),
        ip: req?.ip ?? null,
        requestId: req?.id ?? null,
      },
    });
    if (process.env.NODE_ENV !== 'test') {
      this.logger.log(JSON.stringify({ audit: input.action, resourceType: input.resourceType, resourceId: input.resourceId, requestId: req?.id }));
    }
  }
}
