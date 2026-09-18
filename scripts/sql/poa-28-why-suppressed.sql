select f->>'category' as category,
       f->>'bankEligible' as bank_eligible,
       f->>'includeInBankNarrative' as include_narr,
       coalesce(f->>'submissionRisk','false') as submission_risk,
       f->>'strength' as strength,
       count(*) as n
from defence_packages dp join disputes d on d.id=dp.dispute_id,
     jsonb_array_elements(case when jsonb_typeof(dp.facts_json)='array' then dp.facts_json else '[]'::jsonb end) f
where d.final_outcome='lost' and d.reason='FRAUDULENT' and dp.submitted_at is not null
  and f->>'category' in ('order_record','ip_location','policy_refund')
group by 1,2,3,4,5 order by 1, n desc;
