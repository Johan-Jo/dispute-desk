select
  s.shop_domain,
  s.id as shop_id,
  (select count(*) from disputes d where d.shop_id = s.id) as disputes,
  (select count(*) from evidence_packs p where p.shop_id = s.id) as packs,
  (select count(*) from shop_sessions ss where ss.shop_id = s.id and ss.session_type = 'offline') as offline_sessions,
  (select count(*) from defence_packages dp join disputes d2 on d2.id = dp.dispute_id where d2.shop_id = s.id) as defence_packages
from shops s
order by s.shop_domain;
