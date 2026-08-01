-- blume-box: dispute-initiation pattern by day-of-week (90d) + list of zero-days in last 60d
with s as (select id from shops where shop_domain = 'blume-box.myshopify.com'),
daily as (
  select d.day::date as day, count(dis.id) as n
  from generate_series(now() - interval '60 days', now(), interval '1 day') d(day)
  left join disputes dis
    on dis.shop_id = (select id from s)
   and dis.initiated_at >= d.day::date and dis.initiated_at < d.day::date + 1
  group by 1
)
select 'dow_' || to_char(day, 'Dy') as metric, round(avg(n),2)::text as avg_disputes, sum(n)::text as total
from daily group by to_char(day, 'Dy'), extract(isodow from day)
union all
select 'zero_day ' || day::text, '0', ''
from daily where n = 0
order by 1;
