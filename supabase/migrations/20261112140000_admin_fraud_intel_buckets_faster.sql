-- Faster dd_admin_fraud_intel_buckets (same signature, same output).
--
-- The first version bucketed with five UNION ALL branches over the same base
-- rows, re-scanning ~34k orders five times and aggregating ~171k rows. On prod
-- it took ~2.9 s, and one cold call crossed PostgREST's 8 s statement timeout
-- ("canceling statement due to statement timeout"; /admin/fraud-intel showed
-- its error banner). This computes each bucket column once and aggregates in a
-- single pass with GROUPING SETS: ~1.3 s on the same data.
--
-- Verified on prod before applying: the old and new queries return identical
-- rows (symmetric difference empty, 16 rows each). Labels and thresholds are
-- unchanged. CREATE OR REPLACE keeps the existing grants; they are restated.

create or replace function public.dd_admin_fraud_intel_buckets(p_since timestamptz)
returns table (dimension text, bucket text, orders bigint, disputes bigint)
language sql
stable
security definer
set search_path = public
as $$
  with disputed as (
    select distinct d.shop_id, d.order_gid
    from public.disputes d
    where d.order_gid is not null
  ),
  base as (
    select
      (dd.order_gid is not null) as is_disputed,
      case when s.shop_id is null then 'unknown'
           when btrim(coalesce(s.avs_address_result, '')) = '' then 'unknown'
           else btrim(s.avs_address_result) end as avs,
      case when s.payment_attempt_count is null then 'unknown'
           when s.payment_attempt_count <= 1 then '1'
           when s.payment_attempt_count = 2 then '2'
           when s.payment_attempt_count <= 4 then '3-4'
           else '5+' end as attempts,
      case when s.ip_ship_distance_km is null then 'missing'
           when s.ip_ship_distance_km <= 50 then '0-50'
           when s.ip_ship_distance_km <= 200 then '50-200'
           when s.ip_ship_distance_km <= 1000 then '200-1000'
           else '1000+' end as distance,
      (case when s.proxy_detected is null then 'not_reported'
            when s.proxy_detected then 'proxy'
            else 'no_proxy' end)
      || '×' ||
      (case when o.is_cross_border is null then 'cross_unknown'
            when o.is_cross_border then 'cross'
            else 'same' end) as proxy_cross
    from public.shopify_orders o
    left join public.shopify_order_risk_signals s
      on s.shop_id = o.shop_id and s.shopify_order_id = o.shopify_order_id
    left join disputed dd
      on dd.shop_id = o.shop_id and dd.order_gid = o.shopify_order_id
    where o.created_at_shopify >= p_since
  ),
  g as (
    select avs, attempts, distance, proxy_cross,
           count(*) as orders,
           count(*) filter (where is_disputed) as disputes,
           grouping(avs) as ga, grouping(attempts) as gt,
           grouping(distance) as gd, grouping(proxy_cross) as gp
    from base
    group by grouping sets ((avs), (attempts), (distance), (proxy_cross), ())
  )
  select
    (case when ga = 0 then 'avs' when gt = 0 then 'attempts'
          when gd = 0 then 'distance' when gp = 0 then 'proxy_cross'
          else 'total' end)::text as dimension,
    (case when ga = 0 then avs when gt = 0 then attempts
          when gd = 0 then distance when gp = 0 then proxy_cross
          else 'all' end)::text as bucket,
    orders::bigint as orders,
    disputes::bigint as disputes
  from g
$$;

revoke execute on function public.dd_admin_fraud_intel_buckets(timestamptz) from public, anon, authenticated;
grant execute on function public.dd_admin_fraud_intel_buckets(timestamptz) to service_role;
