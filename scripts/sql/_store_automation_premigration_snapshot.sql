-- Pre-migration snapshot for 20260727120000_collapse_setup_rules_to_store_switch.
-- Run against dev BEFORE `npm run db:migrate:dev`; re-run the sibling
-- _store_automation_postmigration_verify.sql after and compare.
select
  s.shop_id,
  count(*) filter (where left(r.name, 12) = '__dd_setup__' and r.name <> '__dd_setup__:safeguard:high_value' and r.enabled) as setup_voting_rules,
  bool_and(r.action->>'mode' = 'auto') filter (where left(r.name, 12) = '__dd_setup__' and r.name <> '__dd_setup__:safeguard:high_value' and r.enabled) as all_auto,
  count(*) filter (where r.name like '\_\_dd\_setup\_\_:pack:%') as pack_rules,
  count(*) filter (where r.name like '\_\_dd\_setup\_\_:coverage:%') as coverage_rules,
  count(*) filter (where r.name = '__dd_setup__:safeguard:high_value') as canonical_safeguards,
  count(*) filter (where r.name = '__dd_safeguard__:high_value') as legacy_safeguards,
  count(*) filter (where r.name is null or (left(r.name, 12) <> '__dd_setup__' and r.name <> '__dd_safeguard__:high_value')) as custom_rules,
  max(ss.auto_save_enabled::int) as auto_save_enabled
from public.rules r
join (select distinct shop_id from public.rules) s on s.shop_id = r.shop_id
left join public.shop_settings ss on ss.shop_id = r.shop_id
group by s.shop_id
order by s.shop_id;
