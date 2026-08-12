-- blume-box open disputes by deadline: what needs rebuilding FIRST, and why.
select
  d.order_name,
  left(d.id::text, 8)                                    as dispute,
  d.due_at,
  (d.due_at::date - now()::date)                         as days_left,
  p.status                                               as pack_status,
  (p.pack_json ? 'case_assessment_gates')                as has_strength_fingerprint,
  dp.version                                             as pkg_version,
  dp.status                                              as pkg_status,
  coalesce(dp.validation_status, '-')                    as pkg_validation
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
  and d.evidence_saved_to_shopify_at is null
  and d.due_at > now()
order by d.due_at asc
limit 12;
