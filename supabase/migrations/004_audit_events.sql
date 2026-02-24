-- 004: audit_events (append-only, immutable)

create table audit_events (
  id              uuid primary key default gen_random_uuid(),
  shop_id         uuid not null references shops(id) on delete cascade,
  dispute_id      uuid references disputes(id),
  pack_id         uuid references evidence_packs(id),
  actor_type      text not null check (actor_type in ('merchant','system')),
  actor_id        text,
  event_type      text not null,
  event_payload   jsonb,
  created_at      timestamptz not null default now()
);

create index idx_audit_shop on audit_events(shop_id);
create index idx_audit_dispute on audit_events(dispute_id);
create index idx_audit_pack on audit_events(pack_id);
create index idx_audit_type on audit_events(event_type);

alter table audit_events enable row level security;

-- Immutability: reject any UPDATE or DELETE on audit_events
create or replace function reject_audit_mutation()
returns trigger as $$
begin
  raise exception 'audit_events is append-only: % not allowed', tg_op;
  return null;
end;
$$ language plpgsql;

create trigger trg_audit_no_update
  before update on audit_events
  for each row execute function reject_audit_mutation();

create trigger trg_audit_no_delete
  before delete on audit_events
  for each row execute function reject_audit_mutation();
