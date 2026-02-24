-- 002: disputes table with dispute_evidence_gid for Epic 5

create table disputes (
  id                    uuid primary key default gen_random_uuid(),
  shop_id               uuid not null references shops(id) on delete cascade,
  dispute_gid           text not null,
  dispute_evidence_gid  text,
  order_gid             text,
  status                text,
  reason                text,
  amount                numeric,
  currency_code         text,
  initiated_at          timestamptz,
  due_at                timestamptz,
  needs_review          boolean not null default false,
  last_synced_at        timestamptz,
  raw_snapshot          jsonb,
  created_at            timestamptz not null default now(),
  updated_at            timestamptz not null default now(),
  unique(shop_id, dispute_gid)
);

create index idx_disputes_shop_status on disputes(shop_id, status);
create index idx_disputes_due on disputes(due_at);

alter table disputes enable row level security;
