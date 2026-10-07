/**
 * Development seed — fictional people and customers only. Real data arrives via tools/legacy-migration.
 * Roles and the company-default work schedule are created by the migration itself.
 * Test users (dev login, AUTH_DEV_LOGIN=true):
 *   employee@ employee2@ outsider@ manager@ partner@ admin@ it@ hr@  (all @pas.test)
 */
import { PrismaClient, WorkCategoryType } from '@prisma/client';
import { seedApps } from './apps';

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
    { email: 'hr@pas.test', fullName: 'บุคคล ทดสอบ', nickname: 'เอช', roles: ['EMPLOYEE', 'HR'], level: 'S' },
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

  // Leave types on the legacy leave activities (production gets the same rows from the migration).
  const leaveTypes: [number, string, string, number, number, number | null, string, number, string][] = [
    [36, 'VACATION', 'ลาพักร้อน', 3240, 12, null, 'sky', 1, '[กฎหมาย] พ.ร.บ.คุ้มครองแรงงาน ม.30'],
    [34, 'PERSONAL', 'ลากิจ', 1620, 0, null, 'amber', 2, '[กฎหมาย] ม.34'],
    [35, 'SICK', 'ลาป่วย', 16200, 0, 3, 'rose', 3, '[กฎหมาย] ม.32, ม.57'],
  ];
  for (const [legacyId, key, name, annualMinutes, minTenureMonths, certificateFromDays, color, sortOrder, source] of leaveTypes) {
    const wc = await prisma.workCategory.findUniqueOrThrow({ where: { legacyId } });
    await prisma.leaveType.upsert({
      where: { key },
      update: {},
      create: { key, name, workCategoryId: wc.id, annualMinutes, minTenureMonths, certificateFromDays, color, sortOrder, source },
    });
  }

  for (const [i, room] of [
    { name: 'ห้องประชุมใหญ่', location: 'ชั้น 2', capacity: 12, features: ['จอทีวี', 'กล้องประชุม', 'ไวท์บอร์ด'], color: 'indigo' },
    { name: 'ห้องประชุมเล็ก', location: 'ชั้น 1', capacity: 4, features: ['จอทีวี'], color: 'emerald' },
  ].entries()) {
    await prisma.meetingRoom.upsert({ where: { name: room.name }, update: {}, create: { ...room, sortOrder: i } });
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
          title: 'ยินดีต้อนรับสู่ PAS Employee Portal',
          body: 'ระบบใหม่รวมการบันทึกเวลา ประกาศ รายงานการประชุม และลิงก์ระบบต่าง ๆ ไว้ในที่เดียว\nหากพบปัญหาแจ้งฝ่าย IT ได้ทางเมนู IT Requests',
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

  // Meeting minutes (legacy `meet`): rich text, versioned, certified per version.
  if ((await prisma.meeting.count()) === 0) {
    const body =
      '<h3>วาระที่ 1 เรื่องแจ้งเพื่อทราบ</h3><p>ระบบบันทึกเวลาใหม่เริ่มทดลองใช้ตั้งแต่วันที่ 1 ตุลาคม 2569</p>' +
      '<h3>วาระที่ 2 เรื่องพิจารณา</h3><ol><li>ปิดงบรายปีของลูกค้ากลุ่ม A ให้เสร็จภายในไตรมาส</li><li>จัดอบรมภายในเรื่องภาษีมูลค่าเพิ่มในเดือนหน้า</li></ol>' +
      '<table><thead><tr><th>งาน</th><th>ผู้รับผิดชอบ</th><th>กำหนดเสร็จ</th></tr></thead><tbody><tr><td>ปิดงบกลุ่ม A</td><td>ทีมบัญชี A</td><td>31 ธ.ค. 2569</td></tr></tbody></table>';
    const m = await prisma.meeting.create({
      data: { title: 'ประชุมประจำเดือน กันยายน 2569', meetingDate: new Date('2026-09-25T00:00:00Z'), startTime: '09:00', endTime: '11:00', location: 'ห้องประชุมใหญ่', bodyHtml: body, authorId: admin.id },
    });
    await prisma.meetingRevision.create({ data: { meetingId: m.id, version: 1, title: m.title, bodyHtml: body, authorId: admin.id } });
  }

  await seedApps(prisma);
  // IT asset samples (fictional). Categories/systems/templates come from the migration.
  if ((await prisma.asset.count()) === 0) {
    const it = await byEmail('it@pas.test');
    const employee = await byEmail('employee@pas.test');
    const cat = async (key: string) => (await prisma.assetCategory.findUniqueOrThrow({ where: { key } })).id;
    const vendor = await prisma.vendor.upsert({ where: { name: 'ร้านคอมพิวเตอร์ตัวอย่าง' }, update: {}, create: { name: 'ร้านคอมพิวเตอร์ตัวอย่าง' } });
    const room = await prisma.location.upsert({ where: { name: 'ห้อง Server' }, update: {}, create: { name: 'ห้อง Server' } });
    const d = (iso: string) => new Date(`${iso}T00:00:00Z`);
    const samples = [
      { code: 'NB-0101', key: 'NOTEBOOK', brand: 'LENOVO', model: 'IdeaPad Slim 3 14IRH10', specs: { cpu: 'Intel i5-13420H', ram: '16 GB', storage: 'SSD 512 GB', os: '11 home' }, purchaseDate: '2026-03-09', cost: 18990 },
      { code: 'NB-0102', key: 'NOTEBOOK', brand: 'ASUS', model: 'X515', specs: { cpu: 'Intel i5-1035G1', ram: '8 GB', storage: 'SSD 512 GB', os: '11 home' }, purchaseDate: '2021-09-14', cost: 17810.28 },
      { code: 'PC-0101', key: 'DESKTOP', brand: 'LENOVO', model: 'ideacentre 300', specs: { cpu: 'Intel i3-6100', ram: '4 GB', storage: 'HDD 500 GB', os: '10 Pro' }, purchaseDate: '2016-10-21', cost: 10308.41 },
      { code: 'MO-0101', key: 'MONITOR', brand: 'Dell', model: 'P2422H', specs: { size: '24"' }, purchaseDate: '2025-07-18', cost: 4990 },
    ];
    for (const a of samples) {
      const asset = await prisma.asset.create({
        data: { code: a.code, categoryId: await cat(a.key), brand: a.brand, model: a.model, specs: a.specs, purchaseDate: d(a.purchaseDate), cost: a.cost, vendorId: vendor.id },
      });
      await prisma.assetEvent.create({ data: { assetId: asset.id, type: 'REGISTERED', occurredOn: d(a.purchaseDate), title: 'ลงทะเบียน (ข้อมูลตัวอย่าง)', recordedById: it.id } });
    }
    const nb = await prisma.asset.findUniqueOrThrow({ where: { code: 'NB-0101' } });
    await prisma.assetAssignment.create({ data: { assetId: nb.id, employeeId: employee.id, kind: 'PRIMARY', startDate: d('2026-03-09'), createdById: it.id } });
    await prisma.assetEvent.create({ data: { assetId: nb.id, type: 'ASSIGNED', occurredOn: d('2026-03-09'), title: 'มอบให้ สมชาย ทดสอบ (ใช้ประจำ)', employeeId: employee.id, recordedById: it.id } });
    const pc = await prisma.asset.findUniqueOrThrow({ where: { code: 'PC-0101' } });
    await prisma.assetAssignment.create({ data: { assetId: pc.id, locationId: room.id, kind: 'SHARED', startDate: d('2020-01-01'), createdById: it.id } });
    await prisma.asset.update({ where: { id: pc.id }, data: { specs: { cpu: 'Intel i3-6100', ram: '4 GB', storage: 'SSD 256 GB', os: '10 Pro' } } });
    await prisma.assetEvent.create({
      data: { assetId: pc.id, type: 'UPGRADE', occurredOn: d('2026-06-10'), title: 'เปลี่ยน HDD เป็น SSD', specDiff: { storage: ['HDD 500 GB', 'SSD 256 GB'] }, cost: 1860, vendorId: vendor.id, recordedById: it.id },
    });
  }

  console.log('Seed complete');
}

main().finally(() => prisma.$disconnect());
