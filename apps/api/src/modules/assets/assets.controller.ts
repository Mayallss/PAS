import { Body, Controller, Get, Param, ParseUUIDPipe, Patch, Post, Query, Req, Res, UploadedFile, UseInterceptors } from '@nestjs/common';
import { FileInterceptor } from '@nestjs/platform-express';
import { AssetStatus, AssignmentKind, AttachmentKind } from '@prisma/client';
import type { Response } from 'express';
import { z } from 'zod';
import { isIsoDate } from '../../common/dates';
import type { AppRequest } from '../../common/request-context';
import { ZodPipe } from '../../common/zod.pipe';
import type { AuthUser } from '../auth/auth.types';
import { CurrentUser, RequirePermission } from '../auth/decorators';
import { ASSET_STATES, AssetsService, type EvidenceUpload, MANUAL_EVENT_TYPES } from './assets.service';

const isoDate = z.string().refine(isIsoDate, 'ต้องเป็นวันที่ YYYY-MM-DD');
const text = (max: number) => z.string().trim().max(max);
const optText = (max: number) => text(max).nullish();
const money = z.number().min(0).max(99_999_999).nullish();
const specs = z.record(z.string().regex(/^[a-zA-Z][a-zA-Z0-9]{0,39}$/), z.string().trim().max(200).nullable()).refine((s) => Object.keys(s).length <= 30, 'สเปกมากเกินไป');
const version = z.number().int().positive();
const applyHoldersBody = z
  .object({
    items: z.array(z.object({ code: z.string().trim().min(1).max(40), employeeId: z.string().uuid() }).strict()).min(1).max(200),
    /** The survey month: only the month is known (tab 09.69). */
    startDate: isoDate,
  })
  .strict();

const infoFields = {
  categoryId: z.string().uuid(),
  brand: optText(80),
  model: optText(200),
  serialNo: optText(80),
  hostname: optText(80),
  faCode: optText(40),
  purchaseDate: isoDate.nullish(),
  cost: money,
  usefulLifeYears: z.number().int().min(1).max(50).optional(),
  warrantyUntil: isoDate.nullish(),
  vendorId: z.string().uuid().nullish(),
  notes: optText(2000),
};
const createBody = z
  .object({ ...infoFields, code: z.string().trim().toUpperCase().regex(/^[A-Z0-9][A-Z0-9-]{0,39}$/, 'รหัสใช้ได้เฉพาะ A-Z, 0-9 และ -'), specs: specs.default({}) })
  .strict();
const updateBody = z.object({ ...infoFields, categoryId: infoFields.categoryId.optional(), expectedVersion: version }).strict();
const assignBody = z
  .object({
    employeeId: z.string().uuid().nullish(),
    locationId: z.string().uuid().nullish(),
    kind: z.nativeEnum(AssignmentKind),
    startDate: isoDate,
    dueDate: isoDate.nullish(),
    note: optText(500),
    replaceCurrent: z.boolean().optional(),
  })
  .strict();
const returnBody = z.object({ date: isoDate, note: optText(500) }).strict();
const eventBody = z
  .object({
    type: z.enum(MANUAL_EVENT_TYPES),
    occurredOn: isoDate,
    completedOn: isoDate.nullish(),
    title: text(200).min(1, 'ต้องระบุหัวข้อ'),
    detail: optText(4000),
    specChanges: specs.optional(),
    cost: money,
    vendorId: z.string().uuid().nullish(),
    underWarranty: z.boolean().nullish(),
    employeeId: z.string().uuid().nullish(),
    expectedVersion: version,
  })
  .strict();
const completeBody = z.object({ completedOn: isoDate, cost: money, detail: optText(2000), expectedVersion: version }).strict();
const statusBody = z.object({ status: z.nativeEnum(AssetStatus), occurredOn: isoDate, reason: text(500).min(1, 'ต้องระบุเหตุผล'), expectedVersion: version }).strict();
const voidBody = z.object({ reason: text(500).min(1, 'ต้องระบุเหตุผล'), expectedVersion: version }).strict();
const voidFileBody = z.object({ reason: text(500).min(1, 'ต้องระบุเหตุผล') }).strict();
const attachBody = z.object({ kind: z.nativeEnum(AttachmentKind), assetEventId: z.string().uuid().optional().or(z.literal('').transform(() => undefined)) });
const listQuery = z.object({
  q: z.string().max(100).optional(),
  categoryId: z.string().uuid().optional(),
  state: z.enum(ASSET_STATES as [string, ...string[]]).optional(),
  employeeId: z.string().uuid().optional(),
});
const nameBody = z.object({ name: text(120).min(1) }).strict();

/** Upper bound of UPLOAD_MAX_MB in config.ts. */
export const UPLOAD_CEILING_BYTES = 50 * 1024 * 1024;

/** Streams an evidence file. Images/PDF open inline in a sandbox; nothing is ever executed from our origin. */
export function sendEvidence(res: Response, row: { mimeType: string; fileName: string }, data: Buffer, download: boolean) {
  res.setHeader('Content-Type', row.mimeType);
  res.setHeader('Content-Length', String(data.length));
  res.setHeader('Content-Disposition', `${download ? 'attachment' : 'inline'}; filename*=UTF-8''${encodeURIComponent(row.fileName)}`);
  res.setHeader('Content-Security-Policy', "sandbox; default-src 'none'; img-src 'self'; style-src 'unsafe-inline'");
  res.setHeader('Cross-Origin-Resource-Policy', 'same-origin');
  res.setHeader('Cache-Control', 'private, max-age=300');
  res.end(data);
}

/** IT asset register (docs/07). Code in the URL is the device's own code, e.g. /assets/NB-0011. */
@Controller('assets')
export class AssetsController {
  constructor(private readonly assets: AssetsService) {}

  /** Devices the caller holds — every employee sees their own. */
  @Get('mine')
  mine(@CurrentUser() user: AuthUser) {
    return this.assets.heldBy(user.id);
  }

  @Get('options')
  @RequirePermission('asset.read')
  options() {
    return this.assets.options();
  }

  @Get('next-code')
  @RequirePermission('asset.write')
  nextCode(@Query('categoryId', ParseUUIDPipe) categoryId: string) {
    return this.assets.nextCode(categoryId);
  }

  @Get()
  @RequirePermission('asset.read')
  list(@Query(new ZodPipe(listQuery)) q: z.infer<typeof listQuery>) {
    return this.assets.list({ ...q, state: q.state as (typeof ASSET_STATES)[number] | undefined });
  }

  @Post()
  @RequirePermission('asset.write')
  create(@CurrentUser() user: AuthUser, @Body(new ZodPipe(createBody)) body: z.infer<typeof createBody>, @Req() req: AppRequest) {
    return this.assets.create(user, body, req);
  }

  @Post('vendors')
  @RequirePermission('asset.write')
  addVendor(@Body(new ZodPipe(nameBody)) body: z.infer<typeof nameBody>, @Req() req: AppRequest) {
    return this.assets.addVendor(body.name, req);
  }

  @Post('locations')
  @RequirePermission('asset.write')
  addLocation(@Body(new ZodPipe(nameBody)) body: z.infer<typeof nameBody>, @Req() req: AppRequest) {
    return this.assets.addLocation(body.name, req);
  }

  /** Machines with a user written in the equipment survey but no holder yet, with a suggested employee (IT confirms). */
  @Get('holder-suggestions')
  @RequirePermission('asset.write')
  holderSuggestions() {
    return this.assets.holderSuggestions();
  }

  @Post('holder-suggestions/apply')
  @RequirePermission('asset.write')
  applyHolders(@CurrentUser() user: AuthUser, @Body(new ZodPipe(applyHoldersBody)) body: z.infer<typeof applyHoldersBody>, @Req() req: AppRequest) {
    return this.assets.applyHolders(user, body.items, body.startDate, req);
  }

  @Get(':code')
  @RequirePermission('asset.read')
  detail(@Param('code') code: string) {
    return this.assets.detail(code);
  }

  @Patch(':code')
  @RequirePermission('asset.write')
  update(@Param('code') code: string, @Body(new ZodPipe(updateBody)) body: z.infer<typeof updateBody>, @Req() req: AppRequest) {
    return this.assets.updateInfo(code, body, req);
  }

  @Post(':code/assign')
  @RequirePermission('asset.write')
  async assign(@CurrentUser() user: AuthUser, @Param('code') code: string, @Body(new ZodPipe(assignBody)) body: z.infer<typeof assignBody>, @Req() req: AppRequest) {
    const a = await this.assets.assign(user, code, body, req);
    return { id: a.id };
  }

  @Post(':code/return')
  @RequirePermission('asset.write')
  returnDevice(@CurrentUser() user: AuthUser, @Param('code') code: string, @Body(new ZodPipe(returnBody)) body: z.infer<typeof returnBody>, @Req() req: AppRequest) {
    return this.assets.returnDevice(user, code, body, req);
  }

  @Post(':code/events')
  @RequirePermission('asset.write')
  addEvent(@CurrentUser() user: AuthUser, @Param('code') code: string, @Body(new ZodPipe(eventBody)) body: z.infer<typeof eventBody>, @Req() req: AppRequest) {
    return this.assets.addEvent(user, code, body, req);
  }

  @Post(':code/events/:eventId/complete')
  @RequirePermission('asset.write')
  complete(
    @CurrentUser() user: AuthUser,
    @Param('code') code: string,
    @Param('eventId', ParseUUIDPipe) eventId: string,
    @Body(new ZodPipe(completeBody)) body: z.infer<typeof completeBody>,
    @Req() req: AppRequest,
  ) {
    return this.assets.completeRepair(user, code, eventId, body, req);
  }

  @Post(':code/events/:eventId/void')
  @RequirePermission('asset.write')
  voidEvent(
    @CurrentUser() user: AuthUser,
    @Param('code') code: string,
    @Param('eventId', ParseUUIDPipe) eventId: string,
    @Body(new ZodPipe(voidBody)) body: z.infer<typeof voidBody>,
    @Req() req: AppRequest,
  ) {
    return this.assets.voidEvent(user, code, eventId, body, req);
  }

  @Post(':code/status')
  @RequirePermission('asset.write')
  status(@CurrentUser() user: AuthUser, @Param('code') code: string, @Body(new ZodPipe(statusBody)) body: z.infer<typeof statusBody>, @Req() req: AppRequest) {
    return this.assets.changeStatus(user, code, body, req);
  }

  @Post(':code/attachments')
  @RequirePermission('asset.write')
  // Hard ceiling only (the config maximum); decorators run at import time, before main.ts loads .env,
  // so the configured UPLOAD_MAX_MB is enforced in the service.
  @UseInterceptors(FileInterceptor('file', { limits: { fileSize: UPLOAD_CEILING_BYTES, files: 1, fields: 5 } }))
  attach(
    @CurrentUser() user: AuthUser,
    @Param('code') code: string,
    @UploadedFile() file: EvidenceUpload | undefined,
    @Body(new ZodPipe(attachBody)) body: z.infer<typeof attachBody>,
    @Req() req: AppRequest,
  ) {
    return this.assets.attach(user, code, file, body, req);
  }

  @Get(':code/attachments/:id/file')
  @RequirePermission('asset.read')
  async file(@Param('code') code: string, @Param('id', ParseUUIDPipe) id: string, @Query('download') download: string | undefined, @Res() res: Response) {
    const { row, data } = await this.assets.file(code, id);
    sendEvidence(res, row, data, !!download);
  }

  @Post(':code/attachments/:id/void')
  @RequirePermission('asset.write')
  voidFile(@Param('code') code: string, @Param('id', ParseUUIDPipe) id: string, @Body(new ZodPipe(voidFileBody)) body: z.infer<typeof voidFileBody>, @Req() req: AppRequest) {
    return this.assets.voidAttachment(code, id, body.reason, req);
  }
}
