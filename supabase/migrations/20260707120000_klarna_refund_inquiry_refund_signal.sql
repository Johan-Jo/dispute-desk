-- Fix: klarna_refund_inquiry (template c02) drops the refund-family and delivery
-- signals it actually collects, so a CREDIT_NOT_PROCESSED Klarna INQUIRY scores Weak
-- even when the merchant owes no refund and the goods were delivered.
--
-- Root cause (dispute #12121, cay-collective):
--   A Klarna CREDIT_NOT_PROCESSED *inquiry* makes buildPack swap to this DB
--   template (klarnaInquiryTemplateOverride → template c02). When a DB template is
--   stamped, evaluateCompletenessV2 scores ONLY that template's items (by
--   collector_key) — it does NOT fall through to the REASON_TEMPLATES_V2
--   CREDIT_NOT_PROCESSED entry (the recent completeness.ts fix). Template c02
--   listed only refund_record / refund_policy / customer_communication. So the
--   pack collected `no_return_initiated` (returnStatus NO_RETURN — the grounded
--   "no refund was owed" signal, categorized moderate, signalId `refund`) and the
--   delivery rows (`shipping_tracking` / `delivery_proof`), but the template
--   excluded them from the checklist → they were never scored → 0 moderate /
--   0 strong → Weak.
--
-- Fix: add the collected-but-unscored items to template c02:
--   • no_return_initiated  → feeds the `refund` signalId into the moderate set;
--     the caseStrength `refund`-family rollup then lifts CREDIT_NOT_PROCESSED to
--     Moderate (mirrors the completeness.ts REASON_TEMPLATES_V2 CNP entry).
--   • shipping_tracking / delivery_proof → recommended, non-blocking. They surface
--     the carrier tracking link and the secondary "goods received, no refund owed"
--     signal on the pack (also fixes the missing tracking link on #12809).
--
-- All three collector_keys are already emitted by the collectors; this migration
-- only makes the template SCORE what it already gathers. Non-blocking (required
-- false) so refund_record stays the single required primary evidence.

INSERT INTO pack_template_items
  (template_section_id, item_type, key, label_default, required, guidance_default, sort, collector_key)
VALUES
  ('b0000000-0c02-0000-0000-000000000001', 'DOC_REQUIREMENT', 'no_return_initiated',
   'Return status',
   false,
   'Whether the customer initiated a return. When no return was started and no refund was issued, this supports that no refund was owed.',
   3, 'no_return_initiated'),
  ('b0000000-0c02-0000-0000-000000000001', 'DOC_REQUIREMENT', 'tracking_number',
   'Tracking status',
   false,
   'Carrier tracking status and number for this order — shows the goods reached the customer.',
   4, 'shipping_tracking'),
  ('b0000000-0c02-0000-0000-000000000001', 'DOC_REQUIREMENT', 'delivery_proof',
   'Proof of delivery',
   false,
   'Delivery date, delivery address, and recipient/signature where available — shows the customer received and kept the goods.',
   5, 'delivery_proof')
ON CONFLICT DO NOTHING;

-- Section i18n already exists for b0000000-0c02 (Refund Status). Item labels are
-- rendered from the checklist via disputes.signalLabel.* i18n keys
-- (no_return_initiated, shipping_tracking, delivery_proof all present in all 6
-- active locales), so no new item i18n rows are required here.
