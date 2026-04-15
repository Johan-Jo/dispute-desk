-- Fix lint: pack_balance view was SECURITY DEFINER (Postgres default),
-- bypassing RLS of the querying user. Switch to security_invoker so
-- the view respects the caller's row-level security policies.
alter view public.pack_balance set (security_invoker = true);
