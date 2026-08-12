-- The prose behind every address-claim validation failure since PR-C1 hit prod.
-- One row per (package, failing section) with the section's actual text, so
-- each can be judged as a genuine claim or a detector false positive.
select
  dp.id            as package_id,
  dp.dispute_id,
  dp.version,
  dp.created_at,
  e->>'rule'       as rule,
  e->>'section'    as section,
  dp.narrative_json -> (e->>'section') ->> 'text' as section_text
from defence_packages dp
cross join lateral jsonb_array_elements(dp.validation_errors) e
where dp.validation_errors is not null
  and jsonb_typeof(dp.validation_errors) = 'array'
  and dp.created_at >= '2026-08-08 14:31:00+00'
  and e->>'section' is not null
  and dp.narrative_json is not null
order by dp.created_at desc;
