-- Sidebar = app list (one source for sidebar, launcher and command palette), per-user favourites,
-- admin section, and "any of several permissions" per app (a single permission hid รายงาน from Partners,
-- who hold report.all.read but not report.team.read).
-- Written by hand: prisma migrate diff dropped required_permission before copying it (and proposed
-- dropping the hand-written unique indexes / FK again — removed on purpose).

-- 1) Permissions: single → list, data kept.
ALTER TABLE "app_link"
  ADD COLUMN "required_permissions" TEXT[] DEFAULT ARRAY[]::TEXT[],
  ADD COLUMN "is_admin" BOOLEAN NOT NULL DEFAULT false;
UPDATE "app_link" SET "required_permissions" = ARRAY["required_permission"] WHERE "required_permission" IS NOT NULL;
ALTER TABLE "app_link" DROP COLUMN "required_permission";

-- 2) Favourites.
CREATE TABLE "app_favorite" (
    "employee_id" UUID NOT NULL,
    "app_link_id" UUID NOT NULL,
    "sort_order" INTEGER NOT NULL DEFAULT 0,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "app_favorite_pkey" PRIMARY KEY ("employee_id","app_link_id")
);
ALTER TABLE "app_favorite" ADD CONSTRAINT "app_favorite_employee_id_fkey" FOREIGN KEY ("employee_id") REFERENCES "employee"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "app_favorite" ADD CONSTRAINT "app_favorite_app_link_id_fkey" FOREIGN KEY ("app_link_id") REFERENCES "app_link"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- 3) Every portal page becomes an app row (the sidebar used to be a hard-coded list in app-shell.tsx).
--    Same permissions as that list; sort order = sidebar order within each group.
INSERT INTO "app_link" ("id", "key", "name", "description", "url", "icon", "kind", "category", "required_permissions", "is_admin", "sort_order") VALUES
  (gen_random_uuid(), 'plan',             'แผนงาน (To-do)',      'วางแผนงานรายวัน / มอบงานให้ทีม',        '/plan',             'ListTodo',     'INTERNAL', 'งานประจำ', ARRAY['time.own.write','report.team.read','report.all.read'], false, 1),
  (gen_random_uuid(), 'handoff',          'รับ–ส่งเอกสาร',        'ส่งมอบเอกสารพร้อมลายเซ็น',              '/handoff',          'Signature',    'INTERNAL', 'เอกสาร',   ARRAY['handoff.use'], false, 20),
  (gen_random_uuid(), 'admin-customers',  'ลูกค้าและ Activity',   'ข้อมูลลูกค้า งานบริการ และ Engagement', '/admin/customers',  'Building2',    'INTERNAL', 'ผู้ดูแลระบบ', ARRAY['catalog.write'], true, 101),
  (gen_random_uuid(), 'admin-calendar',   'วันหยุดและนโยบาย',     'วันหยุด ตารางงาน ปิดงวด นโยบายบันทึกเวลา', '/admin/calendar',   'CalendarCog',  'INTERNAL', 'ผู้ดูแลระบบ', ARRAY['calendar.write'], true, 102),
  (gen_random_uuid(), 'admin-employees',  'พนักงานและสิทธิ์',     'พนักงาน ทีม บทบาท อัตราต้นทุน',          '/admin/employees',  'Users',        'INTERNAL', 'ผู้ดูแลระบบ', ARRAY['employee.admin','role.admin'], true, 103),
  (gen_random_uuid(), 'admin-onboarding', 'งานรับพนักงานใหม่',    'Checklist รับ/ออกพนักงาน',               '/admin/onboarding', 'ListChecks',   'INTERNAL', 'ผู้ดูแลระบบ', ARRAY['onboarding.manage'], true, 104)
ON CONFLICT ("key") DO NOTHING;

-- Existing internal pages: same names/permissions as the old sidebar.
UPDATE "app_link" SET "name" = 'บันทึกเวลา', "sort_order" = 2 WHERE "key" = 'time-report';
UPDATE "app_link" SET "sort_order" = 3 WHERE "key" = 'meetings';
UPDATE "app_link" SET "sort_order" = 4 WHERE "key" = 'announcements';
UPDATE "app_link" SET "required_permissions" = ARRAY['report.team.read','report.all.read'], "sort_order" = 5 WHERE "key" = 'reports';
UPDATE "app_link" SET "name" = 'อุปกรณ์ IT', "sort_order" = 40 WHERE "key" = 'it-asset';
