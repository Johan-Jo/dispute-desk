-- Add lifecycle phase column to disputes.
-- Phase is synced from Shopify's ShopifyPaymentsDispute.type field:
--   'inquiry'    — pre-chargeback, merchant can resolve before escalation
--   'chargeback' — formal dispute requiring evidence submission
-- NULL means unknown (legacy data or API version without type field).

ALTER TABLE disputes ADD COLUMN phase text;

CREATE INDEX idx_disputes_phase ON disputes(phase);

-- Backfill from raw_snapshot where the Shopify type was captured.
UPDATE disputes
SET phase = LOWER(raw_snapshot->>'type')
WHERE raw_snapshot->>'type' IS NOT NULL
  AND phase IS NULL;

-- Remaining rows stay NULL (unknown).
-- The UI must handle NULL phase gracefully — no silent reclassification.
