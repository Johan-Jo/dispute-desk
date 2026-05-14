-- LSE-5: ratio snapshots + threshold alerts.
--
-- Monthly per-shop snapshots of calculated VAMP / MC ECM / MC EFM
-- ratios, including the counterfactual (without-DisputeDesk) line and
-- estimated fees-avoided / revenue-recovered. Computed nightly from
-- disputes + submission_logs.
--
-- Always labeled "calculated estimate" in the UI — only the acquirer
-- has the authoritative ratio.
--
-- See docs/epics/EPIC-LSE-5-ratio-dashboard.md.

create table if not exists ratio_snapshots (
  id uuid primary key default gen_random_uuid(),
  shop_id uuid not null references shops(id) on delete cascade,
  period_month date not null,

  settled_count int not null default 0,
  tc40_count int not null default 0,
  tc15_count int not null default 0,
  vamp_ratio_calculated numeric(8, 5) not null default 0,
  vamp_ratio_without_dd numeric(8, 5) not null default 0,

  ce30_excluded_count int not null default 0,
  fpt_excluded_count int not null default 0,
  rdr_excluded_count int not null default 0,

  mc_settled_count int not null default 0,
  mc_ecm_chargeback_count int not null default 0,
  mc_ecm_ratio numeric(8, 5) not null default 0,
  mc_efm_fraud_count int not null default 0,
  mc_efm_ratio numeric(8, 5) not null default 0,

  estimated_fees_avoided_usd numeric(12, 2) not null default 0,
  estimated_revenue_recovered_usd numeric(12, 2) not null default 0,

  calculated_at timestamptz not null default now(),
  created_at timestamptz not null default now()
);

create unique index if not exists ratio_snapshots_shop_period_uq
  on ratio_snapshots (shop_id, period_month);

create index if not exists ratio_snapshots_shop_period_desc_idx
  on ratio_snapshots (shop_id, period_month desc);

alter table ratio_snapshots enable row level security;
drop policy if exists service_role_full_access_ratio_snapshots on ratio_snapshots;
create policy service_role_full_access_ratio_snapshots
  on ratio_snapshots for all using (true) with check (true);

-- ── ratio_alerts ─────────────────────────────────────────────────────
create table if not exists ratio_alerts (
  id uuid primary key default gen_random_uuid(),
  shop_id uuid not null references shops(id) on delete cascade,
  triggered_at timestamptz not null default now(),
  alert_type text not null check (
    alert_type in (
      'vamp_yellow', 'vamp_red',
      'ecm_yellow', 'ecm_red',
      'efm_yellow', 'efm_red'
    )
  ),
  current_value numeric(8, 5) not null,
  threshold_value numeric(8, 5) not null,
  notified_via text[] not null default '{}',
  dismissed_at timestamptz,
  created_at timestamptz not null default now()
);

-- Dedupe per (shop, alert_type) per active month: one undismissed alert
-- per (shop, type) at a time. Active alerts have dismissed_at = NULL.
create unique index if not exists ratio_alerts_active_dedup_uq
  on ratio_alerts (shop_id, alert_type)
  where dismissed_at is null;

alter table ratio_alerts enable row level security;
drop policy if exists service_role_full_access_ratio_alerts on ratio_alerts;
create policy service_role_full_access_ratio_alerts
  on ratio_alerts for all using (true) with check (true);

comment on table ratio_snapshots is
  'LSE-5 monthly per-shop calculated VAMP / MC ECM / MC EFM ratios + counterfactual + estimated fees avoided. Approximation from Shopify data — always labeled "calculated estimate" in UI.';
comment on column ratio_snapshots.vamp_ratio_without_dd is
  'Counterfactual: VAMP ratio if DisputeDesk-attributed wins (ce30_excluded_count + fpt_excluded_count) had not happened. Drives the "without DisputeDesk" trend line.';

comment on table ratio_alerts is
  'LSE-5 threshold alerts. Yellow at 80% of threshold; red at threshold breach. Dedup per (shop, alert_type) until dismissed.';
