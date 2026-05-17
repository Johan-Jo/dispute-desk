-- Resubmission Window: last-rebuild outcome columns on evidence_packs.
--
-- Tracks the result of the most recent merchant-initiated regenerate so
-- the workspace can explain what happened after the merchant uploaded
-- new evidence + clicked Regenerate. Without this, the merchant has no
-- signal when a regenerate completes but the §9 strength gate (or
-- fatal-loss / coverage gates) holds — the prior Shopify save stays
-- canonical and the rebuild silently parks.
--
-- IMPORTANT — non-authoritative invariant.
-- These columns are USER-FACING EXPLANATION ONLY. The canonical
-- submission state of a dispute remains `disputes.submission_state`
-- plus `evidence_packs.status` and the Shopify-side
-- `disputeEvidence.evidenceSentOn` readback. Nothing in the pipeline,
-- automation, or save path may make a decision based on
-- `last_rebuild_outcome`. Treat it like an audit annotation that the
-- UI happens to surface.

alter table evidence_packs
  add column if not exists last_rebuild_outcome text,
  add column if not exists last_rebuild_at      timestamptz,
  add column if not exists last_rebuild_reason  text;

-- Enum-ish constraint to keep the surface small. New outcomes must be
-- added to this list (and to the workspace API / EvidenceTab switch)
-- in the same change.
alter table evidence_packs
  drop constraint if exists evidence_packs_last_rebuild_outcome_check;
alter table evidence_packs
  add constraint evidence_packs_last_rebuild_outcome_check
  check (
    last_rebuild_outcome is null
    or last_rebuild_outcome in (
      'saved',
      'blocked_weak',
      'blocked_fatal_loss',
      'blocked_covered',
      'blocked_no_material_change',
      'failed'
    )
  );

comment on column evidence_packs.last_rebuild_outcome is
  'User-facing explanation of the most recent regenerate attempt. NOT authoritative submission state — that lives on disputes.submission_state + evidence_packs.status. Values: saved | blocked_weak | blocked_fatal_loss | blocked_covered | blocked_no_material_change | failed.';

comment on column evidence_packs.last_rebuild_at is
  'Timestamp the rebuild outcome was stamped. Used so the UI can show a fresh outcome banner only for the merchant''s most recent regenerate and decay older state.';

comment on column evidence_packs.last_rebuild_reason is
  'Short merchant-safe reason code (e.g. case_strength_weak, refund_issued, coverage_active). Pairs with last_rebuild_outcome for tooltip / debug surfacing.';
