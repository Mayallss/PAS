-- TRCLOUD revenue is synced on a timer, not only by a person: such batches have no creator.
ALTER TABLE "revenue_batch" ALTER COLUMN "created_by_id" DROP NOT NULL;
