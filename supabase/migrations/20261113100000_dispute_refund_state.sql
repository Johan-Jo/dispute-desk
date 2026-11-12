-- Refund-state snapshot per dispute (docs/plans/pending-refund-advice.plan.md, PR A).
--
-- What Shopify says about the order's refund RIGHT NOW, read from Refund.transactions by the
-- refund-state cron and interpreted by lib/disputes/refundState.ts. The evidence pack cannot hold this:
-- a pending refund reads 0.0 everywhere the pack looks, and the pack is a stale snapshot.
--
-- Holds amounts, statuses and timestamps only: no customer data, no free text. shop_id cascades
-- through admin_purge_shop (shop/redact); dispute_id cascades when the dispute row is removed.
create table if not exists dispute_refund_state (
  dispute_id uuid primary key references disputes(id) on delete cascade,
  shop_id uuid not null references shops(id) on delete cascade,
  order_gid text not null,
  state text not null
    check (state in ('none', 'pending', 'settled', 'failed', 'mixed', 'unknown')),
  unknown_reason text,
  pending_amount numeric not null default 0,
  settled_amount numeric not null default 0,
  failed_amount numeric not null default 0,
  currency text,
  first_refund_at timestamptz,
  settled_at timestamptz,
  stalled_pending boolean not null default false,
  return_status text,
  payment_gateways text[] not null default '{}',
  checked_at timestamptz not null default now(),
  -- Moves only when `state` changes, so "since when" survives re-checks.
  last_changed_at timestamptz not null default now(),
  -- The state read when the dispute closed (stats: lib/disputes/refundOutcomeStats.ts, PR D).
  state_at_close text
    check (state_at_close is null or state_at_close in ('none', 'pending', 'settled', 'failed', 'mixed', 'unknown')),
  state_at_close_checked_at timestamptz
);

create index if not exists dispute_refund_state_shop_idx on dispute_refund_state (shop_id);
create index if not exists dispute_refund_state_checked_idx on dispute_refund_state (checked_at);

alter table dispute_refund_state enable row level security;
drop policy if exists service_role_full_access_dispute_refund_state on dispute_refund_state;
create policy service_role_full_access_dispute_refund_state
  on dispute_refund_state for all to service_role using (true) with check (true);
