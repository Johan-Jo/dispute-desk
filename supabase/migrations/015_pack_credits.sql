-- Pack credits ledger + usage metering (Feb 2026 pricing strategy)
-- Credits are granted: monthly on paid plans, lifetime on Free, and as trial allowance.
-- Top-ups add credits that expire at end of billing cycle.

-- Plan entitlements per shop
create table if not exists plan_entitlements (
  id uuid primary key default gen_random_uuid(),
  shop_id uuid not null references shops(id) on delete cascade,
  plan_key text not null check (plan_key in ('free','starter','growth','scale')),
  trial_ends_at timestamptz null,
  billing_cycle_started_at timestamptz null,
  billing_cycle_ends_at timestamptz null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique(shop_id)
);

alter table plan_entitlements enable row level security;
create policy "service_role_plan_entitlements" on plan_entitlements
  for all using (true) with check (true);

-- Pack credits ledger (append-only, like audit_events)
create table if not exists pack_credits_ledger (
  id uuid primary key default gen_random_uuid(),
  shop_id uuid not null references shops(id) on delete cascade,
  source text not null check (source in ('free_lifetime','trial','monthly_included','topup','admin_adjustment')),
  packs integer not null check (packs <> 0),
  expires_at timestamptz null,
  reference text null,
  created_at timestamptz not null default now()
);

create index if not exists idx_pack_credits_shop on pack_credits_ledger(shop_id);

alter table pack_credits_ledger enable row level security;
create policy "service_role_pack_credits" on pack_credits_ledger
  for all using (true) with check (true);

-- Pack usage events (consumption tracking, idempotent per dispute+event)
create table if not exists pack_usage_events (
  id uuid primary key default gen_random_uuid(),
  shop_id uuid not null references shops(id) on delete cascade,
  dispute_id uuid not null,
  pack_id uuid null,
  event_type text not null check (event_type in ('finalize','export','submit')),
  packs integer not null default 1 check (packs > 0),
  created_at timestamptz not null default now(),
  unique (shop_id, dispute_id, event_type)
);

create index if not exists idx_pack_usage_shop on pack_usage_events(shop_id);

alter table pack_usage_events enable row level security;
create policy "service_role_pack_usage" on pack_usage_events
  for all using (true) with check (true);

-- Helper view: remaining pack balance per shop
create or replace view pack_balance as
select
  c.shop_id,
  coalesce(
    sum(case when c.expires_at is null or c.expires_at > now() then c.packs else 0 end),
    0
  ) - coalesce(
    (select sum(u.packs) from pack_usage_events u where u.shop_id = c.shop_id),
    0
  ) as remaining_packs,
  coalesce(
    sum(case when c.expires_at is null or c.expires_at > now() then c.packs else 0 end),
    0
  ) as total_credits,
  coalesce(
    (select sum(u.packs) from pack_usage_events u where u.shop_id = c.shop_id),
    0
  ) as total_used
from pack_credits_ledger c
group by c.shop_id;

-- Update shops.plan column to accept new plan keys
alter table shops drop constraint if exists shops_plan_check;
alter table shops add constraint shops_plan_check
  check (plan in ('free','starter','growth','scale'));
