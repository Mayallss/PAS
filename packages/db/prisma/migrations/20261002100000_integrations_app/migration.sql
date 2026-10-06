-- Admin page listing optional integrations (Google login / Calendar, monday) and what is missing while each is off.
INSERT INTO "app_link" ("id", "key", "name", "description", "url", "icon", "kind", "category", "required_permissions", "is_admin", "sort_order") VALUES
  (gen_random_uuid(), 'admin-integrations', 'การเชื่อมต่อระบบภายนอก', 'สถานะ Google / monday — ส่วนไหนยังไม่เชื่อม', '/admin/integrations', 'PlugZap', 'INTERNAL', 'ผู้ดูแลระบบ', ARRAY['role.admin','employee.admin'], true, 120)
ON CONFLICT ("key") DO NOTHING;
