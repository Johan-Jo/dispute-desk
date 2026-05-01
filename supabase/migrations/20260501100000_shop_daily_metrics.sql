-- Daily per-shop snapshot of order counts and dispute counts, used to
-- compute chargeback rate (30d / 90d) on the merchant dashboard and
-- the internal admin risk view.
--
-- Why a snapshot and not a live Shopify query:
--   * Dashboard load must be O(1) — no per-render fan-out to Shopify.
--   * 30d/90d windowed rates require summing across days; doing that
--     against the raw `disputes` table for the dispute side and the
--     Shopify Admin API for the orders side would burn rate budget on
--     every page view.
--   * Card-network thresholds (Visa CMP / Mastercard ECP) are
--     monthly-windowed; merchants will want a stable, persisted figure.
--
-- Granularity: one row per (shop_id, date), in UTC. The job that fills
-- this table is responsible for choosing the date boundary; this table
-- is content-agnostic.
--
-- Numerator semantics live in the metrics util, not here. This table
-- carries both `chargeback_count` and `inquiry_count` so the merchant
-- KPI (chargebacks only) and any future broader rate can be computed
-- from the same row without a backfill.

create table if not exists shop_daily_metrics (
  shop_id uuid not null references shops(id) on delete cascade,
  date date not null,
  order_count int not null default 0,
  dispute_count int not null default 0,
  chargeback_count int not null default 0,
  inquiry_count int not null default 0,
  last_synced_at timestamptz not null default now(),
  primary key (shop_id, date)
);

-- Cross-shop date sweeps (admin-wide metrics, retention cleanup).
create index if not exists shop_daily_metrics_date_idx
  on shop_daily_metrics(date);

-- Hot path: window queries by shop, descending date.
create index if not exists shop_daily_metrics_shop_date_desc_idx
  on shop_daily_metrics(shop_id, date desc);

alter table shop_daily_metrics enable row level security;

-- No policies created intentionally. All reads/writes go through the
-- service role (job handler, metrics util, admin/dashboard APIs all use
-- getServiceClient()). With RLS enabled and no policies, anon and
-- authenticated roles see nothing — service role bypasses RLS as
-- expected. Mirrors the convention used by audit_events and
-- evidence_short_links.

comment on table shop_daily_metrics is
  'Daily per-shop snapshot powering chargeback rate (30d/90d) on dashboard and admin risk view. Populated by snapshotShopDailyMetrics job.';
comment on column shop_daily_metrics.order_count is
  'Total Shopify orders created in the UTC date. Gross — includes refunded; test orders may be present (Shopify limitation).';
comment on column shop_daily_metrics.dispute_count is
  'Disputes with disputes.initiated_at falling in the UTC date. Sum of chargeback_count + inquiry_count + any phase-unknown rows.';
comment on column shop_daily_metrics.chargeback_count is
  'Subset of dispute_count where disputes.phase = ''chargeback''. The numerator for chargeback rate.';
comment on column shop_daily_metrics.inquiry_count is
  'Subset of dispute_count where disputes.phase = ''inquiry''. Excluded from chargeback rate per PRD §3.';
comment on column shop_daily_metrics.last_synced_at is
  'When the row was last refreshed. Used by the dashboard to surface a "syncing" state and by the cron to re-attempt stale rows.';
