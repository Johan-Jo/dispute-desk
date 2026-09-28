-- Not-as-described plan, PR 0 (read-only). Every PRODUCT_UNACCEPTABLE dispute
-- with its newest evidence pack and newest defence package: the live exposure
-- PR 1 (letter fix) changes. Open = no final outcome and not closed.
-- Run: npm run db:query:prod -- --file scripts/sql/product-disputes-open.sql --output table
with pack as (
  select distinct on (ep.dispute_id) ep.dispute_id, ep.id as pack_id, ep.status as pack_status,
         ep.completeness_score, ep.pack_template_id,
         ep.pack_json::jsonb->'case_strength'->>'overall' as strength,
         (select count(*) from jsonb_array_elements(coalesce(ep.checklist_v2::jsonb, '[]'::jsonb)) c
           where c->>'field' = 'product_description' and c->>'status' = 'available') as listing_rows
  from evidence_packs ep
  order by ep.dispute_id, ep.created_at desc
), pkg as (
  select distinct on (dp.dispute_id) dp.dispute_id, dp.version, dp.status as pkg_status,
         dp.package_mode, dp.reason_code_module, dp.prompt_family
  from defence_packages dp
  order by dp.dispute_id, dp.version desc
)
select s.shop_domain, d.id as dispute_id, d.order_name, d.status, d.phase, d.review_state,
       d.due_at::date as due, d.final_outcome, d.network_reason_code as net_code,
       d.amount, d.currency_code,
       pack.pack_status, pack.completeness_score as score, pack.strength, pack.listing_rows,
       pack.pack_template_id is not null as templated,
       pkg.version as pkg_v, pkg.pkg_status, pkg.package_mode, pkg.reason_code_module
from disputes d
join shops s on s.id = d.shop_id
left join pack on pack.dispute_id = d.id
left join pkg on pkg.dispute_id = d.id
where d.reason = 'PRODUCT_UNACCEPTABLE'
order by (d.final_outcome is null and d.closed_at is null) desc, d.due_at desc nulls last;
