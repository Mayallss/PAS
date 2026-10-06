import { HttpStatus, Injectable } from '@nestjs/common';
import { AssetEventType, AssetStatus, AttachmentKind, Prisma, RequestUrgency, ServiceRequestStatus, ServiceRequestType } from '@prisma/client';
import { toDate } from '../../common/dates';
import { DomainError, forbidden, notFound } from '../../common/errors';
import { PrismaService } from '../../common/prisma.service';
import type { AppRequest } from '../../common/request-context';
import { AuditService } from '../audit/audit.service';
import type { AuthUser } from '../auth/auth.types';
import { AssetsService, type EvidenceUpload, stateOf, STATUS_LABEL } from './assets.service';

type Tx = Prisma.TransactionClient;

export const REQUEST_TYPE_LABEL: Record<ServiceRequestType, string> = {
  REPAIR: 'แจ้งซ่อม',
  REPLACEMENT: 'ขอเปลี่ยนเครื่อง',
  UPGRADE: 'ขออัปเกรด',
  SOFTWARE: 'ขอติดตั้ง / แก้ไขโปรแกรม',
  DEVICE: 'ขออุปกรณ์เพิ่ม',
  OTHER: 'คำขออื่น ๆ',
};

/** Requests about the machine you use; the others (software, extra device, other) may stand alone. */
const NEEDS_DEVICE: ServiceRequestType[] = [ServiceRequestType.REPAIR, ServiceRequestType.REPLACEMENT, ServiceRequestType.UPGRADE];
const OPEN: ServiceRequestStatus[] = [ServiceRequestStatus.SUBMITTED, ServiceRequestStatus.IN_PROGRESS];
const FINAL: ServiceRequestStatus[] = [ServiceRequestStatus.RESOLVED, ServiceRequestStatus.REJECTED, ServiceRequestStatus.CANCELLED];

/** Allowed moves for IT. A same-status update is a progress note. */
const TRANSITIONS: Record<ServiceRequestStatus, ServiceRequestStatus[]> = {
  SUBMITTED: [ServiceRequestStatus.IN_PROGRESS, ServiceRequestStatus.RESOLVED, ServiceRequestStatus.REJECTED],
  IN_PROGRESS: [ServiceRequestStatus.RESOLVED, ServiceRequestStatus.REJECTED],
  RESOLVED: [],
  REJECTED: [],
  CANCELLED: [],
};

export interface CreateRequestInput {
  type: ServiceRequestType;
  assetCode?: string | null;
  title: string;
  detail?: string | null;
  urgency?: RequestUrgency;
}

export interface TransitionInput {
  status: ServiceRequestStatus;
  note?: string | null;
  /** With IN_PROGRESS: the device leaves for repair now (history entry REPAIR, state "ส่งซ่อม"). */
  sendToRepair?: boolean;
  vendorId?: string | null;
  underWarranty?: boolean | null;
  /** With RESOLVED: the day the device came back, and what it cost. */
  completedOn?: string | null;
  cost?: number | null;
}

const include = {
  asset: { select: { id: true, code: true, status: true, brand: true, model: true, category: { select: { name: true } }, assignments: { where: { endDate: null }, select: { startDate: true } } } },
  requester: { select: { id: true, fullName: true, nickname: true, employeeCode: true } },
  handler: { select: { fullName: true } },
  repairEvent: { select: { id: true, completedOn: true } },
  updates: { orderBy: { createdAt: 'asc' }, include: { by: { select: { fullName: true } } } },
  attachments: { where: { voidedAt: null }, orderBy: { uploadedAt: 'asc' }, select: { id: true, fileName: true, mimeType: true, sizeBytes: true, uploadedAt: true } },
} satisfies Prisma.ServiceRequestInclude;

type Row = Prisma.ServiceRequestGetPayload<{ include: typeof include }>;

@Injectable()
export class RequestsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
    private readonly assets: AssetsService,
  ) {}

  private view(r: Row) {
    const today = this.assets.today();
    return {
      id: r.id,
      number: r.number,
      type: r.type,
      status: r.status,
      urgency: r.urgency,
      title: r.title,
      detail: r.detail,
      resolution: r.resolution,
      createdAt: r.createdAt,
      updatedAt: r.updatedAt,
      closedAt: r.closedAt,
      requester: r.requester,
      handler: r.handler?.fullName ?? null,
      asset: r.asset
        ? {
            code: r.asset.code,
            model: [r.asset.brand, r.asset.model].filter(Boolean).join(' ') || r.asset.category.name,
            status: r.asset.status,
            state: stateOf(r.asset.status, r.asset.assignments[0], today),
          }
        : null,
      repairOpen: !!r.repairEvent && !r.repairEvent.completedOn,
      updates: r.updates.map((u) => ({ id: u.id, fromStatus: u.fromStatus, toStatus: u.toStatus, note: u.note, by: u.by.fullName, createdAt: u.createdAt })),
      attachments: r.attachments,
    };
  }

  private async load(id: string, tx: Tx = this.prisma) {
    const r = await tx.serviceRequest.findUnique({ where: { id }, include });
    if (!r) throw notFound('คำขอ');
    return r;
  }

  private canSee(user: AuthUser, r: { requesterId: string }) {
    return r.requesterId === user.id || user.permissions.includes('asset.read');
  }

  async mine(user: AuthUser) {
    const rows = await this.prisma.serviceRequest.findMany({ where: { requesterId: user.id }, orderBy: { createdAt: 'desc' }, take: 50, include });
    return rows.map((r) => this.view(r));
  }

  /** IT queue: open first (submitted before in progress), urgent first, oldest first. */
  async queue(scope: 'OPEN' | 'CLOSED' | 'ALL') {
    const where: Prisma.ServiceRequestWhereInput = scope === 'OPEN' ? { status: { in: OPEN } } : scope === 'CLOSED' ? { status: { in: FINAL } } : {};
    const rows = await this.prisma.serviceRequest.findMany({
      where,
      orderBy: scope === 'OPEN' ? [{ status: 'asc' }, { urgency: 'desc' }, { createdAt: 'asc' }] : [{ createdAt: 'desc' }],
      take: 300,
      include,
    });
    return rows.map((r) => this.view(r));
  }

  async get(user: AuthUser, id: string) {
    const r = await this.load(id);
    if (!this.canSee(user, r)) throw notFound('คำขอ');
    return this.view(r);
  }

  async create(user: AuthUser, input: CreateRequestInput, req: AppRequest) {
    const manager = user.permissions.includes('asset.write');
    let asset: { id: string; code: string } | null = null;
    if (input.assetCode) {
      const a = await this.prisma.asset.findUnique({ where: { code: input.assetCode.toUpperCase() }, include: { assignments: { where: { endDate: null } } } });
      if (!a) throw notFound('อุปกรณ์');
      if (!manager && a.assignments[0]?.employeeId !== user.id) throw new DomainError('NOT_YOUR_DEVICE', 'แจ้งได้เฉพาะเครื่องที่คุณถืออยู่', HttpStatus.FORBIDDEN);
      if (a.status === AssetStatus.DISPOSED) throw new DomainError('ASSET_DISPOSED', 'เครื่องนี้จำหน่ายแล้ว', HttpStatus.CONFLICT);
      asset = a;
    } else if (NEEDS_DEVICE.includes(input.type)) {
      // Default to the computer the requester holds (1 person = 1 computer).
      const held = await this.prisma.assetAssignment.findMany({
        where: { employeeId: user.id, endDate: null, asset: { category: { onePerPerson: true } } },
        include: { asset: true },
      });
      if (held.length !== 1) {
        throw new DomainError('DEVICE_REQUIRED', held.length ? 'กรุณาเลือกเครื่องที่ต้องการแจ้ง' : 'ไม่พบเครื่องที่คุณถืออยู่ — แจ้ง IT ให้ลงทะเบียนเครื่องก่อน หรือเลือกประเภท "คำขออื่น ๆ"', HttpStatus.BAD_REQUEST);
      }
      asset = held[0].asset;
    }

    if (asset) {
      const dup = await this.prisma.serviceRequest.findFirst({ where: { assetId: asset.id, type: input.type, status: { in: OPEN } } });
      if (dup) {
        throw new DomainError('DUPLICATE_REQUEST', `มีคำขอ${REQUEST_TYPE_LABEL[input.type]}ของ ${asset.code} ค้างอยู่แล้ว (REQ-${String(dup.number).padStart(4, '0')})`, HttpStatus.CONFLICT, { requestId: dup.id });
      }
    }

    const created = await this.prisma.$transaction(async (tx) => {
      const r = await tx.serviceRequest.create({
        data: {
          type: input.type,
          urgency: input.urgency ?? RequestUrgency.NORMAL,
          assetId: asset?.id ?? null,
          requesterId: user.id,
          title: input.title.trim(),
          detail: input.detail?.trim() || null,
        },
      });
      await tx.serviceRequestUpdate.create({ data: { requestId: r.id, toStatus: ServiceRequestStatus.SUBMITTED, byId: user.id } });
      if (asset) {
        await tx.assetEvent.create({
          data: {
            assetId: asset.id,
            type: AssetEventType.ISSUE,
            occurredOn: toDate(this.assets.today()),
            title: `${REQUEST_TYPE_LABEL[input.type]}: ${r.title}`,
            detail: r.detail,
            employeeId: user.id,
            serviceRequestId: r.id,
            recordedById: user.id,
          },
        });
      }
      await this.audit.record({ action: 'service_request.create', resourceType: 'service_request', resourceId: r.id, after: { ...input, assetId: asset?.id ?? null } }, req, tx);
      return r;
    });
    return this.view(await this.load(created.id));
  }

  async cancel(user: AuthUser, id: string, reason: string | null | undefined, req: AppRequest) {
    return this.prisma.$transaction(async (tx) => {
      const r = await this.load(id, tx);
      if (r.requesterId !== user.id) throw forbidden('ยกเลิกได้เฉพาะคำขอของตนเอง');
      if (r.status !== ServiceRequestStatus.SUBMITTED) throw new DomainError('INVALID_STATUS', 'ยกเลิกได้เฉพาะคำขอที่ IT ยังไม่รับเรื่อง', HttpStatus.CONFLICT);
      await tx.serviceRequest.update({ where: { id }, data: { status: ServiceRequestStatus.CANCELLED, closedAt: new Date() } });
      await tx.serviceRequestUpdate.create({ data: { requestId: id, fromStatus: r.status, toStatus: ServiceRequestStatus.CANCELLED, note: reason?.trim() || null, byId: user.id } });
      await this.audit.record({ action: 'service_request.cancel', resourceType: 'service_request', resourceId: id, after: { reason } }, req, tx);
      return this.view(await this.load(id, tx));
    });
  }

  /** IT moves a request forward, optionally sending the device to repair and closing that repair on resolve. */
  async transition(user: AuthUser, id: string, input: TransitionInput, req: AppRequest) {
    return this.prisma.$transaction(async (tx) => {
      const r = await this.load(id, tx);
      const note = input.note?.trim() || null;
      const sameStatus = input.status === r.status;
      if (sameStatus) {
        if (FINAL.includes(r.status)) throw new DomainError('CLOSED', 'คำขอนี้ปิดแล้ว', HttpStatus.CONFLICT);
        if (!note && !input.sendToRepair) throw new DomainError('VALIDATION_FAILED', 'ต้องระบุข้อความอัปเดต', 400);
      } else if (!TRANSITIONS[r.status].includes(input.status)) {
        throw new DomainError('INVALID_TRANSITION', 'เปลี่ยนสถานะคำขอแบบนี้ไม่ได้', HttpStatus.CONFLICT);
      }
      if (input.status === ServiceRequestStatus.REJECTED && !note) throw new DomainError('VALIDATION_FAILED', 'ต้องระบุเหตุผลที่ไม่อนุมัติ', 400);

      const data: Prisma.ServiceRequestUncheckedUpdateInput = { status: input.status, handlerId: r.handlerId ?? user.id };
      const today = this.assets.today();

      if (input.sendToRepair) {
        if (input.status !== ServiceRequestStatus.IN_PROGRESS) throw new DomainError('VALIDATION_FAILED', 'ส่งซ่อมได้เมื่อสถานะเป็น "กำลังดำเนินการ"', 400);
        if (!r.asset) throw new DomainError('VALIDATION_FAILED', 'คำขอนี้ไม่ได้ระบุเครื่อง', 400);
        if (r.repairEvent && !r.repairEvent.completedOn) throw new DomainError('ALREADY_IN_REPAIR', 'เครื่องถูกส่งซ่อมจากคำขอนี้อยู่แล้ว', HttpStatus.CONFLICT);
        if (r.asset.status !== AssetStatus.ACTIVE && r.asset.status !== AssetStatus.BROKEN) {
          throw new DomainError('INVALID_STATUS', `ส่งซ่อมไม่ได้: สถานะเครื่อง "${STATUS_LABEL[r.asset.status]}"`, HttpStatus.CONFLICT);
        }
        await tx.asset.update({ where: { id: r.asset.id }, data: { status: AssetStatus.IN_REPAIR, version: { increment: 1 } } });
        const ev = await tx.assetEvent.create({
          data: {
            assetId: r.asset.id,
            type: AssetEventType.REPAIR,
            occurredOn: toDate(today),
            title: r.title,
            detail: note,
            fromStatus: r.asset.status,
            toStatus: AssetStatus.IN_REPAIR,
            vendorId: input.vendorId ?? null,
            underWarranty: input.underWarranty ?? null,
            employeeId: r.requesterId,
            serviceRequestId: r.id,
            recordedById: user.id,
          },
        });
        data.repairEventId = ev.id;
      }

      if (input.status === ServiceRequestStatus.RESOLVED && r.repairEvent && !r.repairEvent.completedOn && r.asset) {
        const asset = await tx.asset.findUniqueOrThrow({ where: { id: r.asset.id } });
        await this.assets.closeRepair(user, asset, r.repairEvent.id, { completedOn: input.completedOn ?? today, cost: input.cost ?? null, detail: note }, tx);
      }
      if (input.status === ServiceRequestStatus.REJECTED && r.repairEvent && !r.repairEvent.completedOn) {
        throw new DomainError('REPAIR_OPEN', 'เครื่องยังอยู่ระหว่างซ่อม — รับเครื่องคืนก่อน หรือปิดคำขอเป็น "เสร็จแล้ว"', HttpStatus.CONFLICT);
      }
      if (FINAL.includes(input.status)) {
        data.closedAt = new Date();
        data.resolution = note;
      }
      await tx.serviceRequest.update({ where: { id }, data });
      await tx.serviceRequestUpdate.create({
        data: {
          requestId: id,
          fromStatus: sameStatus ? null : r.status,
          toStatus: input.status,
          note: input.sendToRepair ? [note, 'ส่งเครื่องซ่อม'].filter(Boolean).join(' — ') : note,
          byId: user.id,
        },
      });
      await this.audit.record({ action: 'service_request.update', resourceType: 'service_request', resourceId: id, before: { status: r.status }, after: input }, req, tx);
      return this.view(await this.load(id, tx));
    });
  }

  // -------------------------------------------------------------------------
  // Photos / files sent with a request
  // -------------------------------------------------------------------------

  async attach(user: AuthUser, id: string, file: EvidenceUpload | undefined, req: AppRequest) {
    const r = await this.load(id);
    const manager = user.permissions.includes('asset.write');
    if (r.requesterId !== user.id && !manager) throw notFound('คำขอ');
    if (!manager && FINAL.includes(r.status)) throw new DomainError('CLOSED', 'คำขอนี้ปิดแล้ว', HttpStatus.CONFLICT);
    const stored = await this.assets.storeEvidence(file);
    const row = await this.prisma.$transaction(async (tx) => {
      const created = await tx.attachment.create({
        data: { ...stored, serviceRequestId: r.id, assetId: r.asset?.id ?? null, kind: AttachmentKind.PHOTO, uploadedById: user.id },
      });
      await this.audit.record({ action: 'service_request.attach', resourceType: 'service_request', resourceId: r.id, after: { attachmentId: created.id, fileName: stored.fileName, sha256: stored.sha256 } }, req, tx);
      return created;
    });
    return { id: row.id, fileName: row.fileName, mimeType: row.mimeType, sizeBytes: row.sizeBytes };
  }

  async file(user: AuthUser, id: string, fileId: string) {
    const r = await this.prisma.serviceRequest.findUnique({ where: { id }, select: { requesterId: true } });
    if (!r || !this.canSee(user, r)) throw notFound('ไฟล์');
    const row = await this.prisma.attachment.findFirst({ where: { id: fileId, serviceRequestId: id } });
    if (!row) throw notFound('ไฟล์');
    return { row, data: await this.assets.readFile(row.storageKey) };
  }

  /** Count for the IT bell. */
  async waiting() {
    return this.prisma.serviceRequest.count({ where: { status: ServiceRequestStatus.SUBMITTED } });
  }
}
