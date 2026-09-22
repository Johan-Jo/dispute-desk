with gf as (
  select dp.dispute_id, f->>'id' as fact_id, f->>'sourceRef' as source_ref,
         left(f->'value'->>'excerpt', 40) as excerpt_head
  from defence_packages dp
  join disputes d on d.id=dp.dispute_id,
       jsonb_array_elements(case when jsonb_typeof(dp.facts_json)='array' then dp.facts_json else '[]'::jsonb end) f
  where d.final_outcome in ('won','lost') and dp.submitted_at is not null
    and f->>'source' = 'gorgias'
)
select gf.*,
       (select count(*) from gorgias_evidence_messages g
         where g.id::text = gf.source_ref)                       as matches_message_id,
       (select count(*) from gorgias_evidence_messages g
         where g.dispute_id = gf.dispute_id)                      as msgs_on_dispute,
       (select count(*) from gorgias_evidence_messages g
         where g.dispute_id = gf.dispute_id and g.review_status='approved') as approved_on_dispute
from gf;
