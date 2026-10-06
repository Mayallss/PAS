-- Versioned meeting minutes: revisions, per-version certification, objections with quote + reply.
-- (prisma migrate diff again proposed dropping the hand-written unique indexes; removed on purpose.)
-- Tables are empty at this point (meeting module not released), so the column/enum changes are safe.

-- Old constraints reference columns/enum values that change below.
ALTER TABLE "meeting_certification" DROP CONSTRAINT IF EXISTS "meeting_certification_details";
ALTER TABLE "meeting_certification" DROP CONSTRAINT IF EXISTS "meeting_certification_positive_refs";

-- AlterEnum
BEGIN;
CREATE TYPE "CertificationStatus_new" AS ENUM ('ACCEPTED', 'OBJECTION');
ALTER TABLE "meeting_certification" ALTER COLUMN "status" TYPE "CertificationStatus_new" USING ("status"::text::"CertificationStatus_new");
ALTER TYPE "CertificationStatus" RENAME TO "CertificationStatus_old";
ALTER TYPE "CertificationStatus_new" RENAME TO "CertificationStatus";
DROP TYPE "public"."CertificationStatus_old";
COMMIT;

-- DropForeignKey
ALTER TABLE "meeting_certification" DROP CONSTRAINT "meeting_certification_resolved_by_id_fkey";

-- AlterTable
ALTER TABLE "meeting" DROP COLUMN "requires_certification",
ADD COLUMN     "certify_from_version" INTEGER NOT NULL DEFAULT 1,
ADD COLUMN     "version" INTEGER NOT NULL DEFAULT 1;

-- AlterTable
ALTER TABLE "meeting_certification" DROP CONSTRAINT "meeting_certification_pkey",
DROP COLUMN "line",
DROP COLUMN "page",
DROP COLUMN "resolution",
DROP COLUMN "resolved_at",
DROP COLUMN "resolved_by_id",
ADD COLUMN     "quote" VARCHAR(1000),
ADD COLUMN     "replied_at" TIMESTAMP(3),
ADD COLUMN     "replied_by_id" UUID,
ADD COLUMN     "reply" VARCHAR(1000),
ADD COLUMN     "version" INTEGER NOT NULL,
ADD CONSTRAINT "meeting_certification_pkey" PRIMARY KEY ("meeting_id", "employee_id", "version");

-- CreateTable
CREATE TABLE "meeting_revision" (
    "meeting_id" UUID NOT NULL,
    "version" INTEGER NOT NULL,
    "title" VARCHAR(200) NOT NULL,
    "body_html" TEXT NOT NULL,
    "change_note" VARCHAR(1000),
    "requires_recertification" BOOLEAN NOT NULL DEFAULT true,
    "author_id" UUID NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "meeting_revision_pkey" PRIMARY KEY ("meeting_id","version")
);

-- CreateIndex
CREATE INDEX "meeting_certification_meeting_id_version_idx" ON "meeting_certification"("meeting_id", "version");

-- AddForeignKey
ALTER TABLE "meeting_revision" ADD CONSTRAINT "meeting_revision_meeting_id_fkey" FOREIGN KEY ("meeting_id") REFERENCES "meeting"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "meeting_revision" ADD CONSTRAINT "meeting_revision_author_id_fkey" FOREIGN KEY ("author_id") REFERENCES "employee"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "meeting_certification" ADD CONSTRAINT "meeting_certification_replied_by_id_fkey" FOREIGN KEY ("replied_by_id") REFERENCES "employee"("id") ON DELETE SET NULL ON UPDATE CASCADE;


-- Every meeting has its v1 revision; versions only move forward.
ALTER TABLE "meeting"
  ADD CONSTRAINT "meeting_version_valid" CHECK ("version" >= 1 AND "certify_from_version" BETWEEN 1 AND "version");
ALTER TABLE "meeting_revision"
  ADD CONSTRAINT "meeting_revision_version_positive" CHECK ("version" >= 1);

-- An objection must quote the passage and say what is wrong; an acceptance carries neither, and replies only close objections.
ALTER TABLE "meeting_certification"
  ADD CONSTRAINT "meeting_certification_details" CHECK (
    ("status" = 'OBJECTION' AND "quote" IS NOT NULL AND length(trim("quote")) > 0 AND "note" IS NOT NULL AND length(trim("note")) > 0)
    OR ("status" = 'ACCEPTED' AND "quote" IS NULL AND "reply" IS NULL)
  ),
  ADD CONSTRAINT "meeting_certification_reply_complete" CHECK (("reply" IS NULL) = ("replied_at" IS NULL)),
  ADD CONSTRAINT "meeting_certification_revision_fkey" FOREIGN KEY ("meeting_id", "version") REFERENCES "meeting_revision"("meeting_id", "version") ON DELETE CASCADE;
