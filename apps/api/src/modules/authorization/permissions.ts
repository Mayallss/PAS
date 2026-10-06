/**
 * Permission catalogue. The code checks these keys; WHICH role holds which permission is data
 * (table `role`, editable by holders of `role.admin`). Pending business confirmation: docs/06 Q6.
 */
export const PERMISSIONS = [
  'time.own.write', //       record/edit own time entries and own work plan (To-do)
  'todo.assign', //          plan work for people in the report scope (team leads)
  'handoff.use', //          รับ–ส่งเอกสาร: open monday hand-over tickets, collect signatures, create signing links
  'report.team.read', //     reports for managed org units (or the unit a role is scoped to)
  'report.all.read', //      reports for the whole company (or the scoped unit)
  'report.export', //        Excel export within read scope
  'catalog.write', //        customers, services, engagements
  'calendar.write', //       holidays, period locks, time policy, work schedules
  'employee.admin', //       employee status, team, level, role assignments
  'role.admin', //           define roles and their permissions
  'announcement.write', //   publish company announcements
  'meeting.write', //        record meeting minutes, publish revisions, answer objections
  'asset.read', //           IT asset register and device history
  'asset.write', //          register devices, hand out / take back, record repairs and upgrades, attach evidence
  'onboarding.manage', //    new-employee checklist and accounts in other systems
  'leave.manage', //         HR: every leave request, entitlements, leave types, record leave on someone's behalf
  'room.manage', //          meeting rooms and any booking
  'cost.read', //            money in reports (rates × hours), within the report scope
  'cost.write', //           cost rates per level
  'audit.read',
] as const;

export type Permission = (typeof PERMISSIONS)[number];

export const PERMISSION_LABELS: Record<Permission, string> = {
  'time.own.write': 'บันทึกเวลาของตนเอง',
  'todo.assign': 'มอบหมายงาน (To-do) ให้ทีมที่ดูแล',
  'handoff.use': 'รับ–ส่งเอกสารและเก็บลายเซ็น',
  'report.team.read': 'ดูรายงานของทีมที่ดูแล',
  'report.all.read': 'ดูรายงานทั้งบริษัท',
  'report.export': 'ส่งออกรายงาน Excel',
  'catalog.write': 'จัดการลูกค้าและงาน',
  'calendar.write': 'จัดการวันหยุด ตารางงาน และนโยบาย',
  'employee.admin': 'จัดการพนักงานและการมอบสิทธิ์',
  'role.admin': 'กำหนดบทบาทและสิทธิ์',
  'announcement.write': 'ประกาศข่าวสาร',
  'meeting.write': 'บันทึก/แก้ไขรายงานการประชุม และตอบข้อโต้แย้ง',
  'asset.read': 'ดูทะเบียนอุปกรณ์ IT และประวัติเครื่อง',
  'asset.write': 'จัดการอุปกรณ์ IT (มอบ/คืน/ซ่อม/อัปเกรด/แนบหลักฐาน)',
  'onboarding.manage': 'ดูแล Checklist รับพนักงานใหม่และบัญชีระบบอื่น',
  'leave.manage': 'จัดการการลาทั้งหมด สิทธิ์วันลา และประเภทการลา (HR)',
  'room.manage': 'จัดการห้องประชุมและการจองทั้งหมด',
  'cost.read': 'ดูต้นทุน (อัตรา × ชั่วโมง) ในรายงาน',
  'cost.write': 'กำหนดอัตราต้นทุนตามระดับ',
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
