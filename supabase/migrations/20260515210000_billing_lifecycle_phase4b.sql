-- Billing lifecycle Phase 4b (banners) — per-cycle banner dismissals.
--
-- Two banners are dismissible-per-cycle (grace, low_credits); the
-- third (subscription_expired) is sticky and has no dismissal.
-- Storing the dismissed cycle_end as text lets us cheaply check
-- "did the merchant already dismiss FOR THIS CYCLE?" without joining
-- ledger rows.
--
-- A new cycle automatically un-dismisses both: when
-- plan_entitlements.billing_cycle_ends_at moves past the stored
-- dismissed_cycle value, the banner reappears.

alter table plan_entitlements
  add column if not exists low_credits_banner_dismissed_cycle text,
  add column if not exists grace_banner_dismissed_cycle text;

comment on column plan_entitlements.low_credits_banner_dismissed_cycle is
  'billing_cycle_ends_at value (ISO timestamp text) the merchant most
   recently dismissed the "almost out of packs" banner for. Banner is
   shown again when the cycle rolls over. NULL = never dismissed.';

comment on column plan_entitlements.grace_banner_dismissed_cycle is
  'Same shape as low_credits — banner dismissals are scoped to the
   current billing cycle. A new grace event in a future cycle will
   show the banner again.';
