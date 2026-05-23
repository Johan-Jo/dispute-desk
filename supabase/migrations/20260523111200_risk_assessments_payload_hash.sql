-- 20260523111200: risk_payload_hash dedup column on shopify_order_risk_assessments
--
-- PR-A of "Structured Capture of Shopify Pre-Authorization Risk Signals":
-- the orders/updated webhook fires for any order change (fulfillment, tags,
-- notes, address edits). Without a content-addressed hash, every fire would
-- append a fresh row to shopify_order_risk_assessments and inflate history.
--
-- The deterministic hash is computed in app code over the sorted-key
-- canonicalized risk JSON (recommendation + per-assessment riskLevel +
-- provider + sorted facts[].(description,sentiment)). See
-- lib/fraudIntel/riskPayloadHash.ts.
--
-- Backfill plan:
--   1. Add nullable column (this migration).
--   2. Run scripts/backfill-risk-payload-hash.mjs to populate existing rows.
--   3. After backfill is verified, a follow-up migration installs the partial
--      unique index `(shop_id, shopify_order_id, risk_payload_hash) WHERE
--      risk_payload_hash IS NOT NULL`.
--
-- The hash is intentionally nullable in v1 — the partial unique index is
-- deferred until the backfill script runs, and pre-PR-A rows that never get
-- backfilled are tolerated as null forever (no contract is violated; the
-- ingest path only consults the hash when populated).

alter table shopify_order_risk_assessments
  add column if not exists risk_payload_hash text;

create index if not exists shopify_order_risk_assessments_payload_hash_idx
  on shopify_order_risk_assessments (shop_id, shopify_order_id, risk_payload_hash)
  where risk_payload_hash is not null;

comment on column shopify_order_risk_assessments.risk_payload_hash is
  'SHA-256 of the canonicalized risk payload at this snapshot. Computed in app code; see lib/fraudIntel/riskPayloadHash.ts. The orders/updated webhook only appends a new row when the hash differs from the latest stored hash for (shop, order). Nullable for pre-PR-A rows.';
