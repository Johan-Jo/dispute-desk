select
  count(*) filter (where d.final_outcome is null)                                            as open_disputes,
  count(*) filter (where d.final_outcome is null and ep.pack_json ? 'case_assessment')       as with_case_assessment,
  count(*) filter (where d.final_outcome is null and ep.pack_json ? 'case_assessment_gates') as with_gates,
  count(*) filter (where d.final_outcome is null and ep.status = 'failed')                   as pack_failed,
  count(*) filter (where d.final_outcome is null and ep.rebuild_pending is true)             as rebuild_pending
from disputes d
left join lateral (
  select * from evidence_packs p where p.dispute_id = d.id order by p.created_at desc limit 1
) ep on true;
