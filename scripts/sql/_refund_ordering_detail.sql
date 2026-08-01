with latest_pack as (
  select distinct on (ep.dispute_id) ep.dispute_id, ep.pack_json
  from evidence_packs ep
  order by ep.dispute_id, ep.created_at desc
)
select d.id, s.shop_domain, d.reason, d.phase, d.normalized_status,
       d.initiated_at, d.created_at as ingested_at,
       (select sec->'data'->>'refundedAt'
          from jsonb_array_elements(lp.pack_json::jsonb->'sections') sec
         where sec->'labelToken'->>'key' = 'packs.section.refundHistory'
           and sec->'data'->>'refundStatus' = 'processed' limit 1) as refunded_at,
       lp.pack_json::jsonb->'fatal_loss'->>'reason' as fatal_reason
from latest_pack lp
join disputes d on d.id = lp.dispute_id
join shops s on s.id = d.shop_id
where (select sec->'data'->>'refundStatus'
         from jsonb_array_elements(lp.pack_json::jsonb->'sections') sec
        where sec->'labelToken'->>'key' = 'packs.section.refundHistory' limit 1) = 'processed'
order by d.initiated_at;
