-- Inbound GTM lead-capture funnel (the Liability-Shift Playbook).
--
-- One row per email that downloads the Playbook from /playbook. The lead's
-- welcome email fires synchronously at capture time; the four follow-up
-- nurture emails fire from the daily /api/cron/playbook-nurture cron, which
-- reads `nurture_step` to know which email a lead is owed next.
--
--   nurture_step = the index (1..5) of the LAST nurture email sent.
--     1 = welcome (sent at capture)              → cron may send step 2 on/after D2
--     2..4 = the teaching emails                 → cron advances one per due day
--     5 = the teardown ask (final)               → sequence complete
--
-- Re-capturing an existing email is a no-op on the nurture state (we keep the
-- earliest created_at + current step) so a second form submit never restarts
-- or double-sends the sequence. See lib/marketing/playbook/nurtureSequence.ts
-- for the per-step send schedule (sendAfterDays).
--
-- Server-only: RLS is enabled with no policies, so anon/authenticated have no
-- access. All reads/writes go through the service-role client (capture API +
-- nurture cron), which bypasses RLS.

create table if not exists public.playbook_leads (
  id              uuid primary key default gen_random_uuid(),
  email           text not null,
  locale          text,                         -- captured UI locale (en|de|es|fr|pt|sv)
  source          text,                         -- which form: 'hero' | 'final'
  utm             jsonb not null default '{}'::jsonb,
  status          text not null default 'active',   -- 'active' | 'unsubscribed'
  nurture_step    int  not null default 1,          -- last email sent (1 = welcome)
  created_at      timestamptz not null default now(),
  updated_at      timestamptz not null default now(),
  unsubscribed_at timestamptz
);

-- One lead per email. The capture API normalizes (trim + lowercase) before
-- writing, so a plain unique constraint on `email` gives case-insensitive
-- dedup AND satisfies the upsert's ON CONFLICT (email) target. (A functional
-- unique index on lower(email) does NOT satisfy ON CONFLICT — hence a
-- constraint, not just an index.)
alter table public.playbook_leads
  add constraint playbook_leads_email_key unique (email);

-- The cron scans active leads that have not finished the sequence, oldest first.
create index if not exists playbook_leads_active_step_idx
  on public.playbook_leads (status, nurture_step, created_at)
  where status = 'active';

comment on table public.playbook_leads is
  'Inbound GTM lead-capture for the Liability-Shift Playbook. Server-only (RLS, no policies). Written by /api/playbook/lead and /api/cron/playbook-nurture.';
comment on column public.playbook_leads.nurture_step is
  'Index (1..5) of the last nurture email sent. 1 = welcome (sent at capture). The cron advances one step per due day per nurtureSequence.sendAfterDays.';

alter table public.playbook_leads enable row level security;

-- Explicit grant (idempotent). ALTER DEFAULT PRIVILEGES already covers new
-- tables on the Pro project, but this keeps the table self-describing.
grant select, insert, update, delete on public.playbook_leads to service_role;
