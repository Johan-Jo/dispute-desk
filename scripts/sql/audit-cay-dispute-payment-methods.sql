-- Payment-method breakdown of cay-collective disputes (prod)
select
  case
    when o.payment_method ilike 'klarna%' then 'klarna'
    when o.payment_method = 'card' then 'card'
    when o.payment_method = 'apple_pay' then 'apple_pay'
    else coalesce(o.payment_method, o.payment_gateway, '(other)')
  end as bucket,
  count(*) as disputes
from disputes d
join shopify_orders o
  on o.shopify_order_id = d.order_gid
  and o.shop_id = d.shop_id
where d.shop_id = 'c497df8d-632d-49da-b385-eb523f57f341'
group by 1
order by disputes desc;
