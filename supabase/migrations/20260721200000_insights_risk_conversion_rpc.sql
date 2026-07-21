-- Insights: all-time risk-to-dispute conversion, aggregated in SQL.
--
-- WHY: /api/dashboard/insights/initial-analysis previously streamed EVERY
-- order for the shop into the Node function (fetchAllOrders paginated all
-- rows 1000-at-a-time) purely to bucket them by risk_level_initial and
-- flag which ones were disputed. For a large historical importer this is
-- hundreds of serial round-trips + hundreds of thousands of rows in memory
-- on every page load — the request exceeds the serverless timeout and the
-- Insights page ("Chargeback Exposure") spins forever. Blume Box tipped
-- past this the moment its 354k-order backfill completed.
--
-- This function does the same bucketing set-based in one round-trip:
-- per risk bucket, total orders and how many join to a dispute via
-- disputes.order_gid == shopify_orders.shopify_order_id. Buckets mirror the
-- route's mapping exactly (HIGH/MEDIUM/LOW/PENDING, everything else NONE).
--
-- SECURITY DEFINER + explicit p_shop_id filter: the route is service-role
-- already; the function is shop-scoped and never trusts a caller-supplied
-- shape beyond the uuid. Matches the claim_jobs / gorgias_* RPC convention.

create or replace function insights_risk_conversion(p_shop_id uuid)
returns table (
  bucket text,
  orders bigint,
  disputes bigint
)
language sql
security definer
set search_path = public
as $$
  with mapped as (
    select
      case upper(coalesce(o.risk_level_initial, ''))
        when 'HIGH'    then 'high'
        when 'MEDIUM'  then 'medium'
        when 'LOW'     then 'low'
        when 'PENDING' then 'pending'
        else 'none'
      end as bucket,
      exists (
        select 1 from disputes d
        where d.shop_id = p_shop_id
          and d.order_gid = o.shopify_order_id
      ) as is_disputed
    from shopify_orders o
    where o.shop_id = p_shop_id
  )
  select
    bucket,
    count(*)::bigint as orders,
    count(*) filter (where is_disputed)::bigint as disputes
  from mapped
  group by bucket;
$$;

-- Admin-only surface today (service role reads it); no merchant roles.
revoke all on function insights_risk_conversion(uuid) from anon, authenticated;
