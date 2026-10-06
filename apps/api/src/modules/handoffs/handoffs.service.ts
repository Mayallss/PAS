import { createHmac, timingSafeEqual } from 'node:crypto';
import { Injectable } from '@nestjs/common';
import { loadConfig } from '../../config';
import { DomainError } from '../../common/errors';
import type { AppRequest } from '../../common/request-context';
import { AuditService } from '../audit/audit.service';
import type { AuthUser } from '../auth/auth.types';
import { col, COLUMNS, MondayClient, normalize, type Outcome, OUTCOMES, parseJson, thaiTimestamp } from './monday.client';

/** Save tokens and share links last one hour from opening the ticket (DELIPAS behaviour). */
export const TOKEN_TTL_MS = 3_600_000;
/** One monday round trip serves every tab; a short TTL keeps a status saved elsewhere from lingering. */
const LIST_TTL_MS = 30_000;
const PNG_PREFIX = 'data:image/png;base64,';
const MAX_PNG_BYTES = 1_100_000;

interface Snapshot {
  kind: 'save' | 'share';
  itemId: string;
  statusValue: string;
  updatedAt: string;
  exp: number;
  /** Who created the share link (audit). */
  by?: string;
}

export interface SaveInput {
  itemId: string;
  outcome: Outcome;
  name: string;
  /** PNG data URL of the signature. */
  signature: string;
  /** Client-generated UUID: a retried save is recognised and not applied twice. */
  requestId: string;
  context: string;
}

@Injectable()
export class HandoffsService {
  private cache: { at: number; body: Awaited<ReturnType<MondayClient['listGroups']>> } | null = null;
  private inflight: Promise<Awaited<ReturnType<MondayClient['listGroups']>>> | null = null;

  constructor(private readonly audit: AuditService) {}

  private client() {
    const c = loadConfig();
    if (!c.MONDAY_API_TOKEN) throw new DomainError('NOT_CONFIGURED', 'ยังไม่ได้ตั้งค่าการเชื่อมต่อ monday (MONDAY_API_TOKEN)', 503);
    return new MondayClient(c.MONDAY_API_TOKEN, c.MONDAY_HANDOFF_BOARD_ID);
  }

  private secret() {
    const s = loadConfig().HANDOFF_LINK_SECRET;
    if (!s || s.length < 32) throw new DomainError('NOT_CONFIGURED', 'ยังไม่ได้ตั้งค่า HANDOFF_LINK_SECRET', 503);
    return s;
  }

  // -------------------------------------------------------------------------
  // Signed tokens (HMAC-SHA256, base64url) — opaque to the browser
  // -------------------------------------------------------------------------

  sign(data: Snapshot): string {
    const payload = Buffer.from(JSON.stringify(data)).toString('base64url');
    const mac = createHmac('sha256', this.secret()).update(payload).digest('base64url');
    return `${payload}.${mac}`;
  }

  verify(token: string, kinds: Snapshot['kind'][]): Snapshot {
    const expired = new DomainError('TOKEN_EXPIRED', 'ข้อมูลหมดอายุหรือลิงก์ไม่ถูกต้อง กรุณาเปิดรายการใหม่', 409);
    const [payload, mac, ...rest] = (token ?? '').split('.');
    if (!payload || !mac || rest.length) throw expired;
    const expected = createHmac('sha256', this.secret()).update(payload).digest();
    const given = Buffer.from(mac, 'base64url');
    if (given.length !== expected.length || !timingSafeEqual(given, expected)) throw expired;
    const data = parseJson<Snapshot>(Buffer.from(payload, 'base64url').toString());
    if (!data || !kinds.includes(data.kind) || !Number.isFinite(data.exp) || data.exp < Date.now()) throw expired;
    return data;
  }

  // -------------------------------------------------------------------------
  // Reads
  // -------------------------------------------------------------------------

  async list(fresh: boolean) {
    if (!fresh && this.cache && Date.now() - this.cache.at < LIST_TTL_MS) return this.cache.body;
    if (!fresh && this.inflight) return this.inflight;
    const work = this.client()
      .listGroups()
      .then((body) => {
        this.cache = { at: Date.now(), body };
        return body;
      })
      .finally(() => {
        this.inflight = null;
      });
    this.inflight = work;
    return work;
  }

  /** Ticket details + a save token bound to what was seen (status and last update). */
  async detail(itemId: string) {
    const { item, labels } = await this.client().item(itemId);
    const it = normalize(item, labels);
    return { item: it, context: this.sign({ kind: 'save', itemId, statusValue: it.statusValue, updatedAt: it.updatedAt, exp: Date.now() + TOKEN_TTL_MS }) };
  }

  /** A link the signer can open on their own phone without logging in. Valid one hour; audited. */
  async share(user: AuthUser, itemId: string, req: AppRequest) {
    const { item, labels } = await this.client().item(itemId);
    const it = normalize(item, labels);
    const exp = Date.now() + TOKEN_TTL_MS;
    const token = this.sign({ kind: 'share', itemId, statusValue: it.statusValue, updatedAt: it.updatedAt, exp, by: user.id });
    await this.audit.record({ action: 'handoff.share_link', resourceType: 'monday_item', resourceId: itemId, after: { customer: it.customer, expiresAt: new Date(exp).toISOString() } }, req);
    const origin = loadConfig().APP_ORIGIN.replace(/\/+$/, '');
    return { url: `${origin}/sign?item=${encodeURIComponent(itemId)}&share=${encodeURIComponent(token)}`, expiresAt: new Date(exp).toISOString() };
  }

  /** Public: what the share-link holder may see — only that one ticket. */
  async publicDetail(itemId: string, share: string) {
    const snap = this.verify(share, ['share']);
    if (snap.itemId !== itemId) throw new DomainError('LINK_MISMATCH', 'ลิงก์นี้ไม่ตรงกับรายการเอกสาร', 403);
    const { item, labels } = await this.client().item(itemId);
    return { item: normalize(item, labels), context: share, expiresAt: new Date(snap.exp).toISOString() };
  }

  // -------------------------------------------------------------------------
  // Save (DELIPAS saveHandoff)
  // -------------------------------------------------------------------------

  /**
   * Upload the signature as evidence, then set status + signer + Thai time in one mutation.
   * Refuses if the ticket changed in monday since it was opened; a retried request (same requestId)
   * that already went through is answered "replayed" instead of uploading a second file.
   */
  async save(input: SaveInput, actor: { user?: AuthUser; viaLink: boolean }, req: AppRequest) {
    const snap = this.verify(input.context, actor.viaLink ? ['share'] : ['save', 'share']);
    if (snap.itemId !== input.itemId) throw new DomainError('CONTEXT_MISMATCH', 'ข้อมูลยืนยันไม่ตรงกับรายการ', 403);
    if (!input.signature.startsWith(`${PNG_PREFIX}iVBORw0KGgo`)) throw new DomainError('BAD_SIGNATURE', 'รูปแบบลายเซ็นไม่ถูกต้อง', 400);
    const png = Buffer.from(input.signature.slice(PNG_PREFIX.length), 'base64');
    if (png.length > MAX_PNG_BYTES) throw new DomainError('SIGNATURE_TOO_LARGE', 'ไฟล์ลายเซ็นใหญ่เกินไป', 413);
    const name = input.name.trim();

    const api = this.client();
    const { item } = await api.item(input.itemId);
    const files = parseJson<{ files?: { name?: string }[] }>(col(item, COLUMNS.files)?.value)?.files ?? [];
    const prefix = `handoff-${input.itemId}-${input.requestId}-${input.outcome}-`;
    const already = files.some((f) => f.name?.startsWith(prefix));
    const current = col(item, COLUMNS.status);
    if (already && current?.text === OUTCOMES[input.outcome]) return { ok: true, replayed: true, status: current.text };
    if ((current?.value || '') !== snap.statusValue || (!already && item.updated_at !== snap.updatedAt)) {
      throw new DomainError('CHANGED_IN_MONDAY', 'รายการมีการแก้ไขใน monday กรุณาเปิดตรวจสอบใหม่ก่อนบันทึก', 409);
    }
    if (!already) await api.upload(input.itemId, png, `${prefix}${encodeURIComponent(name).slice(0, 150)}.png`, `${prefix}upload`);
    // Re-read after upload so a status changed meanwhile in monday is not blindly overwritten.
    const fresh = await api.item(input.itemId);
    if ((col(fresh.item, COLUMNS.status)?.value || '') !== snap.statusValue) {
      throw new DomainError('CHANGED_DURING_SAVE', 'เก็บหลักฐานแล้ว แต่สถานะเปลี่ยนระหว่างบันทึก กรุณาตรวจสอบใน monday', 409);
    }
    const signedAt = thaiTimestamp();
    await api.saveResult(input.itemId, input.outcome, name, signedAt, `${prefix}status`);
    this.cache = null;
    await this.audit.record(
      {
        action: actor.viaLink ? 'handoff.save_via_link' : 'handoff.save',
        resourceType: 'monday_item',
        resourceId: input.itemId,
        after: { outcome: OUTCOMES[input.outcome], signer: name, signedAt, requestId: input.requestId, linkCreatedBy: snap.kind === 'share' ? snap.by : undefined },
      },
      req,
    );
    return { ok: true, replayed: false, status: OUTCOMES[input.outcome] };
  }
}
