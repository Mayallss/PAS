/**
 * Permission catalogue. The code checks these keys; WHICH role holds which permission is data
 * (table `role`, editable by holders of `role.admin`). Pending business confirmation: docs/06 Q6.
 */
export const PERMISSIONS = [
  'time.own.write', //       record/edit own time entries
  'report.team.read', //     reports for managed org units (or the unit a role is scoped to)
  'report.all.read', //      reports for the whole company (or the scoped unit)
  'report.export', //        Excel export within read scope
  'catalog.write', //        customers, services, engagements
  'calendar.write', //       holidays, period locks, time policy, work schedules
  'employee.admin', //       employee status, team, level, role assignments
  'role.admin', //           define roles and their permissions
  'announcement.write', //   publish company announcements
  'audit.read',
] as const;

export type Permission = (typeof PERMISSIONS)[number];

export const PERMISSION_LABELS: Record<Permission, string> = {
  'time.own.write': 'บันทึกเวลาของตนเอง',
  'report.team.read': 'ดูรายงานของทีมที่ดูแล',
  'report.all.read': 'ดูรายงานทั้งบริษัท',
  'report.export': 'ส่งออกรายงาน Excel',
  'catalog.write': 'จัดการลูกค้าและงาน',
  'calendar.write': 'จัดการวันหยุด ตารางงาน และนโยบาย',
  'employee.admin': 'จัดการพนักงานและการมอบสิทธิ์',
  'role.admin': 'กำหนดบทบาทและสิทธิ์',
  'announcement.write': 'ประกาศข่าวสาร',
  'audit.read': 'ดูประวัติการใช้งาน (Audit)',
};

const KNOWN = new Set<string>(PERMISSIONS);

/** Unknown keys stored in the DB (e.g. from a newer version) are ignored, never trusted. */
export function toPermissions(values: Iterable<string>): Permission[] {
  return [...new Set([...values].filter((v): v is Permission => KNOWN.has(v)))].sort();
}

export function isPermission(v: string): v is Permission {
  return KNOWN.has(v);
}
