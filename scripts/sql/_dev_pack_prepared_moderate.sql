-- Read-only: find a DEV dispute in the exact state the changed UI describes —
-- a built pack, moderate strength, nothing saved to Shopify yet. That is the
-- combination that used to render the amber "Auto-submit paused" banner and
-- now must render "Review before challenging" with the two actions inside the
-- hero card.
select sh.shop_domain,
       d.id::text                                    as dispute_id,
       d.reason,
       d.normalized_status,
       p.pack_json->'case_strength'->>'overall'      as strength,
       p.status                                      as pack_status,
       (d.evidence_saved_to_shopify_at is null)::text as not_saved,
       d.due_at::date::text                          as due
  from public.disputes d
  join public.shops sh on sh.id = d.shop_id
  join lateral (
        select ep.*
          from public.evidence_packs ep
         where ep.dispute_id = d.id
         order by ep.created_at desc
         limit 1
       ) p on true
 where d.evidence_saved_to_shopify_at is null
   and p.pack_json->'case_strength'->>'overall' = 'moderate'
 order by d.due_at nulls last
 limit 8;
