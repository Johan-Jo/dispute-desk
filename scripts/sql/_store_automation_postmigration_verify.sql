-- Post-migration verification for 20260727120000_collapse_setup_rules_to_store_switch.
-- Every `ok_*` column MUST be true for every row.
select
  r.shop_id,
  count(*) filter (where r.name = '__dd_setup__:fallback:default') as fallbacks,
  count(*) filter (where r.name = '__dd_setup__:safeguard:high_value') as safeguards,
  count(*) filter (where r.name like '\_\_dd\_setup\_\_:pack:%'
                      or r.name like '\_\_dd\_setup\_\_:coverage:%'
                      or r.name = '__dd_safeguard__:high_value') as leftovers,
  max(r.action->>'mode') filter (where r.name = '__dd_setup__:fallback:default') as switch_mode,
  bool_or(ss.auto_save_enabled) as auto_save_enabled,
  count(*) filter (where r.name is null or left(r.name, 12) <> '__dd_setup__') as custom_rules,
  -- assertions
  count(*) filter (where r.name = '__dd_setup__:fallback:default') = 1 as ok_exactly_one_fallback,
  count(*) filter (where r.name = '__dd_setup__:safeguard:high_value') <= 1 as ok_at_most_one_safeguard,
  count(*) filter (where r.name like '\_\_dd\_setup\_\_:pack:%'
                      or r.name like '\_\_dd\_setup\_\_:coverage:%'
                      or r.name = '__dd_safeguard__:high_value') = 0 as ok_no_leftovers,
  bool_or(ss.auto_save_enabled)
    = (max(r.action->>'mode') filter (where r.name = '__dd_setup__:fallback:default') = 'auto')
    as ok_gate_mirrors_switch
from public.rules r
left join public.shop_settings ss on ss.shop_id = r.shop_id
group by r.shop_id
order by r.shop_id;
