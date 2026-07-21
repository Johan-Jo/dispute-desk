-- Historical Intelligence Engine — Phase A schema (design v4).
--
-- Scope (Phase A only): analysis-run infrastructure + read-only analytical
-- views + a deterministic data-quality audit RPC. The recommendation store
-- and decision log are DEFERRED to Phase B (design §4/§12) — nothing is acted
-- on in Phase A, and the decision log would otherwise FK a non-existent table.
--
-- Isolation (design §4.1): the service role bypasses RLS, so `.eq(shop_id)` is
-- APPLICATION-level enforcement, not a DB boundary. Base tables get RLS
-- enabled/no-policy (service-role only) and views get `security_invoker = true`
-- + grants revoked from anon/authenticated. All reads go through the
-- tenant-scoped DAL (lib/intelligence/db/tenantScope.ts), the only access path.
--
-- This migration NEVER reclassifies disputes: views surface classification-
-- engine outputs (disputes.reason/.phase/.network_reason_code) as-is.

-- ─────────────────────────────────────────────────────────────────────────
-- Analysis runs — one row per invocation of the engine for a shop.
-- Versioned + reproducible (design §19). No recommendations/decision-log yet.
-- ─────────────────────────────────────────────────────────────────────────
create table if not exists intelligence_analysis_runs (
  id                        uuid primary key default gen_random_uuid(),
  shop_id                   uuid not null references shops(id) on delete cascade,
  status                    text not null default 'queued'
                              check (status in ('queued','running','succeeded','failed','cancelled')),
  stage                     text not null default 'pending'
                              check (stage in ('pending','auditing','preparing','reporting','recommending','complete')),
  triggered_by              text,                       -- admin email / 'system'
  started_at                timestamptz,
  completed_at              timestamptz,
  data_cutoff               timestamptz,                -- analyses exclude events after this instant
  source_row_counts         jsonb not null default '{}'::jsonb,
  feature_registry_version  text,
  classification_version    text,
  methodology_version       text,
  config                    jsonb not null default '{}'::jsonb,
  cost_assumptions          jsonb not null default '{}'::jsonb,
  data_quality              jsonb,                      -- output of the audit stage
  warnings                  jsonb not null default '[]'::jsonb,
  errors                    jsonb not null default '[]'::jsonb,
  checkpoint                jsonb not null default '{}'::jsonb,
  created_at                timestamptz not null default now(),
  updated_at                timestamptz not null default now()
);

create index if not exists intelligence_runs_shop_created_idx
  on intelligence_analysis_runs(shop_id, created_at desc);
-- Duplicate-run guard reads active runs per shop.
create index if not exists intelligence_runs_active_idx
  on intelligence_analysis_runs(shop_id, status)
  where status in ('queued','running');

alter table intelligence_analysis_runs enable row level security;
-- No policies: service-role only (mirrors shop_daily_metrics convention).

-- ─────────────────────────────────────────────────────────────────────────
-- Analytical views (read-only, non-materialized, security_invoker).
-- Callers ALWAYS filter by shop_id via the tenant-scoped DAL. These views do
-- not resolve i18n or reclassify — they surface raw, engine-produced fields.
-- ─────────────────────────────────────────────────────────────────────────

-- One row per historical order. Exposes raw customer-history FACTS
-- (prior_orders_in_window, customer_first_seen_at, shop_coverage_start) so the
-- three-state tenure {returning, first_seen_in_observed_history, unknown} is
-- derived in TS with a configurable wash-in — NOT hardcoded here (design §5.1).
create or replace view intel_order_records
with (security_invoker = true) as
select
  o.shop_id,
  o.shopify_order_id            as order_id,
  o.shopify_order_number        as order_number,
  o.processed_at,
  o.created_at_shopify,
  o.cancelled_at,
  o.fulfilled_at,
  o.first_ingested_at,
  -- Temporal-leakage signal: hours between order creation and first ingest.
  round(extract(epoch from (o.first_ingested_at - o.created_at_shopify)) / 3600.0, 1) as ingest_lag_hours,
  o.currency,
  o.order_total,
  o.country,
  o.is_cross_border,
  o.distance_bucket,
  o.payment_gateway,
  o.financial_status,
  o.fulfillment_status,
  o.cancel_reason,
  o.risk_level_initial,
  o.risk_recommendation_initial,
  o.risk_provider_initial,
  o.fraud_protection_level,
  o.delivery_status,
  o.delivered_at_tracking,
  o.signed_by_name,
  o.tracking_source,
  o.customer_shopify_id,
  -- Customer-history facts, as-of this order (no future leakage). Left-censored
  -- at the shop's coverage boundary; tenure decision happens in TS.
  case when o.customer_shopify_id is null then null else
    (count(*) over (partition by o.shop_id, o.customer_shopify_id
                    order by o.created_at_shopify
                    rows between unbounded preceding and 1 preceding))::int
  end as prior_orders_in_window,
  case when o.customer_shopify_id is null then null else
    min(o.created_at_shopify) over (partition by o.shop_id, o.customer_shopify_id)
  end as customer_first_seen_at,
  min(o.created_at_shopify) over (partition by o.shop_id) as shop_coverage_start,
  extract(hour   from o.processed_at)::int as order_hour,
  extract(isodow from o.processed_at)::int as order_isodow,
  case
    when o.order_total is null then 'unknown'
    when o.order_total < 25    then 'lt_25'
    when o.order_total < 75    then '25_75'
    when o.order_total < 150   then '75_150'
    when o.order_total < 500   then '150_500'
    else 'gte_500'
  end as value_band
from shopify_orders o;

-- One row per dispute, joined to its order + qualification + latest pack.
create or replace view intel_dispute_records
with (security_invoker = true) as
select
  d.shop_id,
  d.id                          as dispute_id,
  d.dispute_gid,
  d.order_gid,
  o.shopify_order_id            as order_id,
  d.initiated_at,
  d.due_at,
  d.closed_at,
  d.submitted_at,
  d.reason,
  d.phase,
  d.network_reason_code,
  d.network_reason_code_confidence,
  d.normalized_status,
  d.submission_state,
  d.final_outcome,
  d.amount,
  d.currency_code,
  d.outcome_amount_recovered,
  d.outcome_amount_lost,
  d.outcome_confidence,
  d.raw_snapshot,
  -- Adjudication + finality per the §7.1 terminal set (NOT "any non-null").
  (d.final_outcome in ('won','partially_won','lost')) as is_adjudicated,
  (d.final_outcome in ('won','partially_won','lost','withdrawn','accepted',
                       'refunded','canceled','expired','closed_other')) as workflow_terminal,
  (o.shopify_order_id is not null) as has_linked_order,
  o.order_total                 as order_total,
  o.country                     as order_country,
  o.payment_gateway             as order_payment_gateway,
  o.risk_level_initial          as order_risk_level_initial,
  o.fulfillment_status          as order_fulfillment_status,
  o.delivery_status             as order_delivery_status,
  q.ce30_status,
  q.confidence                  as qualification_confidence,
  p.completeness_score          as evidence_completeness_score,
  p.package_type                as evidence_package_type
from disputes d
left join shopify_orders o
  on o.shop_id = d.shop_id and o.shopify_order_id = d.order_gid
left join dispute_qualifications q
  on q.shop_id = d.shop_id and q.shopify_dispute_id = d.dispute_gid
left join lateral (
  select ep.completeness_score, ep.package_type
  from evidence_packs ep
  where ep.dispute_id = d.id
  order by ep.created_at desc
  limit 1
) p on true;

-- One row per normalized evidence item. Availability is NOT inferred from the
-- item timestamp (design §5.3) — this view exposes created_at as the
-- generation/ingestion time only; underlying-event availability is a §14 task.
create or replace view intel_evidence_records
with (security_invoker = true) as
select
  ep.shop_id,
  ep.dispute_id,
  ei.id                 as evidence_item_id,
  ei.type               as evidence_type,
  ei.source             as evidence_source,
  ei.confidence,
  ei.created_at         as generated_or_ingested_at,   -- NOT underlying-event time
  ep.package_type,
  ep.completeness_score
from evidence_items ei
join evidence_packs ep on ep.id = ei.pack_id;

-- One row per normalized dispute/operational event (existing ledger).
create or replace view intel_event_records
with (security_invoker = true) as
select
  de.shop_id,
  de.dispute_id,
  de.event_type,
  de.event_at,
  de.actor_type,
  de.source_type
from dispute_events de;

-- Views are cross-shop by construction. Merchant-facing roles get NOTHING;
-- only the service role (via the tenant-scoped DAL) reads them.
revoke all on intel_order_records    from anon, authenticated;
revoke all on intel_dispute_records  from anon, authenticated;
revoke all on intel_evidence_records from anon, authenticated;
revoke all on intel_event_records    from anon, authenticated;

-- ─────────────────────────────────────────────────────────────────────────
-- Data-quality audit RPC. Returns one jsonb doc of RAW facts for a shop.
-- Status labelling (reliable / usable_with_limitations / insufficient /
-- unknown) is applied in TS (lib/intelligence/dataQuality/audit.ts). All
-- aggregation is server-side; a COUNT over 350k rows returns a single row, so
-- there is no PostgREST 1000-row concern.
-- ─────────────────────────────────────────────────────────────────────────
create or replace function intel_data_quality_audit(p_shop_id uuid)
returns jsonb
language sql
stable
security invoker
as $$
with o as (
  select * from shopify_orders where shop_id = p_shop_id
),
d as (
  select * from disputes where shop_id = p_shop_id
),
oc as ( select count(*)::numeric as n from o ),
dc as ( select count(*)::numeric as n from d ),
orders_by_year as (
  select coalesce(jsonb_object_agg(yr, cnt), '{}'::jsonb) as j
  from (
    select to_char(date_trunc('year', processed_at), 'YYYY') as yr, count(*) as cnt
    from o where processed_at is not null group by 1
  ) t
),
disputes_by_year as (
  select coalesce(jsonb_object_agg(yr, cnt), '{}'::jsonb) as j
  from (
    select to_char(date_trunc('year', initiated_at), 'YYYY') as yr, count(*) as cnt
    from d where initiated_at is not null group by 1
  ) t
),
multi_dispute_orders as (
  select count(*)::int as n from (
    select order_gid from d where order_gid is not null
    group by order_gid having count(*) > 1
  ) t
)
select jsonb_build_object(
  'generated_at', now(),
  'orders', jsonb_build_object(
    'count', (select n from oc),
    'min_processed_at', (select min(processed_at) from o),
    'max_processed_at', (select max(processed_at) from o),
    'coverage_start', (select min(created_at_shopify) from o),
    'distinct_currencies', (select count(distinct currency) from o),
    'by_year', (select j from orders_by_year),
    'pct_null_risk_initial', case when (select n from oc) = 0 then null else
      round(100.0 * (select count(*) from o where risk_level_initial is null or risk_level_initial in ('NONE','PENDING')) / (select n from oc), 2) end,
    'pct_null_country', case when (select n from oc) = 0 then null else
      round(100.0 * (select count(*) from o where country is null) / (select n from oc), 2) end,
    'pct_null_payment_gateway', case when (select n from oc) = 0 then null else
      round(100.0 * (select count(*) from o where payment_gateway is null) / (select n from oc), 2) end,
    'pct_null_delivery_status', case when (select n from oc) = 0 then null else
      round(100.0 * (select count(*) from o where delivery_status is null) / (select n from oc), 2) end,
    'pct_has_chargeback_true', case when (select n from oc) = 0 then null else
      round(100.0 * (select count(*) from o where has_chargeback) / (select n from oc), 3) end,
    'implausible_dates', (select count(*) from o
      where (fulfilled_at is not null and fulfilled_at < created_at_shopify)
         or (processed_at is not null and processed_at < created_at_shopify - interval '2 days'))
  ),
  'leakage', jsonb_build_object(
    'median_ingest_lag_hours', (select round(percentile_cont(0.5) within group (
        order by extract(epoch from (first_ingested_at - created_at_shopify)) / 3600.0)::numeric, 1)
      from o where first_ingested_at is not null and created_at_shopify is not null),
    'pct_ingested_within_48h', case when (select n from oc) = 0 then null else
      round(100.0 * (select count(*) from o where first_ingested_at - created_at_shopify < interval '48 hours') / (select n from oc), 2) end
  ),
  'disputes', jsonb_build_object(
    'count', (select n from dc),
    'min_initiated_at', (select min(initiated_at) from d),
    'max_initiated_at', (select max(initiated_at) from d),
    'distinct_currencies', (select count(distinct currency_code) from d),
    'by_year', (select j from disputes_by_year),
    'pct_orphan_no_order', case when (select n from dc) = 0 then null else
      round(100.0 * (select count(*) from d where order_gid is null) / (select n from dc), 2) end,
    'pct_null_phase', case when (select n from dc) = 0 then null else
      round(100.0 * (select count(*) from d where phase is null) / (select n from dc), 2) end,
    'pct_unclassified_reason', case when (select n from dc) = 0 then null else
      round(100.0 * (select count(*) from d where reason is null or reason = 'GENERAL') / (select n from dc), 2) end,
    'pct_null_final_outcome', case when (select n from dc) = 0 then null else
      round(100.0 * (select count(*) from d where final_outcome is null) / (select n from dc), 2) end,
    'count_adjudicated', (select count(*) from d where final_outcome in ('won','partially_won','lost')),
    'count_submitted', (select count(*) from d where submitted_at is not null),
    'pct_network_code_direct_or_derived', case when (select n from dc) = 0 then null else
      round(100.0 * (select count(*) from d where network_reason_code_confidence in ('direct','derived')) / (select n from dc), 2) end,
    'count_with_outcome_amount', (select count(*) from d where outcome_amount_recovered is not null or outcome_amount_lost is not null),
    'orders_with_multiple_disputes', (select n from multi_dispute_orders),
    'missing_deadline_count', (select count(*) from d where due_at is null),
    'count_with_response_opportunity', (select count(*) from d where initiated_at is not null and due_at is not null)
  ),
  'evidence', jsonb_build_object(
    'pack_count', (select count(*) from evidence_packs where shop_id = p_shop_id),
    'item_count', (select count(*) from evidence_items ei
      join evidence_packs ep on ep.id = ei.pack_id where ep.shop_id = p_shop_id)
  )
);
$$;

revoke all on function intel_data_quality_audit(uuid) from anon, authenticated;

comment on table intelligence_analysis_runs is
  'Historical Intelligence Engine: one versioned, reproducible analysis run per shop. data_quality holds the audit output. Phase A.';
comment on function intel_data_quality_audit(uuid) is
  'Deterministic per-shop data-quality facts for the intelligence engine. Measures only; TS assigns reliability status.';
