-- Shops that completed the wizard (activate done) but never recorded the
-- connection step — wedged in the dashboard→wizard loop.
select
  s.shop_domain,
  ss.shop_id,
  ss.steps -> 'connection' ->> 'status' as connection_status,
  ss.steps -> 'activate'   ->> 'status' as activate_status,
  ss.updated_at
from shop_setup ss
join shops s on s.id = ss.shop_id
where coalesce(ss.steps -> 'activate' ->> 'status', 'todo') = 'done'
  and coalesce(ss.steps -> 'connection' ->> 'status', 'todo') <> 'done'
order by ss.updated_at desc;
