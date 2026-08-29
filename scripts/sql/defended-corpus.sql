-- THE population this feature serves: disputes DisputeDesk actually defended.
with defended as (
  select d.*, dp.facts_json,
         coalesce(ep.pack_json->'payment_context'->>'family','card') as pay_family
  from disputes d
  join defence_packages dp on dp.dispute_id=d.id and dp.status='submitted'
  left join evidence_packs ep on ep.dispute_id=d.id
  where d.normalized_status in ('won','lost')
)
select normalized_status, pay_family,
  count(*) as cases,
  count(*) filter (where jsonb_typeof(facts_json)='array' and jsonb_array_length(facts_json)>0) as with_facts
from defended group by 1,2 order by cases desc;
