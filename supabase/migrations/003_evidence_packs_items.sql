-- 003: evidence_packs + evidence_items

create table evidence_packs (
  id                  uuid primary key default gen_random_uuid(),
  shop_id             uuid not null references shops(id) on delete cascade,
  dispute_id          uuid not null references disputes(id) on delete cascade,
  status              text not null default 'queued'
                        check (status in ('queued','building','ready','failed','archived')),
  completeness_score  int,
  checklist           jsonb,
  pack_json           jsonb,
  pdf_path            text,
  last_saved_to_shopify_at timestamptz,
  created_by          text,
  created_at          timestamptz not null default now(),
  updated_at          timestamptz not null default now()
);

create index idx_packs_shop on evidence_packs(shop_id);
create index idx_packs_dispute on evidence_packs(dispute_id);
create index idx_packs_shop_created on evidence_packs(shop_id, created_at);

create table evidence_items (
  id          uuid primary key default gen_random_uuid(),
  pack_id     uuid not null references evidence_packs(id) on delete cascade,
  type        text not null check (type in ('order','shipping','tracking','policy','comms','other')),
  label       text not null,
  source      text not null,
  payload     jsonb,
  confidence  numeric,
  created_at  timestamptz not null default now()
);

create index idx_items_pack on evidence_items(pack_id);

alter table evidence_packs enable row level security;
alter table evidence_items enable row level security;
