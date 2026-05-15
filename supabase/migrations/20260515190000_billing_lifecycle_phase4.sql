-- Billing lifecycle Phase 4 (comms) — idempotency stamps for the
-- lifecycle emails not already covered by Phase 2's column set.
--
-- The pattern across every billing-lifecycle email is the same:
-- a single column on plan_entitlements records when the email was
-- claimed for sending. Each email function runs a conditional
-- UPDATE that flips the column from NULL to now() and only proceeds
-- when the UPDATE returned a row. Two concurrent senders → one wins
-- the UPDATE, the other reads back a non-NULL value and bails.
--
-- Phase 2 already added:
--   last_renewal_email_sent_cycle_end  (cycle-keyed digest)
--   trial_ending_notice_sent_at        (3-day pre-trial-end notice)
--   grace_entered_at                   (payment failed, in retry window)
--   subscription_expired_at            (payment failed past retry)
--   cancelled_at                       (merchant cancelled)
--
-- Phase 4 adds the two remaining stamps for events that aren't a
-- "transition into a problem state": initial trial activation and
-- the first paid cycle after trial conversion.

alter table plan_entitlements
  add column if not exists trial_started_at timestamptz,
  add column if not exists first_paid_cycle_started_at timestamptz;

comment on column plan_entitlements.trial_started_at is
  'Set once when the merchant first activates a paid plan with a trial.
   Idempotency key for the "Trial started" welcome email. Never reset
   even after cancel/reactivate — re-trialing is not a feature.';

comment on column plan_entitlements.first_paid_cycle_started_at is
  'Set once when the reconciler observes the first non-trial paid
   cycle for the shop (transition trialing → active with cycle credits
   granted). Idempotency key for the "First paid cycle" welcome email.';
