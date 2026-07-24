-- Persist Shopify `Order.client_details` device elements for Visa
-- Compelling Evidence 3.0 (CE3.0) matching.
--
-- CE3.0 (Visa 10.4 remedy) requires 2+ prior undisputed transactions in a
-- 120-365 day window sharing >=2 data elements with the disputed order,
-- AT LEAST ONE of which must be IP address or device ID. We already store
-- `client_ip` (73% coverage); this adds the device-side element.
--
-- Measured on prod 2026-07-23 (scripts/ce3-client-details-spike.mjs, 1,000
-- most-recent blume-box orders):
--   browser_ip    76.0%
--   user_agent    75.3%   <- the usable device element
--   session_hash   0.0%   <- Shopify no longer populates it; do NOT use
-- Old orders are barren (8.9% in 2018), which is fine: CE3.0 priors must
-- be <365 days old.
--
-- `user_agent` is NOT a true device fingerprint (many users share a common
-- UA string), so it is a CORROBORATING element to be combined with IP —
-- never a standalone device identifier. Stored raw as returned by Shopify.
--
-- `client_details_source` records where the row's device data came from so
-- a later backfill pass can tell "never fetched" from "fetched, absent"
-- (the ~24% of orders not placed through online checkout — POS, API,
-- draft — legitimately have no client_details).

alter table shopify_order_risk_signals
  add column if not exists user_agent text,
  add column if not exists client_details_source text,
  add column if not exists client_details_fetched_at timestamptz;

comment on column shopify_order_risk_signals.user_agent is
  'Raw Order.client_details.user_agent from Shopify REST. Device-side
   element for Visa CE3.0 matching. ~75% coverage on recent orders; absent
   for POS/API/draft orders. NOT a unique device fingerprint — use only as
   a corroborating element alongside client_ip.';

comment on column shopify_order_risk_signals.client_details_source is
  'Provenance of the client_details fields: ''rest_backfill'' (one-shot
   scripts/backfill-order-client-details.mjs) or ''ingest'' (live order
   ingest). Lets a re-run distinguish never-fetched from fetched-but-empty.';

comment on column shopify_order_risk_signals.client_details_fetched_at is
  'When client_details was last fetched for this order. NULL = never
   attempted.';

-- Partial index for the CE3.0 prior-transaction lookup: find a customer''s
-- prior orders that carry a usable matching element.
create index if not exists idx_order_risk_signals_ce3_elements
  on shopify_order_risk_signals (shop_id, shopify_order_id)
  where client_ip is not null or user_agent is not null;
