select 'snapshot_rules' as k, count(*)::text as v from public.setup_rules_pre_collapse_20260729
union all select 'snapshot_gates', count(*)::text from public.shop_auto_save_pre_collapse_20260729
union all select 'group_rows', count(*)::text from public.rules where name like '\_\_dd\_setup\_\_:group:%'
union all select 'surasvenne_auto_save', auto_save_enabled::text from public.shop_settings where shop_id = '6f62ee7a-66ba-452f-bb13-2e4baf44e4c0';
