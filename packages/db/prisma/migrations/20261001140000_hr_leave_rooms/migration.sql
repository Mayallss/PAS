-- CreateEnum
CREATE TYPE "LeaveUnit" AS ENUM ('DAYS', 'HOURS');

-- CreateEnum
CREATE TYPE "LeaveRequestStatus" AS ENUM ('PENDING', 'APPROVED', 'REJECTED', 'CANCELLED');

-- CreateEnum
CREATE TYPE "BookingMode" AS ENUM ('ONSITE', 'ONLINE', 'HYBRID');

-- CreateEnum
CREATE TYPE "BookingStatus" AS ENUM ('CONFIRMED', 'CANCELLED');

-- CreateEnum
CREATE TYPE "CalendarSyncStatus" AS ENUM ('PENDING', 'DONE', 'FAILED');




-- AlterTable
ALTER TABLE "time_entry" ADD COLUMN     "leave_request_id" UUID;

-- CreateTable
CREATE TABLE "leave_type" (
    "id" UUID NOT NULL,
    "key" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "work_category_id" UUID NOT NULL,
    "annual_minutes" INTEGER,
    "min_tenure_months" INTEGER NOT NULL DEFAULT 0,
    "paid" BOOLEAN NOT NULL DEFAULT true,
    "allow_hours" BOOLEAN NOT NULL DEFAULT true,
    "certificate_from_days" INTEGER,
    "applies_to" "EmploymentType"[],
    "source" TEXT,
    "color" TEXT,
    "sort_order" INTEGER NOT NULL DEFAULT 0,
    "is_active" BOOLEAN NOT NULL DEFAULT true,

    CONSTRAINT "leave_type_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "leave_entitlement" (
    "id" UUID NOT NULL,
    "employee_id" UUID NOT NULL,
    "leave_type_id" UUID NOT NULL,
    "year" INTEGER NOT NULL,
    "minutes" INTEGER NOT NULL,
    "note" TEXT,
    "set_by_id" UUID NOT NULL,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "leave_entitlement_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "leave_request" (
    "id" UUID NOT NULL,
    "employee_id" UUID NOT NULL,
    "leave_type_id" UUID NOT NULL,
    "unit" "LeaveUnit" NOT NULL,
    "start_date" DATE NOT NULL,
    "end_date" DATE NOT NULL,
    "minutes" INTEGER NOT NULL,
    "reason" VARCHAR(500) NOT NULL,
    "status" "LeaveRequestStatus" NOT NULL DEFAULT 'PENDING',
    "over_quota" BOOLEAN NOT NULL DEFAULT false,
    "document_received" BOOLEAN NOT NULL DEFAULT false,
    "decided_by_id" UUID,
    "decided_at" TIMESTAMP(3),
    "decision_note" VARCHAR(500),
    "cancelled_by_id" UUID,
    "cancelled_at" TIMESTAMP(3),
    "cancel_reason" VARCHAR(500),
    "created_by_id" UUID NOT NULL,
    "version" INTEGER NOT NULL DEFAULT 1,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "leave_request_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "leave_day" (
    "id" UUID NOT NULL,
    "request_id" UUID NOT NULL,
    "date" DATE NOT NULL,
    "minutes" INTEGER NOT NULL,

    CONSTRAINT "leave_day_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "meeting_room" (
    "id" UUID NOT NULL,
    "name" TEXT NOT NULL,
    "location" TEXT,
    "capacity" INTEGER,
    "features" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "google_resource_email" TEXT,
    "color" TEXT,
    "sort_order" INTEGER NOT NULL DEFAULT 0,
    "is_active" BOOLEAN NOT NULL DEFAULT true,
    "note" TEXT,

    CONSTRAINT "meeting_room_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "room_booking" (
    "id" UUID NOT NULL,
    "title" VARCHAR(200) NOT NULL,
    "mode" "BookingMode" NOT NULL,
    "room_id" UUID,
    "starts_at" TIMESTAMPTZ(3) NOT NULL,
    "ends_at" TIMESTAMPTZ(3) NOT NULL,
    "organizer_id" UUID NOT NULL,
    "description" VARCHAR(2000),
    "meeting_url" VARCHAR(500),
    "status" "BookingStatus" NOT NULL DEFAULT 'CONFIRMED',
    "cancelled_at" TIMESTAMP(3),
    "cancelled_by_id" UUID,
    "cancel_reason" VARCHAR(500),
    "meeting_id" UUID,
    "created_by_id" UUID NOT NULL,
    "version" INTEGER NOT NULL DEFAULT 1,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "room_booking_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "room_booking_attendee" (
    "id" UUID NOT NULL,
    "booking_id" UUID NOT NULL,
    "employee_id" UUID,
    "email" TEXT,

    CONSTRAINT "room_booking_attendee_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "calendar_sync" (
    "id" UUID NOT NULL,
    "kind" TEXT NOT NULL,
    "resource_id" UUID NOT NULL,
    "status" "CalendarSyncStatus" NOT NULL DEFAULT 'PENDING',
    "calendar_id" TEXT,
    "external_id" TEXT,
    "attempts" INTEGER NOT NULL DEFAULT 0,
    "last_error" TEXT,
    "next_attempt_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "synced_at" TIMESTAMP(3),
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "calendar_sync_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "leave_type_key_key" ON "leave_type"("key");

-- CreateIndex
CREATE UNIQUE INDEX "leave_type_work_category_id_key" ON "leave_type"("work_category_id");

-- CreateIndex
CREATE UNIQUE INDEX "leave_entitlement_employee_id_leave_type_id_year_key" ON "leave_entitlement"("employee_id", "leave_type_id", "year");

-- CreateIndex
CREATE INDEX "leave_request_employee_id_start_date_idx" ON "leave_request"("employee_id", "start_date");

-- CreateIndex
CREATE INDEX "leave_request_status_idx" ON "leave_request"("status");

-- CreateIndex
CREATE INDEX "leave_day_date_idx" ON "leave_day"("date");

-- CreateIndex
CREATE UNIQUE INDEX "leave_day_request_id_date_key" ON "leave_day"("request_id", "date");

-- CreateIndex
CREATE UNIQUE INDEX "meeting_room_name_key" ON "meeting_room"("name");

-- CreateIndex
CREATE UNIQUE INDEX "meeting_room_google_resource_email_key" ON "meeting_room"("google_resource_email");

-- CreateIndex
CREATE INDEX "room_booking_starts_at_idx" ON "room_booking"("starts_at");

-- CreateIndex
CREATE INDEX "room_booking_room_id_starts_at_idx" ON "room_booking"("room_id", "starts_at");

-- CreateIndex
CREATE UNIQUE INDEX "room_booking_attendee_booking_id_employee_id_key" ON "room_booking_attendee"("booking_id", "employee_id");

-- CreateIndex
CREATE UNIQUE INDEX "room_booking_attendee_booking_id_email_key" ON "room_booking_attendee"("booking_id", "email");

-- CreateIndex
CREATE INDEX "calendar_sync_status_next_attempt_at_idx" ON "calendar_sync"("status", "next_attempt_at");

-- CreateIndex
CREATE UNIQUE INDEX "calendar_sync_kind_resource_id_key" ON "calendar_sync"("kind", "resource_id");

-- AddForeignKey
ALTER TABLE "time_entry" ADD CONSTRAINT "time_entry_leave_request_id_fkey" FOREIGN KEY ("leave_request_id") REFERENCES "leave_request"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "leave_type" ADD CONSTRAINT "leave_type_work_category_id_fkey" FOREIGN KEY ("work_category_id") REFERENCES "work_category"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "leave_entitlement" ADD CONSTRAINT "leave_entitlement_employee_id_fkey" FOREIGN KEY ("employee_id") REFERENCES "employee"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "leave_entitlement" ADD CONSTRAINT "leave_entitlement_leave_type_id_fkey" FOREIGN KEY ("leave_type_id") REFERENCES "leave_type"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "leave_entitlement" ADD CONSTRAINT "leave_entitlement_set_by_id_fkey" FOREIGN KEY ("set_by_id") REFERENCES "employee"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "leave_request" ADD CONSTRAINT "leave_request_employee_id_fkey" FOREIGN KEY ("employee_id") REFERENCES "employee"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "leave_request" ADD CONSTRAINT "leave_request_leave_type_id_fkey" FOREIGN KEY ("leave_type_id") REFERENCES "leave_type"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "leave_request" ADD CONSTRAINT "leave_request_decided_by_id_fkey" FOREIGN KEY ("decided_by_id") REFERENCES "employee"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "leave_request" ADD CONSTRAINT "leave_request_cancelled_by_id_fkey" FOREIGN KEY ("cancelled_by_id") REFERENCES "employee"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "leave_request" ADD CONSTRAINT "leave_request_created_by_id_fkey" FOREIGN KEY ("created_by_id") REFERENCES "employee"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "leave_day" ADD CONSTRAINT "leave_day_request_id_fkey" FOREIGN KEY ("request_id") REFERENCES "leave_request"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "room_booking" ADD CONSTRAINT "room_booking_room_id_fkey" FOREIGN KEY ("room_id") REFERENCES "meeting_room"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "room_booking" ADD CONSTRAINT "room_booking_organizer_id_fkey" FOREIGN KEY ("organizer_id") REFERENCES "employee"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "room_booking" ADD CONSTRAINT "room_booking_cancelled_by_id_fkey" FOREIGN KEY ("cancelled_by_id") REFERENCES "employee"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "room_booking" ADD CONSTRAINT "room_booking_meeting_id_fkey" FOREIGN KEY ("meeting_id") REFERENCES "meeting"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "room_booking" ADD CONSTRAINT "room_booking_created_by_id_fkey" FOREIGN KEY ("created_by_id") REFERENCES "employee"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "room_booking_attendee" ADD CONSTRAINT "room_booking_attendee_booking_id_fkey" FOREIGN KEY ("booking_id") REFERENCES "room_booking"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "room_booking_attendee" ADD CONSTRAINT "room_booking_attendee_employee_id_fkey" FOREIGN KEY ("employee_id") REFERENCES "employee"("id") ON DELETE SET NULL ON UPDATE CASCADE;


-- ---------------------------------------------------------------------------
-- Hand-written integrity rules (docs/09)
-- ---------------------------------------------------------------------------

ALTER TABLE "leave_type"
  ADD CONSTRAINT "leave_type_values_valid" CHECK (
    (annual_minutes IS NULL OR annual_minutes >= 0)
    AND min_tenure_months >= 0
    AND (certificate_from_days IS NULL OR certificate_from_days > 0)
  );

ALTER TABLE "leave_entitlement"
  ADD CONSTRAINT "leave_entitlement_values_valid" CHECK (minutes >= 0 AND year BETWEEN 2000 AND 2100);

ALTER TABLE "leave_request"
  ADD CONSTRAINT "leave_request_period_valid" CHECK (end_date >= start_date AND minutes > 0),
  ADD CONSTRAINT "leave_request_hours_one_day" CHECK (unit <> 'HOURS' OR start_date = end_date),
  -- Pending: undecided. Approved / rejected: who and when. Cancelled: either (a pending or an approved request can be cancelled).
  ADD CONSTRAINT "leave_request_decision_consistent" CHECK (
    (status = 'PENDING' AND decided_at IS NULL AND decided_by_id IS NULL)
    OR (status IN ('APPROVED', 'REJECTED') AND decided_at IS NOT NULL AND decided_by_id IS NOT NULL)
    OR status = 'CANCELLED'
  ),
  ADD CONSTRAINT "leave_request_cancel_consistent" CHECK ((status = 'CANCELLED') = (cancelled_at IS NOT NULL));

ALTER TABLE "leave_day"
  ADD CONSTRAINT "leave_day_minutes_valid" CHECK (minutes > 0 AND minutes <= 1440);

CREATE INDEX "time_entry_leave_request_idx" ON "time_entry" ("leave_request_id") WHERE "leave_request_id" IS NOT NULL;

ALTER TABLE "meeting_room"
  ADD CONSTRAINT "meeting_room_capacity_valid" CHECK (capacity IS NULL OR capacity > 0);

ALTER TABLE "room_booking"
  ADD CONSTRAINT "room_booking_period_valid" CHECK (ends_at > starts_at AND ends_at - starts_at <= interval '12 hours'),
  -- Online meetings have no room; onsite / hybrid always have one.
  ADD CONSTRAINT "room_booking_room_matches_mode" CHECK ((mode = 'ONLINE') = (room_id IS NULL)),
  ADD CONSTRAINT "room_booking_cancel_consistent" CHECK ((status = 'CANCELLED') = (cancelled_at IS NOT NULL)),
  -- A room cannot be booked twice at the same time (half-open ranges: 10:00-11:00 and 11:00-12:00 do not clash).
  ADD CONSTRAINT "room_booking_no_overlap" EXCLUDE USING gist (
    room_id WITH =,
    tstzrange(starts_at, ends_at, '[)') WITH &&
  ) WHERE (status = 'CONFIRMED' AND room_id IS NOT NULL);

ALTER TABLE "room_booking_attendee"
  ADD CONSTRAINT "room_booking_attendee_one_kind" CHECK (num_nonnulls(employee_id, email) = 1),
  ADD CONSTRAINT "room_booking_attendee_email_lower" CHECK (email IS NULL OR email = lower(email));

ALTER TABLE "calendar_sync"
  ADD CONSTRAINT "calendar_sync_kind_valid" CHECK (kind IN ('room_booking', 'leave_request'));

-- ---------------------------------------------------------------------------
-- Data: leave types on the legacy leave activities (job_table 34/35/36), defaults = the legal minimum.
-- 1 day = 540 minutes (decision 2026-09-29). Dev/test databases get the same rows from the seed.
-- ---------------------------------------------------------------------------

INSERT INTO "leave_type" (id, key, name, work_category_id, annual_minutes, min_tenure_months, paid, allow_hours, certificate_from_days, applies_to, source, color, sort_order)
SELECT gen_random_uuid(), v.key, v.name, wc.id, v.minutes, v.tenure, true, true, v.cert, ARRAY[]::"EmploymentType"[], v.source, v.color, v.sort
FROM (VALUES
  (36, 'VACATION', 'ลาพักร้อน', 3240, 12, NULL::int, 'sky', 1,
   '[กฎหมาย] พ.ร.บ.คุ้มครองแรงงาน ม.30: ทำงานครบ 1 ปี มีสิทธิ์หยุดพักผ่อนประจำปีไม่น้อยกว่า 6 วันทำงาน'),
  (34, 'PERSONAL', 'ลากิจ', 1620, 0, NULL::int, 'amber', 2,
   '[กฎหมาย] ม.34: ลากิจธุระอันจำเป็นได้ไม่น้อยกว่า 3 วันทำงานต่อปี (ได้รับค่าจ้าง ม.57/1)'),
  (35, 'SICK', 'ลาป่วย', 16200, 0, 3, 'rose', 3,
   '[กฎหมาย] ม.32: ลาป่วยได้เท่าที่ป่วยจริง ลา 3 วันทำงานขึ้นไปขอใบรับรองแพทย์ได้; ม.57: ได้ค่าจ้างไม่เกิน 30 วันทำงานต่อปี')
) AS v(legacy_id, key, name, minutes, tenure, cert, color, sort, source)
JOIN "work_category" wc ON wc.legacy_id = v.legacy_id
ON CONFLICT DO NOTHING;

-- ---------------------------------------------------------------------------
-- Permissions: leave.manage (HR), room.manage (rooms + any booking). New role HR.
-- ---------------------------------------------------------------------------

INSERT INTO "role" (id, key, name, description, permissions, is_system)
VALUES (
  gen_random_uuid(), 'HR', 'HR',
  'ฝ่ายบุคคล: การลาทั้งหมด สิทธิ์วันลา พนักงาน รับเข้า/ลาออก ประกาศ และห้องประชุม',
  ARRAY['announcement.write', 'employee.admin', 'leave.manage', 'onboarding.manage', 'room.manage'],
  true
)
ON CONFLICT (key) DO NOTHING;

UPDATE "role"
SET permissions = ARRAY(SELECT DISTINCT unnest(permissions || ARRAY['leave.manage', 'room.manage']) ORDER BY 1)
WHERE key = 'ADMIN';
