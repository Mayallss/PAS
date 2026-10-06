import { Body, Controller, Get, Post, Req } from '@nestjs/common';
import { RateUnit } from '@prisma/client';
import { z } from 'zod';
import { isIsoDate } from '../../common/dates';
import type { AppRequest } from '../../common/request-context';
import { ZodPipe } from '../../common/zod.pipe';
import { RequirePermission } from '../auth/decorators';
import { CostService } from './cost.service';

const isoDate = z.string().refine(isIsoDate, 'ต้องเป็นวันที่ YYYY-MM-DD');
const rateBody = z
  .object({
    levelId: z.string().uuid(),
    amount: z.number().min(0).max(10_000_000),
    unit: z.nativeEnum(RateUnit),
    minutesPerDay: z.number().int().min(60).max(1440).optional(),
    effectiveFrom: isoDate,
  })
  .strict();
const legacyBody = z
  .object({ unit: z.nativeEnum(RateUnit), effectiveFrom: isoDate, minutesPerDay: z.number().int().min(60).max(1440).optional() })
  .strict();

/** Cost rates per level, effective-dated. Reading needs cost.read; changing needs cost.write. */
@Controller('cost-rates')
export class CostRatesController {
  constructor(private readonly cost: CostService) {}

  @Get()
  @RequirePermission('cost.read')
  list() {
    return this.cost.rates();
  }

  @Post()
  @RequirePermission('cost.write')
  add(@Body(new ZodPipe(rateBody)) body: z.infer<typeof rateBody>, @Req() req: AppRequest) {
    return this.cost.addRate(body, req);
  }

  @Post('legacy')
  @RequirePermission('cost.write')
  importLegacy(@Body(new ZodPipe(legacyBody)) body: z.infer<typeof legacyBody>, @Req() req: AppRequest) {
    return this.cost.importLegacy(body, req);
  }
}
