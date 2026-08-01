-- Of all disputes whose order carries a processed refund, how many had
-- the refund BEFORE the dispute (sequence A, representable) vs AFTER
-- (sequence B, which Shopify supposedly blocks)?
with latest_pack as (
  select distinct on (ep.dispute_id) ep.dispute_id, ep.pack_json
  from evidence_packs ep
  order by ep.dispute_id, ep.created_at desc
),
refunded as (
  select lp.dispute_id,
         d.initiated_at,
         (select sec->'data'->>'refundedAt'
            from jsonb_array_elements(lp.pack_json::jsonb->'sections') sec
           where sec->'labelToken'->>'key' = 'packs.section.refundHistory'
             and sec->'data'->>'refundStatus' = 'processed'
           limit 1) as refunded_at
  from latest_pack lp
  join disputes d on d.id = lp.dispute_id
)
select
  case
    when refunded_at is null                          then 'no refund timestamp'
    when refunded_at::timestamptz < initiated_at      then 'A: refund BEFORE dispute'
    else                                                   'B: refund AFTER dispute'
  end as ordering,
  count(*) as disputes
from refunded
where refunded_at is not null
group by 1
order by 2 desc;
