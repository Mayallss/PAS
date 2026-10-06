import { HttpStatus, Injectable } from '@nestjs/common';
import { CertificationStatus, EmploymentStatus, MeetingCertification } from '@prisma/client';
import { loadConfig } from '../../config';
import { addDays, toDate, toIsoDate, todayIn } from '../../common/dates';
import { DomainError, forbidden, notFound } from '../../common/errors';
import { PrismaService } from '../../common/prisma.service';
import type { AppRequest } from '../../common/request-context';
import { AuditService } from '../audit/audit.service';
import type { AuthUser } from '../auth/auth.types';
import { diffHtml, htmlToText, normalize, sanitizeRichText } from './html';

/**
 * Per-person state for the CURRENT meeting minutes:
 *  PENDING           never certified
 *  OUTDATED          certified an older version; the minutes changed in a way that requires re-certification
 *  ACCEPTED          "รายงานถูกต้อง" on a version that is still valid
 *  OBJECTION         "ไม่ถูกต้อง" — waiting for the author (new version or reply)
 *  OBJECTION_REPLIED author replied without changing the minutes — the objector should accept or object again
 */
export type PersonStatus = 'PENDING' | 'OUTDATED' | 'ACCEPTED' | 'OBJECTION' | 'OBJECTION_REPLIED';

export interface MeetingInput {
  title: string;
  meetingDate: string;
  startTime?: string | null;
  endTime?: string | null;
  location?: string | null;
  bodyHtml: string;
}

export interface RevisionInput extends MeetingInput {
  expectedVersion: number;
  changeNote?: string | null;
  requiresRecertification: boolean;
}

/** Only recent meetings create reminders (legacy reminded about the latest monthly meeting). */
const REMINDER_WINDOW_DAYS = 120;

export function personStatus(cert: Pick<MeetingCertification, 'version' | 'status' | 'reply'> | undefined, certifyFromVersion: number): PersonStatus {
  if (!cert) return 'PENDING';
  if (cert.version < certifyFromVersion) return 'OUTDATED';
  if (cert.status === CertificationStatus.OBJECTION) return cert.reply ? 'OBJECTION_REPLIED' : 'OBJECTION';
  return 'ACCEPTED';
}

const NEEDS_ACTION: PersonStatus[] = ['PENDING', 'OUTDATED', 'OBJECTION_REPLIED'];

@Injectable()
export class MeetingsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
  ) {}

  private isWriter(user: AuthUser) {
    return user.permissions.includes('meeting.write');
  }

  /** People who must certify: active, employed on the meeting date (legacy rule), and not the author. */
  private async audience(meetings: { id: string; meetingDate: Date; authorId: string }[]) {
    const people = await this.prisma.employee.findMany({
      where: { status: EmploymentStatus.ACTIVE },
      select: { id: true, fullName: true, startDate: true, orgUnit: { select: { name: true } } },
      orderBy: { fullName: 'asc' },
    });
    return new Map(meetings.map((m) => [m.id, people.filter((p) => p.id !== m.authorId && (!p.startDate || p.startDate <= m.meetingDate))]));
  }

  /** Latest certification per (meeting, person). */
  private latestBy(certs: MeetingCertification[]) {
    const map = new Map<string, MeetingCertification>();
    for (const c of certs) {
      const k = `${c.meetingId}|${c.employeeId}`;
      const prev = map.get(k);
      if (!prev || c.version > prev.version) map.set(k, c);
    }
    return map;
  }

  async list(user: AuthUser, limit: number) {
    const meetings = await this.prisma.meeting.findMany({
      orderBy: [{ meetingDate: 'desc' }, { createdAt: 'desc' }],
      take: limit,
      select: { id: true, title: true, meetingDate: true, startTime: true, endTime: true, location: true, version: true, certifyFromVersion: true, authorId: true, author: { select: { fullName: true } }, updatedAt: true },
    });
    const ids = meetings.map((m) => m.id);
    const writer = this.isWriter(user);
    const [audience, certs] = await Promise.all([
      this.audience(meetings),
      this.prisma.meetingCertification.findMany({ where: { meetingId: { in: ids }, ...(writer ? {} : { employeeId: user.id }) } }),
    ]);
    const latest = this.latestBy(certs);
    return meetings.map(({ authorId, author, ...m }) => {
      const people = audience.get(m.id)!;
      const mine = people.some((p) => p.id === user.id) ? personStatus(latest.get(`${m.id}|${user.id}`), m.certifyFromVersion) : null;
      const base = { ...m, meetingDate: toIsoDate(m.meetingDate), author: author.fullName, isAuthor: authorId === user.id, myStatus: mine };
      if (!writer) return base;
      const counts = { ACCEPTED: 0, OBJECTION: 0, pending: 0 };
      for (const p of people) {
        const s = personStatus(latest.get(`${m.id}|${p.id}`), m.certifyFromVersion);
        if (s === 'ACCEPTED') counts.ACCEPTED++;
        else if (s === 'OBJECTION') counts.OBJECTION++;
        else counts.pending++;
      }
      return { ...base, counts: { accepted: counts.ACCEPTED, objections: counts.OBJECTION, pending: counts.pending, audience: people.length } };
    });
  }

  async detail(user: AuthUser, id: string, compareFrom?: number) {
    const meeting = await this.prisma.meeting.findUnique({
      where: { id },
      include: {
        author: { select: { fullName: true } },
        revisions: { orderBy: { version: 'desc' }, include: { author: { select: { fullName: true } } } },
      },
    });
    if (!meeting) throw notFound('รายงานการประชุม');
    const writer = this.isWriter(user);
    const [audience, certs] = await Promise.all([
      this.audience([meeting]),
      this.prisma.meetingCertification.findMany({
        where: { meetingId: id, ...(writer ? {} : { employeeId: user.id }) },
        include: { employee: { select: { fullName: true } }, repliedBy: { select: { fullName: true } } },
        orderBy: { createdAt: 'desc' },
      }),
    ]);
    const people = audience.get(id)!;
    const latest = this.latestBy(certs);
    const inAudience = people.some((p) => p.id === user.id);
    const myLatest = latest.get(`${id}|${user.id}`);
    const myStatus = inAudience ? personStatus(myLatest, meeting.certifyFromVersion) : null;

    // Highlight changes against the version this person last certified (or an explicitly requested version).
    const baseVersion = compareFrom ?? (myLatest && myLatest.version < meeting.version ? myLatest.version : undefined);
    let diff: { from: number; to: number; html: string; added: number; removed: number } | null = null;
    if (baseVersion && baseVersion < meeting.version) {
      const base = meeting.revisions.find((r) => r.version === baseVersion);
      if (!base) throw new DomainError('VALIDATION_FAILED', 'ไม่พบฉบับที่ต้องการเปรียบเทียบ', 400);
      diff = { from: baseVersion, to: meeting.version, ...diffHtml(base.bodyHtml, meeting.bodyHtml) };
    }

    const certView = (c: (typeof certs)[number]) => ({
      employeeId: c.employeeId,
      employee: c.employee.fullName,
      version: c.version,
      status: c.status,
      quote: c.quote,
      note: c.note,
      reply: c.reply,
      repliedAt: c.repliedAt,
      repliedBy: c.repliedBy?.fullName ?? null,
      at: c.updatedAt,
    });

    return {
      id: meeting.id,
      title: meeting.title,
      meetingDate: toIsoDate(meeting.meetingDate),
      startTime: meeting.startTime,
      endTime: meeting.endTime,
      location: meeting.location,
      // Sanitised again on output: legacy-imported content never reaches the browser unfiltered.
      bodyHtml: sanitizeRichText(meeting.bodyHtml),
      version: meeting.version,
      certifyFromVersion: meeting.certifyFromVersion,
      author: meeting.author.fullName,
      isAuthor: meeting.authorId === user.id,
      updatedAt: meeting.updatedAt,
      revisions: meeting.revisions.map((r) => ({ version: r.version, title: r.title, changeNote: r.changeNote, requiresRecertification: r.requiresRecertification, author: r.author.fullName, createdAt: r.createdAt })),
      myStatus,
      myHistory: certs.filter((c) => c.employeeId === user.id).map(certView),
      diff,
      ...(writer
        ? {
            roster: people.map((p) => {
              const c = latest.get(`${id}|${p.id}`);
              return { employeeId: p.id, fullName: p.fullName, orgUnit: p.orgUnit?.name ?? null, status: personStatus(c, meeting.certifyFromVersion), version: c?.version ?? null, at: c?.updatedAt ?? null };
            }),
            objections: certs.filter((c) => c.status === CertificationStatus.OBJECTION).map(certView),
          }
        : {}),
    };
  }

  private cleanInput(input: MeetingInput) {
    const bodyHtml = sanitizeRichText(input.bodyHtml);
    if (!htmlToText(bodyHtml)) throw new DomainError('VALIDATION_FAILED', 'กรุณาใส่เนื้อหารายงานการประชุม', 400);
    return {
      title: input.title.trim(),
      meetingDate: toDate(input.meetingDate),
      startTime: input.startTime || null,
      endTime: input.endTime || null,
      location: input.location?.trim() || null,
      bodyHtml,
    };
  }

  async create(user: AuthUser, input: MeetingInput, req: AppRequest) {
    const data = this.cleanInput(input);
    return this.prisma.$transaction(async (tx) => {
      const m = await tx.meeting.create({ data: { ...data, authorId: user.id } });
      await tx.meetingRevision.create({ data: { meetingId: m.id, version: 1, title: data.title, bodyHtml: data.bodyHtml, authorId: user.id, requiresRecertification: true } });
      await this.audit.record({ action: 'meeting.create', resourceType: 'meeting', resourceId: m.id, after: { title: data.title, meetingDate: input.meetingDate } }, req, tx);
      return { id: m.id, version: 1 };
    });
  }

  /** Publishes a new version. Substantive changes (default) require everyone to certify again. */
  async revise(user: AuthUser, id: string, input: RevisionInput, req: AppRequest) {
    const data = this.cleanInput(input);
    return this.prisma.$transaction(async (tx) => {
      const before = await tx.meeting.findUnique({ where: { id } });
      if (!before) throw notFound('รายงานการประชุม');
      if (before.version !== input.expectedVersion) {
        throw new DomainError('VERSION_CONFLICT', `รายงานถูกแก้ไขเป็นฉบับที่ ${before.version} แล้ว กรุณาโหลดใหม่`, HttpStatus.CONFLICT);
      }
      const contentChanged = before.bodyHtml !== data.bodyHtml || before.title !== data.title;
      const metaChanged =
        toIsoDate(before.meetingDate) !== input.meetingDate || before.startTime !== data.startTime || before.endTime !== data.endTime || before.location !== data.location;
      if (!contentChanged && !metaChanged) throw new DomainError('NO_CHANGES', 'ไม่มีการเปลี่ยนแปลง', 422);
      if (input.requiresRecertification && !input.changeNote?.trim()) {
        throw new DomainError('VALIDATION_FAILED', 'กรุณาระบุว่าแก้ไขอะไร เพื่อให้ผู้รับรองตรวจได้ง่าย', 400);
      }
      const version = before.version + 1;
      const { count } = await tx.meeting.updateMany({
        where: { id, version: before.version },
        data: { ...data, version, ...(input.requiresRecertification ? { certifyFromVersion: version } : {}) },
      });
      if (count === 0) throw new DomainError('VERSION_CONFLICT', 'รายงานถูกแก้ไขพร้อมกัน กรุณาโหลดใหม่', HttpStatus.CONFLICT);
      await tx.meetingRevision.create({
        data: { meetingId: id, version, title: data.title, bodyHtml: data.bodyHtml, changeNote: input.changeNote?.trim() || null, requiresRecertification: input.requiresRecertification, authorId: user.id },
      });
      await this.audit.record(
        {
          action: 'meeting.revise',
          resourceType: 'meeting',
          resourceId: id,
          before: { version: before.version, title: before.title },
          after: { version, title: data.title, changeNote: input.changeNote, requiresRecertification: input.requiresRecertification },
        },
        req,
        tx,
      );
      return { id, version };
    });
  }

  async remove(id: string, req: AppRequest) {
    await this.prisma.$transaction(async (tx) => {
      const m = await tx.meeting.findUnique({ where: { id }, include: { _count: { select: { certifications: true } } } });
      if (!m) throw notFound('รายงานการประชุม');
      // Certifications are evidence — once anyone has certified, the minutes can only be revised, not deleted.
      if (m._count.certifications > 0) throw new DomainError('IN_USE', 'มีผู้รับรองรายงานนี้แล้ว ลบไม่ได้ — ใช้การแก้ไขเป็นฉบับใหม่แทน', HttpStatus.CONFLICT);
      await tx.meeting.delete({ where: { id } });
      await this.audit.record({ action: 'meeting.delete', resourceType: 'meeting', resourceId: id, before: { title: m.title, version: m.version } }, req, tx);
    });
  }

  async certify(user: AuthUser, id: string, input: { version: number; status: CertificationStatus; quote?: string | null; note?: string | null }, req: AppRequest) {
    const meeting = await this.prisma.meeting.findUnique({ where: { id } });
    if (!meeting) throw notFound('รายงานการประชุม');
    if (meeting.authorId === user.id) throw forbidden('ผู้บันทึกรายงานไม่ต้องรับรองรายงานของตนเอง');
    const eligible = (await this.audience([meeting])).get(id)!.some((p) => p.id === user.id);
    if (!eligible) throw forbidden('คุณไม่อยู่ในรายชื่อผู้ต้องรับรองรายงานนี้');
    if (input.version !== meeting.version) {
      throw new DomainError('VERSION_CONFLICT', `รายงานถูกแก้ไขเป็นฉบับที่ ${meeting.version} แล้ว — กรุณาอ่านฉบับล่าสุดก่อนรับรอง`, HttpStatus.CONFLICT, { version: meeting.version });
    }
    let quote: string | null = null;
    let note: string | null = null;
    if (input.status === CertificationStatus.OBJECTION) {
      quote = normalize(input.quote ?? '');
      note = input.note?.trim() ?? '';
      if (!quote || !note) throw new DomainError('VALIDATION_FAILED', 'กรุณาเลือกข้อความที่ไม่ถูกต้อง และระบุว่าควรแก้เป็นอะไร', 400);
      // The objection must point at text that really exists in this version.
      if (!htmlToText(meeting.bodyHtml).includes(quote)) {
        throw new DomainError('QUOTE_NOT_FOUND', 'ไม่พบข้อความที่อ้างถึงในรายงานฉบับนี้', HttpStatus.UNPROCESSABLE_ENTITY);
      }
    }
    const key = { meetingId_employeeId_version: { meetingId: id, employeeId: user.id, version: meeting.version } };
    const before = await this.prisma.meetingCertification.findUnique({ where: key });
    const saved = await this.prisma.meetingCertification.upsert({
      where: key,
      // Changing your answer clears any earlier reply (it answered the previous objection).
      update: { status: input.status, quote, note, reply: null, repliedAt: null, repliedById: null },
      create: { meetingId: id, employeeId: user.id, version: meeting.version, status: input.status, quote, note },
    });
    await this.audit.record(
      {
        action: input.status === CertificationStatus.OBJECTION ? 'meeting.object' : 'meeting.certify',
        resourceType: 'meeting',
        resourceId: id,
        before: before ? { status: before.status, quote: before.quote, note: before.note } : null,
        after: { version: meeting.version, status: input.status, quote, note },
      },
      req,
    );
    return { status: personStatus(saved, meeting.certifyFromVersion), version: saved.version };
  }

  /** Author answers an objection without (or before) publishing a new version. */
  async reply(user: AuthUser, id: string, employeeId: string, input: { version: number; reply: string }, req: AppRequest) {
    const key = { meetingId_employeeId_version: { meetingId: id, employeeId, version: input.version } };
    const cert = await this.prisma.meetingCertification.findUnique({ where: key });
    if (!cert || cert.status !== CertificationStatus.OBJECTION) throw notFound('ข้อโต้แย้ง');
    const saved = await this.prisma.meetingCertification.update({
      where: key,
      data: { reply: input.reply.trim(), repliedAt: new Date(), repliedById: user.id },
    });
    await this.audit.record({ action: 'meeting.reply', resourceType: 'meeting', resourceId: id, metadata: { employeeId, version: input.version }, after: { reply: saved.reply } }, req);
    return { ok: true };
  }

  /** Notification items: minutes waiting for me, and (for writers) objections waiting for an answer. */
  async attention(user: AuthUser) {
    const since = toDate(addDays(todayIn(loadConfig().TZ_BUSINESS), -REMINDER_WINDOW_DAYS));
    const meetings = await this.prisma.meeting.findMany({
      where: { meetingDate: { gte: since } },
      orderBy: { meetingDate: 'desc' },
      select: { id: true, title: true, meetingDate: true, version: true, certifyFromVersion: true, authorId: true },
    });
    if (!meetings.length) return [];
    const writer = this.isWriter(user);
    const [audience, certs] = await Promise.all([
      this.audience(meetings),
      this.prisma.meetingCertification.findMany({ where: { meetingId: { in: meetings.map((m) => m.id) }, ...(writer ? {} : { employeeId: user.id }) } }),
    ]);
    const latest = this.latestBy(certs);
    const items: (
      | { kind: 'MEETING_CERTIFY'; id: string; meetingId: string; title: string; reason: 'NEW' | 'REVISED' | 'REPLIED'; version: number; href: string }
      | { kind: 'MEETING_OBJECTIONS'; id: string; meetingId: string; title: string; count: number; href: string }
    )[] = [];
    for (const m of meetings) {
      const people = audience.get(m.id)!;
      if (people.some((p) => p.id === user.id)) {
        const s = personStatus(latest.get(`${m.id}|${user.id}`), m.certifyFromVersion);
        if (NEEDS_ACTION.includes(s)) {
          items.push({
            kind: 'MEETING_CERTIFY',
            id: `meeting-${m.id}-v${m.version}`,
            meetingId: m.id,
            title: m.title,
            reason: s === 'OUTDATED' ? 'REVISED' : s === 'OBJECTION_REPLIED' ? 'REPLIED' : 'NEW',
            version: m.version,
            href: `/meetings/${m.id}`,
          });
        }
      }
      if (writer) {
        const open = people.filter((p) => personStatus(latest.get(`${m.id}|${p.id}`), m.certifyFromVersion) === 'OBJECTION').length;
        if (open) items.push({ kind: 'MEETING_OBJECTIONS', id: `objections-${m.id}-v${m.version}`, meetingId: m.id, title: m.title, count: open, href: `/meetings/${m.id}#objections` });
      }
    }
    return items;
  }
}

export type MeetingAttention = Awaited<ReturnType<MeetingsService['attention']>>[number];
