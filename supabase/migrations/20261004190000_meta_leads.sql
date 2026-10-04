-- Meta Instant Form (lead ad) leads, polled from the Graph API by /api/cron/meta-leads-poll.
--
-- One row per Meta lead (leadgen_id is Meta's own id, so a re-poll of the same
-- lead is a no-op). Separate from winnability_leads / playbook_leads: those are
-- site-form funnels with their own nurture rules; these arrive from paid ads.
--
-- installed_at / installed_shop are set when a new shop's owner email matches a
-- lead, so install can be fed back to Meta as the lead's conversion.
--
-- Server-only: RLS enabled, no policies. All reads/writes use the service-role
-- client, which bypasses RLS.

create table if not exists public.meta_leads (
  id               uuid primary key default gen_random_uuid(),
  leadgen_id       text not null,
  form_id          text,
  form_name        text,
  ad_id            text,
  ad_name          text,
  campaign_name    text,
  email            text,                              -- lowercased; null if the form had no email field
  full_name        text,
  phone            text,
  company          text,
  store            text,                              -- store URL / domain if the form asked for one
  answers          jsonb not null default '{}'::jsonb,
  status           text not null default 'active',    -- 'active' | 'unsubscribed'
  created_time     timestamptz,                       -- when Meta says the lead was submitted
  welcomed_at      timestamptz,
  admin_notified_at timestamptz,
  installed_at     timestamptz,
  installed_shop   text,
  created_at       timestamptz not null default now(),
  unsubscribed_at  timestamptz
);

alter table public.meta_leads
  add constraint meta_leads_leadgen_id_key unique (leadgen_id);

create index if not exists meta_leads_email_idx
  on public.meta_leads (lower(email));
create index if not exists meta_leads_created_time_idx
  on public.meta_leads (created_time desc);

comment on table public.meta_leads is
  'Meta Instant Form leads polled from the Graph API (/api/cron/meta-leads-poll). Server-only (RLS, no policies). One row per Meta leadgen_id.';

alter table public.meta_leads enable row level security;

grant select, insert, update, delete on public.meta_leads to service_role;
