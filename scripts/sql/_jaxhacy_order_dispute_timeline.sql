select o.shopify_order_number, o.processed_at, o.order_total,
       o.risk_level_initial, o.risk_recommendation_initial,
       d.id as dispute_id, d.reason, d.initiated_at as dispute_opened
from shopify_orders o
left join disputes d
  on d.shop_id = o.shop_id and d.order_gid = o.shopify_order_id
where o.shop_id = '6648353c-422a-4ee5-8bba-d75fee284b09'
  and o.customer_email = 'jaxhacy@gmail.com'
order by o.processed_at;
