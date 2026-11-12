-- Audit trail for platform-wide admin actions (template status, reason
-- mappings, ...). These have no shop, so they could never go into
-- audit_events, whose shop_id is NOT NULL: both admin routes inserted without
-- one, the insert failed, nobody checked the result, and zero audit rows were
-- ever written (prod: 0 'reason_mapping.updated' / 'template.status_changed').
--
-- Service-role only (RLS on, no policies, privileges revoked) and append-only.

create table if not exists public.admin_audit_events (
  id            uuid        primary key default gen_random_uuid(),
  created_at    timestamptz not null default now(),
  actor_user_id uuid,
  actor_email   text        not null,
  event_type    text        not null,
  event_payload jsonb       not null default '{}'::jsonb
);

create index if not exists admin_audit_events_created_idx
  on public.admin_audit_events (created_at desc);
create index if not exists admin_audit_events_type_idx
  on public.admin_audit_events (event_type, created_at desc);

alter table public.admin_audit_events enable row level security;
revoke all on public.admin_audit_events from public, anon, authenticated;
grant select, insert on public.admin_audit_events to service_role;

create or replace function public.admin_audit_events_append_only()
returns trigger language plpgsql as $$
begin
  raise exception 'admin_audit_events is append-only';
end;
$$;

drop trigger if exists admin_audit_events_no_update on public.admin_audit_events;
create trigger admin_audit_events_no_update
  before update or delete on public.admin_audit_events
  for each row execute function public.admin_audit_events_append_only();

comment on table public.admin_audit_events is
  'Append-only audit of platform-wide admin actions that have no shop. Service-role only.';
