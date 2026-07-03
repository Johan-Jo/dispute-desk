-- Add Delivery Confirmation as a recommended (non-required) item to the global
-- credit_not_processed (Refund / Credit Not Processed) template.
--
-- Why: for a refund dispute, delivery confirmation is legitimate SECONDARY
-- evidence — the "customer received and kept the goods, so no refund was owed"
-- argument. The case-strength engine already cites delivery as "partial
-- support" when present, but the checklist didn't list it, so a merchant had no
-- row to act on. The hardcoded REASON_TEMPLATES fallback (lib/automation/
-- completeness.ts) gets the same item in the same PR; this keeps the INSTALLED
-- playbook path in sync. Recommended, not required — refund_record stays primary.
--
-- Idempotent: skips if the item already exists on that template.

INSERT INTO pack_template_items
  (template_section_id, item_type, key, label_default, required, guidance_default, sort, collector_key)
SELECT
  'b0000000-0006-0000-0000-000000000002',  -- credit_not_processed → Processing Records section
  'DOC_REQUIREMENT',
  'delivery_proof',
  'Delivery confirmation',
  false,  -- recommended, not required
  'Optional but strengthening: proof the customer received and kept the goods (so no refund was owed). Carrier delivery confirmation, signature, or delivered-at timestamp.',
  3,
  'delivery_proof'
WHERE NOT EXISTS (
  SELECT 1 FROM pack_template_items
  WHERE template_section_id = 'b0000000-0006-0000-0000-000000000002'
    AND key = 'delivery_proof'
);
