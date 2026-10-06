-- Software catalogue, licences (entitlements) and seats per machine — docs/07 Phase 2 (request 2026-09-30).
-- (prisma migrate diff again proposed dropping meeting_certification_revision_fkey,
--  engagement_customer_category_period_key and role_assignment_unique_scope; removed on purpose.)

-- CreateEnum
CREATE TYPE "LicenseType" AS ENUM ('SUBSCRIPTION', 'PERPETUAL', 'OEM', 'FREE', 'TRIAL', 'OTHER');

-- CreateEnum
CREATE TYPE "LicenseMetric" AS ENUM ('PER_DEVICE', 'PER_USER', 'SITE', 'CONCURRENT');

-- CreateTable
CREATE TABLE "software" (
    "id" UUID NOT NULL,
    "name" TEXT NOT NULL,
    "publisher" TEXT,
    "category" TEXT,
    "website" TEXT,
    "notes" TEXT,
    "is_active" BOOLEAN NOT NULL DEFAULT true,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "software_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "software_license" (
    "id" UUID NOT NULL,
    "software_id" UUID NOT NULL,
    "name" TEXT NOT NULL,
    "edition" TEXT,
    "type" "LicenseType" NOT NULL,
    "metric" "LicenseMetric" NOT NULL DEFAULT 'PER_DEVICE',
    "seats" INTEGER,
    "start_date" DATE,
    "end_date" DATE,
    "auto_renew" BOOLEAN NOT NULL DEFAULT false,
    "cost" DECIMAL(12,2),
    "vendor_id" UUID,
    "reference" TEXT,
    "key_hint" TEXT,
    "attributes" JSONB NOT NULL DEFAULT '{}',
    "notes" TEXT,
    "renewed_from_id" UUID,
    "archived_at" TIMESTAMP(3),
    "version" INTEGER NOT NULL DEFAULT 1,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "software_license_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "license_assignment" (
    "id" UUID NOT NULL,
    "license_id" UUID NOT NULL,
    "asset_id" UUID,
    "employee_id" UUID,
    "start_date" DATE NOT NULL,
    "end_date" DATE,
    "installed_on" DATE,
    "seat_label" TEXT,
    "note" TEXT,
    "created_by_id" UUID NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "license_assignment_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "software_name_key" ON "software"("name");

-- CreateIndex
CREATE UNIQUE INDEX "software_license_renewed_from_id_key" ON "software_license"("renewed_from_id");

-- CreateIndex
CREATE INDEX "software_license_software_id_idx" ON "software_license"("software_id");

-- CreateIndex
CREATE INDEX "software_license_end_date_idx" ON "software_license"("end_date");

-- CreateIndex
CREATE INDEX "license_assignment_license_id_idx" ON "license_assignment"("license_id");

-- CreateIndex
CREATE INDEX "license_assignment_asset_id_idx" ON "license_assignment"("asset_id");

-- CreateIndex
CREATE INDEX "license_assignment_employee_id_idx" ON "license_assignment"("employee_id");

-- AddForeignKey
ALTER TABLE "software_license" ADD CONSTRAINT "software_license_software_id_fkey" FOREIGN KEY ("software_id") REFERENCES "software"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "software_license" ADD CONSTRAINT "software_license_vendor_id_fkey" FOREIGN KEY ("vendor_id") REFERENCES "vendor"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "software_license" ADD CONSTRAINT "software_license_renewed_from_id_fkey" FOREIGN KEY ("renewed_from_id") REFERENCES "software_license"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "license_assignment" ADD CONSTRAINT "license_assignment_license_id_fkey" FOREIGN KEY ("license_id") REFERENCES "software_license"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "license_assignment" ADD CONSTRAINT "license_assignment_asset_id_fkey" FOREIGN KEY ("asset_id") REFERENCES "asset"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "license_assignment" ADD CONSTRAINT "license_assignment_employee_id_fkey" FOREIGN KEY ("employee_id") REFERENCES "employee"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "license_assignment" ADD CONSTRAINT "license_assignment_created_by_id_fkey" FOREIGN KEY ("created_by_id") REFERENCES "employee"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- ---------------------------------------------------------------------------
-- Hand-written
-- ---------------------------------------------------------------------------

ALTER TABLE "software_license"
  ADD CONSTRAINT "software_license_seats_positive" CHECK ("seats" IS NULL OR "seats" > 0),
  ADD CONSTRAINT "software_license_period_valid" CHECK ("end_date" IS NULL OR "start_date" IS NULL OR "end_date" >= "start_date"),
  ADD CONSTRAINT "software_license_cost_nonneg" CHECK ("cost" IS NULL OR "cost" >= 0),
  ADD CONSTRAINT "software_license_key_hint_short" CHECK ("key_hint" IS NULL OR length("key_hint") <= 12);

ALTER TABLE "license_assignment"
  -- A seat belongs to exactly one machine or one person.
  ADD CONSTRAINT "license_assignment_one_target" CHECK (num_nonnulls("asset_id", "employee_id") = 1),
  ADD CONSTRAINT "license_assignment_period_valid" CHECK ("end_date" IS NULL OR "end_date" >= "start_date");

-- One active seat of the same licence per machine / per person.
CREATE UNIQUE INDEX "license_assignment_active_asset_key" ON "license_assignment" ("license_id", "asset_id") WHERE "end_date" IS NULL AND "asset_id" IS NOT NULL;
CREATE UNIQUE INDEX "license_assignment_active_employee_key" ON "license_assignment" ("license_id", "employee_id") WHERE "end_date" IS NULL AND "employee_id" IS NOT NULL;
