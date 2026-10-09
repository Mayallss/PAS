-- The automatic TRCLOUD sync voids batches too (a month rewritten, or all its invoices cancelled): a void always has
-- a time and a reason, and a person only when one did it.
ALTER TABLE "revenue_batch" DROP CONSTRAINT "revenue_batch_void_complete";
ALTER TABLE "revenue_batch" ADD CONSTRAINT "revenue_batch_void_complete"
    CHECK ((voided_at IS NULL) = (void_reason IS NULL) AND (voided_by_id IS NULL OR voided_at IS NOT NULL));
