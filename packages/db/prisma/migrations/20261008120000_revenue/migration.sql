-- Revenue (รายได้): imported batches matched to customers; reports compare it with cost.
-- Generated with `prisma migrate diff`, then reviewed: the diff's DROPs of hand-written objects
-- (engagement_customer_category_period_key, role_assignment_unique_scope, meeting_certification_revision_fkey)
-- were removed — see README "Database migrations".

-- CreateEnum
CREATE TYPE "RevenueSource" AS ENUM ('EXCEL', 'API');

-- CreateTable
CREATE TABLE "revenue_batch" (
    "id" UUID NOT NULL,
    "source" "RevenueSource" NOT NULL,
    "file_name" TEXT,
    "external_ref" TEXT,
    "content_hash" TEXT NOT NULL,
    "period_from" DATE NOT NULL,
    "period_to" DATE NOT NULL,
    "row_count" INTEGER NOT NULL,
    "total_amount" DECIMAL(16,2) NOT NULL,
    "note" TEXT,
    "created_by_id" UUID NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "voided_at" TIMESTAMP(3),
    "voided_by_id" UUID,
    "void_reason" TEXT,

    CONSTRAINT "revenue_batch_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "revenue_entry" (
    "id" UUID NOT NULL,
    "batch_id" UUID NOT NULL,
    "row_no" INTEGER NOT NULL,
    "tax_id" TEXT,
    "company_name" TEXT NOT NULL,
    "amount" DECIMAL(16,2) NOT NULL,
    "customer_id" UUID,
    "matched_by" TEXT,

    CONSTRAINT "revenue_entry_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "revenue_batch_period_from_period_to_idx" ON "revenue_batch"("period_from", "period_to");

-- CreateIndex
CREATE UNIQUE INDEX "revenue_batch_source_external_ref_key" ON "revenue_batch"("source", "external_ref");

-- CreateIndex
CREATE INDEX "revenue_entry_batch_id_idx" ON "revenue_entry"("batch_id");

-- CreateIndex
CREATE INDEX "revenue_entry_customer_id_idx" ON "revenue_entry"("customer_id");

-- AddForeignKey
ALTER TABLE "revenue_batch" ADD CONSTRAINT "revenue_batch_created_by_id_fkey" FOREIGN KEY ("created_by_id") REFERENCES "employee"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "revenue_batch" ADD CONSTRAINT "revenue_batch_voided_by_id_fkey" FOREIGN KEY ("voided_by_id") REFERENCES "employee"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "revenue_entry" ADD CONSTRAINT "revenue_entry_batch_id_fkey" FOREIGN KEY ("batch_id") REFERENCES "revenue_batch"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "revenue_entry" ADD CONSTRAINT "revenue_entry_customer_id_fkey" FOREIGN KEY ("customer_id") REFERENCES "customer"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- Hand-written rules
ALTER TABLE "revenue_batch"
  ADD CONSTRAINT "revenue_batch_period_order" CHECK (period_from <= period_to),
  ADD CONSTRAINT "revenue_batch_external_ref_only_api" CHECK (external_ref IS NULL OR source = 'API'),
  ADD CONSTRAINT "revenue_batch_void_complete" CHECK ((voided_at IS NULL) = (voided_by_id IS NULL));
ALTER TABLE "revenue_entry"
  ADD CONSTRAINT "revenue_entry_matched_by_known" CHECK (matched_by IS NULL OR matched_by IN ('TAX_ID', 'NAME', 'MANUAL')),
  ADD CONSTRAINT "revenue_entry_matched_by_with_customer" CHECK ((customer_id IS NULL) = (matched_by IS NULL));

-- Importing revenue is Admin's by default; who sees profit is decided in code (cost.read + company-wide scope).
UPDATE "role" SET "permissions" = ARRAY(SELECT DISTINCT unnest("permissions" || ARRAY['revenue.write']) ORDER BY 1)
WHERE "key" = 'ADMIN';
