-- Blume Box repair set: DISTINCT source packs to rebuild (one build_pack job
-- each). Open, unfiled, and actually carrying a duplicated fieldKey.
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
select distinct p.source_pack_id, p.shop_id, p.dispute_id, d.order_name, d.due_at
from defence_packages p
join dup_pkgs x on x.id = p.id
join disputes d on d.id = p.dispute_id
join shops s on s.id = p.shop_id
where s.shop_domain = 'blume-box.myshopify.com'
  and d.evidence_saved_to_shopify_at is null
  and d.status in ('needs_response','under_review')
  -- `normalized_status` is the real filing gate. `under_review` +
  -- submitted_to_bank means the evidence is ALREADY with the issuer: the
  -- window is closed and a rebuild spends an LLM call on something nobody
  -- can resubmit. `evidence_saved_to_shopify_at` alone does NOT catch this
  -- (it was null on blume-box #353605, which was submitted_to_bank) — that
  -- omission nearly burned a call on a past-due, already-filed dispute.
  and coalesce(d.normalized_status, '') not in ('submitted_to_bank', 'closed', 'won', 'lost')
  and (d.due_at is null or d.due_at > now())
  and p.status in ('draft','stale')
order by d.due_at nulls last;
