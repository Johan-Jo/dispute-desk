-- Dev shops + their current setup-wizard state and store-wide automation.
select
  s.id            as shop_id,
  s.shop_domain,
  s.plan,
  s.uninstalled_at,
  ss.current_step,
  jsonb_object_keys_count.keys as setup_step_keys,
  ss.steps,
  (select r.action->>'mode' from public.rules r
     where r.shop_id = s.id and r.name = '__dd_setup__:fallback:default') as switch_mode,
  (select r.match->'amount_range'->>'min' from public.rules r
     where r.shop_id = s.id and r.name = '__dd_setup__:safeguard:high_value') as safeguard_min,
  st.auto_save_enabled,
  st.auto_build_enabled
from public.shops s
left join public.shop_setup ss on ss.shop_id = s.id
left join public.shop_settings st on st.shop_id = s.id
left join lateral (
  select array_agg(k) as keys from jsonb_object_keys(coalesce(ss.steps, '{}'::jsonb)) k
) jsonb_object_keys_count on true
order by s.created_at desc;
