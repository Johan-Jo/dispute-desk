-- Argument maps, rebuttal drafts, and submission attempts
-- for the dispute workspace redesign.

-- 1. Argument maps — structured claim-evidence linking per dispute
create table argument_maps (
  id               uuid primary key default gen_random_uuid(),
  dispute_id       uuid not null references disputes(id) on delete cascade,
  pack_id          uuid references evidence_packs(id) on delete set null,
  issuer_claim     jsonb not null,
  counterclaims    jsonb not null default '[]'::jsonb,
  overall_strength text not null default 'insufficient'
    check (overall_strength in ('strong', 'moderate', 'weak', 'insufficient')),
  generated_at     timestamptz not null default now(),
  edited_at        timestamptz,
  edited_by        text,
  created_at       timestamptz not null default now(),
  updated_at       timestamptz not null default now()
);
create index idx_argmap_dispute on argument_maps(dispute_id);
create index idx_argmap_pack on argument_maps(pack_id);
alter table argument_maps enable row level security;
create policy "service_role_argument_maps" on argument_maps
  for all using (true) with check (true);

-- 2. Rebuttal drafts — structured rebuttal sections per pack
create table rebuttal_drafts (
  id          uuid primary key default gen_random_uuid(),
  pack_id     uuid not null references evidence_packs(id) on delete cascade,
  locale      text not null default 'en-US',
  sections    jsonb,
  source      text not null default 'GENERATED'
    check (source in ('GENERATED', 'MERCHANT_EDITED')),
  version     int not null default 1,
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now(),
  unique(pack_id, locale)
);
create index idx_rebuttal_pack on rebuttal_drafts(pack_id);
alter table rebuttal_drafts enable row level security;
create policy "service_role_rebuttal_drafts" on rebuttal_drafts
  for all using (true) with check (true);

-- 3. Submission attempts — full audit of every submission
create table submission_attempts (
  id                 uuid primary key default gen_random_uuid(),
  pack_id            uuid not null references evidence_packs(id) on delete cascade,
  dispute_id         uuid not null references disputes(id) on delete cascade,
  shop_id            uuid not null references shops(id),
  method             text not null check (method in ('auto', 'manual')),
  readiness          text not null,
  completeness_score int,
  argument_strength  text,
  warnings           jsonb default '[]'::jsonb,
  excluded_fields    jsonb default '[]'::jsonb,
  override_reason    text,
  override_note      text,
  shopify_result     text,
  submitted_at       timestamptz not null default now(),
  actor_type         text not null,
  actor_id           text
);
create index idx_subatt_dispute on submission_attempts(dispute_id);
create index idx_subatt_pack on submission_attempts(pack_id);
alter table submission_attempts enable row level security;
create policy "service_role_submission_attempts" on submission_attempts
  for all using (true) with check (true);
