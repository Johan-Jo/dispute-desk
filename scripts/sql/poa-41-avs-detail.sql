select d.order_name, dp.prompt_version,
       f->'value'->>'avsResult'              as avs,
       f->'value'->>'cvvResult'              as cvv,
       f->'value'->>'network'                as network,
       f->'value'->>'addressVerified'        as address_verified,
       f->'value'->>'securityCodeVerified'   as code_verified,
       f->'value'->>'verificationSummary'    as summary,
       dp.narrative_json->'paymentAuthenticationArgument'->>'text' as payment_section
from defence_packages dp
join disputes d on d.id = dp.dispute_id,
     jsonb_array_elements(case when jsonb_typeof(dp.facts_json)='array' then dp.facts_json else '[]'::jsonb end) f
where dp.submitted_at is not null
  and f->>'category' = 'payment_authentication'
  and f->'value'->>'avsResult' = 'N'
  and d.order_name in ('#349145','#349144','#351825','#349644')
order by d.order_name;
