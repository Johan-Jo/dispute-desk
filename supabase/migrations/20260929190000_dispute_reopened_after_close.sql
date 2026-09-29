-- A dispute Shopify reopens after it was decided (won/lost/accepted/refunded
-- → needs_response or under_review). Until now the sync kept the old outcome
-- and dropped the new status ("terminal-state downgrade rejected"), so the
-- reopened dispute stayed "won" in DisputeDesk (Mein Maison #94534, #94448,
-- #99123, #92590; 2026-09-29).
alter table public.disputes
  add column if not exists reopened_after_close_at timestamptz,
  add column if not exists previous_final_outcome text;

comment on column public.disputes.reopened_after_close_at is
  'When Shopify reopened this dispute after an outcome; the outcome was cleared and kept in previous_final_outcome.';
comment on column public.disputes.previous_final_outcome is
  'The final_outcome the dispute had before Shopify reopened it.';
