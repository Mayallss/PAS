-- TRCLOUD contact code on customers: the contact sync fills it, invoices are linked to customers by it.
-- (prisma migrate diff also proposed DROPs of hand-written objects — removed, see README "Database migrations".)

-- AlterTable
ALTER TABLE "customer" ADD COLUMN     "trcloud_code" TEXT;

-- CreateIndex
CREATE UNIQUE INDEX "customer_trcloud_code_key" ON "customer"("trcloud_code");
