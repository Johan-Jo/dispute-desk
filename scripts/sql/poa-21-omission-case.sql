select d.id as dispute_id, d.order_name,
       g.id as msg_id, g.review_status, g.approved_at, g.evidence_category,
       (select count(*) from jsonb_array_elements(
          case when jsonb_typeof(dp.facts_json)='array' then dp.facts_json else '[]'::jsonb end) f
        where f->>'source'='gorgias')                                        as gorgias_facts,
       (select string_agg(concat(f->>'id',':bank=',f->>'bankEligible',
                                 ',narr=',f->>'includeInBankNarrative',
                                 ',risk=',f->>'submissionRisk'), ' | ')
          from jsonb_array_elements(
            case when jsonb_typeof(dp.facts_json)='array' then dp.facts_json else '[]'::jsonb end) f
         where f->>'source'='gorgias')                                       as gorgias_fact_flags
from disputes d
join defence_packages dp on dp.dispute_id=d.id and dp.submitted_at is not null
join gorgias_evidence_messages g on g.dispute_id=d.id
where d.final_outcome in ('won','lost') and g.review_status='approved'
order by d.id, g.approved_at;
