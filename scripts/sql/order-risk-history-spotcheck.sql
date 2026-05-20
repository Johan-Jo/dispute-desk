-- Phase 3 fraud-intelligence v1 spotcheck.
--
-- Run via the canonical path:
--   npx supabase db query --linked --file scripts/sql/order-risk-history-spotcheck.sql
--
-- Validates the order_risk_history view returns sensible aggregates
-- against real shop data. Three checks:
--   1. Row count matches shopify_orders (no orphans, no duplicates).
--   2. Distribution of latest_risk_level + risk_level_drifted.
--   3. Top 10 orders by assessment_count — highest-churn risk scores.
--
-- Pure read; safe to run any time.

-- 1) Parity check: view must have the same row count as shopify_orders.
select
  'row_parity' as check_name,
  (select count(*) from order_risk_history) as view_rows,
  (select count(*) from shopify_orders) as table_rows,
  case
    when (select count(*) from order_risk_history) = (select count(*) from shopify_orders)
      then 'OK'
    else 'FAIL'
  end as result;

-- 2) Distribution of latest risk level + drift flag.
-- Useful for sanity-checking the view computes the latest snapshot
-- correctly. Nulls in latest_risk_level mean the order has no
-- assessment rows yet (expected for older orders pre-backfill).
select
  'risk_level_distribution' as check_name,
  latest_risk_level,
  risk_level_drifted,
  count(*) as order_count
from order_risk_history
group by latest_risk_level, risk_level_drifted
order by order_count desc;

-- 3) Top 10 most-rescored orders.
-- These are the orders Shopify reassessed most often. High churn is
-- often correlated with edge-case fraud signals (manual review,
-- chargeback dispute opening). Useful for v2 UI design — what to
-- surface on a single dispute's "history" panel.
select
  'top_rescored_orders' as check_name,
  shop_id,
  order_number,
  risk_level_initial,
  latest_risk_level,
  risk_level_drifted,
  assessment_count,
  assessments_low,
  assessments_medium,
  assessments_high,
  has_chargeback
from order_risk_history
where assessment_count >= 1
order by assessment_count desc, order_processed_at desc
limit 10;

-- 4) Cross-check: orders flagged HIGH that became chargebacks.
-- Same statistical signal Phase 2 already feeds into the strength
-- engine (caps overall to moderate). Surfacing the raw count here so
-- ops can verify Phase 2's gate is firing on the right set of cases.
select
  'high_risk_chargeback_count' as check_name,
  count(*) as orders,
  sum(case when has_chargeback then 1 else 0 end) as became_chargebacks
from order_risk_history
where risk_level_initial = 'HIGH';
