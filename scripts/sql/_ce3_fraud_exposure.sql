-- CE3.0 window feasibility using customer_shopify_id + processed_at.
with fraud_orders as (
  select d.id as dispute_id, o.id as order_id, o.shop_id,
         o.customer_shopify_id, o.processed_at
  from disputes d
  join shopify_orders o
    on o.shop_id = d.shop_id
   and o.shopify_order_id = replace(d.order_gid, 'gid://shopify/Order/', '')
  where d.reason in ('FRAUDULENT','UNRECOGNIZED')
    and o.customer_shopify_id is not null
)
select f.dispute_id,
       count(o2.id) filter (
         where o2.processed_at < f.processed_at - interval '120 days'
           and o2.processed_at >= f.processed_at - interval '365 days'
       ) as ce3_window_priors,
       count(o2.id) filter (where o2.processed_at < f.processed_at) as any_priors
from fraud_orders f
left join shopify_orders o2
  on o2.shop_id = f.shop_id
 and o2.customer_shopify_id = f.customer_shopify_id
 and o2.id <> f.order_id
group by f.dispute_id
order by any_priors desc
limit 8;
