-- Backfill default reason_template_mappings with the maintainer's chosen
-- templates for both dispute phases (inquiry + chargeback). Same template
-- applies to both phases today — there are no inquiry-specific template
-- variants yet, and the schema already supports phase-specific mappings
-- when those variants ship.
--
-- Mapping rationale:
--   FRAUDULENT / UNRECOGNIZED / DEBIT_NOT_AUTHORIZED  -> fraud_standard
--   PRODUCT_NOT_RECEIVED                              -> pnr_with_tracking
--   PRODUCT_UNACCEPTABLE                              -> not_as_described_quality
--   SUBSCRIPTION_CANCELED                             -> subscription_canceled
--   CREDIT_NOT_PROCESSED                              -> credit_not_processed
--   DUPLICATE                                         -> duplicate_incorrect
--   NONCOMPLIANT                                      -> policy_forward
--   CUSTOMER_INITIATED / GENERAL                      -> general_catchall
--   BANK_CANNOT_PROCESS / INCORRECT_ACCOUNT_DETAILS / -> general_catchall
--   INSUFFICIENT_FUNDS                                   (technical/rare;
--                                                         catch-all as a
--                                                         safe minimum)
--
-- PNR Weak Proof and Digital Goods are intentionally not defaulted here.
-- PNR Weak Proof is the fallback variant when no tracking is available —
-- it belongs in the rules engine, not as a reason default. Digital Goods
-- is selected by product type, not by dispute reason.
--
-- Idempotent: re-running assigns the same template_id to the same row.

UPDATE reason_template_mappings AS rtm
SET template_id = t.id, updated_at = now()
FROM pack_templates AS t
WHERE t.slug = 'fraud_standard'
  AND rtm.reason_code IN (
    'FRAUDULENT',
    'UNRECOGNIZED',
    'DEBIT_NOT_AUTHORIZED'
  );

UPDATE reason_template_mappings AS rtm
SET template_id = t.id, updated_at = now()
FROM pack_templates AS t
WHERE t.slug = 'pnr_with_tracking'
  AND rtm.reason_code = 'PRODUCT_NOT_RECEIVED';

UPDATE reason_template_mappings AS rtm
SET template_id = t.id, updated_at = now()
FROM pack_templates AS t
WHERE t.slug = 'not_as_described_quality'
  AND rtm.reason_code = 'PRODUCT_UNACCEPTABLE';

UPDATE reason_template_mappings AS rtm
SET template_id = t.id, updated_at = now()
FROM pack_templates AS t
WHERE t.slug = 'subscription_canceled'
  AND rtm.reason_code = 'SUBSCRIPTION_CANCELED';

UPDATE reason_template_mappings AS rtm
SET template_id = t.id, updated_at = now()
FROM pack_templates AS t
WHERE t.slug = 'credit_not_processed'
  AND rtm.reason_code = 'CREDIT_NOT_PROCESSED';

UPDATE reason_template_mappings AS rtm
SET template_id = t.id, updated_at = now()
FROM pack_templates AS t
WHERE t.slug = 'duplicate_incorrect'
  AND rtm.reason_code = 'DUPLICATE';

UPDATE reason_template_mappings AS rtm
SET template_id = t.id, updated_at = now()
FROM pack_templates AS t
WHERE t.slug = 'policy_forward'
  AND rtm.reason_code = 'NONCOMPLIANT';

UPDATE reason_template_mappings AS rtm
SET template_id = t.id, updated_at = now()
FROM pack_templates AS t
WHERE t.slug = 'general_catchall'
  AND rtm.reason_code IN (
    'CUSTOMER_INITIATED',
    'GENERAL',
    'BANK_CANNOT_PROCESS',
    'INCORRECT_ACCOUNT_DETAILS',
    'INSUFFICIENT_FUNDS'
  );
