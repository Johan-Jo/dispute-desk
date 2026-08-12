-- What has happened SINCE DisputeDesk was installed at Blume Box, vs before.
-- USD only (99% of volume); the single VND row distorts every pooled sum.
with s as (select id, created_at as installed_at from shops where shop_domain ilike '%blume-box%')
select 'since install' as window,
       count(*)::text as disputes,
       round(sum(d.amount)::numeric,2)::text as amount_usd,
       count(*) filter (where d.final_outcome='won')::text as won,
       count(*) filter (where d.final_outcome='lost')::text as lost,
       count(*) filter (where d.final_outcome is null)::text as open,
       round(sum(coalesce(d.outcome_amount_recovered,0))::numeric,2)::text as recovered_usd
from disputes d join s on d.shop_id=s.id
where d.currency_code='USD' and d.initiated_at >= s.installed_at
union all
select 'last 90d before install', count(*)::text, round(sum(d.amount)::numeric,2)::text,
       count(*) filter (where d.final_outcome='won')::text,
       count(*) filter (where d.final_outcome='lost')::text,
       count(*) filter (where d.final_outcome is null)::text,
       round(sum(coalesce(d.outcome_amount_recovered,0))::numeric,2)::text
from disputes d join s on d.shop_id=s.id
where d.currency_code='USD'
  and d.initiated_at >= s.installed_at - interval '90 days' and d.initiated_at < s.installed_at
union all
select 'all time (USD)', count(*)::text, round(sum(d.amount)::numeric,2)::text,
       count(*) filter (where d.final_outcome='won')::text,
       count(*) filter (where d.final_outcome='lost')::text,
       count(*) filter (where d.final_outcome is null)::text,
       round(sum(coalesce(d.outcome_amount_recovered,0))::numeric,2)::text
from disputes d join s on d.shop_id=s.id where d.currency_code='USD';
