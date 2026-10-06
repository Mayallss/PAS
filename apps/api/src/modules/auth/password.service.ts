import { createHash, randomBytes, scrypt as scryptCb, timingSafeEqual } from 'node:crypto';
import { promisify } from 'node:util';
import { HttpStatus, Injectable } from '@nestjs/common';
import { EmploymentStatus } from '@prisma/client';
import { loadConfig } from '../../config';
import { DomainError, notFound } from '../../common/errors';
import { PrismaService } from '../../common/prisma.service';
import type { AppRequest } from '../../common/request-context';
import { AuditService } from '../audit/audit.service';
import type { AuthUser } from './auth.types';

const scrypt = promisify(scryptCb) as (pw: string, salt: Buffer, keylen: number, opts: { N: number; r: number; p: number; maxmem: number }) => Promise<Buffer>;

/**
 * scrypt (memory-hard; built into Node — no native module to break a deployment). OWASP password storage
 * cheat sheet: N=2^16, r=8, p=2 → 64 MiB per hash. Parameters are stored in the hash so they can be raised later.
 */
const PARAMS = { log2N: 16, r: 8, p: 2, keylen: 32 };
const MAX_ATTEMPTS = 5;
const LOCK_MINUTES = 15;
const SETUP_HOURS = 72;
export const PASSWORD_MIN = 10;
/** A short list of passwords seen in the legacy data audit and the usual top ones (2026-10-02). */
const COMMON = new Set(['1234567890', '0123456789', '1111111111', '0000000000', 'password12', 'password123', 'qwertyuiop', 'pas12345678', 'pasacc1234', 'abcd123456', '1234512345', 'asdfghjkl1']);

export async function hashPassword(password: string): Promise<string> {
  const salt = randomBytes(16);
  const N = 2 ** PARAMS.log2N;
  const key = await scrypt(password.normalize('NFKC'), salt, PARAMS.keylen, { N, r: PARAMS.r, p: PARAMS.p, maxmem: 256 * N * PARAMS.r });
  return `scrypt$${PARAMS.log2N}$${PARAMS.r}$${PARAMS.p}$${salt.toString('base64url')}$${key.toString('base64url')}`;
}

export async function verifyPassword(stored: string, password: string): Promise<boolean> {
  const [alg, log2N, r, p, salt, key] = stored.split('$');
  if (alg !== 'scrypt' || !salt || !key) return false;
  const N = 2 ** Number(log2N);
  const expected = Buffer.from(key, 'base64url');
  const got = await scrypt(password.normalize('NFKC'), Buffer.from(salt, 'base64url'), expected.length, { N, r: Number(r), p: Number(p), maxmem: 256 * N * Number(r) });
  return got.length === expected.length && timingSafeEqual(got, expected);
}

/** Length over complexity (NIST SP 800-63B): at least 10 characters, not the username, not a common password. */
export function passwordProblem(password: string, username: string): string | null {
  if (password.length < PASSWORD_MIN) return `รหัสผ่านต้องยาวอย่างน้อย ${PASSWORD_MIN} ตัวอักษร`;
  if (password.length > 128) return 'รหัสผ่านยาวเกินไป';
  if (/^(.)\1+$/.test(password)) return 'รหัสผ่านต้องไม่เป็นตัวอักษรเดียวซ้ำกัน';
  if (password.toLowerCase().includes(username.toLowerCase())) return 'รหัสผ่านต้องไม่มีชื่อผู้ใช้อยู่ในนั้น';
  if (COMMON.has(password.toLowerCase())) return 'รหัสผ่านนี้คาดเดาง่ายเกินไป';
  return null;
}

const sha256 = (s: string) => createHash('sha256').update(s).digest('hex');
export const USERNAME_RE = /^[a-z0-9._-]{3,40}$/;

const loginFailed = () => new DomainError('LOGIN_FAILED', 'ชื่อผู้ใช้หรือรหัสผ่านไม่ถูกต้อง', HttpStatus.UNAUTHORIZED);

@Injectable()
export class PasswordService {
  /** Verified when the username does not exist, so a wrong username costs the same time as a wrong password. */
  private dummy = hashPassword('dummy-password-for-timing');

  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
  ) {}

  enabled() {
    return loadConfig().PASSWORD_LOGIN;
  }

  private assertEnabled() {
    if (!this.enabled()) throw new DomainError('NOT_FOUND', 'การเข้าสู่ระบบด้วยรหัสผ่านถูกปิดไว้', HttpStatus.NOT_FOUND);
  }

  /** Returns the employee id on success. Every failure looks the same to the caller except a temporary lock. */
  async login(usernameRaw: string, password: string, req: AppRequest): Promise<string> {
    this.assertEnabled();
    const username = usernameRaw.trim().toLowerCase();
    const cred = await this.prisma.localCredential.findUnique({ where: { username }, include: { employee: { select: { status: true } } } });
    const fail = async (reason: string, employeeId?: string) => {
      await this.audit.record({ action: 'auth.login_failed', resourceType: 'session', actorId: employeeId, metadata: { method: 'password', reason } }, req);
      return loginFailed();
    };
    if (!cred?.passwordHash) {
      await verifyPassword(await this.dummy, password);
      throw await fail('unknown_user');
    }
    if (cred.lockedUntil && cred.lockedUntil > new Date()) {
      throw new DomainError('LOCKED', `ใส่รหัสผิดหลายครั้ง บัญชีถูกล็อกชั่วคราว ลองใหม่หลัง ${cred.lockedUntil.toLocaleTimeString('th-TH', { timeZone: loadConfig().TZ_BUSINESS, hour: '2-digit', minute: '2-digit' })} น. หรือให้ Admin ปลดล็อก`, HttpStatus.LOCKED);
    }
    if (!(await verifyPassword(cred.passwordHash, password))) {
      const attempts = cred.failedAttempts + 1;
      const lock = attempts >= MAX_ATTEMPTS;
      await this.prisma.localCredential.update({
        where: { employeeId: cred.employeeId },
        data: lock ? { failedAttempts: 0, lockedUntil: new Date(Date.now() + LOCK_MINUTES * 60_000) } : { failedAttempts: attempts },
      });
      throw await fail(lock ? 'locked' : 'bad_password', cred.employeeId);
    }
    if (cred.employee.status !== EmploymentStatus.ACTIVE) throw await fail('inactive', cred.employeeId);
    await this.prisma.localCredential.update({ where: { employeeId: cred.employeeId }, data: { failedAttempts: 0, lockedUntil: null } });
    return cred.employeeId;
  }

  // -------------------------------------------------------------------------
  // One-time set-password link (issued by an administrator; the employee chooses the password)
  // -------------------------------------------------------------------------

  /** Legacy Time Report username, if it fits the format. */
  private async defaultUsername(employeeId: string) {
    const legacy = await this.prisma.externalAccount.findFirst({ where: { employeeId, system: { key: 'LEGACY_TIMEREPORT' } }, select: { identifier: true } });
    const u = legacy?.identifier.trim().toLowerCase();
    return u && USERNAME_RE.test(u) ? u : null;
  }

  async status(employeeId: string) {
    const [cred, suggestion] = await Promise.all([this.prisma.localCredential.findUnique({ where: { employeeId } }), this.defaultUsername(employeeId)]);
    return {
      enabled: this.enabled(),
      username: cred?.username ?? null,
      suggestedUsername: suggestion,
      hasPassword: Boolean(cred?.passwordHash),
      locked: Boolean(cred?.lockedUntil && cred.lockedUntil > new Date()),
      setupPending: Boolean(cred?.setupExpiresAt && cred.setupExpiresAt > new Date()),
      setupExpiresAt: cred?.setupExpiresAt ?? null,
      passwordChangedAt: cred?.passwordChangedAt ?? null,
    };
  }

  async issueSetupLink(admin: AuthUser, employeeId: string, usernameRaw: string | null, req: AppRequest) {
    this.assertEnabled();
    const employee = await this.prisma.employee.findUnique({ where: { id: employeeId }, select: { id: true, status: true, fullName: true } });
    if (!employee) throw notFound('พนักงาน');
    if (employee.status !== EmploymentStatus.ACTIVE) throw new DomainError('EMPLOYEE_INACTIVE', 'พนักงานคนนี้ไม่ได้ทำงานอยู่', HttpStatus.CONFLICT);
    const existing = await this.prisma.localCredential.findUnique({ where: { employeeId } });
    const username = (usernameRaw?.trim().toLowerCase() || existing?.username || (await this.defaultUsername(employeeId)) || '').trim();
    if (!USERNAME_RE.test(username)) throw new DomainError('USERNAME_INVALID', 'ชื่อผู้ใช้ต้องเป็น a-z 0-9 . _ - ยาว 3–40 ตัว', HttpStatus.BAD_REQUEST);
    const taken = await this.prisma.localCredential.findUnique({ where: { username } });
    if (taken && taken.employeeId !== employeeId) throw new DomainError('USERNAME_TAKEN', `ชื่อผู้ใช้ “${username}” มีคนใช้แล้ว`, HttpStatus.CONFLICT);

    const token = randomBytes(32).toString('base64url');
    const expires = new Date(Date.now() + SETUP_HOURS * 3_600_000);
    await this.prisma.localCredential.upsert({
      where: { employeeId },
      create: { employeeId, username, setupTokenHash: sha256(token), setupExpiresAt: expires },
      update: { username, setupTokenHash: sha256(token), setupExpiresAt: expires },
    });
    await this.audit.record({ action: 'auth.password_link', resourceType: 'employee', resourceId: employeeId, after: { username, expiresAt: expires.toISOString() } }, req);
    const origin = loadConfig().APP_ORIGIN.replace(/\/+$/, '');
    return { username, url: `${origin}/set-password?token=${token}`, expiresAt: expires.toISOString() };
  }

  private async byToken(token: string) {
    const cred = await this.prisma.localCredential.findUnique({ where: { setupTokenHash: sha256(token) }, include: { employee: { select: { fullName: true, status: true } } } });
    if (!cred || !cred.setupExpiresAt || cred.setupExpiresAt < new Date() || cred.employee.status !== EmploymentStatus.ACTIVE) {
      throw new DomainError('LINK_INVALID', 'ลิงก์หมดอายุหรือถูกใช้ไปแล้ว — ขอลิงก์ใหม่จาก Admin', HttpStatus.GONE);
    }
    return cred;
  }

  async setupInfo(token: string) {
    this.assertEnabled();
    const cred = await this.byToken(token);
    return { username: cred.username, fullName: cred.employee.fullName, expiresAt: cred.setupExpiresAt };
  }

  /** Sets the password, burns the link, signs out every other session of that person. */
  async completeSetup(token: string, password: string, req: AppRequest): Promise<string> {
    this.assertEnabled();
    const cred = await this.byToken(token);
    const problem = passwordProblem(password, cred.username);
    if (problem) throw new DomainError('PASSWORD_WEAK', problem, HttpStatus.BAD_REQUEST);
    const hash = await hashPassword(password);
    const { count } = await this.prisma.localCredential.updateMany({
      where: { employeeId: cred.employeeId, setupTokenHash: cred.setupTokenHash },
      data: { passwordHash: hash, setupTokenHash: null, setupExpiresAt: null, failedAttempts: 0, lockedUntil: null, passwordChangedAt: new Date() },
    });
    if (count === 0) throw new DomainError('LINK_INVALID', 'ลิงก์ถูกใช้ไปแล้ว', HttpStatus.GONE);
    await this.prisma.session.deleteMany({ where: { employeeId: cred.employeeId } });
    await this.audit.record({ action: 'auth.password_set', resourceType: 'employee', resourceId: cred.employeeId, actorId: cred.employeeId }, req);
    return cred.employeeId;
  }

  async change(user: AuthUser, current: string, next: string, req: AppRequest) {
    this.assertEnabled();
    const cred = await this.prisma.localCredential.findUnique({ where: { employeeId: user.id } });
    if (!cred?.passwordHash) throw new DomainError('NO_PASSWORD', 'บัญชีนี้ยังไม่ได้ตั้งรหัสผ่าน — ขอลิงก์ตั้งรหัสผ่านจาก Admin', HttpStatus.CONFLICT);
    if (!(await verifyPassword(cred.passwordHash, current))) throw new DomainError('PASSWORD_WRONG', 'รหัสผ่านปัจจุบันไม่ถูกต้อง', HttpStatus.BAD_REQUEST);
    const problem = passwordProblem(next, cred.username) ?? (next === current ? 'รหัสผ่านใหม่ต้องไม่ซ้ำรหัสเดิม' : null);
    if (problem) throw new DomainError('PASSWORD_WEAK', problem, HttpStatus.BAD_REQUEST);
    await this.prisma.localCredential.update({ where: { employeeId: user.id }, data: { passwordHash: await hashPassword(next), passwordChangedAt: new Date(), failedAttempts: 0, lockedUntil: null } });
    // Other browsers signed in as this person are signed out; this one stays.
    await this.prisma.session.deleteMany({ where: { employeeId: user.id, id: { not: req.sessionId } } });
    await this.audit.record({ action: 'auth.password_change', resourceType: 'employee', resourceId: user.id }, req);
  }

  async unlock(employeeId: string, req: AppRequest) {
    await this.prisma.localCredential.update({ where: { employeeId }, data: { failedAttempts: 0, lockedUntil: null } }).catch(() => {
      throw notFound('บัญชีเข้าสู่ระบบ');
    });
    await this.audit.record({ action: 'auth.password_unlock', resourceType: 'employee', resourceId: employeeId }, req);
  }

  /** Removes password sign-in for one person (they can still use Google when that is on). */
  async remove(employeeId: string, req: AppRequest) {
    await this.prisma.localCredential.deleteMany({ where: { employeeId } });
    await this.prisma.session.deleteMany({ where: { employeeId } });
    await this.audit.record({ action: 'auth.password_remove', resourceType: 'employee', resourceId: employeeId }, req);
  }
}
