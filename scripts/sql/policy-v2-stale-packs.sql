-- Packs whose persisted assessment predates SCORING_POLICY_VERSION 2.
-- These render "Not assessed yet" until rebuilt; the bump makes the REASON
-- truthful (policy_version_superseded) but does not re-derive the snapshot.
select
  d.status,
  (p.pack_json->'case_assessment'->'freshness'->>'policyVersion') as snap_policy,
  count(*) as packs
from evidence_packs p
join disputes d on d.id = p.dispute_id
where d.evidence_saved_to_shopify_at is null
  and p.status = 'ready'
  and (p.pack_json ? 'case_assessment')
group by 1, 2
order by packs desc;
