-- READ-ONLY. Question 1 for the group-overrides plan (PR-1).
--
-- PR-1 narrows writeStoreAutomation's delete from a `__dd_setup__:%` prefix
-- to an explicit name list. That drops a self-heal for legacy
-- `__dd_setup__:pack:{uuid}` and `__dd_setup__:coverage:{family}` rows.
--
-- If this returns zero rows, dropping the self-heal is safe: migration
-- 20260727120000 already removed them all and nothing writes them any more.
-- If it returns any, PR-1 must keep a targeted cleanup for those two
-- sub-prefixes.
--
-- SELECT only. No writes.
select
  count(*) filter (where name like '\_\_dd\_setup\_\_:pack:%')     as legacy_pack_rules,
  count(*) filter (where name like '\_\_dd\_setup\_\_:coverage:%') as legacy_coverage_rules,
  count(*) filter (where name = '__dd_safeguard__:high_value')    as legacy_safeguard_rows,
  count(distinct shop_id) filter (
    where name like '\_\_dd\_setup\_\_:pack:%'
       or name like '\_\_dd\_setup\_\_:coverage:%'
  )                                                               as shops_affected,
  count(*) filter (where name = '__dd_setup__:fallback:default')  as fallback_rows,
  count(*) filter (where name = '__dd_setup__:safeguard:high_value') as canonical_safeguards,
  count(*) filter (
    where name is null or left(name, 12) <> '__dd_setup__'
  )                                                               as custom_rules
from public.rules;
