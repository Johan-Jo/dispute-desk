-- Normalize pack_templates.dispute_type and packs.dispute_type from
-- the legacy short codes (FRAUD, PNR, NOT_AS_DESCRIBED, SUBSCRIPTION,
-- REFUND) to Shopify's actual dispute reason codes (FRAUDULENT,
-- PRODUCT_NOT_RECEIVED, PRODUCT_UNACCEPTABLE, SUBSCRIPTION_CANCELED,
-- CREDIT_NOT_PROCESSED).
--
-- Before this migration:
--   - Templates used: FRAUD, PNR, NOT_AS_DESCRIBED, SUBSCRIPTION,
--                     REFUND, DUPLICATE, DIGITAL, GENERAL
--   - Shopify uses:   FRAUDULENT, PRODUCT_NOT_RECEIVED,
--                     PRODUCT_UNACCEPTABLE, SUBSCRIPTION_CANCELED,
--                     CREDIT_NOT_PROCESSED, DUPLICATE, UNRECOGNIZED,
--                     CUSTOMER_INITIATED, DEBIT_NOT_AUTHORIZED, ...
--
-- A PACK_TYPE_TO_REASONS hardcoded map reconciled the two in
-- lib/coverage/deriveCoverage.ts and lib/coverage/deriveLifecycleCoverage.ts.
-- That map is deleted as part of this commit.
--
-- DIGITAL stays as-is: it's a product-type signal, not a Shopify
-- reason, and the rules engine routes it to GENERAL handling at
-- runtime via rule conditions. DUPLICATE and GENERAL also stay
-- because they already match Shopify's names.
--
-- DEV-MODE MIGRATION: this directly mutates pack_templates and packs
-- rows in place. Safe because we're pre-production; in production we
-- would need to add new rows, migrate references gradually, and
-- retire the old values over multiple releases.

UPDATE pack_templates
SET dispute_type = 'FRAUDULENT', updated_at = now()
WHERE dispute_type = 'FRAUD';

UPDATE pack_templates
SET dispute_type = 'PRODUCT_NOT_RECEIVED', updated_at = now()
WHERE dispute_type = 'PNR';

UPDATE pack_templates
SET dispute_type = 'PRODUCT_UNACCEPTABLE', updated_at = now()
WHERE dispute_type = 'NOT_AS_DESCRIBED';

UPDATE pack_templates
SET dispute_type = 'SUBSCRIPTION_CANCELED', updated_at = now()
WHERE dispute_type = 'SUBSCRIPTION';

UPDATE pack_templates
SET dispute_type = 'CREDIT_NOT_PROCESSED', updated_at = now()
WHERE dispute_type = 'REFUND';

-- Mirror the same mapping on merchant-installed pack instances.
UPDATE packs
SET dispute_type = 'FRAUDULENT', updated_at = now()
WHERE dispute_type = 'FRAUD';

UPDATE packs
SET dispute_type = 'PRODUCT_NOT_RECEIVED', updated_at = now()
WHERE dispute_type = 'PNR';

UPDATE packs
SET dispute_type = 'PRODUCT_UNACCEPTABLE', updated_at = now()
WHERE dispute_type = 'NOT_AS_DESCRIBED';

UPDATE packs
SET dispute_type = 'SUBSCRIPTION_CANCELED', updated_at = now()
WHERE dispute_type = 'SUBSCRIPTION';

UPDATE packs
SET dispute_type = 'CREDIT_NOT_PROCESSED', updated_at = now()
WHERE dispute_type = 'REFUND';
