-- TRUE CE3.0 qualification with real element matching, post-backfill.
-- CE3.0: >=2 prior undisputed orders in the 120-365d window that share
-- with the disputed order at least the IP/device element (client_ip OR
-- user_agent) PLUS a second element (same customer = account id).
with disputed as (
  select d.id as dispute_id, so.id as order_id, so.shop_id,
         so.customer_shopify_id, so.processed_at,
         rs.client_ip, rs.user_agent
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
        and coalesce(p.has_chargeback,false)=false) as priors_in_window,
    (select count(*) from shopify_orders p
      join shopify_order_risk_signals prs
        on prs.shop_id=p.shop_id and prs.shopify_order_id=p.shopify_order_id
      where p.shop_id = cur.shop_id
        and p.customer_shopify_id = cur.customer_shopify_id
        and p.id <> cur.order_id
        and p.processed_at <= cur.processed_at - interval '120 days'
        and p.processed_at >= cur.processed_at - interval '365 days'
        and coalesce(p.has_chargeback,false)=false
        and ((prs.client_ip is not null and prs.client_ip = cur.client_ip)
          or (prs.user_agent is not null and prs.user_agent = cur.user_agent))
    ) as priors_matching_element
  from disputed cur
)
select count(*) as fraud_disputes,
       count(*) filter (where priors_in_window >= 2) as ge2_priors,
       count(*) filter (where priors_matching_element >= 2) as ce3_qualify
from scored;
