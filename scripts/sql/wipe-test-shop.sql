-- Wipe a single TEST shop and all its traces from the linked Supabase project.
--
-- Usage:
--   1. Set @domain below to a LIKE pattern (e.g. '%sharpdesk%').
--   2. Delete that shop's Storage objects FIRST (SQL can't — a guard trigger
--      blocks deletes on storage.objects). Use the Storage API:
--        node -e 'const{createClient}=require("@supabase/supabase-js");
--          const sb=createClient(URL,SERVICE_ROLE,{auth:{persistSession:false}});
--          sb.storage.from("policy-uploads").remove([ ...paths ]).then(console.log)'
--      Find the paths with the storage SELECT at the bottom of this file.
--   3. Run this file:  npx supabase db query --linked --file scripts/sql/wipe-test-shop.sql
--
-- Deleting the shops row cascades every table whose shop_id FK is
-- `on delete cascade` (disputes, evidence_packs, packs, sessions, settings,
-- shop_setup, plan_entitlements, jobs, rules, shop_daily_metrics,
-- policy_snapshots, pack_credits_ledger, audit_events, …). Two things the
-- cascade does NOT handle, addressed below:
--   - audit_events is append-only — flip the app.allow_audit_mutation GUC.
--   - app_events has NO shops FK — delete it explicitly.
--
-- ⚠ PROD-SAFE ONLY for disposable test stores. Never run against a real merchant.

do $$
declare
  v_pattern constant text := '%sharpdesk%';   -- <-- set the target shop domain pattern
  v_ids uuid[];
begin
  select array_agg(id) into v_ids from shops where shop_domain ilike v_pattern;
  if v_ids is null then
    raise notice 'no shop matches %, nothing to do', v_pattern;
    return;
  end if;

  -- app_events has no FK cascade — remove it first.
  delete from app_events where shop_id = any(v_ids);

  -- Allow the audit_events cascade delete (append-only guard).
  perform set_config('app.allow_audit_mutation', 'on', true); -- txn-local

  -- Cascade everything else.
  delete from shops where id = any(v_ids);

  raise notice 'wiped % shop(s)', array_length(v_ids, 1);
end $$;

-- Verify (run separately): expect 0 everywhere.
-- select 'shops' t, count(*) from shops where shop_domain ilike '%sharpdesk%'
-- union all select 'app_events', count(*) from app_events where shop_id in (...);

-- Find a shop's Storage objects to remove via the Storage API (step 2):
-- select bucket_id, name from storage.objects
-- where name like '<shop-uuid>%';
