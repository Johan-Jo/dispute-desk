-- Phase 1 — Shopify Fraud Intelligence.
--
-- Persists historical Shopify orders + risk classifications so the
-- embedded dashboard can show fraud-risk exposure, operational
-- patterns, and dispute correlation as soon as backfill completes.
--
-- Architectural contract (load-bearing — do not relax):
--   1. shopify_orders.risk_level_initial / risk_recommendation_initial
--      / risk_provider_initial are IMMUTABLE after first ingest. They
--      capture risk state at the time of order processing so future
--      analytics (e.g. "low-risk-classified orders that later became
--      disputes") can never be silently rewritten by upstream churn.
--      Enforced by trigger below.
--   2. Current/updated risk state belongs in
--      shopify_order_risk_assessments — one row per
--      (shop, order, provider, snapshot_at).
--   3. shop_fraud_daily_metrics is a per-day rollup mirroring the
--      shape of shop_daily_metrics. Dashboards read from this table;
--      they never aggregate shopify_orders on the hot path.
--
-- Access pattern: service-role only. RLS enabled with no policies,
-- matching shop_daily_metrics — anon/authenticated see nothing,
-- service role bypasses.

-- ─── shopify_orders ───────────────────────────────────────────────────────
-- One row per Shopify order ingested during backfill or incremental
-- sync. Carries the immutable risk snapshot plus mutable operational
-- columns (chargeback flags, fulfillment status) reconciled by jobs.

create table shopify_orders (
  id                            uuid        primary key default gen_random_uuid(),
  shop_id                       uuid        not null references shops(id) on delete cascade,

  -- Shopify identity
  shopify_order_id              text        not null,   -- gid://shopify/Order/<n>
  shopify_order_number          text,                   -- human-friendly e.g. "#1001"

  -- timestamps (Shopify-side)
  processed_at                  timestamptz,
  created_at_shopify            timestamptz not null,
  cancelled_at                  timestamptz,
  fulfilled_at                  timestamptz,            -- first fulfillment timestamp; load-bearing for future timing analytics

  -- money
  currency                      text        not null,
  order_total                   numeric(14,2) not null,

  -- geography
  country                       text,                   -- shipping country (ISO-2)
  is_cross_border               boolean,                -- shipping country != store country
  distance_bucket               text,                   -- nullable, freeform initially (local|regional|international|long_distance_domestic|…)

  -- payment
  payment_gateway               text,

  -- order status
  financial_status              text,
  fulfillment_status            text,
  cancel_reason                 text,

  -- ── risk snapshot (IMMUTABLE after first ingest — see trigger) ──
  risk_level_initial            text,                   -- LOW | MEDIUM | HIGH | NONE | PENDING
  risk_recommendation_initial   text,                   -- ACCEPT | INVESTIGATE | REJECT | NONE
  risk_provider_initial         text,

  -- fraud protection (Shopify Protect tier captured at ingest)
  fraud_protection_level        text,                   -- fully_protected | partially_protected | not_protected | pending | not_eligible | not_available

  -- chargeback flags (denormalized for aggregation; reconciled by job
  -- from disputes table — NOT a substitute for the disputes table)
  has_chargeback                boolean     not null default false,
  chargeback_type               text,                   -- 'chargeback' | 'inquiry'
  chargeback_status             text,

  -- audit
  first_ingested_at             timestamptz not null default now(),
  updated_at                    timestamptz not null default now(),

  unique (shop_id, shopify_order_id)
);

-- Hot path: window queries by shop, descending processed_at (dashboard
-- aggregates iterate by date window).
create index shopify_orders_shop_processed_idx
  on shopify_orders (shop_id, processed_at desc);

-- Filter pushdown: risk-level breakdowns for the dashboard.
create index shopify_orders_shop_risk_idx
  on shopify_orders (shop_id, risk_level_initial)
  where risk_level_initial is not null;

-- Partial index covering the risk-to-dispute conversion query path
-- (Phase 2): "of orders classified <level>, how many became disputes".
create index shopify_orders_shop_chargeback_idx
  on shopify_orders (shop_id, risk_level_initial)
  where has_chargeback;

-- Cross-shop date sweeps (admin-wide metrics, retention cleanup).
create index shopify_orders_processed_at_idx
  on shopify_orders (processed_at);

alter table shopify_orders enable row level security;
-- No policies: service-role only. Matches shop_daily_metrics convention.

comment on table shopify_orders is
  'Historical Shopify orders with immutable risk snapshot. Populated by backfillOrders + incremental sync jobs. Dashboards aggregate via shop_fraud_daily_metrics, not this table.';
comment on column shopify_orders.risk_level_initial is
  'Shopify risk classification at first ingest. IMMUTABLE — enforced by shopify_orders_lock_initial_risk trigger. Current state lives in shopify_order_risk_assessments.';
comment on column shopify_orders.fulfilled_at is
  'First fulfillment timestamp. Required for future timing analytics (time-to-fulfillment after high-risk classification, instant-vs-delayed patterns).';
comment on column shopify_orders.is_cross_border is
  'True when shipping country differs from store country. Persisted at ingest so future intelligence does not require re-deriving from raw addresses.';
comment on column shopify_orders.distance_bucket is
  'Freeform classifier (local|regional|international|long_distance_domestic|…). Nullable in v1; backfilled by future ingest logic.';

-- ── Immutability trigger for risk_*_initial columns ─────────────────
-- Once any of the three risk_*_initial columns is set to a non-null
-- value, that value cannot be changed. Future ingests of the same
-- order must leave the snapshot alone and instead append rows to
-- shopify_order_risk_assessments. The trigger only rejects updates
-- that would change a previously-set non-null value — it permits the
-- initial transition from null → first-observed value.
create or replace function shopify_orders_lock_initial_risk()
returns trigger
language plpgsql
as $$
begin
  if old.risk_level_initial is not null
     and new.risk_level_initial is distinct from old.risk_level_initial then
    raise exception 'shopify_orders.risk_level_initial is immutable once set (was %, attempted %)',
      old.risk_level_initial, new.risk_level_initial
      using errcode = 'check_violation';
  end if;
  if old.risk_recommendation_initial is not null
     and new.risk_recommendation_initial is distinct from old.risk_recommendation_initial then
    raise exception 'shopify_orders.risk_recommendation_initial is immutable once set (was %, attempted %)',
      old.risk_recommendation_initial, new.risk_recommendation_initial
      using errcode = 'check_violation';
  end if;
  if old.risk_provider_initial is not null
     and new.risk_provider_initial is distinct from old.risk_provider_initial then
    raise exception 'shopify_orders.risk_provider_initial is immutable once set (was %, attempted %)',
      old.risk_provider_initial, new.risk_provider_initial
      using errcode = 'check_violation';
  end if;
  return new;
end;
$$;

create trigger shopify_orders_lock_initial_risk_trg
  before update on shopify_orders
  for each row
  execute function shopify_orders_lock_initial_risk();

-- ─── shopify_order_risk_assessments ───────────────────────────────────────
-- Per-provider, per-snapshot risk assessment history. One order can
-- have multiple providers (Shopify default + apps), and each provider
-- can revise its assessment over time. Phase 1 only writes the most
-- recent observation; Phase 2 analytics will join the latest row per
-- (order, provider).

create table shopify_order_risk_assessments (
  id                  uuid        primary key default gen_random_uuid(),
  shop_id             uuid        not null references shops(id) on delete cascade,
  shopify_order_id    text        not null,
  provider            text        not null,
  risk_level          text,
  recommendation      text,
  facts_json          jsonb,
  fact_sentiments     jsonb,
  assessed_at         timestamptz,
  snapshot_at         timestamptz not null default now(),
  unique (shop_id, shopify_order_id, provider, snapshot_at)
);

create index shopify_order_risk_assessments_lookup_idx
  on shopify_order_risk_assessments (shop_id, shopify_order_id, snapshot_at desc);

alter table shopify_order_risk_assessments enable row level security;
-- No policies: service-role only.

comment on table shopify_order_risk_assessments is
  'Per-provider risk assessment history for Shopify orders. Mutable; current state derived as latest snapshot_at per (order, provider). Initial snapshot still lives on shopify_orders.risk_level_initial.';

-- ─── shop_fraud_daily_metrics ─────────────────────────────────────────────
-- Per-day rollup parallel to shop_daily_metrics. Powers fraud KPI row
-- on embedded dashboard with O(1) window aggregation.

create table shop_fraud_daily_metrics (
  shop_id                       uuid        not null references shops(id) on delete cascade,
  date                          date        not null,
  orders_total                  int         not null default 0,
  orders_low                    int         not null default 0,
  orders_medium                 int         not null default 0,
  orders_high                   int         not null default 0,
  orders_none                   int         not null default 0,
  orders_pending                int         not null default 0,
  orders_fulfilled_high_risk    int         not null default 0,
  fraud_disputes                int         not null default 0,
  total_disputes                int         not null default 0,
  chargebacks                   int         not null default 0,
  fully_protected_value         numeric(16,2) not null default 0,
  eligible_protected_value      numeric(16,2) not null default 0,
  last_synced_at                timestamptz not null default now(),
  primary key (shop_id, date)
);

create index shop_fraud_daily_metrics_date_idx
  on shop_fraud_daily_metrics (date);

create index shop_fraud_daily_metrics_shop_date_desc_idx
  on shop_fraud_daily_metrics (shop_id, date desc);

alter table shop_fraud_daily_metrics enable row level security;
-- No policies: service-role only.

comment on table shop_fraud_daily_metrics is
  'Per-shop per-day fraud + risk rollup. Populated by snapshotFraudDailyMetrics job. Acceptance rate denominator excludes orders_none and orders_pending — documented in dashboard tooltip.';
comment on column shop_fraud_daily_metrics.orders_none is
  'Orders Shopify did not classify (no recommendation). Excluded from acceptance-rate denominator. Tooltip must disclose this.';
comment on column shop_fraud_daily_metrics.orders_pending is
  'Orders awaiting Shopify fraud analysis. Excluded from acceptance-rate denominator. Tooltip must disclose this.';
comment on column shop_fraud_daily_metrics.orders_fulfilled_high_risk is
  'Subset of orders_high that reached fulfillment_status=fulfilled. Drives the high-risk fulfillment-rate KPI.';

-- ─── shops: historical-import tracking ────────────────────────────────────
-- New columns drive the post-install onboarding UX. Dashboard banner
-- and Initial Analysis page gate on historical_import_status='complete'
-- so merchants never see partial/misleading numbers during backfill.

alter table shops
  add column if not exists historical_import_status text
    not null default 'not_started'
    check (historical_import_status in ('not_started','in_progress','complete','failed')),
  add column if not exists historical_import_progress_pct int
    not null default 0
    check (historical_import_progress_pct between 0 and 100),
  add column if not exists historical_import_since_date date,
  add column if not exists historical_import_completed_at timestamptz,
  add column if not exists historical_import_orders_total int,
  add column if not exists historical_import_orders_processed int not null default 0,
  add column if not exists historical_import_scope_granted text
    check (historical_import_scope_granted in ('default_window','read_all_orders'));

comment on column shops.historical_import_status is
  'Phase 1 fraud-intelligence backfill state. Banner + Initial Analysis page only render when status=complete. Set to in_progress by the backfill trigger; flipped to complete by the final per-date job.';
comment on column shops.historical_import_scope_granted is
  'Which Shopify scope tier was active at backfill time. default_window = stock 60-day order history. read_all_orders = full history (requires Partners approval). Determines historical_import_since_date.';
