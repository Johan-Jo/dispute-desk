-- What drives "partial" coverage when a FULL refund was issued?
-- Mostly: the disputed amount exceeding the order value (fees, FX).
-- Distribution of dispute.amount / order_total across all disputes.
select
  case
    when d.amount::numeric <= o.order_total::numeric              then 'dispute <= order (full refund covers)'
    when d.amount::numeric <= o.order_total::numeric * 1.02       then 'order < dispute <= +2%'
    when d.amount::numeric <= o.order_total::numeric * 1.05       then '+2% to +5%'
    when d.amount::numeric <= o.order_total::numeric * 1.10       then '+5% to +10%'
    when d.amount::numeric <= o.order_total::numeric * 1.25       then '+10% to +25%'
    else                                                               'more than +25%'
  end as bucket,
  count(*) as disputes,
  round(min(d.amount::numeric / nullif(o.order_total::numeric,0)), 4) as min_ratio,
  round(max(d.amount::numeric / nullif(o.order_total::numeric,0)), 4) as max_ratio
from disputes d
join shopify_orders o
  on o.shop_id = d.shop_id and o.shopify_order_id = d.order_gid
where d.amount is not null
  and o.order_total is not null
  and o.order_total::numeric > 0
group by 1
order by 2 desc;
