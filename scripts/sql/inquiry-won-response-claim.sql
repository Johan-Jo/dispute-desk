-- Blast radius: inquiry-won outcome emails that asserted "Your response
-- satisfied them" with no submitted defence package behind the claim.
--
-- The send is claimed via `withEffectDedup` (lib/disputes/dispatchOnce.ts),
-- which writes one `audit_events` row per effect with
-- event_type = 'effect:outcome_posted_alert'. Join back to defence_packages
-- to split the sends that had something filed from the ones that did not.
select
  case when p.id is null then 'no package' else 'submitted package' end as filed,
  count(*) as emails,
  min(a.created_at)::date as first_sent,
  max(a.created_at)::date as last_sent
from audit_events a
join disputes d on d.id = a.dispute_id
left join defence_packages p
  on p.dispute_id = d.id and p.status = 'submitted'
where a.event_type = 'effect:outcome_posted_alert'
  and d.phase = 'inquiry'
  and d.final_outcome = 'won'
group by 1
order by emails desc;
