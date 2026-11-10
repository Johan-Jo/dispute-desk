-- Track S backfill: packs stamped 'saved_to_shopify' that were never saved.
--
-- ONE statement, so it is one transaction: the rollback ledger rows and the
-- status change commit together or not at all. Candidate set is exactly
-- scripts/sql/save-state-truth-candidates.sql (print that first, compare the
-- count, then run this). Reverse: scripts/sql/save-state-truth-rollback.sql.
--
-- Requires migration 20261110120000_save_state_backfill_rollback.sql.
--
--   npm run db:query:dev -- --file scripts/sql/save-state-truth-backfill.sql
with candidates as (
  select p.id as pack_id, p.status as previous_status
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
), ledger as (
  insert into save_state_backfill_rollback (pack_id, previous_status)
  select pack_id, previous_status from candidates
  returning pack_id
)
update evidence_packs p
   set status = 'save_failed',
       updated_at = now()
  from ledger l
 where p.id = l.pack_id
   and p.status = 'saved_to_shopify'
returning p.id as pack_id, p.dispute_id, 'save_failed' as new_status;
