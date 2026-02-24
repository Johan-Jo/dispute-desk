-- 005: rules + policy_snapshots

create table rules (
  id          uuid primary key default gen_random_uuid(),
  shop_id     uuid not null references shops(id) on delete cascade,
  enabled     boolean not null default true,
  match       jsonb not null default '{}',
  action      jsonb not null default '{"mode":"review"}',
  priority    int not null default 0,
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now()
);

create index idx_rules_shop on rules(shop_id, enabled, priority);

create table policy_snapshots (
  id              uuid primary key default gen_random_uuid(),
  shop_id         uuid not null references shops(id) on delete cascade,
  policy_type     text not null check (policy_type in ('refunds','shipping','terms')),
  url             text,
  content_hash    text,
  extracted_text  text,
  captured_at     timestamptz not null default now()
);

create index idx_policies_shop on policy_snapshots(shop_id, policy_type);

alter table rules enable row level security;
alter table policy_snapshots enable row level security;
