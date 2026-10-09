import { HttpStatus, Injectable } from '@nestjs/common';
import { RevenueSource } from '@prisma/client';
import { createHash } from 'node:crypto';
import { addDays, toIsoDate } from '../../common/dates';
import { DomainError } from '../../common/errors';
import { PrismaService } from '../../common/prisma.service';
import type { AppRequest } from '../../common/request-context';
import { AuditService } from '../audit/audit.service';
import type { AuthUser } from '../auth/auth.types';
import { type CustomerRef, type Match, matchRows, normalizeTaxId } from './revenue.parser';
import { type IngestRow, RevenueService } from './revenue.service';
import { TrcloudClient } from './trcloud.client';
import { ENDPOINTS, hasMore, invoiceQuery, records, type TrContact, type TrDocument, toContact, toDocument } from './trcloud.mapping';

/**
 * Two syncs from TRCLOUD, both "preview → a person confirms → apply", and both fetch again on apply so what is
 * saved is what TRCLOUD says at that moment (never data sent back by the browser):
 *  1. contacts → our customers: TRCLOUD contact code, tax id (filled if empty), address (TRCLOUD wins)
 *  2. invoices (− credit notes) → revenue, linked to customers by that contact code; cancelled ones are left out
 */

type CustomerRow = CustomerRef & { trcloudCode: string | null; address: string | null };
export type ContactStatus = 'LINKED' | Match['status'];

const MAX_PAGES = 200;
const monthStart = (m: string) => `${m}-01`;
const monthEnd = (m: string) => {
  const [y, mo] = m.split('-').map(Number);
  return addDays(mo === 12 ? `${y + 1}-01-01` : `${y}-${String(mo + 1).padStart(2, '0')}-01`, -1);
};

/** Pure: who is who. Exported for tests. */
export function planContacts(contacts: TrContact[], customers: CustomerRow[]) {
  const byCode = new Map(customers.filter((c) => c.trcloudCode).map((c) => [c.trcloudCode!, c]));
  const auto = matchRows(
    contacts.map((c) => ({ taxId: c.taxId, companyName: c.name })),
    customers,
  );
  const rows = contacts.map((contact, i) => {
    const linked = byCode.get(contact.code);
    if (linked) return { contact, status: 'LINKED' as ContactStatus, customerId: linked.id, candidates: [] as Match['candidates'] };
    let m = auto[i];
    // A customer already linked to another TRCLOUD code is never re-linked automatically.
    if (m.customerId && customers.find((c) => c.id === m.customerId)?.trcloudCode) m = { status: 'SUGGESTED', customerId: null, candidates: [{ id: m.customerId, score: 1 }] };
    return { contact, status: m.status as ContactStatus, customerId: m.customerId, candidates: m.candidates };
  });
  // Two contacts landing on one customer: let a person decide.
  const claimed = new Map<string, number>();
  for (const r of rows) if (r.customerId && r.status !== 'LINKED') claimed.set(r.customerId, (claimed.get(r.customerId) ?? 0) + 1);
  for (const r of rows) {
    if (r.customerId && r.status !== 'LINKED' && claimed.get(r.customerId)! > 1) {
      r.candidates = [{ id: r.customerId, score: 1 }, ...r.candidates.filter((c) => c.id !== r.customerId)];
      r.status = 'SUGGESTED';
      r.customerId = null;
    }
  }
  return rows;
}

/** What linking a contact to a customer would change on that customer. */
export function changesFor(contact: TrContact, customer: CustomerRow, customers: CustomerRow[]) {
  const ownTax = normalizeTaxId(customer.taxId);
  const taxTaken = !!contact.taxId && customers.some((c) => c.id !== customer.id && normalizeTaxId(c.taxId) === contact.taxId);
  return {
    code: customer.trcloudCode === contact.code ? null : contact.code,
    taxId: !contact.taxId || ownTax === contact.taxId ? null : !ownTax && !taxTaken ? ('FILL' as const) : ('CONFLICT' as const),
    address: contact.address && contact.address !== customer.address ? contact.address : null,
  };
}

@Injectable()
export class TrcloudSync {
  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
    private readonly client: TrcloudClient,
    private readonly revenue: RevenueService,
  ) {}

  private async fetchAll(endpoint: { group: string; command: 'search' }, query: (page: number) => Record<string, unknown>) {
    const all: Record<string, unknown>[] = [];
    for (let page = 1; page <= MAX_PAGES; page++) {
      const answer = await this.client.read(endpoint.group, endpoint.command, query(page));
      if (answer.empty) break;
      all.push(...records(answer));
      if (!hasMore(answer, page)) break;
    }
    return all;
  }

  private customers(): Promise<CustomerRow[]> {
    return this.prisma.customer.findMany({ orderBy: { code: 'asc' }, select: { id: true, code: true, name: true, taxId: true, trcloudCode: true, address: true } });
  }

  private async contacts(): Promise<TrContact[]> {
    const seen = new Map<string, TrContact>();
    for (const raw of await this.fetchAll(ENDPOINTS.contacts, (page) => ({ page }))) {
      const c = toContact(raw);
      if (!seen.has(c.code)) seen.set(c.code, c);
    }
    return [...seen.values()];
  }

  // -------------------------------------------------------------------------
  // Contacts
  // -------------------------------------------------------------------------

  async contactsPreview() {
    const [contacts, customers] = await Promise.all([this.contacts(), this.customers()]);
    const byId = new Map(customers.map((c) => [c.id, c]));
    const rows = planContacts(contacts, customers).map((r) => ({
      ...r,
      changes: r.customerId ? changesFor(r.contact, byId.get(r.customerId)!, customers) : null,
    }));
    return { rows, customers: customers.map(({ id, code, name, trcloudCode }) => ({ id, code, name, trcloudCode })) };
  }

  /** decisions: contact code → customer id (or null = leave this contact unlinked). Others follow the automatic plan. */
  async contactsApply(user: AuthUser, decisions: { code: string; customerId: string | null }[], req: AppRequest) {
    const [contacts, customers] = await Promise.all([this.contacts(), this.customers()]);
    const decided = new Map(decisions.map((d) => [d.code, d.customerId]));
    const pairs = planContacts(contacts, customers)
      .map((r) => ({ contact: r.contact, customerId: decided.has(r.contact.code) ? decided.get(r.contact.code)! : r.customerId }))
      .filter((p): p is { contact: TrContact; customerId: string } => !!p.customerId);
    const perCustomer = new Map<string, string>();
    for (const p of pairs) {
      if (perCustomer.has(p.customerId) && perCustomer.get(p.customerId) !== p.contact.code) {
        throw new DomainError('TRCLOUD_DUPLICATE_LINK', 'มีคู่ค้าใน TRCLOUD มากกว่า 1 รายเลือกลูกค้าคนเดียวกัน — กรุณาเลือกใหม่', HttpStatus.CONFLICT);
      }
      perCustomer.set(p.customerId, p.contact.code);
    }
    const byId = new Map(customers.map((c) => [c.id, c]));
    if (pairs.some((p) => !byId.has(p.customerId))) throw new DomainError('UNKNOWN_CUSTOMER', 'มีลูกค้าที่เลือกซึ่งไม่มีในระบบ', HttpStatus.UNPROCESSABLE_ENTITY);

    return this.prisma.$transaction(async (tx) => {
      // Free the codes first (unique column): a code moving to another customer leaves the old one.
      const codes = pairs.map((p) => p.contact.code);
      const freed = await tx.customer.updateMany({ where: { trcloudCode: { in: codes }, id: { notIn: pairs.map((p) => p.customerId) } }, data: { trcloudCode: null } });
      const counts = { linked: 0, taxIdFilled: 0, taxIdConflicts: 0, addressUpdated: 0, unchanged: 0, codesMoved: freed.count };
      for (const p of pairs) {
        const before = byId.get(p.customerId)!;
        const ch = changesFor(p.contact, before, customers);
        const data = {
          trcloudCode: p.contact.code,
          ...(ch.taxId === 'FILL' ? { taxId: p.contact.taxId } : {}),
          ...(ch.address ? { address: ch.address } : {}),
        };
        if (!ch.code && ch.taxId !== 'FILL' && !ch.address) {
          counts.unchanged++;
          if (ch.taxId === 'CONFLICT') counts.taxIdConflicts++;
          continue;
        }
        await tx.customer.update({ where: { id: p.customerId }, data });
        await this.audit.record(
          { action: 'customer.update', resourceType: 'customer', resourceId: p.customerId, before: { trcloudCode: before.trcloudCode, taxId: before.taxId, address: before.address }, after: data, metadata: { source: 'trcloud.contacts' } },
          req,
          tx,
        );
        if (ch.code) counts.linked++;
        if (ch.taxId === 'FILL') counts.taxIdFilled++;
        if (ch.taxId === 'CONFLICT') counts.taxIdConflicts++;
        if (ch.address) counts.addressUpdated++;
      }
      await this.audit.record({ action: 'trcloud.contacts.sync', resourceType: 'customer', metadata: { contacts: contacts.length, ...counts } }, req, tx);
      return { contacts: contacts.length, unlinked: contacts.length - pairs.length, ...counts };
    });
  }

  // -------------------------------------------------------------------------
  // Invoices → revenue
  // -------------------------------------------------------------------------

  private async documents(from: string, to: string) {
    const docs: TrDocument[] = [];
    for (const raw of await this.fetchAll(ENDPOINTS.invoices, (page) => invoiceQuery(from, to, page))) docs.push(toDocument(raw, 1));
    if (ENDPOINTS.creditNotes) for (const raw of await this.fetchAll(ENDPOINTS.creditNotes, (page) => invoiceQuery(from, to, page))) docs.push(toDocument(raw, -1));
    // Only the asked dates (in case the filter is wider), each document once.
    const seen = new Set<string>();
    const inRange = docs.filter((d) => d.date >= from && d.date <= to && !seen.has(d.docNo) && seen.add(d.docNo));
    return { kept: inRange.filter((d) => !d.cancelled), cancelled: inRange.filter((d) => d.cancelled) };
  }

  private period(fromMonth: string, toMonth: string) {
    if (!/^\d{4}-\d{2}$/.test(fromMonth) || !/^\d{4}-\d{2}$/.test(toMonth) || fromMonth > toMonth) throw new DomainError('BAD_PERIOD', 'ช่วงเดือนไม่ถูกต้อง');
    const [fy, fm] = fromMonth.split('-').map(Number);
    const [ty, tm] = toMonth.split('-').map(Number);
    if ((ty - fy) * 12 + (tm - fm) > 11) throw new DomainError('BAD_PERIOD', 'ดึงได้ครั้งละไม่เกิน 12 เดือน');
    return { from: monthStart(fromMonth), to: monthEnd(toMonth) };
  }

  private async rows(from: string, to: string) {
    const [{ kept, cancelled }, customers] = await Promise.all([this.documents(from, to), this.customers()]);
    const byCode = new Map(customers.filter((c) => c.trcloudCode).map((c) => [c.trcloudCode!, c]));
    const rows: IngestRow[] = kept.map((d, i) => {
      const c = byCode.get(d.contactCode);
      return { rowNo: i + 1, taxId: null, companyName: d.contactName || d.contactCode, amount: d.amount, customerId: c?.id ?? null, matchedBy: c ? 'TRCLOUD_CODE' : null, docNo: d.docNo, docDate: d.date };
    });
    const overlapping = await this.prisma.revenueBatch.findMany({
      where: { voidedAt: null, periodFrom: { lte: new Date(`${to}T00:00:00Z`) }, periodTo: { gte: new Date(`${from}T00:00:00Z`) } },
      select: { id: true, source: true, fileName: true, periodFrom: true, periodTo: true, totalAmount: true },
    });
    return { rows, kept, cancelled, overlapping, byCode };
  }

  async invoicesPreview(fromMonth: string, toMonth: string) {
    const { from, to } = this.period(fromMonth, toMonth);
    const { rows, cancelled, overlapping, kept } = await this.rows(from, to);
    const unmatchedCodes = [...new Set(kept.filter((_, i) => !rows[i].customerId).map((d) => `${d.contactCode} ${d.contactName}`.trim()))];
    return {
      from,
      to,
      documents: rows.length,
      total: round2(rows.reduce((a, r) => a + r.amount, 0)),
      creditNotes: kept.filter((d) => d.amount < 0).length,
      cancelled: cancelled.length,
      unmatched: { rows: rows.filter((r) => !r.customerId).length, amount: round2(rows.filter((r) => !r.customerId).reduce((a, r) => a + r.amount, 0)), contacts: unmatchedCodes.slice(0, 50) },
      rows: rows.slice(0, 500).map((r) => ({ docNo: r.docNo, date: r.docDate, name: r.companyName, amount: r.amount, customerId: r.customerId })),
      // A previous TRCLOUD sync of these months is replaced automatically; Excel imports may double count.
      replaces: overlapping.filter((b) => b.source === RevenueSource.API).map(batchRef),
      excelOverlap: overlapping.filter((b) => b.source === RevenueSource.EXCEL).map(batchRef),
      creditNotesSupported: !!ENDPOINTS.creditNotes,
    };
  }

  async invoicesCommit(user: AuthUser, fromMonth: string, toMonth: string, replaceExcelIds: string[], req: AppRequest) {
    const { from, to } = this.period(fromMonth, toMonth);
    const { rows, overlapping } = await this.rows(from, to);
    if (!rows.length) throw new DomainError('NO_DOCUMENTS', 'ไม่พบใบแจ้งหนี้ใน TRCLOUD ช่วงนี้');
    const replace = [
      ...overlapping.filter((b) => b.source === RevenueSource.API).map((b) => b.id),
      ...overlapping.filter((b) => b.source === RevenueSource.EXCEL && replaceExcelIds.includes(b.id)).map((b) => b.id),
    ];
    const hash = createHash('sha256').update(JSON.stringify(rows.map((r) => [r.docNo, r.docDate, r.amount, r.customerId]))).digest('hex');
    return this.revenue.ingest(
      {
        source: RevenueSource.API,
        fileName: `TRCLOUD ใบแจ้งหนี้ ${fromMonth === toMonth ? fromMonth : `${fromMonth} – ${toMonth}`}`,
        externalRef: `trcloud:invoices:${from}:${to}:${Date.now()}`,
        contentHash: hash,
        periodFrom: from,
        periodTo: to,
        rows,
        replaceBatchIds: replace,
      },
      user,
      req,
    );
  }
}

const round2 = (n: number) => Math.round(n * 100) / 100;
const batchRef = (b: { id: string; fileName: string | null; periodFrom: Date; periodTo: Date; totalAmount: unknown }) => ({
  id: b.id,
  fileName: b.fileName,
  periodFrom: toIsoDate(b.periodFrom),
  periodTo: toIsoDate(b.periodTo),
  totalAmount: Number(b.totalAmount),
});
