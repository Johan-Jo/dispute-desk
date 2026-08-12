-- Blume Box reference-case numbers. READ-ONLY. No modelling — raw counts only.
with s as (select id, shop_domain, created_at from shops where shop_domain ilike '%blume-box%')
select 'A. shop' as section, shop_domain as k1, created_at::date::text as k2,
       null::text as k3, null::text as k4, null::text as k5
from s
union all
select 'B. disputes by currency', d.currency_code, count(*)::text,
       round(sum(d.amount)::numeric,2)::text, round(avg(d.amount)::numeric,2)::text,
       min(d.initiated_at)::date::text || ' .. ' || max(d.initiated_at)::date::text
from disputes d join s on d.shop_id=s.id group by d.currency_code
union all
select 'C. by final_outcome', coalesce(d.final_outcome,'(null)'), count(*)::text,
       round(sum(coalesce(d.outcome_amount_recovered,0))::numeric,2)::text,
       round(sum(coalesce(d.outcome_amount_lost,0))::numeric,2)::text, null
from disputes d join s on d.shop_id=s.id group by d.final_outcome
union all
select 'D. by status', coalesce(d.status,'(null)'), count(*)::text, null, null, null
from disputes d join s on d.shop_id=s.id group by d.status
order by 1,3 desc nulls last;
