with sub as (
  select d.id as dispute_id, d.dispute_evidence_gid, d.submission_state, d.submitted_at,
         d.raw_snapshot ? 'evidenceSentOn'                       as snap_has_sent_on,
         d.raw_snapshot->>'evidenceSentOn'                       as snap_sent_on,
         dp.id as pkg_id, dp.version, dp.content_revision,
         dp.shopify_response->>'evidenceGid'                     as resp_evidence_gid
  from disputes d
  join defence_packages dp on dp.dispute_id=d.id and dp.submitted_at is not null
  where d.final_outcome in ('won','lost')
),
per_dispute as (
  select dispute_id, count(*) as submitted_pkgs from sub group by 1
)
select
  count(*)                                                                as submitted_pkgs,
  count(distinct s.dispute_id)                                            as disputes,
  count(*) filter (where s.resp_evidence_gid = s.dispute_evidence_gid)     as gid_ties_to_dispute,
  count(*) filter (where s.dispute_evidence_gid is null)                   as dispute_gid_null,
  count(*) filter (where s.resp_evidence_gid is null)                      as resp_gid_null,
  count(*) filter (where s.snap_has_sent_on)                               as snap_has_evidence_sent_on,
  count(*) filter (where s.snap_sent_on is not null)                       as snap_sent_on_nonnull,
  count(*) filter (where pd.submitted_pkgs > 1)                            as pkgs_in_ambiguous_disputes,
  count(distinct s.dispute_id) filter (where pd.submitted_pkgs > 1)        as ambiguous_disputes
from sub s join per_dispute pd on pd.dispute_id = s.dispute_id;
