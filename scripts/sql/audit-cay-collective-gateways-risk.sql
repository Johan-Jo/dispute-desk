-- Gateway + 3DS breakdown
with s as (select 'c497df8d-632d-49da-b385-eb523f57f341'::uuid as sid)
select payment_gateway,
       count(*) as orders,
       count(*) filter (where three_ds_authenticated is true) as tds_true,
       count(*) filter (where three_ds_authenticated is false) as tds_false,
       count(*) filter (where three_ds_authenticated is null) as tds_null
from shopify_orders, s
where shop_id = s.sid
group by payment_gateway
order by orders desc;
