import { HttpException, HttpStatus } from '@nestjs/common';

/** Domain error with a stable machine-readable code and a Thai message for the UI. */
export class DomainError extends HttpException {
  constructor(code: string, message: string, status: HttpStatus = HttpStatus.UNPROCESSABLE_ENTITY, extra?: object) {
    super({ code, message, ...extra }, status);
  }
}

export const conflict = (message = 'ข้อมูลถูกแก้ไขโดยผู้อื่นแล้ว กรุณาโหลดใหม่') =>
  new DomainError('VERSION_CONFLICT', message, HttpStatus.CONFLICT);

export const notFound = (what = 'ข้อมูล') => new DomainError('NOT_FOUND', `ไม่พบ${what}`, HttpStatus.NOT_FOUND);

export const forbidden = (message = 'ไม่มีสิทธิ์ดำเนินการ') => new DomainError('FORBIDDEN', message, HttpStatus.FORBIDDEN);
