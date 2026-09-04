-- Candidates for the duplicate-row repair (PR #670 fixes the BUILDER; stored
-- plan_json keeps its duplicate record ids until the pack is rebuilt).
--
-- Scope deliberately narrow — only packs where a rebuild can still change
-- what an issuer sees:
--   * dispute still merchant-actionable (needs_response / under_review)
--   * nothing filed to Shopify yet
--   * the stored plan actually HAS a duplicated fieldKey
--
-- Already-submitted packages are excluded: the evidence is with the issuer and
-- rebuilding cannot recall it.
with inc as (
  select p.id, (i->>'fieldKey') as field_key
  from defence_packages p, lateral jsonb_array_elements(p.plan_json->'included') i
  where p.plan_json is not null
),
dup_pkgs as (
  select distinct id from (
    select *, count(*) over (partition by id, field_key) n from inc
  ) t where n > 1
)
select p.id as package_id, p.source_pack_id, p.shop_id, p.dispute_id,
       p.status as package_status, d.status as dispute_status, d.due_at,
       s.shop_domain
from defence_packages p
join dup_pkgs x on x.id = p.id
join disputes d on d.id = p.dispute_id
join shops s on s.id = p.shop_id
where d.evidence_saved_to_shopify_at is null
  and d.status in ('needs_response', 'under_review')
  and p.status in ('draft', 'stale')
order by d.due_at nulls last;
