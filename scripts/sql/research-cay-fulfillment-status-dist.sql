with s as (select 'c497df8d-632d-49da-b385-eb523f57f341'::uuid as sid)
select coalesce(fulfillment_status, '(null)') as fulfillment_status,
       count(*) as orders
from shopify_orders, s
where shop_id = s.sid
group by 1
order by orders desc;
