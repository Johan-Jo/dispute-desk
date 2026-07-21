-- Historical Intelligence Engine — Phase C: Policy Simulator segment RPC.
--
-- Computes the order-side + dispute-side aggregates for a policy segment
-- entirely in SQL (no 354k-row memory load). The TS simulator layers
-- effectiveness scenarios, costs, confidence, and limitations on top (design
-- §16). Read-only aggregation; security invoker; service-role only.
--
-- Filters (all optional / null = no filter):
--   p_min_value       numeric  — order_total >= this
--   p_risk_levels     text[]   — risk_level_initial IN (…)  [retrospective — labeled in TS]
--   p_countries       text[]   — country IN (…)
--   p_gateways        text[]   — payment_gateway IN (…)
--   p_cross_border    boolean  — is_cross_border = this
--   p_reasons         text[]   — dispute reason IN (…) for the dispute-side net loss

create or replace function intel_simulate_segment(
  p_shop_id      uuid,
  p_min_value    numeric  default null,
  p_risk_levels  text[]   default null,
  p_countries    text[]   default null,
  p_gateways     text[]   default null,
  p_cross_border boolean  default null,
  p_reasons      text[]   default null
)
returns jsonb
language sql
stable
security invoker
as $$
with seg_orders as (
  select o.shopify_order_id, o.order_total
  from shopify_orders o
  where o.shop_id = p_shop_id
    and (p_min_value    is null or o.order_total >= p_min_value)
    and (p_risk_levels  is null or o.risk_level_initial = any(p_risk_levels))
    and (p_countries    is null or o.country = any(p_countries))
    and (p_gateways     is null or o.payment_gateway = any(p_gateways))
    and (p_cross_border is null or o.is_cross_border = p_cross_border)
),
seg_disputes as (
  select d.id, d.amount,
         coalesce(d.outcome_amount_recovered, 0) as recovered
  from disputes d
  join seg_orders so on so.shopify_order_id = d.order_gid
  where d.shop_id = p_shop_id
    and (p_reasons is null or d.reason = any(p_reasons))
)
select jsonb_build_object(
  'orders_affected',      (select count(*) from seg_orders),
  'revenue_affected',     coalesce((select sum(order_total) from seg_orders), 0),
  'disputes_in_segment',  (select count(*) from seg_disputes),
  'disputed_value',       coalesce((select sum(amount) from seg_disputes), 0),
  'net_loss_in_segment',  coalesce((select sum(greatest(amount - recovered, 0)) from seg_disputes), 0),
  'legit_orders_affected',(select count(*) from seg_orders so
                             where not exists (select 1 from disputes d
                               where d.shop_id = p_shop_id and d.order_gid = so.shopify_order_id))
);
$$;

revoke all on function intel_simulate_segment(uuid, numeric, text[], text[], text[], boolean, text[]) from anon, authenticated;

comment on function intel_simulate_segment is
  'Policy Simulator segment aggregates (orders/revenue/disputes/net-loss/legit-orders) computed in SQL. TS layers effectiveness scenarios + costs. Phase C.';
