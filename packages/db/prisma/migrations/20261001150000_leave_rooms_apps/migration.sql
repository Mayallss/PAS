-- Sidebar entries for HR leave and meeting-room booking (docs/09). Everyone sees both (no permission needed);
-- HR tools live inside /leave (tab shown with leave.manage), room admin inside /rooms (room.manage).

-- Room booking sits right after meeting minutes.
UPDATE "app_link" SET "sort_order" = "sort_order" + 1
WHERE "category" = 'งานประจำ' AND "sort_order" > COALESCE((SELECT "sort_order" FROM "app_link" WHERE "key" = 'meetings'), 0);

INSERT INTO "app_link" ("id", "key", "name", "description", "url", "icon", "kind", "category", "required_permissions", "is_admin", "sort_order") VALUES
  (gen_random_uuid(), 'rooms', 'จองห้องประชุม', 'จองห้องที่บริษัท หรือนัดประชุมออนไลน์', '/rooms', 'DoorOpen', 'INTERNAL', 'งานประจำ', ARRAY[]::TEXT[], false,
     COALESCE((SELECT "sort_order" FROM "app_link" WHERE "key" = 'meetings'), 0) + 1),
  (gen_random_uuid(), 'leave', 'การลา', 'ยื่นใบลา สิทธิ์วันลาคงเหลือ อนุมัติการลาของทีม', '/leave', 'CalendarDays', 'INTERNAL', 'บุคคล', ARRAY[]::TEXT[], false, 6)
ON CONFLICT ("key") DO NOTHING;
