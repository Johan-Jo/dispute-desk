-- RESTORE surasvenne.myshopify.com (dev) to its pre-reset wizard state.
-- Snapshot taken 2026-07-28 before resetting the shop to verify the merged
-- `handling` step. Run against DEV ONLY (ref vrpkgudqmpyunekrkpnc).
--
--   npx supabase db query --linked --file scripts/sql/_dev_restore_surasvenne_setup.sql
update public.shop_setup
   set steps = '{
         "activate": {"status": "done"},
         "automation": {"status": "done"},
         "connection": {"status": "done"},
         "coverage": {"status": "done"},
         "permissions": {
           "completed_at": "2026-05-28T15:19:19.079Z",
           "payload": {"auto": true, "trigger": "oauth_callback"},
           "status": "done"
         },
         "policies": {"status": "done"},
         "store_profile": {"status": "done"},
         "team": {
           "payload": {"notifications": {"newDispute": false, "outcome": true}}
         }
       }'::jsonb,
       current_step = null,
       updated_at = now()
 where shop_id = '6f62ee7a-66ba-452f-bb13-2e4baf44e4c0';

select shop_id, current_step, jsonb_object_keys(steps) as step_key
  from public.shop_setup
 where shop_id = '6f62ee7a-66ba-452f-bb13-2e4baf44e4c0';
