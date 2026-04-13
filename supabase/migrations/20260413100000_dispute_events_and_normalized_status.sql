-- Dispute History & Outcomes — Phase 1
-- Creates the merchant-facing dispute event ledger and adds
-- normalized status / submission / outcome snapshot columns to disputes.

-- ─── dispute_events table ──────────────────────────────────────────────

create table dispute_events (
  id              uuid primary key default gen_random_uuid(),
  dispute_id      uuid not null references disputes(id) on delete cascade,
  shop_id         uuid not null references shops(id) on delete cascade,
  event_type      text not null,
  description     text,
  event_at        timestamptz not null,
  actor_type      text not null check (actor_type in (
    'merchant_user','disputedesk_system','disputedesk_admin','shopify','external_unknown'
  )),
  actor_ref       text,
  source_type     text not null check (source_type in (
    'system','user_action','pack_engine','shopify_sync','admin_override','webhook','manual_entry'
  )),
  visibility      text not null default 'merchant_and_internal' check (visibility in (
    'merchant_and_internal','internal_only'
  )),
  metadata_json   jsonb default '{}'::jsonb,
  dedupe_key      text unique,
  created_at      timestamptz not null default now()
);

create index idx_dispute_events_dispute on dispute_events(dispute_id);
create index idx_dispute_events_shop    on dispute_events(shop_id);
create index idx_dispute_events_at      on dispute_events(event_at desc);
create index idx_dispute_events_type    on dispute_events(event_type);

alter table dispute_events enable row level security;

create policy "service_role_full_access_dispute_events"
  on dispute_events for all
  using (true)
  with check (true);

-- Immutability: reject UPDATE and DELETE (same pattern as audit_events)
create or replace function reject_dispute_event_mutation()
returns trigger as $$
begin
  raise exception 'dispute_events is append-only: % not allowed', tg_op;
  return null;
end;
$$ language plpgsql;

create trigger trg_dispute_events_no_update
  before update on dispute_events
  for each row execute function reject_dispute_event_mutation();

create trigger trg_dispute_events_no_delete
  before delete on dispute_events
  for each row execute function reject_dispute_event_mutation();

-- ─── disputes table: normalized status + submission + outcome columns ───

alter table disputes
  add column if not exists normalized_status text check (normalized_status in (
    'new','in_progress','needs_review','ready_to_submit','action_needed',
    'submitted','waiting_on_issuer','won','lost','accepted_not_contested','closed_other'
  )),
  add column if not exists status_reason text,
  add column if not exists submission_state text default 'not_saved' check (submission_state in (
    'not_saved','saved_to_shopify','submitted_confirmed','submission_uncertain','manual_submission_reported'
  )),
  add column if not exists evidence_saved_to_shopify_at timestamptz,
  add column if not exists next_action_type text,
  add column if not exists next_action_text text,
  add column if not exists submitted_at timestamptz,
  add column if not exists closed_at timestamptz,
  add column if not exists final_outcome text check (final_outcome in (
    'won','lost','partially_won','accepted','refunded','canceled','expired','closed_other','unknown'
  )),
  add column if not exists outcome_amount_recovered numeric,
  add column if not exists outcome_amount_lost numeric,
  add column if not exists outcome_source text,
  add column if not exists outcome_confidence text,
  add column if not exists last_event_at timestamptz,
  add column if not exists sync_health text default 'ok',
  add column if not exists needs_attention boolean not null default false;

create index if not exists idx_disputes_normalized_status on disputes(shop_id, normalized_status);
