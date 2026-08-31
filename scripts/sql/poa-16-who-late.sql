with a as (
  select d.id, d.due_at,
         (d.raw_snapshot->>'evidenceSentOn')::timestamptz as sent_on,
         dp.submitted_at as we_submitted,
         d.evidence_saved_to_shopify_at as we_saved
  from disputes d
  join defence_packages dp on dp.dispute_id=d.id and dp.submitted_at is not null
  where d.final_outcome in ('won','lost') and d.due_at is not null
)
select
  count(*)                                                     as pkgs,
  count(*) filter (where we_submitted > due_at)                 as WE_submitted_after_deadline,
  count(*) filter (where we_saved     > due_at)                 as we_saved_after_deadline,
  count(*) filter (where sent_on      > due_at)                 as shopify_forwarded_after_deadline,
  count(*) filter (where we_submitted <= due_at and sent_on > due_at) as ontime_but_forwarded_late,
  round(avg(extract(epoch from (sent_on - we_submitted))/3600.0)::numeric,2) as avg_hours_we_to_shopify,
  round(avg(extract(epoch from (due_at - we_submitted))/3600.0)::numeric,2)  as avg_hours_early_we_were,
  min(extract(epoch from (due_at - we_submitted))/3600.0)::numeric(8,1)      as min_hours_early,
  max(extract(epoch from (due_at - we_submitted))/3600.0)::numeric(8,1)      as max_hours_early
from a;
