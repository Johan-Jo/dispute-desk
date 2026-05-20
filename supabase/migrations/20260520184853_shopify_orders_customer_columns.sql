-- Phase 3 fraud-intelligence v1.5 — customer columns on shopify_orders.
--
-- Adds the missing join keys so the `order_risk_history` view can
-- aggregate per customer (the canonical use case: "this customer has
-- N prior HIGH-risk orders" surfaced on a dispute card).
--
-- Why these two columns and not more:
--   - customer_email: human-readable, useful for cross-shop dedup
--     attempts later, joinable to disputes.customer_email.
--   - customer_shopify_id: stable id; less spoofable than email,
--     survives email changes on the same Shopify customer record.
-- Together they let analytics queries pick whichever join key is more
-- appropriate for a given question without re-querying Shopify.
--
-- Non-immutable: these columns CAN be rewritten by re-ingestion. The
-- immutability trigger on `shopify_orders` (migration 20260510150000)
-- guards only `risk_*_initial`. Email + customer-id can change as
-- Shopify enriches the order over its lifetime, and we want the
-- latest observed values for aggregation queries.

alter table shopify_orders
  add column if not exists customer_email text,
  add column if not exists customer_shopify_id text;

comment on column shopify_orders.customer_email is
  'Customer email at the time of latest order ingest. Mutable — re-ingested orders update to the latest observed value. Used by the order_risk_history view to aggregate prior-order risk patterns per customer.';
comment on column shopify_orders.customer_shopify_id is
  'Shopify Customer GID (e.g. gid://shopify/Customer/123). Mutable like customer_email; survives email changes on the same customer record. Preferred join key when both are present.';

-- Partial indexes — only orders that have a customer key contribute to
-- customer-level aggregation queries. Partial indexes keep the index
-- small (most orders have one or the other, not always both).
create index if not exists shopify_orders_shop_customer_email_idx
  on shopify_orders (shop_id, customer_email)
  where customer_email is not null;

create index if not exists shopify_orders_shop_customer_gid_idx
  on shopify_orders (shop_id, customer_shopify_id)
  where customer_shopify_id is not null;

-- ─── Replace order_risk_history view with v1.5 shape ────────────────
-- Adds:
--   - customer_email, customer_shopify_id (pass-through)
--   - prior_undisputed_orders_for_customer (count where same email,
--     processed_at earlier, has_chargeback = false)
--   - prior_high_risk_orders_for_customer (count where same email,
--     processed_at earlier, risk_level_initial = 'HIGH')
--   - prior_chargebacks_for_customer (count where same email,
--     processed_at earlier, has_chargeback = true)
-- Customer-level aggregations are null when customer_email is null
-- (no join key) — the spotcheck filters those out.

drop view if exists order_risk_history;

create view order_risk_history as
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
  o.customer_email,
  o.customer_shopify_id,
  o.risk_level_initial,
  o.risk_recommendation_initial,
  o.risk_provider_initial,
  o.has_chargeback,
  o.chargeback_type,
  o.chargeback_status,

  -- Per-order assessment aggregates (unchanged from v1).
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

  -- Latest snapshot (unchanged from v1).
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
  end as risk_level_drifted,

  -- ─── v1.5: per-customer aggregates ─────────────────────────────
  -- Count prior orders by the SAME customer (by email) that processed
  -- BEFORE this order. Excludes the current order. Null when no
  -- customer_email is set on this row (no join key available).
  case when o.customer_email is null then null else (
    select count(*) from shopify_orders o2
    where o2.shop_id = o.shop_id
      and o2.customer_email = o.customer_email
      and o2.id <> o.id
      and o2.processed_at < o.processed_at
      and o2.has_chargeback = false
  ) end as prior_undisputed_orders_for_customer,

  case when o.customer_email is null then null else (
    select count(*) from shopify_orders o2
    where o2.shop_id = o.shop_id
      and o2.customer_email = o.customer_email
      and o2.id <> o.id
      and o2.processed_at < o.processed_at
      and o2.risk_level_initial = 'HIGH'
  ) end as prior_high_risk_orders_for_customer,

  case when o.customer_email is null then null else (
    select count(*) from shopify_orders o2
    where o2.shop_id = o.shop_id
      and o2.customer_email = o.customer_email
      and o2.id <> o.id
      and o2.processed_at < o.processed_at
      and o2.has_chargeback = true
  ) end as prior_chargebacks_for_customer
from shopify_orders o;

comment on view order_risk_history is
  'Phase 3 fraud-intelligence v1.5 read-only view. Adds per-customer aggregations (prior_undisputed_orders_for_customer, prior_high_risk_orders_for_customer, prior_chargebacks_for_customer) joined by customer_email. Customer aggregates are null when no customer_email is set on the row. See docs/plans/fraud-risk-incorporation.md §3.';
