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

-- 5) v1.5: customer-aggregate sanity. How many orders have the
-- customer_email join key populated? (Pre-v1.5 backfilled orders
-- will be null; v1.5+ ingests will populate the column.)
select
  'customer_email_coverage' as check_name,
  count(*) as total_orders,
  count(*) filter (where customer_email is not null) as with_customer_email,
  count(*) filter (where customer_shopify_id is not null) as with_customer_gid
from order_risk_history;

-- 6) v1.5: top 10 customers by prior_high_risk_orders_for_customer.
-- These are the customers whose orders have repeatedly been flagged
-- HIGH-risk by Shopify before this order. Useful for v2 UI design —
-- "this customer has N prior HIGH-risk orders" panel content.
-- Requires non-null customer_email + at least one prior HIGH-risk.
select
  'top_customers_by_prior_high_risk' as check_name,
  customer_email,
  count(*) as order_count,
  max(prior_high_risk_orders_for_customer) as max_prior_high,
  max(prior_undisputed_orders_for_customer) as max_prior_undisputed,
  max(prior_chargebacks_for_customer) as max_prior_chargebacks
from order_risk_history
where customer_email is not null
  and prior_high_risk_orders_for_customer >= 1
group by customer_email
order by max(prior_high_risk_orders_for_customer) desc, customer_email
limit 10;
