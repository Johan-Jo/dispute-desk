-- Decided-dispute view PR 3 (docs/plans/decided-dispute-view.plan.md §6):
-- per-shop, per-reason decided counts, win rate, and the two lesson patterns
-- the "Next time" card can quantify. Read-only.
with d as (
  select d.shop_id, s.shop_domain, d.id, d.reason, d.normalized_status st, d.initiated_at,
         o.fulfillment_status, o.fulfilled_at, o.risk_recommendation_initial risk
  from disputes d
  join shops s on s.id = d.shop_id
  left join shopify_orders o on o.shop_id = d.shop_id and o.shopify_order_id = d.order_gid
  where d.normalized_status in ('won','lost')
)
select shop_domain, reason,
  count(*) decided,
  count(*) filter (where st='won') won,
  count(*) filter (where st='lost') lost,
  round(100.0*count(*) filter (where st='won')/count(*)) win_pct,
  count(*) filter (where st='lost' and fulfillment_status is null) lost_no_order,
  count(*) filter (where st='lost' and (fulfilled_at is null or fulfilled_at > initiated_at) and fulfillment_status is not null) lost_unshipped_at_open,
  count(*) filter (where st='lost' and upper(risk) in ('CANCEL','INVESTIGATE') and fulfilled_at is not null) lost_highrisk_shipped
from d group by 1,2 having count(*) >= 5 order by 1, decided desc;
