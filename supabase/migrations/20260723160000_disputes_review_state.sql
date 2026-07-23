-- Merchant review lifecycle on disputes.
--
-- Before this, a parked-for-review or weak dispute had no terminal
-- merchant-driven state: nothing let the merchant say "I looked at this
-- and decided what to do", so such cases sat in the actionable queue and
-- on the dashboard indefinitely. (2026-07-23 product decision.)
--
-- review_state — merchant's explicit decision on a parked/weak dispute.
--   NULL          — no decision yet (default; the dispute rides the
--                   shop's automation rule at the deadline as before).
--   'in_review'   — "hold & watch": the merchant is actively working it.
--                   Paired with review_due_at. If still 'in_review' close
--                   to the deadline the reminder cron flips it back to
--                   needs_attention so it can't rot silently.
--   'approved'    — "reviewed, submit on the deadline". Clears
--                   needs_attention; the existing 08:00-UTC deadline cron
--                   auto-submits it (per the shop's rule) as normal.
--   'conceded'    — "do not defend". The deadline cron SKIPS it (never
--                   auto-submits); it leaves every actionable view and
--                   reads "Not defended" in history. Billing is
--                   unaffected — the pack credit was already consumed at
--                   build time; conceding does NOT refund it.
--
-- review_due_at — snapshot of the dispute's evidence deadline (due_at)
--   taken when the merchant chose 'in_review', so the reminder cron and
--   the countdown chip have a stable target even if due_at is re-synced.
--
-- Enum values are validated in TypeScript
-- (lib/disputes/reviewState.ts) — no DB CHECK constraint, matching the
-- attention_reason convention (20260515150000).

alter table disputes
  add column if not exists review_state text,
  add column if not exists review_due_at timestamptz;

comment on column disputes.review_state is
  'Merchant review decision on a parked/weak dispute: NULL | in_review |
   approved | conceded. Canonical values in lib/disputes/reviewState.ts.
   conceded => deadline cron never auto-submits. Billing is not affected
   (credit consumed at pack build).';

comment on column disputes.review_due_at is
  'Snapshot of due_at taken when review_state was set to in_review, so
   the reminder cron + countdown chip have a stable deadline target.';

-- Partial index for the reminder cron: scans only disputes actively
-- held for review, ordered by their review deadline. Tiny (most
-- disputes are NULL here), so the near-deadline sweep stays cheap.
create index if not exists idx_disputes_in_review_due
  on disputes (review_due_at)
  where review_state = 'in_review';
