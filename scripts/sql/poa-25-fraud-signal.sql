with x as (
  select f->>'category' as category,
         (f->>'bankEligible'='true' and f->>'includeInBankNarrative'='true'
          and coalesce(f->>'submissionRisk','false')<>'true') as issuer_facing,
         f->'value' as v
  from defence_packages dp join disputes d on d.id=dp.dispute_id,
       jsonb_array_elements(case when jsonb_typeof(dp.facts_json)='array' then dp.facts_json else '[]'::jsonb end) f
  where d.final_outcome='lost' and d.reason='FRAUDULENT' and dp.submitted_at is not null
    and f->>'category' in ('payment_authentication','prior_customer_history','ip_location')
)
select category,
       coalesce(v->>'locationMatch', v->>'avsResultCode', v->>'result',
                v->>'priorOrderCount', v->>'status', left(v::text,60)) as signal,
       issuer_facing, count(*) as n
from x group by 1,2,3 order by category, n desc;
