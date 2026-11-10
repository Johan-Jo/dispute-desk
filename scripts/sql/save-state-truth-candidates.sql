-- Track S backfill candidate set (READ-ONLY).
--
-- Open disputes whose latest-or-any evidence pack is stamped exactly
-- 'saved_to_shopify' although disputes.submission_state says nothing was saved
-- and no save_to_shopify job is active. These are the packs the old enqueue-time
-- stamp lied about. Print this on the target DB BEFORE running the backfill.
--
--   npm run db:query:prod -- --file scripts/sql/save-state-truth-candidates.sql --output table
select
  d.id            as dispute_id,
  d.order_name,
  d.shop_id,
  d.due_at,
  d.submission_state,
  p.id            as pack_id,
  p.status        as pack_status,
  p.saved_to_shopify_at
from evidence_packs p
join disputes d on d.id = p.dispute_id
where d.closed_at is null
  and d.final_outcome is null
  and d.submission_state = 'not_saved'
  and p.status = 'saved_to_shopify'
  and not exists (
    select 1
    from jobs j
    where j.job_type = 'save_to_shopify'
      and j.entity_id = p.id::text
      and j.status in ('queued', 'running', 'pending')
  )
order by d.due_at nulls last;
