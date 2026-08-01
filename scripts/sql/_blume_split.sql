with d as (
  select dd.*,
         (select count(*) from evidence_packs ep where ep.dispute_id=dd.id) as packs
  from disputes dd
  join shops s on s.id=dd.shop_id
  where s.shop_domain ilike '%blume%'
)
select
  case
    when due_at < timestamptz '2026-07-20 16:47:23+00' then 'due_before_install'
    else 'due_after_install'
  end as bucket,
  case when packs > 0 then 'has_pack' else 'no_pack' end as pack_state,
  count(*) as n,
  min(due_at::date) as earliest_due,
  max(due_at::date) as latest_due
from d
group by 1,2
order by 1,2;
