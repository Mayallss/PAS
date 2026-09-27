import { Controller, Get, Query } from '@nestjs/common';
import { z } from 'zod';
import { PrismaService } from '../../common/prisma.service';
import { ZodPipe } from '../../common/zod.pipe';
import { RequirePermission } from '../auth/decorators';

const query = z.object({
  resourceType: z.string().max(50).optional(),
  resourceId: z.string().max(100).optional(),
  actorId: z.string().uuid().optional(),
  limit: z.coerce.number().int().min(1).max(500).default(100),
});

@Controller('audit')
@RequirePermission('audit.read')
export class AuditController {
  constructor(private readonly prisma: PrismaService) {}

  @Get()
  async list(@Query(new ZodPipe(query)) q: z.infer<typeof query>) {
    const rows = await this.prisma.auditEvent.findMany({
      where: { resourceType: q.resourceType, resourceId: q.resourceId, actorId: q.actorId },
      orderBy: { id: 'desc' },
      take: q.limit,
    });
    return rows.map((r) => ({ ...r, id: r.id.toString() }));
  }
}
