-- Add `three_ds_authenticated` to shopify_orders so we can surface
-- a per-shop 3DS-authentication-rate KPI on the Risk Intelligence
-- page and track it month-over-month.
--
-- Captured at ingest time by reading OrderTransaction.receiptJson
-- (Shopify Payments only — the receipt shape is gateway-specific
-- per the existing lib/packs/sources/threeDSecureSource.ts contract).
-- Null = unknown / non-Shopify-Payments / 3DS not used / receipt
-- shape unparseable. True = 3DS authenticated successfully. False =
-- 3DS was attempted/used but did not authenticate (rare; usually
-- the column is null instead).
--
-- NOT subject to the risk_*_initial immutability trigger — this is
-- a fact about the transaction, not a risk-classification snapshot.
-- Re-runs of backfill may legitimately re-write it (e.g. if Shopify
-- proxies a later receipt).

alter table shopify_orders
  add column if not exists three_ds_authenticated boolean;

comment on column shopify_orders.three_ds_authenticated is
  'Whether the order''s primary Shopify Payments transaction completed 3-D Secure authentication. NULL when unknown / non-Shopify-Payments / receipt unparseable. Captured from OrderTransaction.receiptJson at ingest.';

-- Partial index for the KPI query: count of authenticated orders
-- per shop, scoped by processed_at date range.
create index if not exists shopify_orders_three_ds_shop_processed_idx
  on shopify_orders (shop_id, processed_at)
  where three_ds_authenticated = true;
