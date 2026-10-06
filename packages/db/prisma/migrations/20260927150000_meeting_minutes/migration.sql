-- Meeting minutes with certification / correction requests (legacy meet, meet_agree).
-- NOTE: prisma migrate diff also proposed dropping the hand-written unique indexes
-- engagement_customer_category_period_key and role_assignment_unique_scope; those drops were removed on purpose.

-- CreateEnum
CREATE TYPE "CertificationStatus" AS ENUM ('ACCEPTED', 'CORRECTION');

-- CreateTable
CREATE TABLE "meeting" (
    "id" UUID NOT NULL,
    "title" VARCHAR(200) NOT NULL,
    "meeting_date" DATE NOT NULL,
    "start_time" VARCHAR(5),
    "end_time" VARCHAR(5),
    "location" VARCHAR(120),
    "body_html" TEXT NOT NULL,
    "requires_certification" BOOLEAN NOT NULL DEFAULT true,
    "author_id" UUID NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,
    "legacy_id" INTEGER,

    CONSTRAINT "meeting_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "meeting_certification" (
    "meeting_id" UUID NOT NULL,
    "employee_id" UUID NOT NULL,
    "status" "CertificationStatus" NOT NULL,
    "page" INTEGER,
    "line" INTEGER,
    "note" VARCHAR(2000),
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,
    "resolved_at" TIMESTAMP(3),
    "resolved_by_id" UUID,
    "resolution" VARCHAR(1000),

    CONSTRAINT "meeting_certification_pkey" PRIMARY KEY ("meeting_id","employee_id")
);

-- CreateIndex
CREATE UNIQUE INDEX "meeting_legacy_id_key" ON "meeting"("legacy_id");

-- CreateIndex
CREATE INDEX "meeting_meeting_date_idx" ON "meeting"("meeting_date");

-- AddForeignKey
ALTER TABLE "meeting" ADD CONSTRAINT "meeting_author_id_fkey" FOREIGN KEY ("author_id") REFERENCES "employee"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "meeting_certification" ADD CONSTRAINT "meeting_certification_meeting_id_fkey" FOREIGN KEY ("meeting_id") REFERENCES "meeting"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "meeting_certification" ADD CONSTRAINT "meeting_certification_employee_id_fkey" FOREIGN KEY ("employee_id") REFERENCES "employee"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "meeting_certification" ADD CONSTRAINT "meeting_certification_resolved_by_id_fkey" FOREIGN KEY ("resolved_by_id") REFERENCES "employee"("id") ON DELETE SET NULL ON UPDATE CASCADE;


-- Constraints Prisma cannot express
ALTER TABLE "meeting"
  ADD CONSTRAINT "meeting_time_format" CHECK (
    ("start_time" IS NULL OR "start_time" ~ '^([01][0-9]|2[0-3]):[0-5][0-9]$') AND
    ("end_time" IS NULL OR "end_time" ~ '^([01][0-9]|2[0-3]):[0-5][0-9]$') AND
    ("start_time" IS NULL OR "end_time" IS NULL OR "end_time" > "start_time")
  );

-- A correction request must say what is wrong; an acceptance carries no correction details.
ALTER TABLE "meeting_certification"
  ADD CONSTRAINT "meeting_certification_details" CHECK (
    ("status" = 'CORRECTION' AND "note" IS NOT NULL AND length(trim("note")) > 0) OR
    ("status" = 'ACCEPTED' AND "page" IS NULL AND "line" IS NULL AND "resolved_at" IS NULL)
  ),
  ADD CONSTRAINT "meeting_certification_positive_refs" CHECK (("page" IS NULL OR "page" > 0) AND ("line" IS NULL OR "line" > 0));

-- New permission for the meeting-minutes module (roles are data).
UPDATE "role" SET "permissions" = array_append("permissions", 'meeting.write')
WHERE "key" = 'ADMIN' AND NOT ('meeting.write' = ANY("permissions"));
