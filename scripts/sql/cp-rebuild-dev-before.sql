-- §9.3 pre-activation rebuild — BEFORE census (dev).
-- Population per §9.4: disputes.final_outcome IS NULL. Never evidence_packs.status.
select
  s.shop_domain,
  count(*) filter (where d.final_outcome is null)                              as open_disputes,
  count(*) filter (where d.final_outcome is null and ep.id is not null)        as open_with_pack,
  count(*) filter (where d.final_outcome is null and ep.saved_to_shopify_at is null) as open_unsubmitted,
  count(*) filter (where d.final_outcome is null and ep.pack_json ? 'case_assessment')       as with_case_assessment,
  count(*) filter (where d.final_outcome is null and ep.pack_json ? 'case_assessment_gates') as with_gates,
  count(*) filter (where d.final_outcome is null and ep.rebuild_pending is true)             as rebuild_pending
from disputes d
join shops s on s.id = d.shop_id
left join lateral (
  select * from evidence_packs p where p.dispute_id = d.id order by p.created_at desc limit 1
) ep on true
group by s.shop_domain
order by s.shop_domain;
