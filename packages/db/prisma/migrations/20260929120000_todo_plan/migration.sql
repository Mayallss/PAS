-- Work plan (To-do) = estimate; time_entry = actual (decision 2026-09-29, see docs/06 Q-PLAN).
-- (prisma migrate diff again proposed dropping meeting_certification_revision_fkey,
--  engagement_customer_category_period_key and role_assignment_unique_scope; removed on purpose.)

-- CreateEnum
CREATE TYPE "TodoStatus" AS ENUM ('PLANNED', 'IN_PROGRESS', 'DONE', 'CANCELLED');

-- CreateEnum
CREATE TYPE "TodoPriority" AS ENUM ('LOW', 'MEDIUM', 'HIGH', 'URGENT');

-- CreateTable
CREATE TABLE "todo_item" (
    "id" UUID NOT NULL,
    "employee_id" UUID NOT NULL,
    "engagement_id" UUID NOT NULL,
    "work_date" DATE NOT NULL,
    "planned_minutes" INTEGER NOT NULL,
    "note" TEXT,
    "priority" "TodoPriority" NOT NULL DEFAULT 'MEDIUM',
    "status" "TodoStatus" NOT NULL DEFAULT 'PLANNED',
    "completed_at" TIMESTAMP(3),
    "created_by_id" UUID NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,
    "version" INTEGER NOT NULL DEFAULT 1,
    "deleted_at" TIMESTAMP(3),

    CONSTRAINT "todo_item_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "todo_item_employee_id_work_date_idx" ON "todo_item"("employee_id", "work_date");

-- CreateIndex
CREATE INDEX "todo_item_engagement_id_work_date_idx" ON "todo_item"("engagement_id", "work_date");

-- AddForeignKey
ALTER TABLE "todo_item" ADD CONSTRAINT "todo_item_employee_id_fkey" FOREIGN KEY ("employee_id") REFERENCES "employee"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "todo_item" ADD CONSTRAINT "todo_item_engagement_id_fkey" FOREIGN KEY ("engagement_id") REFERENCES "engagement"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "todo_item" ADD CONSTRAINT "todo_item_created_by_id_fkey" FOREIGN KEY ("created_by_id") REFERENCES "employee"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- ---------------------------------------------------------------------------
-- Hand-written
-- ---------------------------------------------------------------------------

ALTER TABLE "todo_item"
  ADD CONSTRAINT "todo_item_planned_minutes_range" CHECK ("planned_minutes" > 0 AND "planned_minutes" <= 1440),
  ADD CONSTRAINT "todo_item_completed_only_when_done" CHECK (("status" = 'DONE') = ("completed_at" IS NOT NULL));

-- Team leads assign work to their team (decision 2026-09-29). Roles are data: Admin can grant it to others.
UPDATE "role" SET "permissions" = ARRAY(SELECT DISTINCT unnest("permissions" || ARRAY['todo.assign']) ORDER BY 1)
WHERE "key" IN ('ADMIN', 'MANAGER');
