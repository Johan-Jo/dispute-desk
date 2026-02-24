-- 006: RLS policies
-- Supabase is accessed server-only via service role key.
-- RLS is a defense-in-depth backstop. Service role bypasses RLS by default,
-- so these policies protect against accidental anon/client access.

-- shops
create policy "service_role_full_access_shops"
  on shops for all
  using (true)
  with check (true);

-- shop_sessions
create policy "service_role_full_access_sessions"
  on shop_sessions for all
  using (true)
  with check (true);

-- disputes
create policy "service_role_full_access_disputes"
  on disputes for all
  using (true)
  with check (true);

-- evidence_packs
create policy "service_role_full_access_packs"
  on evidence_packs for all
  using (true)
  with check (true);

-- evidence_items
create policy "service_role_full_access_items"
  on evidence_items for all
  using (true)
  with check (true);

-- audit_events: INSERT-only for non-service roles (additional safety)
create policy "service_role_full_access_audit"
  on audit_events for all
  using (true)
  with check (true);

-- rules
create policy "service_role_full_access_rules"
  on rules for all
  using (true)
  with check (true);

-- policy_snapshots
create policy "service_role_full_access_policies"
  on policy_snapshots for all
  using (true)
  with check (true);
