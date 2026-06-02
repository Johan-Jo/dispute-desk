-- 001: shops + shop_sessions (with online/offline session support + key rotation)

create extension if not exists "pgcrypto";

create table shops (
  id            uuid primary key default gen_random_uuid(),
  shop_domain   text not null unique,
  shop_id       text,
  installed_at  timestamptz not null default now(),
  uninstalled_at timestamptz,
  -- NOTE: this original plan check ('free','starter','pro') is SUPERSEDED by
  -- migration 015_pack_credits.sql, which drops shops_plan_check and re-adds it
  -- as ('free','starter','growth','scale') to match lib/billing/plans.ts. The
  -- live constraint on every environment is the 015 version — 'pro' is dead.
  plan          text not null default 'free' check (plan in ('free','starter','pro')),
  retention_days int not null default 365,
  created_at    timestamptz not null default now(),
  updated_at    timestamptz not null default now()
);

create table shop_sessions (
  id                      uuid primary key default gen_random_uuid(),
  shop_id                 uuid not null references shops(id) on delete cascade,
  session_type            text not null check (session_type in ('offline','online')),
  user_id                 text,
  shop_domain             text,
  access_token_encrypted  text not null,
  key_version             int not null default 1,
  scopes                  text,
  expires_at              timestamptz,
  created_at              timestamptz not null default now(),
  -- offline sessions: one per shop (user_id is null)
  -- online sessions: one per shop+user
  unique(shop_id, session_type, user_id)
);

create index idx_sessions_shop on shop_sessions(shop_id);

alter table shops enable row level security;
alter table shop_sessions enable row level security;
