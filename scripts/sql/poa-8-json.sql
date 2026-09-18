select
  count(*)                                                          as submitted_pkgs_on_decided,
  count(*) filter (where dp.facts_json    is not null)              as with_facts_json,
  count(*) filter (where dp.narrative_json is not null)             as with_narrative_json,
  count(*) filter (where dp.plan_json     is not null)              as with_plan_json,
  count(*) filter (where dp.evidence_hash is not null)              as with_evidence_hash,
  count(*) filter (where dp.pdf_path      is not null)              as with_pdf_path,
  count(*) filter (where dp.shopify_response is not null)           as with_shopify_response,
  count(distinct dp.prompt_version)                                 as prompt_versions,
  count(distinct dp.validator_version)                              as validator_versions,
  avg(jsonb_array_length(case when jsonb_typeof(dp.facts_json)='array' then dp.facts_json else '[]'::jsonb end))::numeric(6,1) as avg_facts_len
from defence_packages dp
join disputes d on d.id=dp.dispute_id
where d.final_outcome in ('won','lost') and dp.submitted_at is not null;
