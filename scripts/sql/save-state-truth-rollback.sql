-- Reverse of scripts/sql/save-state-truth-backfill.sql.
--
-- Restores each backfilled pack to the status recorded in
-- save_state_backfill_rollback, but ONLY while the pack is still 'save_failed'
-- and the ledger row is unrestored: if a save job has run since, its own write
-- is the truth and this leaves the pack alone.
--
--   npm run db:query:dev -- --file scripts/sql/save-state-truth-rollback.sql
with restored as (
  update evidence_packs p
     set status = r.previous_status,
         updated_at = now()
    from save_state_backfill_rollback r
   where p.id = r.pack_id
     and r.restored_at is null
     and p.status = 'save_failed'
  returning r.id as ledger_id, p.id as pack_id
), stamped as (
  update save_state_backfill_rollback r
     set restored_at = now()
    from restored x
   where r.id = x.ledger_id
  returning r.pack_id
)
select pack_id from stamped;
