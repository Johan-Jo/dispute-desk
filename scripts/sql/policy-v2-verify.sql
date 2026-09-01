-- Post-deploy + post-rebuild verification. Expect: zero open packs left at
-- policy version 1, and the originally-reported dispute at version 2.
select
  (p.pack_json->'case_assessment'->'freshness'->>'policyVersion') as snap_policy,
  count(*) as open_packs
from evidence_packs p
join disputes d on d.id = p.dispute_id
where d.evidence_saved_to_shopify_at is null
  and p.status = 'ready'
  and d.status in ('needs_response','new','in_progress','under_review')
  and (p.pack_json ? 'case_assessment')
group by 1 order by 1;
