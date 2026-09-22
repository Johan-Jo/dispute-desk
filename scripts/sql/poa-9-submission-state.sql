with analyzable as (
  select d.id, d.submission_state, d.submitted_at, d.evidence_saved_to_shopify_at,
         d.final_outcome, d.reason,
         dp.status as pkg_status, dp.submitted_at as pkg_submitted_at,
         dp.shopify_response
  from disputes d
  join defence_packages dp on dp.dispute_id=d.id and dp.submitted_at is not null
  where d.final_outcome in ('won','lost')
)
select
  coalesce(submission_state,'(null)')                       as submission_state,
  pkg_status,
  count(*)                                                  as n,
  count(*) filter (where submitted_at is not null)           as d_submitted_at,
  count(*) filter (where evidence_saved_to_shopify_at is not null) as d_saved_at,
  count(*) filter (where shopify_response ? 'verified')      as resp_has_verified,
  count(*) filter (where shopify_response->>'verified' = 'true') as resp_verified_true,
  count(*) filter (where shopify_response ? 'finalStatus')   as resp_has_finalstatus,
  count(*) filter (where shopify_response ? 'evidenceGid')   as resp_has_evidencegid,
  count(*) filter (where shopify_response ? 'fileGid')       as resp_has_filegid
from analyzable
group by 1,2 order by n desc;
