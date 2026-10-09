import { HttpStatus, Injectable } from '@nestjs/common';
import { Prisma, RevenueSource } from '@prisma/client';
import ExcelJS from 'exceljs';
import { toDate, toIsoDate } from '../../common/dates';
import { DomainError, notFound } from '../../common/errors';
import { PrismaService } from '../../common/prisma.service';
import type { AppRequest } from '../../common/request-context';
import { AuditService } from '../audit/audit.service';
import type { AuthUser } from '../auth/auth.types';
import { type CustomerRef, matchRows, type ParsedRow, parseRevenueFile, prorate } from './revenue.parser';

export interface RevenueUpload {
  buffer: Buffer;
  originalname: string;
  size: number;
}

/** A row ready to store: the customer is decided (or deliberately left unmatched). */
export interface IngestRow extends ParsedRow {
  customerId: string | null;
  matchedBy: 'TAX_ID' | 'NAME' | 'MANUAL' | 'TRCLOUD_CODE' | null;
  /** Source document (TRCLOUD); a dated row counts on its date, not spread over the batch period. */
  docNo?: string | null;
  docDate?: string | null;
}

/**
 * Everything that brings revenue in goes through ingest(): today the Excel import, later a pull from the
 * accounting system (source API + externalRef makes a re-sent pull a no-op). Batches are voided, never deleted.
 */
export interface IngestInput {
  source: RevenueSource;
  /** TRCLOUD company (PAS | PC | PA) for source API. */
  company?: string | null;
  fileName?: string | null;
  externalRef?: string | null;
  contentHash: string;
  periodFrom: string;
  periodTo: string;
  rows: IngestRow[];
  note?: string | null;
  /** Write a confirmed row's tax id onto its customer (when the customer has none and no one else uses it). */
  rememberTaxIds?: boolean;
  /** Active batches this one replaces (e.g. the same month imported again after a correction). */
  replaceBatchIds?: string[];
}

const round2 = (n: number) => Math.round(n * 100) / 100;

/** multer decodes the multipart filename as latin1; Thai names arrive as "à¸£à¸²…". Re-read the bytes as UTF-8. */
export function uploadName(file: RevenueUpload): string {
  const utf8 = Buffer.from(file.originalname, 'latin1').toString('utf8');
  return utf8.includes('�') ? file.originalname : utf8;
}

@Injectable()
export class RevenueService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
  ) {}

  private customers(): Promise<CustomerRef[]> {
    return this.prisma.customer.findMany({ orderBy: { code: 'asc' }, select: { id: true, code: true, name: true, taxId: true } });
  }

  /** Parse + match, nothing stored. The page shows this, a person fixes the unsure rows, then commit(). */
  async preview(file: RevenueUpload | undefined) {
    if (!file) throw new DomainError('FILE_REQUIRED', 'กรุณาเลือกไฟล์ Excel');
    const parsed = await parseRevenueFile(file.buffer);
    const customers = await this.customers();
    const matches = matchRows(parsed.rows, customers);
    const duplicate = await this.prisma.revenueBatch.findFirst({
      where: { contentHash: parsed.hash, voidedAt: null },
      select: { id: true, periodFrom: true, periodTo: true, createdAt: true, fileName: true },
    });
    return {
      fileName: uploadName(file),
      sheet: parsed.sheet,
      contentHash: parsed.hash,
      rows: parsed.rows.map((r, i) => ({ ...r, match: matches[i] })),
      problems: parsed.problems,
      total: round2(parsed.rows.reduce((a, r) => a + r.amount, 0)),
      duplicate: duplicate && { ...duplicate, periodFrom: toIsoDate(duplicate.periodFrom), periodTo: toIsoDate(duplicate.periodTo) },
      customers: customers.map(({ id, code, name, taxId }) => ({ id, code, name, taxId })),
    };
  }

  /**
   * The file is sent again and parsed again on the server, so amounts can only come from the file; the client
   * sends just the period and the people's decisions for rows the matcher was unsure about.
   */
  async commitExcel(
    user: AuthUser,
    file: RevenueUpload | undefined,
    meta: { contentHash: string; periodFrom: string; periodTo: string; decisions: { rowNo: number; customerId: string | null }[]; rememberTaxIds: boolean; replaceBatchIds: string[]; note?: string },
    req: AppRequest,
  ) {
    if (!file) throw new DomainError('FILE_REQUIRED', 'กรุณาเลือกไฟล์ Excel');
    const parsed = await parseRevenueFile(file.buffer);
    if (parsed.hash !== meta.contentHash) throw new DomainError('FILE_CHANGED', 'ไฟล์ไม่ตรงกับที่ตรวจไว้ — กรุณาเลือกไฟล์และตรวจใหม่อีกครั้ง', HttpStatus.CONFLICT);
    const matches = matchRows(parsed.rows, await this.customers());
    const decided = new Map(meta.decisions.map((d) => [d.rowNo, d.customerId]));
    const rows: IngestRow[] = parsed.rows.map((r, i) => {
      if (decided.has(r.rowNo)) {
        const customerId = decided.get(r.rowNo) ?? null;
        return { ...r, customerId, matchedBy: customerId ? 'MANUAL' : null };
      }
      const m = matches[i];
      return { ...r, customerId: m.customerId, matchedBy: m.status === 'TAX_ID' || m.status === 'NAME' ? m.status : null };
    });
    return this.ingest(
      { source: RevenueSource.EXCEL, fileName: uploadName(file), contentHash: parsed.hash, periodFrom: meta.periodFrom, periodTo: meta.periodTo, rows, note: meta.note, rememberTaxIds: meta.rememberTaxIds, replaceBatchIds: meta.replaceBatchIds },
      user,
      req,
    );
  }

  /** `user` null = the automatic TRCLOUD sync. */
  async ingest(input: IngestInput, user: AuthUser | null, req?: AppRequest) {
    if (input.periodFrom > input.periodTo) throw new DomainError('BAD_PERIOD', 'ช่วงเดือนของรายได้ไม่ถูกต้อง');
    if (!input.rows.length) throw new DomainError('FILE_EMPTY', 'ไม่มีแถวรายได้');
    if (input.externalRef) {
      const same = await this.prisma.revenueBatch.findUnique({ where: { source_externalRef: { source: input.source, externalRef: input.externalRef } } });
      if (same) return { id: same.id, replayed: true };
    }
    const ids = [...new Set(input.rows.map((r) => r.customerId).filter((x): x is string => !!x))];
    const known = await this.prisma.customer.count({ where: { id: { in: ids } } });
    if (known !== ids.length) throw new DomainError('UNKNOWN_CUSTOMER', 'มีลูกค้าที่เลือกซึ่งไม่มีในระบบ — กรุณาตรวจใหม่');
    const total = round2(input.rows.reduce((a, r) => a + r.amount, 0));

    return this.prisma.$transaction(async (tx) => {
      const replaced = input.replaceBatchIds?.length
        ? await tx.revenueBatch.updateMany({ where: { id: { in: input.replaceBatchIds }, voidedAt: null }, data: { voidedAt: new Date(), voidedById: user?.id ?? null, voidReason: 'แทนที่ด้วยการนำเข้าใหม่' } })
        : { count: 0 };
      const batch = await tx.revenueBatch.create({
        data: {
          source: input.source,
          company: input.company ?? null,
          fileName: input.fileName ?? null,
          externalRef: input.externalRef ?? null,
          contentHash: input.contentHash,
          periodFrom: toDate(input.periodFrom),
          periodTo: toDate(input.periodTo),
          rowCount: input.rows.length,
          totalAmount: new Prisma.Decimal(total),
          note: input.note || null,
          createdById: user?.id ?? null,
        },
      });
      await tx.revenueEntry.createMany({
        data: input.rows.map((r) => ({
          batchId: batch.id,
          rowNo: r.rowNo,
          taxId: r.taxId,
          companyName: r.companyName,
          amount: new Prisma.Decimal(r.amount),
          customerId: r.customerId,
          matchedBy: r.matchedBy,
          docNo: r.docNo ?? null,
          docDate: r.docDate ? toDate(r.docDate) : null,
        })),
      });
      const remembered = input.rememberTaxIds ? await this.rememberTaxIds(tx, input.rows.filter((r) => r.matchedBy === 'MANUAL' || r.matchedBy === 'NAME')) : 0;
      const unmatched = input.rows.filter((r) => !r.customerId);
      await this.audit.record(
        {
          action: 'revenue.import',
          resourceType: 'revenue_batch',
          resourceId: batch.id,
          metadata: {
            source: input.source,
            fileName: input.fileName,
            externalRef: input.externalRef,
            period: [input.periodFrom, input.periodTo],
            rows: input.rows.length,
            total,
            unmatched: unmatched.length,
            replacedBatches: input.replaceBatchIds ?? [],
            replaced: replaced.count,
            taxIdsRemembered: remembered,
          },
        },
        req,
        tx,
      );
      return { id: batch.id, replayed: false, rows: input.rows.length, total, unmatched: unmatched.length, replaced: replaced.count, taxIdsRemembered: remembered };
    });
  }

  /** Next import matches by tax id: copy a confirmed row's id onto its customer, only where that is unambiguous. */
  private async rememberTaxIds(tx: Prisma.TransactionClient, rows: { taxId: string | null; customerId: string | null }[]) {
    let n = 0;
    for (const r of rows) {
      if (!r.taxId || !r.customerId) continue;
      const taken = await tx.customer.count({ where: { taxId: r.taxId, id: { not: r.customerId } } });
      if (taken) continue;
      const { count } = await tx.customer.updateMany({ where: { id: r.customerId, OR: [{ taxId: null }, { taxId: '' }] }, data: { taxId: r.taxId } });
      n += count;
    }
    return n;
  }

  async list() {
    const batches = await this.prisma.revenueBatch.findMany({
      orderBy: [{ voidedAt: { sort: 'desc', nulls: 'first' } }, { periodFrom: 'desc' }, { createdAt: 'desc' }],
      take: 200,
      include: { createdBy: { select: { fullName: true } }, voidedBy: { select: { fullName: true } } },
    });
    const unmatched = await this.prisma.revenueEntry.groupBy({
      by: ['batchId'],
      where: { batchId: { in: batches.map((b) => b.id) }, customerId: null },
      _count: { _all: true },
      _sum: { amount: true },
    });
    const un = new Map(unmatched.map((u) => [u.batchId, { rows: u._count._all, amount: Number(u._sum.amount ?? 0) }]));
    return batches.map((b) => ({
      id: b.id,
      source: b.source,
      fileName: b.fileName,
      periodFrom: toIsoDate(b.periodFrom),
      periodTo: toIsoDate(b.periodTo),
      rowCount: b.rowCount,
      totalAmount: Number(b.totalAmount),
      unmatched: un.get(b.id) ?? { rows: 0, amount: 0 },
      note: b.note,
      createdBy: b.createdBy?.fullName ?? 'TRCLOUD (อัตโนมัติ)',
      createdAt: b.createdAt,
      voidedAt: b.voidedAt,
      voidedBy: b.voidedBy?.fullName ?? null,
      voidReason: b.voidReason,
    }));
  }

  async detail(id: string) {
    const b = await this.prisma.revenueBatch.findUnique({
      where: { id },
      include: { entries: { orderBy: { rowNo: 'asc' }, include: { customer: { select: { id: true, code: true, name: true } } } } },
    });
    if (!b) throw notFound('ชุดรายได้');
    return {
      id: b.id,
      periodFrom: toIsoDate(b.periodFrom),
      periodTo: toIsoDate(b.periodTo),
      fileName: b.fileName,
      voided: !!b.voidedAt,
      entries: b.entries.map((e) => ({ id: e.id, rowNo: e.rowNo, taxId: e.taxId, companyName: e.companyName, amount: Number(e.amount), matchedBy: e.matchedBy, customer: e.customer })),
      customers: (await this.customers()).map(({ id, code, name }) => ({ id, code, name })),
    };
  }

  async void(user: AuthUser, id: string, reason: string, req: AppRequest) {
    const { count } = await this.prisma.revenueBatch.updateMany({ where: { id, voidedAt: null }, data: { voidedAt: new Date(), voidedById: user.id, voidReason: reason } });
    if (!count) throw notFound('ชุดรายได้ที่ยังใช้งานอยู่');
    await this.audit.record({ action: 'revenue.void', resourceType: 'revenue_batch', resourceId: id, metadata: { reason } }, req);
    return { ok: true };
  }

  /** Match (or unmatch) one row after the import — e.g. a customer that was created later. */
  async assign(user: AuthUser, entryId: string, customerId: string | null, remember: boolean, req: AppRequest) {
    const entry = await this.prisma.revenueEntry.findUnique({ where: { id: entryId }, include: { batch: { select: { voidedAt: true } } } });
    if (!entry) throw notFound('แถวรายได้');
    if (entry.batch.voidedAt) throw new DomainError('BATCH_VOIDED', 'ชุดนี้ถูกยกเลิกแล้ว แก้ไขไม่ได้', HttpStatus.CONFLICT);
    if (customerId && !(await this.prisma.customer.findUnique({ where: { id: customerId }, select: { id: true } }))) throw notFound('ลูกค้า');
    return this.prisma.$transaction(async (tx) => {
      await tx.revenueEntry.update({ where: { id: entryId }, data: { customerId, matchedBy: customerId ? 'MANUAL' : null } });
      const remembered = remember && customerId ? await this.rememberTaxIds(tx, [{ taxId: entry.taxId, customerId }]) : 0;
      await this.audit.record(
        { action: 'revenue.match', resourceType: 'revenue_entry', resourceId: entryId, before: { customerId: entry.customerId }, after: { customerId }, metadata: { taxIdsRemembered: remembered } },
        req,
        tx,
      );
      return { ok: true, taxIdRemembered: remembered > 0 };
    });
  }

  /** An empty file with the expected headers (and one example row) — the easiest way to get the format right. */
  async template() {
    const wb = new ExcelJS.Workbook();
    const ws = wb.addWorksheet('รายได้');
    ws.columns = [
      { header: 'taxid', key: 'taxid', width: 18 },
      { header: 'companyname', key: 'companyname', width: 44 },
      { header: 'income', key: 'income', width: 16 },
    ];
    ws.getRow(1).font = { bold: true };
    ws.getColumn('taxid').numFmt = '@'; // text, so a leading 0 survives
    ws.getColumn('income').numFmt = '#,##0.00';
    ws.addRow({ taxid: '0105500000000', companyname: 'บริษัท ตัวอย่าง จำกัด', income: 15000 });
    return Buffer.from(await wb.xlsx.writeBuffer());
  }

  /**
   * Revenue that belongs to [from, to] per customer, from active batches. A dated row (a TRCLOUD invoice) counts in
   * full on its own date; an undated row (Excel) is spread over its batch period by days (a quarter imported once,
   * viewed per month, splits evenly).
   */
  async forRange(from: string, to: string) {
    const active = { voidedAt: null };
    const entries = await this.prisma.revenueEntry.findMany({
      where: {
        OR: [
          { docDate: { gte: toDate(from), lte: toDate(to) }, batch: active },
          { docDate: null, batch: { ...active, periodFrom: { lte: toDate(to) }, periodTo: { gte: toDate(from) } } },
        ],
      },
      select: {
        amount: true,
        customerId: true,
        docDate: true,
        batch: { select: { id: true, periodFrom: true, periodTo: true, company: true } },
        customer: { select: { id: true, code: true, name: true, accountOwner: { select: { fullName: true } } } },
      },
    });
    // Per company: the TRCLOUD company that billed it (PAS / PC / PA), "EXCEL" for imported files. Added up, never deduplicated.
    const byCustomer = new Map<string, { id: string; code: string; name: string; owner: string | null; amount: number; byCompany: Record<string, number> }>();
    const byCompany: Record<string, number> = {};
    let unmatched = 0;
    const batches = new Set<string>();
    for (const e of entries) {
      batches.add(e.batch.id);
      const share = e.docDate ? Number(e.amount) : prorate(Number(e.amount), { from: toIsoDate(e.batch.periodFrom), to: toIsoDate(e.batch.periodTo) }, { from, to });
      const company = e.batch.company ?? 'EXCEL';
      byCompany[company] = (byCompany[company] ?? 0) + share;
      if (!e.customer) {
        unmatched += share;
        continue;
      }
      const c = byCustomer.get(e.customer.id) ?? { id: e.customer.id, code: e.customer.code, name: e.customer.name, owner: e.customer.accountOwner?.fullName ?? null, amount: 0, byCompany: {} };
      c.amount += share;
      c.byCompany[company] = (c.byCompany[company] ?? 0) + share;
      byCustomer.set(c.id, c);
    }
    const rounded = (m: Record<string, number>) => Object.fromEntries(Object.entries(m).map(([k, v]) => [k, round2(v)]));
    return {
      customers: [...byCustomer.values()].map((c) => ({ ...c, amount: round2(c.amount), byCompany: rounded(c.byCompany) })),
      unmatched: round2(unmatched),
      byCompany: rounded(byCompany),
      batches: batches.size,
    };
  }
}
