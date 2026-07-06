-- Offline session presence + a few recent fulfilled order GIDs for cay-collective
with s as (select 'c497df8d-632d-49da-b385-eb523f57f341'::uuid as sid)
select
  (select shop_domain from shops, s where id = s.sid) as shop_domain,
  (select count(*) from shop_sessions ss, s
     where ss.shop_id = s.sid and ss.session_type='offline' and ss.user_id is null) as offline_sessions,
  (select scopes from shop_sessions ss, s
     where ss.shop_id = s.sid and ss.session_type='offline' and ss.user_id is null
     order by ss.created_at desc limit 1) as latest_scopes;
