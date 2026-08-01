-- Daily dispute inflow for blume-box, last 21 days: by dispute initiation date and by when our row was created
with s as (select id from shops where shop_domain = 'blume-box.myshopify.com')
select 'by_initiated' as axis, date_trunc('day', initiated_at)::date as day, count(*) as n
from disputes where shop_id = (select id from s) and initiated_at >= now() - interval '21 days'
group by 2
union all
select 'by_created', date_trunc('day', created_at)::date, count(*)
from disputes where shop_id = (select id from s) and created_at >= now() - interval '21 days'
group by 2
order by 1, 2;
