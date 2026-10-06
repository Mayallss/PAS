-- Level history (a promotion need not re-price past work) + minutes-per-day for DAY rates + cost permissions (docs/06 Q5).
-- (prisma migrate diff again proposed dropping the hand-written unique indexes / FK; removed on purpose.)

-- AlterTable
ALTER TABLE "cost_rate" ADD COLUMN     "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
ADD COLUMN     "minutes_per_day" INTEGER NOT NULL DEFAULT 540;

-- CreateTable
CREATE TABLE "employee_level_history" (
    "id" UUID NOT NULL,
    "employee_id" UUID NOT NULL,
    "level_id" UUID NOT NULL,
    "effective_from" DATE NOT NULL,
    "effective_to" DATE,
    "created_by_id" UUID,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "employee_level_history_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "employee_level_history_employee_id_effective_from_idx" ON "employee_level_history"("employee_id", "effective_from");

-- AddForeignKey
ALTER TABLE "employee_level_history" ADD CONSTRAINT "employee_level_history_employee_id_fkey" FOREIGN KEY ("employee_id") REFERENCES "employee"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "employee_level_history" ADD CONSTRAINT "employee_level_history_level_id_fkey" FOREIGN KEY ("level_id") REFERENCES "employee_level"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "employee_level_history" ADD CONSTRAINT "employee_level_history_created_by_id_fkey" FOREIGN KEY ("created_by_id") REFERENCES "employee"("id") ON DELETE SET NULL ON UPDATE CASCADE;


-- ---------------------------------------------------------------------------
-- Hand-written
-- ---------------------------------------------------------------------------

ALTER TABLE "employee_level_history"
  ADD CONSTRAINT "employee_level_history_period_valid" CHECK ("effective_to" IS NULL OR "effective_to" >= "effective_from"),
  ADD CONSTRAINT "employee_level_history_no_overlap" EXCLUDE USING gist (
    "employee_id" WITH =,
    daterange("effective_from", "effective_to", '[]') WITH &&
  );

ALTER TABLE "cost_rate"
  ADD CONSTRAINT "cost_rate_minutes_per_day_range" CHECK ("minutes_per_day" BETWEEN 60 AND 1440);

-- History starts with everyone's current level (the legacy system kept no history — same numbers as before
-- until someone's level changes after go-live).
INSERT INTO "employee_level_history" ("id", "employee_id", "level_id", "effective_from")
SELECT gen_random_uuid(), "id", "level_id", COALESCE("start_date", DATE '2019-01-01')
FROM "employee" WHERE "level_id" IS NOT NULL;

-- Money is visible to Admin and Manager (decision 2026-09-28); only Admin edits rates.
UPDATE "role" SET "permissions" = ARRAY(SELECT DISTINCT unnest("permissions" || ARRAY['cost.read']) ORDER BY 1)
WHERE "key" IN ('ADMIN', 'MANAGER');
UPDATE "role" SET "permissions" = ARRAY(SELECT DISTINCT unnest("permissions" || ARRAY['cost.write']) ORDER BY 1)
WHERE "key" = 'ADMIN';
