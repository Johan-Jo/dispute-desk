-- Track S (docs/plans/dispute-page-single-source.plan.md §6): save-state truth.
--
-- The auto-save enqueue used to stamp evidence_packs.status = 'saved_to_shopify'
-- before Shopify accepted anything. A pack stamped that way with
-- disputes.submission_state = 'not_saved' and no active save job was never
-- saved. scripts/sql/save-state-truth-backfill.sql re-labels those packs
-- 'save_failed' (the truth), recording {pack_id, previous_status} here first so
-- scripts/sql/save-state-truth-rollback.sql can put every row back.
--
-- Valid only until the next save job for that pack runs: after that the job's
-- own write is the truth, and the rollback leaves such a pack alone
-- (it restores only rows still at 'save_failed').

create table if not exists save_state_backfill_rollback (
  id              uuid primary key default gen_random_uuid(),
  pack_id         uuid not null,
  previous_status text not null,
  backfilled_at   timestamptz not null default now(),
  restored_at     timestamptz
);

create index if not exists save_state_backfill_rollback_pack_idx
  on save_state_backfill_rollback (pack_id);

alter table save_state_backfill_rollback enable row level security;

comment on table save_state_backfill_rollback is
  'Rollback ledger for the Track S save-state backfill: the status each evidence pack had before it was re-labelled save_failed. Server-only (RLS on, no policies).';
