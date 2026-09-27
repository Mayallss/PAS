-- CreateEnum
CREATE TYPE "Role" AS ENUM ('EMPLOYEE', 'MANAGER', 'PARTNER', 'ADMIN', 'IT');

-- CreateEnum
CREATE TYPE "EmploymentStatus" AS ENUM ('ACTIVE', 'INACTIVE');

-- CreateEnum
CREATE TYPE "WorkCategoryType" AS ENUM ('CLIENT_WORK', 'INTERNAL', 'MEETING', 'LEAVE');

-- CreateEnum
CREATE TYPE "TimeEntryStatus" AS ENUM ('DRAFT', 'SUBMITTED', 'APPROVED', 'REJECTED', 'MIGRATED');

-- CreateTable
CREATE TABLE "org_unit" (
    "id" UUID NOT NULL,
    "name" TEXT NOT NULL,
    "parent_id" UUID,
    "manager_id" UUID,
    "legacy_id" INTEGER,

    CONSTRAINT "org_unit_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "employee_level" (
    "id" UUID NOT NULL,
    "code" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "sort_order" INTEGER NOT NULL DEFAULT 0,
    "legacy_id" INTEGER,

    CONSTRAINT "employee_level_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "employee" (
    "id" UUID NOT NULL,
    "full_name" TEXT NOT NULL,
    "nickname" TEXT,
    "email" TEXT,
    "oidc_subject" TEXT,
    "roles" "Role"[] DEFAULT ARRAY['EMPLOYEE']::"Role"[],
    "status" "EmploymentStatus" NOT NULL DEFAULT 'ACTIVE',
    "start_date" DATE,
    "org_unit_id" UUID,
    "level_id" UUID,
    "legacy_id" INTEGER,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "employee_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "session" (
    "id" TEXT NOT NULL,
    "employee_id" UUID NOT NULL,
    "csrf_token" TEXT NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "expires_at" TIMESTAMP(3) NOT NULL,
    "last_seen_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "ip" TEXT,
    "user_agent" TEXT,

    CONSTRAINT "session_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "customer" (
    "id" UUID NOT NULL,
    "code" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "tax_id" TEXT,
    "address" TEXT,
    "account_owner_id" UUID,
    "is_active" BOOLEAN NOT NULL DEFAULT true,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "customer_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "work_category" (
    "id" UUID NOT NULL,
    "name" TEXT NOT NULL,
    "type" "WorkCategoryType" NOT NULL DEFAULT 'CLIENT_WORK',
    "is_active" BOOLEAN NOT NULL DEFAULT true,
    "legacy_id" INTEGER,

    CONSTRAINT "work_category_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "engagement" (
    "id" UUID NOT NULL,
    "customer_id" UUID NOT NULL,
    "work_category_id" UUID NOT NULL,
    "is_active" BOOLEAN NOT NULL DEFAULT true,

    CONSTRAINT "engagement_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "time_entry" (
    "id" UUID NOT NULL,
    "employee_id" UUID NOT NULL,
    "engagement_id" UUID NOT NULL,
    "work_date" DATE NOT NULL,
    "duration_minutes" INTEGER NOT NULL,
    "description" VARCHAR(500),
    "status" "TimeEntryStatus" NOT NULL DEFAULT 'DRAFT',
    "version" INTEGER NOT NULL DEFAULT 1,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "created_by_id" UUID NOT NULL,
    "updated_at" TIMESTAMP(3) NOT NULL,
    "updated_by_id" UUID NOT NULL,
    "deleted_at" TIMESTAMP(3),
    "deleted_by_id" UUID,
    "legacy_ids" INTEGER[] DEFAULT ARRAY[]::INTEGER[],

    CONSTRAINT "time_entry_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "holiday" (
    "id" UUID NOT NULL,
    "date" DATE NOT NULL,
    "minutes" INTEGER NOT NULL DEFAULT 540,
    "description" TEXT NOT NULL,

    CONSTRAINT "holiday_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "period_lock" (
    "month" TEXT NOT NULL,
    "locked_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "locked_by_id" UUID NOT NULL,
    "reason" TEXT,

    CONSTRAINT "period_lock_pkey" PRIMARY KEY ("month")
);

-- CreateTable
CREATE TABLE "time_policy" (
    "id" INTEGER NOT NULL DEFAULT 1,
    "daily_target_minutes" INTEGER NOT NULL DEFAULT 540,
    "increment_minutes" INTEGER NOT NULL DEFAULT 30,
    "max_entry_minutes" INTEGER NOT NULL DEFAULT 540,
    "max_daily_minutes" INTEGER,
    "backdate_days" INTEGER,
    "future_days" INTEGER NOT NULL DEFAULT 31,

    CONSTRAINT "time_policy_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "audit_event" (
    "id" BIGSERIAL NOT NULL,
    "occurred_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "actor_id" UUID,
    "action" TEXT NOT NULL,
    "resource_type" TEXT NOT NULL,
    "resource_id" TEXT,
    "before" JSONB,
    "after" JSONB,
    "metadata" JSONB,
    "ip" TEXT,
    "request_id" TEXT,

    CONSTRAINT "audit_event_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "org_unit_legacy_id_key" ON "org_unit"("legacy_id");

-- CreateIndex
CREATE UNIQUE INDEX "employee_level_code_key" ON "employee_level"("code");

-- CreateIndex
CREATE UNIQUE INDEX "employee_level_legacy_id_key" ON "employee_level"("legacy_id");

-- CreateIndex
CREATE UNIQUE INDEX "employee_email_key" ON "employee"("email");

-- CreateIndex
CREATE UNIQUE INDEX "employee_oidc_subject_key" ON "employee"("oidc_subject");

-- CreateIndex
CREATE UNIQUE INDEX "employee_legacy_id_key" ON "employee"("legacy_id");

-- CreateIndex
CREATE INDEX "session_employee_id_idx" ON "session"("employee_id");

-- CreateIndex
CREATE UNIQUE INDEX "customer_code_key" ON "customer"("code");

-- CreateIndex
CREATE UNIQUE INDEX "work_category_legacy_id_key" ON "work_category"("legacy_id");

-- CreateIndex
CREATE UNIQUE INDEX "engagement_customer_id_work_category_id_key" ON "engagement"("customer_id", "work_category_id");

-- CreateIndex
CREATE INDEX "time_entry_employee_id_work_date_idx" ON "time_entry"("employee_id", "work_date");

-- CreateIndex
CREATE INDEX "time_entry_engagement_id_work_date_idx" ON "time_entry"("engagement_id", "work_date");

-- CreateIndex
CREATE UNIQUE INDEX "holiday_date_key" ON "holiday"("date");

-- CreateIndex
CREATE INDEX "audit_event_resource_type_resource_id_idx" ON "audit_event"("resource_type", "resource_id");

-- CreateIndex
CREATE INDEX "audit_event_actor_id_occurred_at_idx" ON "audit_event"("actor_id", "occurred_at");

-- AddForeignKey
ALTER TABLE "org_unit" ADD CONSTRAINT "org_unit_parent_id_fkey" FOREIGN KEY ("parent_id") REFERENCES "org_unit"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "org_unit" ADD CONSTRAINT "org_unit_manager_id_fkey" FOREIGN KEY ("manager_id") REFERENCES "employee"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "employee" ADD CONSTRAINT "employee_org_unit_id_fkey" FOREIGN KEY ("org_unit_id") REFERENCES "org_unit"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "employee" ADD CONSTRAINT "employee_level_id_fkey" FOREIGN KEY ("level_id") REFERENCES "employee_level"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "session" ADD CONSTRAINT "session_employee_id_fkey" FOREIGN KEY ("employee_id") REFERENCES "employee"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "customer" ADD CONSTRAINT "customer_account_owner_id_fkey" FOREIGN KEY ("account_owner_id") REFERENCES "employee"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "engagement" ADD CONSTRAINT "engagement_customer_id_fkey" FOREIGN KEY ("customer_id") REFERENCES "customer"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "engagement" ADD CONSTRAINT "engagement_work_category_id_fkey" FOREIGN KEY ("work_category_id") REFERENCES "work_category"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "time_entry" ADD CONSTRAINT "time_entry_employee_id_fkey" FOREIGN KEY ("employee_id") REFERENCES "employee"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "time_entry" ADD CONSTRAINT "time_entry_engagement_id_fkey" FOREIGN KEY ("engagement_id") REFERENCES "engagement"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- ---------------------------------------------------------------------------
-- Hand-written constraints (not expressible in Prisma schema)
-- ---------------------------------------------------------------------------

-- One live entry per (employee, engagement, day). Soft-deleted rows are excluded,
-- so the legacy "set to 0 deletes" history is preserved without blocking re-entry.
CREATE UNIQUE INDEX "time_entry_employee_engagement_date_live_key"
  ON "time_entry" ("employee_id", "engagement_id", "work_date")
  WHERE "deleted_at" IS NULL;

-- Defence in depth: the API validates policy, the database still refuses impossible values.
ALTER TABLE "time_entry"
  ADD CONSTRAINT "time_entry_duration_positive" CHECK ("duration_minutes" > 0 AND "duration_minutes" <= 1440),
  ADD CONSTRAINT "time_entry_deleted_consistent" CHECK (("deleted_at" IS NULL) = ("deleted_by_id" IS NULL));

ALTER TABLE "holiday"
  ADD CONSTRAINT "holiday_minutes_range" CHECK ("minutes" > 0 AND "minutes" <= 1440);

ALTER TABLE "period_lock"
  ADD CONSTRAINT "period_lock_month_format" CHECK ("month" ~ '^[0-9]{4}-(0[1-9]|1[0-2])$');

ALTER TABLE "time_policy"
  ADD CONSTRAINT "time_policy_single_row" CHECK ("id" = 1),
  ADD CONSTRAINT "time_policy_values" CHECK (
    "daily_target_minutes" > 0 AND "increment_minutes" > 0 AND "max_entry_minutes" > 0
    AND "max_entry_minutes" % "increment_minutes" = 0 AND "future_days" >= 0
    AND ("backdate_days" IS NULL OR "backdate_days" >= 0)
  );

-- Audit trail is append-only, even for the application's own database user.
CREATE FUNCTION audit_event_immutable() RETURNS trigger AS $$
BEGIN
  RAISE EXCEPTION 'audit_event is append-only';
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER audit_event_no_update_delete
  BEFORE UPDATE OR DELETE ON "audit_event"
  FOR EACH ROW EXECUTE FUNCTION audit_event_immutable();

CREATE TRIGGER audit_event_no_truncate
  BEFORE TRUNCATE ON "audit_event"
  FOR EACH STATEMENT EXECUTE FUNCTION audit_event_immutable();
