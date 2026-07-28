-- Close the gap left by 20260727120000_collapse_setup_rules_to_store_switch.
--
-- THE BUG: that migration built its mode vote with
--     ... where left(name,12) = '__dd_setup__'
--           and name <> '__dd_setup__:safeguard:high_value'
--           and enabled
--     group by shop_id
-- A shop whose ONLY setup rules were the safeguard, or whose setup rules were
-- all `enabled = false`, produced NO GROUP AT ALL — not a row with
-- mode='review'. So step 4 inserted no fallback for it and step 6 skipped its
-- shop_settings update. Those shops came out of the migration with:
--   - no `__dd_setup__:fallback:default` row, and
--   - a stale `auto_save_enabled`.
--
-- WHY IT MATTERS (the compound failure):
--   1. With no catch-all, `pickAutomationAction` returns its no-match default
--      of "review" — so behaviour is safe, but the UI/gate can disagree.
--   2. Worse: `seedDefaultStoreAutomation` guards on the EXISTENCE of a
--      fallback row. On that shop's next OAuth re-auth it sees none, decides
--      the shop is brand new, and writes mode=auto + a $500 safeguard —
--      silently flipping a merchant who never opted in to auto-submit and
--      overwriting a custom threshold (e.g. $200).
--
-- FIX: give every shop that is missing a fallback the conservative "review",
-- and bring its gate into lockstep. Never touches a shop that already has one,
-- so a merchant who deliberately chose auto is unaffected.

begin;

-- 1) Every shop with no fallback rule gets the safe default.
insert into public.rules (shop_id, enabled, name, match, action, priority)
select s.id,
       true,
       '__dd_setup__:fallback:default',
       '{}'::jsonb,
       '{"mode":"review","pack_template_id":null}'::jsonb,
       100000
  from public.shops s
 where not exists (
         select 1
           from public.rules r
          where r.shop_id = s.id
            and r.name = '__dd_setup__:fallback:default'
       );

-- 2) Mirror the gate for exactly those shops. `auto_save_enabled` is a strict
--    1:1 of the switch, so a shop now on "review" must not carry a stale true.
update public.shop_settings ss
   set auto_save_enabled = false,
       updated_at = now()
  from public.rules r
 where r.shop_id = ss.shop_id
   and r.name = '__dd_setup__:fallback:default'
   and r.action->>'mode' = 'review'
   and ss.auto_save_enabled is distinct from false;

-- 3) And the converse: any shop whose fallback says auto must have the gate on.
--    Repairs drift from the pre-fix legacy writers (POST /api/setup/automation
--    updated the flag without ensure_shop_settings, so it could silently
--    no-op on a shop with no settings row).
update public.shop_settings ss
   set auto_save_enabled = true,
       updated_at = now()
  from public.rules r
 where r.shop_id = ss.shop_id
   and r.name = '__dd_setup__:fallback:default'
   and r.action->>'mode' = 'auto'
   and ss.auto_save_enabled is distinct from true;

commit;
