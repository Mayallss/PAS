/**
 * Development seed — fictional people and customers only. Real data arrives via tools/legacy-migration.
 * Roles and the company-default work schedule are created by the migration itself.
 * Test users (dev login, AUTH_DEV_LOGIN=true):
 *   employee@ employee2@ outsider@ manager@ partner@ admin@ it@  (all @pas.test)
 */
import { AppKind, PrismaClient, WorkCategoryType } from '@prisma/client';

const prisma = new PrismaClient();

async function main() {
  await prisma.timePolicy.upsert({ where: { id: 1 }, update: {}, create: { id: 1 } });

  const levels = [
    ['J', 'Junior'], ['SS', 'Semi Senior'], ['S', 'Senior'],
    ['M', 'Manager'], ['SM', 'Senior Manager'], ['D', 'Director'],
  ];
  for (const [i, [code, name]] of levels.entries()) {
    await prisma.employeeLevel.upsert({ where: { code }, update: {}, create: { code, name, sortOrder: i } });
  }
  const level = async (code: string) => (await prisma.employeeLevel.findUniqueOrThrow({ where: { code } })).id;
  const role = async (key: string) => (await prisma.role.findUniqueOrThrow({ where: { key } })).id;

  const users: { email: string; fullName: string; nickname: string; roles: string[]; level: string }[] = [
    { email: 'employee@pas.test', fullName: 'สมชาย ทดสอบ', nickname: 'ชาย', roles: ['EMPLOYEE'], level: 'J' },
    { email: 'employee2@pas.test', fullName: 'สมหญิง ทดสอบ', nickname: 'หญิง', roles: ['EMPLOYEE'], level: 'S' },
    { email: 'outsider@pas.test', fullName: 'บุคคล ทีมอื่น', nickname: 'บี', roles: ['EMPLOYEE'], level: 'SS' },
    { email: 'manager@pas.test', fullName: 'ผู้จัดการ ทดสอบ', nickname: 'เอ็ม', roles: ['EMPLOYEE', 'MANAGER'], level: 'M' },
    { email: 'partner@pas.test', fullName: 'หุ้นส่วน ทดสอบ', nickname: 'พี', roles: ['EMPLOYEE', 'PARTNER'], level: 'D' },
    { email: 'admin@pas.test', fullName: 'ธุรการ ทดสอบ', nickname: 'แอด', roles: ['EMPLOYEE', 'ADMIN'], level: 'S' },
    { email: 'it@pas.test', fullName: 'ไอที ทดสอบ', nickname: 'ไอ', roles: ['EMPLOYEE', 'IT'], level: 'SS' },
  ];
  for (const u of users) {
    const e = await prisma.employee.upsert({
      where: { email: u.email },
      update: { nickname: u.nickname },
      create: { email: u.email, fullName: u.fullName, nickname: u.nickname, levelId: await level(u.level), startDate: new Date('2024-01-01T00:00:00Z') },
    });
    if ((await prisma.roleAssignment.count({ where: { employeeId: e.id } })) === 0) {
      for (const key of u.roles) await prisma.roleAssignment.create({ data: { employeeId: e.id, roleId: await role(key) } });
    }
  }
  const byEmail = async (email: string) => prisma.employee.findUniqueOrThrow({ where: { email } });
  const manager = await byEmail('manager@pas.test');
  const admin = await byEmail('admin@pas.test');

  let teamA = await prisma.orgUnit.findFirst({ where: { name: 'ทีมบัญชี A' } });
  teamA ??= await prisma.orgUnit.create({ data: { name: 'ทีมบัญชี A', managerId: manager.id } });
  let teamB = await prisma.orgUnit.findFirst({ where: { name: 'ทีมบัญชี B' } });
  teamB ??= await prisma.orgUnit.create({ data: { name: 'ทีมบัญชี B' } });
  for (const email of ['employee@pas.test', 'employee2@pas.test', 'manager@pas.test']) {
    await prisma.employee.update({ where: { email }, data: { orgUnitId: teamA.id } });
  }
  await prisma.employee.update({ where: { email: 'outsider@pas.test' }, data: { orgUnitId: teamB.id } });

  // Service catalogue as a tree (legacy encoded the group in the name: "Accounting - ...").
  const groups: Record<string, string> = {};
  for (const [i, name] of ['บริการบัญชี', 'งานทะเบียน', 'IT', 'ธุรการ / ภายใน'].entries()) {
    const g = (await prisma.workCategory.findFirst({ where: { name, parentId: null } })) ??
      (await prisma.workCategory.create({ data: { name, type: i === 3 ? WorkCategoryType.INTERNAL : WorkCategoryType.CLIENT_WORK, sortOrder: i, isBillable: i < 2 } }));
    groups[name] = g.id;
  }
  const categories: [number, string, WorkCategoryType, string, boolean][] = [
    [1, 'ทำบัญชี - รายเดือน', WorkCategoryType.CLIENT_WORK, 'บริการบัญชี', true],
    [40, 'ปิดบัญชี - รายเดือน', WorkCategoryType.CLIENT_WORK, 'บริการบัญชี', true],
    [41, 'ปิดบัญชี - รายปี', WorkCategoryType.CLIENT_WORK, 'บริการบัญชี', true],
    [4, 'ทำเงินเดือน', WorkCategoryType.CLIENT_WORK, 'บริการบัญชี', true],
    [18, 'งานทะเบียน', WorkCategoryType.INTERNAL, 'งานทะเบียน', true],
    [25, 'IT Support', WorkCategoryType.INTERNAL, 'IT', false],
    [32, 'ประชุมประจำเดือน', WorkCategoryType.MEETING, 'ธุรการ / ภายใน', false],
    [34, 'ลากิจ', WorkCategoryType.LEAVE, 'ธุรการ / ภายใน', false],
    [35, 'ลาป่วย', WorkCategoryType.LEAVE, 'ธุรการ / ภายใน', false],
    [36, 'ลาพักร้อน', WorkCategoryType.LEAVE, 'ธุรการ / ภายใน', false],
  ];
  for (const [legacyId, name, type, group, isBillable] of categories) {
    await prisma.workCategory.upsert({
      where: { legacyId },
      update: { name, parentId: groups[group], isBillable },
      create: { legacyId, name, type, parentId: groups[group], isBillable },
    });
  }

  const customers = [
    { code: 'A001', name: 'บริษัท ตัวอย่างหนึ่ง จำกัด', cats: [1, 40, 41, 4] },
    { code: 'A002', name: 'บริษัท ตัวอย่างสอง จำกัด', cats: [1, 40] },
    { code: 'A003', name: 'ห้างหุ้นส่วน ตัวอย่างสาม', cats: [1, 41] },
    { code: 'PAS', name: 'PAS (งานภายใน / ลา / ประชุม)', cats: [18, 25, 32, 34, 35, 36] },
  ];
  for (const c of customers) {
    const customer = await prisma.customer.upsert({ where: { code: c.code }, update: {}, create: { code: c.code, name: c.name, accountOwnerId: manager.id } });
    for (const legacyId of c.cats) {
      const wc = await prisma.workCategory.findUniqueOrThrow({ where: { legacyId } });
      const exists = await prisma.engagement.findFirst({ where: { customerId: customer.id, workCategoryId: wc.id, periodStart: null } });
      if (!exists) await prisma.engagement.create({ data: { customerId: customer.id, workCategoryId: wc.id } });
    }
  }

  const holidays: [string, string][] = [
    ['2026-10-13', 'วันนวมินทรมหาราช'],
    ['2026-10-23', 'วันปิยมหาราช'],
    ['2026-12-05', 'วันพ่อแห่งชาติ'],
    ['2026-12-10', 'วันรัฐธรรมนูญ'],
    ['2026-12-31', 'วันสิ้นปี'],
  ];
  for (const [date, description] of holidays) {
    await prisma.holiday.upsert({ where: { date: new Date(`${date}T00:00:00Z`) }, update: {}, create: { date: new Date(`${date}T00:00:00Z`), description } });
  }

  // Extra schedule for part-timers (not assigned — admins assign it with an effective date).
  await prisma.workSchedule.upsert({
    where: { name: 'Part-time ครึ่งวัน จันทร์–ศุกร์' },
    update: {},
    create: { name: 'Part-time ครึ่งวัน จันทร์–ศุกร์', weekdayMinutes: [240, 240, 240, 240, 240, 0, 0] },
  });

  if ((await prisma.announcement.count()) === 0) {
    await prisma.announcement.createMany({
      data: [
        {
          title: 'สรุปการประชุมประจำเดือนกันยายน 2569',
          body: 'ขอให้ทุกคนอ่านสรุปการประชุมและกด “รับทราบ” ภายในสิ้นเดือน\n\n1. ระบบบันทึกเวลาใหม่เริ่มทดลองใช้\n2. ปิดงบรายปีของลูกค้ากลุ่ม A ให้เสร็จภายในไตรมาส\n3. กำหนดการอบรมภายในเดือนหน้า',
          requiresAck: true,
          pinned: true,
          authorId: admin.id,
          publishedAt: new Date('2026-09-20T02:00:00Z'),
        },
        {
          title: 'วันหยุดเดือนตุลาคม',
          body: 'สำนักงานหยุดวันที่ 13 และ 23 ตุลาคม 2569 ชั่วโมงที่ต้องกรอกในสัปดาห์นั้นจะลดลงอัตโนมัติ',
          authorId: admin.id,
          publishedAt: new Date('2026-09-25T02:00:00Z'),
        },
      ],
    });
  }

  // Application launcher — from the legacy link portal (link/index.php) + planned platform modules.
  const apps: { key: string; name: string; description: string; url: string | null; icon: string; kind: AppKind; category: string; requiredPermission?: string }[] = [
    { key: 'time-report', name: 'Time Report', description: 'บันทึกเวลาการทำงาน', url: '/time-report', icon: 'Clock3', kind: AppKind.INTERNAL, category: 'งานประจำ' },
    { key: 'reports', name: 'รายงาน', description: 'รายงานเวลาทีมและลูกค้า', url: '/reports', icon: 'BarChart3', kind: AppKind.INTERNAL, category: 'งานประจำ', requiredPermission: 'report.team.read' },
    { key: 'announcements', name: 'ประกาศ', description: 'ข่าวสารและรายงานประชุม', url: '/announcements', icon: 'Megaphone', kind: AppKind.INTERNAL, category: 'งานประจำ' },
    { key: 'monday-todo', name: 'To Do List', description: 'แผนการทำงาน (monday.com)', url: 'https://pas-acc.monday.com/boards/1933853914', icon: '/brand/monday.svg', kind: AppKind.EXTERNAL, category: 'งานประจำ' },
    { key: 'monday', name: 'Monday', description: 'pas-acc.monday.com', url: 'https://pas-acc.monday.com/', icon: '/brand/monday.svg', kind: AppKind.EXTERNAL, category: 'งานประจำ' },
    { key: 'client-visit', name: 'พบลูกค้า', description: 'ฟอร์มบันทึกการพบลูกค้า', url: 'https://wkf.ms/4bTBRDt', icon: 'Handshake', kind: AppKind.EXTERNAL, category: 'งานประจำ' },
    { key: 'doc-store', name: 'Document Store', description: 'ระบบจัดเก็บเอกสาร (เว็บ PAS)', url: 'https://pas-acc.com/document/index.php', icon: 'FolderArchive', kind: AppKind.EXTERNAL, category: 'เอกสาร' },
    { key: 'doc-store-old', name: 'Document Store (เดิม)', description: 'จัดเก็บเอกสารบน AppSheet', url: 'https://www.appsheet.com/start/a27b143c-6b64-4898-b1be-3f0b03359404', icon: '/brand/appsheet.png', kind: AppKind.EXTERNAL, category: 'เอกสาร' },
    { key: 'doc-borrow', name: 'ขอนำเอกสารออก', description: 'Document Borrowing Request', url: 'https://wkf.ms/3Y82ocu', icon: 'FileOutput', kind: AppKind.EXTERNAL, category: 'เอกสาร' },
    { key: 'delivery', name: 'Delivery System', description: 'รับ-ส่งเอกสาร', url: 'https://pas-acc.monday.com/boards/1862570548', icon: 'Truck', kind: AppKind.EXTERNAL, category: 'เอกสาร' },
    { key: 'pickup', name: 'Pickup System', description: 'รับ-ส่งเอกสารที่ สนง. PAS', url: 'https://pas-acc.monday.com/boards/1879567470', icon: 'PackageCheck', kind: AppKind.EXTERNAL, category: 'เอกสาร' },
    { key: 'inventory', name: 'The Inventory', description: 'เบิกวัสดุสำนักงาน', url: 'https://pas-acc.com/theinventory/', icon: 'Boxes', kind: AppKind.EXTERNAL, category: 'สำนักงาน' },
    { key: 'it-request', name: 'IT Requests', description: 'แจ้งปัญหา IT support', url: 'https://wkf.ms/4cj8t9E', icon: 'LifeBuoy', kind: AppKind.EXTERNAL, category: 'สำนักงาน' },
    { key: 'it-howto', name: 'IT How To', description: 'คู่มือ IT (เครือข่ายภายใน)', url: 'http://192.168.10.254/it/index.php', icon: 'BookOpen', kind: AppKind.EXTERNAL, category: 'สำนักงาน' },
    { key: 'website', name: 'เว็บไซต์บริษัท', description: 'pas-acc.com', url: 'https://www.pas-acc.com/', icon: 'Globe', kind: AppKind.EXTERNAL, category: 'สำนักงาน' },
    { key: 'doc-center', name: 'Document Center', description: 'ศูนย์เอกสารบนแพลตฟอร์มใหม่', url: null, icon: 'Files', kind: AppKind.PLANNED, category: 'เร็ว ๆ นี้' },
    { key: 'internal-request', name: 'Internal Requests', description: 'คำขอภายในพร้อมการอนุมัติ', url: null, icon: 'Inbox', kind: AppKind.PLANNED, category: 'เร็ว ๆ นี้' },
    { key: 'procurement', name: 'Procurement', description: 'จัดซื้อจัดจ้าง', url: null, icon: 'ShoppingCart', kind: AppKind.PLANNED, category: 'เร็ว ๆ นี้' },
    { key: 'it-asset', name: 'IT Asset', description: 'ทะเบียนทรัพย์สิน IT', url: null, icon: 'Laptop', kind: AppKind.PLANNED, category: 'เร็ว ๆ นี้' },
    { key: 'hr', name: 'HR', description: 'การลาและข้อมูลพนักงาน', url: null, icon: 'Users', kind: AppKind.PLANNED, category: 'เร็ว ๆ นี้' },
  ];
  for (const [i, a] of apps.entries()) {
    await prisma.appLink.upsert({
      where: { key: a.key },
      update: { ...a, requiredPermission: a.requiredPermission ?? null, sortOrder: i },
      create: { ...a, requiredPermission: a.requiredPermission ?? null, sortOrder: i },
    });
  }
  console.log('Seed complete');
}

main().finally(() => prisma.$disconnect());
