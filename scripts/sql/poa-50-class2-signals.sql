-- Which supporting signals are being withheld, and are they genuinely supportive?
select f->>'category' as category,
       coalesce(f->'value'->>'locationMatch', f->'value'->>'priorOrderCount', '(n/a)') as signal,
       f->>'strength' as strength,
       count(*) as facts,
       count(distinct dp.id) as packages
from defence_packages dp join disputes d on d.id=dp.dispute_id,
     jsonb_array_elements(case when jsonb_typeof(dp.facts_json)='array' then dp.facts_json else '[]'::jsonb end) f
where d.final_outcome='lost' and d.reason='FRAUDULENT' and dp.submitted_at is not null
  and f->>'category' in ('ip_location','prior_customer_history')
  and not (f->>'bankEligible'='true' and f->>'includeInBankNarrative'='true'
           and coalesce(f->>'submissionRisk','false')<>'true')
group by 1,2,3 order by 1, facts desc;
