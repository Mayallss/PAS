-- Custom to-do items: free text, not tied to a customer/Activity; personal notes that are never counted
-- in planned hours, estimates, cost or team views (user request 2026-09-29).
-- (prisma migrate diff again proposed dropping meeting_certification_revision_fkey,
--  engagement_customer_category_period_key and role_assignment_unique_scope; removed on purpose.)

-- AlterTable
ALTER TABLE "todo_item" ADD COLUMN     "title" TEXT,
ALTER COLUMN "engagement_id" DROP NOT NULL,
ALTER COLUMN "planned_minutes" DROP NOT NULL;

-- ---------------------------------------------------------------------------
-- Hand-written
-- ---------------------------------------------------------------------------

ALTER TABLE "todo_item" DROP CONSTRAINT "todo_item_planned_minutes_range";
ALTER TABLE "todo_item"
  ADD CONSTRAINT "todo_item_planned_minutes_range" CHECK ("planned_minutes" IS NULL OR ("planned_minutes" > 0 AND "planned_minutes" <= 1440)),
  -- Either a real task with an estimate, or a custom item with a title.
  ADD CONSTRAINT "todo_item_kind_valid" CHECK (
    ("engagement_id" IS NOT NULL AND "planned_minutes" IS NOT NULL)
    OR ("engagement_id" IS NULL AND "title" IS NOT NULL AND length(btrim("title")) > 0)
  ),
  ADD CONSTRAINT "todo_item_title_length" CHECK ("title" IS NULL OR length("title") <= 200);
