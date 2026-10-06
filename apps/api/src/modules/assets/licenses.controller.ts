import { Body, Controller, Get, Param, ParseUUIDPipe, Patch, Post, Query, Req } from '@nestjs/common';
import { LicenseMetric, LicenseType } from '@prisma/client';
import { z } from 'zod';
import { isIsoDate } from '../../common/dates';
import type { AppRequest } from '../../common/request-context';
import { ZodPipe } from '../../common/zod.pipe';
import type { AuthUser } from '../auth/auth.types';
import { CurrentUser, RequirePermission } from '../auth/decorators';
import { LicensesService } from './licenses.service';

const isoDate = z.string().refine(isIsoDate, 'ต้องเป็นวันที่ YYYY-MM-DD');
const text = (max: number) => z.string().trim().max(max).nullish();

const softwareBody = z
  .object({
    name: z.string().trim().min(1).max(120),
    publisher: text(120),
    category: text(60),
    website: text(300),
    notes: text(2000),
    isActive: z.boolean().optional(),
  })
  .strict();

const licenseFields = {
  softwareId: z.string().uuid(),
  name: z.string().trim().min(1).max(120),
  edition: text(120),
  type: z.nativeEnum(LicenseType),
  metric: z.nativeEnum(LicenseMetric),
  seats: z.number().int().positive().max(100_000).nullish(),
  startDate: isoDate.nullish(),
  endDate: isoDate.nullish(),
  autoRenew: z.boolean().optional(),
  cost: z.number().nonnegative().max(100_000_000).nullish(),
  vendorId: z.string().uuid().nullish(),
  reference: text(120),
  keyHint: text(12),
  /** Free-form extra fields — keys and values are plain text. */
  attributes: z.record(z.string().trim().min(1).max(60), z.string().max(500)).refine((o) => Object.keys(o).length <= 30, 'ไม่เกิน 30 ช่อง').optional(),
  notes: text(4000),
};
const licenseBody = z.object(licenseFields).strict();
const licensePatch = z
  .object({ ...licenseFields, expectedVersion: z.number().int().positive() })
  .partial()
  .required({ expectedVersion: true })
  .omit({ softwareId: true })
  .strict();
const seatBody = z
  .object({
    assetCodes: z.array(z.string().trim().min(1).max(40)).max(200).optional(),
    employeeIds: z.array(z.string().uuid()).max(200).optional(),
    startDate: isoDate.optional(),
    installedOn: isoDate.nullish(),
    note: text(500),
  })
  .strict();
const endSeatBody = z.object({ endDate: isoDate.optional(), note: text(500) }).strict();
const renewBody = z
  .object({
    name: z.string().trim().min(1).max(120),
    startDate: isoDate,
    endDate: isoDate.nullish(),
    seats: z.number().int().positive().max(100_000).nullish(),
    cost: z.number().nonnegative().max(100_000_000).nullish(),
    autoRenew: z.boolean().optional(),
    reference: text(120),
    carrySeats: z.boolean(),
  })
  .strict();
const listQuery = z.object({ archived: z.enum(['true', 'false']).optional() });

/** Software catalogue, licences and seats. Viewing: asset.read; changing: asset.write (IT / Admin). */
@Controller()
export class LicensesController {
  constructor(private readonly licenses: LicensesService) {}

  @Get('software')
  @RequirePermission('asset.read')
  software() {
    return this.licenses.software();
  }

  @Post('software')
  @RequirePermission('asset.write')
  createSoftware(@Body(new ZodPipe(softwareBody)) body: z.infer<typeof softwareBody>, @Req() req: AppRequest) {
    return this.licenses.createSoftware(body, req);
  }

  @Patch('software/:id')
  @RequirePermission('asset.write')
  updateSoftware(@Param('id', ParseUUIDPipe) id: string, @Body(new ZodPipe(softwareBody.partial())) body: Partial<z.infer<typeof softwareBody>>, @Req() req: AppRequest) {
    return this.licenses.updateSoftware(id, body, req);
  }

  @Get('licenses')
  @RequirePermission('asset.read')
  list(@Query(new ZodPipe(listQuery)) q: z.infer<typeof listQuery>) {
    return this.licenses.licenses({ includeArchived: q.archived === 'true' });
  }

  @Post('licenses')
  @RequirePermission('asset.write')
  create(@Body(new ZodPipe(licenseBody)) body: z.infer<typeof licenseBody>, @Req() req: AppRequest) {
    return this.licenses.createLicense(body, req);
  }

  @Get('licenses/:id')
  @RequirePermission('asset.read')
  detail(@Param('id', ParseUUIDPipe) id: string) {
    return this.licenses.license(id);
  }

  @Patch('licenses/:id')
  @RequirePermission('asset.write')
  update(@Param('id', ParseUUIDPipe) id: string, @Body(new ZodPipe(licensePatch)) body: z.infer<typeof licensePatch>, @Req() req: AppRequest) {
    return this.licenses.updateLicense(id, body, req);
  }

  @Post('licenses/:id/archive')
  @RequirePermission('asset.write')
  archive(@Param('id', ParseUUIDPipe) id: string, @Req() req: AppRequest) {
    return this.licenses.archiveLicense(id, req);
  }

  @Post('licenses/:id/renew')
  @RequirePermission('asset.write')
  renew(@CurrentUser() user: AuthUser, @Param('id', ParseUUIDPipe) id: string, @Body(new ZodPipe(renewBody)) body: z.infer<typeof renewBody>, @Req() req: AppRequest) {
    return this.licenses.renew(user, id, body, req);
  }

  @Post('licenses/:id/seats')
  @RequirePermission('asset.write')
  addSeats(@CurrentUser() user: AuthUser, @Param('id', ParseUUIDPipe) id: string, @Body(new ZodPipe(seatBody)) body: z.infer<typeof seatBody>, @Req() req: AppRequest) {
    return this.licenses.addSeats(user, id, body, req);
  }

  @Post('licenses/:id/seats/:seatId/end')
  @RequirePermission('asset.write')
  endSeat(
    @Param('id', ParseUUIDPipe) id: string,
    @Param('seatId', ParseUUIDPipe) seatId: string,
    @Body(new ZodPipe(endSeatBody)) body: z.infer<typeof endSeatBody>,
    @Req() req: AppRequest,
  ) {
    return this.licenses.endSeat(id, seatId, body, req);
  }

  /** What one machine runs, under which licence (current seats first, then history). */
  @Get('assets/:code/licenses')
  @RequirePermission('asset.read')
  forAsset(@Param('code') code: string) {
    return this.licenses.forAsset(code);
  }
}
