-- Reverse of scripts/sql/save-state-truth-backfill.sql.
--
-- VALID ONLY IMMEDIATELY AFTER THE BACKFILL. Once any of the relabelled packs
-- has been saved again, retried, rebuilt or re-approved, its status reflects a
-- newer fact and restoring the old stamp would put the lie back. The guard
-- below only protects packs still at 'save_failed'; it cannot tell a pack the
-- backfill left alone from one a human has since acted on. Run it within the
-- same working session as the backfill or not at all.
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
