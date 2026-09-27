import { Body, Controller, Delete, Get, HttpCode, Param, ParseUUIDPipe, Post, Put, Query, Req } from '@nestjs/common';
import { EmploymentStatus } from '@prisma/client';
import { z } from 'zod';
import { notFound } from '../../common/errors';
import { PrismaService } from '../../common/prisma.service';
import type { AppRequest } from '../../common/request-context';
import { ZodPipe } from '../../common/zod.pipe';
import { AuditService } from '../audit/audit.service';
import type { AuthUser } from '../auth/auth.types';
import { CurrentUser, RequirePermission } from '../auth/decorators';

const body = z
  .object({
    title: z.string().trim().min(1).max(200),
    /** Plain text only — rendered as text, never as HTML (no stored XSS like the legacy CKEditor pages). */
    body: z.string().trim().min(1).max(20_000),
    requiresAck: z.boolean().default(false),
    pinned: z.boolean().default(false),
  })
  .strict();
const listQuery = z.object({ limit: z.coerce.number().int().min(1).max(100).default(30) });

@Controller('announcements')
export class AnnouncementsController {
  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
  ) {}

  @Get()
  async list(@CurrentUser() user: AuthUser, @Query(new ZodPipe(listQuery)) q: z.infer<typeof listQuery>) {
    const writer = user.permissions.includes('announcement.write');
    const [rows, activeCount] = await Promise.all([
      this.prisma.announcement.findMany({
        orderBy: [{ pinned: 'desc' }, { publishedAt: 'desc' }],
        take: q.limit,
        include: {
          author: { select: { fullName: true } },
          acks: { where: { employeeId: user.id }, select: { ackAt: true } },
          _count: { select: { acks: true } },
        },
      }),
      writer ? this.prisma.employee.count({ where: { status: EmploymentStatus.ACTIVE } }) : Promise.resolve(0),
    ]);
    return rows.map(({ acks, _count, ...a }) => ({
      ...a,
      author: a.author.fullName,
      ackedAt: acks[0]?.ackAt ?? null,
      // Acknowledgement progress is only for people who publish announcements.
      ...(writer ? { ackCount: _count.acks, audience: activeCount } : {}),
    }));
  }

  @Post()
  @RequirePermission('announcement.write')
  async create(@CurrentUser() user: AuthUser, @Body(new ZodPipe(body)) input: z.infer<typeof body>, @Req() req: AppRequest) {
    return this.prisma.$transaction(async (tx) => {
      const a = await tx.announcement.create({ data: { ...input, authorId: user.id } });
      await this.audit.record({ action: 'announcement.create', resourceType: 'announcement', resourceId: a.id, after: input }, req, tx);
      return a;
    });
  }

  @Put(':id')
  @RequirePermission('announcement.write')
  async update(@Param('id', ParseUUIDPipe) id: string, @Body(new ZodPipe(body)) input: z.infer<typeof body>, @Req() req: AppRequest) {
    return this.prisma.$transaction(async (tx) => {
      const before = await tx.announcement.findUnique({ where: { id } });
      if (!before) throw notFound('ประกาศ');
      const a = await tx.announcement.update({ where: { id }, data: input });
      await this.audit.record({ action: 'announcement.update', resourceType: 'announcement', resourceId: id, before, after: input }, req, tx);
      return a;
    });
  }

  @Delete(':id')
  @HttpCode(204)
  @RequirePermission('announcement.write')
  async remove(@Param('id', ParseUUIDPipe) id: string, @Req() req: AppRequest) {
    await this.prisma.$transaction(async (tx) => {
      const before = await tx.announcement.findUnique({ where: { id } });
      if (!before) throw notFound('ประกาศ');
      await tx.announcement.delete({ where: { id } });
      await this.audit.record({ action: 'announcement.delete', resourceType: 'announcement', resourceId: id, before }, req, tx);
    });
  }

  /** "รับทราบ" — idempotent. */
  @Post(':id/ack')
  async ack(@CurrentUser() user: AuthUser, @Param('id', ParseUUIDPipe) id: string, @Req() req: AppRequest) {
    const exists = await this.prisma.announcement.count({ where: { id } });
    if (!exists) throw notFound('ประกาศ');
    const existing = await this.prisma.announcementAck.findUnique({ where: { announcementId_employeeId: { announcementId: id, employeeId: user.id } } });
    if (existing) return existing;
    const ack = await this.prisma.announcementAck.create({ data: { announcementId: id, employeeId: user.id } });
    await this.audit.record({ action: 'announcement.ack', resourceType: 'announcement', resourceId: id }, req);
    return ack;
  }
}
