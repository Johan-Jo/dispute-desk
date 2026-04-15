-- Fix lint: public._migrations had no RLS enabled, exposing it
-- via PostgREST. Enable RLS with no policies (deny-all for
-- anon/authenticated; service_role bypasses RLS automatically).
alter table public._migrations enable row level security;
