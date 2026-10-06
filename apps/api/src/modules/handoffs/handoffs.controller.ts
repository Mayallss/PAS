import { Body, Controller, Get, Param, Post, Query, Req } from '@nestjs/common';
import { Throttle } from '@nestjs/throttler';
import { z } from 'zod';
import type { AppRequest } from '../../common/request-context';
import { ZodPipe } from '../../common/zod.pipe';
import type { AuthUser } from '../auth/auth.types';
import { CurrentUser, Public, RequirePermission } from '../auth/decorators';
import { HandoffsService } from './handoffs.service';

const itemId = z.string().regex(/^\d{1,20}$/, 'เลขรายการไม่ถูกต้อง');
const saveBody = z
  .object({
    itemId,
    outcome: z.enum(['0', '1', '2']),
    name: z.string().trim().min(1, 'กรุณาระบุชื่อผู้เซ็น').max(120),
    signature: z.string().max(1_500_000),
    requestId: z.string().uuid(),
    context: z.string().min(10).max(4000),
  })
  .strict();
const listQuery = z.object({ fresh: z.enum(['1']).optional() });
const publicQuery = z.object({ share: z.string().min(10).max(4000) });

/**
 * รับ–ส่งเอกสาร (ex-DELIPAS). Tickets live on the monday board; this module lists them, collects the
 * signature and writes the outcome back. Signed-in staff need `handoff.use`.
 */
@Controller('handoffs')
export class HandoffsController {
  constructor(private readonly handoffs: HandoffsService) {}

  @Get()
  @RequirePermission('handoff.use')
  list(@Query(new ZodPipe(listQuery)) q: z.infer<typeof listQuery>) {
    return this.handoffs.list(q.fresh === '1');
  }

  @Get(':itemId')
  @RequirePermission('handoff.use')
  detail(@Param('itemId', new ZodPipe(itemId)) id: string) {
    return this.handoffs.detail(id);
  }

  @Post(':itemId/share')
  @RequirePermission('handoff.use')
  share(@CurrentUser() user: AuthUser, @Param('itemId', new ZodPipe(itemId)) id: string, @Req() req: AppRequest) {
    return this.handoffs.share(user, id, req);
  }

  @Post()
  @RequirePermission('handoff.use')
  save(@CurrentUser() user: AuthUser, @Body(new ZodPipe(saveBody)) body: z.infer<typeof saveBody>, @Req() req: AppRequest) {
    return this.handoffs.save(body, { user, viaLink: false }, req);
  }
}

/**
 * Public by exception: the holder of a share link (customer / courier signing on their own phone)
 * may see and sign THAT ticket only, for one hour. No session; limited per IP.
 */
@Controller('public/handoffs')
export class PublicHandoffsController {
  constructor(private readonly handoffs: HandoffsService) {}

  @Public()
  @Throttle({ default: { limit: 30, ttl: 60_000 } })
  @Get(':itemId')
  detail(@Param('itemId', new ZodPipe(itemId)) id: string, @Query(new ZodPipe(publicQuery)) q: z.infer<typeof publicQuery>) {
    return this.handoffs.publicDetail(id, q.share);
  }

  @Public()
  @Throttle({ default: { limit: 10, ttl: 60_000 } })
  @Post()
  save(@Body(new ZodPipe(saveBody)) body: z.infer<typeof saveBody>, @Req() req: AppRequest) {
    return this.handoffs.save(body, { viaLink: true }, req);
  }
}
