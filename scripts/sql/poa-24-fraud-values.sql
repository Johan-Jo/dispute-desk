select f->>'category' as category,
       (f->>'bankEligible'='true' and f->>'includeInBankNarrative'='true'
        and coalesce(f->>'submissionRisk','false')<>'true') as issuer_facing,
       jsonb_pretty(f->'value') as value
from defence_packages dp join disputes d on d.id=dp.dispute_id,
     jsonb_array_elements(case when jsonb_typeof(dp.facts_json)='array' then dp.facts_json else '[]'::jsonb end) f
where d.final_outcome='lost' and d.reason='FRAUDULENT' and dp.submitted_at is not null
  and f->>'category' in ('payment_authentication','prior_customer_history','ip_location')
order by category, issuer_facing
limit 6;
