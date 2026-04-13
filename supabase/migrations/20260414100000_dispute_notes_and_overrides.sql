-- Phase 3: dispute_notes table + override tracking on disputes

create table dispute_notes (
  id            uuid primary key default gen_random_uuid(),
  dispute_id    uuid not null references disputes(id) on delete cascade,
  shop_id       uuid not null references shops(id) on delete cascade,
  visibility    text not null default 'internal_only'
                check (visibility in ('merchant_and_internal','internal_only')),
  note_body     text not null,
  author_type   text not null check (author_type in ('support','admin','system')),
  author_ref    text,
  created_at    timestamptz not null default now()
);

create index idx_dispute_notes_dispute on dispute_notes(dispute_id);
create index idx_dispute_notes_shop on dispute_notes(shop_id);

alter table dispute_notes enable row level security;

create policy "service_role_full_access_dispute_notes"
  on dispute_notes for all
  using (true)
  with check (true);

-- Override tracking on disputes
alter table disputes
  add column if not exists has_admin_override boolean not null default false,
  add column if not exists overridden_fields jsonb default '{}'::jsonb;
