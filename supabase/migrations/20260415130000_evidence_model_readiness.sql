-- Evidence model v2: submission readiness + waive flow.
-- Additive only — no destructive changes.

-- 1. Add submission_readiness column with default for backward compat.
alter table evidence_packs
  add column if not exists submission_readiness text
    not null default 'ready'
    check (submission_readiness in ('ready', 'ready_with_warnings', 'blocked', 'submitted'));

-- 2. Add waived_items jsonb column (array of WaivedItemRecord).
alter table evidence_packs
  add column if not exists waived_items jsonb default '[]'::jsonb;

-- 3. Add checklist_v2 column for the richer checklist format.
--    The old checklist column is preserved for backward compat and
--    dual-written during the transition period.
alter table evidence_packs
  add column if not exists checklist_v2 jsonb;

-- 4. Backfill existing packs: derive readiness from current state.
update evidence_packs
set submission_readiness = case
  when status = 'saved_to_shopify' then 'submitted'
  when blockers is not null and jsonb_array_length(blockers) > 0 then 'ready_with_warnings'
  else 'ready'
end
where submission_readiness = 'ready'
  and status != 'draft';

-- 5. Index for readiness-based queries.
create index if not exists idx_packs_readiness
  on evidence_packs(submission_readiness)
  where submission_readiness not in ('submitted', 'ready');
