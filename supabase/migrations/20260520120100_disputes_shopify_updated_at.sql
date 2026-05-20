-- 20260520120100: disputes.shopify_updated_at
--
-- Tracks the most-recent Shopify `updated_at` we've observed for the
-- dispute. The applyDisputeSnapshot diff engine rejects snapshots whose
-- shopify_updated_at is older than this column (the "stale snapshot"
-- monotonic guard).
--
-- The guard only fires when BOTH sides have a value — Shopify does not
-- guarantee updated_at on every payload, so this is one of three monotonic
-- guards, not the primary one.

alter table disputes
  add column if not exists shopify_updated_at timestamptz;

comment on column disputes.shopify_updated_at is
  'Most-recent Shopify updated_at observed for this dispute. Used by applyDisputeSnapshot to reject stale out-of-order webhook payloads.';
