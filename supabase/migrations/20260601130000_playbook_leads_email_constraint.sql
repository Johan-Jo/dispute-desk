-- Corrective: make playbook_leads.email a UNIQUE CONSTRAINT, not just an index.
--
-- The first cut of 20260601120000_playbook_leads.sql created a functional
-- unique index on lower(email). PostgREST's upsert ON CONFLICT (email) target
-- requires a real unique CONSTRAINT on the column — a functional index does
-- not satisfy it (Postgres error 42P10), so the capture API's upsert silently
-- failed and no lead row was written.
--
-- The capture API normalizes email (trim + lowercase) before writing, so a
-- plain UNIQUE (email) is both correct for dedup and a valid ON CONFLICT
-- target. Idempotent: safe on DBs that already have the constraint (fresh
-- installs get it from the base migration) and on DBs that still carry the
-- legacy functional index.

-- Only drop the index if it is a *plain* index. On DBs where the base
-- migration already created `email` as a UNIQUE CONSTRAINT, the index of
-- the same name is owned by that constraint and `DROP INDEX` errors with
-- 2BP01 ("cannot drop index ... because constraint ... requires it").
-- Guard on the absence of a matching constraint so this stays a true no-op
-- there (the constraint is exactly what we want in that case).
do $$
begin
  if exists (
    select 1
    from pg_indexes
    where schemaname = 'public'
      and indexname = 'playbook_leads_email_key'
  ) and not exists (
    select 1
    from pg_constraint
    where conname = 'playbook_leads_email_key'
      and conrelid = 'public.playbook_leads'::regclass
  ) then
    execute 'drop index public.playbook_leads_email_key';
  end if;
end $$;

do $$
begin
  if not exists (
    select 1
    from pg_constraint
    where conname = 'playbook_leads_email_key'
      and conrelid = 'public.playbook_leads'::regclass
  ) then
    alter table public.playbook_leads
      add constraint playbook_leads_email_key unique (email);
  end if;
end $$;
