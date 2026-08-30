with sub as (
  select d.id as dispute_id, d.reason, d.final_outcome, d.submission_state,
         d.raw_snapshot->>'evidenceSentOn' as sent_on,
         dp.id as pkg_id,
         (dp.shopify_response->>'evidenceGid') = d.dispute_evidence_gid as gid_tied
  from disputes d
  join defence_packages dp on dp.dispute_id=d.id and dp.submitted_at is not null
  where d.final_outcome in ('won','lost')
),
agg as (
  select dispute_id, reason, final_outcome,
         count(*) as pkgs,
         bool_and(gid_tied)                                        as all_tied,
         bool_or(submission_state='submitted_confirmed')           as confirmed,
         bool_or(sent_on is not null)                              as trusted_sent_on
  from sub group by 1,2,3
)
select
  case
    when pkgs > 1                                then 'DATA_INTEGRITY_LIMITATION (ambiguous package)'
    when confirmed and trusted_sent_on and all_tied then 'FULL_POST_OUTCOME'
    else 'PACKAGE_INTEGRITY_ONLY'
  end as analysis_level,
  reason, final_outcome, count(*) as disputes
from agg
group by 1,2,3 order by 1, disputes desc;
