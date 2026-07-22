-- Urgency-sort rank for the dispute list ("Most urgent" = due_at asc).
--
-- Submitted / under-review disputes are OPEN (closed_at IS NULL) but out of
-- the merchant's hands — the bank owns the timeline. They keep their
-- historical due_at, so after the open-first fix (#381) they floated to the
-- very top of the urgency view above cases the merchant can still act on
-- (blume-box, 2026-07-22). PostgREST can't ORDER BY an expression, so the
-- rank is materialized here and /api/disputes orders by it as the second
-- key of the due_at-asc sort.
--
-- The status list MUST match UNDER_REVIEW_NORMALIZED_STATUSES in
-- app/(embedded)/app/disputes/disputeListHelpers.ts — a vitest invariant
-- (tests/api/disputes/listSortOrdering.test.ts) greps this file to keep
-- them in sync.
--
-- 0 = merchant can still act (or dispute not yet submitted)
-- 1 = evidence committed, awaiting issuer/bank verdict
alter table public.disputes
  add column if not exists urgency_rank smallint
  generated always as (
    case
      when normalized_status in (
        'submitted',
        'submitted_to_shopify',
        'submitted_to_bank',
        'waiting_on_issuer'
      ) then 1
      else 0
    end
  ) stored;
