-- The group has three companies on TRCLOUD (PAS, PC, PA; user decision 2026-10-09). One customer is one real client
-- and links to its contact in each company; revenue batches say which company the invoices came from, so the same
-- client's revenue from two companies is added up (and can be told apart), never treated as a duplicate.

-- CreateTable
CREATE TABLE "customer_trcloud_link" (
    "id" UUID NOT NULL,
    "customer_id" UUID NOT NULL,
    "company" TEXT NOT NULL,
    "contact_code" TEXT NOT NULL,

    CONSTRAINT "customer_trcloud_link_pkey" PRIMARY KEY ("id"),
    CONSTRAINT "customer_trcloud_link_company_check" CHECK ("company" IN ('PAS', 'PC', 'PA'))
);

-- CreateIndex
CREATE UNIQUE INDEX "customer_trcloud_link_company_contact_code_key" ON "customer_trcloud_link"("company", "contact_code");

-- CreateIndex
CREATE UNIQUE INDEX "customer_trcloud_link_customer_id_company_key" ON "customer_trcloud_link"("customer_id", "company");

-- AddForeignKey
ALTER TABLE "customer_trcloud_link" ADD CONSTRAINT "customer_trcloud_link_customer_id_fkey" FOREIGN KEY ("customer_id") REFERENCES "customer"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- Existing links were all to the first company (PAS).
INSERT INTO "customer_trcloud_link" ("id", "customer_id", "company", "contact_code")
SELECT gen_random_uuid(), "id", 'PAS', "trcloud_code" FROM "customer" WHERE "trcloud_code" IS NOT NULL;

-- DropIndex
DROP INDEX "customer_trcloud_code_key";

-- AlterTable
ALTER TABLE "customer" DROP COLUMN "trcloud_code";

-- AlterTable: TRCLOUD batches carry their company; Excel batches do not.
ALTER TABLE "revenue_batch" ADD COLUMN     "company" TEXT;
UPDATE "revenue_batch" SET "company" = 'PAS' WHERE "source" = 'API';
ALTER TABLE "revenue_batch" ADD CONSTRAINT "revenue_batch_company_check"
    CHECK (("source" = 'API') = ("company" IS NOT NULL) AND ("company" IS NULL OR "company" IN ('PAS', 'PC', 'PA')));
