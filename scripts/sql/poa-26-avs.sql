select (f->>'bankEligible'='true' and f->>'includeInBankNarrative'='true'
        and coalesce(f->>'submissionRisk','false')<>'true') as issuer_facing,
       coalesce(f->'value'->>'network','(none)') as network,
       coalesce(f->'value'->>'avsResult','(null)') as avs,
       coalesce(f->'value'->>'cvvResult','(null)') as cvv,
       count(*) as n
from defence_packages dp join disputes d on d.id=dp.dispute_id,
     jsonb_array_elements(case when jsonb_typeof(dp.facts_json)='array' then dp.facts_json else '[]'::jsonb end) f
where d.final_outcome='lost' and d.reason='FRAUDULENT' and dp.submitted_at is not null
  and f->>'category'='payment_authentication'
group by 1,2,3,4 order by issuer_facing desc, n desc;
