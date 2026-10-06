import { HttpStatus } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { addDays, toDate, toIsoDate } from '../../common/dates';
import { DomainError } from '../../common/errors';

type Tx = Prisma.TransactionClient;

/**
 * Changes someone's level from `effectiveFrom` on, keeping the old period (inclusive dates, like cost_rate).
 *  - same level as now → nothing to do
 *  - same start date as the open period → that period is corrected in place (a typo, not a promotion)
 *  - earlier than the open period → refused: rewriting earlier history needs a deliberate data fix
 * Employee.level_id always mirrors the open period.
 */
export async function setLevel(tx: Tx, employeeId: string, levelId: string | null, effectiveFrom: string, actorId: string | null) {
  const open = await tx.employeeLevelHistory.findFirst({ where: { employeeId, effectiveTo: null } });
  if ((open?.levelId ?? null) === levelId) return;

  if (open) {
    const openFrom = toIsoDate(open.effectiveFrom);
    if (effectiveFrom < openFrom) {
      throw new DomainError('LEVEL_DATE_BEFORE_CURRENT', `วันที่มีผลต้องไม่ก่อนระดับปัจจุบัน (เริ่ม ${openFrom})`, HttpStatus.CONFLICT);
    }
    if (effectiveFrom === openFrom) {
      if (levelId) await tx.employeeLevelHistory.update({ where: { id: open.id }, data: { levelId, createdById: actorId } });
      else await tx.employeeLevelHistory.delete({ where: { id: open.id } });
      await tx.employee.update({ where: { id: employeeId }, data: { levelId } });
      return;
    }
    await tx.employeeLevelHistory.update({ where: { id: open.id }, data: { effectiveTo: toDate(addDays(effectiveFrom, -1)) } });
  }
  if (levelId) {
    await tx.employeeLevelHistory.create({ data: { employeeId, levelId, effectiveFrom: toDate(effectiveFrom), createdById: actorId } });
  }
  await tx.employee.update({ where: { id: employeeId }, data: { levelId } });
}
