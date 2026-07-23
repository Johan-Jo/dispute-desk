with disputed as (
  select d.id as dispute_id, so.id as order_id, so.shop_id,
         so.customer_shopify_id, so.processed_at, rs.client_ip
  from disputes d
  join shopify_orders so
    on so.shop_id = d.shop_id and so.shopify_order_id = d.order_gid
  left join shopify_order_risk_signals rs
    on rs.shop_id = so.shop_id and rs.shopify_order_id = so.shopify_order_id
  where d.reason in ('FRAUDULENT','UNRECOGNIZED')
    and so.customer_shopify_id is not null
),
scored as (
  select cur.dispute_id,
    (select count(*) from shopify_orders p
      where p.shop_id = cur.shop_id
        and p.customer_shopify_id = cur.customer_shopify_id
        and p.id <> cur.order_id
        and p.processed_at <= cur.processed_at - interval '120 days'
        and p.processed_at >= cur.processed_at - interval '365 days'
        and coalesce(p.has_chargeback, false) = false) as ce3_priors,
    (select count(*) from shopify_orders p
      join shopify_order_risk_signals prs
        on prs.shop_id = p.shop_id and prs.shopify_order_id = p.shopify_order_id
      where p.shop_id = cur.shop_id
        and p.customer_shopify_id = cur.customer_shopify_id
        and p.id <> cur.order_id
        and p.processed_at <= cur.processed_at - interval '120 days'
        and p.processed_at >= cur.processed_at - interval '365 days'
        and coalesce(p.has_chargeback, false) = false
        and prs.client_ip is not null and prs.client_ip = cur.client_ip) as ce3_priors_same_ip
  from disputed cur
)
select count(*) as fraud_disputes,
       count(*) filter (where ce3_priors >= 2) as qualify_window_only,
       count(*) filter (where ce3_priors_same_ip >= 2) as qualify_full_ce3
from scored;
