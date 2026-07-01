-- Backfill the Free-tier lifetime pack floor for existing shops.
--
-- The `free_lifetime` credit grant on install shipped alongside this
-- migration, but existing shops installed before that never received a
-- `free_lifetime` ledger row and are stuck at a 0-pack balance (blocked
-- on their first pack build). This grants the same N-pack floor once per
-- shop that is missing the row.
--
-- N = 5 — must stay in sync with FREE_LIFETIME_PACKS in lib/billing/plans.ts.
--
-- Idempotent: the `not exists` guard means re-running never double-grants.
-- Retires the manual scripts/sql/unblock-*.sql pattern for free shops.

insert into pack_credits_ledger (shop_id, source, packs, expires_at, reference)
select s.id, 'free_lifetime', 5, null, 'free-lifetime:' || s.id
from shops s
where not exists (
  select 1
  from pack_credits_ledger c
  where c.shop_id = s.id
    and c.source = 'free_lifetime'
);
