-- F-1b / B1 measurement export (READ-ONLY). Latest pack per dispute with the
-- dispute, shop domain and the shop's settings row, as one JSON object per row.
-- Feed to a replay script that calls the real assembler / decideForPack.
-- Run: npm run db:query:prod -- --read-only --output json --file scripts/sql/f1b_latest_packs_export.sql > out.json
with lp as (
  select distinct on (p.dispute_id)
    p.id pack_id, p.dispute_id, p.status pack_status, p.created_at pack_created_at,
    p.response_cycle, p.completeness_score, p.blockers, p.submission_readiness,
    p.checklist_v2, p.pack_json, p.rebuild_pending, p.waived_items
  from evidence_packs p
  order by p.dispute_id, p.created_at desc
)
select jsonb_build_object(
  'pack_id', lp.pack_id,
  'dispute_id', lp.dispute_id,
  'pack_status', lp.pack_status,
  'pack_created_at', lp.pack_created_at,
  'response_cycle', lp.response_cycle,
  'completeness_score', lp.completeness_score,
  'blockers', lp.blockers,
  'submission_readiness', lp.submission_readiness,
  'checklist_v2', lp.checklist_v2,
  'pack_json', lp.pack_json,
  'rebuild_pending', lp.rebuild_pending,
  'shop_id', d.shop_id,
  'shop_domain', s.shop_domain,
  'reason', d.reason,
  'status', d.status,
  'normalized_status', d.normalized_status,
  'phase', d.phase,
  'amount', d.amount,
  'due_at', d.due_at,
  'review_state', d.review_state,
  'order_gid', d.order_gid,
  'settings', to_jsonb(ss)
) as r
from lp
join disputes d on d.id = lp.dispute_id
join shops s on s.id = d.shop_id
left join shop_settings ss on ss.shop_id = d.shop_id;
