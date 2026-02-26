-- 016: pack_templates + pack_template_documents
-- Reusable evidence pack configurations (templates) per shop.

create table pack_templates (
  id            uuid primary key default gen_random_uuid(),
  shop_id       uuid not null references shops(id) on delete cascade,
  name          text not null,
  dispute_type  text not null,
  description   text,
  status        text not null default 'draft'
                  check (status in ('active','draft','archived')),
  usage_count   integer not null default 0,
  last_used_at  timestamptz,
  created_by    uuid,
  created_at    timestamptz not null default now(),
  updated_at    timestamptz not null default now()
);

create index idx_pack_templates_shop on pack_templates(shop_id);
create index idx_pack_templates_shop_status on pack_templates(shop_id, status);

create table pack_template_documents (
  id            uuid primary key default gen_random_uuid(),
  template_id   uuid not null references pack_templates(id) on delete cascade,
  name          text not null,
  file_type     text not null,
  file_size     text,
  required      boolean not null default false,
  storage_path  text,
  created_at    timestamptz not null default now()
);

create index idx_template_docs_template on pack_template_documents(template_id);

alter table pack_templates enable row level security;
alter table pack_template_documents enable row level security;

create policy "service_role_full_access_pack_templates"
  on pack_templates for all
  using (true)
  with check (true);

create policy "service_role_full_access_pack_template_docs"
  on pack_template_documents for all
  using (true)
  with check (true);
