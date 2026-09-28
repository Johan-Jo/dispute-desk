-- Not-as-described plan, PR 0 (read-only). Aggregate of product-disputes-open.sql:
-- open vs decided, package mode, strength, outcome, listing coverage, templates.
with pack as (
  select distinct on (ep.dispute_id) ep.dispute_id, ep.completeness_score, ep.pack_template_id,
         ep.pack_json::jsonb->'case_strength'->>'overall' as strength,
         exists (select 1 from jsonb_array_elements(coalesce(ep.checklist_v2::jsonb, '[]'::jsonb)) c
                  where c->>'field' = 'product_description' and c->>'status' = 'available') as has_listing
  from evidence_packs ep
  order by ep.dispute_id, ep.created_at desc
), pkg as (
  select distinct on (dp.dispute_id) dp.dispute_id, dp.package_mode, dp.status
  from defence_packages dp
  order by dp.dispute_id, dp.version desc
)
select case when d.final_outcome is null and d.closed_at is null then 'open' else 'decided' end as state,
       d.phase, coalesce(pkg.package_mode, '(none)') as mode, coalesce(pack.strength, '(none)') as strength,
       coalesce(d.final_outcome, '-') as outcome,
       count(*) as n,
       count(*) filter (where pack.has_listing) as with_listing,
       count(*) filter (where pack.pack_template_id is not null) as templated,
       round(avg(pack.completeness_score)) as avg_score
from disputes d
left join pack on pack.dispute_id = d.id
left join pkg on pkg.dispute_id = d.id
where d.reason = 'PRODUCT_UNACCEPTABLE'
group by 1, 2, 3, 4, 5
order by 1 desc, n desc;
