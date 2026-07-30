-- Reset surasvenne.myshopify.com (dev) to a FRESH-INSTALL wizard state so the
-- merged `handling` step can be walked end to end. DEV ONLY (vrpkgudqmpyunekrkpnc).
--
-- Touches ONLY onboarding state. Disputes, packs, orders and defence packages
-- are left completely alone. Reversible via _dev_restore_surasvenne_setup.sql.

-- 1) Clear the wizard. `permissions` is kept as done because it is written by
--    the OAuth callback, not by the merchant — a real fresh install has it too.
update public.shop_setup
   set steps = '{
         "permissions": {
           "completed_at": "2026-05-28T15:19:19.079Z",
           "payload": {"auto": true, "trigger": "oauth_callback"},
           "status": "done"
         }
       }'::jsonb,
       current_step = 'permissions',
       updated_at = now()
 where shop_id = '6f62ee7a-66ba-452f-bb13-2e4baf44e4c0';

-- 2) Clear the store-wide automation rows so the seeded install default is
--    what the wizard pre-selects. Custom rules are untouched by design.
delete from public.rules
 where shop_id = '6f62ee7a-66ba-452f-bb13-2e4baf44e4c0'
   and left(name, 12) = '__dd_setup__';

-- 3) Re-seed the install default: auto-pilot ON + $500 safeguard, exactly what
--    seedDefaultStoreAutomation() writes on a real install.
insert into public.rules (shop_id, enabled, name, match, action, priority)
values
  ('6f62ee7a-66ba-452f-bb13-2e4baf44e4c0', true, '__dd_setup__:fallback:default',
   '{}'::jsonb, '{"mode":"auto","pack_template_id":null}'::jsonb, 100000),
  ('6f62ee7a-66ba-452f-bb13-2e4baf44e4c0', true, '__dd_setup__:safeguard:high_value',
   '{"amount_range":{"min":500}}'::jsonb, '{"mode":"review"}'::jsonb, 5);

-- 4) Mirror the gate, as writeStoreAutomation would.
update public.shop_settings
   set auto_save_enabled = true, updated_at = now()
 where shop_id = '6f62ee7a-66ba-452f-bb13-2e4baf44e4c0';

-- Verify
select
  (select count(*) from public.rules
    where shop_id = '6f62ee7a-66ba-452f-bb13-2e4baf44e4c0'
      and left(name, 12) = '__dd_setup__') as setup_rules,
  (select action->>'mode' from public.rules
    where shop_id = '6f62ee7a-66ba-452f-bb13-2e4baf44e4c0'
      and name = '__dd_setup__:fallback:default') as switch_mode,
  (select match->'amount_range'->>'min' from public.rules
    where shop_id = '6f62ee7a-66ba-452f-bb13-2e4baf44e4c0'
      and name = '__dd_setup__:safeguard:high_value') as safeguard_min,
  (select auto_save_enabled from public.shop_settings
    where shop_id = '6f62ee7a-66ba-452f-bb13-2e4baf44e4c0') as auto_save_enabled,
  (select current_step from public.shop_setup
    where shop_id = '6f62ee7a-66ba-452f-bb13-2e4baf44e4c0') as current_step;
