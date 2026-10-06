-- IT Asset register + employee onboarding (docs/07).
-- (prisma migrate diff again proposed dropping the hand-written unique indexes / FK; removed on purpose.)

-- CreateEnum
CREATE TYPE "EmploymentType" AS ENUM ('EMPLOYEE', 'INTERN', 'DIRECTOR', 'CONTRACTOR');

-- CreateEnum
CREATE TYPE "AssetStatus" AS ENUM ('ACTIVE', 'IN_REPAIR', 'BROKEN', 'RETIRED', 'DISPOSED', 'LOST');

-- CreateEnum
CREATE TYPE "AssignmentKind" AS ENUM ('PRIMARY', 'LOAN', 'SHARED');

-- CreateEnum
CREATE TYPE "AssetEventType" AS ENUM ('REGISTERED', 'ASSIGNED', 'RETURNED', 'STATUS_CHANGED', 'ISSUE', 'REPAIR', 'UPGRADE', 'SOFTWARE', 'INSPECTION', 'SPEC_CORRECTED', 'NOTE', 'DISPOSED');

-- CreateEnum
CREATE TYPE "AttachmentKind" AS ENUM ('RECEIPT', 'QUOTATION', 'PHOTO', 'DELIVERY_NOTE', 'WARRANTY', 'REPORT', 'OTHER');

-- CreateEnum
CREATE TYPE "ExternalAccountStatus" AS ENUM ('PENDING', 'ACTIVE', 'DISABLED');

-- CreateEnum
CREATE TYPE "CaseKind" AS ENUM ('ONBOARDING', 'OFFBOARDING');

-- CreateEnum
CREATE TYPE "TaskStatus" AS ENUM ('TODO', 'DONE', 'SKIPPED', 'NOT_APPLICABLE');

-- AlterTable
ALTER TABLE "employee" ADD COLUMN     "department_id" UUID,
ADD COLUMN     "employee_code" TEXT,
ADD COLUMN     "employment_type" "EmploymentType" NOT NULL DEFAULT 'EMPLOYEE',
ADD COLUMN     "end_date" DATE,
ADD COLUMN     "full_name_en" TEXT,
ADD COLUMN     "institution" TEXT,
ADD COLUMN     "personal_email" TEXT;

-- CreateTable
CREATE TABLE "department" (
    "id" UUID NOT NULL,
    "name" TEXT NOT NULL,
    "sort_order" INTEGER NOT NULL DEFAULT 0,
    "is_active" BOOLEAN NOT NULL DEFAULT true,

    CONSTRAINT "department_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "asset_category" (
    "id" UUID NOT NULL,
    "key" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "code_prefix" TEXT NOT NULL,
    "spec_fields" JSONB NOT NULL DEFAULT '[]',
    "sort_order" INTEGER NOT NULL DEFAULT 0,
    "is_active" BOOLEAN NOT NULL DEFAULT true,

    CONSTRAINT "asset_category_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "vendor" (
    "id" UUID NOT NULL,
    "name" TEXT NOT NULL,
    "phone" TEXT,
    "note" TEXT,

    CONSTRAINT "vendor_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "location" (
    "id" UUID NOT NULL,
    "name" TEXT NOT NULL,
    "is_active" BOOLEAN NOT NULL DEFAULT true,

    CONSTRAINT "location_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "asset" (
    "id" UUID NOT NULL,
    "code" TEXT NOT NULL,
    "category_id" UUID NOT NULL,
    "status" "AssetStatus" NOT NULL DEFAULT 'ACTIVE',
    "brand" TEXT,
    "model" TEXT,
    "serial_no" TEXT,
    "hostname" TEXT,
    "fa_code" TEXT,
    "specs" JSONB NOT NULL DEFAULT '{}',
    "purchase_date" DATE,
    "cost" DECIMAL(12,2),
    "useful_life_years" INTEGER NOT NULL DEFAULT 5,
    "warranty_until" DATE,
    "vendor_id" UUID,
    "notes" TEXT,
    "version" INTEGER NOT NULL DEFAULT 1,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "asset_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "asset_assignment" (
    "id" UUID NOT NULL,
    "asset_id" UUID NOT NULL,
    "employee_id" UUID,
    "location_id" UUID,
    "kind" "AssignmentKind" NOT NULL,
    "start_date" DATE NOT NULL,
    "end_date" DATE,
    "due_date" DATE,
    "approximate" BOOLEAN NOT NULL DEFAULT false,
    "note" TEXT,
    "created_by_id" UUID NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "asset_assignment_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "asset_event" (
    "id" UUID NOT NULL,
    "asset_id" UUID NOT NULL,
    "type" "AssetEventType" NOT NULL,
    "occurred_on" DATE NOT NULL,
    "completed_on" DATE,
    "title" TEXT NOT NULL,
    "detail" TEXT,
    "spec_diff" JSONB,
    "from_status" "AssetStatus",
    "to_status" "AssetStatus",
    "cost" DECIMAL(12,2),
    "vendor_id" UUID,
    "under_warranty" BOOLEAN,
    "employee_id" UUID,
    "recorded_by_id" UUID NOT NULL,
    "recorded_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "voided_at" TIMESTAMP(3),
    "void_reason" TEXT,

    CONSTRAINT "asset_event_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "attachment" (
    "id" UUID NOT NULL,
    "asset_id" UUID NOT NULL,
    "asset_event_id" UUID,
    "kind" "AttachmentKind" NOT NULL,
    "file_name" TEXT NOT NULL,
    "mime_type" TEXT NOT NULL,
    "size_bytes" INTEGER NOT NULL,
    "sha256" TEXT NOT NULL,
    "storage_key" TEXT NOT NULL,
    "uploaded_by_id" UUID NOT NULL,
    "uploaded_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "voided_at" TIMESTAMP(3),
    "void_reason" TEXT,

    CONSTRAINT "attachment_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "external_system" (
    "id" UUID NOT NULL,
    "key" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "identifier_label" TEXT NOT NULL,
    "identifier_unique" BOOLEAN NOT NULL DEFAULT true,
    "sort_order" INTEGER NOT NULL DEFAULT 0,
    "is_active" BOOLEAN NOT NULL DEFAULT true,

    CONSTRAINT "external_system_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "external_account" (
    "id" UUID NOT NULL,
    "system_id" UUID NOT NULL,
    "employee_id" UUID,
    "org_unit_id" UUID,
    "identifier" TEXT NOT NULL,
    "status" "ExternalAccountStatus" NOT NULL DEFAULT 'ACTIVE',
    "activated_on" DATE,
    "disabled_on" DATE,
    "note" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "external_account_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "onboarding_template_item" (
    "id" UUID NOT NULL,
    "kind" "CaseKind" NOT NULL,
    "key" TEXT NOT NULL,
    "title" TEXT NOT NULL,
    "description" TEXT,
    "system_id" UUID,
    "requires_asset" BOOLEAN NOT NULL DEFAULT false,
    "due_offset_days" INTEGER NOT NULL DEFAULT 0,
    "applies_to" "EmploymentType"[],
    "sort_order" INTEGER NOT NULL DEFAULT 0,
    "is_active" BOOLEAN NOT NULL DEFAULT true,

    CONSTRAINT "onboarding_template_item_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "onboarding_case" (
    "id" UUID NOT NULL,
    "employee_id" UUID NOT NULL,
    "kind" "CaseKind" NOT NULL,
    "opened_on" DATE NOT NULL,
    "closed_on" DATE,
    "opened_by_id" UUID NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "onboarding_case_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "onboarding_task" (
    "id" UUID NOT NULL,
    "case_id" UUID NOT NULL,
    "template_item_id" UUID,
    "title" TEXT NOT NULL,
    "due_date" DATE NOT NULL,
    "status" "TaskStatus" NOT NULL DEFAULT 'TODO',
    "external_account_id" UUID,
    "assignment_id" UUID,
    "done_by_id" UUID,
    "done_at" TIMESTAMP(3),
    "note" TEXT,
    "sort_order" INTEGER NOT NULL DEFAULT 0,

    CONSTRAINT "onboarding_task_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "department_name_key" ON "department"("name");

-- CreateIndex
CREATE UNIQUE INDEX "asset_category_key_key" ON "asset_category"("key");

-- CreateIndex
CREATE UNIQUE INDEX "vendor_name_key" ON "vendor"("name");

-- CreateIndex
CREATE UNIQUE INDEX "location_name_key" ON "location"("name");

-- CreateIndex
CREATE UNIQUE INDEX "asset_code_key" ON "asset"("code");

-- CreateIndex
CREATE UNIQUE INDEX "asset_serial_no_key" ON "asset"("serial_no");

-- CreateIndex
CREATE INDEX "asset_category_id_status_idx" ON "asset"("category_id", "status");

-- CreateIndex
CREATE INDEX "asset_assignment_asset_id_start_date_idx" ON "asset_assignment"("asset_id", "start_date");

-- CreateIndex
CREATE INDEX "asset_assignment_employee_id_idx" ON "asset_assignment"("employee_id");

-- CreateIndex
CREATE INDEX "asset_event_asset_id_occurred_on_idx" ON "asset_event"("asset_id", "occurred_on");

-- CreateIndex
CREATE UNIQUE INDEX "attachment_storage_key_key" ON "attachment"("storage_key");

-- CreateIndex
CREATE INDEX "attachment_asset_id_idx" ON "attachment"("asset_id");

-- CreateIndex
CREATE UNIQUE INDEX "external_system_key_key" ON "external_system"("key");

-- CreateIndex
CREATE INDEX "external_account_employee_id_idx" ON "external_account"("employee_id");

-- CreateIndex
CREATE UNIQUE INDEX "onboarding_template_item_key_key" ON "onboarding_template_item"("key");

-- CreateIndex
CREATE INDEX "onboarding_case_employee_id_idx" ON "onboarding_case"("employee_id");

-- CreateIndex
CREATE INDEX "onboarding_task_case_id_idx" ON "onboarding_task"("case_id");

-- CreateIndex
CREATE INDEX "onboarding_task_status_due_date_idx" ON "onboarding_task"("status", "due_date");

-- CreateIndex
CREATE UNIQUE INDEX "employee_employee_code_key" ON "employee"("employee_code");

-- AddForeignKey
ALTER TABLE "employee" ADD CONSTRAINT "employee_department_id_fkey" FOREIGN KEY ("department_id") REFERENCES "department"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "asset" ADD CONSTRAINT "asset_category_id_fkey" FOREIGN KEY ("category_id") REFERENCES "asset_category"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "asset" ADD CONSTRAINT "asset_vendor_id_fkey" FOREIGN KEY ("vendor_id") REFERENCES "vendor"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "asset_assignment" ADD CONSTRAINT "asset_assignment_asset_id_fkey" FOREIGN KEY ("asset_id") REFERENCES "asset"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "asset_assignment" ADD CONSTRAINT "asset_assignment_employee_id_fkey" FOREIGN KEY ("employee_id") REFERENCES "employee"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "asset_assignment" ADD CONSTRAINT "asset_assignment_location_id_fkey" FOREIGN KEY ("location_id") REFERENCES "location"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "asset_assignment" ADD CONSTRAINT "asset_assignment_created_by_id_fkey" FOREIGN KEY ("created_by_id") REFERENCES "employee"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "asset_event" ADD CONSTRAINT "asset_event_asset_id_fkey" FOREIGN KEY ("asset_id") REFERENCES "asset"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "asset_event" ADD CONSTRAINT "asset_event_vendor_id_fkey" FOREIGN KEY ("vendor_id") REFERENCES "vendor"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "asset_event" ADD CONSTRAINT "asset_event_employee_id_fkey" FOREIGN KEY ("employee_id") REFERENCES "employee"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "asset_event" ADD CONSTRAINT "asset_event_recorded_by_id_fkey" FOREIGN KEY ("recorded_by_id") REFERENCES "employee"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "attachment" ADD CONSTRAINT "attachment_asset_id_fkey" FOREIGN KEY ("asset_id") REFERENCES "asset"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "attachment" ADD CONSTRAINT "attachment_asset_event_id_fkey" FOREIGN KEY ("asset_event_id") REFERENCES "asset_event"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "attachment" ADD CONSTRAINT "attachment_uploaded_by_id_fkey" FOREIGN KEY ("uploaded_by_id") REFERENCES "employee"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "external_account" ADD CONSTRAINT "external_account_system_id_fkey" FOREIGN KEY ("system_id") REFERENCES "external_system"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "external_account" ADD CONSTRAINT "external_account_employee_id_fkey" FOREIGN KEY ("employee_id") REFERENCES "employee"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "external_account" ADD CONSTRAINT "external_account_org_unit_id_fkey" FOREIGN KEY ("org_unit_id") REFERENCES "org_unit"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "onboarding_template_item" ADD CONSTRAINT "onboarding_template_item_system_id_fkey" FOREIGN KEY ("system_id") REFERENCES "external_system"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "onboarding_case" ADD CONSTRAINT "onboarding_case_employee_id_fkey" FOREIGN KEY ("employee_id") REFERENCES "employee"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "onboarding_case" ADD CONSTRAINT "onboarding_case_opened_by_id_fkey" FOREIGN KEY ("opened_by_id") REFERENCES "employee"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "onboarding_task" ADD CONSTRAINT "onboarding_task_case_id_fkey" FOREIGN KEY ("case_id") REFERENCES "onboarding_case"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "onboarding_task" ADD CONSTRAINT "onboarding_task_template_item_id_fkey" FOREIGN KEY ("template_item_id") REFERENCES "onboarding_template_item"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "onboarding_task" ADD CONSTRAINT "onboarding_task_external_account_id_fkey" FOREIGN KEY ("external_account_id") REFERENCES "external_account"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "onboarding_task" ADD CONSTRAINT "onboarding_task_assignment_id_fkey" FOREIGN KEY ("assignment_id") REFERENCES "asset_assignment"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "onboarding_task" ADD CONSTRAINT "onboarding_task_done_by_id_fkey" FOREIGN KEY ("done_by_id") REFERENCES "employee"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- ---------------------------------------------------------------------------
-- Constraints Prisma cannot express
-- ---------------------------------------------------------------------------

ALTER TABLE "employee"
  ADD CONSTRAINT "employee_period_valid" CHECK ("end_date" IS NULL OR "start_date" IS NULL OR "end_date" >= "start_date");

-- Codes are upper-case letters/digits/dashes (legacy NB-0017-1, OE348 fit).
ALTER TABLE "asset"
  ADD CONSTRAINT "asset_code_format" CHECK ("code" ~ '^[A-Z0-9][A-Z0-9-]{0,39}$'),
  ADD CONSTRAINT "asset_cost_non_negative" CHECK ("cost" IS NULL OR "cost" >= 0),
  ADD CONSTRAINT "asset_useful_life_range" CHECK ("useful_life_years" BETWEEN 1 AND 50),
  ADD CONSTRAINT "asset_version_positive" CHECK ("version" >= 1),
  ADD CONSTRAINT "asset_specs_object" CHECK (jsonb_typeof("specs") = 'object');

-- One holder per period: employee XOR location; shared devices live at a location; loans have a due date;
-- periods [start, end) of the same asset never overlap (so at most one open assignment).
ALTER TABLE "asset_assignment"
  ADD CONSTRAINT "asset_assignment_single_holder" CHECK (("employee_id" IS NULL) <> ("location_id" IS NULL)),
  ADD CONSTRAINT "asset_assignment_shared_at_location" CHECK ("kind" <> 'SHARED' OR "location_id" IS NOT NULL),
  ADD CONSTRAINT "asset_assignment_loan_due" CHECK (("kind" = 'LOAN') = ("due_date" IS NOT NULL)),
  ADD CONSTRAINT "asset_assignment_period_valid" CHECK ("end_date" IS NULL OR "end_date" >= "start_date"),
  ADD CONSTRAINT "asset_assignment_no_overlap" EXCLUDE USING gist (
    "asset_id" WITH =,
    daterange("start_date", "end_date", '[)') WITH &&
  );

ALTER TABLE "asset_event"
  ADD CONSTRAINT "asset_event_completed_after_start" CHECK ("completed_on" IS NULL OR "completed_on" >= "occurred_on"),
  ADD CONSTRAINT "asset_event_cost_non_negative" CHECK ("cost" IS NULL OR "cost" >= 0),
  ADD CONSTRAINT "asset_event_void_complete" CHECK (("voided_at" IS NULL) = ("void_reason" IS NULL));

ALTER TABLE "attachment"
  ADD CONSTRAINT "attachment_size_positive" CHECK ("size_bytes" > 0),
  ADD CONSTRAINT "attachment_void_complete" CHECK (("voided_at" IS NULL) = ("void_reason" IS NULL));

ALTER TABLE "external_account"
  ADD CONSTRAINT "external_account_single_owner" CHECK (("employee_id" IS NULL) <> ("org_unit_id" IS NULL)),
  ADD CONSTRAINT "external_account_identifier_present" CHECK (length(trim("identifier")) > 0);

ALTER TABLE "onboarding_case"
  ADD CONSTRAINT "onboarding_case_period_valid" CHECK ("closed_on" IS NULL OR "closed_on" >= "opened_on");
-- At most one open case of each kind per person.
CREATE UNIQUE INDEX "onboarding_case_one_open_key" ON "onboarding_case" ("employee_id", "kind") WHERE "closed_on" IS NULL;

ALTER TABLE "onboarding_task"
  ADD CONSTRAINT "onboarding_task_done_consistent" CHECK (("status" = 'TODO') = ("done_at" IS NULL));

ALTER TABLE "onboarding_template_item"
  ADD CONSTRAINT "onboarding_template_due_offset_range" CHECK ("due_offset_days" BETWEEN 0 AND 365);

-- ---------------------------------------------------------------------------
-- Reference data (editable afterwards)
-- ---------------------------------------------------------------------------

INSERT INTO "department" ("id", "name", "sort_order") VALUES
  (gen_random_uuid(), 'บัญชี', 1),
  (gen_random_uuid(), 'ธุรการ', 2),
  (gen_random_uuid(), 'ทะเบียน', 3),
  (gen_random_uuid(), 'ผู้ตรวจสอบบัญชี (Audit)', 4),
  (gen_random_uuid(), 'ตรวจสอบภายใน', 5),
  (gen_random_uuid(), 'IT', 6),
  (gen_random_uuid(), 'HR & Admin', 7);

-- Prefixes follow the legacy sheet (NB-, PC-, MO-, OE); spec fields follow its columns.
INSERT INTO "asset_category" ("id", "key", "name", "code_prefix", "spec_fields", "sort_order") VALUES
  (gen_random_uuid(), 'NOTEBOOK', 'Notebook', 'NB',
   '[{"key":"cpu","label":"CPU"},{"key":"ram","label":"RAM"},{"key":"storage","label":"HDD/SSD"},{"key":"os","label":"Windows"},{"key":"mailSync","label":"Email (Outlook sync)"}]', 1),
  (gen_random_uuid(), 'DESKTOP', 'คอมพิวเตอร์ตั้งโต๊ะ (PC)', 'PC',
   '[{"key":"cpu","label":"CPU"},{"key":"ram","label":"RAM"},{"key":"storage","label":"HDD/SSD"},{"key":"os","label":"Windows"},{"key":"mailSync","label":"Email (Outlook sync)"}]', 2),
  (gen_random_uuid(), 'SERVER', 'Server', 'SV',
   '[{"key":"cpu","label":"CPU"},{"key":"ram","label":"RAM"},{"key":"storage","label":"HDD/SSD"},{"key":"os","label":"ระบบปฏิบัติการ"}]', 3),
  (gen_random_uuid(), 'MONITOR', 'จอภาพ', 'MO',
   '[{"key":"size","label":"ขนาดจอ"},{"key":"resolution","label":"ความละเอียด"},{"key":"ports","label":"ช่องต่อ"}]', 4),
  (gen_random_uuid(), 'PRINTER', 'เครื่องพิมพ์ / สแกนเนอร์', 'PR',
   '[{"key":"printType","label":"ประเภท"},{"key":"connection","label":"การเชื่อมต่อ"},{"key":"consumable","label":"หมึก/ตลับที่ใช้"}]', 5),
  (gen_random_uuid(), 'NETWORK', 'อุปกรณ์เครือข่าย', 'NW',
   '[{"key":"ipAddress","label":"IP Address"},{"key":"macAddress","label":"MAC Address"}]', 6),
  (gen_random_uuid(), 'OTHER', 'อุปกรณ์อื่น ๆ', 'OE', '[]', 7);

INSERT INTO "external_system" ("id", "key", "name", "identifier_label", "sort_order") VALUES
  (gen_random_uuid(), 'EMAIL', 'Email PAS', 'อีเมล', 1),
  (gen_random_uuid(), 'XEROX', 'เครื่องถ่ายเอกสาร Xerox', 'User ID', 2),
  (gen_random_uuid(), 'SCAN_FOLDER', 'โฟลเดอร์สแกน', 'ชื่อโฟลเดอร์', 3),
  (gen_random_uuid(), 'TRCLOUD', 'TRCloud', 'Username', 4),
  (gen_random_uuid(), 'MAP_DRIVE', 'Map Drive', 'Username', 5);

-- Checklist = columns of the legacy workbook; "หลังจาก 3 สัปดาห์ส่ง Email, TRC, Scan" → due after 21 days.
INSERT INTO "onboarding_template_item" ("id", "kind", "key", "title", "description", "system_id", "requires_asset", "due_offset_days", "applies_to", "sort_order") VALUES
  (gen_random_uuid(), 'ONBOARDING', 'pas-login', 'เข้าสู่ระบบ PAS ได้ (Time Report, รายงานการประชุม, ประกาศ)', 'ต้องมีอีเมลองค์กรที่ใช้เข้าระบบ และบทบาทอย่างน้อยหนึ่งบทบาท', NULL, false, 0, '{}', 1),
  (gen_random_uuid(), 'ONBOARDING', 'device', 'มอบเครื่อง NB/PC และติดตั้ง', 'เลือกเครื่องจาก IT Asset — ถ้านำเครื่องมาเอง ให้ทำเครื่องหมาย "ไม่เกี่ยวข้อง"', NULL, true, 0, '{}', 2),
  (gen_random_uuid(), 'ONBOARDING', 'xerox', 'User ถ่ายเอกสาร + ตั้งชื่อ User พิมพ์ Xerox + เพิ่มเครื่องปริ้น', NULL, (SELECT "id" FROM "external_system" WHERE "key" = 'XEROX'), false, 0, '{}', 3),
  (gen_random_uuid(), 'ONBOARDING', 'antivirus', 'ติดตั้งแอนตี้ไวรัส (ESET)', NULL, NULL, false, 0, '{}', 4),
  (gen_random_uuid(), 'ONBOARDING', 'links', 'แนะนำระบบและแบบฟอร์ม (ใบพบลูกค้า, รับ-ส่งเอกสาร, IT Requests, Document Store, เบิกอุปกรณ์)', 'ลิงก์ทั้งหมดอยู่ในหน้าหลักของระบบ PAS แล้ว', NULL, false, 0, '{}', 5),
  (gen_random_uuid(), 'ONBOARDING', 'email', 'สร้าง Email PAS + ตั้งค่า Outlook', NULL, (SELECT "id" FROM "external_system" WHERE "key" = 'EMAIL'), false, 21, '{}', 6),
  (gen_random_uuid(), 'ONBOARDING', 'scan-folder', 'สร้างโฟลเดอร์สแกน', NULL, (SELECT "id" FROM "external_system" WHERE "key" = 'SCAN_FOLDER'), false, 21, '{}', 7),
  (gen_random_uuid(), 'ONBOARDING', 'trcloud', 'สร้าง User TRCloud', NULL, (SELECT "id" FROM "external_system" WHERE "key" = 'TRCLOUD'), false, 21, '{EMPLOYEE,DIRECTOR,CONTRACTOR}', 8);

-- New permissions: IT and ADMIN run onboarding and the asset register (decision 2026-09-28).
UPDATE "role" SET "permissions" = ARRAY(SELECT DISTINCT unnest("permissions" || ARRAY['asset.read','asset.write','onboarding.manage']) ORDER BY 1)
WHERE "key" IN ('ADMIN', 'IT');

-- The launcher's planned "IT Asset" tile becomes the real module.
UPDATE "app_link" SET "kind" = 'INTERNAL', "url" = '/it-assets', "required_permission" = 'asset.read', "category" = 'สำนักงาน'
WHERE "key" = 'it-asset';

