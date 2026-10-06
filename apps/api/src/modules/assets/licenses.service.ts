import { HttpStatus, Injectable } from '@nestjs/common';
import { AssetStatus, LicenseMetric, LicenseType, Prisma } from '@prisma/client';
import { loadConfig } from '../../config';
import { addDays, toDate, toIsoDate, todayIn } from '../../common/dates';
import { conflict, DomainError, notFound } from '../../common/errors';
import { PrismaService } from '../../common/prisma.service';
import type { AppRequest } from '../../common/request-context';
import { AuditService } from '../audit/audit.service';
import type { AuthUser } from '../auth/auth.types';

/** Licences that end within this many days are flagged "ใกล้หมดอายุ". */
export const EXPIRING_DAYS = 30;
/** Software whose category matches this counts as antivirus for the coverage check. */
const ANTIVIRUS = /แอนตี้ไวรัส|antivirus|anti-virus/i;
/** Categories that should carry antivirus when in use. */
const COMPUTERS = ['NOTEBOOK', 'DESKTOP', 'SERVER'];

export type LicenseState = 'ACTIVE' | 'EXPIRING' | 'EXPIRED' | 'NO_EXPIRY';

export interface SoftwareInput {
  name: string;
  publisher?: string | null;
  category?: string | null;
  website?: string | null;
  notes?: string | null;
  isActive?: boolean;
}

export interface LicenseInput {
  softwareId: string;
  name: string;
  edition?: string | null;
  type: LicenseType;
  metric: LicenseMetric;
  seats?: number | null;
  startDate?: string | null;
  endDate?: string | null;
  autoRenew?: boolean;
  cost?: number | null;
  vendorId?: string | null;
  reference?: string | null;
  keyHint?: string | null;
  attributes?: Record<string, string>;
  notes?: string | null;
}

export interface SeatInput {
  assetCodes?: string[];
  employeeIds?: string[];
  startDate?: string;
  installedOn?: string | null;
  note?: string | null;
}

export interface RenewInput {
  name: string;
  startDate: string;
  endDate?: string | null;
  seats?: number | null;
  cost?: number | null;
  autoRenew?: boolean;
  reference?: string | null;
  /** Give every machine/person on the old licence a seat on the new one. */
  carrySeats: boolean;
}

const clean = (v: string | null | undefined) => {
  const s = v?.trim();
  return s ? s : null;
};

type Tx = Prisma.TransactionClient;

/** "ASUS" + "ASUS UX333FN" → "ASUS UX333FN" (imported model names often repeat the brand). */
const modelText = (brand: string | null, model: string | null) =>
  (brand && model && model.toUpperCase().startsWith(brand.toUpperCase()) ? model : [brand, model].filter(Boolean).join(' ')) || null;

@Injectable()
export class LicensesService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
  ) {}

  private today() {
    return todayIn(loadConfig().TZ_BUSINESS);
  }

  stateOf(endDate: Date | null, today = this.today()): { state: LicenseState; daysLeft: number | null } {
    if (!endDate) return { state: 'NO_EXPIRY', daysLeft: null };
    const end = toIsoDate(endDate);
    const daysLeft = Math.round((toDate(end).getTime() - toDate(today).getTime()) / 86_400_000);
    if (end < today) return { state: 'EXPIRED', daysLeft };
    return { state: daysLeft <= EXPIRING_DAYS ? 'EXPIRING' : 'ACTIVE', daysLeft };
  }

  // -------------------------------------------------------------------------
  // Software catalogue
  // -------------------------------------------------------------------------

  async software() {
    const rows = await this.prisma.software.findMany({
      orderBy: [{ isActive: 'desc' }, { name: 'asc' }],
      include: { licenses: { where: { archivedAt: null }, select: { id: true, endDate: true, _count: { select: { assignments: { where: { endDate: null } } } } } } },
    });
    return rows.map(({ licenses, ...s }) => ({
      ...s,
      licenseCount: licenses.length,
      activeSeats: licenses.reduce((a, l) => a + l._count.assignments, 0),
    }));
  }

  async createSoftware(input: SoftwareInput, req: AppRequest) {
    const s = await this.prisma.software
      .create({ data: { name: input.name.trim(), publisher: clean(input.publisher), category: clean(input.category), website: clean(input.website), notes: clean(input.notes) } })
      .catch((e) => {
        throw this.unique(e, 'มีซอฟต์แวร์ชื่อนี้แล้ว');
      });
    await this.audit.record({ action: 'software.create', resourceType: 'software', resourceId: s.id, after: input }, req);
    return s;
  }

  async updateSoftware(id: string, input: Partial<SoftwareInput>, req: AppRequest) {
    const before = await this.prisma.software.findUnique({ where: { id } });
    if (!before) throw notFound('ซอฟต์แวร์');
    const data: Prisma.SoftwareUpdateInput = {};
    if (input.name !== undefined) data.name = input.name.trim();
    for (const k of ['publisher', 'category', 'website', 'notes'] as const) if (k in input) data[k] = clean(input[k]);
    if (input.isActive !== undefined) data.isActive = input.isActive;
    const s = await this.prisma.software.update({ where: { id }, data }).catch((e) => {
      throw this.unique(e, 'มีซอฟต์แวร์ชื่อนี้แล้ว');
    });
    await this.audit.record({ action: 'software.update', resourceType: 'software', resourceId: id, before, after: input }, req);
    return s;
  }

  // -------------------------------------------------------------------------
  // Licences
  // -------------------------------------------------------------------------

  /** List with usage and expiry state + an overview (expiring, expired, computers without antivirus). */
  async licenses(opts: { includeArchived?: boolean }) {
    const today = this.today();
    const rows = await this.prisma.softwareLicense.findMany({
      where: opts.includeArchived ? {} : { archivedAt: null },
      orderBy: [{ software: { name: 'asc' } }, { endDate: 'desc' }, { name: 'asc' }],
      include: {
        software: { select: { id: true, name: true, category: true } },
        vendor: { select: { id: true, name: true } },
        renewedBy: { select: { id: true, name: true } },
        _count: { select: { assignments: { where: { endDate: null } } } },
      },
    });
    const list = rows.map(({ _count, ...l }) => ({
      ...this.licenseDto(l, today),
      used: _count.assignments,
    }));

    // Computers in use with no active seat of any antivirus.
    const covered = await this.prisma.licenseAssignment.findMany({
      where: { endDate: null, assetId: { not: null }, license: { archivedAt: null, software: { category: { not: null } } } },
      select: { assetId: true, license: { select: { endDate: true, software: { select: { category: true } } } } },
    });
    const avAssets = new Set(
      covered.filter((c) => ANTIVIRUS.test(c.license.software.category ?? '') && (!c.license.endDate || toIsoDate(c.license.endDate) >= today)).map((c) => c.assetId!),
    );
    const computers = await this.prisma.asset.findMany({
      where: { status: { in: [AssetStatus.ACTIVE, AssetStatus.IN_REPAIR] }, category: { key: { in: COMPUTERS } } },
      select: { id: true, code: true, category: { select: { name: true } } },
      orderBy: { code: 'asc' },
    });
    return {
      today,
      expiringDays: EXPIRING_DAYS,
      licenses: list,
      overview: {
        expiring: list.filter((l) => l.state === 'EXPIRING' && !l.archivedAt).length,
        expired: list.filter((l) => l.state === 'EXPIRED' && !l.archivedAt && !l.renewedBy).length,
        full: list.filter((l) => l.seats !== null && l.used >= l.seats && l.state !== 'EXPIRED').length,
        withoutAntivirus: computers.filter((c) => !avAssets.has(c.id)).map((c) => ({ code: c.code, category: c.category.name })),
      },
    };
  }

  private licenseDto(
    l: Prisma.SoftwareLicenseGetPayload<{ include: { software: { select: { id: true; name: true; category: true } }; vendor: { select: { id: true; name: true } }; renewedBy: { select: { id: true; name: true } } } }>,
    today: string,
  ) {
    return {
      id: l.id,
      software: l.software,
      name: l.name,
      edition: l.edition,
      type: l.type,
      metric: l.metric,
      seats: l.seats,
      startDate: l.startDate ? toIsoDate(l.startDate) : null,
      endDate: l.endDate ? toIsoDate(l.endDate) : null,
      ...this.stateOf(l.endDate, today),
      autoRenew: l.autoRenew,
      cost: l.cost === null ? null : Number(l.cost),
      vendor: l.vendor,
      reference: l.reference,
      keyHint: l.keyHint,
      attributes: l.attributes as Record<string, string>,
      notes: l.notes,
      renewedFromId: l.renewedFromId,
      renewedBy: l.renewedBy,
      archivedAt: l.archivedAt,
      version: l.version,
    };
  }

  async license(id: string) {
    const today = this.today();
    const l = await this.prisma.softwareLicense.findUnique({
      where: { id },
      include: {
        software: { select: { id: true, name: true, category: true } },
        vendor: { select: { id: true, name: true } },
        renewedBy: { select: { id: true, name: true } },
        renewedFrom: { select: { id: true, name: true } },
        assignments: {
          orderBy: [{ endDate: { sort: 'desc', nulls: 'first' } }, { startDate: 'desc' }],
          include: {
            asset: { select: { code: true, status: true, hostname: true, category: { select: { name: true } }, brand: true, model: true } },
            employee: { select: { id: true, fullName: true, nickname: true } },
            createdBy: { select: { fullName: true } },
          },
        },
      },
    });
    if (!l) throw notFound('ไลเซนส์');
    const { assignments, renewedFrom, ...rest } = l;
    return {
      ...this.licenseDto(rest, today),
      renewedFrom,
      used: assignments.filter((a) => !a.endDate).length,
      seatsList: assignments.map((a) => ({
        id: a.id,
        asset: a.asset ? { code: a.asset.code, status: a.asset.status, category: a.asset.category.name, hostname: a.asset.hostname, model: modelText(a.asset.brand, a.asset.model) } : null,
        employee: a.employee,
        startDate: toIsoDate(a.startDate),
        endDate: a.endDate ? toIsoDate(a.endDate) : null,
        installedOn: a.installedOn ? toIsoDate(a.installedOn) : null,
        seatLabel: a.seatLabel,
        note: a.note,
        createdBy: a.createdBy.fullName,
      })),
    };
  }

  private validateLicense(input: Partial<LicenseInput>) {
    if (input.startDate && input.endDate && input.endDate < input.startDate) throw new DomainError('PERIOD_INVALID', 'วันหมดอายุต้องไม่ก่อนวันเริ่ม', 422);
    if (input.type === LicenseType.SUBSCRIPTION && input.endDate === null) {
      throw new DomainError('END_REQUIRED', 'ไลเซนส์แบบรายปี/สมาชิกต้องมีวันหมดอายุ', 422);
    }
    // Only a short hint — a full product key pasted here would end up in lists, exports and audit logs.
    if (input.keyHint && input.keyHint.replace(/[\s-]/g, '').length > 8) {
      throw new DomainError('KEY_TOO_LONG', 'เก็บเฉพาะท้ายคีย์ไม่เกิน 8 ตัวอักษร — ห้ามบันทึกคีย์เต็ม (ระบุที่เก็บคีย์ในหมายเหตุ)', 422);
    }
  }

  async createLicense(input: LicenseInput, req: AppRequest) {
    this.validateLicense(input);
    if (!(await this.prisma.software.findUnique({ where: { id: input.softwareId } }))) throw notFound('ซอฟต์แวร์');
    const l = await this.prisma.softwareLicense.create({
      data: {
        softwareId: input.softwareId,
        name: input.name.trim(),
        edition: clean(input.edition),
        type: input.type,
        metric: input.metric,
        seats: input.seats ?? null,
        startDate: input.startDate ? toDate(input.startDate) : null,
        endDate: input.endDate ? toDate(input.endDate) : null,
        autoRenew: input.autoRenew ?? false,
        cost: input.cost ?? null,
        vendorId: input.vendorId ?? null,
        reference: clean(input.reference),
        keyHint: clean(input.keyHint),
        attributes: input.attributes ?? {},
        notes: clean(input.notes),
      },
    });
    await this.audit.record({ action: 'license.create', resourceType: 'software_license', resourceId: l.id, after: { ...input, keyHint: input.keyHint ? '[set]' : null } }, req);
    return { id: l.id };
  }

  async updateLicense(id: string, input: Partial<LicenseInput> & { expectedVersion: number }, req: AppRequest) {
    const { expectedVersion, ...fields } = input;
    return this.prisma.$transaction(async (tx) => {
      const before = await tx.softwareLicense.findUnique({ where: { id }, include: { _count: { select: { assignments: { where: { endDate: null } } } } } });
      if (!before) throw notFound('ไลเซนส์');
      if (before.version !== expectedVersion) throw conflict();
      const merged = {
        type: fields.type ?? before.type,
        startDate: fields.startDate !== undefined ? fields.startDate : before.startDate && toIsoDate(before.startDate),
        endDate: fields.endDate !== undefined ? fields.endDate : before.endDate && toIsoDate(before.endDate),
        keyHint: fields.keyHint,
      };
      this.validateLicense(merged);
      const seats = fields.seats !== undefined ? fields.seats : before.seats;
      if (seats !== null && seats < before._count.assignments) {
        throw new DomainError('SEATS_BELOW_USED', `ใช้อยู่ ${before._count.assignments} เครื่อง — ลดจำนวนสิทธิ์ต่ำกว่านี้ไม่ได้ (ปลดเครื่องออกก่อน)`, 422);
      }
      const data: Prisma.SoftwareLicenseUncheckedUpdateInput = { version: { increment: 1 } };
      if (fields.name !== undefined) data.name = fields.name.trim();
      for (const k of ['edition', 'reference', 'keyHint', 'notes'] as const) if (k in fields) data[k] = clean(fields[k]);
      for (const k of ['type', 'metric', 'autoRenew', 'vendorId'] as const) if (fields[k] !== undefined) data[k] = fields[k] as never;
      if (fields.seats !== undefined) data.seats = fields.seats;
      if (fields.cost !== undefined) data.cost = fields.cost;
      if (fields.attributes !== undefined) data.attributes = fields.attributes;
      for (const k of ['startDate', 'endDate'] as const) if (fields[k] !== undefined) data[k] = fields[k] ? toDate(fields[k]!) : null;
      const { count } = await tx.softwareLicense.updateMany({ where: { id, version: expectedVersion }, data: data as Prisma.SoftwareLicenseUncheckedUpdateManyInput });
      if (count === 0) throw conflict();
      await this.audit.record({ action: 'license.update', resourceType: 'software_license', resourceId: id, after: { ...fields, keyHint: fields.keyHint ? '[set]' : fields.keyHint } }, req, tx);
      return { id };
    });
  }

  /** Hide from the list (e.g. an old year). Seats still active are ended the same day. */
  async archiveLicense(id: string, req: AppRequest) {
    return this.prisma.$transaction(async (tx) => {
      const l = await tx.softwareLicense.findUnique({ where: { id } });
      if (!l) throw notFound('ไลเซนส์');
      const today = this.today();
      const ended = await tx.licenseAssignment.updateMany({ where: { licenseId: id, endDate: null }, data: { endDate: toDate(today) } });
      await tx.softwareLicense.update({ where: { id }, data: { archivedAt: new Date(), version: { increment: 1 } } });
      await this.audit.record({ action: 'license.archive', resourceType: 'software_license', resourceId: id, after: { endedSeats: ended.count } }, req, tx);
      return { endedSeats: ended.count };
    });
  }

  // -------------------------------------------------------------------------
  // Seats
  // -------------------------------------------------------------------------

  private async addSeatsTx(tx: Tx, user: AuthUser, licenseId: string, input: SeatInput) {
    const today = this.today();
    const l = await tx.softwareLicense.findUnique({ where: { id: licenseId }, include: { _count: { select: { assignments: { where: { endDate: null } } } } } });
    if (!l || l.archivedAt) throw notFound('ไลเซนส์');
    if (l.endDate && toIsoDate(l.endDate) < today) throw new DomainError('LICENSE_EXPIRED', 'ไลเซนส์หมดอายุแล้ว — ต่ออายุเป็นไลเซนส์ใหม่ก่อนเพิ่มเครื่อง', 422);
    const codes = [...new Set((input.assetCodes ?? []).map((c) => c.trim().toUpperCase()).filter(Boolean))];
    const people = [...new Set(input.employeeIds ?? [])];
    if (!codes.length && !people.length) throw new DomainError('NO_TARGET', 'เลือกเครื่องหรือผู้ใช้อย่างน้อย 1 รายการ', 422);
    if (l.metric === LicenseMetric.PER_USER && codes.length) throw new DomainError('METRIC_MISMATCH', 'ไลเซนส์นี้นับต่อผู้ใช้ — มอบให้พนักงาน ไม่ใช่เครื่อง', 422);
    if (l.metric === LicenseMetric.PER_DEVICE && people.length) throw new DomainError('METRIC_MISMATCH', 'ไลเซนส์นี้นับต่อเครื่อง — มอบให้เครื่อง ไม่ใช่พนักงาน', 422);
    if (l.seats !== null && l._count.assignments + codes.length + people.length > l.seats) {
      throw new DomainError('SEATS_FULL', `สิทธิ์ไม่พอ: ใช้แล้ว ${l._count.assignments}/${l.seats} ต้องการเพิ่ม ${codes.length + people.length}`, HttpStatus.CONFLICT);
    }
    const assets = codes.length ? await tx.asset.findMany({ where: { code: { in: codes } }, select: { id: true, code: true, status: true } }) : [];
    const missing = codes.filter((c) => !assets.some((a) => a.code === c));
    if (missing.length) throw new DomainError('ASSET_NOT_FOUND', `ไม่พบเครื่อง: ${missing.join(', ')}`, 422);
    const gone = assets.filter((a) => a.status === AssetStatus.DISPOSED || a.status === AssetStatus.LOST);
    if (gone.length) throw new DomainError('ASSET_GONE', `เครื่องที่จำหน่าย/สูญหายแล้วรับสิทธิ์ไม่ได้: ${gone.map((a) => a.code).join(', ')}`, 422);
    const startDate = toDate(input.startDate ?? today);
    const common = { licenseId, startDate, installedOn: input.installedOn ? toDate(input.installedOn) : null, note: clean(input.note), createdById: user.id };
    try {
      await tx.licenseAssignment.createMany({
        data: [...assets.map((a) => ({ ...common, assetId: a.id })), ...people.map((employeeId) => ({ ...common, employeeId }))],
      });
    } catch (e) {
      if (e instanceof Prisma.PrismaClientKnownRequestError && e.code === 'P2002') throw new DomainError('ALREADY_ASSIGNED', 'มีเครื่อง/ผู้ใช้ที่ได้รับสิทธิ์นี้อยู่แล้ว', HttpStatus.CONFLICT);
      throw e;
    }
    return { added: assets.length + people.length, codes: assets.map((a) => a.code) };
  }

  async addSeats(user: AuthUser, licenseId: string, input: SeatInput, req: AppRequest) {
    return this.prisma.$transaction(async (tx) => {
      const r = await this.addSeatsTx(tx, user, licenseId, input);
      await this.audit.record({ action: 'license.seat_add', resourceType: 'software_license', resourceId: licenseId, after: { ...input } }, req, tx);
      return r;
    });
  }

  async endSeat(licenseId: string, seatId: string, input: { endDate?: string; note?: string | null }, req: AppRequest) {
    return this.prisma.$transaction(async (tx) => {
      const seat = await tx.licenseAssignment.findFirst({ where: { id: seatId, licenseId } });
      if (!seat) throw notFound('สิทธิ์');
      if (seat.endDate) throw new DomainError('ALREADY_ENDED', 'สิทธิ์นี้ถูกปลดไปแล้ว', 409);
      const endDate = input.endDate ?? this.today();
      if (endDate < toIsoDate(seat.startDate)) throw new DomainError('PERIOD_INVALID', 'วันที่ปลดต้องไม่ก่อนวันที่ได้รับสิทธิ์', 422);
      await tx.licenseAssignment.update({
        where: { id: seatId },
        data: { endDate: toDate(endDate), note: input.note ? [seat.note, `ปลด: ${input.note.trim()}`].filter(Boolean).join(' · ') : seat.note },
      });
      await this.audit.record({ action: 'license.seat_end', resourceType: 'software_license', resourceId: licenseId, after: { seatId, endDate, note: input.note } }, req, tx);
      return { id: seatId };
    });
  }

  /** Next period: a new licence linked to this one; optionally the same machines/people move over. */
  async renew(user: AuthUser, id: string, input: RenewInput, req: AppRequest) {
    return this.prisma.$transaction(async (tx) => {
      const old = await tx.softwareLicense.findUnique({ where: { id }, include: { renewedBy: true, assignments: { where: { endDate: null } } } });
      if (!old) throw notFound('ไลเซนส์');
      if (old.renewedBy) throw new DomainError('ALREADY_RENEWED', `ต่ออายุไปแล้วเป็น “${old.renewedBy.name}”`, 409);
      this.validateLicense({ type: old.type, startDate: input.startDate, endDate: input.endDate ?? null });
      const seats = input.seats === undefined ? old.seats : input.seats;
      if (input.carrySeats && seats !== null && old.assignments.length > seats) {
        throw new DomainError('SEATS_FULL', `มี ${old.assignments.length} เครื่องที่จะย้ายไป แต่สิทธิ์ใหม่มี ${seats}`, HttpStatus.CONFLICT);
      }
      const next = await tx.softwareLicense.create({
        data: {
          softwareId: old.softwareId,
          name: input.name.trim(),
          edition: old.edition,
          type: old.type,
          metric: old.metric,
          seats,
          startDate: toDate(input.startDate),
          endDate: input.endDate ? toDate(input.endDate) : null,
          autoRenew: input.autoRenew ?? old.autoRenew,
          cost: input.cost ?? null,
          vendorId: old.vendorId,
          reference: clean(input.reference),
          attributes: old.attributes as Prisma.InputJsonValue,
          renewedFromId: old.id,
        },
      });
      let moved = 0;
      if (input.carrySeats && old.assignments.length) {
        // Old seats close the day before the new period (history stays on the old licence).
        const closeOn = addDays(input.startDate, -1);
        for (const a of old.assignments) {
          const start = toIsoDate(a.startDate);
          await tx.licenseAssignment.update({ where: { id: a.id }, data: { endDate: toDate(closeOn < start ? start : closeOn) } });
        }
        await tx.licenseAssignment.createMany({
          data: old.assignments.map((a) => ({
            licenseId: next.id,
            assetId: a.assetId,
            employeeId: a.employeeId,
            startDate: toDate(input.startDate),
            installedOn: null,
            seatLabel: a.seatLabel,
            note: 'ย้ายมาจากการต่ออายุ',
            createdById: user.id,
          })),
        });
        moved = old.assignments.length;
      }
      await this.audit.record({ action: 'license.renew', resourceType: 'software_license', resourceId: next.id, after: { from: old.id, ...input, moved } }, req, tx);
      return { id: next.id, moved };
    });
  }

  /** "เครื่องนี้ใช้อะไรอยู่" — seats of one machine, current first. */
  async forAsset(code: string) {
    const asset = await this.prisma.asset.findUnique({ where: { code: code.toUpperCase() }, select: { id: true } });
    if (!asset) throw notFound('อุปกรณ์');
    const today = this.today();
    const seats = await this.prisma.licenseAssignment.findMany({
      where: { assetId: asset.id },
      orderBy: [{ endDate: { sort: 'desc', nulls: 'first' } }, { startDate: 'desc' }],
      include: { license: { include: { software: { select: { id: true, name: true, category: true } } } } },
    });
    return seats.map((s) => ({
      id: s.id,
      licenseId: s.licenseId,
      license: s.license.name,
      software: s.license.software,
      type: s.license.type,
      startDate: toIsoDate(s.startDate),
      endDate: s.endDate ? toIsoDate(s.endDate) : null,
      installedOn: s.installedOn ? toIsoDate(s.installedOn) : null,
      licenseEnd: s.license.endDate ? toIsoDate(s.license.endDate) : null,
      ...this.stateOf(s.license.endDate, today),
      seatLabel: s.seatLabel,
      note: s.note,
    }));
  }

  private unique(e: unknown, message: string) {
    if (e instanceof Prisma.PrismaClientKnownRequestError && e.code === 'P2002') return new DomainError('DUPLICATE', message, 409);
    return e;
  }
}
