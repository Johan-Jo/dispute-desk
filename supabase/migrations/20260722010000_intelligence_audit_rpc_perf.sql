-- Historical Intelligence Engine — audit RPC performance fix.
--
-- The original intel_data_quality_audit scanned the shop's orders ~10 times
-- (one `(select count(*) from o where …)` subquery per metric) plus a full
-- percentile sort. On a 354k-order shop that intermittently exceeded the
-- statement timeout ("canceling statement due to statement timeout"). This
-- rewrite computes every order-side and dispute-side metric in a SINGLE
-- filtered-aggregate pass (count(*) filter (where …)), one scan each, so the
-- audit stays well under the timeout for large shops.
--
-- Behaviour is identical to the prior version (same jsonb keys/values); only the
-- execution plan changes. create-or-replace — safe to apply idempotently.

create or replace function intel_data_quality_audit(p_shop_id uuid)
returns jsonb
language sql
stable
security invoker
as $$
with o_agg as (
  select
    count(*)::numeric                                                                 as n,
    min(processed_at)                                                                 as min_processed,
    max(processed_at)                                                                 as max_processed,
    min(created_at_shopify)                                                           as coverage_start,
    count(distinct currency)                                                          as distinct_currencies,
    count(*) filter (where risk_level_initial is null or risk_level_initial in ('NONE','PENDING')) as null_risk,
    count(*) filter (where country is null)                                           as null_country,
    count(*) filter (where payment_gateway is null)                                   as null_gateway,
    count(*) filter (where delivery_status is null)                                   as null_delivery,
    count(*) filter (where has_chargeback)                                            as cb_true,
    count(*) filter (where (fulfilled_at is not null and fulfilled_at < created_at_shopify)
                        or (processed_at is not null and processed_at < created_at_shopify - interval '2 days')) as implausible,
    round(percentile_cont(0.5) within group (
      order by extract(epoch from (first_ingested_at - created_at_shopify)) / 3600.0)
      filter (where first_ingested_at is not null and created_at_shopify is not null)::numeric, 1) as median_lag_h,
    count(*) filter (where first_ingested_at - created_at_shopify < interval '48 hours') as within_48h
  from shopify_orders where shop_id = p_shop_id
),
o_years as (
  select coalesce(jsonb_object_agg(yr, cnt), '{}'::jsonb) as j
  from (select to_char(date_trunc('year', processed_at), 'YYYY') as yr, count(*) as cnt
        from shopify_orders where shop_id = p_shop_id and processed_at is not null group by 1) t
),
d_agg as (
  select
    count(*)::numeric                                                                 as n,
    min(initiated_at)                                                                 as min_initiated,
    max(initiated_at)                                                                 as max_initiated,
    count(distinct currency_code)                                                     as distinct_currencies,
    count(*) filter (where order_gid is null)                                         as orphan,
    count(*) filter (where phase is null)                                             as null_phase,
    count(*) filter (where reason is null or reason = 'GENERAL')                      as unclassified,
    count(*) filter (where final_outcome is null)                                     as null_outcome,
    count(*) filter (where final_outcome in ('won','partially_won','lost'))           as adjudicated,
    count(*) filter (where submitted_at is not null)                                  as submitted,
    count(*) filter (where network_reason_code_confidence in ('direct','derived'))    as net_direct,
    count(*) filter (where outcome_amount_recovered is not null or outcome_amount_lost is not null) as with_amount,
    count(*) filter (where due_at is null)                                            as missing_deadline,
    count(*) filter (where initiated_at is not null and due_at is not null)           as with_opportunity
  from disputes where shop_id = p_shop_id
),
d_years as (
  select coalesce(jsonb_object_agg(yr, cnt), '{}'::jsonb) as j
  from (select to_char(date_trunc('year', initiated_at), 'YYYY') as yr, count(*) as cnt
        from disputes where shop_id = p_shop_id and initiated_at is not null group by 1) t
),
multi as (
  select count(*)::int as n from (
    select order_gid from disputes where shop_id = p_shop_id and order_gid is not null
    group by order_gid having count(*) > 1
  ) t
),
ev as (
  select
    (select count(*) from evidence_packs where shop_id = p_shop_id) as pack_count,
    (select count(*) from evidence_items ei join evidence_packs ep on ep.id = ei.pack_id
      where ep.shop_id = p_shop_id) as item_count
)
select jsonb_build_object(
  'generated_at', now(),
  'orders', jsonb_build_object(
    'count', o.n,
    'min_processed_at', o.min_processed,
    'max_processed_at', o.max_processed,
    'coverage_start', o.coverage_start,
    'distinct_currencies', o.distinct_currencies,
    'by_year', oy.j,
    'pct_null_risk_initial',     case when o.n = 0 then null else round(100.0 * o.null_risk    / o.n, 2) end,
    'pct_null_country',          case when o.n = 0 then null else round(100.0 * o.null_country  / o.n, 2) end,
    'pct_null_payment_gateway',  case when o.n = 0 then null else round(100.0 * o.null_gateway  / o.n, 2) end,
    'pct_null_delivery_status',  case when o.n = 0 then null else round(100.0 * o.null_delivery / o.n, 2) end,
    'pct_has_chargeback_true',   case when o.n = 0 then null else round(100.0 * o.cb_true       / o.n, 3) end,
    'implausible_dates', o.implausible
  ),
  'leakage', jsonb_build_object(
    'median_ingest_lag_hours', o.median_lag_h,
    'pct_ingested_within_48h', case when o.n = 0 then null else round(100.0 * o.within_48h / o.n, 2) end
  ),
  'disputes', jsonb_build_object(
    'count', d.n,
    'min_initiated_at', d.min_initiated,
    'max_initiated_at', d.max_initiated,
    'distinct_currencies', d.distinct_currencies,
    'by_year', dy.j,
    'pct_orphan_no_order',      case when d.n = 0 then null else round(100.0 * d.orphan       / d.n, 2) end,
    'pct_null_phase',           case when d.n = 0 then null else round(100.0 * d.null_phase   / d.n, 2) end,
    'pct_unclassified_reason',  case when d.n = 0 then null else round(100.0 * d.unclassified / d.n, 2) end,
    'pct_null_final_outcome',   case when d.n = 0 then null else round(100.0 * d.null_outcome / d.n, 2) end,
    'count_adjudicated', d.adjudicated,
    'count_submitted', d.submitted,
    'pct_network_code_direct_or_derived', case when d.n = 0 then null else round(100.0 * d.net_direct / d.n, 2) end,
    'count_with_outcome_amount', d.with_amount,
    'orders_with_multiple_disputes', (select n from multi),
    'missing_deadline_count', d.missing_deadline,
    'count_with_response_opportunity', d.with_opportunity
  ),
  'evidence', jsonb_build_object('pack_count', ev.pack_count, 'item_count', ev.item_count)
)
from o_agg o, o_years oy, d_agg d, d_years dy, ev;
$$;

revoke all on function intel_data_quality_audit(uuid) from anon, authenticated;
