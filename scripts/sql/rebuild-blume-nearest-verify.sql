-- Did the four nearest-deadline rebuilds restore case strength?
select
  d.order_name,
  d.due_at::date                                   as due,
  p.status                                         as pack_status,
  (p.pack_json ? 'case_assessment_gates')          as strength_fingerprint,
  p.pack_json->'case_strength'->>'overall'         as strength,
  p.completeness_score                             as completeness,
  dp.version                                       as pkg_v,
  dp.status                                        as pkg_status,
  coalesce(dp.validation_status, '-')              as pkg_validation,
  (dp.pdf_path is not null)                        as pkg_pdf,
  d.evidence_saved_to_shopify_at                   as filed_at
from disputes d
join shops s on s.id = d.shop_id
left join lateral (
  select * from evidence_packs ep where ep.dispute_id = d.id
  order by ep.created_at desc limit 1
) p on true
left join lateral (
  select * from defence_packages x where x.dispute_id = d.id
  order by x.version desc limit 1
) dp on true
where s.shop_domain = 'blume-box.myshopify.com'
  and d.order_name in ('#352537', '#352538', '#346159', '#350318')
order by d.due_at asc;
