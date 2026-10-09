import { Body, Controller, Get, Param, ParseUUIDPipe, Patch, Post, Req, Res, UploadedFile, UseInterceptors } from '@nestjs/common';
import { FileInterceptor } from '@nestjs/platform-express';
import type { Response } from 'express';
import { z } from 'zod';
import { isIsoDate } from '../../common/dates';
import { DomainError } from '../../common/errors';
import type { AppRequest } from '../../common/request-context';
import { ZodPipe } from '../../common/zod.pipe';
import type { AuthUser } from '../auth/auth.types';
import { CurrentUser, RequirePermission } from '../auth/decorators';
import { type RevenueUpload, RevenueService } from './revenue.service';
import { TrcloudClient } from './trcloud.client';
import { TrcloudSync } from './trcloud.sync';

/** Revenue workbooks are small; 10 MB leaves room for formatting without inviting abuse. */
const upload = FileInterceptor('file', { limits: { fileSize: 10 * 1024 * 1024, files: 1, fields: 1, fieldSize: 512 * 1024 } });

const commitMeta = z
  .object({
    contentHash: z.string().regex(/^[0-9a-f]{64}$/),
    periodFrom: z.string().refine(isIsoDate),
    periodTo: z.string().refine(isIsoDate),
    decisions: z.array(z.object({ rowNo: z.number().int().positive(), customerId: z.string().uuid().nullable() })).max(5000).default([]),
    rememberTaxIds: z.boolean().default(true),
    replaceBatchIds: z.array(z.string().uuid()).max(50).default([]),
    note: z.string().trim().max(500).optional(),
  })
  .refine((m) => m.periodFrom <= m.periodTo, 'ช่วงเดือนไม่ถูกต้อง');
const voidBody = z.object({ reason: z.string().trim().min(1, 'กรุณาระบุเหตุผล').max(300) });
const month = z.string().regex(/^\d{4}-(0[1-9]|1[0-2])$/, 'ต้องเป็นเดือน YYYY-MM');
const invoicePeriod = z.object({ from: month, to: month });
const invoiceCommit = invoicePeriod.extend({ replaceExcelIds: z.array(z.string().uuid()).max(50).default([]) });
const contactDecisions = z.object({
  decisions: z.array(z.object({ code: z.string().trim().min(1).max(64), customerId: z.string().uuid().nullable() })).max(20000).default([]),
});
const assignBody = z.object({ customerId: z.string().uuid().nullable(), remember: z.boolean().default(true) });

@Controller('revenue')
@RequirePermission('revenue.write')
export class RevenueController {
  constructor(
    private readonly revenue: RevenueService,
    private readonly trcloud: TrcloudSync,
    private readonly trcloudClient: TrcloudClient,
  ) {}

  // --- TRCLOUD (each preview / apply spends API quota: called on a person's click only) ---

  @Get('trcloud/status')
  trcloudStatus() {
    return { enabled: !!this.trcloudClient.settings() };
  }

  @Post('trcloud/contacts/preview')
  contactsPreview() {
    return this.trcloud.contactsPreview();
  }

  @Post('trcloud/contacts/apply')
  contactsApply(@CurrentUser() user: AuthUser, @Body(new ZodPipe(contactDecisions)) body: z.infer<typeof contactDecisions>, @Req() req: AppRequest) {
    return this.trcloud.contactsApply(user, body.decisions, req);
  }

  @Post('trcloud/invoices/preview')
  invoicesPreview(@Body(new ZodPipe(invoicePeriod)) body: z.infer<typeof invoicePeriod>) {
    return this.trcloud.invoicesPreview(body.from, body.to);
  }

  @Post('trcloud/invoices/commit')
  invoicesCommit(@CurrentUser() user: AuthUser, @Body(new ZodPipe(invoiceCommit)) body: z.infer<typeof invoiceCommit>, @Req() req: AppRequest) {
    return this.trcloud.invoicesCommit(user, body.from, body.to, body.replaceExcelIds, req);
  }

  @Get('template')
  async template(@Res() res: Response) {
    res.setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
    res.setHeader('Content-Disposition', 'attachment; filename="revenue-template.xlsx"');
    res.send(await this.revenue.template());
  }

  /** Parse and match only — nothing is stored. */
  @Post('preview')
  @UseInterceptors(upload)
  preview(@UploadedFile() file: RevenueUpload | undefined) {
    return this.revenue.preview(file);
  }

  /** Multipart: the same file + `meta` (JSON). The server re-parses the file; amounts never come from the client. */
  @Post('batches')
  @UseInterceptors(upload)
  commit(@CurrentUser() user: AuthUser, @UploadedFile() file: RevenueUpload | undefined, @Body('meta') raw: string | undefined, @Req() req: AppRequest) {
    let json: unknown;
    try {
      json = JSON.parse(raw ?? '');
    } catch {
      throw new DomainError('BAD_META', 'ข้อมูลการนำเข้าไม่ครบ');
    }
    const meta = new ZodPipe(commitMeta).transform(json) as z.infer<typeof commitMeta>;
    return this.revenue.commitExcel(user, file, meta, req);
  }

  @Get('batches')
  list() {
    return this.revenue.list();
  }

  @Get('batches/:id')
  detail(@Param('id', ParseUUIDPipe) id: string) {
    return this.revenue.detail(id);
  }

  @Post('batches/:id/void')
  void(@CurrentUser() user: AuthUser, @Param('id', ParseUUIDPipe) id: string, @Body(new ZodPipe(voidBody)) body: z.infer<typeof voidBody>, @Req() req: AppRequest) {
    return this.revenue.void(user, id, body.reason, req);
  }

  @Patch('entries/:id')
  assign(@CurrentUser() user: AuthUser, @Param('id', ParseUUIDPipe) id: string, @Body(new ZodPipe(assignBody)) body: z.infer<typeof assignBody>, @Req() req: AppRequest) {
    return this.revenue.assign(user, id, body.customerId, body.remember, req);
  }
}
