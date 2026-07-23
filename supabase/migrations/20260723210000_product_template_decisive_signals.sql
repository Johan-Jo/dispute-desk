-- Add the decisive "not as described" (Visa 13.3 / MC 4853) signals to
-- the T4 checklist template so they reach the scored checklist_v2.
--
-- Gap (2026-07-23, prod dispute 8f90a8f0): orderSource collects
-- `no_return_initiated`, `refund_record`, and `customer_account_info` on
-- every order, but the T4 "Not as Described" template had no rows keyed to
-- those collectors — so the fields landed in pack_json/facts_json but never
-- in checklist_v2, which is the only structure `calculateCaseStrength`
-- scores. The new `product` scoring branch (two-axis: item-matched AND
-- dispute-invalid) therefore had nothing to score. This mirrors the fix
-- already applied to the hardcoded REASON_TEMPLATES_V2.PRODUCT_UNACCEPTABLE
-- fallback in lib/automation/completeness.ts; prod uses the DB template
-- when a rule stamps pack_template_id, so both sources must carry the rows.
--
-- Post-Oct-2024 Visa: a return is a PRECONDITION to filing 13.3, so
-- `no_return_initiated` ("customer never attempted to return") is genuine
-- compelling evidence, not background. `refund_record` (already refunded →
-- moot) and `customer_account_info` (prior undisputed history) round out
-- the two axes. All three are collector-backed + recommended (never
-- blocking) — they populate automatically from order data.
--
-- Idempotent: guarded so a re-run does not duplicate rows.

INSERT INTO pack_template_items
  (template_section_id, item_type, key, label_default, required, guidance_default, sort, collector_key)
SELECT v.template_section_id, v.item_type, v.key, v.label_default, v.required, v.guidance_default, v.sort, v.collector_key
FROM (VALUES
  ('b0000000-0004-0000-0000-000000000003'::uuid, 'DOC_REQUIREMENT', 'no_return_initiated', 'Return status', false,
   'Whether the customer ever initiated a return. A return is required before this dispute type can be filed, so "no return initiated" supports the merchant''s position.', 2, 'no_return_initiated'),
  ('b0000000-0004-0000-0000-000000000003'::uuid, 'DOC_REQUIREMENT', 'refund_record', 'Refund record', false,
   'Proof of any refund already issued on the order. A processed refund makes the dispute moot.', 3, 'refund_record'),
  ('b0000000-0004-0000-0000-000000000001'::uuid, 'DOC_REQUIREMENT', 'customer_account_info', 'Customer account history', false,
   'The customer''s prior order history with the store, from Shopify.', 1, 'customer_account_info')
) AS v(template_section_id, item_type, key, label_default, required, guidance_default, sort, collector_key)
WHERE NOT EXISTS (
  SELECT 1 FROM pack_template_items pti
  WHERE pti.template_section_id = v.template_section_id
    AND pti.key = v.key
);
