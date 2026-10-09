import { HttpStatus, Injectable, Logger, OnModuleDestroy, OnModuleInit } from '@nestjs/common';
import { RevenueSource, WorkCategoryType } from '@prisma/client';
import { createHash } from 'node:crypto';
import { addDays, toDate, todayIn, toIsoDate } from '../../common/dates';
import { loadConfig, type TrcloudCompanyKey } from '../../config';
import { DomainError } from '../../common/errors';
import { PrismaService } from '../../common/prisma.service';
import type { AppRequest } from '../../common/request-context';
import { AuditService } from '../audit/audit.service';
import type { AuthUser } from '../auth/auth.types';
import { type CustomerRef, type Match, matchRows, normalizeTaxId } from './revenue.parser';
import { type IngestRow, RevenueService } from './revenue.service';
import { TrcloudClient } from './trcloud.client';
import { type Endpoint, ENDPOINTS, hasMore, invoiceQuery, records, type TrContact, type TrDocument, toContact, toDocument } from './trcloud.mapping';

/**
 * Syncs from TRCLOUD for the group's companies (PAS, PC, PA — user decision 2026-10-09); every apply fetches again, so
 * what is saved is what TRCLOUD says at that moment (never data sent back by the browser):
 *  1. contacts → our customers, AUTOMATIC (every TRCLOUD_SYNC_INTERVAL_MS and when the customers / revenue page
 *     opens). One customer = one real client, linked to its contact in each company (matched by tax id, then name,
 *     companies in priority order PAS → PC → PA). Its code, name and address follow the highest-priority company's
 *     contact; tax id filled if empty. A contact matching nobody becomes a customer; an ambiguous one waits for a
 *     person. Customers in no company's TRCLOUD are removed — deleted when nothing refers to them, otherwise closed —
 *     except internal ones (internal / meeting / leave work, e.g. PAS). The group's own companies (by tax id) are
 *     never customers.
 *  2. invoices (report/b3, − credit notes) → revenue, AUTOMATIC for the last SYNC_MONTHS months right after the
 *     contacts (a person can also preview / sync any range). One batch per company per month, rewritten only when its
 *     invoices changed; Cancel invoices never count; invoices between the group's companies are not revenue. The same
 *     client's revenue from several companies is added up, never treated as a duplicate.
 */

type Company = TrcloudCompanyKey;
/** internal: has internal / meeting / leave activities (e.g. PAS) — never in TRCLOUD, never removed by the sync. */
type CustomerRow = CustomerRef & { address: string | null; isActive: boolean; internal?: boolean; links: Partial<Record<Company, string>> };
/** A customer as seen from one company: trcloudCode = its contact code in that company. */
type ViewRow = CustomerRef & { trcloudCode: string | null; address?: string | null; isActive?: boolean };
export type ContactStatus = 'LINKED' | Match['status'];
/** A person's choice for one contact: an existing customer's id, 'NEW' (create a customer) or null (leave it alone). */
export type ContactDecision = string | null;
/** Contacts and decisions are keyed "company:code" — the same code can exist in two companies. */
const keyOf = (company: Company, code: string) => `${company}:${code}`;

const MAX_PAGES = 200;
/** The timer re-syncs this many recent months of revenue (this one included). */
const SYNC_MONTHS = 12;
const shiftMonth = (m: string, n: number) => {
  const [y, mo] = m.split('-').map(Number);
  const i = y * 12 + (mo - 1) + n;
  return `${Math.floor(i / 12)}-${String((i % 12) + 1).padStart(2, '0')}`;
};
/** Page-open sync: skipped when the last one is this recent. */
const FRESH_MS = 10 * 60 * 1000;
/**
 * Removal is held (nothing removed, reported instead) when more linked customers would go at once than this — an
 * empty or cut-short answer from TRCLOUD must never wipe the customer list.
 */
const removalLimit = (linked: number) => Math.max(3, Math.floor(linked * 0.1));
const monthStart = (m: string) => `${m}-01`;
const monthEnd = (m: string) => {
  const [y, mo] = m.split('-').map(Number);
  return addDays(mo === 12 ? `${y + 1}-01-01` : `${y}-${String(mo + 1).padStart(2, '0')}-01`, -1);
};

/** Pure: who is who within one company. Exported for tests. */
export function planContacts(contacts: TrContact[], customers: ViewRow[]) {
  const byCode = new Map(customers.filter((c) => c.trcloudCode).map((c) => [c.trcloudCode!, c]));
  const auto = matchRows(
    contacts.map((c) => ({ taxId: c.taxId, companyName: c.name })),
    customers,
  );
  const rows = contacts.map((contact, i) => {
    const linked = byCode.get(contact.code);
    if (linked) return { contact, status: 'LINKED' as ContactStatus, customerId: linked.id, candidates: [] as Match['candidates'] };
    let m = auto[i];
    // A customer already linked to another code of this company is never re-linked automatically.
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

/** Our customer code for a TRCLOUD contact: its "#code" as is (no spaces, ≤ 40). */
export const codeOf = (contact: TrContact) => contact.code.trim().replace(/\s+/g, '-').slice(0, 40) || `TR${contact.id}`;

/**
 * What a customer's primary contact (its highest-priority company) would change on it: TRCLOUD wins on code, name,
 * address and active state; tax id filled only when empty and unused, else a conflict a person checks.
 */
export function changesFor(contact: TrContact, customer: ViewRow, customers: ViewRow[]) {
  const ownTax = normalizeTaxId(customer.taxId);
  const taxTaken = !!contact.taxId && customers.some((c) => c.id !== customer.id && normalizeTaxId(c.taxId) === contact.taxId);
  return {
    code: customer.trcloudCode === contact.code ? null : contact.code,
    customerCode: codeOf(contact) !== customer.code ? codeOf(contact) : null,
    name: contact.name !== customer.name ? contact.name : null,
    activate: customer.isActive === false,
    taxId: !contact.taxId || ownTax === contact.taxId ? null : !ownTax && !taxTaken ? ('FILL' as const) : ('CONFLICT' as const),
    address: contact.address && contact.address !== customer.address ? contact.address : null,
  };
}

/** `code`, or `code-2`, `code-3` … when another customer already uses it. Marks the result taken. */
export function uniqueCode(code: string, taken: Set<string>) {
  let out = code;
  for (let n = 2; taken.has(out); n++) out = `${code.slice(0, 39 - String(n).length)}-${n}`;
  taken.add(out);
  return out;
}

interface Book {
  company: Company;
  byId: Map<string, TrContact>;
  /** Contacts that can be customers: not a supplier, not obsolete, not one of the group's companies, with a #code. */
  customers: TrContact[];
  skipped: { noCode: number; suppliers: number; obsolete: number; group: number };
}

/** One contact's place in the plan. `target`: a customer id, "new:<key>" (created in this run) or null. */
interface Planned {
  company: Company;
  key: string;
  contact: TrContact;
  status: ContactStatus;
  candidates: string[];
  target: string | null;
  /** Ambiguous and nobody decided: waits for a person. */
  waiting: boolean;
}
interface NewCustomer {
  id: string;
  contact: TrContact;
  links: Partial<Record<Company, string>>;
}

/**
 * Pure: every company's contacts against the customers, companies in priority order, so a client created from PAS
 * in this run can be matched by PC's contact for it. Exported for tests.
 */
export function planCompanies(books: Book[], customers: CustomerRow[], decisions: Map<string, ContactDecision>) {
  const fresh = new Map<string, NewCustomer>();
  const linksOf = new Map<string, Partial<Record<Company, string>>>(customers.map((c) => [c.id, {}]));
  const planned: Planned[] = [];
  for (const book of books) {
    const view: ViewRow[] = [
      ...customers.map((c) => ({ id: c.id, code: c.code, name: c.name, taxId: c.taxId, trcloudCode: c.links[book.company] ?? null })),
      ...[...fresh.values()].map((n) => ({ id: n.id, code: codeOf(n.contact), name: n.contact.name, taxId: n.contact.taxId, trcloudCode: n.links[book.company] ?? null })),
    ];
    for (const r of planContacts(book.customers, view)) {
      const key = keyOf(book.company, r.contact.code);
      let target = decisions.has(key) ? decisions.get(key)! : (r.customerId ?? (r.status === 'UNMATCHED' ? 'NEW' : null));
      if (target === 'NEW') {
        target = `new:${key}`;
        fresh.set(target, { id: target, contact: r.contact, links: {} });
      }
      if (target) {
        const links = fresh.get(target)?.links ?? linksOf.get(target);
        if (!links) throw new DomainError('UNKNOWN_CUSTOMER', 'มีลูกค้าที่เลือกซึ่งไม่มีในระบบ', HttpStatus.UNPROCESSABLE_ENTITY);
        if (links[book.company] && links[book.company] !== r.contact.code) {
          throw new DomainError('TRCLOUD_DUPLICATE_LINK', `มีคู่ค้า ${book.company} มากกว่า 1 รายเลือกลูกค้าคนเดียวกัน — กรุณาเลือกใหม่`, HttpStatus.CONFLICT);
        }
        links[book.company] = r.contact.code;
      }
      planned.push({
        company: book.company,
        key,
        contact: r.contact,
        status: r.status,
        candidates: r.candidates.map((c) => c.id).filter((id) => !id.startsWith('new:')),
        target,
        waiting: !decisions.has(key) && !r.customerId && r.status !== 'UNMATCHED',
      });
    }
  }
  return { planned, fresh, linksOf };
}

type SyncResult = { contacts: Awaited<ReturnType<TrcloudSync['contactsApply']>>; invoices: Awaited<ReturnType<TrcloudSync['syncInvoices']>> };

@Injectable()
export class TrcloudSync implements OnModuleInit, OnModuleDestroy {
  private readonly log = new Logger(TrcloudSync.name);
  private timer?: NodeJS.Timeout;
  /** One automatic sync at a time; callers arriving meanwhile share its result. */
  private inFlight: Promise<SyncResult> | null = null;

  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
    private readonly client: TrcloudClient,
    private readonly revenue: RevenueService,
  ) {}

  onModuleInit() {
    const every = loadConfig().TRCLOUD_SYNC_INTERVAL_MS;
    if (!every || !this.client.companies().length) return;
    const tick = () => void this.syncAll().catch((e: Error) => this.log.warn(`TRCLOUD sync failed: ${e.message}`));
    this.timer = setInterval(tick, every);
    this.timer.unref();
    // After a restart, only when due — dev restarts must not spend TRCLOUD quota.
    void this.lastContactSync().then((last) => {
      if (!last || Date.now() - last.at.getTime() > every) setTimeout(tick, 15_000).unref();
    });
  }

  onModuleDestroy() {
    if (this.timer) clearInterval(this.timer);
  }

  /**
   * Contacts first (new customers exist before their invoices are linked), then the recent months of revenue.
   * `ifOlderThanMs`: skip when the last sync is more recent. One run at a time; callers meanwhile share it.
   */
  async syncAll(ifOlderThanMs = 0, req?: AppRequest) {
    if (ifOlderThanMs) {
      const last = await this.lastContactSync();
      if (last && Date.now() - last.at.getTime() < ifOlderThanMs) return null;
    }
    this.inFlight ??= (async () => {
      const contacts = await this.contactsApply([], req);
      const invoices = await this.syncInvoices(req);
      return { contacts, invoices };
    })().finally(() => (this.inFlight = null));
    return this.inFlight;
  }

  /** The customers / revenue pages: sync if stale (or forced), then report. */
  async refresh(force: boolean, req: AppRequest) {
    const ran = await this.syncAll(force ? 0 : FRESH_MS, req);
    return { ran: !!ran, ...(await this.lastSyncs()) };
  }

  async lastSyncs() {
    return { lastContactSync: await this.lastContactSync(), lastInvoiceSync: await this.lastInvoiceSync() };
  }

  private async lastInvoiceSync() {
    const e = await this.prisma.auditEvent.findFirst({ where: { action: 'trcloud.invoices.sync', metadata: { path: ['auto'], equals: true } }, orderBy: { occurredAt: 'desc' }, select: { occurredAt: true, metadata: true } });
    if (!e) return null;
    const m = (e.metadata ?? {}) as Record<string, unknown>;
    return {
      at: e.occurredAt,
      from: String(m.from ?? ''),
      to: String(m.to ?? ''),
      rows: Number(m.rows ?? 0),
      total: Number(m.total ?? 0),
      unmatched: Number(m.unmatched ?? 0),
      byCompany: (m.byCompany ?? {}) as Partial<Record<Company, { rows: number; total: number }>>,
    };
  }

  /** When contacts were last synced and what it did. */
  async lastContactSync() {
    const e = await this.prisma.auditEvent.findFirst({ where: { action: 'trcloud.contacts.sync' }, orderBy: { occurredAt: 'desc' }, select: { occurredAt: true, metadata: true } });
    if (!e) return null;
    const m = (e.metadata ?? {}) as Record<string, unknown>;
    const n = (k: string) => (typeof m[k] === 'number' ? m[k] : 0);
    return {
      at: e.occurredAt,
      companies: Array.isArray(m.companies) ? (m.companies as Company[]) : [],
      created: n('created'),
      linked: n('linked'),
      renamed: n('renamed'),
      removed: n('removed'),
      closed: n('closed'),
      needsDecision: n('needsDecision'),
      removalHeld: n('removalHeld'),
    };
  }

  private async fetchAll(company: Company, endpoint: Endpoint, query: (page: number) => Record<string, unknown>) {
    const all: Record<string, unknown>[] = [];
    for (let page = 1; page <= MAX_PAGES; page++) {
      const answer = await this.client.read(company, endpoint.group, endpoint.command, query(page));
      if (answer.empty) break;
      all.push(...records(answer));
      if (!hasMore(answer, page)) break;
    }
    return all;
  }

  private companies(): Company[] {
    const list = this.client.companies();
    if (!list.length) throw new DomainError('NOT_CONFIGURED', 'ยังไม่ได้ตั้งค่าการเชื่อมต่อ TRCLOUD', HttpStatus.SERVICE_UNAVAILABLE);
    return list;
  }

  private groupTaxIds() {
    return new Set(loadConfig().TRCLOUD_GROUP_TAX_IDS);
  }

  private async customers(): Promise<CustomerRow[]> {
    const rows = await this.prisma.customer.findMany({
      orderBy: { code: 'asc' },
      select: {
        id: true,
        code: true,
        name: true,
        taxId: true,
        address: true,
        isActive: true,
        trcloudLinks: { select: { company: true, contactCode: true } },
        engagements: { where: { workCategory: { type: { not: WorkCategoryType.CLIENT_WORK } } }, select: { id: true }, take: 1 },
      },
    });
    return rows.map(({ engagements, trcloudLinks, ...c }) => ({
      ...c,
      internal: engagements.length > 0,
      links: Object.fromEntries(trcloudLinks.map((l) => [l.company, l.contactCode])) as Partial<Record<Company, string>>,
    }));
  }

  /** One company's contacts (by internal id) and the ones that can become customers. */
  private async contactBook(company: Company): Promise<Book> {
    const byId = new Map<string, TrContact>();
    let noCode = 0;
    for (const raw of await this.fetchAll(company, ENDPOINTS.contacts, () => ({}))) {
      const c = toContact(raw);
      if (!c) noCode++;
      else if (!byId.has(c.id)) byId.set(c.id, c);
    }
    const group = this.groupTaxIds();
    const all = [...byId.values()];
    const seenCode = new Set<string>();
    const customers = all.filter((c) => !c.supplier && !c.obsolete && !(c.taxId && group.has(c.taxId)) && !seenCode.has(c.code) && seenCode.add(c.code));
    return {
      company,
      byId,
      customers,
      skipped: {
        noCode,
        suppliers: all.filter((c) => c.supplier).length,
        obsolete: all.filter((c) => c.obsolete).length,
        group: all.filter((c) => !c.supplier && c.taxId && group.has(c.taxId)).length,
      },
    };
  }

  private books() {
    return Promise.all(this.companies().map((c) => this.contactBook(c)));
  }

  // -------------------------------------------------------------------------
  // Contacts
  // -------------------------------------------------------------------------

  async contactsPreview() {
    const [books, customers] = await Promise.all([this.books(), this.customers()]);
    const { planned, fresh } = planCompanies(books, customers, new Map());
    const byId = new Map(customers.map((c) => [c.id, c]));
    const views = customers.map((c) => ({ ...c, trcloudCode: null }));
    const rows = planned.map((p) => {
      const real = p.target && byId.get(p.target);
      const joins = p.target && fresh.has(p.target) && fresh.get(p.target)!.contact !== p.contact ? fresh.get(p.target)!.contact : null;
      return {
        company: p.company,
        key: p.key,
        contact: p.contact,
        status: p.status,
        candidates: p.candidates.map((id) => ({ id, score: 1 })),
        customerId: real ? real.id : null,
        /** Without a choice: link to customerId, create a customer, join a customer created from another company's contact, or wait. */
        action: real ? ('LINK' as const) : joins ? ('JOIN' as const) : p.target ? ('NEW' as const) : ('WAIT' as const),
        joins: joins ? { code: joins.code, name: joins.name } : null,
        changes: real ? changesFor(p.contact, { ...real, trcloudCode: real.links[p.company] ?? null }, views) : null,
      };
    });
    return {
      companies: books.map((b) => b.company),
      rows,
      skipped: Object.fromEntries(books.map((b) => [b.company, b.skipped])),
      customers: customers.map(({ id, code, name, links }) => ({ id, code, name, links })),
    };
  }

  /**
   * decisions: "company:code" → customer id, 'NEW' or null (see ContactDecision). Without a decision a contact
   * follows the automatic plan. `req` is absent for the timed sync (audited without an actor).
   */
  async contactsApply(decisions: { key: string; customerId: ContactDecision }[], req?: AppRequest) {
    const companies = this.companies();
    const [books, customers] = await Promise.all([this.books(), this.customers()]);
    const { planned, fresh, linksOf } = planCompanies(books, customers, new Map(decisions.map((d) => [d.key, d.customerId])));
    const contactOf = new Map(planned.map((p) => [p.key, p.contact]));
    // A company whose answer was empty keeps its links as they are, and nothing is removed this time.
    const empty = new Set(books.filter((b) => !b.customers.length).map((b) => b.company));
    for (const c of customers) for (const co of empty) if (c.links[co] && !linksOf.get(c.id)![co]) linksOf.get(c.id)![co] = c.links[co];
    /** The contact that speaks for a customer: its highest-priority company's (PAS → PC → PA). */
    const primaryOf = (links: Partial<Record<Company, string>>) => {
      for (const co of companies) if (links[co]) return contactOf.get(keyOf(co, links[co]!)) ?? null;
      return null;
    };

    const byId = new Map(customers.map((c) => [c.id, c]));
    const views: ViewRow[] = customers.map((c) => ({ ...c, trcloudCode: null }));
    const hasLinks = (l: Partial<Record<Company, string>>) => Object.keys(l).length > 0;
    const gone = customers.filter((c) => hasLinks(c.links) && !hasLinks(linksOf.get(c.id)!) && c.isActive);
    const linkedCount = customers.filter((c) => hasLinks(c.links)).length;
    const holdRemoval = gone.length > 0 && (empty.size > 0 || gone.length > removalLimit(linkedCount));
    // Never in TRCLOUD (added by hand, or from before TRCLOUD): removed too (user decision 2026-10-09) — except
    // internal customers, and ones a waiting contact may still turn out to be.
    const maybe = new Set(planned.filter((p) => p.waiting).flatMap((p) => p.candidates));
    const strays = empty.size ? [] : customers.filter((c) => !hasLinks(c.links) && !hasLinks(linksOf.get(c.id)!) && c.isActive && !c.internal && !maybe.has(c.id));
    const toRemove = [...(holdRemoval ? [] : gone), ...strays];

    return this.prisma.$transaction(async (tx) => {
      const counts = {
        linked: 0,
        unlinked: 0,
        created: 0,
        renamed: 0,
        recoded: 0,
        reopened: 0,
        removed: 0,
        closed: 0,
        taxIdFilled: 0,
        taxIdConflicts: 0,
        addressUpdated: 0,
        unchanged: 0,
        needsDecision: planned.filter((p) => p.waiting).length,
        removalHeld: holdRemoval ? gone.length : 0,
      };
      // Links: drop the ones that changed first (both unique keys), then add.
      const wanted = new Set<string>();
      for (const [customerId, links] of [...linksOf, ...[...fresh.values()].map((n) => [n.id, n.links] as const)]) {
        for (const [co, code] of Object.entries(links)) wanted.add(`${customerId}|${co}|${code}`);
      }
      const existing = await tx.customerTrcloudLink.findMany({ select: { id: true, customerId: true, company: true, contactCode: true } });
      // Removal held (a suspicious answer): those customers keep their links too.
      const keepLinks = new Set(holdRemoval ? gone.map((c) => c.id) : []);
      const stale = existing.filter((l) => !wanted.has(`${l.customerId}|${l.company}|${l.contactCode}`) && !keepLinks.has(l.customerId));
      if (stale.length) await tx.customerTrcloudLink.deleteMany({ where: { id: { in: stale.map((l) => l.id) } } });
      counts.unlinked = stale.length;
      const have = new Set(existing.filter((l) => !stale.includes(l)).map((l) => `${l.customerId}|${l.company}|${l.contactCode}`));

      const takenCodes = new Set(customers.map((c) => c.code));
      const takenTax = new Set(customers.map((c) => normalizeTaxId(c.taxId)).filter((t): t is string => !!t));
      const ids = new Map<string, string>(); // "new:…" → created id
      for (const n of fresh.values()) {
        const primary = primaryOf(n.links) ?? n.contact;
        const taxId = [primary, ...Object.entries(n.links).map(([co, code]) => contactOf.get(keyOf(co as Company, code!)))].find((c) => c?.taxId && !takenTax.has(c.taxId))?.taxId ?? null;
        if (taxId) takenTax.add(taxId);
        const data = { code: uniqueCode(codeOf(primary), takenCodes), name: primary.name, taxId, address: primary.address };
        const c = await tx.customer.create({ data });
        ids.set(n.id, c.id);
        await this.audit.record({ action: 'customer.create', resourceType: 'customer', resourceId: c.id, after: { ...data, links: n.links }, metadata: { source: 'trcloud.contacts' } }, req, tx);
        counts.created++;
      }
      for (const [rawId, links] of [...linksOf, ...[...fresh.values()].map((n) => [n.id, n.links] as const)]) {
        const customerId = ids.get(rawId) ?? rawId;
        for (const [co, code] of Object.entries(links)) {
          if (have.has(`${rawId}|${co}|${code}`)) continue;
          await tx.customerTrcloudLink.create({ data: { customerId, company: co, contactCode: code! } });
          if (!fresh.has(rawId)) counts.linked++;
        }
      }

      // Existing customers follow their primary contact.
      for (const c of customers) {
        const links = linksOf.get(c.id)!;
        const primary = primaryOf(links);
        if (!primary) continue;
        const ch = changesFor(primary, { ...c, trcloudCode: null }, views);
        let code: string | null = null;
        if (ch.customerCode) {
          takenCodes.delete(c.code);
          code = uniqueCode(ch.customerCode, takenCodes);
          if (code === c.code) code = null;
        }
        const data = {
          ...(code ? { code } : {}),
          ...(ch.name ? { name: ch.name } : {}),
          ...(ch.activate ? { isActive: true } : {}),
          ...(ch.taxId === 'FILL' ? { taxId: primary.taxId } : {}),
          ...(ch.address ? { address: ch.address } : {}),
        };
        if (ch.taxId === 'CONFLICT') counts.taxIdConflicts++;
        if (!Object.keys(data).length) {
          counts.unchanged++;
          continue;
        }
        await tx.customer.update({ where: { id: c.id }, data });
        await this.audit.record(
          {
            action: 'customer.update',
            resourceType: 'customer',
            resourceId: c.id,
            before: { code: c.code, name: c.name, taxId: c.taxId, address: c.address, isActive: c.isActive, links: c.links },
            after: { ...data, links },
            metadata: { source: 'trcloud.contacts' },
          },
          req,
          tx,
        );
        if (code) counts.recoded++;
        if (ch.name) counts.renamed++;
        if (ch.activate) counts.reopened++;
        if (ch.taxId === 'FILL') counts.taxIdFilled++;
        if (ch.address) counts.addressUpdated++;
      }

      // Not in TRCLOUD: deleted when nothing refers to it, otherwise closed (its history keeps the customer).
      if (toRemove.length) {
        const refs = await tx.customer.findMany({ where: { id: { in: toRemove.map((c) => c.id) } }, select: { id: true, _count: { select: { engagements: true, revenueEntries: true } } } });
        for (const r of refs) {
          const { internal: _internal, ...before } = byId.get(r.id)!;
          if (!r._count.engagements && !r._count.revenueEntries) {
            await tx.customer.delete({ where: { id: r.id } });
            await this.audit.record({ action: 'customer.delete', resourceType: 'customer', resourceId: r.id, before, metadata: { source: 'trcloud.contacts', reason: 'not in TRCLOUD' } }, req, tx);
            counts.removed++;
          } else {
            await tx.customer.update({ where: { id: r.id }, data: { isActive: false } });
            await this.audit.record({ action: 'customer.update', resourceType: 'customer', resourceId: r.id, before: { isActive: true }, after: { isActive: false }, metadata: { source: 'trcloud.contacts', reason: 'not in TRCLOUD' } }, req, tx);
            counts.closed++;
          }
        }
      }
      if (holdRemoval) this.log.warn(`TRCLOUD contacts: ${gone.length} of ${linkedCount} linked customers missing (empty answer from: ${[...empty].join(', ') || 'none'}) — removal held`);
      const perCompany = Object.fromEntries(books.map((b) => [b.company, b.customers.length]));
      await this.audit.record({ action: 'trcloud.contacts.sync', resourceType: 'customer', metadata: { companies, contactsPerCompany: perCompany, auto: !req, ...counts } }, req, tx);
      return { companies, contacts: planned.length, waiting: planned.filter((p) => !p.target).length, ...counts };
    });
  }

  // -------------------------------------------------------------------------
  // Invoices → revenue
  // -------------------------------------------------------------------------

  /** One company's invoices in the range: item lines summed per document; Cancel and in-group invoices apart. */
  private async documents(company: Company, from: string, to: string) {
    const docs: TrDocument[] = [];
    for (const raw of await this.fetchAll(company, ENDPOINTS.invoices, (page) => invoiceQuery(from, to, page))) docs.push(toDocument(raw, 1));
    if (ENDPOINTS.creditNotes) for (const raw of await this.fetchAll(company, ENDPOINTS.creditNotes, (page) => invoiceQuery(from, to, page))) docs.push(toDocument(raw, -1));
    const byDoc = new Map<string, TrDocument>();
    for (const d of docs) {
      if (d.date < from || d.date > to) continue;
      const seen = byDoc.get(d.docNo);
      if (!seen) byDoc.set(d.docNo, { ...d });
      else {
        seen.amount = Math.round((seen.amount + d.amount) * 100) / 100;
        seen.cancelled ||= d.cancelled;
      }
    }
    const group = this.groupTaxIds();
    const all = [...byDoc.values()];
    const inGroup = (d: TrDocument) => !!d.taxId && group.has(d.taxId);
    return { kept: all.filter((d) => !d.cancelled && !inGroup(d)), cancelled: all.filter((d) => d.cancelled), inGroup: all.filter((d) => !d.cancelled && inGroup(d)) };
  }

  private period(fromMonth: string, toMonth: string) {
    if (!/^\d{4}-\d{2}$/.test(fromMonth) || !/^\d{4}-\d{2}$/.test(toMonth) || fromMonth > toMonth) throw new DomainError('BAD_PERIOD', 'ช่วงเดือนไม่ถูกต้อง');
    const [fy, fm] = fromMonth.split('-').map(Number);
    const [ty, tm] = toMonth.split('-').map(Number);
    if ((ty - fy) * 12 + (tm - fm) > 11) throw new DomainError('BAD_PERIOD', 'ดึงได้ครั้งละไม่เกิน 12 เดือน');
    return { from: monthStart(fromMonth), to: monthEnd(toMonth) };
  }

  /**
   * Invoice → customer: (company, the line's contact "#code") → the customer linked to it. If that contact is not
   * linked yet, the invoice's tax id may still identify exactly one customer.
   */
  private async rows(company: Company, from: string, to: string, customers: CustomerRow[]) {
    const { kept, cancelled, inGroup } = await this.documents(company, from, to);
    const byCode = new Map(customers.filter((c) => c.links[company]).map((c) => [c.links[company]!, c]));
    const byTax = new Map<string, CustomerRow[]>();
    for (const c of customers) {
      const t = normalizeTaxId(c.taxId);
      if (t) byTax.set(t, [...(byTax.get(t) ?? []), c]);
    }
    const rows: IngestRow[] = kept.map((d, i) => {
      const byLink = d.contactCode ? byCode.get(d.contactCode) : undefined;
      const byTaxId = !byLink && d.taxId && byTax.get(d.taxId)?.length === 1 ? byTax.get(d.taxId)![0] : undefined;
      const c = byLink ?? byTaxId;
      return {
        rowNo: i + 1,
        taxId: d.taxId,
        companyName: `${d.contactCode ?? `#${d.contactId}`} ${d.contactName}`.trim(),
        amount: d.amount,
        customerId: c?.id ?? null,
        matchedBy: byLink ? 'TRCLOUD_CODE' : byTaxId ? 'TAX_ID' : null,
        docNo: d.docNo,
        docDate: d.date,
      };
    });
    return { rows, cancelled, inGroup };
  }

  async invoicesPreview(fromMonth: string, toMonth: string) {
    const { from, to } = this.period(fromMonth, toMonth);
    const customers = await this.customers();
    const per = await Promise.all(this.companies().map(async (company) => ({ company, ...(await this.rows(company, from, to, customers)) })));
    const rows = per.flatMap((p) => p.rows.map((r) => ({ ...r, company: p.company })));
    const unmatched = rows.filter((r) => !r.customerId);
    const overlapping = await this.prisma.revenueBatch.findMany({
      where: { voidedAt: null, periodFrom: { lte: toDate(to) }, periodTo: { gte: toDate(from) } },
      select: { id: true, source: true, company: true, fileName: true, periodFrom: true, periodTo: true, totalAmount: true },
    });
    return {
      from,
      to,
      documents: rows.length,
      total: round2(rows.reduce((a, r) => a + r.amount, 0)),
      byCompany: per.map((p) => ({ company: p.company, documents: p.rows.length, total: round2(p.rows.reduce((a, r) => a + r.amount, 0)), cancelled: p.cancelled.length, inGroup: p.inGroup.length })),
      creditNotes: rows.filter((r) => r.amount < 0).length,
      cancelled: per.reduce((a, p) => a + p.cancelled.length, 0),
      inGroup: per.reduce((a, p) => a + p.inGroup.length, 0),
      unmatched: { rows: unmatched.length, amount: round2(unmatched.reduce((a, r) => a + r.amount, 0)), contacts: [...new Set(unmatched.map((r) => `${r.company} ${r.companyName}`))].slice(0, 50) },
      rows: rows.slice(0, 500).map((r) => ({ company: r.company, docNo: r.docNo, date: r.docDate, name: r.companyName, amount: r.amount, customerId: r.customerId })),
      // A previous TRCLOUD sync of these months is replaced automatically; Excel imports may double count.
      replaces: overlapping.filter((b) => b.source === RevenueSource.API).map(batchRef),
      excelOverlap: overlapping.filter((b) => b.source === RevenueSource.EXCEL).map(batchRef),
      creditNotesSupported: !!ENDPOINTS.creditNotes,
    };
  }

  /** A person's sync of a range: the same month-by-month store as the timer, plus Excel batches they chose to replace. */
  async invoicesCommit(user: AuthUser, fromMonth: string, toMonth: string, replaceExcelIds: string[], req: AppRequest) {
    return this.storeMonths(fromMonth, toMonth, user, req, replaceExcelIds);
  }

  /** The timer: the last SYNC_MONTHS months (this one included), so an invoice cancelled later stops counting. */
  async syncInvoices(req?: AppRequest) {
    const now = todayIn(loadConfig().TZ_BUSINESS).slice(0, 7);
    return this.storeMonths(shiftMonth(now, 1 - SYNC_MONTHS), now, null, req);
  }

  /**
   * Revenue is stored as one TRCLOUD batch per company per month. A month is rewritten only when that company's
   * invoices changed (content hash), and voided when none is left (e.g. the last one was cancelled). A company's sync
   * never touches another company's batches.
   */
  private async storeMonths(fromMonth: string, toMonth: string, user: AuthUser | null, req?: AppRequest, replaceExcelIds: string[] = []) {
    const { from, to } = this.period(fromMonth, toMonth);
    const companies = this.companies();
    const customers = await this.customers();
    // Fetch every company before writing anything: one failing company stores nothing.
    const per = await Promise.all(companies.map(async (company) => ({ company, ...(await this.rows(company, from, to, customers)) })));
    const all = per.flatMap((p) => p.rows);
    const counts = {
      months: 0,
      changed: 0,
      unchanged: 0,
      cleared: 0,
      replaced: 0,
      rows: all.length,
      total: round2(all.reduce((a, r) => a + r.amount, 0)),
      unmatched: all.filter((r) => !r.customerId).length,
      inGroup: per.reduce((a, p) => a + p.inGroup.length, 0),
      byCompany: Object.fromEntries(per.map((p) => [p.company, { rows: p.rows.length, total: round2(p.rows.reduce((a, r) => a + r.amount, 0)) }])),
    };
    if (replaceExcelIds.length) {
      const voided = await this.prisma.revenueBatch.updateMany({
        where: { id: { in: replaceExcelIds }, source: RevenueSource.EXCEL, voidedAt: null, periodFrom: { lte: toDate(to) }, periodTo: { gte: toDate(from) } },
        data: { voidedAt: new Date(), voidedById: user?.id ?? null, voidReason: 'แทนที่ด้วยข้อมูลจาก TRCLOUD' },
      });
      counts.replaced += voided.count;
    }
    for (const { company, rows } of per) {
      for (let m = fromMonth; m <= toMonth; m = shiftMonth(m, 1)) {
        counts.months++;
        const [mFrom, mTo] = [monthStart(m), monthEnd(m)];
        const monthRows = rows
          .filter((r) => r.docDate! >= mFrom && r.docDate! <= mTo)
          .sort((a, b) => (a.docDate! + a.docNo!).localeCompare(b.docDate! + b.docNo!))
          .map((r, i) => ({ ...r, rowNo: i + 1 }));
        const hash = createHash('sha256').update(JSON.stringify([company, monthRows.map((r) => [r.docNo, r.docDate, r.amount, r.customerId])])).digest('hex');
        const current = await this.prisma.revenueBatch.findMany({
          where: { source: RevenueSource.API, company, voidedAt: null, periodFrom: { lte: toDate(mTo) }, periodTo: { gte: toDate(mFrom) } },
          select: { id: true, contentHash: true, periodFrom: true, periodTo: true },
        });
        const same = current.length === 1 && current[0].contentHash === hash && toIsoDate(current[0].periodFrom) === mFrom && toIsoDate(current[0].periodTo) === mTo;
        if (same || (!monthRows.length && !current.length)) {
          counts.unchanged++;
          continue;
        }
        if (!monthRows.length) {
          await this.prisma.$transaction(async (tx) => {
            await tx.revenueBatch.updateMany({ where: { id: { in: current.map((b) => b.id) }, voidedAt: null }, data: { voidedAt: new Date(), voidedById: user?.id ?? null, voidReason: 'ไม่มีใบแจ้งหนี้ใน TRCLOUD แล้ว (ยกเลิก)' } });
            for (const b of current) await this.audit.record({ action: 'revenue.void', resourceType: 'revenue_batch', resourceId: b.id, metadata: { reason: 'no TRCLOUD invoice left', company, month: m } }, req, tx);
          });
          counts.cleared++;
          continue;
        }
        await this.revenue.ingest(
          {
            source: RevenueSource.API,
            company,
            fileName: `TRCLOUD ${company} ใบแจ้งหนี้ ${m}`,
            externalRef: `trcloud:${company}:invoices:${m}:${Date.now()}`,
            contentHash: hash,
            periodFrom: mFrom,
            periodTo: mTo,
            rows: monthRows,
            replaceBatchIds: current.map((b) => b.id),
          },
          user,
          req,
        );
        counts.changed++;
      }
    }
    await this.audit.record({ action: 'trcloud.invoices.sync', resourceType: 'revenue_batch', metadata: { from, to, auto: !user, companies, ...counts } }, req);
    return counts;
  }
}

const round2 = (n: number) => Math.round(n * 100) / 100;
const batchRef = (b: { id: string; company?: string | null; fileName: string | null; periodFrom: Date; periodTo: Date; totalAmount: unknown }) => ({
  id: b.id,
  company: b.company ?? null,
  fileName: b.fileName,
  periodFrom: toIsoDate(b.periodFrom),
  periodTo: toIsoDate(b.periodTo),
  totalAmount: Number(b.totalAmount),
});
