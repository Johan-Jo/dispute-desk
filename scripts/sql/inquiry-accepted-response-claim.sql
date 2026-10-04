-- Reach of the two adjacent claims fixed alongside the inquiry-won guard.
--
--  * accepted-inquiry sends that asserted "No response submitted"
--  * won sends whose record paragraph promised "the evidence submitted"
--    with no package behind it
--
-- Same effect row as inquiry-won-response-claim.sql
-- (event_type = 'effect:outcome_posted_alert', written by withEffectDedup).
select
  d.phase,
  d.final_outcome,
  case when p.id is null then 'no package' else 'submitted package' end as filed,
  count(*) as emails,
  max(a.created_at)::date as last_sent
from audit_events a
join disputes d on d.id = a.dispute_id
left join defence_packages p
  on p.dispute_id = d.id and p.status = 'submitted'
where a.event_type = 'effect:outcome_posted_alert'
  and (
    (d.phase = 'inquiry' and d.final_outcome not in ('won', 'lost'))
    or d.final_outcome = 'won'
  )
group by 1, 2, 3
order by emails desc;
