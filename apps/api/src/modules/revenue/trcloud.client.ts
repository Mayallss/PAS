import { HttpStatus, Injectable, Logger } from '@nestjs/common';
import { createHash } from 'node:crypto';
import { loadConfig } from '../../config';
import { DomainError } from '../../common/errors';

/**
 * TRCLOUD RESTFUL API (คู่มือการใช้งาน API — TRCLOUD):
 *  - every call is POST {base}/application/api-connector2/end-point/{group}/{command}.php
 *  - body is multipart/form-data with ONE field `json` (a JSON string)
 *  - the JSON always carries company_id, passkey, timestamp, securekey = md5(encryptHead + "t" + timestamp)
 *  - the Origin header must equal the API key's Origin (or the key is ANY)
 *  - HTTP 200 does not mean success: only `success == 1` does
 * The API key acts with the company's full rights, so this client only ever calls read commands (search / read).
 */

export interface TrcloudSettings {
  baseUrl: string;
  companyId: string;
  passkey: string;
  encryptHead: string;
  origin: string;
}

export type TrcloudGroup = string; // "contact", "iv", … — named per endpoint page in TRCLOUD
const READ_COMMANDS = ['search', 'read'] as const;
export type TrcloudReadCommand = (typeof READ_COMMANDS)[number];

export function secureKey(encryptHead: string, timestamp: number): string {
  return createHash('md5').update(`${encryptHead}t${timestamp}`).digest('hex');
}

/** The exact request TRCLOUD expects. Pure, so the shape is unit-tested. */
export function buildRequest(s: TrcloudSettings, group: TrcloudGroup, command: TrcloudReadCommand, params: Record<string, unknown>, now = Date.now()) {
  if (!/^[a-z0-9_]+$/.test(group)) throw new Error(`bad TRCLOUD group: ${group}`);
  if (!READ_COMMANDS.includes(command)) throw new Error(`only read commands are allowed: ${command}`);
  const timestamp = Math.floor(now / 1000);
  const json = JSON.stringify({ ...params, company_id: s.companyId, passkey: s.passkey, timestamp, securekey: secureKey(s.encryptHead, timestamp) });
  const body = new FormData();
  body.append('json', json);
  return {
    url: `${s.baseUrl.replace(/\/+$/, '')}/application/api-connector2/end-point/${group}/${command}.php`,
    init: { method: 'POST', headers: { Origin: s.origin, Accept: 'application/json' }, body } satisfies RequestInit,
  };
}

/** TRCLOUD's English messages → what to do, in Thai (manual §10). */
export function explain(message: string): string {
  const m = message.toLowerCase();
  if (m.includes('origin')) return 'TRCLOUD ไม่ยอมรับ Origin — ค่า TRCLOUD_ORIGIN ต้องตรงกับ Origin ของ API Key (หรือตั้ง Key เป็น ANY)';
  if (m.includes('passkey')) return 'Passkey หรือ Origin ไม่ตรงกับ API Key ใน TRCLOUD';
  if (m.includes('expired')) return 'Secure key หมดอายุ — นาฬิกาของเซิร์ฟเวอร์อาจคลาดเคลื่อน';
  if (m.includes('secure key error') || m.includes('securekey')) return 'Secure key ไม่ถูกต้อง — ตรวจ TRCLOUD_ENCRYPT_HEAD (ไม่ใช่ Passkey)';
  if (m.includes('usage limit') || m.includes('quota')) return `ใช้ API เกินโควตาของแพ็กเกจ TRCLOUD (${message})`;
  if (m.includes('no data')) return 'ไม่พบข้อมูลตามเงื่อนไข';
  return message;
}

export interface TrcloudResponse {
  success?: number | string;
  message?: string;
  [key: string]: unknown;
}

@Injectable()
export class TrcloudClient {
  private readonly log = new Logger('TRCLOUD');

  settings(): TrcloudSettings | null {
    const c = loadConfig();
    if (!c.trcloudEnabled) return null;
    return { baseUrl: c.TRCLOUD_BASE_URL, companyId: c.TRCLOUD_COMPANY_ID, passkey: c.TRCLOUD_PASSKEY, encryptHead: c.TRCLOUD_ENCRYPT_HEAD, origin: c.TRCLOUD_ORIGIN };
  }

  /**
   * One read call. "No data available" is a normal empty answer, not an error. Every answer's message is logged
   * (manual §11) — never the request JSON, which holds the passkey.
   */
  async read(group: TrcloudGroup, command: TrcloudReadCommand, params: Record<string, unknown> = {}): Promise<TrcloudResponse> {
    const s = this.settings();
    if (!s) throw new DomainError('NOT_CONFIGURED', 'ยังไม่ได้ตั้งค่าการเชื่อมต่อ TRCLOUD', HttpStatus.SERVICE_UNAVAILABLE);
    const { url, init } = buildRequest(s, group, command, params);
    let res: Response;
    try {
      res = await fetch(url, { ...init, signal: AbortSignal.timeout(30_000) });
    } catch (e) {
      this.log.warn(`${group}/${command}: network ${(e as Error).name}`);
      throw new DomainError('TRCLOUD_UNREACHABLE', 'ติดต่อ TRCLOUD ไม่ได้ กรุณาลองใหม่', HttpStatus.BAD_GATEWAY);
    }
    const text = await res.text();
    let data: TrcloudResponse;
    try {
      data = JSON.parse(text);
    } catch {
      this.log.warn(`${group}/${command}: HTTP ${res.status}, not JSON (${text.slice(0, 120)})`);
      throw new DomainError('TRCLOUD_BAD_RESPONSE', `TRCLOUD ตอบกลับผิดรูปแบบ (HTTP ${res.status})`, HttpStatus.BAD_GATEWAY);
    }
    const message = String(data.message ?? '');
    this.log.log(`${group}/${command}: HTTP ${res.status} success=${data.success} ${message.slice(0, 160)}`);
    if (Number(data.success) === 1) return data;
    if (/no data/i.test(message)) return { ...data, success: 1, empty: true };
    const status = res.status === 402 ? HttpStatus.PAYMENT_REQUIRED : HttpStatus.BAD_GATEWAY;
    throw new DomainError(res.status === 402 ? 'TRCLOUD_PACKAGE' : 'TRCLOUD_REFUSED', explain(message || `HTTP ${res.status}`), status);
  }
}
