-- Phase 3 Fraud Intelligence v1 — order_risk_history view.
--
-- Read-only data layer for cross-order risk pattern analysis. No
-- collector, no pipeline integration, no UI in v1. The view shape
-- exists so we can validate join quality and aggregate behaviour on
-- real shop data before designing v2 surface UX off speculation.
--
-- Aggregation scope (v1): per shop, per Shopify order — surfaces the
-- count of risk assessments at each level/recommendation and the
-- latest snapshot. Customer-level aggregation (the canonical use case
-- — "this customer has N prior HIGH-risk orders") is OUT OF SCOPE in
-- v1 because `shopify_orders` does not yet carry customer_email /
-- customer_shopify_id. v1.5 will add those columns + extend this
-- view; tracking issue: docs/plans/fraud-risk-incorporation.md §3.
--
-- Naming rule (from the plan, load-bearing): never use "repeat
-- offender" or "offender" in product copy, table names, view names,
-- column names, code comments, or commit messages. The signal is
-- statistical, not accusatory.
--
-- Access pattern: service-role only. Views inherit table RLS, so the
-- underlying tables' RLS still gates anon/authenticated reads.

create or replace view order_risk_history as
select
  o.shop_id,
  o.id as shopify_order_id,
  o.shopify_order_id as order_gid,
  o.shopify_order_number as order_number,
  o.processed_at as order_processed_at,
  o.currency,
  o.order_total,
  o.country,
  o.is_cross_border,
  o.risk_level_initial,
  o.risk_recommendation_initial,
  o.risk_provider_initial,
  o.has_chargeback,
  o.chargeback_type,
  o.chargeback_status,

  -- Risk-assessment aggregates per order (across all providers + snapshots).
  -- These let v1 spotcheck queries answer: "for this order, how many
  -- times did Shopify rescore it? Did the level shift over time?"
  (select count(*) from shopify_order_risk_assessments ra
   where ra.shop_id = o.shop_id and ra.shopify_order_id = o.shopify_order_id)
    as assessment_count,
  (select count(*) from shopify_order_risk_assessments ra
   where ra.shop_id = o.shop_id and ra.shopify_order_id = o.shopify_order_id
     and ra.risk_level = 'LOW')
    as assessments_low,
  (select count(*) from shopify_order_risk_assessments ra
   where ra.shop_id = o.shop_id and ra.shopify_order_id = o.shopify_order_id
     and ra.risk_level = 'MEDIUM')
    as assessments_medium,
  (select count(*) from shopify_order_risk_assessments ra
   where ra.shop_id = o.shop_id and ra.shopify_order_id = o.shopify_order_id
     and ra.risk_level = 'HIGH')
    as assessments_high,
  (select count(*) from shopify_order_risk_assessments ra
   where ra.shop_id = o.shop_id and ra.shopify_order_id = o.shopify_order_id
     and ra.recommendation = 'ACCEPT')
    as assessments_accept,
  (select count(*) from shopify_order_risk_assessments ra
   where ra.shop_id = o.shop_id and ra.shopify_order_id = o.shopify_order_id
     and ra.recommendation = 'INVESTIGATE')
    as assessments_investigate,
  (select count(*) from shopify_order_risk_assessments ra
   where ra.shop_id = o.shop_id and ra.shopify_order_id = o.shopify_order_id
     and ra.recommendation = 'REJECT')
    as assessments_reject,

  -- Latest snapshot — useful for "current state" queries without
  -- joining the assessments table directly.
  (select ra.risk_level from shopify_order_risk_assessments ra
   where ra.shop_id = o.shop_id and ra.shopify_order_id = o.shopify_order_id
   order by ra.snapshot_at desc limit 1)
    as latest_risk_level,
  (select ra.recommendation from shopify_order_risk_assessments ra
   where ra.shop_id = o.shop_id and ra.shopify_order_id = o.shopify_order_id
   order by ra.snapshot_at desc limit 1)
    as latest_recommendation,
  (select ra.snapshot_at from shopify_order_risk_assessments ra
   where ra.shop_id = o.shop_id and ra.shopify_order_id = o.shopify_order_id
   order by ra.snapshot_at desc limit 1)
    as latest_snapshot_at,

  -- Drift signal: did the latest level differ from the immutable
  -- initial level? Non-null only when there's at least one assessment.
  case
    when (select count(*) from shopify_order_risk_assessments ra
          where ra.shop_id = o.shop_id and ra.shopify_order_id = o.shopify_order_id) = 0
      then null
    else (
      select case when ra.risk_level is distinct from o.risk_level_initial
                  then true else false end
      from shopify_order_risk_assessments ra
      where ra.shop_id = o.shop_id and ra.shopify_order_id = o.shopify_order_id
      order by ra.snapshot_at desc limit 1
    )
  end as risk_level_drifted
from shopify_orders o;

comment on view order_risk_history is
  'Phase 3 fraud-intelligence v1 read-only view. Per-shop, per-order risk-assessment aggregates including assessment counts by level/recommendation, latest snapshot, and a drift flag. Customer-level aggregation is out of scope until shopify_orders carries customer_email + customer_shopify_id. See docs/plans/fraud-risk-incorporation.md §3.';
