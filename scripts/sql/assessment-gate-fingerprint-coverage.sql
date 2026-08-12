-- Do live packs carry the case_assessment_gates / case_assessment fingerprint
-- the workspace needs to render a verdict? Absent => "Not assessed yet".
select
  (p.pack_json ? 'case_assessment_gates') as has_gates,
  (p.pack_json ? 'case_assessment')       as has_assessment,
  count(*)                                as packs,
  min(p.updated_at)                       as oldest,
  max(p.updated_at)                       as newest
from evidence_packs p
join disputes d on d.id = p.dispute_id
where d.evidence_saved_to_shopify_at is null
  and p.status = 'ready'
group by 1, 2
order by packs desc;
