-- Fix collector_key drift on the fraud_standard template's avs_cvv_match item.
--
-- Background: the v2 evidence pipeline's payment collector
-- (lib/packs/sources/paymentSource.ts) emits sections with
-- `fieldsProvided: ["avs_cvv_match"]`. The fraud_standard template item
-- had `key='avs_cvv_match'` (correct) but `collector_key='payment_authentication'`
-- (drift — no collector emits this key). buildPack's template-driven
-- evaluator (lib/packs/buildPack.ts:340-353) uses `collector_key ?? key`
-- to look up the field in `presentFields`, so the lookup missed and the
-- checklist row was emitted as `field='payment_authentication',
-- status='missing'` even when the collector had produced AVS=Y / CVV=M.
--
-- The workspace UI trusted the rebuilt checklist, so dispute detail
-- pages showed "Weak defence" and "no decisive bank-facing evidence is
-- available" even though the PDF (which reads `pack_json.sections`
-- directly via classifyFacts) cited the strong AVS+CVV match correctly.
-- This is the same architectural pattern flagged in commit baa3adc
-- (hasCardPayment widening) and the broader deriveDisputeView()
-- follow-up plan: `checklistV2` is a re-interpreted snapshot that can
-- disagree with the canonical `pack_json.sections`.
--
-- This migration is the targeted data-only fix that pairs with the
-- baa3adc code fix. After this runs:
--   • Any shop's fraud_standard template item with key='avs_cvv_match'
--     has `collector_key='avs_cvv_match'` (matches the collector).
--   • Existing evidence_packs are unaffected; they need a rebuild to
--     pick up the corrected lookup. The rebuild is handled
--     automatically when the merchant triggers a regenerate, when
--     buildPack runs for a new dispute, or via the admin rerun tool.
--
-- Idempotent: the WHERE clause skips rows that already have the
-- correct mapping, so re-runs are no-ops.

UPDATE pack_template_items
SET collector_key = 'avs_cvv_match'
WHERE key = 'avs_cvv_match'
  AND collector_key IS DISTINCT FROM 'avs_cvv_match';
