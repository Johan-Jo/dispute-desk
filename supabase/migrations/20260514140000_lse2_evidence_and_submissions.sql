-- LSE-2: CE 3.0 evidence packages + submission logs.
--
-- Extends evidence_packs to track LSE-specific package types (CE 3.0,
-- later FPT) and the language they were rendered in. Introduces
-- submission_logs for tracking which channel was used (Shopify dispute
-- API best-effort, manual acquirer handoff, later Verifi/Ethoca) and
-- the eventual outcome — the data we need to answer "is best-effort
-- submission via Shopify worth doing?" or "is manual upload winning more?".
--
-- See docs/epics/EPIC-LSE-2-evidence-package.md.

alter table evidence_packs
  add column if not exists package_type text not null default 'standard_representment',
  add column if not exists template_version text,
  add column if not exists qualification_id uuid,
  add column if not exists language text;

-- Constrain package_type to known values. Service-role writes only.
do $$
begin
  if not exists (
    select 1 from pg_constraint where conname = 'evidence_packs_package_type_check'
  ) then
    alter table evidence_packs
      add constraint evidence_packs_package_type_check
      check (package_type in ('standard_representment', 'ce_30', 'fpt'));
  end if;
end$$;

-- Index for "show me all CE 3.0 packages this period".
create index if not exists evidence_packs_shop_package_type_idx
  on evidence_packs (shop_id, package_type, created_at desc)
  where package_type <> 'standard_representment';

-- ── submission_logs ─────────────────────────────────────────────────
create table if not exists submission_logs (
  id uuid primary key default gen_random_uuid(),
  shop_id uuid not null references shops(id) on delete cascade,
  evidence_pack_id uuid references evidence_packs(id) on delete cascade,
  dispute_id uuid references disputes(id) on delete cascade,
  channel text not null check (
    channel in (
      'shopify_dispute_api',
      'manual_acquirer',
      'verifi',
      'ethoca'
    )
  ),
  submitted_at timestamptz not null default now(),
  confirmation_id text,
  raw_response jsonb,
  final_outcome text not null default 'pending' check (
    final_outcome in ('pending', 'won', 'lost', 'withdrawn', 'unknown')
  ),
  outcome_recorded_at timestamptz,
  partner_dispute_id text,
  retry_count int not null default 0,
  notes text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

-- One log per (pack, channel) — re-submissions update the existing row.
create unique index if not exists submission_logs_pack_channel_uq
  on submission_logs (evidence_pack_id, channel);

-- Win-rate analytics by channel + outcome.
create index if not exists submission_logs_shop_channel_outcome_idx
  on submission_logs (shop_id, channel, final_outcome);

create or replace function submission_logs_set_updated_at()
returns trigger as $$
begin
  new.updated_at := now();
  return new;
end;
$$ language plpgsql;

drop trigger if exists submission_logs_updated_at on submission_logs;
create trigger submission_logs_updated_at
before update on submission_logs
for each row execute function submission_logs_set_updated_at();

alter table submission_logs enable row level security;
drop policy if exists service_role_full_access_submission_logs on submission_logs;
create policy service_role_full_access_submission_logs
  on submission_logs for all using (true) with check (true);

comment on table submission_logs is
  'LSE-2 submission tracking. One row per (evidence_pack, channel) — re-submissions update outcome in place.';
comment on column submission_logs.channel is
  'Channel used: shopify_dispute_api (best-effort uncategorized_text/file), manual_acquirer (merchant uploaded to VROL portal themselves), verifi (LSE-6, partnership-gated), ethoca (LSE-6, partnership-gated).';
comment on column submission_logs.final_outcome is
  'Dispute outcome attributed to this submission channel. Used for per-channel win-rate analytics that justify or kill future LSE-6 partnership investments.';

-- ── auto_submit_lse settings on shop_settings ────────────────────────
alter table shop_settings
  add column if not exists lse_auto_submit_ce30_via_shopify boolean not null default true,
  add column if not exists lse_show_manual_handoff_instructions boolean not null default true;

comment on column shop_settings.lse_auto_submit_ce30_via_shopify is
  'When true, automatically attach the CE 3.0 PDF + summary text to the Shopify dispute evidence (uncategorized_text + uncategorized_file). Default true. Best-effort: Shopify Payments routing of this content is unconfirmed.';
comment on column shop_settings.lse_show_manual_handoff_instructions is
  'When true, show merchants instructions to upload the CE 3.0 package directly to their acquirer''s VROL portal alongside any Shopify submission. Default true until LSE-6 direct channels are validated as superior.';
