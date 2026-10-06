import { HttpStatus, Injectable } from '@nestjs/common';
import { AssetEventType, AssetStatus, AssignmentKind, AttachmentKind, EmploymentStatus, Prisma, ServiceRequestStatus } from '@prisma/client';
import { loadConfig } from '../../config';
import { toDate, toIsoDate, todayIn } from '../../common/dates';
import { conflict, DomainError, notFound } from '../../common/errors';
import { safeFileName, sniffFileType } from '../../common/file-sniff';
import { PrismaService } from '../../common/prisma.service';
import type { AppRequest } from '../../common/request-context';
import { StorageService } from '../../common/storage.service';
import { AuditService } from '../audit/audit.service';
import type { AuthUser } from '../auth/auth.types';
import { bracketNicknames, suggestHolder, surveyLabel } from './holder-match';

type Tx = Prisma.TransactionClient;
export type Specs = Record<string, string>;
export interface EvidenceUpload {
  buffer: Buffer;
  originalname: string;
  size: number;
}

export interface AssetInput {
  code: string;
  categoryId: string;
  brand?: string | null;
  model?: string | null;
  serialNo?: string | null;
  hostname?: string | null;
  faCode?: string | null;
  specs: Record<string, string | null>;
  purchaseDate?: string | null;
  cost?: number | null;
  usefulLifeYears?: number;
  warrantyUntil?: string | null;
  vendorId?: string | null;
  notes?: string | null;
}

export type AssetInfoInput = Partial<Omit<AssetInput, 'specs' | 'code'>> & { expectedVersion: number };

export interface AssignInput {
  employeeId?: string | null;
  locationId?: string | null;
  kind: AssignmentKind;
  startDate: string;
  dueDate?: string | null;
  note?: string | null;
  /** Swap: take back the computer the employee holds now, on the same day (1 person = 1 computer). */
  replaceCurrent?: boolean;
}

/**
 * What people see as the device's state. Derived from the lifecycle status plus who holds it:
 * ACTIVE splits into in use / free / reserved (handed to a new hire whose first day is still ahead).
 */
export type AssetState = 'IN_USE' | 'AVAILABLE' | 'RESERVED' | 'IN_REPAIR' | 'BROKEN' | 'RETIRED' | 'DISPOSED' | 'LOST';
export const ASSET_STATES: AssetState[] = ['IN_USE', 'AVAILABLE', 'RESERVED', 'IN_REPAIR', 'BROKEN', 'RETIRED', 'DISPOSED', 'LOST'];

export function stateOf(status: AssetStatus, open: { startDate: Date } | null | undefined, today: string): AssetState {
  if (status !== AssetStatus.ACTIVE) return status;
  if (!open) return 'AVAILABLE';
  return toIsoDate(open.startDate) > today ? 'RESERVED' : 'IN_USE';
}

/** Events a person records; the others are written by the system when data changes. */
export const MANUAL_EVENT_TYPES = [
  AssetEventType.ISSUE,
  AssetEventType.REPAIR,
  AssetEventType.UPGRADE,
  AssetEventType.SOFTWARE,
  AssetEventType.INSPECTION,
  AssetEventType.SPEC_CORRECTED,
  AssetEventType.NOTE,
] as const;
export type ManualEventType = (typeof MANUAL_EVENT_TYPES)[number];

export interface EventInput {
  type: ManualEventType;
  occurredOn: string;
  completedOn?: string | null;
  title: string;
  detail?: string | null;
  /** New values for spec fields (null/"" removes the field). Required for UPGRADE / SPEC_CORRECTED. */
  specChanges?: Record<string, string | null>;
  cost?: number | null;
  vendorId?: string | null;
  underWarranty?: boolean | null;
  employeeId?: string | null;
  expectedVersion: number;
}

const HANDOUT_STATUSES: AssetStatus[] = [AssetStatus.ACTIVE];
const KIND_LABEL: Record<AssignmentKind, string> = { PRIMARY: 'ใช้ประจำ', LOAN: 'ยืมชั่วคราว', SHARED: 'ใช้ร่วม' };
export const STATUS_LABEL: Record<AssetStatus, string> = {
  ACTIVE: 'ใช้งานได้',
  IN_REPAIR: 'ส่งซ่อม',
  BROKEN: 'ไม่พร้อมใช้งาน',
  RETIRED: 'เลิกใช้งาน',
  DISPOSED: 'จำหน่ายแล้ว',
  LOST: 'สูญหาย',
};

const holderSelect = {
  employee: { select: { id: true, fullName: true, nickname: true, employeeCode: true, status: true } },
  location: { select: { id: true, name: true } },
} as const;

type HolderRow = { employee: { fullName: string; nickname: string | null } | null; location: { name: string } | null };
export const holderName = (a: HolderRow) =>
  a.employee ? `${a.employee.fullName}${a.employee.nickname ? ` (${a.employee.nickname})` : ''}` : (a.location?.name ?? '–');

const clean = (v: string | null | undefined) => {
  const t = v?.trim();
  return t ? t : null;
};

function cleanSpecs(specs: Record<string, string | null | undefined>): Specs {
  const out: Specs = {};
  for (const [k, v] of Object.entries(specs)) {
    const t = clean(v);
    if (t) out[k] = t;
  }
  return out;
}

@Injectable()
export class AssetsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
    private readonly storage: StorageService,
  ) {}

  today() {
    return todayIn(loadConfig().TZ_BUSINESS);
  }

  private async byCode(code: string, tx: Tx = this.prisma) {
    const asset = await tx.asset.findUnique({ where: { code: code.toUpperCase() } });
    if (!asset) throw notFound('อุปกรณ์');
    return asset;
  }

  private async openAssignment(assetId: string, tx: Tx) {
    return tx.assetAssignment.findFirst({ where: { assetId, endDate: null }, include: holderSelect });
  }

  private checkVersion(asset: { version: number }, expected: number) {
    if (asset.version !== expected) throw conflict();
  }

  // -------------------------------------------------------------------------
  // Reading
  // -------------------------------------------------------------------------

  async options() {
    const [categories, locations, vendors, employees] = await Promise.all([
      this.prisma.assetCategory.findMany({ where: { isActive: true }, orderBy: { sortOrder: 'asc' } }),
      this.prisma.location.findMany({ where: { isActive: true }, orderBy: { name: 'asc' } }),
      this.prisma.vendor.findMany({ orderBy: { name: 'asc' }, select: { id: true, name: true } }),
      this.prisma.employee.findMany({
        where: { status: EmploymentStatus.ACTIVE },
        orderBy: { fullName: 'asc' },
        select: { id: true, fullName: true, nickname: true, employeeCode: true },
      }),
    ]);
    return { categories, locations, vendors, employees, statusLabels: STATUS_LABEL };
  }

  private stateWhere(state: AssetState, today: string): Prisma.AssetWhereInput {
    const t = toDate(today);
    switch (state) {
      case 'IN_USE':
        return { status: AssetStatus.ACTIVE, assignments: { some: { endDate: null, startDate: { lte: t } } } };
      case 'RESERVED':
        return { status: AssetStatus.ACTIVE, assignments: { some: { endDate: null, startDate: { gt: t } } } };
      case 'AVAILABLE':
        return { status: AssetStatus.ACTIVE, assignments: { none: { endDate: null } } };
      default:
        return { status: state };
    }
  }

  async list(filter: { q?: string; categoryId?: string; state?: AssetState; employeeId?: string }) {
    const q = filter.q?.trim();
    const today = this.today();
    const where: Prisma.AssetWhereInput = {
      AND: [
        filter.categoryId ? { categoryId: filter.categoryId } : {},
        filter.employeeId ? { assignments: { some: { endDate: null, employeeId: filter.employeeId } } } : {},
        filter.state ? this.stateWhere(filter.state, today) : {},
      ],
      ...(q
        ? {
            OR: [
              { code: { contains: q, mode: 'insensitive' } },
              { model: { contains: q, mode: 'insensitive' } },
              { brand: { contains: q, mode: 'insensitive' } },
              { serialNo: { contains: q, mode: 'insensitive' } },
              { hostname: { contains: q, mode: 'insensitive' } },
              { faCode: { contains: q, mode: 'insensitive' } },
              { assignments: { some: { endDate: null, employee: { OR: [{ fullName: { contains: q, mode: 'insensitive' } }, { nickname: { contains: q, mode: 'insensitive' } }] } } } },
              { assignments: { some: { endDate: null, location: { name: { contains: q, mode: 'insensitive' } } } } },
            ],
          }
        : {}),
    };
    const [rows, counts] = await Promise.all([
      this.prisma.asset.findMany({
        where,
        orderBy: { code: 'asc' },
        include: {
          category: { select: { id: true, name: true, key: true } },
          assignments: { where: { endDate: null }, include: holderSelect },
          events: { where: { voidedAt: null }, orderBy: [{ occurredOn: 'desc' }, { recordedAt: 'desc' }], take: 1, select: { type: true, title: true, occurredOn: true } },
          _count: { select: { requests: { where: { status: { in: [ServiceRequestStatus.SUBMITTED, ServiceRequestStatus.IN_PROGRESS] } } } } },
        },
        take: 1000,
      }),
      this.summary(),
    ]);
    return {
      summary: counts,
      rows: rows.map((a) => {
        const open = a.assignments[0];
        return {
          id: a.id,
          code: a.code,
          category: a.category,
          status: a.status,
          state: stateOf(a.status, open, today),
          openRequests: a._count.requests,
          brand: a.brand,
          model: a.model,
          specs: a.specs as Specs,
          purchaseDate: a.purchaseDate ? toIsoDate(a.purchaseDate) : null,
          ageYears: a.purchaseDate ? ageInYears(toIsoDate(a.purchaseDate), today) : null,
          pastUsefulLife: a.purchaseDate ? ageInYears(toIsoDate(a.purchaseDate), today) >= a.usefulLifeYears : false,
          holder: open ? { kind: open.kind, name: holderName(open), employeeId: open.employeeId, locationId: open.locationId, dueDate: open.dueDate ? toIsoDate(open.dueDate) : null, overdue: !!open.dueDate && toIsoDate(open.dueDate) < today } : null,
          lastEvent: a.events[0] ? { ...a.events[0], occurredOn: toIsoDate(a.events[0].occurredOn) } : null,
        };
      }),
    };
  }

  private async summary() {
    const today = this.today();
    const [states, assets, overdueLoans, openRequests] = await Promise.all([
      Promise.all(ASSET_STATES.map(async (st) => [st, await this.prisma.asset.count({ where: this.stateWhere(st, today) })] as const)),
      this.prisma.asset.findMany({ where: { status: { notIn: [AssetStatus.DISPOSED, AssetStatus.LOST] }, purchaseDate: { not: null } }, select: { purchaseDate: true, usefulLifeYears: true } }),
      this.prisma.assetAssignment.count({ where: { endDate: null, kind: AssignmentKind.LOAN, dueDate: { lt: toDate(today) } } }),
      this.prisma.serviceRequest.count({ where: { status: { in: [ServiceRequestStatus.SUBMITTED, ServiceRequestStatus.IN_PROGRESS] } } }),
    ]);
    const byState = Object.fromEntries(states) as Record<AssetState, number>;
    return {
      total: ASSET_STATES.filter((st) => st !== 'DISPOSED').reduce((a, st) => a + byState[st], 0),
      byState,
      pastUsefulLife: assets.filter((a) => ageInYears(toIsoDate(a.purchaseDate!), today) >= a.usefulLifeYears).length,
      overdueLoans,
      openRequests,
    };
  }

  async detail(code: string) {
    const asset = await this.prisma.asset.findUnique({
      where: { code: code.toUpperCase() },
      include: {
        category: true,
        vendor: { select: { id: true, name: true } },
        assignments: { orderBy: [{ startDate: 'desc' }, { createdAt: 'desc' }], include: { ...holderSelect, createdBy: { select: { fullName: true } } } },
        events: {
          orderBy: [{ occurredOn: 'desc' }, { recordedAt: 'desc' }],
          include: { vendor: { select: { name: true } }, employee: { select: { fullName: true, nickname: true } }, recordedBy: { select: { fullName: true } }, serviceRequest: { select: { number: true } } },
        },
        attachments: { orderBy: { uploadedAt: 'desc' }, include: { uploadedBy: { select: { fullName: true } } } },
        requests: { orderBy: { createdAt: 'desc' }, take: 20, include: { requester: { select: { fullName: true, nickname: true } } } },
      },
    });
    if (!asset) throw notFound('อุปกรณ์');
    const today = this.today();
    const iso = (d: Date | null) => (d ? toIsoDate(d) : null);
    const open = asset.assignments.find((a) => !a.endDate);
    return {
      ...asset,
      state: stateOf(asset.status, open, today),
      requests: asset.requests.map((r) => ({
        id: r.id,
        number: r.number,
        type: r.type,
        status: r.status,
        urgency: r.urgency,
        title: r.title,
        requester: `${r.requester.fullName}${r.requester.nickname ? ` (${r.requester.nickname})` : ''}`,
        createdAt: r.createdAt,
      })),
      specs: asset.specs as Specs,
      cost: asset.cost?.toString() ?? null,
      purchaseDate: iso(asset.purchaseDate),
      warrantyUntil: iso(asset.warrantyUntil),
      ageYears: asset.purchaseDate ? ageInYears(toIsoDate(asset.purchaseDate), today) : null,
      usefulLifeEnds: asset.purchaseDate ? addYears(toIsoDate(asset.purchaseDate), asset.usefulLifeYears) : null,
      holder: open ? { kind: open.kind, name: holderName(open), employeeId: open.employeeId, locationId: open.locationId, startDate: iso(open.startDate), dueDate: iso(open.dueDate) } : null,
      assignments: asset.assignments.map((a) => ({
        id: a.id,
        kind: a.kind,
        holder: holderName(a),
        employeeId: a.employeeId,
        locationId: a.locationId,
        startDate: iso(a.startDate),
        endDate: iso(a.endDate),
        dueDate: iso(a.dueDate),
        approximate: a.approximate,
        note: a.note,
        createdBy: a.createdBy.fullName,
      })),
      events: asset.events.map((e) => ({
        ...e,
        occurredOn: iso(e.occurredOn),
        completedOn: iso(e.completedOn),
        cost: e.cost?.toString() ?? null,
        vendor: e.vendor?.name ?? null,
        employee: e.employee ? `${e.employee.fullName}${e.employee.nickname ? ` (${e.employee.nickname})` : ''}` : null,
        recordedBy: e.recordedBy.fullName,
        openRepair: e.type === AssetEventType.REPAIR && !e.completedOn && !e.voidedAt,
        requestNumber: e.serviceRequest?.number ?? null,
      })),
      attachments: asset.attachments.map(({ storageKey: _key, sha256: _sha, uploadedBy, ...f }) => ({ ...f, uploadedBy: uploadedBy.fullName })),
    };
  }

  /**
   * Devices someone holds right now, with their history — the employee's own IT Asset view.
   * Costs, vendors, voided entries and evidence files stay with IT.
   */
  async heldBy(employeeId: string) {
    const rows = await this.prisma.assetAssignment.findMany({
      where: { employeeId, endDate: null },
      orderBy: { startDate: 'asc' },
      include: {
        asset: {
          include: {
            category: { select: { name: true, specFields: true } },
            events: {
              where: { voidedAt: null },
              orderBy: [{ occurredOn: 'desc' }, { recordedAt: 'desc' }],
              select: { id: true, type: true, occurredOn: true, completedOn: true, title: true, detail: true, specDiff: true, fromStatus: true, toStatus: true, underWarranty: true },
            },
          },
        },
      },
    });
    const today = this.today();
    return rows.map((a) => ({
      code: a.asset.code,
      category: a.asset.category.name,
      specFields: a.asset.category.specFields as { key: string; label: string }[],
      brand: a.asset.brand,
      model: a.asset.model,
      serialNo: a.asset.serialNo,
      specs: a.asset.specs as Specs,
      status: a.asset.status,
      state: stateOf(a.asset.status, a, today),
      purchaseDate: a.asset.purchaseDate ? toIsoDate(a.asset.purchaseDate) : null,
      warrantyUntil: a.asset.warrantyUntil ? toIsoDate(a.asset.warrantyUntil) : null,
      kind: a.kind,
      startDate: toIsoDate(a.startDate),
      dueDate: a.dueDate ? toIsoDate(a.dueDate) : null,
      overdue: !!a.dueDate && toIsoDate(a.dueDate) < today,
      history: a.asset.events.map((e) => ({ ...e, occurredOn: toIsoDate(e.occurredOn), completedOn: e.completedOn ? toIsoDate(e.completedOn) : null })),
    }));
  }

  /** Next free "<prefix>-0001" code for a category — skips every existing number, codes are never reused. */
  async nextCode(categoryId: string) {
    const category = await this.prisma.assetCategory.findUnique({ where: { id: categoryId } });
    if (!category) throw notFound('ประเภทอุปกรณ์');
    const rows = await this.prisma.$queryRaw<{ n: number | null }[]>`
      SELECT MAX(substring("code" FROM ${`^${category.codePrefix}-([0-9]+)$`})::int) AS n
      FROM "asset" WHERE "code" ~ ${`^${category.codePrefix}-[0-9]+$`}`;
    const next = (rows[0]?.n ?? 0) + 1;
    return { code: `${category.codePrefix}-${String(next).padStart(4, '0')}` };
  }

  // -------------------------------------------------------------------------
  // Register / edit
  // -------------------------------------------------------------------------

  async create(user: AuthUser, input: AssetInput, req: AppRequest) {
    const code = input.code.trim().toUpperCase();
    const category = await this.prisma.assetCategory.findUnique({ where: { id: input.categoryId } });
    if (!category) throw notFound('ประเภทอุปกรณ์');
    try {
      return await this.prisma.$transaction(async (tx) => {
        const asset = await tx.asset.create({
          data: {
            code,
            categoryId: input.categoryId,
            brand: clean(input.brand),
            model: clean(input.model),
            serialNo: clean(input.serialNo),
            hostname: clean(input.hostname),
            faCode: clean(input.faCode),
            specs: cleanSpecs(input.specs),
            purchaseDate: input.purchaseDate ? toDate(input.purchaseDate) : null,
            cost: input.cost ?? null,
            usefulLifeYears: input.usefulLifeYears ?? 5,
            warrantyUntil: input.warrantyUntil ? toDate(input.warrantyUntil) : null,
            vendorId: input.vendorId ?? null,
            notes: clean(input.notes),
          },
        });
        await tx.assetEvent.create({
          data: {
            assetId: asset.id,
            type: AssetEventType.REGISTERED,
            occurredOn: asset.purchaseDate ?? toDate(this.today()),
            title: `ลงทะเบียน ${category.name}`,
            cost: asset.cost,
            vendorId: asset.vendorId,
            recordedById: user.id,
          },
        });
        await this.audit.record({ action: 'asset.create', resourceType: 'asset', resourceId: asset.id, after: { ...input, code } }, req, tx);
        return { id: asset.id, code: asset.code, version: asset.version };
      });
    } catch (e) {
      throw this.mapUnique(e);
    }
  }

  async updateInfo(code: string, input: AssetInfoInput, req: AppRequest) {
    const { expectedVersion, ...fields } = input;
    if (fields.categoryId && !(await this.prisma.assetCategory.findUnique({ where: { id: fields.categoryId } }))) throw notFound('ประเภทอุปกรณ์');
    try {
      return await this.prisma.$transaction(async (tx) => {
        const before = await this.byCode(code, tx);
        this.checkVersion(before, expectedVersion);
        const data: Prisma.AssetUncheckedUpdateInput = { version: { increment: 1 } };
        for (const k of ['brand', 'model', 'serialNo', 'hostname', 'faCode', 'notes'] as const) if (k in fields) data[k] = clean(fields[k]);
        for (const k of ['purchaseDate', 'warrantyUntil'] as const) if (k in fields) data[k] = fields[k] ? toDate(fields[k]!) : null;
        if ('cost' in fields) data.cost = fields.cost ?? null;
        if ('vendorId' in fields) data.vendorId = fields.vendorId ?? null;
        if (fields.usefulLifeYears) data.usefulLifeYears = fields.usefulLifeYears;
        if (fields.categoryId) data.categoryId = fields.categoryId;
        const updated = await tx.asset.updateMany({ where: { id: before.id, version: expectedVersion }, data });
        if (updated.count !== 1) throw conflict();
        await this.audit.record({ action: 'asset.update', resourceType: 'asset', resourceId: before.id, before: pick(before, Object.keys(fields)), after: fields }, req, tx);
        return { code: before.code, version: expectedVersion + 1 };
      });
    } catch (e) {
      throw this.mapUnique(e);
    }
  }

  private mapUnique(e: unknown) {
    if (e instanceof Prisma.PrismaClientKnownRequestError && e.code === 'P2002') {
      const target = String((e.meta?.target as string[] | undefined)?.join(',') ?? '');
      return new DomainError('DUPLICATE', target.includes('serial') ? 'มี Serial Number นี้ในระบบแล้ว' : 'มีรหัสอุปกรณ์นี้แล้ว', HttpStatus.CONFLICT);
    }
    if (e instanceof Error && /asset_code_format/.test(e.message)) {
      return new DomainError('VALIDATION_FAILED', 'รหัสอุปกรณ์ใช้ได้เฉพาะ A-Z, 0-9 และ -', HttpStatus.BAD_REQUEST);
    }
    return e;
  }

  // -------------------------------------------------------------------------
  // Hand out / take back
  // -------------------------------------------------------------------------

  /** Hand out or move a device. An open assignment is closed on the same day (transfer = one action). */
  /**
   * The survey import kept each machine's user as text (holders were not linked then, user decision 2026-09-30).
   * Now that people are imported, suggest a holder per machine; IT confirms in the UI.
   */
  async holderSuggestions() {
    const [assets, people, held] = await Promise.all([
      this.prisma.asset.findMany({
        where: { assignments: { none: { endDate: null } }, notes: { contains: 'ยังไม่ผูกกับพนักงาน' } },
        orderBy: { code: 'asc' },
        select: { code: true, brand: true, model: true, status: true, notes: true, category: { select: { name: true, onePerPerson: true } } },
      }),
      this.prisma.employee.findMany({
        where: { status: EmploymentStatus.ACTIVE },
        orderBy: [{ nickname: 'asc' }, { fullName: 'asc' }],
        select: { id: true, fullName: true, nickname: true, orgUnit: { select: { name: true } } },
      }),
      this.prisma.assetAssignment.findMany({
        where: { endDate: null, employeeId: { not: null }, asset: { category: { onePerPerson: true } } },
        select: { employeeId: true, asset: { select: { code: true } } },
      }),
    ]);
    const holding = new Map<string, string[]>();
    for (const h of held) holding.set(h.employeeId!, [...(holding.get(h.employeeId!) ?? []), h.asset.code]);
    // Pass 1 learns nicknames from rows matched by name ("กรรณพา ยกย่อง (พี่ยู)"); pass 2 uses them for "พี่ยู" alone.
    const labelled = assets.map((a) => ({ a, label: surveyLabel(a.notes) })).filter((x): x is { a: (typeof assets)[number]; label: string } => !!x.label);
    const aliases = new Map<string, string[]>();
    for (const { label } of labelled) {
      const s = suggestHolder(label, people);
      if (s.match && s.match.how !== 'NICKNAME') aliases.set(s.match.employeeId, [...(aliases.get(s.match.employeeId) ?? []), ...bracketNicknames(label)]);
    }
    const rows = [];
    for (const { a, label } of labelled) {
      const s = suggestHolder(label, people, aliases);
      rows.push({
        code: a.code,
        category: a.category.name,
        onePerPerson: a.category.onePerPerson,
        model: [a.brand, a.model].filter(Boolean).join(' ') || null,
        status: a.status,
        canAssign: HANDOUT_STATUSES.includes(a.status),
        label,
        vacant: s.vacant,
        match: s.match,
        candidates: s.candidates,
      });
    }
    return {
      rows,
      people: people.map((p) => ({ id: p.id, fullName: p.fullName, nickname: p.nickname, team: p.orgUnit?.name ?? null, holding: holding.get(p.id) ?? [] })),
    };
  }

  /** Each confirmed pair goes through the normal hand-out rules on its own, so one problem does not block the rest. */
  async applyHolders(user: AuthUser, items: { code: string; employeeId: string }[], startDate: string, req: AppRequest) {
    const results: { code: string; ok: boolean; message?: string }[] = [];
    for (const it of items) {
      try {
        await this.prisma.$transaction(async (tx) => {
          await this.assign(user, it.code, { employeeId: it.employeeId, kind: AssignmentKind.PRIMARY, startDate, note: 'จับคู่จากแบบสำรวจอุปกรณ์ 09.69' }, req, tx);
          const asset = await tx.asset.findUniqueOrThrow({ where: { code: it.code }, select: { id: true, notes: true } });
          await tx.asset.update({ where: { id: asset.id }, data: { notes: (asset.notes ?? '').replace('— ยังไม่ผูกกับพนักงาน', '— ผูกกับพนักงานแล้ว') } });
        });
        results.push({ code: it.code, ok: true });
      } catch (e) {
        if (!(e instanceof DomainError)) throw e;
        results.push({ code: it.code, ok: false, message: (e.getResponse() as { message?: string }).message ?? 'มอบเครื่องไม่ได้' });
      }
    }
    return { assigned: results.filter((r) => r.ok).length, results };
  }

  async assign(user: AuthUser, code: string, input: AssignInput, req?: AppRequest, outerTx?: Tx) {
    const run = async (tx: Tx) => {
      const asset = await this.byCode(code, tx);
      if (!HANDOUT_STATUSES.includes(asset.status)) {
        throw new DomainError('ASSET_NOT_AVAILABLE', `มอบเครื่องไม่ได้: สถานะ "${STATUS_LABEL[asset.status]}"`, HttpStatus.CONFLICT);
      }
      if (!!input.employeeId === !!input.locationId) throw new DomainError('VALIDATION_FAILED', 'ต้องเลือกผู้รับ หรือ สถานที่ อย่างใดอย่างหนึ่ง', 400);
      if (input.kind === AssignmentKind.SHARED && !input.locationId) throw new DomainError('VALIDATION_FAILED', 'เครื่องใช้ร่วมต้องระบุสถานที่', 400);
      if (input.kind === AssignmentKind.LOAN) {
        if (!input.dueDate) throw new DomainError('VALIDATION_FAILED', 'การยืมต้องมีวันกำหนดคืน', 400);
        if (input.dueDate < input.startDate) throw new DomainError('VALIDATION_FAILED', 'วันกำหนดคืนต้องไม่ก่อนวันที่ยืม', 400);
      }
      let receiver = '';
      if (input.employeeId) {
        const e = await tx.employee.findUnique({ where: { id: input.employeeId } });
        if (!e) throw notFound('พนักงาน');
        if (e.status !== EmploymentStatus.ACTIVE) throw new DomainError('EMPLOYEE_INACTIVE', 'มอบเครื่องให้พนักงานที่พ้นสภาพแล้วไม่ได้', HttpStatus.CONFLICT);
        receiver = `${e.fullName}${e.nickname ? ` (${e.nickname})` : ''}`;
        await this.enforceOnePerPerson(user, asset, input, receiver, tx, req);
      } else {
        const l = await tx.location.findUnique({ where: { id: input.locationId! } });
        if (!l) throw notFound('สถานที่');
        receiver = l.name;
      }

      const open = await this.openAssignment(asset.id, tx);
      if (open) {
        if (open.employeeId === (input.employeeId ?? null) && open.locationId === (input.locationId ?? null) && open.kind === input.kind) {
          throw new DomainError('ALREADY_ASSIGNED', `${receiver} ถือเครื่องนี้อยู่แล้ว`, HttpStatus.CONFLICT);
        }
        if (toIsoDate(open.startDate) > input.startDate) {
          throw new DomainError('ASSIGNMENT_OVERLAP', `ผู้ถือปัจจุบันเริ่มถือตั้งแต่ ${toIsoDate(open.startDate)} — วันที่ย้ายต้องไม่ก่อนหน้านั้น`, HttpStatus.CONFLICT);
        }
        await tx.assetAssignment.update({ where: { id: open.id }, data: { endDate: toDate(input.startDate) } });
      }
      let created;
      try {
        created = await tx.assetAssignment.create({
          data: {
            assetId: asset.id,
            employeeId: input.employeeId ?? null,
            locationId: input.locationId ?? null,
            kind: input.kind,
            startDate: toDate(input.startDate),
            dueDate: input.kind === AssignmentKind.LOAN ? toDate(input.dueDate!) : null,
            note: clean(input.note),
            createdById: user.id,
          },
        });
      } catch (e) {
        if (e instanceof Error && /23P01|asset_assignment_no_overlap/.test(e.message)) {
          throw new DomainError('ASSIGNMENT_OVERLAP', 'ช่วงวันที่ทับกับประวัติการถือครองที่มีอยู่ — ตรวจสอบวันที่อีกครั้ง', HttpStatus.CONFLICT);
        }
        throw e;
      }
      const title = open
        ? `ย้ายจาก ${holderName(open)} ไป ${receiver} (${KIND_LABEL[input.kind]})`
        : `มอบให้ ${receiver} (${KIND_LABEL[input.kind]})`;
      await tx.assetEvent.create({
        data: {
          assetId: asset.id,
          type: AssetEventType.ASSIGNED,
          occurredOn: toDate(input.startDate),
          title,
          detail: [input.kind === AssignmentKind.LOAN ? `กำหนดคืน ${input.dueDate}` : null, clean(input.note)].filter(Boolean).join(' · ') || null,
          employeeId: input.employeeId ?? null,
          recordedById: user.id,
        },
      });
      await this.audit.record({ action: 'asset.assign', resourceType: 'asset', resourceId: asset.id, before: open ? { assignmentId: open.id } : null, after: { ...input, assignmentId: created.id } }, req, tx);
      return created;
    };
    // The exclusion constraint aborts the transaction, so the overlap check runs in its own one unless nested.
    return outerTx ? run(outerTx) : this.prisma.$transaction(run);
  }

  /**
   * 1 person = 1 computer (categories flagged one_per_person). Exceptions:
   *  - a LOAN while the person's own computer is away for repair (legacy "ยืมช่วงที่เอาคอมไปซ่อม");
   *  - replaceCurrent: the old computer is taken back on the same day (swap to a new machine).
   */
  private async enforceOnePerPerson(user: AuthUser, asset: { id: string; categoryId: string }, input: AssignInput, receiver: string, tx: Tx, req?: AppRequest) {
    const category = await tx.assetCategory.findUniqueOrThrow({ where: { id: asset.categoryId } });
    if (!category.onePerPerson) return;
    const others = await tx.assetAssignment.findMany({
      where: { employeeId: input.employeeId, endDate: null, assetId: { not: asset.id }, asset: { category: { onePerPerson: true } } },
      include: { asset: { select: { code: true, status: true } } },
    });
    if (!others.length) return;
    if (input.kind === AssignmentKind.LOAN && others.every((o) => o.asset.status === AssetStatus.IN_REPAIR)) return;
    if (input.replaceCurrent) {
      for (const o of others) await this.returnDevice(user, o.asset.code, { date: input.startDate, note: 'เปลี่ยนเป็นเครื่องใหม่' }, req, tx);
      return;
    }
    const codes = others.map((o) => o.asset.code).join(', ');
    throw new DomainError('ONE_PER_PERSON', `${receiver} ถือ ${codes} อยู่แล้ว (1 คนถือได้ 1 เครื่อง) — เลือก "เปลี่ยนเครื่อง" เพื่อรับเครื่องเดิมคืนพร้อมกัน`, HttpStatus.CONFLICT, { holding: others.map((o) => o.asset.code) });
  }

  async returnDevice(user: AuthUser, code: string, input: { date: string; note?: string | null }, req?: AppRequest, outerTx?: Tx) {
    const run = async (tx: Tx) => {
      const asset = await this.byCode(code, tx);
      const open = await this.openAssignment(asset.id, tx);
      if (!open) throw new DomainError('NOT_ASSIGNED', 'เครื่องนี้ไม่มีผู้ถืออยู่', HttpStatus.CONFLICT);
      if (input.date < toIsoDate(open.startDate)) {
        throw new DomainError('VALIDATION_FAILED', `วันที่คืนต้องไม่ก่อนวันที่เริ่มถือ (${toIsoDate(open.startDate)})`, 400);
      }
      await tx.assetAssignment.update({ where: { id: open.id }, data: { endDate: toDate(input.date) } });
      await tx.assetEvent.create({
        data: {
          assetId: asset.id,
          type: AssetEventType.RETURNED,
          occurredOn: toDate(input.date),
          title: `รับคืนจาก ${holderName(open)}`,
          detail: clean(input.note),
          employeeId: open.employeeId,
          recordedById: user.id,
        },
      });
      await this.audit.record({ action: 'asset.return', resourceType: 'asset', resourceId: asset.id, after: { assignmentId: open.id, ...input } }, req, tx);
      return { ok: true };
    };
    return outerTx ? run(outerTx) : this.prisma.$transaction(run);
  }

  // -------------------------------------------------------------------------
  // History
  // -------------------------------------------------------------------------

  async addEvent(user: AuthUser, code: string, input: EventInput, req: AppRequest) {
    if (input.completedOn && input.completedOn < input.occurredOn) throw new DomainError('VALIDATION_FAILED', 'วันที่รับคืนต้องไม่ก่อนวันที่ส่งซ่อม', 400);
    if (input.occurredOn > this.today()) throw new DomainError('VALIDATION_FAILED', 'วันที่เกิดเหตุการณ์ต้องไม่เป็นวันในอนาคต', 400);
    const changesSpecs = input.type === AssetEventType.UPGRADE || input.type === AssetEventType.SPEC_CORRECTED;
    return this.prisma.$transaction(async (tx) => {
      const asset = await this.byCode(code, tx);
      this.checkVersion(asset, input.expectedVersion);
      if (asset.status === AssetStatus.DISPOSED) throw new DomainError('ASSET_DISPOSED', 'อุปกรณ์นี้จำหน่ายแล้ว บันทึกเหตุการณ์เพิ่มไม่ได้', HttpStatus.CONFLICT);

      const data: Prisma.AssetUncheckedUpdateInput = { version: { increment: 1 } };
      let specDiff: Record<string, [string | null, string | null]> | null = null;
      if (changesSpecs) {
        const current = asset.specs as Specs;
        specDiff = {};
        for (const [k, raw] of Object.entries(input.specChanges ?? {})) {
          const next = clean(raw);
          const prev = current[k] ?? null;
          if (next !== prev) specDiff[k] = [prev, next];
        }
        if (!Object.keys(specDiff).length) throw new DomainError('VALIDATION_FAILED', 'ยังไม่ได้ระบุสเปกที่เปลี่ยน', 400);
        const nextSpecs = { ...current };
        for (const [k, [, next]] of Object.entries(specDiff)) {
          if (next === null) delete nextSpecs[k];
          else nextSpecs[k] = next;
        }
        data.specs = nextSpecs;
      }

      // A repair without a return date means the device is away now.
      let fromStatus: AssetStatus | null = null;
      let toStatus: AssetStatus | null = null;
      if (input.type === AssetEventType.REPAIR && !input.completedOn) {
        if (asset.status !== AssetStatus.ACTIVE && asset.status !== AssetStatus.BROKEN) {
          throw new DomainError('INVALID_STATUS', `ส่งซ่อมไม่ได้: สถานะ "${STATUS_LABEL[asset.status]}"`, HttpStatus.CONFLICT);
        }
        fromStatus = asset.status;
        toStatus = AssetStatus.IN_REPAIR;
        data.status = AssetStatus.IN_REPAIR;
      }

      await tx.asset.update({ where: { id: asset.id }, data });
      const event = await tx.assetEvent.create({
        data: {
          assetId: asset.id,
          type: input.type,
          occurredOn: toDate(input.occurredOn),
          completedOn: input.completedOn ? toDate(input.completedOn) : null,
          title: input.title.trim(),
          detail: clean(input.detail),
          specDiff: specDiff ?? undefined,
          fromStatus,
          toStatus,
          cost: input.cost ?? null,
          vendorId: input.vendorId ?? null,
          underWarranty: input.underWarranty ?? null,
          employeeId: input.employeeId ?? null,
          recordedById: user.id,
        },
      });
      await this.audit.record({ action: 'asset.event', resourceType: 'asset', resourceId: asset.id, after: { eventId: event.id, ...input } }, req, tx);
      return { id: event.id, version: asset.version + 1 };
    });
  }

  /** Device came back from repair. */
  async completeRepair(user: AuthUser, code: string, eventId: string, input: { completedOn: string; cost?: number | null; detail?: string | null; expectedVersion: number }, req: AppRequest) {
    return this.prisma.$transaction(async (tx) => {
      const asset = await this.byCode(code, tx);
      this.checkVersion(asset, input.expectedVersion);
      await this.closeRepair(user, asset, eventId, input, tx);
      await this.audit.record({ action: 'asset.repair_complete', resourceType: 'asset', resourceId: asset.id, after: { eventId, ...input } }, req, tx);
      return { ok: true };
    });
  }

  /** Closes an open REPAIR entry; the device becomes usable again when nothing else is away for repair. */
  async closeRepair(user: AuthUser, asset: { id: string; status: AssetStatus }, eventId: string, input: { completedOn: string; cost?: number | null; detail?: string | null }, tx: Tx) {
    const event = await tx.assetEvent.findFirst({ where: { id: eventId, assetId: asset.id } });
    if (!event || event.type !== AssetEventType.REPAIR) throw notFound('รายการซ่อม');
    if (event.completedOn || event.voidedAt) throw new DomainError('ALREADY_COMPLETED', 'รายการซ่อมนี้ปิดแล้ว', HttpStatus.CONFLICT);
    if (input.completedOn < toIsoDate(event.occurredOn)) throw new DomainError('VALIDATION_FAILED', 'วันที่รับคืนต้องไม่ก่อนวันที่ส่งซ่อม', 400);
    await tx.assetEvent.update({
      where: { id: event.id },
      data: {
        completedOn: toDate(input.completedOn),
        cost: input.cost ?? event.cost,
        detail: input.detail ? [event.detail, `ผลการซ่อม: ${input.detail.trim()}`].filter(Boolean).join('\n') : event.detail,
      },
    });
    const stillAway = await tx.assetEvent.count({ where: { assetId: asset.id, type: AssetEventType.REPAIR, completedOn: null, voidedAt: null, id: { not: event.id } } });
    if (asset.status === AssetStatus.IN_REPAIR && stillAway === 0) {
      await tx.asset.update({ where: { id: asset.id }, data: { status: AssetStatus.ACTIVE, version: { increment: 1 } } });
      await tx.assetEvent.create({
        data: { assetId: asset.id, type: AssetEventType.STATUS_CHANGED, occurredOn: toDate(input.completedOn), title: 'รับเครื่องคืนจากซ่อม — พร้อมใช้งาน', fromStatus: AssetStatus.IN_REPAIR, toStatus: AssetStatus.ACTIVE, recordedById: user.id },
      });
    } else {
      await tx.asset.update({ where: { id: asset.id }, data: { version: { increment: 1 } } });
    }
  }

  async changeStatus(user: AuthUser, code: string, input: { status: AssetStatus; occurredOn: string; reason: string; expectedVersion: number }, req: AppRequest) {
    if (input.status === AssetStatus.IN_REPAIR) throw new DomainError('VALIDATION_FAILED', 'การส่งซ่อมให้บันทึกผ่าน "บันทึกซ่อม"', 400);
    return this.prisma.$transaction(async (tx) => {
      const asset = await this.byCode(code, tx);
      this.checkVersion(asset, input.expectedVersion);
      if (asset.status === input.status) throw new DomainError('VALIDATION_FAILED', 'สถานะเดิมอยู่แล้ว', 400);
      if (asset.status === AssetStatus.DISPOSED) throw new DomainError('ASSET_DISPOSED', 'อุปกรณ์ที่จำหน่ายแล้วเปลี่ยนสถานะไม่ได้', HttpStatus.CONFLICT);
      if (asset.status === AssetStatus.IN_REPAIR) throw new DomainError('IN_REPAIR', 'เครื่องอยู่ระหว่างซ่อม — ปิดรายการซ่อมก่อน', HttpStatus.CONFLICT);
      const open = await this.openAssignment(asset.id, tx);
      if (open && input.status === AssetStatus.DISPOSED) {
        throw new DomainError('STILL_ASSIGNED', `ต้องรับเครื่องคืนจาก ${holderName(open)} ก่อนจำหน่าย`, HttpStatus.CONFLICT);
      }
      await tx.asset.update({ where: { id: asset.id }, data: { status: input.status, version: { increment: 1 } } });
      await tx.assetEvent.create({
        data: {
          assetId: asset.id,
          type: input.status === AssetStatus.DISPOSED ? AssetEventType.DISPOSED : AssetEventType.STATUS_CHANGED,
          occurredOn: toDate(input.occurredOn),
          title: `${STATUS_LABEL[asset.status]} → ${STATUS_LABEL[input.status]}`,
          detail: input.reason.trim(),
          fromStatus: asset.status,
          toStatus: input.status,
          recordedById: user.id,
        },
      });
      await this.audit.record({ action: 'asset.status', resourceType: 'asset', resourceId: asset.id, before: { status: asset.status }, after: input }, req, tx);
      return { version: asset.version + 1 };
    });
  }

  /**
   * Void a wrong entry (kept, shown struck through). Spec changes are undone, but only for the latest
   * spec-changing entry — undoing an older one would silently overwrite later changes.
   */
  async voidEvent(user: AuthUser, code: string, eventId: string, input: { reason: string; expectedVersion: number }, req: AppRequest) {
    return this.prisma.$transaction(async (tx) => {
      const asset = await this.byCode(code, tx);
      this.checkVersion(asset, input.expectedVersion);
      const event = await tx.assetEvent.findFirst({ where: { id: eventId, assetId: asset.id } });
      if (!event) throw notFound('รายการ');
      if (event.voidedAt) throw new DomainError('ALREADY_VOIDED', 'รายการนี้ถูกยกเลิกแล้ว', HttpStatus.CONFLICT);
      if (!(MANUAL_EVENT_TYPES as readonly AssetEventType[]).includes(event.type)) {
        throw new DomainError('SYSTEM_EVENT', 'รายการที่ระบบสร้าง (มอบ/คืน/สถานะ) แก้ได้ด้วยการทำรายการใหม่เท่านั้น', HttpStatus.CONFLICT);
      }
      const data: Prisma.AssetUncheckedUpdateInput = { version: { increment: 1 } };
      if (event.specDiff) {
        const later = await tx.assetEvent.count({
          where: { assetId: asset.id, voidedAt: null, id: { not: event.id }, specDiff: { not: Prisma.AnyNull }, recordedAt: { gt: event.recordedAt } },
        });
        if (later) throw new DomainError('LATER_SPEC_CHANGE', 'มีการเปลี่ยนสเปกหลังรายการนี้แล้ว — ยกเลิกรายการล่าสุดก่อน', HttpStatus.CONFLICT);
        const specs = { ...(asset.specs as Specs) };
        for (const [k, [prev]] of Object.entries(event.specDiff as Record<string, [string | null, string | null]>)) {
          if (prev === null) delete specs[k];
          else specs[k] = prev;
        }
        data.specs = specs;
      }
      if (event.type === AssetEventType.REPAIR && !event.completedOn && asset.status === AssetStatus.IN_REPAIR) {
        const others = await tx.assetEvent.count({ where: { assetId: asset.id, type: AssetEventType.REPAIR, completedOn: null, voidedAt: null, id: { not: event.id } } });
        if (!others) data.status = event.fromStatus ?? AssetStatus.ACTIVE;
      }
      await tx.asset.update({ where: { id: asset.id }, data });
      await tx.assetEvent.update({ where: { id: event.id }, data: { voidedAt: new Date(), voidReason: input.reason.trim() } });
      await this.audit.record({ action: 'asset.event_void', resourceType: 'asset', resourceId: asset.id, after: { eventId, reason: input.reason } }, req, tx);
      return { version: asset.version + 1 };
    });
  }

  // -------------------------------------------------------------------------
  // Evidence files
  // -------------------------------------------------------------------------

  /** Validates an upload by size and content, then writes it to storage. The caller records the row. */
  async storeEvidence(file: EvidenceUpload | undefined) {
    if (!file?.buffer?.length) throw new DomainError('VALIDATION_FAILED', 'ไม่พบไฟล์', 400);
    const maxMb = loadConfig().UPLOAD_MAX_MB;
    if (file.buffer.length > maxMb * 1024 * 1024) {
      throw new DomainError('FILE_TOO_LARGE', `ไฟล์ใหญ่เกิน ${maxMb} MB`, HttpStatus.PAYLOAD_TOO_LARGE);
    }
    const type = sniffFileType(file.buffer);
    if (!type) throw new DomainError('UNSUPPORTED_FILE', 'รองรับเฉพาะรูปภาพ (JPG, PNG, WEBP, HEIC) และ PDF', HttpStatus.UNSUPPORTED_MEDIA_TYPE);
    // Multer delivers UTF-8 names as latin1; keep the raw name when it does not decode cleanly.
    const decoded = Buffer.from(file.originalname, 'latin1').toString('utf8');
    const fileName = safeFileName(decoded.includes('\uFFFD') ? file.originalname : decoded, type.ext);
    const stored = await this.storage.put(file.buffer, type.ext);
    return { fileName, mimeType: type.mime, sizeBytes: file.buffer.length, sha256: stored.sha256, storageKey: stored.key };
  }

  async attach(user: AuthUser, code: string, file: EvidenceUpload | undefined, input: { kind: AttachmentKind; assetEventId?: string | null }, req: AppRequest) {
    const asset = await this.byCode(code);
    if (input.assetEventId) {
      const ev = await this.prisma.assetEvent.findFirst({ where: { id: input.assetEventId, assetId: asset.id } });
      if (!ev) throw notFound('รายการที่จะแนบไฟล์');
    }
    const stored = await this.storeEvidence(file);
    const row = await this.prisma.$transaction(async (tx) => {
      const created = await tx.attachment.create({
        data: { ...stored, assetId: asset.id, assetEventId: input.assetEventId ?? null, kind: input.kind, uploadedById: user.id },
      });
      await this.audit.record({ action: 'asset.attach', resourceType: 'asset', resourceId: asset.id, after: { attachmentId: created.id, fileName: stored.fileName, kind: input.kind, sha256: stored.sha256 } }, req, tx);
      return created;
    });
    return { id: row.id, fileName: row.fileName, mimeType: row.mimeType, sizeBytes: row.sizeBytes };
  }

  async readFile(storageKey: string) {
    return this.storage.get(storageKey);
  }

  async file(code: string, attachmentId: string) {
    const asset = await this.byCode(code);
    const row = await this.prisma.attachment.findFirst({ where: { id: attachmentId, assetId: asset.id } });
    if (!row) throw notFound('ไฟล์');
    return { row, data: await this.storage.get(row.storageKey) };
  }

  async voidAttachment(code: string, attachmentId: string, reason: string, req: AppRequest) {
    const asset = await this.byCode(code);
    return this.prisma.$transaction(async (tx) => {
      const row = await tx.attachment.findFirst({ where: { id: attachmentId, assetId: asset.id } });
      if (!row) throw notFound('ไฟล์');
      if (row.voidedAt) throw new DomainError('ALREADY_VOIDED', 'ไฟล์นี้ถูกยกเลิกแล้ว', HttpStatus.CONFLICT);
      await tx.attachment.update({ where: { id: row.id }, data: { voidedAt: new Date(), voidReason: reason.trim() } });
      await this.audit.record({ action: 'asset.attachment_void', resourceType: 'asset', resourceId: asset.id, after: { attachmentId, reason } }, req, tx);
      return { ok: true };
    });
  }

  // -------------------------------------------------------------------------
  // Reference data
  // -------------------------------------------------------------------------

  async addVendor(name: string, req: AppRequest) {
    const trimmed = name.trim();
    const existing = await this.prisma.vendor.findFirst({ where: { name: { equals: trimmed, mode: 'insensitive' } } });
    if (existing) return existing;
    const v = await this.prisma.vendor.create({ data: { name: trimmed } });
    await this.audit.record({ action: 'vendor.create', resourceType: 'vendor', resourceId: v.id, after: { name: trimmed } }, req);
    return v;
  }

  async addLocation(name: string, req: AppRequest) {
    const trimmed = name.trim();
    const existing = await this.prisma.location.findFirst({ where: { name: { equals: trimmed, mode: 'insensitive' } } });
    if (existing) return existing;
    const l = await this.prisma.location.create({ data: { name: trimmed } });
    await this.audit.record({ action: 'location.create', resourceType: 'location', resourceId: l.id, after: { name: trimmed } }, req);
    return l;
  }
}

/** Whole years between two ISO dates (the legacy sheet used DATEDIF(start, TODAY(), "y")). */
export function ageInYears(from: string, to: string): number {
  const [fy, fm, fd] = from.split('-').map(Number);
  const [ty, tm, td] = to.split('-').map(Number);
  let years = ty - fy;
  if (tm < fm || (tm === fm && td < fd)) years--;
  return Math.max(0, years);
}

export function addYears(iso: string, years: number): string {
  const [y, m, d] = iso.split('-').map(Number);
  const date = new Date(Date.UTC(y + years, m - 1, d));
  if (date.getUTCMonth() !== m - 1) date.setUTCDate(0); // 29 Feb → 28 Feb
  return toIsoDate(date);
}

function pick<T extends object>(obj: T, keys: string[]) {
  return Object.fromEntries(Object.entries(obj).filter(([k]) => keys.includes(k)));
}
