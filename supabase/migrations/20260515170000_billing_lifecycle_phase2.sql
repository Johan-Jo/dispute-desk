-- Billing lifecycle Phase 2 — subscription state machine + ledger dedupe.
--
-- Adds the columns the billing reconciliation cron and the future
-- app_subscriptions/update webhook need to mirror Shopify's
-- subscription truth in our DB. Each timestamp column is a single-
-- writer idempotency key for the matching lifecycle email; the
-- comms layer (Phase 4) reads these to decide "have we already
-- told the merchant about this transition?".
--
-- subscription_state values are kept in lock-step with TypeScript
-- (no CHECK constraint) so adding a state is one code edit, not a
-- migration. Enforcement lives in lib/billing/subscriptionState.ts
-- once that file lands; until then, the reconciler only writes the
-- five values documented in docs/prd/billing-lifecycle-and-merchant-comms.md
-- § 4.2.
--
-- The pack_credits_ledger unique index is the safety net the PRD calls
-- out: the webhook and the reconciliation cron can race on the same
-- billing cycle. Both paths construct reference =
-- `monthly_${shopId}_${cycle_end_iso}`. The unique index makes the
-- second insert a no-op (ON CONFLICT DO NOTHING in code paths that
-- want graceful behavior; raw INSERT raises 23505 which is fine too).

alter table plan_entitlements
  add column if not exists subscription_state text not null default 'active',
  add column if not exists shopify_subscription_gid text,
  add column if not exists last_renewal_email_sent_cycle_end timestamptz,
  add column if not exists trial_ending_notice_sent_at timestamptz,
  add column if not exists grace_entered_at timestamptz,
  add column if not exists subscription_expired_at timestamptz,
  add column if not exists cancelled_at timestamptz,
  add column if not exists last_reconciled_at timestamptz;

comment on column plan_entitlements.subscription_state is
  'Shop subscription lifecycle state. One of:
     trialing | active | grace | expired | cancelled
   Canonical values + transitions documented in
   docs/prd/billing-lifecycle-and-merchant-comms.md § 4.2.
   Reconciliation cron + app_subscriptions/update webhook are the
   only writers.';

comment on column plan_entitlements.shopify_subscription_gid is
  'gid://shopify/AppSubscription/... — the live subscription the
   reconciler last matched. Null until reconciliation observes one;
   may be stale when a merchant cancels and resubscribes (the new
   GID replaces the old on the next reconciliation tick).';

comment on column plan_entitlements.last_reconciled_at is
  'Most recent reconciliation cron tick that touched this row. Bumped
   on every run whether or not state changed, so a stale value points
   at a shop the cron is no longer reaching (token revoked, shop
   uninstalled, etc.).';

-- Idempotency for credit grants. The reference is the canonical
-- collision key:
--   monthly_${shopId}_${cycle_end_iso}   (reconciler + webhook)
--   topup_${sku}_${chargeId}             (topup callback)
--   trial_${planId}_${chargeId}          (subscribe callback)
-- Each path constructs its own reference; the index makes them all
-- safely re-runnable.
create unique index if not exists pack_credits_ledger_shop_reference_uniq
  on pack_credits_ledger (shop_id, reference);

-- Backfill the new state column with the best signal we have for
-- existing rows. A non-expired billing cycle = active; an expired
-- cycle = expired. The reconciler will refine on its next run.
update plan_entitlements
   set subscription_state = case
     when billing_cycle_ends_at is null then 'active'
     when billing_cycle_ends_at > now() then 'active'
     else 'expired'
   end
 where subscription_state = 'active'
   and billing_cycle_ends_at is not null;
