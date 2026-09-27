-- Flexible core: roles as data, effective-dated schedules & rates, service tree,
-- engagement periods (prepared), employee portal (announcements, app launcher).

-- CreateEnum
CREATE TYPE "RateUnit" AS ENUM ('HOUR', 'DAY');

-- CreateEnum
CREATE TYPE "AppKind" AS ENUM ('INTERNAL', 'EXTERNAL', 'PLANNED');

-- AlterTable
ALTER TABLE "engagement" ADD COLUMN     "budget_minutes" INTEGER,
ADD COLUMN     "code" TEXT,
ADD COLUMN     "manager_id" UUID,
ADD COLUMN     "period_end" DATE,
ADD COLUMN     "period_start" DATE;

-- AlterTable
ALTER TABLE "work_category" ADD COLUMN     "is_billable" BOOLEAN NOT NULL DEFAULT true,
ADD COLUMN     "parent_id" UUID,
ADD COLUMN     "sort_order" INTEGER NOT NULL DEFAULT 0;

-- CreateTable
CREATE TABLE "cost_rate" (
    "id" UUID NOT NULL,
    "level_id" UUID NOT NULL,
    "amount" DECIMAL(12,2) NOT NULL,
    "unit" "RateUnit" NOT NULL,
    "effective_from" DATE NOT NULL,
    "effective_to" DATE,

CONSTRAINT "cost_rate_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "role" (
    "id" UUID NOT NULL,
    "key" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "description" TEXT,
    "permissions" TEXT[],
    "is_system" BOOLEAN NOT NULL DEFAULT false,

CONSTRAINT "role_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "role_assignment" (
    "id" UUID NOT NULL,
    "employee_id" UUID NOT NULL,
    "role_id" UUID NOT NULL,
    "org_unit_id" UUID,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

CONSTRAINT "role_assignment_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "work_schedule" (
    "id" UUID NOT NULL,
    "name" TEXT NOT NULL,
    "weekday_minutes" INTEGER[],

CONSTRAINT "work_schedule_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "schedule_assignment" (
    "id" UUID NOT NULL,
    "schedule_id" UUID NOT NULL,
    "employee_id" UUID,
    "org_unit_id" UUID,
    "effective_from" DATE NOT NULL,
    "effective_to" DATE,

CONSTRAINT "schedule_assignment_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "announcement" (
    "id" UUID NOT NULL,
    "title" VARCHAR(200) NOT NULL,
    "body" TEXT NOT NULL,
    "requires_ack" BOOLEAN NOT NULL DEFAULT false,
    "pinned" BOOLEAN NOT NULL DEFAULT false,
    "published_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "author_id" UUID NOT NULL,
    "legacy_id" INTEGER,

CONSTRAINT "announcement_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "announcement_ack" (
    "announcement_id" UUID NOT NULL,
    "employee_id" UUID NOT NULL,
    "ack_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

CONSTRAINT "announcement_ack_pkey" PRIMARY KEY ("announcement_id","employee_id")
);

-- CreateTable
CREATE TABLE "app_link" (
    "id" UUID NOT NULL,
    "key" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "description" TEXT,
    "url" TEXT,
    "icon" TEXT NOT NULL,
    "kind" "AppKind" NOT NULL,
    "category" TEXT NOT NULL,
    "required_permission" TEXT,
    "sort_order" INTEGER NOT NULL DEFAULT 0,
    "is_active" BOOLEAN NOT NULL DEFAULT true,

CONSTRAINT "app_link_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "cost_rate_level_id_effective_from_idx" ON "cost_rate"("level_id", "effective_from");

-- CreateIndex
CREATE UNIQUE INDEX "role_key_key" ON "role"("key");

-- CreateIndex
CREATE INDEX "role_assignment_employee_id_idx" ON "role_assignment"("employee_id");

-- CreateIndex
CREATE UNIQUE INDEX "work_schedule_name_key" ON "work_schedule"("name");

-- CreateIndex
CREATE INDEX "schedule_assignment_employee_id_idx" ON "schedule_assignment"("employee_id");

-- CreateIndex
CREATE INDEX "schedule_assignment_org_unit_id_idx" ON "schedule_assignment"("org_unit_id");

-- CreateIndex
CREATE UNIQUE INDEX "announcement_legacy_id_key" ON "announcement"("legacy_id");

-- CreateIndex
CREATE INDEX "announcement_published_at_idx" ON "announcement"("published_at");

-- CreateIndex
CREATE UNIQUE INDEX "app_link_key_key" ON "app_link"("key");

-- CreateIndex
CREATE UNIQUE INDEX "engagement_code_key" ON "engagement"("code");

-- CreateIndex
CREATE INDEX "engagement_customer_id_idx" ON "engagement"("customer_id");

-- AddForeignKey
ALTER TABLE "cost_rate" ADD CONSTRAINT "cost_rate_level_id_fkey" FOREIGN KEY ("level_id") REFERENCES "employee_level"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "role_assignment" ADD CONSTRAINT "role_assignment_employee_id_fkey" FOREIGN KEY ("employee_id") REFERENCES "employee"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "role_assignment" ADD CONSTRAINT "role_assignment_role_id_fkey" FOREIGN KEY ("role_id") REFERENCES "role"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "role_assignment" ADD CONSTRAINT "role_assignment_org_unit_id_fkey" FOREIGN KEY ("org_unit_id") REFERENCES "org_unit"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "schedule_assignment" ADD CONSTRAINT "schedule_assignment_schedule_id_fkey" FOREIGN KEY ("schedule_id") REFERENCES "work_schedule"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "schedule_assignment" ADD CONSTRAINT "schedule_assignment_employee_id_fkey" FOREIGN KEY ("employee_id") REFERENCES "employee"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "schedule_assignment" ADD CONSTRAINT "schedule_assignment_org_unit_id_fkey" FOREIGN KEY ("org_unit_id") REFERENCES "org_unit"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "work_category" ADD CONSTRAINT "work_category_parent_id_fkey" FOREIGN KEY ("parent_id") REFERENCES "work_category"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "engagement" ADD CONSTRAINT "engagement_manager_id_fkey" FOREIGN KEY ("manager_id") REFERENCES "employee"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "announcement" ADD CONSTRAINT "announcement_author_id_fkey" FOREIGN KEY ("author_id") REFERENCES "employee"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "announcement_ack" ADD CONSTRAINT "announcement_ack_announcement_id_fkey" FOREIGN KEY ("announcement_id") REFERENCES "announcement"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "announcement_ack" ADD CONSTRAINT "announcement_ack_employee_id_fkey" FOREIGN KEY ("employee_id") REFERENCES "employee"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- ---------------------------------------------------------------------------
-- Data migration (runs before the old columns are dropped)
-- ---------------------------------------------------------------------------

-- 1) Roles become data. Same permission sets as the previous hard-coded mapping.
INSERT INTO "role" ("id", "key", "name", "description", "permissions", "is_system") VALUES
  (gen_random_uuid(), 'EMPLOYEE', 'พนักงาน',  'บันทึกเวลาของตนเอง', ARRAY['time.own.write'], true),
  (gen_random_uuid(), 'MANAGER',  'Manager',  'ดูรายงานของทีมที่ดูแล', ARRAY['time.own.write','report.team.read','report.export'], true),
  (gen_random_uuid(), 'PARTNER',  'Partner',  'ดูรายงานทั้งบริษัท', ARRAY['time.own.write','report.all.read','report.export','audit.read'], true),
  (gen_random_uuid(), 'ADMIN',    'Admin',    'ดูแลข้อมูลหลัก วันหยุด พนักงาน และสิทธิ์', ARRAY['time.own.write','report.all.read','report.export','catalog.write','calendar.write','employee.admin','role.admin','announcement.write','audit.read'], true),
  (gen_random_uuid(), 'IT',       'IT',       'จัดการบัญชีผู้ใช้ (ไม่เห็นข้อมูลเวลา)', ARRAY['time.own.write','employee.admin'], true);

INSERT INTO "role_assignment" ("id", "employee_id", "role_id")
SELECT gen_random_uuid(), e."id", r."id"
FROM "employee" e
CROSS JOIN LATERAL unnest(e."roles") AS x(k)
JOIN "role" r ON r."key" = x.k::text;

-- 2) The single "minutes per day" becomes the company-default work schedule (Mon–Fri).
INSERT INTO "work_schedule" ("id", "name", "weekday_minutes")
SELECT gen_random_uuid(), 'มาตรฐาน จันทร์–ศุกร์',
       ARRAY[t, t, t, t, t, 0, 0]
FROM (SELECT COALESCE((SELECT "daily_target_minutes" FROM "time_policy" WHERE "id" = 1), 540) AS t) s;

INSERT INTO "schedule_assignment" ("id", "schedule_id", "effective_from")
SELECT gen_random_uuid(), "id", DATE '2019-01-01' FROM "work_schedule";

-- Drop superseded structures
-- DropIndex
DROP INDEX "engagement_customer_id_work_category_id_key";

-- AlterTable
ALTER TABLE "employee" DROP COLUMN "roles";

-- AlterTable
ALTER TABLE "time_policy" DROP COLUMN "daily_target_minutes";

-- DropEnum
DROP TYPE "Role";

-- ---------------------------------------------------------------------------
-- Constraints Prisma cannot express
-- ---------------------------------------------------------------------------
CREATE EXTENSION IF NOT EXISTS btree_gist;

-- Engagements: one per customer × service × period ("no period" counts as one value → legacy behaviour).
CREATE UNIQUE INDEX "engagement_customer_category_period_key"
  ON "engagement" ("customer_id", "work_category_id", "period_start") NULLS NOT DISTINCT;
ALTER TABLE "engagement"
  ADD CONSTRAINT "engagement_period_valid" CHECK ("period_end" IS NULL OR ("period_start" IS NOT NULL AND "period_end" >= "period_start")),
  ADD CONSTRAINT "engagement_budget_positive" CHECK ("budget_minutes" IS NULL OR "budget_minutes" > 0);

-- Role assignment: no duplicate grant for the same scope.
CREATE UNIQUE INDEX "role_assignment_unique_scope"
  ON "role_assignment" ("employee_id", "role_id", "org_unit_id") NULLS NOT DISTINCT;

-- Work schedules: 7 weekdays, sane minutes.
ALTER TABLE "work_schedule"
  ADD CONSTRAINT "work_schedule_seven_days" CHECK (cardinality("weekday_minutes") = 7),
  ADD CONSTRAINT "work_schedule_minutes_range" CHECK (0 <= ALL ("weekday_minutes") AND 1440 >= ALL ("weekday_minutes"));

-- Schedule assignment: employee OR org unit OR neither (company default); periods of the same scope never overlap.
ALTER TABLE "schedule_assignment"
  ADD CONSTRAINT "schedule_assignment_single_scope" CHECK ("employee_id" IS NULL OR "org_unit_id" IS NULL),
  ADD CONSTRAINT "schedule_assignment_period_valid" CHECK ("effective_to" IS NULL OR "effective_to" >= "effective_from"),
  ADD CONSTRAINT "schedule_assignment_no_overlap" EXCLUDE USING gist (
    (COALESCE("employee_id", '00000000-0000-0000-0000-000000000000'::uuid)) WITH =,
    (COALESCE("org_unit_id", '00000000-0000-0000-0000-000000000000'::uuid)) WITH =,
    daterange("effective_from", "effective_to", '[]') WITH &&
  );

-- Cost rates: non-negative, one active rate per level at any date.
ALTER TABLE "cost_rate"
  ADD CONSTRAINT "cost_rate_amount_positive" CHECK ("amount" >= 0),
  ADD CONSTRAINT "cost_rate_period_valid" CHECK ("effective_to" IS NULL OR "effective_to" >= "effective_from"),
  ADD CONSTRAINT "cost_rate_no_overlap" EXCLUDE USING gist (
    "level_id" WITH =,
    daterange("effective_from", "effective_to", '[]') WITH &&
  );

ALTER TABLE "work_category"
  ADD CONSTRAINT "work_category_not_own_parent" CHECK ("parent_id" IS NULL OR "parent_id" <> "id");

ALTER TABLE "app_link"
  ADD CONSTRAINT "app_link_url_scheme" CHECK ("url" IS NULL OR "url" ~ '^(https?://|/)');
