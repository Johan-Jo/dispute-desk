-- Fix lint: public._migrations had no RLS enabled, exposing it
-- via PostgREST. Enable RLS with no policies (deny-all for
-- anon/authenticated; service_role bypasses RLS automatically).
--
-- The `_migrations` table is a legacy artifact from the script-based
-- migration runner (`scripts/run-migration.mjs`). It only exists on
-- projects that used that runner before switching to the Supabase CLI.
-- A clean Supabase CLI project (like the new Pro project being stood
-- up in 2026-05) never has it, so this migration must no-op there.
do $$
begin
  if exists (
    select 1 from pg_tables
    where schemaname = 'public' and tablename = '_migrations'
  ) then
    execute 'alter table public._migrations enable row level security';
  end if;
end
$$;
