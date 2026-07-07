-- Full census of every payment_method value on cay-collective orders,
-- with gateway, so we can see which card/wallet rails they actually use.
select
  coalesce(payment_method, '(null)')  as payment_method,
  coalesce(payment_gateway, '(null)') as payment_gateway,
  count(*)                            as orders,
  min(processed_at)                   as earliest,
  max(processed_at)                   as latest
from shopify_orders
where shop_id = 'c497df8d-632d-49da-b385-eb523f57f341'
group by 1,2
order by orders desc;
