-- PR D of docs/plans/pending-refund-advice.plan.md: per-store results the refund email can quote.
--
-- A refund's settlement time (Refund.updatedAt of a SUCCESS refund) is readable at ANY later moment, so
-- "was this inquiry refunded before it ended" can be derived from one live read of a closed or escalated
-- dispute; no capture-at-close hook is needed. That replaces the two `state_at_close*` columns of the first
-- migration (never written), which are dropped here.
alter table dispute_refund_state
  add column if not exists settlements jsonb not null default '[]'::jsonb,
  add column if not exists final_read_at timestamptz;

alter table dispute_refund_state
  drop column if exists state_at_close,
  drop column if exists state_at_close_checked_at;

comment on column dispute_refund_state.settlements is
  'One {settledAt, amount} per SUCCESS refund transaction (settledAt = Refund.updatedAt). Amounts and times only.';
comment on column dispute_refund_state.final_read_at is
  'Set when a CLOSED or ESCALATED dispute has been read once for lib/disputes/refundOutcomeStats.ts.';
