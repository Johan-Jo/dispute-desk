-- Admin Fraud Intel aggregation (service-role only).
--
-- /admin/fraud-intel used to pull shopify_orders rows into the app and bucket
-- them in JS. PostgREST caps a select at 1000 rows no matter what .limit() says,
-- so on prod (34k orders in the 90-day window) the page analysed ~3% of them,
-- and it counted "disputes" from shopify_orders.has_chargeback, a flag that is
-- never set (0 rows all time against ~1.9k disputes). Every bucket therefore
-- read "0% dispute rate" from an arbitrary sample.
--
-- This does the bucketing in SQL over ALL orders in the window and counts an
-- order as disputed when a dispute exists for it (disputes.order_gid =
-- shopify_orders.shopify_order_id, same shop). Bucket labels and thresholds
-- mirror the previous TypeScript exactly so the page renders unchanged.
--
-- Returns (dimension, bucket, orders, disputes). dimension 'total' / bucket
-- 'all' carries the window totals.

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
      o.is_cross_border,
      s.avs_address_result,
      s.payment_attempt_count,
      s.proxy_detected,
      s.ip_ship_distance_km,
      (s.shop_id is not null) as has_signal
    from public.shopify_orders o
    left join public.shopify_order_risk_signals s
      on s.shop_id = o.shop_id and s.shopify_order_id = o.shopify_order_id
    left join disputed dd
      on dd.shop_id = o.shop_id and dd.order_gid = o.shopify_order_id
    where o.created_at_shopify >= p_since
  ),
  bucketed as (
    select 'total'::text as dimension, 'all'::text as bucket, is_disputed from base
    union all
    select 'avs',
      case when not has_signal then 'unknown'
           when btrim(coalesce(avs_address_result, '')) = '' then 'unknown'
           else btrim(avs_address_result) end,
      is_disputed from base
    union all
    select 'attempts',
      case when payment_attempt_count is null then 'unknown'
           when payment_attempt_count <= 1 then '1'
           when payment_attempt_count = 2 then '2'
           when payment_attempt_count <= 4 then '3-4'
           else '5+' end,
      is_disputed from base
    union all
    select 'distance',
      case when ip_ship_distance_km is null then 'missing'
           when ip_ship_distance_km <= 50 then '0-50'
           when ip_ship_distance_km <= 200 then '50-200'
           when ip_ship_distance_km <= 1000 then '200-1000'
           else '1000+' end,
      is_disputed from base
    union all
    select 'proxy_cross',
      (case when proxy_detected is null then 'not_reported'
            when proxy_detected then 'proxy'
            else 'no_proxy' end)
      || '×' ||
      (case when is_cross_border is null then 'cross_unknown'
            when is_cross_border then 'cross'
            else 'same' end),
      is_disputed from base
  )
  select b.dimension, b.bucket,
         count(*)::bigint as orders,
         count(*) filter (where b.is_disputed)::bigint as disputes
  from bucketed b
  group by b.dimension, b.bucket;
$$;

revoke execute on function public.dd_admin_fraud_intel_buckets(timestamptz) from public, anon, authenticated;
grant execute on function public.dd_admin_fraud_intel_buckets(timestamptz) to service_role;

comment on function public.dd_admin_fraud_intel_buckets(timestamptz) is
  'Admin Fraud Intel: order/dispute counts per signal bucket over all orders since p_since. Disputed = a disputes row exists for the order (not shopify_orders.has_chargeback, which is never set). Service-role only.';
