-- TRCLOUD invoices are linked to customers by the TRCLOUD contact code (customer.trcloud_code).
ALTER TABLE "revenue_entry" DROP CONSTRAINT "revenue_entry_matched_by_known";
ALTER TABLE "revenue_entry"
  ADD CONSTRAINT "revenue_entry_matched_by_known" CHECK (matched_by IS NULL OR matched_by IN ('TAX_ID', 'NAME', 'MANUAL', 'TRCLOUD_CODE'));
