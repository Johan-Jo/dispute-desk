select (f->>'bankEligible'='true' and f->>'includeInBankNarrative'='true'
        and coalesce(f->>'submissionRisk','false')<>'true') as issuer_facing,
       f->>'strength' as strength,
       jsonb_pretty(f->'value') as value,
       count(*) as n
from defence_packages dp join disputes d on d.id=dp.dispute_id,
     jsonb_array_elements(case when jsonb_typeof(dp.facts_json)='array' then dp.facts_json else '[]'::jsonb end) f
where d.final_outcome='lost' and d.reason='FRAUDULENT' and dp.submitted_at is not null
  and f->>'category'='prior_customer_history'
  and f->'value' ? 'priorOrderCount'
group by 1,2,3 order by issuer_facing desc, n desc limit 8;
