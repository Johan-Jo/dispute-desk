select
  count(*) as lost_defended,
  count(*) filter (where p.id is not null) as has_submitted_pkg,
  count(*) filter (where jsonb_typeof(p.facts_json)='array' and jsonb_array_length(p.facts_json)>0) as has_facts,
  count(*) filter (where p.narrative_json is not null) as has_narrative,
  min(d.closed_at) as earliest_loss, max(d.closed_at) as latest_loss
from disputes d
left join defence_packages p on p.dispute_id=d.id and p.status='submitted'
where d.normalized_status='lost' and d.submission_state='submitted_confirmed';
