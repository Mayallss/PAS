-- Employee → IT requests (repair, replacement, software …), request files, one computer per person (docs/07).
-- (prisma migrate diff again proposed dropping the hand-written unique indexes / FK; removed on purpose.)

-- CreateEnum
CREATE TYPE "ServiceRequestType" AS ENUM ('REPAIR', 'REPLACEMENT', 'UPGRADE', 'SOFTWARE', 'DEVICE', 'OTHER');

-- CreateEnum
CREATE TYPE "ServiceRequestStatus" AS ENUM ('SUBMITTED', 'IN_PROGRESS', 'RESOLVED', 'REJECTED', 'CANCELLED');

-- CreateEnum
CREATE TYPE "RequestUrgency" AS ENUM ('NORMAL', 'URGENT');

-- AlterTable
ALTER TABLE "asset_category" ADD COLUMN     "one_per_person" BOOLEAN NOT NULL DEFAULT false;

-- AlterTable
ALTER TABLE "asset_event" ADD COLUMN     "service_request_id" UUID;

-- AlterTable
ALTER TABLE "attachment" ADD COLUMN     "service_request_id" UUID,
ALTER COLUMN "asset_id" DROP NOT NULL;

-- CreateTable
CREATE TABLE "service_request" (
    "id" UUID NOT NULL,
    "number" SERIAL NOT NULL,
    "type" "ServiceRequestType" NOT NULL,
    "status" "ServiceRequestStatus" NOT NULL DEFAULT 'SUBMITTED',
    "urgency" "RequestUrgency" NOT NULL DEFAULT 'NORMAL',
    "asset_id" UUID,
    "requester_id" UUID NOT NULL,
    "title" TEXT NOT NULL,
    "detail" TEXT,
    "handler_id" UUID,
    "repair_event_id" UUID,
    "resolution" TEXT,
    "closed_at" TIMESTAMP(3),
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "service_request_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "service_request_update" (
    "id" UUID NOT NULL,
    "request_id" UUID NOT NULL,
    "from_status" "ServiceRequestStatus",
    "to_status" "ServiceRequestStatus" NOT NULL,
    "note" TEXT,
    "by_id" UUID NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "service_request_update_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "service_request_number_key" ON "service_request"("number");

-- CreateIndex
CREATE INDEX "service_request_status_created_at_idx" ON "service_request"("status", "created_at");

-- CreateIndex
CREATE INDEX "service_request_requester_id_idx" ON "service_request"("requester_id");

-- CreateIndex
CREATE INDEX "service_request_asset_id_idx" ON "service_request"("asset_id");

-- CreateIndex
CREATE INDEX "service_request_update_request_id_created_at_idx" ON "service_request_update"("request_id", "created_at");

-- CreateIndex
CREATE INDEX "attachment_service_request_id_idx" ON "attachment"("service_request_id");

-- AddForeignKey
ALTER TABLE "asset_event" ADD CONSTRAINT "asset_event_service_request_id_fkey" FOREIGN KEY ("service_request_id") REFERENCES "service_request"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "attachment" ADD CONSTRAINT "attachment_service_request_id_fkey" FOREIGN KEY ("service_request_id") REFERENCES "service_request"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "service_request" ADD CONSTRAINT "service_request_asset_id_fkey" FOREIGN KEY ("asset_id") REFERENCES "asset"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "service_request" ADD CONSTRAINT "service_request_requester_id_fkey" FOREIGN KEY ("requester_id") REFERENCES "employee"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "service_request" ADD CONSTRAINT "service_request_handler_id_fkey" FOREIGN KEY ("handler_id") REFERENCES "employee"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "service_request" ADD CONSTRAINT "service_request_repair_event_id_fkey" FOREIGN KEY ("repair_event_id") REFERENCES "asset_event"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "service_request_update" ADD CONSTRAINT "service_request_update_request_id_fkey" FOREIGN KEY ("request_id") REFERENCES "service_request"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "service_request_update" ADD CONSTRAINT "service_request_update_by_id_fkey" FOREIGN KEY ("by_id") REFERENCES "employee"("id") ON DELETE RESTRICT ON UPDATE CASCADE;


-- ---------------------------------------------------------------------------
-- Hand-written
-- ---------------------------------------------------------------------------

-- A file belongs to a device, a request, or both.
ALTER TABLE "attachment"
  ADD CONSTRAINT "attachment_has_owner" CHECK ("asset_id" IS NOT NULL OR "service_request_id" IS NOT NULL);

ALTER TABLE "service_request"
  ADD CONSTRAINT "service_request_title_present" CHECK (length(trim("title")) > 0),
  ADD CONSTRAINT "service_request_closed_consistent" CHECK (("status" IN ('RESOLVED', 'REJECTED', 'CANCELLED')) = ("closed_at" IS NOT NULL));

-- One computer per person (decision 2026-09-28); monitors and other peripherals are not limited.
UPDATE "asset_category" SET "one_per_person" = true WHERE "key" IN ('NOTEBOOK', 'DESKTOP');

-- Every employee can open IT Asset now (they see their own device and send requests); IT/Admin see everything.
UPDATE "app_link" SET "required_permission" = NULL, "description" = 'เครื่องของฉัน แจ้งซ่อม และทะเบียนอุปกรณ์'
WHERE "key" = 'it-asset';
