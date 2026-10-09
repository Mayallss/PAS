-- Revenue rows from TRCLOUD carry their document number and date: such a row counts on its own date.
-- (prisma migrate diff also proposed DROPs of hand-written objects — removed, see README "Database migrations".)

-- AlterTable
ALTER TABLE "revenue_entry" ADD COLUMN     "doc_date" DATE,
ADD COLUMN     "doc_no" TEXT;

-- One document is stored once per batch (a re-sync makes a new batch and voids the old one).
CREATE UNIQUE INDEX "revenue_entry_batch_doc_key" ON "revenue_entry"("batch_id", "doc_no") WHERE "doc_no" IS NOT NULL;
