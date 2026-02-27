-- 020: Setup Wizard state, integrations, evidence files, app events

-- Per-shop setup wizard state
create table shop_setup (
  shop_id       uuid primary key references shops(id) on delete cascade,
  current_step  text,
  steps         jsonb not null default '{}'::jsonb,
  updated_at    timestamptz not null default now()
);

create index idx_shop_setup_updated on shop_setup(updated_at);
alter table shop_setup enable row level security;

-- Third-party integrations
create table integrations (
  id          uuid primary key default gen_random_uuid(),
  shop_id     uuid not null references shops(id) on delete cascade,
  type        text not null check (type in ('shopify_tracking','gorgias','email','warehouse')),
  status      text not null default 'not_connected' check (status in ('not_connected','connected','needs_attention')),
  meta        jsonb not null default '{}'::jsonb,
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now(),
  unique(shop_id, type)
);

create index idx_integrations_shop on integrations(shop_id);
alter table integrations enable row level security;

-- Encrypted integration credentials
create table integration_secrets (
  id              uuid primary key default gen_random_uuid(),
  integration_id  uuid not null references integrations(id) on delete cascade unique,
  secret_enc      text not null,
  created_at      timestamptz not null default now(),
  updated_at      timestamptz not null default now()
);

alter table integration_secrets enable row level security;

-- Evidence sample files
create table evidence_files (
  id            uuid primary key default gen_random_uuid(),
  shop_id       uuid not null references shops(id) on delete cascade,
  storage_path  text not null,
  filename      text not null,
  mime_type     text not null,
  size_bytes    bigint not null default 0,
  kind          text not null default 'sample' check (kind in ('sample')),
  created_at    timestamptz not null default now()
);

create index idx_evidence_files_shop on evidence_files(shop_id);
alter table evidence_files enable row level security;

-- Lightweight app events log
create table app_events (
  id          uuid primary key default gen_random_uuid(),
  shop_id     uuid,
  name        text not null,
  payload     jsonb not null default '{}'::jsonb,
  created_at  timestamptz not null default now()
);

create index idx_app_events_shop on app_events(shop_id);
create index idx_app_events_name on app_events(name);
alter table app_events enable row level security;

-- Storage bucket for evidence samples (must be created via Supabase dashboard or API)
-- insert into storage.buckets (id, name, public) values ('evidence-samples', 'evidence-samples', false);
