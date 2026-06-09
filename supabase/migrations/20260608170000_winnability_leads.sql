-- Inbound GTM lead-capture for the 5-Minute Winnability Test (/test, DP-TEST-01).
--
-- One row per email that completes the test. Unlike playbook_leads, these
-- leads do NOT enter the CE 3.0 nurture sequence — the test sends exactly one
-- email (the merchant's result), and the team gets an admin notification. The
-- nurture chain stays exclusive to the /playbook funnel.
--
-- What makes a winnability lead "fully qualified": we store the verdict, the
-- chargeback ratio + band, and the raw answers, so admin can spot a hot
-- prospect (e.g. "win" verdict + "red" ratio = call within the hour).
--
-- Re-taking the test with the same email UPDATES the row to the latest result
-- (verdict/ratio/answers) while keeping the original created_at. This differs
-- from playbook_leads (which ignores re-submits to protect nurture state) —
-- there's no sequence here, so the freshest result is the useful one.
--
-- Server-only: RLS enabled, no policies. All reads/writes go through the
-- service-role client (capture API + admin list API), which bypasses RLS.

create table if not exists public.winnability_leads (
  id                 uuid primary key default gen_random_uuid(),
  email              text not null,
  store              text,                              -- optional store URL the merchant typed
  verdict            text,                              -- 'win' | 'borderline' | 'no' | 'other'
  lane               text,                              -- 'ff' | 'fraud' | 'other'
  ratio_pct          numeric,                           -- disputes ÷ orders × 100 (null if not computable)
  ratio_band         text,                              -- 'green' | 'amber' | 'red' | 'unknown'
  disputes_per_month int,
  orders_per_month   int,
  answers            jsonb not null default '{}'::jsonb,
  status             text not null default 'active',    -- 'active' | 'unsubscribed'
  created_at         timestamptz not null default now(),
  updated_at         timestamptz not null default now(),
  unsubscribed_at    timestamptz
);

-- One lead per email (case-insensitive: the capture API trims + lowercases
-- before writing). A unique CONSTRAINT (not just an index) so the upsert's
-- ON CONFLICT (email) target resolves.
alter table public.winnability_leads
  add constraint winnability_leads_email_key unique (email);

-- Admin list scans newest-first; verdict/band power the "hot lead" filters.
create index if not exists winnability_leads_created_idx
  on public.winnability_leads (created_at desc);
create index if not exists winnability_leads_verdict_band_idx
  on public.winnability_leads (verdict, ratio_band);

comment on table public.winnability_leads is
  'Inbound GTM lead-capture for the 5-Minute Winnability Test (/test). Server-only (RLS, no policies). Written by /api/winnability-lead; read by /api/admin/winnability-leads. NOT enrolled in the playbook CE 3.0 nurture.';

alter table public.winnability_leads enable row level security;

-- Explicit grant (idempotent; ALTER DEFAULT PRIVILEGES already covers new
-- tables on the Pro project, but this keeps the table self-describing).
grant select, insert, update, delete on public.winnability_leads to service_role;
