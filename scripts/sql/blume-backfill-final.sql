-- Final backfill status: how many needs_response disputes still lack a pack?
select
  count(*) as needs_response_total,
  count(*) filter (where ep.id is not null) as with_pack,
  count(*) filter (where ep.id is null)     as still_missing
from disputes d
join shops s on s.id = d.shop_id
left join lateral (select id from evidence_packs where dispute_id = d.id limit 1) ep on true
where s.shop_domain='blume-box.myshopify.com'
  and lower(d.status)='needs_response';
