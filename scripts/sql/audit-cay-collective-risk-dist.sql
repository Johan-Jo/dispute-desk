-- All-time risk_level_initial distribution (drives hero distribution bar)
with s as (select 'c497df8d-632d-49da-b385-eb523f57f341'::uuid as sid)
select coalesce(upper(risk_level_initial), '(null)') as risk,
       count(*) as orders,
       round(100.0 * count(*) / sum(count(*)) over (), 2) as pct
from shopify_orders, s
where shop_id = s.sid
group by 1
order by orders desc;
