import { Body, Controller, Get, Param, ParseUUIDPipe, Post, Query, Req, Res, UploadedFile, UseInterceptors } from '@nestjs/common';
import { FileInterceptor } from '@nestjs/platform-express';
import { RequestUrgency, ServiceRequestStatus, ServiceRequestType } from '@prisma/client';
import type { Response } from 'express';
import { z } from 'zod';
import { isIsoDate } from '../../common/dates';
import type { AppRequest } from '../../common/request-context';
import { ZodPipe } from '../../common/zod.pipe';
import type { AuthUser } from '../auth/auth.types';
import { CurrentUser, RequirePermission } from '../auth/decorators';
import { sendEvidence, UPLOAD_CEILING_BYTES } from './assets.controller';
import type { EvidenceUpload } from './assets.service';
import { RequestsService } from './requests.service';

const createBody = z
  .object({
    type: z.nativeEnum(ServiceRequestType),
    assetCode: z.string().trim().max(40).nullish(),
    title: z.string().trim().min(1, 'ต้องระบุหัวข้อ').max(200),
    detail: z.string().trim().max(4000).nullish(),
    urgency: z.nativeEnum(RequestUrgency).optional(),
  })
  .strict();
const cancelBody = z.object({ reason: z.string().trim().max(500).nullish() }).strict();
const transitionBody = z
  .object({
    status: z.nativeEnum(ServiceRequestStatus),
    note: z.string().trim().max(2000).nullish(),
    sendToRepair: z.boolean().optional(),
    vendorId: z.string().uuid().nullish(),
    underWarranty: z.boolean().nullish(),
    completedOn: z.string().refine(isIsoDate, 'ต้องเป็นวันที่ YYYY-MM-DD').nullish(),
    cost: z.number().min(0).max(99_999_999).nullish(),
  })
  .strict();
const queueQuery = z.object({ scope: z.enum(['OPEN', 'CLOSED', 'ALL']).default('OPEN') });

/** Employee → IT requests. Anyone may ask about their own device; IT/Admin (asset.write) handle them. */
@Controller('it-requests')
export class RequestsController {
  constructor(private readonly requests: RequestsService) {}

  @Get('mine')
  mine(@CurrentUser() user: AuthUser) {
    return this.requests.mine(user);
  }

  @Get()
  @RequirePermission('asset.read')
  queue(@Query(new ZodPipe(queueQuery)) q: z.infer<typeof queueQuery>) {
    return this.requests.queue(q.scope);
  }

  @Post()
  create(@CurrentUser() user: AuthUser, @Body(new ZodPipe(createBody)) body: z.infer<typeof createBody>, @Req() req: AppRequest) {
    return this.requests.create(user, body, req);
  }

  @Get(':id')
  get(@CurrentUser() user: AuthUser, @Param('id', ParseUUIDPipe) id: string) {
    return this.requests.get(user, id);
  }

  @Post(':id/cancel')
  cancel(@CurrentUser() user: AuthUser, @Param('id', ParseUUIDPipe) id: string, @Body(new ZodPipe(cancelBody)) body: z.infer<typeof cancelBody>, @Req() req: AppRequest) {
    return this.requests.cancel(user, id, body.reason, req);
  }

  @Post(':id/status')
  @RequirePermission('asset.write')
  transition(@CurrentUser() user: AuthUser, @Param('id', ParseUUIDPipe) id: string, @Body(new ZodPipe(transitionBody)) body: z.infer<typeof transitionBody>, @Req() req: AppRequest) {
    return this.requests.transition(user, id, body, req);
  }

  @Post(':id/attachments')
  @UseInterceptors(FileInterceptor('file', { limits: { fileSize: UPLOAD_CEILING_BYTES, files: 1, fields: 2 } }))
  attach(@CurrentUser() user: AuthUser, @Param('id', ParseUUIDPipe) id: string, @UploadedFile() file: EvidenceUpload | undefined, @Req() req: AppRequest) {
    return this.requests.attach(user, id, file, req);
  }

  @Get(':id/attachments/:fileId/file')
  async file(@CurrentUser() user: AuthUser, @Param('id', ParseUUIDPipe) id: string, @Param('fileId', ParseUUIDPipe) fileId: string, @Query('download') download: string | undefined, @Res() res: Response) {
    const { row, data } = await this.requests.file(user, id, fileId);
    sendEvidence(res, row, data, !!download);
  }
}
