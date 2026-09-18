select
  coalesce(dp.reason_code_module,'<null>') as module_used,
  d.reason,
  count(*) as packages
from defence_packages dp
join disputes d on d.id = dp.dispute_id
where d.shop_id='ea035a1b-8aec-4305-ba2b-27713a6aeff3'
group by 1,2 order by packages desc limit 15;
