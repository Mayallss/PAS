-- รับ–ส่งเอกสาร (ex-DELIPAS, merged 2026-10-01). DELIPAS let every active member of the company's
-- monday account in, so every employee gets it; Admin can narrow it by editing roles (roles are data).
UPDATE "role" SET "permissions" = ARRAY(SELECT DISTINCT unnest("permissions" || ARRAY['handoff.use']) ORDER BY 1)
WHERE "key" = 'EMPLOYEE';
