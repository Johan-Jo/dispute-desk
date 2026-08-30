with a as (
  select d.id, d.due_at, d.submission_state,
         d.raw_snapshot->>'evidenceSentOn' as sent_on,
         d.evidence_saved_to_shopify_at as saved_at,
         dp.generated_at, dp.submitted_at as pkg_submitted, dp.status as pkg_status,
         dp.validation_status, dp.document_validation_passed
  from disputes d
  join defence_packages dp on dp.dispute_id=d.id and dp.submitted_at is not null
  where d.final_outcome in ('won','lost')
)
select
  count(*)                                                                   as pkgs,
  count(*) filter (where generated_at > coalesce(sent_on::timestamptz, pkg_submitted)) as generated_after_submission,
  count(*) filter (where coalesce(sent_on::timestamptz, pkg_submitted) > due_at)       as submitted_after_deadline,
  count(*) filter (where due_at is null)                                     as no_deadline,
  count(*) filter (where saved_at > coalesce(sent_on::timestamptz, pkg_submitted))     as saved_after_forwarded,
  count(*) filter (where submission_state='submitted_confirmed' and sent_on is null)   as confirmed_without_senton,
  count(*) filter (where validation_status is distinct from 'ok')            as validation_not_ok,
  count(*) filter (where document_validation_passed is not true)             as doc_validation_not_passed,
  count(*) filter (where pkg_status <> 'submitted')                          as status_not_submitted,
  min(extract(epoch from (coalesce(sent_on::timestamptz, pkg_submitted) - generated_at))/3600)::numeric(8,1) as min_gen_to_send_hours,
  max(extract(epoch from (coalesce(sent_on::timestamptz, pkg_submitted) - generated_at))/3600)::numeric(8,1) as max_gen_to_send_hours
from a;
