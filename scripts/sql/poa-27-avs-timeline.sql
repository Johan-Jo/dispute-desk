select coalesce(f->'value'->>'avsResult','(null)') as avs,
       (f->>'bankEligible'='true' and f->>'includeInBankNarrative'='true'
        and coalesce(f->>'submissionRisk','false')<>'true') as shown,
       dp.prompt_version, dp.validator_version,
       count(*) as n,
       min(dp.generated_at)::date as first_built,
       max(dp.generated_at)::date as last_built
from defence_packages dp join disputes d on d.id=dp.dispute_id,
     jsonb_array_elements(case when jsonb_typeof(dp.facts_json)='array' then dp.facts_json else '[]'::jsonb end) f
where d.final_outcome='lost' and d.reason='FRAUDULENT' and dp.submitted_at is not null
  and f->>'category'='payment_authentication'
group by 1,2,3,4 order by last_built desc;
