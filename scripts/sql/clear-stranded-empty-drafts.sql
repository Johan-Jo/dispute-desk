-- Clear the empty drafts stranded by the guard-recheck defect (2026-08-12).
--
-- On the first self-heal run the enqueue site correctly allowed a retry and
-- inserted a draft, then the worker's re-check — which had not been given the
-- current versions — refused the job with `generation_blocked`. The result is
-- a draft carrying no narrative, no validation and no PDF, sitting above the
-- real failed row.
--
-- Marked `stale`, not deleted: `stale` is the existing meaning for "superseded,
-- rebuild me", drafts are mutable (the immutability trigger covers
-- final/submitted/superseded), and the row stays in the audit trail. The next
-- rebuild then inserts version+1 over a stale row, which is the ordinary path.
--
-- Scoped by id, and re-asserts the empty shape in the WHERE clause so this
-- cannot touch a draft that has since been filled.
update defence_packages
set status = 'stale',
    failure_reason = 'superseded: empty draft from the 2026-08-12 guard-recheck defect (see #543)',
    updated_at = now()
where id in (
    'aa76162a-fecb-4544-a5f3-bb5a15f0d3cd',  -- #352511 v6
    'd68af581-4b80-493c-a6d4-a4eb696867a5',  -- #352513 v5
    'fc2c6c3f-0cd0-4641-aed1-c5ebe711f14c'   -- #352555 v5
  )
  and status = 'draft'
  and validation_status is null
  and pdf_path is null
  and narrative_json is null
returning id, version, status, failure_reason;
