select
  count(*) as pkgs,
  count(*) filter (where dp.document_validation_passed is null)  as docval_null,
  count(*) filter (where dp.document_validation_passed is false) as docval_false,
  count(*) filter (where dp.document_validation_passed is true)  as docval_true,
  count(*) filter (where dp.validator_version is null)           as validator_version_null,
  count(*) filter (where d.evidence_saved_to_shopify_at > (d.raw_snapshot->>'evidenceSentOn')::timestamptz) as saved_after_forwarded
from defence_packages dp
join disputes d on d.id=dp.dispute_id
where d.final_outcome in ('won','lost') and dp.submitted_at is not null;
