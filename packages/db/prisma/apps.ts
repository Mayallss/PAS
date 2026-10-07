/**
 * Sidebar / launcher apps (internal pages + links to the legacy tools). Production-safe: only upserts
 * `app_link` rows — no people, customers or devices. Used by seed.ts and by seed-apps.ts (AWS one-off job).
 */
import { AppKind, type PrismaClient } from '@prisma/client';

export async function seedApps(prisma: PrismaClient) {
  // Apps = sidebar + launcher + command palette (legacy link portal links + platform pages).
  // Order here = order inside each sidebar group. requiredPermissions: ANY of them (empty = everyone).
  type App = { key: string; name: string; description: string; url: string | null; icon: string; kind: AppKind; category: string; requiredPermissions?: string[]; isAdmin?: boolean };
  const DAILY = 'งานประจำ';
  const DOCS = 'เอกสาร';
  const OFFICE = 'สำนักงาน';
  const ADMIN = 'ผู้ดูแลระบบ';
  const SOON = 'เร็ว ๆ นี้';
  const apps: App[] = [
    { key: 'plan', name: 'แผนงาน (To-do)', description: 'วางแผนงานรายวัน / มอบงานให้ทีม', url: '/plan', icon: 'ListTodo', kind: AppKind.INTERNAL, category: DAILY, requiredPermissions: ['time.own.write', 'report.team.read', 'report.all.read'] },
    { key: 'time-report', name: 'บันทึกเวลา', description: 'บันทึกเวลาการทำงาน', url: '/time-report', icon: 'Clock3', kind: AppKind.INTERNAL, category: DAILY },
    { key: 'meetings', name: 'รายงานการประชุม', description: 'อ่าน รับรอง หรือแย้งรายงาน', url: '/meetings', icon: 'ClipboardCheck', kind: AppKind.INTERNAL, category: DAILY },
    { key: 'announcements', name: 'ประกาศ', description: 'ข่าวสารจากสำนักงาน', url: '/announcements', icon: 'Megaphone', kind: AppKind.INTERNAL, category: DAILY },
    { key: 'reports', name: 'รายงาน', description: 'รายงานเวลาทีมและลูกค้า', url: '/reports', icon: 'BarChart3', kind: AppKind.INTERNAL, category: DAILY, requiredPermissions: ['report.team.read', 'report.all.read'] },
    { key: 'monday-todo', name: 'To Do List', description: 'แผนการทำงาน (monday.com)', url: 'https://pas-acc.monday.com/boards/1933853914', icon: '/brand/monday.svg', kind: AppKind.EXTERNAL, category: DAILY },
    { key: 'monday', name: 'Monday', description: 'pas-acc.monday.com', url: 'https://pas-acc.monday.com/', icon: '/brand/monday.svg', kind: AppKind.EXTERNAL, category: DAILY },
    { key: 'client-visit', name: 'พบลูกค้า', description: 'ฟอร์มบันทึกการพบลูกค้า', url: 'https://wkf.ms/4bTBRDt', icon: 'Handshake', kind: AppKind.EXTERNAL, category: DAILY },
    { key: 'handoff', name: 'รับ–ส่งเอกสาร', description: 'ส่งมอบเอกสารพร้อมลายเซ็น', url: '/handoff', icon: 'Signature', kind: AppKind.INTERNAL, category: DOCS, requiredPermissions: ['handoff.use'] },
    { key: 'doc-store', name: 'Document Store', description: 'ระบบจัดเก็บเอกสาร (เว็บ PAS)', url: 'https://pas-acc.com/document/index.php', icon: 'FolderArchive', kind: AppKind.EXTERNAL, category: DOCS },
    { key: 'doc-store-old', name: 'Document Store (เดิม)', description: 'จัดเก็บเอกสารบน AppSheet', url: 'https://www.appsheet.com/start/a27b143c-6b64-4898-b1be-3f0b03359404', icon: '/brand/appsheet.png', kind: AppKind.EXTERNAL, category: DOCS },
    { key: 'doc-borrow', name: 'ขอนำเอกสารออก', description: 'Document Borrowing Request', url: 'https://wkf.ms/3Y82ocu', icon: 'FileOutput', kind: AppKind.EXTERNAL, category: DOCS },
    { key: 'delivery', name: 'Delivery System', description: 'รับ-ส่งเอกสาร', url: 'https://pas-acc.monday.com/boards/1862570548', icon: 'Truck', kind: AppKind.EXTERNAL, category: DOCS },
    { key: 'pickup', name: 'Pickup System', description: 'รับ-ส่งเอกสารที่ สนง. PAS', url: 'https://pas-acc.monday.com/boards/1879567470', icon: 'PackageCheck', kind: AppKind.EXTERNAL, category: DOCS },
    { key: 'it-asset', name: 'อุปกรณ์ IT', description: 'เครื่องของฉัน แจ้งซ่อม และทะเบียนอุปกรณ์', url: '/it-assets', icon: 'Laptop', kind: AppKind.INTERNAL, category: OFFICE },
    { key: 'it-request', name: 'IT Requests', description: 'แจ้งปัญหา IT support', url: 'https://wkf.ms/4cj8t9E', icon: 'LifeBuoy', kind: AppKind.EXTERNAL, category: OFFICE },
    { key: 'inventory', name: 'The Inventory', description: 'เบิกวัสดุสำนักงาน', url: 'https://pas-acc.com/theinventory/', icon: 'Boxes', kind: AppKind.EXTERNAL, category: OFFICE },
    { key: 'it-howto', name: 'IT How To', description: 'คู่มือ IT (เครือข่ายภายใน)', url: 'http://192.168.10.254/it/index.php', icon: 'BookOpen', kind: AppKind.EXTERNAL, category: OFFICE },
    { key: 'website', name: 'เว็บไซต์บริษัท', description: 'pas-acc.com', url: 'https://www.pas-acc.com/', icon: 'Globe', kind: AppKind.EXTERNAL, category: OFFICE },
    { key: 'admin-customers', name: 'ลูกค้าและ Activity', description: 'ข้อมูลลูกค้า งานบริการ และ Engagement', url: '/admin/customers', icon: 'Building2', kind: AppKind.INTERNAL, category: ADMIN, requiredPermissions: ['catalog.write'], isAdmin: true },
    { key: 'admin-calendar', name: 'วันหยุดและนโยบาย', description: 'วันหยุด ตารางงาน ปิดงวด นโยบายบันทึกเวลา', url: '/admin/calendar', icon: 'CalendarCog', kind: AppKind.INTERNAL, category: ADMIN, requiredPermissions: ['calendar.write'], isAdmin: true },
    { key: 'admin-employees', name: 'พนักงานและสิทธิ์', description: 'พนักงาน ทีม บทบาท อัตราต้นทุน', url: '/admin/employees', icon: 'Users', kind: AppKind.INTERNAL, category: ADMIN, requiredPermissions: ['employee.admin', 'role.admin'], isAdmin: true },
    { key: 'admin-onboarding', name: 'งานรับพนักงานใหม่', description: 'Checklist รับ/ออกพนักงาน', url: '/admin/onboarding', icon: 'ListChecks', kind: AppKind.INTERNAL, category: ADMIN, requiredPermissions: ['onboarding.manage'], isAdmin: true },
    { key: 'doc-center', name: 'Document Center', description: 'ศูนย์เอกสารบนแพลตฟอร์มใหม่', url: null, icon: 'Files', kind: AppKind.PLANNED, category: SOON },
    { key: 'internal-request', name: 'Internal Requests', description: 'คำขอภายในพร้อมการอนุมัติ', url: null, icon: 'Inbox', kind: AppKind.PLANNED, category: SOON },
    { key: 'procurement', name: 'Procurement', description: 'จัดซื้อจัดจ้าง', url: null, icon: 'ShoppingCart', kind: AppKind.PLANNED, category: SOON },
    { key: 'hr', name: 'HR', description: 'การลาและข้อมูลพนักงาน', url: null, icon: 'Users', kind: AppKind.PLANNED, category: SOON },
  ];
  for (const [i, a] of apps.entries()) {
    const data = { ...a, requiredPermissions: a.requiredPermissions ?? [], isAdmin: a.isAdmin ?? false, sortOrder: i };
    await prisma.appLink.upsert({ where: { key: a.key }, update: data, create: data });
  }
}
